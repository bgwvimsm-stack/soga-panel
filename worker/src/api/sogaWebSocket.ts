import type { Env } from "../types";
import { validateSogaAuth } from "../middleware/auth";
import { SogaAPI } from "./soga";

const MAX_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_ACTIVE_CONNECTIONS = 256;

// Worker isolate 内的保护阈值，避免单个 isolate 被异常节点连接耗尽。
// 它不是跨 isolate 的全局连接配额，生产级全局配额仍应交给边缘限流/WAF。
let activeConnections = 0;

type SogaWsRequest = {
  v?: number;
  id?: number | string;
  op?: string;
  payload?: unknown;
  event_id?: string;
};

type SogaWsResponse = {
  v: 1;
  id: number | string | null;
  ok: boolean;
  status: number;
  data: unknown;
  message: string | null;
};

const operations: Record<string, { method: "GET" | "POST"; path: string }> = {
  sync: { method: "GET", path: "/api/v1/node" },
  report: { method: "POST", path: "/api/v1/report" },
  get_node: { method: "GET", path: "/api/v1/node" },
  get_users: { method: "GET", path: "/api/v1/users" },
  get_audit_rules: { method: "GET", path: "/api/v1/audit_rules" },
  get_xray_rules: { method: "GET", path: "/api/v1/xray_rules" },
  get_white_list: { method: "GET", path: "/api/v1/white_list" },
  submit_traffic: { method: "POST", path: "/api/v1/traffic" },
  submit_alive_ip: { method: "POST", path: "/api/v1/alive_ip" },
  submit_audit_log: { method: "POST", path: "/api/v1/audit_log" },
  submit_status: { method: "POST", path: "/api/v1/status" },
};

export function isSogaWebSocketUpgrade(request: Request): boolean {
  return (
    request.method === "GET" &&
    request.headers.get("Upgrade")?.toLowerCase() === "websocket"
  );
}

export async function handleSogaWebSocket(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  if (!isSogaWebSocketUpgrade(request)) {
    return new Response("WebSocket Upgrade required", { status: 426 });
  }

  const authResult = await validateSogaAuth(request, env);
  if (!authResult.success) {
    return new Response(authResult.message, { status: 401 });
  }
  if (activeConnections >= MAX_ACTIVE_CONNECTIONS) {
    return new Response("Too many WebSocket connections", { status: 503 });
  }
  activeConnections += 1;

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  console.info("Soga WebSocket opened", {
    nodeId: request.headers.get("NODE-ID"),
    activeConnections,
  });

  let released = false;
  const releaseConnection = () => {
    if (released) return;
    released = true;
    activeConnections = Math.max(0, activeConnections - 1);
  };

  const sogaAPI = new SogaAPI(env);
  server.addEventListener("message", (event) => {
    const socket = event.currentTarget as WebSocket;
    ctx.waitUntil(handleMessage(socket, request, sogaAPI, event.data));
  });
  server.addEventListener("error", () => {
    console.warn("Soga WebSocket error", {
      nodeId: request.headers.get("NODE-ID"),
    });
  });
  server.addEventListener("close", () => {
    releaseConnection();
    console.info("Soga WebSocket closed", {
      nodeId: request.headers.get("NODE-ID"),
      activeConnections,
    });
  });
  server.addEventListener("error", releaseConnection);

  return new Response(null, { status: 101, webSocket: client });
}

async function handleMessage(
  socket: WebSocket,
  handshake: Request,
  sogaAPI: SogaAPI,
  rawData: string | ArrayBuffer
): Promise<void> {
  const text = typeof rawData === "string"
    ? rawData
    : new TextDecoder().decode(rawData);

  if (new TextEncoder().encode(text).byteLength > MAX_FRAME_BYTES) {
    socket.close(1009, "Message too large");
    return;
  }

  let message: SogaWsRequest;
  try {
    message = JSON.parse(text) as SogaWsRequest;
  } catch {
    sendResponse(socket, {
      v: 1,
      id: null,
      ok: false,
      status: 400,
      data: null,
      message: "Invalid JSON",
    });
    return;
  }

  const id = message.id ?? null;
  if (message.v !== 1 || typeof message.op !== "string") {
    sendResponse(socket, {
      v: 1,
      id,
      ok: false,
      status: 400,
      data: null,
      message: "Unsupported protocol message",
    });
    return;
  }

  const operation = operations[message.op];
  if (!operation) {
    sendResponse(socket, {
      v: 1,
      id,
      ok: false,
      status: 404,
      data: null,
      message: "Unknown operation",
    });
    return;
  }

  const startedAt = Date.now();
  try {
    const response = await dispatchSogaOperation(
      sogaAPI,
      message.op,
      handshake,
      message.payload,
      message.event_id
    );
    const responseText = await response.text();
    if (new TextEncoder().encode(responseText).byteLength > MAX_FRAME_BYTES) {
      sendResponse(socket, {
        v: 1,
        id,
        ok: false,
        status: 502,
        data: null,
        message: "Response too large",
      });
      return;
    }

    let data: unknown = null;
    if (responseText.trim()) {
      try {
        data = JSON.parse(responseText);
      } catch {
        data = responseText;
      }
    }

    sendResponse(socket, {
      v: 1,
      id,
      ok: response.ok,
      status: response.status,
      data,
      message: response.ok ? null : extractMessage(data),
    });
    console.info("Soga WebSocket message", {
      nodeId: handshake.headers.get("NODE-ID"),
      op: message.op,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.warn("Soga WebSocket message failed", {
      nodeId: handshake.headers.get("NODE-ID"),
      op: message.op,
      latencyMs: Date.now() - startedAt,
    });
    sendResponse(socket, {
      v: 1,
      id,
      ok: false,
      status: 500,
      data: null,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function dispatchSogaOperation(
  sogaAPI: SogaAPI,
  operationName: string,
  handshake: Request,
  payload: unknown,
  eventId?: string
): Promise<Response> {
  const operation = operations[operationName];
  if (!operation) throw new Error("Unknown operation");
  const url = new URL(handshake.url);
  url.pathname = operation.path;
  const headers = new Headers({
    "API-KEY": handshake.headers.get("API-KEY") || "",
    "NODE-ID": handshake.headers.get("NODE-ID") || "",
    "NODE-TYPE": handshake.headers.get("NODE-TYPE") || "",
  });

  const init: RequestInit = { method: operation.method, headers };
  if (operation.method === "POST") {
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(payload ?? null);
    if (eventId) {
      headers.set("X-Event-ID", eventId);
    }
  }

  const request = new Request(url, init);
  switch (operationName) {
    case "sync":
      return sogaAPI.getSync(request);
    case "report":
      return sogaAPI.handleReportBatch(request, payload);
    case "get_node":
      return sogaAPI.getNode(request);
    case "get_users":
      return sogaAPI.getUsers(request);
    case "get_audit_rules":
      return sogaAPI.getAuditRules(request);
    case "get_xray_rules":
      return sogaAPI.getXrayRules(request);
    case "get_white_list":
      return sogaAPI.getWhiteList(request);
    case "submit_traffic":
      return sogaAPI.handleReportOperation(operationName, request);
    case "submit_alive_ip":
      return sogaAPI.handleReportOperation(operationName, request);
    case "submit_audit_log":
      return sogaAPI.handleReportOperation(operationName, request);
    case "submit_status":
      return sogaAPI.handleReportOperation(operationName, request);
    default:
      throw new Error("Unknown operation");
  }
}

function extractMessage(data: unknown): string {
  if (data && typeof data === "object" && "message" in data) {
    const message = (data as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Soga API request failed";
}

function sendResponse(socket: WebSocket, response: SogaWsResponse): void {
  try {
    socket.send(JSON.stringify(response));
  } catch {
    socket.close(1011, "Unable to send response");
  }
}

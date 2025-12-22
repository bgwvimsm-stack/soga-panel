import rawTemplate from "./singboxTemplate.json";

type SingboxOutbound = Record<string, unknown>;
type SingboxConfig = Record<string, unknown>;

const CORE_OUTBOUND_TYPES = new Set(["direct", "block", "dns"]);

function cloneTemplate(): SingboxConfig {
  return JSON.parse(JSON.stringify(rawTemplate)) as SingboxConfig;
}

function uniqueTags(tags: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalized = String(tag || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function buildSingboxTemplate(
  nodeOutbounds: SingboxOutbound[] = [],
  groupOverrides: Record<string, string[]> = {}
) {
  const template = cloneTemplate() as any;
  const baseOutbounds: SingboxOutbound[] = [];
  const selectorOutbounds: SingboxOutbound[] = [];

  const outbounds = Array.isArray(template.outbounds) ? template.outbounds : [];
  for (const outbound of outbounds) {
    if (!outbound || typeof outbound !== "object") continue;
    const type = String((outbound as any).type || "");
    if (type === "selector") {
      selectorOutbounds.push(outbound as SingboxOutbound);
    } else if (CORE_OUTBOUND_TYPES.has(type)) {
      baseOutbounds.push(outbound as SingboxOutbound);
    }
  }

  for (const outbound of selectorOutbounds) {
    const tag = String((outbound as any).tag || "");
    if (tag && groupOverrides[tag]) {
      (outbound as any).outbounds = uniqueTags(groupOverrides[tag]);
    }
  }

  template.outbounds = [...baseOutbounds, ...nodeOutbounds, ...selectorOutbounds];
  return template;
}

const textEncoder = new TextEncoder();
declare const Buffer: any;

export type RegistrationCredential = {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
    publicKey?: string;
    publicKeyAlgorithm?: number;
  };
};

export type AuthenticationCredential = {
  id: string;
  rawId: string;
  type: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle?: string | null;
  };
};

export type ValidatedRegistration = {
  credentialId: string;
  publicKey: string;
  alg: number;
  signCount: number;
  userHandle?: string | null;
  transports?: string[];
};

export type ValidatedAuthentication = {
  newSignCount: number;
  userHandle?: string | null;
};

export function base64UrlEncode(data: ArrayBuffer | Uint8Array | string) {
  const bytes =
    typeof data === "string"
      ? textEncoder.encode(data)
      : data instanceof Uint8Array
      ? data
      : new Uint8Array(data);
  if (typeof btoa === "function") {
    const binary = Array.from(bytes)
      .map((b) => String.fromCharCode(b))
      .join("");
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
  throw new Error("缺少 Base64 编解码支持");
}

export function base64UrlDecode(input: string) {
  const normalized = normalizeBase64Url(input);
  if (typeof atob === "function") {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(normalized, "base64"));
  }
  throw new Error("缺少 Base64 编解码支持");
}

export function randomChallenge(bytes = 32) {
  const buf = new Uint8Array(bytes);
  if (typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(buf);
  } else if (typeof (crypto as any).randomBytes === "function") {
    const nodeBuf = (crypto as any).randomBytes(bytes);
    buf.set(nodeBuf);
  } else {
    throw new Error("无法生成安全随机数");
  }
  return base64UrlEncode(buf);
}

export async function validateRegistrationResponse(params: {
  credential: RegistrationCredential;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
}): Promise<ValidatedRegistration> {
  const { credential, expectedChallenge, expectedOrigin, expectedRpId } = params;
  if (!credential || credential.type !== "public-key") {
    throw new Error("无效的凭证类型");
  }

  const clientData = parseClientData(
    credential.response.clientDataJSON,
    "webauthn.create",
    expectedChallenge,
    expectedOrigin
  );

  const attestationObject = base64UrlDecode(
    credential.response.attestationObject
  );
  const attestation = decodeCbor(attestationObject)[0] as Record<
    string,
    unknown
  >;
  const authDataBytes = toUint8Array(attestation.authData);

  const parsedAuth = await parseAuthenticatorData(
    authDataBytes,
    expectedRpId,
    true
  );

  if (!parsedAuth.credentialId || !parsedAuth.credentialPublicKeyBytes) {
    throw new Error("凭证数据不完整");
  }

  const cose = decodeCbor(parsedAuth.credentialPublicKeyBytes)[0] as Record<
    string | number,
    unknown
  >;
  const alg =
    typeof cose[3] === "number"
      ? cose[3]
      : typeof credential.response.publicKeyAlgorithm === "number"
      ? credential.response.publicKeyAlgorithm
      : -7;

  // 验证公钥可用性
  await importCosePublicKey(cose, alg);

  return {
    credentialId: base64UrlEncode(parsedAuth.credentialId),
    publicKey: base64UrlEncode(parsedAuth.credentialPublicKeyBytes),
    alg,
    signCount: parsedAuth.signCount,
    userHandle: clientData.raw.userHandle ?? null,
    transports: Array.isArray(credential.response.transports)
      ? credential.response.transports.map((t) => String(t))
      : undefined,
  };
}

export async function validateAuthenticationResponse(params: {
  credential: AuthenticationCredential;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
  storedPublicKey: string;
  alg: number;
  prevSignCount: number;
  expectedUserHandle?: string | null;
}): Promise<ValidatedAuthentication> {
  const {
    credential,
    expectedChallenge,
    expectedOrigin,
    expectedRpId,
    storedPublicKey,
    alg,
    prevSignCount,
    expectedUserHandle,
  } = params;

  if (!credential || credential.type !== "public-key") {
    throw new Error("无效的凭证类型");
  }

  const clientData = parseClientData(
    credential.response.clientDataJSON,
    "webauthn.get",
    expectedChallenge,
    expectedOrigin
  );

  if (
    expectedUserHandle &&
    clientData.raw.userHandle &&
    expectedUserHandle !== clientData.raw.userHandle
  ) {
    throw new Error("userHandle 不匹配");
  }

  const authDataBytes = base64UrlDecode(credential.response.authenticatorData);
  const parsedAuth = await parseAuthenticatorData(
    authDataBytes,
    expectedRpId,
    false
  );

  if (!parsedAuth.userPresent || !parsedAuth.userVerified) {
    throw new Error("需要用户验证");
  }

  const clientDataHash = await sha256(
    base64UrlDecode(credential.response.clientDataJSON)
  );
  const dataToVerify = concat(authDataBytes, clientDataHash);

  const cose = decodeCbor(base64UrlDecode(storedPublicKey))[0] as Record<
    string | number,
    unknown
  >;
  const publicKey = await importCosePublicKey(cose, alg);

  const signature = base64UrlDecode(credential.response.signature);
  let verified = await getSubtle().verify(
    mapAlgToVerifyParams(alg),
    publicKey,
    signature,
    dataToVerify
  );

  if (!verified && alg === -7) {
    const raw = derToRaw(signature, 32);
    const rawCopy = new Uint8Array(raw);
    verified = await getSubtle().verify(
      mapAlgToVerifyParams(alg),
      publicKey,
      rawCopy.buffer,
      dataToVerify
    );
  }

  if (!verified) {
    throw new Error("签名验证失败");
  }

  return {
    newSignCount: parsedAuth.signCount,
    userHandle: clientData.raw.userHandle ?? credential.response.userHandle,
  };
}

async function parseAuthenticatorData(
  authData: Uint8Array,
  expectedRpId: string,
  requireCredential = false
) {
  if (!authData || authData.length < 37) {
    throw new Error("authenticatorData 无效");
  }
  const rpIdHash = authData.slice(0, 32);
  const flags = authData[32];
  const signCount = new DataView(
    authData.buffer,
    authData.byteOffset + 33,
    4
  ).getUint32(0);

  const expectedHash = await sha256(textEncoder.encode(expectedRpId));
  if (!equalBytes(rpIdHash, expectedHash)) {
    throw new Error("rpId 校验失败");
  }

  const userPresent = (flags & 0x01) !== 0;
  const userVerified = (flags & 0x04) !== 0;
  const attested = (flags & 0x40) !== 0;

  if (!userPresent || !userVerified) {
    throw new Error("需要用户验证");
  }

  let offset = 37;
  let credentialId: Uint8Array | null = null;
  let credentialPublicKeyBytes: Uint8Array | null = null;

  if (attested) {
    offset += 16; // AAGUID
    const credLen = new DataView(
      authData.buffer,
      authData.byteOffset + offset,
      2
    ).getUint16(0);
    offset += 2;
    credentialId = authData.slice(offset, offset + credLen);
    offset += credLen;
    const pkStart = offset;
    const [, pkOffset] = decodeCbor(authData, offset);
    credentialPublicKeyBytes = authData.slice(pkStart, pkOffset);
  } else if (requireCredential) {
    throw new Error("缺少凭证数据");
  }

  return {
    rpIdHash,
    flags,
    signCount,
    credentialId,
    credentialPublicKeyBytes,
    userPresent,
    userVerified,
  };
}

function parseClientData(
  clientDataB64: string,
  expectedType: "webauthn.create" | "webauthn.get",
  expectedChallenge: string,
  expectedOrigin: string
) {
  const rawBytes = base64UrlDecode(clientDataB64);
  const decoded = JSON.parse(
    new TextDecoder().decode(rawBytes)
  ) as Record<string, unknown>;

  if (decoded.type !== expectedType) {
    throw new Error("clientData 类型不匹配");
  }

  const challenge = ensureString(decoded.challenge);
  if (!challenge || !equalBytes(base64UrlDecode(challenge), base64UrlDecode(expectedChallenge))) {
    throw new Error("challenge 校验失败");
  }

  const origin = ensureString(decoded.origin);
  if (!origin || origin !== expectedOrigin) {
    throw new Error("origin 校验失败");
  }

  return { parsed: decoded, raw: decoded as any };
}

function ensureString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeBase64Url(input: string) {
  return input.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(input.length / 4) * 4,
    "="
  );
}

function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

async function sha256(data: Uint8Array | ArrayBuffer) {
  const subtle = getSubtle();
  const view =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  const result = await subtle.digest("SHA-256", copy.buffer);
  return new Uint8Array(result);
}

function getSubtle() {
  const subtle = (crypto as any).subtle || (crypto as any).webcrypto?.subtle;
  if (!subtle) throw new Error("当前环境不支持 WebCrypto");
  return subtle as SubtleCrypto;
}

function decodeCbor(data: Uint8Array, offset = 0): [any, number] {
  const initial = data[offset];
  if (initial === undefined) throw new Error("CBOR 数据不完整");
  const majorType = initial >> 5;
  const additional = initial & 0x1f;
  offset += 1;

  const { length, offset: newOffset } = decodeLength(additional, data, offset);
  offset = newOffset;

  switch (majorType) {
    case 0:
      return [length, offset];
    case 1:
      return [-(length + 1), offset];
    case 2: {
      const value = data.slice(offset, offset + length);
      return [value, offset + length];
    }
    case 3: {
      const value = new TextDecoder().decode(data.slice(offset, offset + length));
      return [value, offset + length];
    }
    case 4: {
      const arr = [];
      let innerOffset = offset;
      for (let i = 0; i < length; i++) {
        const [val, next] = decodeCbor(data, innerOffset);
        arr.push(val);
        innerOffset = next;
      }
      return [arr, innerOffset];
    }
    case 5: {
      const obj: Record<string | number, unknown> = {};
      let innerOffset = offset;
      for (let i = 0; i < length; i++) {
        const [key, afterKey] = decodeCbor(data, innerOffset);
        const [val, afterVal] = decodeCbor(data, afterKey);
        obj[key as any] = val;
        innerOffset = afterVal;
      }
      return [obj, innerOffset];
    }
    case 6:
      return decodeCbor(data, offset);
    case 7:
      if (additional === 20) return [false, offset];
      if (additional === 21) return [true, offset];
      if (additional === 22) return [null, offset];
      if (additional === 23) return [undefined, offset];
      if (additional === 24) {
        const simple = data[offset];
        return [simple, offset + 1];
      }
      if (additional === 25) {
        const view = new DataView(data.buffer, data.byteOffset + offset, 2);
        return [view.getUint16(0), offset + 2];
      }
      if (additional === 26) {
        const view = new DataView(data.buffer, data.byteOffset + offset, 4);
        return [view.getUint32(0), offset + 4];
      }
      if (additional === 27) {
        const view = new DataView(data.buffer, data.byteOffset + offset, 8);
        return [Number(view.getBigUint64(0)), offset + 8];
      }
      throw new Error("不支持的 CBOR 数据类型");
    default:
      throw new Error("未知的 CBOR 主类型");
  }
}

function decodeLength(additional: number, data: Uint8Array, offset: number) {
  if (additional < 24) {
    return { length: additional, offset };
  }
  if (additional === 24) {
    return { length: data[offset], offset: offset + 1 };
  }
  if (additional === 25) {
    const view = new DataView(data.buffer, data.byteOffset + offset, 2);
    return { length: view.getUint16(0), offset: offset + 2 };
  }
  if (additional === 26) {
    const view = new DataView(data.buffer, data.byteOffset + offset, 4);
    return { length: view.getUint32(0), offset: offset + 4 };
  }
  if (additional === 27) {
    const view = new DataView(data.buffer, data.byteOffset + offset, 8);
    return { length: Number(view.getBigUint64(0)), offset: offset + 8 };
  }
  throw new Error("不支持的 CBOR 长度类型");
}

async function importCosePublicKey(cose: Record<string | number, unknown>, alg?: number) {
  const kty = Number(cose[1]);
  const resolvedAlg = typeof alg === "number" ? alg : Number(cose[3]);

  if (kty === 2 && resolvedAlg === -7) {
    const x = toUint8Array(cose[-2]);
    const y = toUint8Array(cose[-3]);
    const jwk: JsonWebKey = {
      kty: "EC",
      crv: "P-256",
      x: base64UrlEncode(x),
      y: base64UrlEncode(y),
      ext: true,
    };
    return await getSubtle().importKey(
      "jwk",
      jwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  }

  if (kty === 3 && resolvedAlg === -257) {
    const n = toUint8Array(cose[-1]);
    const e = toUint8Array(cose[-2]);
    const jwk: JsonWebKey = {
      kty: "RSA",
      n: base64UrlEncode(n),
      e: base64UrlEncode(e),
      alg: "RS256",
      ext: true,
    };
    return await getSubtle().importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  }

  throw new Error("暂不支持的公钥算法");
}

function mapAlgToVerifyParams(alg: number) {
  if (alg === -7) {
    return { name: "ECDSA", hash: "SHA-256" };
  }
  if (alg === -257) {
    return { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" };
  }
  return { name: "ECDSA", hash: "SHA-256" };
}

function toUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return new Uint8Array(data);
  if (typeof data === "string") return base64UrlDecode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data && typeof (data as any).buffer === "object") {
    const view = data as { buffer: ArrayBuffer; byteOffset?: number; byteLength?: number };
    return new Uint8Array(
      view.buffer,
      (view.byteOffset as number) || 0,
      (view.byteLength as number) || undefined
    );
  }
  throw new Error("无法解析的二进制数据");
}

function derToRaw(der: Uint8Array, size = 32) {
  if (der[0] !== 0x30) return der;
  let offset = 2;
  if (der[1] & 0x80) {
    const lenBytes = der[1] & 0x7f;
    offset = 2 + lenBytes;
  }
  if (der[offset] !== 0x02) return der;
  const rLen = der[offset + 1];
  const rStart = offset + 2;
  if (der[rStart + rLen] !== 0x02) return der;
  const sLen = der[rStart + rLen + 1];
  const sStart = rStart + rLen + 2;
  const r = der.slice(rStart, rStart + rLen);
  const s = der.slice(sStart, sStart + sLen);
  const rPadded = new Uint8Array(size);
  const sPadded = new Uint8Array(size);
  rPadded.set(r.slice(-size), size - Math.min(size, r.length));
  sPadded.set(s.slice(-size), size - Math.min(size, s.length));
  const out = new Uint8Array(size * 2);
  out.set(rPadded, 0);
  out.set(sPadded, size);
  return out;
}

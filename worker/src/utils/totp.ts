const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const BASE32_LOOKUP: Record<string, number> = {};
for (let i = 0; i < BASE32_ALPHABET.length; i++) {
  BASE32_LOOKUP[BASE32_ALPHABET[i]] = i;
}

const DEFAULT_DIGITS = 6;
const DEFAULT_PERIOD = 30;

function sanitizeSecret(secret: string): string {
  return secret.toUpperCase().replace(/[^A-Z2-7]/g, "");
}

export function generateTotpSecret(length = 32): string {
  if (length <= 0) {
    throw new Error("Invalid secret length");
  }
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  let output = "";
  for (let i = 0; i < length; i++) {
    output += BASE32_ALPHABET[randomValues[i] % BASE32_ALPHABET.length];
  }
  return output;
}

function base32Decode(secret: string): Uint8Array {
  const cleaned = sanitizeSecret(secret);
  if (!cleaned) {
    return new Uint8Array();
  }
  let buffer = 0;
  let bitsLeft = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const value = BASE32_LOOKUP[char];
    if (value === undefined) continue;
    buffer = (buffer << 5) | value;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      bytes.push((buffer >> (bitsLeft - 8)) & 0xff);
      bitsLeft -= 8;
    }
  }

  return new Uint8Array(bytes);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function counterToBuffer(counter: number): ArrayBuffer {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  const high = Math.floor(counter / 0x100000000);
  const low = counter % 0x100000000;
  view.setUint32(0, high, false);
  view.setUint32(4, low, false);
  return buffer;
}

async function hotp(secretBytes: Uint8Array, counter: number, digits = DEFAULT_DIGITS): Promise<string> {
  if (!secretBytes.length) {
    throw new Error("Invalid TOTP secret");
  }
  const secretBuffer = secretBytes.buffer.slice(
    secretBytes.byteOffset,
    secretBytes.byteOffset + secretBytes.byteLength
  ) as ArrayBuffer;
  const key = await crypto.subtle.importKey(
    "raw",
    secretBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const counterBuffer = counterToBuffer(counter);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBuffer));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, "0");
}

export async function generateTotpCode(secret: string, timestamp = Date.now()): Promise<string> {
  const counter = Math.floor(timestamp / 1000 / DEFAULT_PERIOD);
  return hotp(base32Decode(secret), counter, DEFAULT_DIGITS);
}

export async function verifyTotpCode(
  secret: string,
  code: string,
  window = 1,
  timestamp = Date.now()
): Promise<boolean> {
  if (!code) return false;
  const normalized = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(normalized)) {
    return false;
  }

  const secretBytes = base32Decode(secret);
  if (!secretBytes.length) return false;
  const currentCounter = Math.floor(timestamp / 1000 / DEFAULT_PERIOD);

  for (let offset = -window; offset <= window; offset++) {
    const counter = currentCounter + offset;
    if (counter < 0) continue;
    const candidate = await hotp(secretBytes, counter, DEFAULT_DIGITS);
    if (timingSafeEqual(candidate, normalized)) {
      return true;
    }
  }

  return false;
}

export function createOtpAuthURL({
  secret,
  accountName,
  issuer,
}: {
  secret: string;
  accountName: string;
  issuer: string;
}): string {
  const encodedLabel = encodeURIComponent(`${issuer}:${accountName}`);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${encodedLabel}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${DEFAULT_DIGITS}&period=${DEFAULT_PERIOD}`;
}

export function generateBackupCodes(count = 8, length = 10): string[] {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let code = "";
    const randomValues = new Uint8Array(length);
    crypto.getRandomValues(randomValues);
    for (let j = 0; j < length; j++) {
      code += chars[randomValues[j] % chars.length];
    }
    codes.push(code);
  }
  return codes;
}

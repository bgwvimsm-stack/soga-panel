const textEncoder = new TextEncoder();

export const isPasskeySupported = () =>
  typeof window !== "undefined" &&
  typeof window.PublicKeyCredential !== "undefined" &&
  typeof window.navigator?.credentials?.get === "function" &&
  typeof window.navigator?.credentials?.create === "function";

export const base64UrlEncode = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const base64UrlDecode = (input: string) => {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
};

export const serializeAssertion = (cred: PublicKeyCredential) => {
  const response = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: base64UrlEncode(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: base64UrlEncode(response.clientDataJSON),
      authenticatorData: base64UrlEncode(response.authenticatorData),
      signature: base64UrlEncode(response.signature),
      userHandle: response.userHandle ? base64UrlEncode(response.userHandle) : null
    }
  };
};

export const serializeAttestation = (cred: PublicKeyCredential) => {
  const response = cred.response as AuthenticatorAttestationResponse & { getPublicKey?: () => ArrayBuffer };
  return {
    id: cred.id,
    rawId: base64UrlEncode(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: base64UrlEncode(response.clientDataJSON),
      attestationObject: base64UrlEncode(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : undefined,
      publicKey:
        typeof response.getPublicKey === "function" ? base64UrlEncode(response.getPublicKey() as ArrayBuffer) : undefined
    }
  };
};

export const buildCredentialRequestOptions = (payload: {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: string;
  allowCredentials?: Array<{ id: string; type: PublicKeyCredentialType; transports?: AuthenticatorTransport[] }>;
}): PublicKeyCredentialRequestOptions => ({
  challenge: base64UrlDecode(payload.challenge),
  rpId: payload.rpId,
  timeout: payload.timeout,
  userVerification: payload.userVerification as UserVerificationRequirement,
  allowCredentials: (payload.allowCredentials || []).map((c) => ({
    id: base64UrlDecode(c.id),
    type: c.type,
    transports: c.transports
  }))
});

export const buildCredentialCreationOptions = (payload: any): PublicKeyCredentialCreationOptions => ({
  challenge: base64UrlDecode(payload.challenge),
  rp: payload.rp,
  user: {
    id: base64UrlDecode(payload.user?.id),
    name: payload.user?.name,
    displayName: payload.user?.displayName
  },
  pubKeyCredParams: payload.pubKeyCredParams,
  timeout: payload.timeout,
  attestation: payload.attestation,
  authenticatorSelection: payload.authenticatorSelection,
  excludeCredentials: (payload.excludeCredentials || []).map((c: any) => ({
    id: base64UrlDecode(c.id),
    type: c.type,
    transports: c.transports
  }))
});

export const performPasskeyLogin = async (payload: any) => {
  const options = buildCredentialRequestOptions(payload);
  const credential = (await navigator.credentials.get({ publicKey: options })) as PublicKeyCredential | null;
  if (!credential) throw new Error("未获取到通行密钥凭证");
  return serializeAssertion(credential);
};

export const performPasskeyRegistration = async (payload: any) => {
  const options = buildCredentialCreationOptions(payload);
  const credential = (await navigator.credentials.create({ publicKey: options })) as PublicKeyCredential | null;
  if (!credential) throw new Error("未获取到通行密钥凭证");
  return serializeAttestation(credential);
};

export const hashEmailForDefaultDeviceName = (email: string) => {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return "我的通行密钥";
  const hash = crypto.subtle ? crypto.subtle : null;
  const fallback = normalized.replace(/@.*/, "");
  if (!hash) return `${fallback || "我的"}的通行密钥`;
  return `${fallback || "我的"}的通行密钥`;
};

import speakeasy from "speakeasy";
import qrcode from "qrcode";

type OtpAuthParams = {
  secret: string;
  accountName: string;
  issuer: string;
};

export function generateTotpSecret(length = 32): string {
  return speakeasy.generateSecret({ length }).base32;
}

export function verifyTotpCode(secret: string, token: string): boolean {
  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1
  });
}

export function createOtpAuthURL({ secret, accountName, issuer }: OtpAuthParams): string {
  return speakeasy.otpauthURL({
    secret,
    label: accountName,
    issuer,
    encoding: "base32"
  });
}

export async function generateQrDataURL(otpAuthUrl: string): Promise<string> {
  return await qrcode.toDataURL(otpAuthUrl);
}

export function generateBackupCodes(count = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const num = Math.floor(Math.random() * 1_000_0000)
      .toString()
      .padStart(7, "0");
    codes.push(num);
  }
  return codes;
}

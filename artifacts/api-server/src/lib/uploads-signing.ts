import crypto from "crypto";

const EXPIRY_SECONDS = 15 * 60; // 15 minutes

/**
 * Generate a short-lived signed URL for serving a stored upload to Sarah.
 * The token is HMAC-SHA256(secret, "<uploadId>:<expires>") in hex.
 * Never store this URL — regenerate it at dispatch time.
 */
export function generateSignedUploadUrl(
  uploadId: string,
  baseUrl: string,
  secret: string,
): string {
  const expires = Math.floor(Date.now() / 1000) + EXPIRY_SECONDS;
  const token = signToken(uploadId, expires, secret);
  return `${baseUrl}/api/uploads/${uploadId}/file?token=${token}&expires=${expires}`;
}

export function signToken(uploadId: string, expires: number, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${uploadId}:${expires}`)
    .digest("hex");
}

export function verifySignedToken(
  uploadId: string,
  token: string,
  expires: number,
  secret: string,
): boolean {
  if (Math.floor(Date.now() / 1000) > expires) return false; // expired
  const expected = signToken(uploadId, expires, secret);
  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/**
 * Resolve the public base URL of this API server.
 * Tries CERTEFFICIENCY_PUBLIC_URL, then REPLIT_DEV_DOMAIN, else localhost.
 */
export function getPublicBaseUrl(): string {
  if (process.env.CERTEFFICIENCY_PUBLIC_URL) {
    return process.env.CERTEFFICIENCY_PUBLIC_URL.replace(/\/$/, "");
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return "http://localhost:8080";
}

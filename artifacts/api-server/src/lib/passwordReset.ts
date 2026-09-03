import crypto from "node:crypto";
import { getPublicBaseUrl } from "./publicUrl";

export function createPasswordResetToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("base64url");
  return { rawToken, tokenHash: hashPasswordResetToken(rawToken) };
}

export function hashPasswordResetToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export async function sendPasswordResetEmail(email: string, rawToken: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PASSWORD_RESET_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Password reset email delivery is not configured");
  }

  const resetUrl = new URL("/auth/reset-password", getPublicBaseUrl());
  resetUrl.searchParams.set("token", rawToken);

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Reset your CertEfficiency password",
      text: `Use this link to reset your password. It expires in one hour:\n\n${resetUrl.toString()}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Password reset email provider returned HTTP ${response.status}`);
  }
}

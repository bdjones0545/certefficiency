import crypto from "crypto";
import { MockSarahService } from "./mock";
import { TunnelSarahService } from "./tunnel";
import type { SarahService } from "./interface";
import { logger } from "../logger";

export type { SarahService };
export * from "./interface";

const provider = (process.env.SARAH_PROVIDER || "mock").toLowerCase().trim();
const useTunnel = provider !== "mock" && provider !== "";

/** First 12 hex chars of SHA-256(value). Safe to log — not reversible. */
function fingerprint(value: string): string {
  if (!value) return "(not-set)";
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}

let sarahService: SarahService;

if (useTunnel) {
  const tunnelUrl = process.env.SARAH_TUNNEL_URL || "";
  const apiKey = process.env.SARAH_API_KEY || "";
  const signingSecret = process.env.SARAH_SIGNING_SECRET || "";
  const timeoutMs = parseInt(process.env.SARAH_TIMEOUT_MS || "120000", 10);

  let tunnelHost: string | null = null;
  try { tunnelHost = tunnelUrl ? new URL(tunnelUrl).hostname : null; } catch { tunnelHost = tunnelUrl || null; }

  logger.info({
    provider: "tunnel",
    processStartTime: new Date().toISOString(),
    sarahTunnelHost: tunnelHost,
    sarahTimeoutMs: timeoutMs,
    sarahApiKeyLoaded: !!apiKey,
    sarahApiKeyFingerprint: fingerprint(apiKey),
    sarahSigningSecretLoaded: !!signingSecret,
    sarahSigningSecretFingerprint: fingerprint(signingSecret),
  }, "Sarah provider configuration");

  sarahService = new TunnelSarahService();
} else {
  logger.info({ provider: "mock", sarahApiKeyLoaded: false, sarahSigningSecretLoaded: false }, "Sarah provider configuration");
  sarahService = new MockSarahService();
}

export const sarah = sarahService;

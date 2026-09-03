import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";

export interface StripeCredentials {
  secretKey: string;
  webhookSecret: string;
  source: "environment" | "replit-connector";
}

interface ReplitConnectionResponse {
  items?: Array<{
    settings?: Record<string, unknown>;
  }>;
}

function validateCredentials(
  secretKey: unknown,
  webhookSecret: unknown,
  source: StripeCredentials["source"],
): StripeCredentials {
  if (
    typeof secretKey !== "string" ||
    (!secretKey.startsWith("sk_") && !secretKey.startsWith("rk_"))
  ) {
    throw new Error(`Stripe ${source} secret key is missing or malformed`);
  }

  if (
    typeof webhookSecret !== "string" ||
    !webhookSecret.startsWith("whsec_")
  ) {
    throw new Error(`Stripe ${source} webhook secret is missing or malformed`);
  }

  return { secretKey, webhookSecret, source };
}

/**
 * Resolves Stripe credentials for both published deployments and the Replit
 * workspace. Explicit deployment secrets are preferred; the connector API is
 * retained as a fallback for existing Replit environments.
 */
export async function getStripeCredentials(): Promise<StripeCredentials> {
  const environmentSecretKey = process.env.STRIPE_SECRET_KEY;
  const environmentWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (environmentSecretKey || environmentWebhookSecret) {
    return validateCredentials(
      environmentSecretKey,
      environmentWebhookSecret,
      "environment",
    );
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      "Missing Replit environment variables. " +
        "Ensure the Stripe integration is connected via the Integrations tab.",
    );
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!resp.ok) {
    throw new Error(`Failed to fetch Stripe credentials: ${resp.status} ${resp.statusText}`);
  }

  const data = (await resp.json()) as ReplitConnectionResponse;
  const settings = data.items?.[0]?.settings;

  return validateCredentials(
    settings?.secret,
    settings?.webhook_secret,
    "replit-connector",
  );
}

/** Resolve and validate the one public webhook endpoint Stripe should call. */
export function getStripeWebhookUrl(): string | null {
  const explicitUrl = process.env.STRIPE_WEBHOOK_URL;
  const publicBaseUrl = process.env.CERTEFFICIENCY_PUBLIC_URL;
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  const candidate = explicitUrl
    ? explicitUrl
    : publicBaseUrl
      ? `${publicBaseUrl.replace(/\/$/, "")}/api/stripe/webhook`
      : replitDomain
        ? `https://${replitDomain}/api/stripe/webhook`
        : null;

  if (!candidate) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("Stripe webhook URL configuration is invalid");
  }

  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("Stripe webhook URL must use HTTPS in production");
  }

  if (parsed.pathname !== "/api/stripe/webhook" || parsed.search || parsed.hash) {
    throw new Error("Stripe webhook URL must end at /api/stripe/webhook");
  }

  return parsed.toString();
}

/**
 * Returns a fresh authenticated Stripe client.
 * Not cached — fetches credentials on every call so rotated keys are picked up.
 */
export async function getUncachableStripeClient(): Promise<Stripe> {
  const { secretKey } = await getStripeCredentials();
  return new Stripe(secretKey);
}

/**
 * Returns a fresh StripeSync instance for webhook processing and data sync.
 * Not cached — fetches credentials on every call so rotated keys are picked up.
 */
export async function getStripeSync(): Promise<StripeSync> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const { secretKey, webhookSecret } = await getStripeCredentials();
  return new StripeSync({
    poolConfig: { connectionString: databaseUrl },
    stripeSecretKey: secretKey,
    stripeWebhookSecret: webhookSecret,
  });
}

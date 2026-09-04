import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ---------------------------------------------------------------------------
// Startup logging (spec-required fields)
// ---------------------------------------------------------------------------
import { createHash } from "crypto";

const processStartTime = new Date().toISOString();
const sarahApiKey = process.env.SARAH_API_KEY || "";
const sarahSigningSecret = process.env.SARAH_SIGNING_SECRET || "";
const sarahTunnelHost = process.env.SARAH_TUNNEL_URL
  ? new URL(process.env.SARAH_TUNNEL_URL).hostname
  : null;
const sarahTimeoutMs = 120_000;

function fingerprint(s: string): string {
  return s ? createHash("sha256").update(s).digest("hex").slice(0, 12) : "";
}

logger.info({
  processStartTime,
  sarahTunnelHost,
  sarahTimeoutMs,
  sarahApiKeyLoaded: !!sarahApiKey,
  sarahApiKeyFingerprint: fingerprint(sarahApiKey),
  sarahSigningSecretLoaded: !!sarahSigningSecret,
  sarahSigningSecretFingerprint: fingerprint(sarahSigningSecret),
}, "server_starting");

// ---------------------------------------------------------------------------
// Stripe initialization — runs in background; server starts even if Stripe
// is temporarily unavailable (e.g. during dev without credentials).
// ---------------------------------------------------------------------------
async function initStripe(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.warn("DATABASE_URL not set — skipping Stripe initialization");
    return;
  }

  try {
    const { runMigrations } = await import("stripe-replit-sync");
    logger.info("stripe_migrations_started");
    // stripe-replit-sync always owns and migrates its `stripe` schema.
    await runMigrations({ databaseUrl });
    logger.info("stripe_schema_ready");

    const { getStripeSync, getStripeWebhookUrl } = await import(
      "./lib/stripeClient"
    );
    const stripeSync = await getStripeSync();

    const webhookUrl = getStripeWebhookUrl();
    if (webhookUrl) {
      await stripeSync.findOrCreateManagedWebhook(webhookUrl);
      logger.info({ webhookUrl }, "stripe_webhook_configured");
    } else {
      logger.warn(
        "No Stripe webhook URL could be resolved; set STRIPE_WEBHOOK_URL or CERTEFFICIENCY_PUBLIC_URL",
      );
    }

    // Backfill in background — non-blocking
    stripeSync
      .syncBackfill()
      .then(() => logger.info("stripe_backfill_complete"))
      .catch((err: unknown) => logger.error({ err }, "stripe_backfill_error"));

    logger.info("stripe_init_complete");
  } catch (err: unknown) {
    // Non-fatal in development where Stripe may not be connected
    logger.error({ err }, "stripe_init_error");
  }
}

// Start Stripe init in background (don't await — server should start immediately)
initStripe();

// ---------------------------------------------------------------------------
// Sarah / Hermes configuration check
//
// In tunnel mode, warn loudly at startup if any required secrets are missing.
// This surfaces misconfiguration before the first request fails, not during
// a live session.  In production, missing secrets are a hard failure (the
// TunnelSarahService constructor throws, which is caught here).
// ---------------------------------------------------------------------------
const sarahProvider = (process.env.SARAH_PROVIDER || "mock").toLowerCase().trim();
if (sarahProvider !== "mock") {
  const missing: string[] = [];
  if (!process.env.SARAH_TUNNEL_URL)    missing.push("SARAH_TUNNEL_URL");
  if (!process.env.SARAH_API_KEY)       missing.push("SARAH_API_KEY");
  if (!process.env.SARAH_SIGNING_SECRET) missing.push("SARAH_SIGNING_SECRET");

  if (missing.length > 0) {
    const msg = `Sarah tunnel is active but these Secrets are not set: ${missing.join(", ")}. ` +
                "Sarah integration will be unavailable until they are configured.";
    if (process.env.NODE_ENV === "production") {
      // Hard-fail: tunnel mode + production + missing required secrets = unbootable
      logger.error({ missing }, msg);
      process.exit(1);
    } else {
      logger.warn({ missing }, msg);
    }
  } else {
    logger.info({ sarahProvider }, "sarah_tunnel_config_ok");
  }
} else {
  logger.info({ sarahProvider }, "sarah_mock_provider_active");
}

// ---------------------------------------------------------------------------
// R2 configuration check — warn early so misconfiguration is visible at boot.
// The server continues running so Stripe, auth, and GCS paths still work.
// ---------------------------------------------------------------------------
import { validateR2Config } from "./lib/r2Storage.js";
if (validateR2Config()) {
  logger.info("r2_config_ok");
} else {
  logger.warn(
    {
      hint: "Add CLOUDFLARE_R2_ACCOUNT_ID, CLOUDFLARE_R2_ACCESS_KEY_ID, " +
            "CLOUDFLARE_R2_SECRET_ACCESS_KEY, CLOUDFLARE_R2_BUCKET to Replit Secrets",
    },
    "r2_config_missing — R2 video playback will be unavailable until configured",
  );
}

// ---------------------------------------------------------------------------
// Upload storage check — production refuses to keep uploads on local disk,
// because an autoscale instance's filesystem does not survive a redeploy.
//
// Warn loudly at boot rather than exiting: uploads being unavailable should not
// take down chat, auth and payments with them. Without this the only symptom
// was a bare 500 on every upload, with nothing naming the cause.
// ---------------------------------------------------------------------------
import { uploadsStorageUnavailableReason } from "./routes/uploads.js";
const _uploadsStorageIssue = uploadsStorageUnavailableReason();
if (_uploadsStorageIssue) {
  logger.error(
    {
      reason: _uploadsStorageIssue,
      hint: "Set PRIVATE_OBJECT_DIR in the DEPLOYMENT's Secrets (not only the " +
            "workspace's) to the private object-storage directory",
    },
    "uploads_storage_misconfigured — every upload will be refused with 503 until configured",
  );
} else {
  logger.info("uploads_storage_ok");
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

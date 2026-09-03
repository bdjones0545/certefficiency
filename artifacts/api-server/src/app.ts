import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  classifyStripeWebhookError,
  WebhookHandlers,
} from "./lib/webhookHandlers";

const app: Express = express();

app.set("trust proxy", 1);

// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

// Logging
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

// CORS — lock down in production; allow all origins in dev only.
// In production, ALLOWED_ORIGINS must be an explicit comma-separated list.
const _isProd = process.env.NODE_ENV === "production";
const _allowedOrigins = process.env.ALLOWED_ORIGINS;

/**
 * Parse and validate each entry in the ALLOWED_ORIGINS comma-separated list.
 *
 * Rejected values (any one causes a startup failure in production):
 *   • Wildcards ("*" or anything containing "*")
 *   • Origins with a path component ("/anything")
 *   • Origins with a query or fragment (?x=y, #section)
 *   • Non-HTTPS origins in production (http:// only allowed for localhost in dev)
 *   • Malformed values that don't parse as a URL
 *
 * The resulting array is passed to cors() for exact-string matching —
 * express-cors never performs substring or suffix matching on an array.
 */
function parseAndValidateOrigins(raw: string, isProd: boolean): string[] {
  const entries = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) {
    throw new Error(
      "FATAL: ALLOWED_ORIGINS is set but contains no valid entries.",
    );
  }

  const validated: string[] = [];

  for (const entry of entries) {
    // Reject wildcard immediately — substring check catches "*" and "*.example.com"
    if (entry.includes("*")) {
      throw new Error(
        `FATAL: ALLOWED_ORIGINS entry "${entry}" contains a wildcard. ` +
          "Wildcard origins are not permitted for authenticated APIs.",
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(entry);
    } catch {
      throw new Error(
        `FATAL: ALLOWED_ORIGINS entry "${entry}" is not a valid URL.`,
      );
    }

    // Only allow exact scheme+host+port — no path, query, or fragment
    const canonical = `${parsed.protocol}//${parsed.host}`;
    if (entry !== canonical) {
      throw new Error(
        `FATAL: ALLOWED_ORIGINS entry "${entry}" must be an exact origin ` +
          `(scheme + host only, no path/query/fragment). Expected: "${canonical}"`,
      );
    }

    // In production, require HTTPS for non-localhost origins
    if (isProd && parsed.protocol !== "https:") {
      throw new Error(
        `FATAL: ALLOWED_ORIGINS entry "${entry}" uses "${parsed.protocol}" ` +
          "which is not allowed in production. All origins must use https://.",
      );
    }

    validated.push(canonical);
  }

  return validated;
}

if (_isProd && !_allowedOrigins) {
  throw new Error(
    "FATAL: ALLOWED_ORIGINS must be set in production. " +
      "Set a comma-separated list of allowed origins (e.g. https://certefficiency.com) " +
      "in Replit Secrets.",
  );
}

const _parsedOrigins = _allowedOrigins
  ? parseAndValidateOrigins(_allowedOrigins, _isProd)
  : null;

if (_parsedOrigins) {
  logger.info({ allowedOrigins: _parsedOrigins }, "cors_origins_configured");
}

app.use(
  cors({
    origin: _parsedOrigins ?? true,
    credentials: true,
  }),
);

// Global rate limit
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 min
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, please slow down." },
  }),
);

// Auth-specific rate limit (stricter)
app.use(
  ["/api/auth/login", "/api/auth/register", "/api/auth/forgot-password"],
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Too many authentication attempts, please try again later.",
    },
  }),
);

// Conversation creation — prevents rapid new-conversation spam.
// IMPORTANT: skip must be applied so that only POST /api/conversations
// (new conversation creation) is counted.  GET requests to /api/conversations
// and all sub-paths (/api/conversations/:id/messages, etc.) must NOT consume
// this budget — they fire continuously during normal chat and would exhaust
// max:20 after just a few message exchanges, producing 429s mid-conversation.
// Message sends have their own dedicated 120/15-min limiter below.
app.use(
  "/api/conversations",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    skip: (req) => {
      // req.originalUrl is always the full path even inside app.use() mounts.
      const path = req.originalUrl.split("?")[0];
      // Only count new-conversation POSTs; skip everything else.
      return !(req.method === "POST" && /^\/api\/conversations\/?$/.test(path));
    },
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many conversations created. Please slow down." },
  }),
);

// Message sending — prevents automated message floods while allowing
// normal multi-turn tutoring sessions (120 messages per 15 min ≈ 8/min)
app.use(
  /^\/api\/conversations\/[^/]+\/messages$/,
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many messages sent. Please slow down." },
  }),
);

// Retry endpoints — prevent retry storms
app.use(
  ["/api/messages/:id/retry", "/api/sarah/jobs/:id/retry"],
  rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many retry attempts. Please wait before retrying." },
  }),
);

// Upload rate limit — prevent attachment abuse
app.use(
  ["/api/uploads", "/api/uploads/images"],
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: "Too many uploads. Please wait before uploading more files.",
    },
  }),
);

// ---------------------------------------------------------------------------
// Stripe webhook — MUST be registered BEFORE express.json() so the raw Buffer
// body reaches the handler unmodified. Stripe signature verification requires
// the exact original bytes.
// ---------------------------------------------------------------------------
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response): Promise<void> => {
    const signature = req.headers["stripe-signature"];
    if (!signature) {
      res.status(400).json({ error: "Missing stripe-signature header" });
      return;
    }
    const sig = Array.isArray(signature) ? signature[0] : signature;
    try {
      await WebhookHandlers.processWebhook(req.body as Buffer, sig);
      res.status(200).json({ received: true });
    } catch (err: unknown) {
      logger.error({ err }, "stripe_webhook_error");
      const failure = classifyStripeWebhookError(err);
      res.status(failure.statusCode).json({ error: failure.message });
    }
  },
);

// ---------------------------------------------------------------------------
// Body parsing — registered AFTER the Stripe webhook route
// ---------------------------------------------------------------------------
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message =
    err instanceof Error ? err.message : "An unexpected error occurred";
  const status = (err as { status?: number }).status ?? 500;

  if (status >= 500) {
    logger.error({ err }, "Unhandled server error");
  }

  res.status(status).json({ error: message });
});

export default app;

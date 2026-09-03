import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStripeCredentials,
  getStripeWebhookUrl,
} from "../lib/stripeClient.js";

const ENV_KEYS = [
  "NODE_ENV",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_WEBHOOK_URL",
  "CERTEFFICIENCY_PUBLIC_URL",
  "REPLIT_DOMAINS",
  "REPLIT_CONNECTORS_HOSTNAME",
  "REPL_IDENTITY",
  "WEB_REPL_RENEWAL",
] as const;
const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

describe("Stripe production configuration", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_URL;
    delete process.env.CERTEFFICIENCY_PUBLIC_URL;
    delete process.env.REPLIT_DOMAINS;
    delete process.env.REPLIT_CONNECTORS_HOSTNAME;
    delete process.env.REPL_IDENTITY;
    delete process.env.WEB_REPL_RENEWAL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      const original = ORIGINAL_ENV[key];
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });

  it("prefers explicit deployment secrets without calling the Replit connector", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_example";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";

    await expect(getStripeCredentials()).resolves.toEqual({
      secretKey: "sk_live_example",
      webhookSecret: "whsec_example",
      source: "environment",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a partially configured deployment instead of silently falling back", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_example";

    await expect(getStripeCredentials()).rejects.toThrow(
      "Stripe environment webhook secret is missing or malformed",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("falls back to validated Replit connector credentials", async () => {
    process.env.REPLIT_CONNECTORS_HOSTNAME = "connectors.replit.test";
    process.env.REPL_IDENTITY = "identity-token";
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              settings: {
                secret: "sk_test_connector",
                webhook_secret: "whsec_connector",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );

    await expect(getStripeCredentials()).resolves.toEqual({
      secretKey: "sk_test_connector",
      webhookSecret: "whsec_connector",
      source: "replit-connector",
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://connectors.replit.test/api/v2/connection?include_secrets=true&connector_names=stripe",
      expect.objectContaining({
        headers: expect.objectContaining({
          X_REPLIT_TOKEN: "repl identity-token",
        }),
      }),
    );
  });

  it("uses the configured production base URL for the managed webhook", () => {
    process.env.NODE_ENV = "production";
    process.env.CERTEFFICIENCY_PUBLIC_URL = "https://www.certefficiency.com/";

    expect(getStripeWebhookUrl()).toBe(
      "https://www.certefficiency.com/api/stripe/webhook",
    );
  });

  it("rejects insecure production webhook URLs", () => {
    process.env.NODE_ENV = "production";
    process.env.STRIPE_WEBHOOK_URL =
      "http://www.certefficiency.com/api/stripe/webhook";

    expect(() => getStripeWebhookUrl()).toThrow(
      "Stripe webhook URL must use HTTPS in production",
    );
  });
});

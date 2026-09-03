import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  processSyncWebhook: vi.fn(),
  getStripeCredentials: vi.fn(),
  update: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: vi.fn(function StripeClient() {
    return { webhooks: { constructEvent: mocks.constructEvent } };
  }),
}));

vi.mock("../lib/stripeClient.js", () => ({
  getStripeCredentials: mocks.getStripeCredentials,
  getStripeSync: vi.fn(async () => ({
    processWebhook: mocks.processSyncWebhook,
  })),
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions) => ({ conditions })),
  eq: vi.fn((column, value) => ({ operator: "eq", column, value })),
}));

vi.mock("@workspace/db", () => ({
  db: { update: mocks.update },
  platformEnrollmentsTable: {
    id: "enrollments.id",
    stripeSessionId: "enrollments.stripeSessionId",
    paymentStatus: "enrollments.paymentStatus",
  },
  coursePurchasesTable: {
    id: "purchases.id",
    stripeSessionId: "purchases.stripeSessionId",
    paymentStatus: "purchases.paymentStatus",
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: mocks.loggerInfo, error: vi.fn(), warn: vi.fn() },
}));

function completedEvent(): Stripe.Event {
  return {
    id: "evt_completed",
    type: "checkout.session.completed",
    created: 1_700_000_000,
    data: {
      object: {
        id: "cs_test_123",
        payment_intent: "pi_test_123",
        metadata: { enrollmentId: "enrollment-123" },
      },
    },
  } as unknown as Stripe.Event;
}

function updateChain(
  returningResult: Array<{ id: string }> = [{ id: "updated" }],
) {
  const returning = vi.fn(async () => returningResult);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  return { set, where, returning };
}

describe("Stripe webhook processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getStripeCredentials.mockResolvedValue({
      secretKey: "sk_test",
      webhookSecret: "whsec_test",
    });
    mocks.constructEvent.mockReturnValue(completedEvent());
    mocks.processSyncWebhook.mockResolvedValue(undefined);
  });

  it("rejects an invalid signature before Stripe sync runs", async () => {
    const signatureError = new Error("bad signature");
    mocks.constructEvent.mockImplementation(() => {
      throw signatureError;
    });

    const { StripeWebhookVerificationError, WebhookHandlers } =
      await import("../lib/webhookHandlers.js");

    await expect(
      WebhookHandlers.processWebhook(Buffer.from("{}"), "bad"),
    ).rejects.toBeInstanceOf(StripeWebhookVerificationError);
    expect(mocks.processSyncWebhook).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("classifies only signature failures as 400 and retryable failures as 500", async () => {
    const { classifyStripeWebhookError, StripeWebhookVerificationError } =
      await import("../lib/webhookHandlers.js");

    expect(
      classifyStripeWebhookError(
        new StripeWebhookVerificationError(new Error("bad signature")),
      ),
    ).toEqual({ statusCode: 400, message: "Invalid webhook signature" });
    expect(classifyStripeWebhookError(new Error("database unavailable"))).toEqual(
      { statusCode: 500, message: "Webhook processing failed" },
    );
  });

  it("propagates application database failures so Stripe can retry", async () => {
    const databaseError = new Error("database unavailable");
    const chain = updateChain();
    chain.returning.mockRejectedValue(databaseError);
    mocks.update.mockReturnValue(chain);

    const { WebhookHandlers } = await import("../lib/webhookHandlers.js");

    await expect(
      WebhookHandlers.processWebhook(Buffer.from("{}"), "valid"),
    ).rejects.toBe(databaseError);
    expect(mocks.processSyncWebhook).toHaveBeenCalledOnce();
  });

  it("propagates Stripe sync failures without applying application updates", async () => {
    const syncError = new Error("Stripe sync unavailable");
    mocks.processSyncWebhook.mockRejectedValue(syncError);

    const { WebhookHandlers } = await import("../lib/webhookHandlers.js");

    await expect(
      WebhookHandlers.processWebhook(Buffer.from("{}"), "valid"),
    ).rejects.toBe(syncError);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("makes completion updates conditional on session identity and prior status", async () => {
    const chain = updateChain([]);
    mocks.update.mockReturnValue(chain);

    const { WebhookHandlers } = await import("../lib/webhookHandlers.js");
    await WebhookHandlers.handleApplicationEvent(completedEvent());

    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentStatus: "completed",
        courseAccess: true,
        stripePaymentIntentId: "pi_test_123",
        enrolledAt: new Date(1_700_000_000 * 1000),
      }),
    );
    expect(chain.where).toHaveBeenCalledWith({
      conditions: [
        { operator: "eq", column: "enrollments.id", value: "enrollment-123" },
        {
          operator: "eq",
          column: "enrollments.stripeSessionId",
          value: "cs_test_123",
        },
        {
          operator: "eq",
          column: "enrollments.paymentStatus",
          value: "pending",
        },
      ],
    });
  });

  it("does not report access granted when a duplicate event updates no rows", async () => {
    const chain = updateChain([]);
    mocks.update.mockReturnValue(chain);

    const { WebhookHandlers } = await import("../lib/webhookHandlers.js");
    await WebhookHandlers.handleApplicationEvent(completedEvent());

    expect(chain.returning).toHaveBeenCalledOnce();
    expect(mocks.loggerInfo).not.toHaveBeenCalledWith(
      expect.anything(),
      "platform_course_access_granted",
    );
  });
});

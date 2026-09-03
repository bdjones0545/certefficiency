import Stripe from "stripe";
import { getStripeSync, getStripeCredentials } from "./stripeClient";
import {
  db,
  coursePurchasesTable,
  platformEnrollmentsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

export class StripeWebhookVerificationError extends Error {
  constructor(cause: unknown) {
    super("Invalid Stripe webhook signature", { cause });
    this.name = "StripeWebhookVerificationError";
  }
}

export class WebhookHandlers {
  static async processWebhook(
    payload: Buffer,
    signature: string,
  ): Promise<void> {
    if (!Buffer.isBuffer(payload)) {
      throw new Error(
        "STRIPE WEBHOOK ERROR: Payload must be a Buffer. " +
          "Received type: " +
          typeof payload +
          ". " +
          "This usually means express.json() parsed the body before reaching this handler. " +
          "FIX: Ensure webhook route is registered BEFORE app.use(express.json()).",
      );
    }

    // Verify before starting any work. This also gives the HTTP layer a reliable
    // way to distinguish a bad request (400) from a retryable server failure (500).
    const { secretKey, webhookSecret } = await getStripeCredentials();
    if (!webhookSecret) {
      throw new Error("Stripe webhook secret is not configured");
    }

    const stripe = new Stripe(secretKey);
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    } catch (err: unknown) {
      throw new StripeWebhookVerificationError(err);
    }

    // 1. stripe-replit-sync syncs Stripe data to the stripe schema.
    // Any failure must escape so Stripe retries delivery.
    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    // 2. Handle application-level events (grant course access, etc.)
    await WebhookHandlers.handleApplicationEvent(event);
  }

  /**
   * Handle application-level events beyond stripe-replit-sync.
   *
   * These updates are deliberately idempotent: a completed event only transitions
   * a row that is not already completed, and an expired event only transitions a
   * pending row. The Stripe session ID must also match the row created at checkout.
   * Database failures are allowed to propagate so Stripe retries the event.
   */
  static async handleApplicationEvent(event: Stripe.Event): Promise<void> {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : null;
      const completedAt = new Date(event.created * 1000);

      // ── Platform course enrollment (new schema) ──
      const enrollmentId = session.metadata?.enrollmentId;
      if (enrollmentId) {
        const updated = await db
          .update(platformEnrollmentsTable)
          .set({
            paymentStatus: "completed",
            courseAccess: true,
            enrolledAt: completedAt,
            stripePaymentIntentId: paymentIntentId,
          })
          .where(
            and(
              eq(platformEnrollmentsTable.id, enrollmentId),
              eq(platformEnrollmentsTable.stripeSessionId, session.id),
              eq(platformEnrollmentsTable.paymentStatus, "pending"),
            ),
          )
          .returning({ id: platformEnrollmentsTable.id });
        if (updated.length > 0) {
          logger.info(
            { enrollmentId, sessionId: session.id },
            "platform_course_access_granted",
          );
        }
      }

      // ── Legacy CSCS course (old schema) ──
      const purchaseId = session.metadata?.purchaseId;
      if (purchaseId) {
        const updated = await db
          .update(coursePurchasesTable)
          .set({
            paymentStatus: "completed",
            courseAccess: true,
            purchaseDate: completedAt,
            stripePaymentIntentId: paymentIntentId,
          })
          .where(
            and(
              eq(coursePurchasesTable.id, purchaseId),
              eq(coursePurchasesTable.stripeSessionId, session.id),
              eq(coursePurchasesTable.paymentStatus, "pending"),
            ),
          )
          .returning({ id: coursePurchasesTable.id });
        if (updated.length > 0) {
          logger.info(
            { purchaseId, sessionId: session.id },
            "course_access_granted",
          );
        }
      }
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;

      const enrollmentId = session.metadata?.enrollmentId;
      if (enrollmentId) {
        await db
          .update(platformEnrollmentsTable)
          .set({ paymentStatus: "failed" })
          .where(
            and(
              eq(platformEnrollmentsTable.id, enrollmentId),
              eq(platformEnrollmentsTable.stripeSessionId, session.id),
              eq(platformEnrollmentsTable.paymentStatus, "pending"),
            ),
          );
      }

      const purchaseId = session.metadata?.purchaseId;
      if (purchaseId) {
        await db
          .update(coursePurchasesTable)
          .set({ paymentStatus: "failed" })
          .where(
            and(
              eq(coursePurchasesTable.id, purchaseId),
              eq(coursePurchasesTable.stripeSessionId, session.id),
              eq(coursePurchasesTable.paymentStatus, "pending"),
            ),
          );
      }
    }
  }
}

import Stripe from "stripe";
import { getStripeSync, getStripeCredentials } from "./stripeClient";
import { db, coursePurchasesTable, platformEnrollmentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

export class WebhookHandlers {
  static async processWebhook(payload: Buffer, signature: string): Promise<void> {
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

    // 1. stripe-replit-sync syncs Stripe data to the stripe schema
    const sync = await getStripeSync();
    await sync.processWebhook(payload, signature);

    // 2. Handle application-level events (grant course access, etc.)
    await WebhookHandlers.handleApplicationEvent(payload, signature);
  }

  /**
   * Parse and handle events that require application-level logic beyond stripe-replit-sync.
   * Non-fatal: errors here are logged but do not fail the webhook response.
   */
  static async handleApplicationEvent(payload: Buffer, signature: string): Promise<void> {
    try {
      const { secretKey, webhookSecret } = await getStripeCredentials();
      if (!webhookSecret) {
        logger.warn("No webhook secret configured — skipping application event handling");
        return;
      }

      const stripe = new Stripe(secretKey);
      const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);

      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;
        const paymentIntentId =
          typeof session.payment_intent === "string" ? session.payment_intent : null;

        // ── Platform course enrollment (new schema) ──
        const enrollmentId = session.metadata?.enrollmentId;
        if (enrollmentId) {
          await db
            .update(platformEnrollmentsTable)
            .set({
              paymentStatus: "completed",
              courseAccess: true,
              enrolledAt: new Date(),
              stripePaymentIntentId: paymentIntentId,
            })
            .where(eq(platformEnrollmentsTable.id, enrollmentId));
          logger.info({ enrollmentId, sessionId: session.id }, "platform_course_access_granted");
        }

        // ── Legacy CSCS course (old schema) ──
        const purchaseId = session.metadata?.purchaseId;
        if (purchaseId) {
          await db
            .update(coursePurchasesTable)
            .set({
              paymentStatus: "completed",
              courseAccess: true,
              purchaseDate: new Date(),
              stripePaymentIntentId: paymentIntentId,
            })
            .where(eq(coursePurchasesTable.id, purchaseId));
          logger.info({ purchaseId, sessionId: session.id }, "course_access_granted");
        }
      }

      if (event.type === "checkout.session.expired") {
        const session = event.data.object as Stripe.Checkout.Session;

        const enrollmentId = session.metadata?.enrollmentId;
        if (enrollmentId) {
          await db
            .update(platformEnrollmentsTable)
            .set({ paymentStatus: "failed" })
            .where(eq(platformEnrollmentsTable.id, enrollmentId));
        }

        const purchaseId = session.metadata?.purchaseId;
        if (purchaseId) {
          await db
            .update(coursePurchasesTable)
            .set({ paymentStatus: "failed" })
            .where(eq(coursePurchasesTable.id, purchaseId));
        }
      }
    } catch (err: unknown) {
      logger.error({ err }, "application_webhook_event_error");
      // Non-fatal — stripe-replit-sync already handled the sync
    }
  }
}

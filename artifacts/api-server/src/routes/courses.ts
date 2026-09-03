import { Router } from "express";
import { db, coursePurchasesTable, courseProgressTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, optionalAuth } from "../lib/auth";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { COURSES } from "../lib/courseData";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../lib/logger";
import { getPublicBaseUrl } from "../lib/publicUrl";

const router = Router();

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

// ---------------------------------------------------------------------------
// GET /courses/:courseId
// Returns course info. Video embed URLs gated by access.
// ---------------------------------------------------------------------------
router.get("/courses/:courseId", optionalAuth, async (req, res): Promise<void> => {
  const course = COURSES[routeParam(req.params.courseId)];
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  let hasAccess = false;
  if (req.userId) {
    const [purchase] = await db
      .select()
      .from(coursePurchasesTable)
      .where(
        and(
          eq(coursePurchasesTable.userId, req.userId),
          eq(coursePurchasesTable.courseId, course.id),
          eq(coursePurchasesTable.courseAccess, true),
        ),
      )
      .limit(1);
    hasAccess = !!purchase;
  }

  const lessons = course.lessons.map((lesson) => ({
    number: lesson.number,
    title: lesson.title,
    duration: lesson.duration,
    description: lesson.description,
    free: lesson.free,
    videoEmbedUrl: lesson.free || hasAccess ? lesson.videoEmbedUrl : null,
    locked: !lesson.free && !hasAccess,
  }));

  res.json({
    course: {
      id: course.id,
      title: course.title,
      subtitle: course.subtitle,
      description: course.description,
      priceUsd: course.priceUsd,
      lessons,
      hasAccess,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /courses/:courseId/access
// Check if the authenticated user has purchased this course.
// ---------------------------------------------------------------------------
router.get("/courses/:courseId/access", requireAuth, async (req, res): Promise<void> => {
  const course = COURSES[routeParam(req.params.courseId)];
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const [purchase] = await db
    .select()
    .from(coursePurchasesTable)
    .where(
      and(
        eq(coursePurchasesTable.userId, req.userId!),
        eq(coursePurchasesTable.courseId, course.id),
      ),
    )
    .limit(1);

  res.json({ hasAccess: purchase?.courseAccess ?? false, purchase: purchase ?? null });
});

// ---------------------------------------------------------------------------
// POST /courses/:courseId/checkout
// Create a Stripe Checkout Session for the course.
// ---------------------------------------------------------------------------
router.post("/courses/:courseId/checkout", requireAuth, async (req, res): Promise<void> => {
  const course = COURSES[routeParam(req.params.courseId)];
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  // Already purchased?
  const [existing] = await db
    .select()
    .from(coursePurchasesTable)
    .where(
      and(
        eq(coursePurchasesTable.userId, req.userId!),
        eq(coursePurchasesTable.courseId, course.id),
        eq(coursePurchasesTable.courseAccess, true),
      ),
    )
    .limit(1);

  if (existing) {
    res.json({ hasAccess: true, message: "Already purchased" });
    return;
  }

  const priceId = process.env.CSCS_COURSE_PRICE_ID;
  if (!priceId) {
    logger.error("CSCS_COURSE_PRICE_ID env var not set — run the seed-course-product script");
    res.status(503).json({
      error:
        "Course checkout is not yet configured. Please contact support.",
    });
    return;
  }

  const stripe = await getUncachableStripeClient();

  // Find or create Stripe customer
  let stripeCustomerId: string;
  const customers = await stripe.customers.list({ email: req.userEmail, limit: 1 });
  if (customers.data.length > 0) {
    stripeCustomerId = customers.data[0].id;
  } else {
    const customer = await stripe.customers.create({
      email: req.userEmail,
      metadata: { userId: req.userId! },
    });
    stripeCustomerId = customer.id;
  }

  // Create a pending purchase record so the webhook can find it
  const purchaseId = uuidv4();
  await db.insert(coursePurchasesTable).values({
    id: purchaseId,
    userId: req.userId!,
    courseId: course.id,
    stripeCustomerId,
    paymentStatus: "pending",
    courseAccess: false,
  });

  const baseUrl = getPublicBaseUrl();
  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    payment_method_types: ["card"],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: "payment",
    success_url: `${baseUrl}/course/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/video-course`,
    metadata: { userId: req.userId!, courseId: course.id, purchaseId },
    client_reference_id: req.userId,
  });

  // Store the session ID on the purchase record
  await db
    .update(coursePurchasesTable)
    .set({ stripeSessionId: session.id })
    .where(eq(coursePurchasesTable.id, purchaseId));

  logger.info({ purchaseId, sessionId: session.id, courseId: course.id }, "checkout_session_created");
  res.json({ url: session.url });
});

// ---------------------------------------------------------------------------
// POST /courses/:courseId/progress
// Update watch progress for a lesson. Marks complete at ≥90% watched.
// ---------------------------------------------------------------------------
router.post("/courses/:courseId/progress", requireAuth, async (req, res): Promise<void> => {
  const course = COURSES[routeParam(req.params.courseId)];
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const { lessonNumber, watchPercentage, completed } = req.body;

  if (
    typeof lessonNumber !== "number" ||
    !Number.isInteger(lessonNumber) ||
    lessonNumber < 1 ||
    lessonNumber > course.lessons.length
  ) {
    res.status(400).json({ error: "Invalid lesson number" });
    return;
  }

  if (
    watchPercentage !== undefined &&
    (typeof watchPercentage !== "number" ||
      !Number.isFinite(watchPercentage) ||
      watchPercentage < 0 ||
      watchPercentage > 100)
  ) {
    res.status(400).json({ error: "Watch percentage must be between 0 and 100" });
    return;
  }

  // Premium lessons require purchase
  if (lessonNumber > 1) {
    const [purchase] = await db
      .select()
      .from(coursePurchasesTable)
      .where(
        and(
          eq(coursePurchasesTable.userId, req.userId!),
          eq(coursePurchasesTable.courseId, course.id),
          eq(coursePurchasesTable.courseAccess, true),
        ),
      )
      .limit(1);
    if (!purchase) {
      res.status(403).json({ error: "Course not purchased" });
      return;
    }
  }

  const isCompleted = completed === true || (typeof watchPercentage === "number" && watchPercentage >= 90);

  const [existing] = await db
    .select()
    .from(courseProgressTable)
    .where(
      and(
        eq(courseProgressTable.userId, req.userId!),
        eq(courseProgressTable.courseId, course.id),
        eq(courseProgressTable.lessonNumber, lessonNumber),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(courseProgressTable)
      .set({
        watchPercentage: typeof watchPercentage === "number" ? watchPercentage : existing.watchPercentage,
        completed: isCompleted || existing.completed,
        lastWatchedAt: new Date(),
      })
      .where(eq(courseProgressTable.id, existing.id));
  } else {
    await db.insert(courseProgressTable).values({
      userId: req.userId!,
      courseId: course.id,
      lessonNumber,
      watchPercentage: typeof watchPercentage === "number" ? watchPercentage : 0,
      completed: isCompleted,
      lastWatchedAt: new Date(),
    });
  }

  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// GET /courses/:courseId/progress
// Get all lesson progress + summary stats for the authenticated user.
// ---------------------------------------------------------------------------
router.get("/courses/:courseId/progress", requireAuth, async (req, res): Promise<void> => {
  const course = COURSES[routeParam(req.params.courseId)];
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const progress = await db
    .select()
    .from(courseProgressTable)
    .where(
      and(
        eq(courseProgressTable.userId, req.userId!),
        eq(courseProgressTable.courseId, course.id),
      ),
    );

  const totalLessons = course.lessons.length;
  const completedLessons = progress.filter((p) => p.completed).length;
  const sorted = [...progress].sort(
    (a, b) => (b.lastWatchedAt?.getTime() ?? 0) - (a.lastWatchedAt?.getTime() ?? 0),
  );

  res.json({
    progress,
    stats: {
      completedLessons,
      totalLessons,
      percentage: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
      lastWatchedLesson: sorted[0]?.lessonNumber ?? null,
    },
  });
});

export default router;

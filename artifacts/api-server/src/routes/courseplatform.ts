import { Router } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  platformCoursesTable,
  platformLessonsTable,
  platformEnrollmentsTable,
  platformLessonProgressTable,
} from "@workspace/db";
import { requireAuth, optionalAuth } from "../lib/auth";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { objectStorageClient } from "../lib/objectStorage";
import { r2Storage, getR2Config } from "../lib/r2Storage";
import { logger } from "../lib/logger";
import { getPublicBaseUrl } from "../lib/publicUrl";

const router = Router();

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}

function buildHeygenUrl(videoId: string | undefined): string | null {
  if (!videoId) return null;
  return `https://video.heygen.com/embed/${videoId}`;
}

// ---------------------------------------------------------------------------
// Rate limiter — max 10 playback URL requests per userId per 60 seconds
// ---------------------------------------------------------------------------
const _playbackRateWindow = new Map<string, number[]>();

function checkPlaybackRateLimit(userId: string): boolean {
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = 10;
  const timestamps = (_playbackRateWindow.get(userId) ?? []).filter(
    (t) => now - t < windowMs,
  );
  if (timestamps.length >= maxRequests) return false; // deny
  timestamps.push(now);
  _playbackRateWindow.set(userId, timestamps);
  return true; // allow
}

/** Resolve a /objects/uploads/<uuid> path to a GCS File handle. */
function getGcsFile(videoObjectPath: string) {
  const privateDir = process.env.PRIVATE_OBJECT_DIR ?? "";
  const clean = privateDir.startsWith("/") ? privateDir.slice(1) : privateDir;
  const parts = clean.split("/");
  const bucketName = parts[0];
  const prefix = parts.slice(1).join("/");
  // objectPath looks like /objects/uploads/<uuid>
  const entityId = videoObjectPath.slice("/objects/".length); // "uploads/<uuid>"
  const objectName = prefix ? `${prefix}/${entityId}` : entityId;
  return objectStorageClient.bucket(bucketName).file(objectName);
}

// ---------------------------------------------------------------------------
// GET /platform/courses/:courseSlug
// Public course metadata + gated lesson video URLs
// ---------------------------------------------------------------------------
router.get("/platform/courses/:courseSlug", optionalAuth, async (req, res): Promise<void> => {
  const [course] = await db
    .select()
    .from(platformCoursesTable)
    .where(eq(platformCoursesTable.slug, routeParam(req.params.courseSlug)))
    .limit(1);

  if (!course || !course.published) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const lessons = await db
    .select()
    .from(platformLessonsTable)
    .where(eq(platformLessonsTable.courseId, course.id))
    .orderBy(platformLessonsTable.order);

  let hasAccess = false;
  if (req.userId) {
    const [enrollment] = await db
      .select()
      .from(platformEnrollmentsTable)
      .where(
        and(
          eq(platformEnrollmentsTable.userId, req.userId),
          eq(platformEnrollmentsTable.courseId, course.id),
          eq(platformEnrollmentsTable.courseAccess, true),
        ),
      )
      .limit(1);
    hasAccess = !!enrollment;
  }

  const canWatch = (lesson: typeof lessons[number]) => lesson.freePreview || hasAccess;

  const lessonsOut = lessons.map((lesson) => {
    const accessible = canWatch(lesson);

    // Priority: R2 (videoObjectKey) > GCS (videoObjectPath) > HeyGen (videoEnvVar)
    let videoUrl: string | null = null;
    let playbackEndpoint: string | null = null;
    let videoEmbedUrl: string | null = null;

    if (accessible) {
      if (lesson.videoObjectKey) {
        // R2 path — frontend POSTs here to receive a short-lived presigned URL
        playbackEndpoint = `/api/platform/courses/${course.slug}/lessons/${lesson.id}/playback`;
      } else if (lesson.videoObjectPath && lesson.videoProcessingStatus === "ready") {
        // GCS self-hosted streaming (Lessons 1 & 2)
        videoUrl = `/api/platform/courses/${course.slug}/lessons/${lesson.id}/video`;
      } else {
        // HeyGen embed fallback
        videoEmbedUrl = buildHeygenUrl(
          lesson.videoEnvVar ? process.env[lesson.videoEnvVar] : undefined,
        );
      }
    }

    return {
      id: lesson.id,
      title: lesson.title,
      description: lesson.description,
      instructorNotes: lesson.instructorNotes,
      duration: lesson.duration,
      order: lesson.order,
      freePreview: lesson.freePreview,
      videoUrl,
      videoEmbedUrl,
      playbackEndpoint,
      thumbnailUrl: lesson.videoThumbnailPath
        ? `/api/platform/courses/${course.slug}/lessons/${lesson.id}/thumbnail`
        : null,
      locked: !lesson.freePreview && !hasAccess,
    };
  });

  res.json({
    course: {
      id: course.id,
      slug: course.slug,
      title: course.title,
      subtitle: course.subtitle,
      description: course.description,
      instructor: course.instructor,
      priceUsd: course.priceUsd,
      lessons: lessonsOut,
      hasAccess,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /platform/courses/:courseSlug/access
// Check whether the authenticated user has purchased this course.
// ---------------------------------------------------------------------------
router.get(
  "/platform/courses/:courseSlug/access",
  requireAuth,
  async (req, res): Promise<void> => {
    const [course] = await db
      .select()
      .from(platformCoursesTable)
      .where(eq(platformCoursesTable.slug, routeParam(req.params.courseSlug)))
      .limit(1);

    if (!course) {
      res.status(404).json({ error: "Course not found" });
      return;
    }

    const [enrollment] = await db
      .select()
      .from(platformEnrollmentsTable)
      .where(
        and(
          eq(platformEnrollmentsTable.userId, req.userId!),
          eq(platformEnrollmentsTable.courseId, course.id),
        ),
      )
      .limit(1);

    res.json({ hasAccess: enrollment?.courseAccess ?? false, enrollment: enrollment ?? null });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/courses/:courseSlug/checkout
// Create a Stripe Checkout Session for the course.
// ---------------------------------------------------------------------------
router.post(
  "/platform/courses/:courseSlug/checkout",
  requireAuth,
  async (req, res): Promise<void> => {
    const [course] = await db
      .select()
      .from(platformCoursesTable)
      .where(
        and(
          eq(platformCoursesTable.slug, routeParam(req.params.courseSlug)),
          eq(platformCoursesTable.published, true),
        ),
      )
      .limit(1);

    if (!course) {
      res.status(404).json({ error: "Course not found" });
      return;
    }

    // Already enrolled?
    const [existing] = await db
      .select()
      .from(platformEnrollmentsTable)
      .where(
        and(
          eq(platformEnrollmentsTable.userId, req.userId!),
          eq(platformEnrollmentsTable.courseId, course.id),
          eq(platformEnrollmentsTable.courseAccess, true),
        ),
      )
      .limit(1);

    if (existing) {
      res.json({ hasAccess: true, message: "Already enrolled" });
      return;
    }

    const priceId = course.stripePriceId;
    if (!priceId) {
      logger.error({ courseId: course.id }, "platform_course_missing_price_id");
      res.status(503).json({ error: "Course checkout is not yet configured. Please contact support." });
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

    // Create pending enrollment record
    const [enrollment] = await db
      .insert(platformEnrollmentsTable)
      .values({
        userId: req.userId!,
        courseId: course.id,
        stripeCustomerId,
        paymentStatus: "pending",
        courseAccess: false,
      })
      .returning();

    const baseUrl = getPublicBaseUrl();
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "payment",
      success_url: `${baseUrl}/course/success?ct=platform&cs=${course.slug}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/course`,
      metadata: {
        userId: req.userId!,
        courseId: course.id,
        courseSlug: course.slug,
        enrollmentId: enrollment.id, // used by webhook to grant access
      },
      client_reference_id: req.userId,
    });

    // Persist session ID
    await db
      .update(platformEnrollmentsTable)
      .set({ stripeSessionId: session.id })
      .where(eq(platformEnrollmentsTable.id, enrollment.id));

    logger.info(
      { enrollmentId: enrollment.id, sessionId: session.id, courseSlug: course.slug },
      "platform_checkout_created",
    );
    res.json({ url: session.url });
  },
);

// ---------------------------------------------------------------------------
// POST /platform/courses/:courseSlug/lessons/:lessonId/progress
// Save lesson watch progress. Auto-completes at ≥ 90 %.
// ---------------------------------------------------------------------------
router.post(
  "/platform/courses/:courseSlug/lessons/:lessonId/progress",
  requireAuth,
  async (req, res): Promise<void> => {
    const [course] = await db
      .select()
      .from(platformCoursesTable)
      .where(eq(platformCoursesTable.slug, routeParam(req.params.courseSlug)))
      .limit(1);
    if (!course) { res.status(404).json({ error: "Course not found" }); return; }

    const [lesson] = await db
      .select()
      .from(platformLessonsTable)
      .where(
        and(
          eq(platformLessonsTable.id, routeParam(req.params.lessonId)),
          eq(platformLessonsTable.courseId, course.id),
        ),
      )
      .limit(1);
    if (!lesson) { res.status(404).json({ error: "Lesson not found" }); return; }

    // Premium lessons require a valid enrollment
    if (!lesson.freePreview) {
      const [enrollment] = await db
        .select()
        .from(platformEnrollmentsTable)
        .where(
          and(
            eq(platformEnrollmentsTable.userId, req.userId!),
            eq(platformEnrollmentsTable.courseId, course.id),
            eq(platformEnrollmentsTable.courseAccess, true),
          ),
        )
        .limit(1);
      if (!enrollment) { res.status(403).json({ error: "Course not purchased" }); return; }
    }

    const { watchPercentage, completed } = req.body;
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

    const isCompleted =
      completed === true ||
      (typeof watchPercentage === "number" && watchPercentage >= 90);

    const [existing] = await db
      .select()
      .from(platformLessonProgressTable)
      .where(
        and(
          eq(platformLessonProgressTable.userId, req.userId!),
          eq(platformLessonProgressTable.lessonId, lesson.id),
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(platformLessonProgressTable)
        .set({
          watchPercentage:
            typeof watchPercentage === "number" ? watchPercentage : existing.watchPercentage,
          completed: isCompleted || existing.completed,
          lastViewedAt: new Date(),
        })
        .where(eq(platformLessonProgressTable.id, existing.id));
    } else {
      await db.insert(platformLessonProgressTable).values({
        userId: req.userId!,
        lessonId: lesson.id,
        courseId: course.id,
        watchPercentage: typeof watchPercentage === "number" ? watchPercentage : 0,
        completed: isCompleted,
        lastViewedAt: new Date(),
      });
    }

    res.json({ success: true });
  },
);

// ---------------------------------------------------------------------------
// GET /platform/courses/:courseSlug/progress
// All lesson progress + summary stats for the authenticated user.
// ---------------------------------------------------------------------------
router.get(
  "/platform/courses/:courseSlug/progress",
  requireAuth,
  async (req, res): Promise<void> => {
    const [course] = await db
      .select()
      .from(platformCoursesTable)
      .where(eq(platformCoursesTable.slug, routeParam(req.params.courseSlug)))
      .limit(1);
    if (!course) { res.status(404).json({ error: "Course not found" }); return; }

    const lessons = await db
      .select()
      .from(platformLessonsTable)
      .where(eq(platformLessonsTable.courseId, course.id))
      .orderBy(platformLessonsTable.order);

    const progress = await db
      .select()
      .from(platformLessonProgressTable)
      .where(
        and(
          eq(platformLessonProgressTable.userId, req.userId!),
          eq(platformLessonProgressTable.courseId, course.id),
        ),
      );

    const totalLessons = lessons.length;
    const completedLessons = progress.filter((p) => p.completed).length;

    const sorted = [...progress].sort(
      (a, b) => (b.lastViewedAt?.getTime() ?? 0) - (a.lastViewedAt?.getTime() ?? 0),
    );

    res.json({
      progress,
      stats: {
        completedLessons,
        totalLessons,
        percentage: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
        lastWatchedLessonId: sorted[0]?.lessonId ?? null,
      },
    });
  },
);

// ---------------------------------------------------------------------------
// GET /platform/courses/:courseSlug/lessons/:lessonId/thumbnail
// Serve the lesson poster image — no auth required (preview is always public).
// ---------------------------------------------------------------------------
router.get(
  "/platform/courses/:courseSlug/lessons/:lessonId/thumbnail",
  async (req, res): Promise<void> => {
    try {
      const [course] = await db
        .select()
        .from(platformCoursesTable)
        .where(eq(platformCoursesTable.slug, routeParam(req.params.courseSlug)))
        .limit(1);
      if (!course) { res.status(404).end(); return; }

      const [lesson] = await db
        .select()
        .from(platformLessonsTable)
        .where(
          and(
            eq(platformLessonsTable.id, routeParam(req.params.lessonId)),
            eq(platformLessonsTable.courseId, course.id),
          ),
        )
        .limit(1);
      if (!lesson?.videoThumbnailPath) { res.status(404).end(); return; }

      const gcsFile = getGcsFile(lesson.videoThumbnailPath);
      const [exists] = await gcsFile.exists();
      if (!exists) { res.status(404).end(); return; }

      const [metadata] = await gcsFile.getMetadata();
      res.set({
        "Content-Type": "image/jpeg",
        "Content-Length": String(metadata.size),
        "Cache-Control": "public, max-age=86400",
      });
      gcsFile.createReadStream().pipe(res);
    } catch (err) {
      logger.error({ err, params: req.params }, "thumbnail_serve_error");
      if (!res.headersSent) res.status(500).end();
    }
  },
);

// ---------------------------------------------------------------------------
// GET /platform/courses/:courseSlug/lessons/:lessonId/video
// Stream the self-hosted video with Range request support.
// Free-preview lessons are served without auth; premium requires enrollment.
// ---------------------------------------------------------------------------
router.get(
  "/platform/courses/:courseSlug/lessons/:lessonId/video",
  optionalAuth,
  async (req, res): Promise<void> => {
    try {
      const [course] = await db
        .select()
        .from(platformCoursesTable)
        .where(eq(platformCoursesTable.slug, routeParam(req.params.courseSlug)))
        .limit(1);
      if (!course || !course.published) {
        res.status(404).json({ error: "Course not found" });
        return;
      }

      const [lesson] = await db
        .select()
        .from(platformLessonsTable)
        .where(
          and(
            eq(platformLessonsTable.id, routeParam(req.params.lessonId)),
            eq(platformLessonsTable.courseId, course.id),
          ),
        )
        .limit(1);
      if (!lesson) {
        res.status(404).json({ error: "Lesson not found" });
        return;
      }

      // Access control
      if (!lesson.freePreview) {
        if (!req.userId) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }
        const [enrollment] = await db
          .select()
          .from(platformEnrollmentsTable)
          .where(
            and(
              eq(platformEnrollmentsTable.userId, req.userId),
              eq(platformEnrollmentsTable.courseId, course.id),
              eq(platformEnrollmentsTable.courseAccess, true),
            ),
          )
          .limit(1);
        if (!enrollment) {
          res.status(403).json({ error: "Course not purchased" });
          return;
        }
      }

      if (!lesson.videoObjectPath || lesson.videoProcessingStatus !== "ready") {
        res.status(404).json({ error: "Video not yet available" });
        return;
      }

      const gcsFile = getGcsFile(lesson.videoObjectPath);
      const [exists] = await gcsFile.exists();
      if (!exists) {
        res.status(404).json({ error: "Video file not found in storage" });
        return;
      }

      const [metadata] = await gcsFile.getMetadata();
      const fileSize = parseInt(String(metadata.size));
      const contentType = String(metadata.contentType ?? "video/mp4");

      const rangeHeader = req.headers.range;

      if (rangeHeader) {
        const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
        const start = parseInt(startStr, 10);
        const end = endStr
          ? parseInt(endStr, 10)
          : Math.min(start + 2 * 1024 * 1024 - 1, fileSize - 1);
        const chunkSize = end - start + 1;

        res.status(206).set({
          "Content-Type": contentType,
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Cache-Control": "private, max-age=3600",
        });
        gcsFile.createReadStream({ start, end }).pipe(res);
      } else {
        res.set({
          "Content-Type": contentType,
          "Content-Length": String(fileSize),
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, max-age=3600",
        });
        gcsFile.createReadStream().pipe(res);
      }
    } catch (err) {
      logger.error({ err, params: req.params }, "video_stream_error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to stream video" });
      }
    }
  },
);

// ---------------------------------------------------------------------------
// POST /platform/courses/:courseSlug/lessons/:lessonId/playback
// Generate a short-lived presigned R2 URL for an authorized user.
//
// Security properties:
//   • Requires authentication (requireAuth)
//   • Per-user rate limit: max 10 requests / 60 s
//   • Object key derived from DB — never from the client request
//   • Enrollment verified server-side before any URL is generated
//   • Presigned URL is never logged or persisted
//   • 404 used for all "not found" cases to prevent asset enumeration
// ---------------------------------------------------------------------------
router.post(
  "/platform/courses/:courseSlug/lessons/:lessonId/playback",
  requireAuth,
  async (req, res): Promise<void> => {
    const courseSlug = routeParam(req.params.courseSlug);
    const lessonId = routeParam(req.params.lessonId);
    const userId = req.userId!;

    logger.info({ userId, courseSlug, lessonId }, "course.playback.requested");

    // Rate limit
    if (!checkPlaybackRateLimit(userId)) {
      logger.warn(
        { userId, lessonId, reason: "rate_limited" },
        "course.playback.denied",
      );
      res.status(429).json({
        error: "Too many playback requests. Please wait before trying again.",
      });
      return;
    }

    try {
      const [course] = await db
        .select()
        .from(platformCoursesTable)
        .where(
          and(
            eq(platformCoursesTable.slug, courseSlug),
            eq(platformCoursesTable.published, true),
          ),
        )
        .limit(1);

      if (!course) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const [lesson] = await db
        .select()
        .from(platformLessonsTable)
        .where(
          and(
            eq(platformLessonsTable.id, lessonId),
            eq(platformLessonsTable.courseId, course.id),
          ),
        )
        .limit(1);

      if (!lesson) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      // Lesson must have an R2 object key (set by the upload/seed script)
      if (!lesson.videoObjectKey) {
        logger.warn(
          { userId, courseId: course.id, lessonId },
          "course.playback.failed",
        );
        res.status(404).json({ error: "Not found" });
        return;
      }

      // Access: free preview OR confirmed enrollment
      let authorized = lesson.freePreview;

      if (!authorized) {
        const [enrollment] = await db
          .select()
          .from(platformEnrollmentsTable)
          .where(
            and(
              eq(platformEnrollmentsTable.userId, userId),
              eq(platformEnrollmentsTable.courseId, course.id),
              eq(platformEnrollmentsTable.courseAccess, true),
            ),
          )
          .limit(1);
        authorized = !!enrollment;
      }

      if (!authorized) {
        logger.info(
          { userId, courseId: course.id, lessonId, reason: "not_enrolled" },
          "course.playback.denied",
        );
        res.status(403).json({ error: "Course not purchased" });
        return;
      }

      logger.info(
        { userId, courseId: course.id, lessonId },
        "course.playback.authorized",
      );

      // Object key comes from the DB row — never from req.params or req.body
      const config = getR2Config();
      const expiresIn = config.signedUrlExpirationSeconds;
      const playbackUrl = await r2Storage.getSignedPlaybackUrl(
        lesson.videoObjectKey,
        expiresIn,
      );

      // SECURITY: never log the presigned URL — it contains inline credentials
      logger.info(
        { userId, courseId: course.id, lessonId, expiresIn },
        "course.playback.url_generated",
      );

      res.json({ playbackUrl, expiresIn });
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : "unknown",
          userId,
          lessonId,
        },
        "course.playback.failed",
      );
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate playback URL" });
      }
    }
  },
);

export default router;

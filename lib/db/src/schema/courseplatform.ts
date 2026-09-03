import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  integer,
  real,
  bigint,
  pgEnum,
  check,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

// Separate enum so it doesn't conflict with purchase_status on course_purchases
export const enrollmentStatusEnum = pgEnum("enrollment_status", [
  "pending",
  "completed",
  "failed",
  "refunded",
]);

// ---------------------------------------------------------------------------
// platform_courses — one row per course (slug-addressed)
// ---------------------------------------------------------------------------
export const platformCoursesTable = pgTable("platform_courses", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  description: text("description"),
  instructor: text("instructor").notNull().default("CertEfficiency"),
  priceUsd: integer("price_usd").notNull(),
  thumbnail: text("thumbnail"),
  published: boolean("published").notNull().default(false),
  stripeProductId: text("stripe_product_id"),
  stripePriceId: text("stripe_price_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  check("platform_courses_price_usd_check", sql`${table.priceUsd} >= 0`),
]);

// ---------------------------------------------------------------------------
// platform_lessons — ordered lesson catalog for each course
// ---------------------------------------------------------------------------
export const platformLessonsTable = pgTable("platform_lessons", {
  id: uuid("id").defaultRandom().primaryKey(),
  courseId: uuid("course_id")
    .notNull()
    .references(() => platformCoursesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  instructorNotes: text("instructor_notes"),
  // HeyGen embed — env var name resolves to a video ID at runtime
  videoEnvVar: text("video_env_var"),
  // Self-hosted video (object storage)
  videoObjectPath: text("video_object_path"),   // e.g. /objects/uploads/<uuid>
  videoFilename: text("video_filename"),
  videoMimeType: text("video_mime_type"),
  videoFileSizeBytes: bigint("video_file_size_bytes", { mode: "number" }),
  videoDurationSecs: integer("video_duration_secs"),
  videoUploadStatus: text("video_upload_status"),     // pending | completed | failed
  videoProcessingStatus: text("video_processing_status"), // pending | ready | failed
  videoUploadedAt: timestamp("video_uploaded_at", { withTimezone: true }),
  videoThumbnailPath: text("video_thumbnail_path"),  // /objects/thumbnails/<uuid>.jpg
  // R2 object key for Cloudflare R2 storage (e.g. courses/ai-agent-builder/lesson-3.mp4)
  // Takes priority over videoObjectPath (GCS) and videoEnvVar (HeyGen) when present.
  videoObjectKey: text("video_object_key"),
  duration: text("duration"),
  order: integer("order").notNull(),
  freePreview: boolean("free_preview").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("platform_lessons_course_order_uidx").on(table.courseId, table.order),
  check("platform_lessons_order_check", sql`${table.order} > 0`),
  check("platform_lessons_file_size_check", sql`${table.videoFileSizeBytes} is null or ${table.videoFileSizeBytes} >= 0`),
  check("platform_lessons_duration_check", sql`${table.videoDurationSecs} is null or ${table.videoDurationSecs} >= 0`),
]);

// ---------------------------------------------------------------------------
// platform_enrollments — one row per user per course purchase
// ---------------------------------------------------------------------------
export const platformEnrollmentsTable = pgTable("platform_enrollments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  courseId: uuid("course_id")
    .notNull()
    .references(() => platformCoursesTable.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  paymentStatus: enrollmentStatusEnum("payment_status").notNull().default("pending"),
  courseAccess: boolean("course_access").notNull().default(false),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  index("platform_enrollments_user_course_idx").on(table.userId, table.courseId),
  uniqueIndex("platform_enrollments_stripe_session_uidx").on(table.stripeSessionId),
]);

// ---------------------------------------------------------------------------
// platform_lesson_progress — per-user per-lesson watch state
// ---------------------------------------------------------------------------
export const platformLessonProgressTable = pgTable("platform_lesson_progress", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  lessonId: uuid("lesson_id")
    .notNull()
    .references(() => platformLessonsTable.id, { onDelete: "cascade" }),
  courseId: uuid("course_id")
    .notNull()
    .references(() => platformCoursesTable.id, { onDelete: "cascade" }),
  watchPercentage: real("watch_percentage").notNull().default(0),
  completed: boolean("completed").notNull().default(false),
  lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("platform_lesson_progress_user_lesson_uidx").on(table.userId, table.lessonId),
  index("platform_lesson_progress_user_course_idx").on(table.userId, table.courseId),
  check("platform_lesson_progress_percentage_check", sql`${table.watchPercentage} >= 0 and ${table.watchPercentage} <= 100`),
]);

export type PlatformCourse = typeof platformCoursesTable.$inferSelect;
export type PlatformLesson = typeof platformLessonsTable.$inferSelect;
export type PlatformEnrollment = typeof platformEnrollmentsTable.$inferSelect;
export type PlatformLessonProgress = typeof platformLessonProgressTable.$inferSelect;

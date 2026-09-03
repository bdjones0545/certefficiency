import { pgTable, text, uuid, timestamp, boolean, integer, real, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const purchaseStatusEnum = pgEnum("purchase_status", ["pending", "completed", "failed", "refunded"]);

export const coursePurchasesTable = pgTable("course_purchases", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  courseId: text("course_id").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSessionId: text("stripe_session_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  paymentStatus: purchaseStatusEnum("payment_status").notNull().default("pending"),
  courseAccess: boolean("course_access").notNull().default(false),
  purchaseDate: timestamp("purchase_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const courseProgressTable = pgTable("course_progress", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  courseId: text("course_id").notNull(),
  lessonNumber: integer("lesson_number").notNull(),
  watchPercentage: real("watch_percentage").notNull().default(0),
  completed: boolean("completed").notNull().default(false),
  lastWatchedAt: timestamp("last_watched_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCoursePurchaseSchema = createInsertSchema(coursePurchasesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCourseProgressSchema = createInsertSchema(courseProgressTable).omit({ id: true, createdAt: true, updatedAt: true });
export type CoursePurchase = typeof coursePurchasesTable.$inferSelect;
export type CourseProgress = typeof courseProgressTable.$inferSelect;

import { pgTable, text, uuid, timestamp, integer, boolean, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { certificationsTable } from "./certifications";

export const studyPlanStatusEnum = pgEnum("study_plan_status", ["active", "completed", "superseded"]);
export const studyPlanItemTypeEnum = pgEnum("study_plan_item_type", ["study", "review", "mock_exam", "milestone"]);

export const studyPlansTable = pgTable("study_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  certificationId: uuid("certification_id").notNull().references(() => certificationsTable.id),
  status: studyPlanStatusEnum("status").notNull().default("active"),
  examDate: text("exam_date"), // YYYY-MM-DD
  weeklyHoursAvailable: integer("weekly_hours_available"),
  weakDomains: text("weak_domains").array(),
  strongDomains: text("strong_domains").array(),
  milestones: jsonb("milestones"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const studyPlanItemsTable = pgTable("study_plan_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  studyPlanId: uuid("study_plan_id").notNull().references(() => studyPlansTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  scheduledDate: text("scheduled_date").notNull(), // YYYY-MM-DD
  durationMinutes: integer("duration_minutes").notNull().default(60),
  itemType: studyPlanItemTypeEnum("item_type").notNull().default("study"),
  domain: text("domain"),
  completed: boolean("completed").notNull().default(false),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStudyPlanSchema = createInsertSchema(studyPlansTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertStudyPlanItemSchema = createInsertSchema(studyPlanItemsTable).omit({ id: true, createdAt: true });
export type InsertStudyPlan = z.infer<typeof insertStudyPlanSchema>;
export type InsertStudyPlanItem = z.infer<typeof insertStudyPlanItemSchema>;
export type StudyPlan = typeof studyPlansTable.$inferSelect;
export type StudyPlanItem = typeof studyPlanItemsTable.$inferSelect;

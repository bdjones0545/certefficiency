import { pgTable, text, uuid, timestamp, integer, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { conversationsTable } from "./conversations";

export const sarahJobStatusEnum = pgEnum("sarah_job_status", ["queued", "processing", "completed", "failed", "cancelled"]);

export const sarahJobsTable = pgTable("sarah_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversationsTable.id),
  requestType: text("request_type").notNull(),
  status: sarahJobStatusEnum("status").notNull().default("queued"),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  attemptCount: integer("attempt_count").notNull().default(0),
  inputPayload: jsonb("input_payload"),
  outputPayload: jsonb("output_payload"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  correlationId: text("correlation_id"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sarahJobAttemptsTable = pgTable("sarah_job_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id").notNull().references(() => sarahJobsTable.id, { onDelete: "cascade" }),
  attemptNumber: integer("attempt_number").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  status: sarahJobStatusEnum("status").notNull(),
  errorMessage: text("error_message"),
});

export const insertSarahJobSchema = createInsertSchema(sarahJobsTable).omit({ id: true, createdAt: true });
export type InsertSarahJob = z.infer<typeof insertSarahJobSchema>;
export type SarahJob = typeof sarahJobsTable.$inferSelect;

import { pgTable, text, uuid, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { conversationsTable } from "./conversations";

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);
export const messageTypeEnum = pgEnum("message_type", [
  "text", "system_notice", "certification_selector", "exam_date_prompt",
  "quick_actions", "question_card", "answer_feedback", "progress_update",
  "study_plan", "mock_exam_intro", "mock_exam_result", "upload_analysis", "error"
]);
export const messageStatusEnum = pgEnum("message_status", ["sending", "delivered", "failed"]);

export const messagesTable = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => conversationsTable.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  messageType: messageTypeEnum("message_type").notNull().default("text"),
  content: text("content").notNull().default(""),
  structuredData: jsonb("structured_data"),
  status: messageStatusEnum("status").notNull().default("delivered"),
  sarahJobId: uuid("sarah_job_id"),
  attachmentIds: jsonb("attachment_ids").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messageVersionsTable = pgTable("message_versions", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id").notNull().references(() => messagesTable.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  content: text("content").notNull(),
  structuredData: jsonb("structured_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({
  id: true, createdAt: true,
});
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;

import { sql } from "drizzle-orm";
import { pgTable, text, uuid, timestamp, integer, pgEnum, check, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { conversationsTable } from "./conversations";

export const uploadStatusEnum = pgEnum("upload_status", ["processing", "ready", "failed"]);

export const uploadsTable = pgTable("uploads", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversationsTable.id),
  filename: text("filename").notNull(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path"),
  // Text pulled out of the file at upload time (PDF, DOCX, TXT, Markdown).
  // Null means it was never extractable, yielded nothing, or parsing failed —
  // Sarah cannot read files herself, so an upload with no text here is a file
  // she will never be able to reason about.
  extractedText: text("extracted_text"),
  status: uploadStatusEnum("status").notNull().default("processing"),
  sarahJobId: uuid("sarah_job_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("uploads_user_created_idx").on(table.userId, table.createdAt),
  index("uploads_conversation_idx").on(table.conversationId),
  index("uploads_sarah_job_idx").on(table.sarahJobId),
  check("uploads_size_bytes_check", sql`${table.sizeBytes} >= 0`),
]);

export const insertUploadSchema = createInsertSchema(uploadsTable).omit({ id: true, createdAt: true });
export type InsertUpload = z.infer<typeof insertUploadSchema>;
export type Upload = typeof uploadsTable.$inferSelect;

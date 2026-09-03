import { sql } from "drizzle-orm";
import { pgTable, text, uuid, timestamp, integer, boolean, jsonb, real, pgEnum, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { certificationsTable } from "./certifications";

export const mockExamStatusEnum = pgEnum("mock_exam_status", ["in_progress", "submitted", "graded"]);

export const mockExamsTable = pgTable("mock_exams", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  certificationId: uuid("certification_id").notNull().references(() => certificationsTable.id),
  status: mockExamStatusEnum("status").notNull().default("in_progress"),
  questionCount: integer("question_count").notNull().default(50),
  timeLimitMinutes: integer("time_limit_minutes"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  score: real("score"),
  domainBreakdown: jsonb("domain_breakdown"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("mock_exams_user_created_idx").on(table.userId, table.createdAt),
  index("mock_exams_certification_idx").on(table.certificationId),
  check("mock_exams_question_count_check", sql`${table.questionCount} > 0`),
  check("mock_exams_time_limit_check", sql`${table.timeLimitMinutes} is null or ${table.timeLimitMinutes} > 0`),
  check("mock_exams_score_check", sql`${table.score} is null or (${table.score} >= 0 and ${table.score} <= 100)`),
]);

export const mockExamQuestionsTable = pgTable("mock_exam_questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  examId: uuid("exam_id").notNull().references(() => mockExamsTable.id, { onDelete: "cascade" }),
  questionNumber: integer("question_number").notNull(),
  certificationId: uuid("certification_id").references(() => certificationsTable.id),
  domain: text("domain"),
  prompt: text("prompt").notNull(),
  options: jsonb("options").notNull(),
  selectedOptionId: text("selected_option_id"),
  flagged: boolean("flagged").notNull().default(false),
  correctOptionId: text("correct_option_id"),
  explanation: text("explanation"),
}, (table) => [
  uniqueIndex("mock_exam_questions_exam_number_uidx").on(table.examId, table.questionNumber),
  check("mock_exam_questions_number_check", sql`${table.questionNumber} > 0`),
]);

export const insertMockExamSchema = createInsertSchema(mockExamsTable).omit({ id: true, createdAt: true });
export const insertMockExamQuestionSchema = createInsertSchema(mockExamQuestionsTable).omit({ id: true });
export type InsertMockExam = z.infer<typeof insertMockExamSchema>;
export type InsertMockExamQuestion = z.infer<typeof insertMockExamQuestionSchema>;
export type MockExam = typeof mockExamsTable.$inferSelect;
export type MockExamQuestion = typeof mockExamQuestionsTable.$inferSelect;

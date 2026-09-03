import { pgTable, text, uuid, timestamp, integer, boolean, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { certificationsTable } from "./certifications";
import { conversationsTable } from "./conversations";
import { studyModeEnum } from "./conversations";

export const difficultyEnum = pgEnum("difficulty", ["easy", "medium", "hard"]);

export const practiceQuestionsTable = pgTable("practice_questions", {
  id: uuid("id").defaultRandom().primaryKey(),
  certificationId: uuid("certification_id").notNull().references(() => certificationsTable.id),
  domain: text("domain").notNull(),
  topic: text("topic").notNull(),
  difficulty: difficultyEnum("difficulty").notNull().default("medium"),
  prompt: text("prompt").notNull(),
  options: jsonb("options").notNull(),
  correctAnswer: text("correct_answer").notNull(),
  explanation: text("explanation"),
  optionExplanations: jsonb("option_explanations"),
  strategyNote: text("strategy_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const practiceAttemptsTable = pgTable("practice_attempts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  questionId: uuid("question_id").notNull().references(() => practiceQuestionsTable.id),
  conversationId: uuid("conversation_id").references(() => conversationsTable.id),
  selectedOptionId: text("selected_option_id").notNull(),
  correct: boolean("correct").notNull(),
  confidenceLevel: integer("confidence_level"),
  flagged: boolean("flagged").notNull().default(false),
  feedback: jsonb("feedback"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const studySessionsTable = pgTable("study_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversationsTable.id),
  mode: studyModeEnum("mode").notNull(),
  certificationId: uuid("certification_id").references(() => certificationsTable.id),
  status: text("status").notNull().default("active"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const topicMasteryTable = pgTable("topic_mastery", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  certificationId: uuid("certification_id").notNull().references(() => certificationsTable.id),
  domain: text("domain").notNull(),
  topic: text("topic").notNull().default(""),
  masteryScore: integer("mastery_score").notNull().default(0),
  questionsAnswered: integer("questions_answered").notNull().default(0),
  correctAnswers: integer("correct_answers").notNull().default(0),
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPracticeQuestionSchema = createInsertSchema(practiceQuestionsTable).omit({ id: true, createdAt: true });
export const insertPracticeAttemptSchema = createInsertSchema(practiceAttemptsTable).omit({ id: true, createdAt: true });
export type InsertPracticeQuestion = z.infer<typeof insertPracticeQuestionSchema>;
export type InsertPracticeAttempt = z.infer<typeof insertPracticeAttemptSchema>;
export type PracticeQuestion = typeof practiceQuestionsTable.$inferSelect;
export type PracticeAttempt = typeof practiceAttemptsTable.$inferSelect;

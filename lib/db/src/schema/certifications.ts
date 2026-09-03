import { pgTable, text, uuid, timestamp, boolean, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const certificationsTable = pgTable("certifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  category: text("category").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const confidenceLevelEnum = pgEnum("confidence_level", ["beginner", "intermediate", "advanced"]);

export const userCertificationsTable = pgTable("user_certifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  certificationId: uuid("certification_id").notNull().references(() => certificationsTable.id),
  examDate: text("exam_date"), // YYYY-MM-DD stored as text
  weeklyHours: integer("weekly_hours"),
  confidenceLevel: confidenceLevelEnum("confidence_level"),
  attemptedBefore: boolean("attempted_before"),
  preferredStyle: text("preferred_style"),
  isPrimary: boolean("is_primary").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertCertificationSchema = createInsertSchema(certificationsTable).omit({
  id: true, createdAt: true,
});
export const insertUserCertificationSchema = createInsertSchema(userCertificationsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertCertification = z.infer<typeof insertCertificationSchema>;
export type InsertUserCertification = z.infer<typeof insertUserCertificationSchema>;
export type Certification = typeof certificationsTable.$inferSelect;
export type UserCertification = typeof userCertificationsTable.$inferSelect;

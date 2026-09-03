import { sql } from "drizzle-orm";
import { pgTable, text, uuid, timestamp, boolean, integer, pgEnum, check, index, uniqueIndex } from "drizzle-orm/pg-core";
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
}, (table) => [
  uniqueIndex("user_certifications_user_certification_uidx").on(table.userId, table.certificationId),
  uniqueIndex("user_certifications_one_primary_per_user_uidx")
    .on(table.userId)
    .where(sql`${table.isPrimary} = true`),
  index("user_certifications_certification_idx").on(table.certificationId),
  check("user_certifications_weekly_hours_check", sql`${table.weeklyHours} is null or (${table.weeklyHours} >= 0 and ${table.weeklyHours} <= 168)`),
]);

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

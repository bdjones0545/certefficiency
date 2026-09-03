import { Router } from "express";
import { db, usersTable, userCertificationsTable, certificationsTable, uploadsTable, auditEventsTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { UpdateSettingsBody, DeleteAccountBody } from "@workspace/api-zod";
import bcrypt from "bcryptjs";
import { logger } from "../lib/logger";

const router = Router();

// GET /settings
router.get("/settings", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select()
    .from(usersTable)
    .where(and(eq(usersTable.id, req.userId!), isNull(usersTable.deletedAt)))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const [primaryCert] = await db.select({
    id: userCertificationsTable.id,
    userId: userCertificationsTable.userId,
    certificationId: userCertificationsTable.certificationId,
    examDate: userCertificationsTable.examDate,
    weeklyHours: userCertificationsTable.weeklyHours,
    confidenceLevel: userCertificationsTable.confidenceLevel,
    attemptedBefore: userCertificationsTable.attemptedBefore,
    preferredStyle: userCertificationsTable.preferredStyle,
    isPrimary: userCertificationsTable.isPrimary,
    createdAt: userCertificationsTable.createdAt,
    certification: {
      id: certificationsTable.id,
      name: certificationsTable.name,
      code: certificationsTable.code,
      category: certificationsTable.category,
      description: certificationsTable.description,
    },
  })
    .from(userCertificationsTable)
    .innerJoin(certificationsTable, eq(userCertificationsTable.certificationId, certificationsTable.id))
    .where(and(eq(userCertificationsTable.userId, req.userId!), eq(userCertificationsTable.isPrimary, true)))
    .limit(1);

  res.json({
    userId: user.id,
    name: user.name,
    email: user.email,
    theme: "system",
    notificationsEnabled: true,
    primaryCertification: primaryCert || null,
  });
});

// PATCH /settings
router.patch("/settings", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.select()
    .from(usersTable)
    .where(and(eq(usersTable.id, req.userId!), isNull(usersTable.deletedAt)))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (parsed.data.name) {
    await db.update(usersTable)
      .set({ name: parsed.data.name.trim(), updatedAt: new Date() })
      .where(eq(usersTable.id, req.userId!));
  }

  res.json({
    userId: user.id,
    name: parsed.data.name || user.name,
    email: user.email,
    theme: parsed.data.theme || "system",
    notificationsEnabled: parsed.data.notificationsEnabled ?? true,
    primaryCertification: null,
  });
});

// DELETE /account
router.delete("/account", requireAuth, async (req, res): Promise<void> => {
  const parsed = DeleteAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { confirmation, password } = parsed.data;

  if (confirmation !== "DELETE MY ACCOUNT") {
    res.status(400).json({ error: "Please type 'DELETE MY ACCOUNT' to confirm" });
    return;
  }

  const [user] = await db.select()
    .from(usersTable)
    .where(and(eq(usersTable.id, req.userId!), isNull(usersTable.deletedAt)))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (password) {
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(400).json({ error: "Incorrect password" });
      return;
    }
  }

  await db.transaction(async (tx) => {
    // Soft delete the user
    await tx.update(usersTable)
      .set({ deletedAt: new Date(), email: `deleted_${Date.now()}_${user.email}`, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));

    // Write audit event
    await tx.insert(auditEventsTable).values({
      userId: user.id,
      eventType: "account_deleted",
      resourceType: "user",
      resourceId: user.id,
      data: { reason: "user_request" } as any,
    });
  });

  req.log.info({ userId: req.userId }, "Account deleted");
  res.json({ success: true, message: "Your account has been deleted." });
});

export default router;

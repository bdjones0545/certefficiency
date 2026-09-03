import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable, passwordResetTokensTable } from "@workspace/db";
import { eq, and, gt, isNull } from "drizzle-orm";
import { signToken, requireAuth } from "../lib/auth";
import {
  createPasswordResetToken,
  hashPasswordResetToken,
  sendPasswordResetEmail,
} from "../lib/passwordReset";
import {
  RegisterBody, LoginBody, ForgotPasswordBody, ResetPasswordBody,
  ChangePasswordBody,
} from "@workspace/api-zod";

const router = Router();

// POST /auth/register
router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail))
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [user] = await db.insert(usersTable).values({
    name: name.trim(),
    email: normalizedEmail,
    passwordHash,
    plan: "free",
  }).returning();

  const token = signToken({ userId: user.id, email: user.email });

  req.log.info({ userId: user.id }, "User registered");

  res.status(201).json({
    user: { id: user.id, name: user.name, email: user.email, plan: user.plan, createdAt: user.createdAt },
    token,
  });
});

// POST /auth/login
router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase().trim();

  const [user] = await db.select()
    .from(usersTable)
    .where(and(eq(usersTable.email, normalizedEmail), isNull(usersTable.deletedAt)))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const token = signToken({ userId: user.id, email: user.email });
  req.log.info({ userId: user.id }, "User logged in");

  res.json({
    user: { id: user.id, name: user.name, email: user.email, plan: user.plan, createdAt: user.createdAt },
    token,
  });
});

// POST /auth/logout
router.post("/auth/logout", requireAuth, async (req, res): Promise<void> => {
  req.log.info({ userId: req.userId }, "User logged out");
  res.json({ success: true, message: "Logged out successfully" });
});

// GET /auth/me
router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select()
    .from(usersTable)
    .where(and(eq(usersTable.id, req.userId!), isNull(usersTable.deletedAt)))
    .limit(1);

  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  res.json({ id: user.id, name: user.name, email: user.email, plan: user.plan, createdAt: user.createdAt });
});

// POST /auth/forgot-password
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const normalizedEmail = parsed.data.email.toLowerCase().trim();
  const [user] = await db.select({ id: usersTable.id, email: usersTable.email })
    .from(usersTable)
    .where(and(eq(usersTable.email, normalizedEmail), isNull(usersTable.deletedAt)))
    .limit(1);

  // Always return success to prevent email enumeration
  if (user) {
    const { rawToken, tokenHash } = createPasswordResetToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const resetToken = await db.transaction(async (tx) => {
      // A newly issued token invalidates every older, unused token.
      await tx.update(passwordResetTokensTable)
        .set({ usedAt: new Date() })
        .where(and(
          eq(passwordResetTokensTable.userId, user.id),
          isNull(passwordResetTokensTable.usedAt),
        ));

      const [created] = await tx.insert(passwordResetTokensTable).values({
        userId: user.id,
        token: tokenHash,
        expiresAt,
      }).returning({ id: passwordResetTokensTable.id });
      return created;
    });

    try {
      await sendPasswordResetEmail(user.email, rawToken);
      req.log.info({ userId: user.id }, "Password reset email sent");
    } catch (error) {
      // Preserve the enumeration-safe response, but make the undelivered token unusable.
      await db.update(passwordResetTokensTable)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokensTable.id, resetToken.id));
      req.log.error({ err: error, userId: user.id }, "password_reset_email_failed");
    }
  }

  res.json({ success: true, message: "If an account exists with that email, a reset link has been sent." });
});

// POST /auth/reset-password
router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { token: rawToken, password } = parsed.data;
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) {
    res.status(400).json({ error: "Invalid or expired reset token" });
    return;
  }
  const tokenHash = hashPasswordResetToken(rawToken);

  const passwordHash = await bcrypt.hash(password, 12);
  const usedAt = new Date();

  const changed = await db.transaction(async (tx) => {
    // Claim the token atomically. Only one concurrent request can receive a row.
    const [claimed] = await tx.update(passwordResetTokensTable)
      .set({ usedAt })
      .where(and(
        eq(passwordResetTokensTable.token, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, usedAt),
      ))
      .returning({ userId: passwordResetTokensTable.userId });
    if (!claimed) return false;

    const updatedUsers = await tx.update(usersTable)
      .set({ passwordHash, updatedAt: usedAt })
      .where(and(eq(usersTable.id, claimed.userId), isNull(usersTable.deletedAt)))
      .returning({ id: usersTable.id });
    if (updatedUsers.length === 0) return false;

    await tx.update(passwordResetTokensTable)
      .set({ usedAt })
      .where(and(
        eq(passwordResetTokensTable.userId, claimed.userId),
        isNull(passwordResetTokensTable.usedAt),
      ));
    return true;
  });

  if (!changed) {
    res.status(400).json({ error: "Invalid or expired reset token" });
    return;
  }

  res.json({ success: true, message: "Password reset successfully" });
});

// POST /auth/change-password
router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { currentPassword, newPassword } = parsed.data;

  const [user] = await db.select()
    .from(usersTable)
    .where(eq(usersTable.id, req.userId!))
    .limit(1);

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(400).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ passwordHash, updatedAt: new Date() }).where(eq(usersTable.id, user.id));
    await tx.update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(and(
        eq(passwordResetTokensTable.userId, user.id),
        isNull(passwordResetTokensTable.usedAt),
      ));
  });

  res.json({ success: true, message: "Password changed successfully" });
});

export default router;

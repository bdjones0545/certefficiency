import { Router } from "express";
import { db, certificationsTable, userCertificationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { CreateUserCertificationBody, UpdateUserCertificationBody, UpdateUserCertificationParams } from "@workspace/api-zod";

const router = Router();

// GET /certifications
router.get("/certifications", async (_req, res): Promise<void> => {
  const certs = await db.select().from(certificationsTable).orderBy(certificationsTable.name);
  res.json(certs);
});

// GET /user-certifications
router.get("/user-certifications", requireAuth, async (req, res): Promise<void> => {
  const items = await db.select({
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
    .where(eq(userCertificationsTable.userId, req.userId!));

  res.json(items);
});

// POST /user-certifications
router.post("/user-certifications", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateUserCertificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { certificationId, examDate, weeklyHours, confidenceLevel, attemptedBefore, preferredStyle, isPrimary } = parsed.data;

  const cert = await db.select().from(certificationsTable).where(eq(certificationsTable.id, certificationId)).limit(1);
  if (!cert.length) {
    res.status(404).json({ error: "Certification not found" });
    return;
  }

  const [existing] = await db
    .select({ id: userCertificationsTable.id })
    .from(userCertificationsTable)
    .where(and(
      eq(userCertificationsTable.userId, req.userId!),
      eq(userCertificationsTable.certificationId, certificationId),
    ))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "Certification is already linked to this account" });
    return;
  }

  if (isPrimary) {
    await db.update(userCertificationsTable)
      .set({ isPrimary: false })
      .where(eq(userCertificationsTable.userId, req.userId!));
  }

  const examDateStr = examDate instanceof Date
    ? examDate.toISOString().split("T")[0]
    : typeof examDate === "string" ? examDate : null;

  const [uc] = await db.insert(userCertificationsTable).values({
    userId: req.userId!,
    certificationId,
    examDate: examDateStr,
    weeklyHours: weeklyHours ?? null,
    confidenceLevel: (confidenceLevel as "beginner" | "intermediate" | "advanced" | null) ?? null,
    attemptedBefore: attemptedBefore ?? null,
    preferredStyle: preferredStyle ?? null,
    isPrimary: isPrimary ?? false,
  }).returning();

  const [result] = await db.select({
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
    .where(eq(userCertificationsTable.id, uc.id));

  res.status(201).json(result);
});

// PATCH /user-certifications/:id
router.patch("/user-certifications/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateUserCertificationParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = UpdateUserCertificationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select()
    .from(userCertificationsTable)
    .where(and(eq(userCertificationsTable.id, params.data.id), eq(userCertificationsTable.userId, req.userId!)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (parsed.data.isPrimary) {
    await db.update(userCertificationsTable)
      .set({ isPrimary: false })
      .where(eq(userCertificationsTable.userId, req.userId!));
  }

  const patchExamDateStr = parsed.data.examDate instanceof Date
    ? parsed.data.examDate.toISOString().split("T")[0]
    : typeof parsed.data.examDate === "string" ? parsed.data.examDate : undefined;

  await db.update(userCertificationsTable)
    .set({
      ...parsed.data,
      examDate: patchExamDateStr,
      confidenceLevel: (parsed.data.confidenceLevel as "beginner" | "intermediate" | "advanced" | undefined) ?? existing.confidenceLevel,
      updatedAt: new Date(),
    })
    .where(eq(userCertificationsTable.id, params.data.id));

  const [result] = await db.select({
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
    .where(eq(userCertificationsTable.id, params.data.id));

  res.json(result);
});

export default router;

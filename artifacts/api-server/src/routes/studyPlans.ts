import { Router } from "express";
import { db, studyPlansTable, studyPlanItemsTable, certificationsTable, userCertificationsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { sarah } from "../lib/sarah";
import { CreateStudyPlanBody, UpdateStudyPlanBody, UpdateStudyPlanParams } from "@workspace/api-zod";

const router = Router();

async function buildPlanResponse(plan: typeof studyPlansTable.$inferSelect, certName: string | null) {
  const items = await db.select()
    .from(studyPlanItemsTable)
    .where(eq(studyPlanItemsTable.studyPlanId, plan.id))
    .orderBy(studyPlanItemsTable.scheduledDate);

  const examDate = plan.examDate;
  let daysRemaining: number | null = null;
  if (examDate) {
    const exam = new Date(examDate);
    const today = new Date();
    daysRemaining = Math.max(0, Math.floor((exam.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
  }

  return {
    ...plan,
    certificationName: certName,
    daysRemaining,
    items,
  };
}

// POST /study-plans
router.post("/study-plans", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateStudyPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { certificationId, examDate, weeklyHoursAvailable } = parsed.data;

  const [cert] = await db.select().from(certificationsTable).where(eq(certificationsTable.id, certificationId)).limit(1);
  if (!cert) {
    res.status(404).json({ error: "Certification not found" });
    return;
  }

  // Supersede existing active plans
  await db.update(studyPlansTable)
    .set({ status: "superseded" })
    .where(and(eq(studyPlansTable.userId, req.userId!), eq(studyPlansTable.status, "active")));

  // Generate plan via Sarah
  const examDateStr = examDate instanceof Date
    ? examDate.toISOString().split("T")[0]
    : typeof examDate === "string" ? examDate : null;

  const planData = await sarah.generateStudyPlan({
    userId: req.userId!,
    certificationId,
    certificationName: cert.name,
    examDate: examDateStr,
    weeklyHoursAvailable: weeklyHoursAvailable ?? null,
  });

  const [plan] = await db.insert(studyPlansTable).values({
    userId: req.userId!,
    certificationId,
    status: "active",
    examDate: planData.examDate ?? examDateStr,
    weeklyHoursAvailable: planData.weeklyHoursAvailable ?? (weeklyHoursAvailable ?? null),
    weakDomains: planData.weakDomains,
    strongDomains: planData.strongDomains,
    milestones: planData.milestones as any,
  }).returning();

  if (planData.items.length > 0) {
    await db.insert(studyPlanItemsTable).values(
      planData.items.map(item => ({
        studyPlanId: plan.id,
        title: item.title,
        description: item.description ?? null,
        scheduledDate: item.scheduledDate,
        durationMinutes: item.durationMinutes,
        itemType: (item.itemType as "study" | "review" | "mock_exam" | "milestone") || "study",
        domain: item.domain ?? null,
        completed: false,
      }))
    );
  }

  res.status(201).json(await buildPlanResponse(plan, cert.name));
});

// GET /study-plans/current
router.get("/study-plans/current", requireAuth, async (req, res): Promise<void> => {
  const [plan] = await db.select()
    .from(studyPlansTable)
    .where(and(eq(studyPlansTable.userId, req.userId!), eq(studyPlansTable.status, "active")))
    .orderBy(desc(studyPlansTable.createdAt))
    .limit(1);

  if (!plan) {
    res.status(404).json({ error: "No active study plan" });
    return;
  }

  const [cert] = await db.select({ name: certificationsTable.name })
    .from(certificationsTable)
    .where(eq(certificationsTable.id, plan.certificationId))
    .limit(1);

  res.json(await buildPlanResponse(plan, cert?.name || null));
});

// PATCH /study-plans/:id
router.patch("/study-plans/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateStudyPlanParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = UpdateStudyPlanBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select()
    .from(studyPlansTable)
    .where(and(eq(studyPlansTable.id, params.data.id), eq(studyPlansTable.userId, req.userId!)))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: "Study plan not found" });
    return;
  }

  const patchExamDateStr = parsed.data.examDate instanceof Date
    ? parsed.data.examDate.toISOString().split("T")[0]
    : typeof parsed.data.examDate === "string" ? parsed.data.examDate : undefined;

  const [updated] = await db.update(studyPlansTable)
    .set({ ...parsed.data, examDate: patchExamDateStr, updatedAt: new Date() })
    .where(eq(studyPlansTable.id, params.data.id))
    .returning();

  const [cert] = await db.select({ name: certificationsTable.name })
    .from(certificationsTable)
    .where(eq(certificationsTable.id, updated.certificationId))
    .limit(1);

  res.json(await buildPlanResponse(updated, cert?.name || null));
});

export default router;

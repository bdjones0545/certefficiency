import { Router } from "express";
import rateLimit from "express-rate-limit";
import { db, mockExamsTable, mockExamQuestionsTable, certificationsTable, progressEventsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { sarah } from "../lib/sarah";
import { v4 as uuidv4 } from "uuid";
import {
  CreateMockExamBody, GetMockExamParams, SaveMockExamAnswersBody,
  SaveMockExamAnswersParams, SubmitMockExamParams,
} from "@workspace/api-zod";

const router = Router();

const MOCK_EXAM_GENERATION_WINDOW_MS = 60 * 60 * 1000;
const MOCK_EXAM_GENERATION_LIMIT = 3;

// Generation is one of the most expensive AI operations in the application.
// Apply this after authentication so the budget follows the account rather
// than a shared proxy IP.
const mockExamGenerationLimiter = rateLimit({
  windowMs: MOCK_EXAM_GENERATION_WINDOW_MS,
  limit: MOCK_EXAM_GENERATION_LIMIT,
  keyGenerator: (req) => req.userId!,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Mock exam generation limit reached. Please try again later.",
  },
});

// POST /mock-exams
router.post("/mock-exams", requireAuth, mockExamGenerationLimiter, async (req, res): Promise<void> => {
  const parsed = CreateMockExamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { certificationId, questionCount = 50, timeLimitMinutes } = parsed.data;

  const [cert] = await db.select().from(certificationsTable).where(eq(certificationsTable.id, certificationId)).limit(1);
  if (!cert) {
    res.status(404).json({ error: "Certification not found" });
    return;
  }

  const [exam] = await db.insert(mockExamsTable).values({
    userId: req.userId!,
    certificationId,
    status: "in_progress",
    questionCount,
    timeLimitMinutes: timeLimitMinutes ?? null,
    startedAt: new Date(),
  }).returning();

  // Generate questions via Sarah
  let questions: typeof mockExamQuestionsTable.$inferInsert[] = [];
  try {
    const result = await sarah.startMockExam({
      userId: req.userId!,
      certificationId,
      certificationName: cert.name,
      questionCount,
      timeLimitMinutes: timeLimitMinutes ?? null,
    });

    // Never persist more questions than the validated request permits, even if
    // an upstream provider returns an unexpectedly large response.
    const generatedQuestions = result.questions.slice(0, questionCount);
    if (generatedQuestions.length !== questionCount) {
      throw new Error(
        `Sarah returned ${generatedQuestions.length} of ${questionCount} requested questions`,
      );
    }

    for (const q of generatedQuestions) {
      questions.push({
        examId: exam.id,
        questionNumber: q.questionNumber,
        certificationId,
        domain: q.domain,
        prompt: q.prompt,
        options: q.options as any,
        correctOptionId: q.correctOptionId,
        explanation: q.explanation,
        flagged: false,
      });
    }
    if (questions.length > 0) {
      await db.insert(mockExamQuestionsTable).values(questions);
    }
  } catch (err) {
    req.log.error({ err }, "Failed to generate mock exam questions");
    await db.delete(mockExamsTable).where(
      and(
        eq(mockExamsTable.id, exam.id),
        eq(mockExamsTable.userId, req.userId!),
      ),
    );
    res.status(502).json({
      error: "Mock exam generation failed. Please try again.",
    });
    return;
  }

  const examQuestions = await db.select().from(mockExamQuestionsTable).where(eq(mockExamQuestionsTable.examId, exam.id));

  res.status(201).json({
    ...exam,
    certificationName: cert.name,
    questions: examQuestions.map(q => ({
      id: q.id,
      questionNumber: q.questionNumber,
      prompt: q.prompt,
      domain: q.domain,
      options: q.options,
      selectedOptionId: q.selectedOptionId,
      flagged: q.flagged,
      correctOptionId: null, // Hide correct until submitted
      explanation: null,
    })),
  });
});

// GET /mock-exams/:id
router.get("/mock-exams/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetMockExamParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [exam] = await db.select()
    .from(mockExamsTable)
    .where(and(eq(mockExamsTable.id, params.data.id), eq(mockExamsTable.userId, req.userId!)))
    .limit(1);

  if (!exam) {
    res.status(404).json({ error: "Exam not found" });
    return;
  }

  const [cert] = await db.select({ name: certificationsTable.name })
    .from(certificationsTable)
    .where(eq(certificationsTable.id, exam.certificationId))
    .limit(1);

  const questions = await db.select().from(mockExamQuestionsTable).where(eq(mockExamQuestionsTable.examId, exam.id));
  const isSubmitted = exam.status !== "in_progress";

  res.json({
    ...exam,
    certificationName: cert?.name || null,
    questions: questions.map(q => ({
      id: q.id,
      questionNumber: q.questionNumber,
      prompt: q.prompt,
      domain: q.domain,
      options: q.options,
      selectedOptionId: q.selectedOptionId,
      flagged: q.flagged,
      correctOptionId: isSubmitted ? q.correctOptionId : null,
      explanation: isSubmitted ? q.explanation : null,
    })),
  });
});

// PATCH /mock-exams/:id/answers
router.patch("/mock-exams/:id/answers", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = SaveMockExamAnswersParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const parsed = SaveMockExamAnswersBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [exam] = await db.select({ id: mockExamsTable.id, status: mockExamsTable.status })
    .from(mockExamsTable)
    .where(and(eq(mockExamsTable.id, params.data.id), eq(mockExamsTable.userId, req.userId!)))
    .limit(1);

  if (!exam) {
    res.status(404).json({ error: "Exam not found" });
    return;
  }

  if (exam.status !== "in_progress") {
    res.status(400).json({ error: "Exam already submitted" });
    return;
  }

  for (const answer of parsed.data.answers) {
    await db.update(mockExamQuestionsTable)
      .set({
        selectedOptionId: answer.selectedOptionId,
        flagged: answer.flagged ?? false,
      })
      .where(and(
        eq(mockExamQuestionsTable.id, answer.questionId),
        eq(mockExamQuestionsTable.examId, exam.id),
      ));
  }

  res.json({ success: true });
});

// POST /mock-exams/:id/submit
router.post("/mock-exams/:id/submit", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = SubmitMockExamParams.safeParse({ id: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [exam] = await db.select()
    .from(mockExamsTable)
    .where(and(eq(mockExamsTable.id, params.data.id), eq(mockExamsTable.userId, req.userId!)))
    .limit(1);

  if (!exam) {
    res.status(404).json({ error: "Exam not found" });
    return;
  }

  if (exam.status !== "in_progress") {
    res.status(400).json({ error: "Exam already submitted" });
    return;
  }

  const questions = await db.select().from(mockExamQuestionsTable).where(eq(mockExamQuestionsTable.examId, exam.id));

  const timeTakenSeconds = exam.startedAt
    ? Math.floor((Date.now() - exam.startedAt.getTime()) / 1000)
    : null;

  const gradeResult = await sarah.gradeMockExam({
    userId: req.userId!,
    examId: exam.id,
    certificationId: exam.certificationId,
    answers: questions.map(q => ({
      questionId: q.id,
      selectedOptionId: q.selectedOptionId,
      correctOptionId: q.correctOptionId || "",
      domain: q.domain || "Unknown",
    })),
    timeTakenSeconds,
  });

  await db.update(mockExamsTable)
    .set({
      status: "graded",
      submittedAt: new Date(),
      score: gradeResult.score,
      domainBreakdown: gradeResult.domainBreakdown as any,
    })
    .where(eq(mockExamsTable.id, exam.id));

  await db.insert(progressEventsTable).values({
    userId: req.userId!,
    eventType: "mock_exam_completed",
    description: `Completed mock exam with score ${Math.round(gradeResult.score)}%`,
    data: { examId: exam.id, score: gradeResult.score } as any,
  });

  res.json({
    examId: exam.id,
    score: gradeResult.score,
    correctCount: gradeResult.correctCount,
    totalCount: gradeResult.totalCount,
    timeTakenSeconds,
    domainBreakdown: gradeResult.domainBreakdown,
    readinessUpdate: gradeResult.readinessUpdate ?? null,
  });
});

export default router;

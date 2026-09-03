import { Router } from "express";
import { db, practiceQuestionsTable, practiceAttemptsTable, studySessionsTable, topicMasteryTable, progressEventsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { sarah } from "../lib/sarah";
import { StartStudyModeBody, SubmitAnswerBody, SubmitAnswerParams } from "@workspace/api-zod";
import { messagesTable, conversationsTable } from "@workspace/db";

const router = Router();

// POST /study-modes/start
router.post("/study-modes/start", requireAuth, async (req, res): Promise<void> => {
  const parsed = StartStudyModeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { conversationId, mode, certificationId } = parsed.data;

  const [session] = await db.insert(studySessionsTable).values({
    userId: req.userId!,
    conversationId,
    mode: mode as "learn" | "practice" | "review" | "mock_exam" | "study_plan",
    certificationId: certificationId || null,
    status: "active",
  }).returning();

  // Get Sarah message for mode
  const result = await sarah.startStudyMode({
    userId: req.userId!,
    conversationId,
    mode,
    certificationId: certificationId || null,
  });

  // Save Sarah's mode switch message
  if (conversationId) {
    await db.insert(messagesTable).values({
      conversationId,
      role: "assistant",
      messageType: "text",
      content: result.message.content,
      structuredData: result.message.structuredData as any,
      status: "delivered",
    });

    await db.update(conversationsTable)
      .set({ mode: mode as "learn" | "practice" | "review" | "mock_exam" | "study_plan", updatedAt: new Date() })
      .where(eq(conversationsTable.id, conversationId));
  }

  res.status(201).json(session);
});

// POST /practice/:questionId/answer
router.post("/practice/:questionId/answer", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.questionId) ? req.params.questionId[0] : req.params.questionId;
  const params = SubmitAnswerParams.safeParse({ questionId: rawId });
  if (!params.success) {
    res.status(400).json({ error: "Invalid question ID" });
    return;
  }

  const parsed = SubmitAnswerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { selectedOptionId, confidenceLevel, conversationId, flagged } = parsed.data;

  // Find the question
  const [question] = await db.select()
    .from(practiceQuestionsTable)
    .where(eq(practiceQuestionsTable.id, params.data.questionId))
    .limit(1);

  if (!question) {
    res.status(404).json({ error: "Question not found" });
    return;
  }

  // Check for duplicate submission (idempotency)
  const [existing] = await db.select({ id: practiceAttemptsTable.id })
    .from(practiceAttemptsTable)
    .where(and(
      eq(practiceAttemptsTable.userId, req.userId!),
      eq(practiceAttemptsTable.questionId, question.id),
    ))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: "This question has already been answered" });
    return;
  }

  const options = question.options as Array<{ id: string; text: string }>;

  const feedbackResult = await sarah.submitAnswer({
    userId: req.userId!,
    questionId: question.id,
    certificationId: question.certificationId,
    selectedOptionId,
    confidenceLevel: confidenceLevel ?? null,
    question: {
      prompt: question.prompt,
      options,
      correctAnswer: question.correctAnswer,
      domain: question.domain,
      topic: question.topic,
    },
  });

  await db.transaction(async (tx) => {
    // Save attempt
    await tx.insert(practiceAttemptsTable).values({
      userId: req.userId!,
      questionId: question.id,
      conversationId: conversationId || null,
      selectedOptionId,
      correct: feedbackResult.correct,
      confidenceLevel: confidenceLevel ?? null,
      flagged: flagged ?? false,
      feedback: feedbackResult as any,
    });

    // Update topic mastery
    const [mastery] = await tx.select()
      .from(topicMasteryTable)
      .where(and(
        eq(topicMasteryTable.userId, req.userId!),
        eq(topicMasteryTable.certificationId, question.certificationId),
        eq(topicMasteryTable.domain, question.domain),
      ))
      .limit(1);

    if (mastery) {
      await tx.update(topicMasteryTable)
        .set({
          questionsAnswered: mastery.questionsAnswered + 1,
          correctAnswers: feedbackResult.correct ? mastery.correctAnswers + 1 : mastery.correctAnswers,
          masteryScore: feedbackResult.masteryUpdate.newScore,
          lastUpdatedAt: new Date(),
        })
        .where(eq(topicMasteryTable.id, mastery.id));
    } else {
      await tx.insert(topicMasteryTable).values({
        userId: req.userId!,
        certificationId: question.certificationId,
        domain: question.domain,
        topic: question.topic,
        masteryScore: feedbackResult.masteryUpdate.newScore,
        questionsAnswered: 1,
        correctAnswers: feedbackResult.correct ? 1 : 0,
      });
    }

    // Log progress event
    await tx.insert(progressEventsTable).values({
      userId: req.userId!,
      eventType: "question_answered",
      description: `Answered question in ${question.domain}`,
      data: { correct: feedbackResult.correct, domain: question.domain } as any,
    });
  });

  res.json(feedbackResult);
});

export default router;

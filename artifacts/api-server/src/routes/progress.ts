import { Router } from "express";
import { db, practiceAttemptsTable, studySessionsTable, mockExamsTable, topicMasteryTable, progressEventsTable, userCertificationsTable, certificationsTable } from "@workspace/db";
import { eq, and, count, avg, max, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();

// GET /progress
router.get("/progress", requireAuth, async (req, res): Promise<void> => {
  const userId = req.userId!;

  const [answersAgg] = await db.select({
    total: count(practiceAttemptsTable.id),
    correct: count(practiceAttemptsTable.correct),
  })
    .from(practiceAttemptsTable)
    .where(eq(practiceAttemptsTable.userId, userId));

  const mockScores = await db.select({ score: mockExamsTable.score })
    .from(mockExamsTable)
    .where(and(eq(mockExamsTable.userId, userId), eq(mockExamsTable.status, "graded")))
    .orderBy(desc(mockExamsTable.submittedAt));

  const scores = mockScores.map(m => m.score ?? 0);
  const bestScore = scores.length > 0 ? Math.max(...scores) : null;

  const sessions = await db.select({ id: studySessionsTable.id })
    .from(studySessionsTable)
    .where(eq(studySessionsTable.userId, userId));

  const total = Number(answersAgg?.total ?? 0);
  const correctCount = await db.select({ cnt: count() })
    .from(practiceAttemptsTable)
    .where(and(eq(practiceAttemptsTable.userId, userId), eq(practiceAttemptsTable.correct, true)));
  const corrects = Number(correctCount[0]?.cnt ?? 0);
  const accuracy = total > 0 ? Math.round((corrects / total) * 100) : 0;
  const readinessScore = Math.min(100, Math.round((accuracy * 0.6) + (Math.min(scores.length, 5) * 4)));

  const [primaryCert] = await db.select({
    certificationId: userCertificationsTable.certificationId,
    examDate: userCertificationsTable.examDate,
  })
    .from(userCertificationsTable)
    .where(and(eq(userCertificationsTable.userId, userId), eq(userCertificationsTable.isPrimary, true)))
    .limit(1);

  let certName: string | null = null;
  if (primaryCert?.certificationId) {
    const [cert] = await db.select({ name: certificationsTable.name })
      .from(certificationsTable)
      .where(eq(certificationsTable.id, primaryCert.certificationId))
      .limit(1);
    certName = cert?.name || null;
  }

  res.json({
    userId,
    readinessScore,
    questionsAnswered: total,
    correctAnswers: corrects,
    accuracy,
    studyStreak: 0,
    timeStudiedMinutes: sessions.length * 30,
    completedSessions: sessions.length,
    mockExamScores: scores,
    bestMockScore: bestScore,
    certificationName: certName,
    examDate: primaryCert?.examDate || null,
  });
});

// GET /progress/domains
router.get("/progress/domains", requireAuth, async (req, res): Promise<void> => {
  const mastery = await db.select()
    .from(topicMasteryTable)
    .where(eq(topicMasteryTable.userId, req.userId!));

  const domainMap: Record<string, { masteryScore: number; questionsAnswered: number; correct: number }> = {};

  for (const m of mastery) {
    if (!domainMap[m.domain]) {
      domainMap[m.domain] = { masteryScore: 0, questionsAnswered: 0, correct: 0 };
    }
    domainMap[m.domain].masteryScore = Math.max(domainMap[m.domain].masteryScore, m.masteryScore);
    domainMap[m.domain].questionsAnswered += m.questionsAnswered;
    domainMap[m.domain].correct += m.correctAnswers;
  }

  const result = Object.entries(domainMap).map(([domain, data]) => ({
    domain,
    masteryScore: data.masteryScore,
    questionsAnswered: data.questionsAnswered,
    accuracy: data.questionsAnswered > 0 ? Math.round((data.correct / data.questionsAnswered) * 100) : 0,
    trend: "stable" as const,
  }));

  res.json(result);
});

// GET /progress/events
router.get("/progress/events", requireAuth, async (req, res): Promise<void> => {
  const events = await db.select()
    .from(progressEventsTable)
    .where(eq(progressEventsTable.userId, req.userId!))
    .orderBy(desc(progressEventsTable.createdAt))
    .limit(50);

  res.json(events);
});

export default router;

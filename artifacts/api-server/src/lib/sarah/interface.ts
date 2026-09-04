export interface SarahContext {
  recentMessages: Array<{ role: string; content: string }>;
  topicMastery: Array<{ domain: string; masteryScore: number }>;
  recentAnswers: Array<{ correct: boolean; domain: string }>;
  studyPlan: unknown | null;
  uploadedResources: Array<{
    id: string;
    filename: string;
    type?: string;
    mimeType?: string;
    url?: string;
    /**
     * Text extracted from the file at upload time.  Sarah cannot read files —
     * her upload endpoint says so outright ("I won't invent contents of files I
     * cannot read") — so without this an attached handbook is invisible to her.
     */
    textExcerpt?: string;
  }>;
}

export interface CreateConversationInput {
  userId: string;
  conversationId: string;   // Required by Sarah — the local conversation ID
  certificationId?: string | null;
  certificationName?: string | null;
  mode: string;
}

export interface CreateConversationResult {
  conversationId: string;
  openingMessage: SarahMessagePayload;
}

export interface SendMessageInput {
  requestId: string;
  userId: string;
  certificationId?: string | null;
  certificationName?: string | null;
  examDate?: string | null;
  conversationId: string;
  mode: string;
  message: { id: string; content: string };
  context: SarahContext;
}

export interface SarahMessagePayload {
  messageType: string;
  content: string;
  structuredData?: unknown;
}

export interface SendMessageResult {
  responseMessages: SarahMessagePayload[];
  jobCompleted: boolean;
  /** true when Sarah returned a degraded/error-type response (message.type === "error" or metadata.degraded) */
  degraded?: boolean;
}

export interface SubmitAnswerInput {
  userId: string;
  questionId: string;
  certificationId: string;
  selectedOptionId: string;
  confidenceLevel?: number | null;
  question: {
    prompt: string;
    options: Array<{ id: string; text: string }>;
    correctAnswer: string;
    domain: string;
    topic: string;
  };
}

export interface SubmitAnswerResult {
  correct: boolean;
  correctOptionId: string;
  feedbackMessage: string;
  explanation: string;
  optionExplanations: Record<string, string>;
  masteryUpdate: { domain: string; newScore: number };
  nextQuestionId?: string | null;
}

export interface StartStudyModeInput {
  userId: string;
  conversationId: string;
  mode: string;
  certificationId?: string | null;
  certificationName?: string | null;
}

export interface StartStudyModeResult {
  message: SarahMessagePayload;
}

export interface GenerateStudyPlanInput {
  userId: string;
  certificationId: string;
  certificationName: string;
  examDate?: string | null;
  weeklyHoursAvailable?: number | null;
  weakDomains?: string[];
  strongDomains?: string[];
}

export interface StudyPlanResult {
  examDate?: string | null;
  weeklyHoursAvailable?: number | null;
  weakDomains: string[];
  strongDomains: string[];
  milestones: unknown[];
  items: Array<{
    title: string;
    description?: string;
    scheduledDate: string;
    durationMinutes: number;
    itemType: string;
    domain?: string;
  }>;
}

export interface StartMockExamInput {
  userId: string;
  certificationId: string;
  certificationName: string;
  questionCount: number;
  timeLimitMinutes?: number | null;
}

export interface MockExamResult {
  questions: Array<{
    questionNumber: number;
    domain: string;
    prompt: string;
    options: Array<{ id: string; text: string }>;
    correctOptionId: string;
    explanation: string;
  }>;
}

export interface GradeMockExamInput {
  userId: string;
  examId: string;
  certificationId: string;
  answers: Array<{
    questionId: string;
    selectedOptionId: string | null;
    correctOptionId: string;
    domain: string;
  }>;
  timeTakenSeconds?: number | null;
}

export interface MockExamGradeResult {
  score: number;
  correctCount: number;
  totalCount: number;
  domainBreakdown: Array<{ domain: string; correctCount: number; totalCount: number }>;
  readinessUpdate?: number | null;
}

export interface AnalyzeUploadInput {
  userId: string;
  uploadId: string;
  filename: string;
  mimeType: string;
  conversationId?: string | null;
}

export interface AnalyzeUploadResult {
  message: SarahMessagePayload;
  extractedTopics?: string[];
}

export interface SarahHealthResult {
  status: "healthy" | "degraded" | "unavailable";
  latencyMs?: number | null;
  message?: string | null;
}

export interface SarahService {
  createConversation(input: CreateConversationInput): Promise<CreateConversationResult>;
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;
  submitAnswer(input: SubmitAnswerInput): Promise<SubmitAnswerResult>;
  startStudyMode(input: StartStudyModeInput): Promise<StartStudyModeResult>;
  generateStudyPlan(input: GenerateStudyPlanInput): Promise<StudyPlanResult>;
  startMockExam(input: StartMockExamInput): Promise<MockExamResult>;
  gradeMockExam(input: GradeMockExamInput): Promise<MockExamGradeResult>;
  analyzeUpload(input: AnalyzeUploadInput): Promise<AnalyzeUploadResult>;
  health(): Promise<SarahHealthResult>;
}

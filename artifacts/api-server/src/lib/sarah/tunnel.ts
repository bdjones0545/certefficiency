import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../logger";
import type {
  SarahService, CreateConversationInput, CreateConversationResult,
  SendMessageInput, SendMessageResult, SubmitAnswerInput, SubmitAnswerResult,
  StartStudyModeInput, StartStudyModeResult, GenerateStudyPlanInput, StudyPlanResult,
  StartMockExamInput, MockExamResult, GradeMockExamInput, MockExamGradeResult,
  AnalyzeUploadInput, AnalyzeUploadResult, SarahHealthResult,
} from "./interface";

const ENDPOINTS = {
  createConversation: "/v1/conversations",
  sendMessage: "/v1/messages",
  submitAnswer: "/v1/answers",
  startStudyMode: "/v1/study-modes/start",
  generateStudyPlan: "/v1/study-plans/generate",
  startMockExam: "/v1/mock-exams/start",
  gradeMockExam: "/v1/mock-exams/grade",
  analyzeUpload: "/v1/uploads/analyze",
  health: "/v1/health",
} as const;

// Canonical signing contract v1:
//   message = "<unix_seconds_timestamp>.<raw_body_utf8>"
//   signature = HMAC-SHA256(signingSecret, message).hex
// Both sides must agree on this contract version.
const CANONICAL_CONTRACT_VERSION = "1";

export class TunnelSarahService implements SarahService {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly signingSecret: string | null;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  constructor() {
    this.baseUrl = (process.env.SARAH_TUNNEL_URL || "").replace(/\/$/, "");
    this.apiKey = process.env.SARAH_API_KEY || "";
    this.signingSecret = process.env.SARAH_SIGNING_SECRET || null;
    this.timeoutMs = parseInt(process.env.SARAH_TIMEOUT_MS || "120000", 10);
    this.maxRetries = parseInt(process.env.SARAH_MAX_RETRIES || "3", 10);

    const isProduction = process.env.NODE_ENV === "production";

    if (!this.baseUrl) {
      const msg = "SARAH_TUNNEL_URL is not configured — tunnel adapter will fail on every call";
      if (isProduction) throw new Error(`FATAL: ${msg}`);
      logger.warn(msg);
    }
    if (!this.apiKey) {
      const msg = "SARAH_API_KEY is not configured — tunnel adapter will fail on every call";
      if (isProduction) throw new Error(`FATAL: ${msg}`);
      logger.warn(msg);
    }
    // SARAH_SIGNING_SECRET is optional in dev (produces unsigned requests — acceptable for
    // local Hermes instances).  In production, unsigned requests must never reach Hermes.
    if (!this.signingSecret) {
      const msg =
        "SARAH_SIGNING_SECRET is not set — requests to Hermes will be unsigned. " +
        "This is only acceptable in development.";
      if (isProduction) throw new Error(`FATAL: ${msg}`);
      logger.warn(msg);
    }
  }

  private sign(body: string, timestamp: string): string {
    if (!this.signingSecret) return "";
    // Contract v1: timestamp.body
    const message = `${timestamp}.${body}`;
    return crypto.createHmac("sha256", this.signingSecret).update(message).digest("hex");
  }

  private async request<T>(
    endpoint: string,
    body: unknown,
    idempotencyKey?: string,
    correlationId?: string,
  ): Promise<T> {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error("Sarah tunnel credentials are not configured. Set SARAH_TUNNEL_URL and SARAH_API_KEY.");
    }

    const corrId = correlationId || uuidv4();
    const iKey = idempotencyKey || uuidv4();
    const timestamp = Math.floor(Date.now() / 1000).toString(); // Unix seconds
    const bodyStr = JSON.stringify(body);
    const bodyBytes = Buffer.byteLength(bodyStr, "utf8");
    const signature = this.sign(bodyStr, timestamp);

    // §9 HMAC contract logging — safe fields only, no secret or full signature
    logger.info({
      corrId,
      endpoint,
      bodyByteLength: bodyBytes,
      timestampPresent: !!timestamp,
      signatureEncoding: "hex",
      signaturePresent: !!signature,
      canonicalContractVersion: CANONICAL_CONTRACT_VERSION,
      requestKeys: Object.keys(body as object),
    }, "sarah_request_prepared");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.apiKey}`,
      "X-Correlation-ID": corrId,
      "Idempotency-Key": iKey,
      "X-Timestamp": timestamp,
    };

    if (signature) {
      headers["X-CertEfficiency-Signature"] = signature;
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      if (attempt > 0) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise(r => setTimeout(r, backoffMs));
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(`${this.baseUrl}${endpoint}`, {
          method: "POST",
          headers,
          body: bodyStr,
          signal: controller.signal,
        });

        // §2 sarah_http_response_received
        logger.info({
          corrId,
          endpoint,
          httpStatus: res.status,
          ok: res.ok,
          attempt,
        }, "sarah_http_response_received");

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          logger.error({
            corrId,
            httpStatus: res.status,
            endpoint,
            errBody: errBody.slice(0, 500),
          }, "Sarah tunnel error response");

          if (res.status >= 500) {
            lastError = new Error(`Sarah service error: ${res.status}`);
            continue; // Retry on 5xx
          }
          throw new Error(`Sarah service rejected request: ${res.status} — ${errBody.slice(0, 200)}`);
        }

        const data = await res.json() as T;
        logger.info({ corrId, endpoint }, "Sarah tunnel request completed");
        return data;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (lastError.name === "AbortError") {
          lastError = new Error(`Sarah service request timed out after ${this.timeoutMs}ms`);
        }
        logger.warn({ corrId, endpoint, attempt, err: lastError.message }, "Sarah tunnel attempt failed");
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastError || new Error("Sarah service unavailable after retries");
  }

  async createConversation(input: CreateConversationInput): Promise<CreateConversationResult> {
    // Sarah requires a requestId in the body for identity/idempotency.
    const requestId = uuidv4();
    const raw = await this.request<Record<string, unknown>>(
      ENDPOINTS.createConversation,
      { ...input, requestId },
      requestId,
    );
    // Normalize: Sarah returns { conversationId, message: { type, content }, actions, metadata }
    // Our interface expects: { conversationId, openingMessage: { messageType, content, structuredData } }
    const msg = (raw.message ?? raw.openingMessage ?? {}) as Record<string, unknown>;
    return {
      conversationId: (raw.conversationId ?? raw.session_id ?? "") as string,
      openingMessage: {
        messageType: (msg.type ?? msg.messageType ?? "text") as string,
        content: (msg.content ?? "") as string,
        structuredData: { actions: raw.actions, metadata: raw.metadata } as unknown,
      },
    };
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    // §sarah.request.started — logged before the outbound HTTP call so failures
    // are always preceded by this event in the log trail.
    logger.info({
      corrId: input.requestId,
      conversationId: input.conversationId,
      mode: input.mode,
    }, "sarah.request.started");

    const raw = await this.request<Record<string, unknown>>(
      ENDPOINTS.sendMessage,
      input,
      input.requestId,
      input.requestId, // use requestId as correlationId for tracing
    );

    // §sarah.response.received — raw HTTP 200 body returned from Hermes
    logger.info({
      corrId: input.requestId,
      conversationId: input.conversationId,
    }, "sarah.response.received");

    // Normalize: Sarah returns { message: { type, content }, actions, progress, metadata }
    // Our interface expects: { responseMessages: [{ messageType, content, structuredData }], jobCompleted, degraded }

    // Pre-normalized path (future-proof): validate content before passing through
    if (Array.isArray((raw as any).responseMessages)) {
      const msgs = (raw as any).responseMessages as Array<Record<string, unknown>>;
      const firstContent = msgs[0]?.content;
      if (!firstContent || typeof firstContent !== "string" || !firstContent.trim()) {
        throw new Error("sarah.response.invalid: responseMessages[0].content is missing or empty");
      }
      return raw as unknown as SendMessageResult;
    }

    const msg = (raw.message ?? {}) as Record<string, unknown>;
    const meta = (raw.metadata ?? {}) as Record<string, unknown>;

    const messageType = (msg.type ?? msg.messageType ?? "text") as string;
    const content = (msg.content ?? "") as string;

    // §validation — require a non-empty string; empty content means Sarah had
    // nothing to say (malformed body, server-side error with a 200 envelope, etc.)
    // Throwing here causes dispatch to mark the job failed with a safe error code.
    if (!content || typeof content !== "string" || !content.trim()) {
      throw new Error("sarah.response.invalid: message.content is missing or empty");
    }

    // §degraded-detection — Sarah signals a degraded/error response via:
    //   • message.type === "error"   (explicit error type)
    //   • metadata.degraded === true (provider-level fallback)
    const isDegraded = messageType === "error" || meta.degraded === true;

    // §sarah.response.parsed — content validated and semantic fields extracted;
    // safe to log message type and degraded flag (never log raw content)
    logger.info({
      corrId: input.requestId,
      conversationId: input.conversationId,
      messageType,
      degraded: isDegraded,
      metaCorrelationId: typeof meta.correlationId === "string"
        ? meta.correlationId.slice(0, 36)
        : undefined,
    }, "sarah.response.parsed");

    return {
      responseMessages: [{
        messageType,
        content,
        structuredData: { actions: raw.actions, progress: raw.progress, metadata: raw.metadata } as unknown,
      }],
      jobCompleted: true,
      degraded: isDegraded,
    };
  }

  async submitAnswer(input: SubmitAnswerInput): Promise<SubmitAnswerResult> {
    return this.request<SubmitAnswerResult>(ENDPOINTS.submitAnswer, input);
  }

  async startStudyMode(input: StartStudyModeInput): Promise<StartStudyModeResult> {
    return this.request<StartStudyModeResult>(ENDPOINTS.startStudyMode, input);
  }

  async generateStudyPlan(input: GenerateStudyPlanInput): Promise<StudyPlanResult> {
    return this.request<StudyPlanResult>(ENDPOINTS.generateStudyPlan, input);
  }

  async startMockExam(input: StartMockExamInput): Promise<MockExamResult> {
    return this.request<MockExamResult>(ENDPOINTS.startMockExam, input);
  }

  async gradeMockExam(input: GradeMockExamInput): Promise<MockExamGradeResult> {
    return this.request<MockExamGradeResult>(ENDPOINTS.gradeMockExam, input);
  }

  async analyzeUpload(input: AnalyzeUploadInput): Promise<AnalyzeUploadResult> {
    return this.request<AnalyzeUploadResult>(ENDPOINTS.analyzeUpload, input);
  }

  async health(): Promise<SarahHealthResult> {
    if (!this.baseUrl || !this.apiKey) {
      return { status: "unavailable", message: "Tunnel credentials not configured" };
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    try {
      const start = Date.now();
      const res = await fetch(`${this.baseUrl}${ENDPOINTS.health}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: controller.signal,
      });
      const latencyMs = Date.now() - start;
      if (!res.ok) return { status: "degraded", latencyMs, message: `HTTP ${res.status}` };
      return { status: "healthy", latencyMs };
    } catch {
      return { status: "unavailable", message: "Could not reach Sarah tunnel" };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

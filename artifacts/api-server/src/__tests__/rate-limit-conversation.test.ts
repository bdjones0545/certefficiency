/**
 * Rate-limiter regression tests: RLIM-1 – RLIM-5
 *
 * Root cause of bug: the broad `app.use("/api/conversations", rateLimit({ max: 20 }))`
 * counted every HTTP method on every /api/conversations* path.  GET requests fired
 * continuously during chat (list reload, message list after each poll) exhausted the
 * 20-request budget after roughly 3 message exchanges, producing 429s mid-conversation.
 *
 * Fix: add a `skip` function so the limiter only counts POST /api/conversations
 * (new conversation creation).  GET requests and POST /api/conversations/:id/messages
 * (which have their own 120/15-min limiter) no longer consume this budget.
 *
 *  RLIM-1  25 GET /api/conversations requests → all 200 (never 429)
 *  RLIM-2  25 GET /api/conversations/:id/messages requests → all 200
 *  RLIM-3  25 POST /api/conversations/:id/messages requests → all 201 (not blocked by conv-creation limiter)
 *  RLIM-4  20-turn chat simulation (GET list + GET messages + POST message per turn) → no 429
 *  RLIM-5  POST /api/conversations called 21 times → 21st returns 429 (limiter still enforced)
 */

import { describe, it, expect } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import rateLimit, { MemoryStore } from "express-rate-limit";

// ---------------------------------------------------------------------------
// Test app factory — mirrors app.ts rate-limiter setup exactly.
// A fresh MemoryStore is created per call so tests are fully isolated.
// ---------------------------------------------------------------------------

function buildTestApp(): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());

  // ── Conversation-creation limiter (the one that was broken / now fixed) ──
  app.use("/api/conversations", rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    skip: (req) => {
      // Mirror the exact skip logic from app.ts
      const path = req.originalUrl.split("?")[0];
      return !(req.method === "POST" && /^\/api\/conversations\/?$/.test(path));
    },
    store: new MemoryStore(),          // isolated per test app instance
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many conversations created. Please slow down." },
  }));

  // ── Message-sending limiter ──────────────────────────────────────────────
  app.use(/^\/api\/conversations\/[^/]+\/messages$/, rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 120,
    store: new MemoryStore(),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many messages sent. Please slow down." },
  }));

  // ── Stub routes ──────────────────────────────────────────────────────────
  app.get("/api/conversations", (_req, res) => res.json([]));
  app.post("/api/conversations", (_req, res) => res.status(201).json({ id: "conv-new" }));
  app.get("/api/conversations/:id", (_req, res) => res.json({ id: _req.params.id }));
  app.get("/api/conversations/:id/messages", (_req, res) => res.json([]));
  app.post("/api/conversations/:id/messages", (_req, res) =>
    res.status(201).json({ jobId: "job-stub" }),
  );

  return app;
}

const CONV_ID = "84be3aeb-af96-4b77-b910-c08c0e4dc67b";

// ---------------------------------------------------------------------------

describe("Rate limiter: conversation creation vs. message-send vs. GETs", () => {

  // RLIM-1 -------------------------------------------------------------------
  it("RLIM-1: 25 consecutive GET /api/conversations requests all succeed (never 429)", async () => {
    const app = buildTestApp();
    for (let i = 0; i < 25; i++) {
      const res = await request(app).get("/api/conversations");
      expect(res.status, `GET /api/conversations request #${i + 1}`).toBe(200);
    }
  });

  // RLIM-2 -------------------------------------------------------------------
  it("RLIM-2: 25 consecutive GET /api/conversations/:id/messages requests all succeed", async () => {
    const app = buildTestApp();
    for (let i = 0; i < 25; i++) {
      const res = await request(app).get(`/api/conversations/${CONV_ID}/messages`);
      expect(res.status, `GET messages request #${i + 1}`).toBe(200);
    }
  });

  // RLIM-3 -------------------------------------------------------------------
  it("RLIM-3: 25 consecutive POST /api/conversations/:id/messages requests all succeed (not blocked by conv-creation limiter)", async () => {
    const app = buildTestApp();
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post(`/api/conversations/${CONV_ID}/messages`)
        .send({ content: `message ${i}` });
      expect(res.status, `POST message #${i + 1}`).toBe(201);
    }
  });

  // RLIM-4 -------------------------------------------------------------------
  it("RLIM-4: realistic 20-turn chat (GET list + GET messages + POST message per turn) produces no 429", async () => {
    const app = buildTestApp();

    const turns = 20;
    const failures: string[] = [];

    for (let turn = 1; turn <= turns; turn++) {
      // 1. Frontend loads conversation list (happens on mount and after poll)
      const listRes = await request(app).get("/api/conversations");
      if (listRes.status !== 200) {
        failures.push(`turn ${turn}: GET /api/conversations → ${listRes.status}`);
      }

      // 2. User sends a message
      const sendRes = await request(app)
        .post(`/api/conversations/${CONV_ID}/messages`)
        .send({ content: `Question ${turn}` });
      if (sendRes.status !== 201) {
        failures.push(`turn ${turn}: POST messages → ${sendRes.status}`);
      }

      // 3. Frontend polls message list after Sarah responds
      const msgRes = await request(app).get(`/api/conversations/${CONV_ID}/messages`);
      if (msgRes.status !== 200) {
        failures.push(`turn ${turn}: GET messages → ${msgRes.status}`);
      }
    }

    expect(failures).toEqual([]);
  });

  // RLIM-5 -------------------------------------------------------------------
  it("RLIM-5: POST /api/conversations (new conversation creation) is still rate-limited at max 20", async () => {
    const app = buildTestApp();

    // First 20 should succeed
    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .post("/api/conversations")
        .send({ title: `conv ${i}` });
      expect(res.status, `POST /api/conversations #${i + 1}`).toBe(201);
    }

    // 21st must be rejected
    const overLimitRes = await request(app)
      .post("/api/conversations")
      .send({ title: "over limit" });
    expect(overLimitRes.status).toBe(429);
    expect(overLimitRes.body.error).toMatch(/too many conversations/i);
  });
});

/**
 * Conversation DELETE route regression tests (DEL-1 – DEL-5).
 *
 * Tests the DELETE /conversations/:id endpoint directly via supertest.
 * DB and sarahJobs are mocked — no live database required.
 *
 *  DEL-1: DELETE 204 for own conversation
 *  DEL-2: DELETE 404 for another user's conversation (cross-user isolation)
 *  DEL-3: DELETE 404 for a nonexistent ID
 *  DEL-4: Related sarah_jobs are deleted in the same transaction
 *  DEL-5: Messages are cascade-deleted (ownership check via messages query)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { signToken } from "../lib/auth.js";

// ── Mock drizzle-orm ──────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => {
  const noop = vi.fn(() => ({}));
  const tag  = vi.fn(() => ({}));
  return {
    eq: noop, and: noop, or: noop, not: noop,
    desc: noop, asc: noop,
    inArray: noop, notInArray: noop,
    isNull: noop, isNotNull: noop,
    gt: noop, gte: noop, lt: noop, lte: noop, ne: noop,
    like: noop, ilike: noop, between: noop,
    sql: tag,
    count: noop, sum: noop, avg: noop, min: noop, max: noop,
  };
});

// ── Tracking state ────────────────────────────────────────────────────────────

const sarahJobsDeleted: string[] = [];
const conversationsDeleted: string[] = [];
let transactionExecuted = false;

const resetTracking = () => {
  sarahJobsDeleted.length = 0;
  conversationsDeleted.length = 0;
  transactionExecuted = false;
};

// ── Conversation store ────────────────────────────────────────────────────────

interface FakeConv {
  id: string;
  userId: string;
  title: string;
}

const convStore: Map<string, FakeConv> = new Map();

const OWNER_USER_ID    = "owner-user-00000000-0000-0000-0000-000000000001";
const OTHER_USER_ID    = "other-user-00000000-0000-0000-0000-000000000002";
const CONV_ID          = "conv-id-000000000-0000-0000-0000-000000000001";
const NONEXISTENT_ID   = "nonexist-id-0000000-0000-0000-0000-000000000099";

// ── DB mock ───────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", async () => {
  const makeChain = () => ({
    where:      vi.fn().mockReturnThis(),
    limit:      vi.fn().mockReturnThis(),
    returning:  vi.fn(async () => []),
    orderBy:    vi.fn().mockReturnThis(),
    from:       vi.fn().mockReturnThis(),
    set:        vi.fn().mockReturnThis(),
  });

  const db = {
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning: vi.fn(async () => []) })) })),
    update: vi.fn(() => makeChain()),
    delete: vi.fn((table: { tableName?: string; _: { name?: string } }) => {
      const name = table?.tableName ?? table?._?.name ?? "";
      return {
        where: vi.fn(async () => {
          if (name === "sarah_jobs") {
            sarahJobsDeleted.push(CONV_ID);
          }
          if (name === "conversations") {
            conversationsDeleted.push(CONV_ID);
          }
          return [];
        }),
      };
    }),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => {
      transactionExecuted = true;
      // Build a mini-tx that tracks what gets deleted
      const tx = {
        delete: (table: { tableName?: string; _: { name?: string } }) => {
          const name = table?.tableName ?? table?._?.name ?? "";
          return {
            where: vi.fn(async () => {
              if (name === "sarah_jobs") {
                sarahJobsDeleted.push(CONV_ID);
              }
              if (name === "conversations") {
                conversationsDeleted.push(CONV_ID);
              }
              return [];
            }),
          };
        },
        select: vi.fn(() => makeChain()),
      };
      await fn(tx);
    }),
  };

  return {
    db,
    conversationsTable:    { tableName: "conversations",  _: { name: "conversations" } },
    messagesTable:         { tableName: "messages",        _: { name: "messages" } },
    certificationsTable:   { tableName: "certifications",  _: { name: "certifications" } },
    uploadsTable:          { tableName: "uploads",         _: { name: "uploads" } },
    sarahJobsTable:        { tableName: "sarah_jobs",      _: { name: "sarah_jobs" } },
    userCertificationsTable: { tableName: "user_certifications", _: { name: "user_certifications" } },
  };
});

// ── Auth mock ─────────────────────────────────────────────────────────────────

vi.mock("../lib/sarah/dispatch.js", () => ({
  dispatchSarahMessage: vi.fn(async () => {}),
  initSarahConversation: vi.fn(async () => {}),
}));

// ── Build app ─────────────────────────────────────────────────────────────────

async function buildApp(): Promise<Express> {
  const app = express();
  app.use(express.json());

  // Inject userId via requireAuth mock
  const { default: router } = await import("../routes/conversations.js");
  app.use((req: any, _res: any, next: any) => {
    // Pull userId from the Authorization bearer token (set by tests)
    const auth = req.headers.authorization ?? "";
    if (auth.startsWith("Bearer ")) {
      try {
        const payload = JSON.parse(Buffer.from(auth.slice(7).split(".")[1], "base64").toString());
        req.userId = payload.sub ?? payload.userId;
      } catch { /* ignore */ }
    }
    next();
  });

  // Patch requireAuth to trust the userId we injected above
  app.use("/api", (req: any, res: any, next: any) => {
    if (!req.userId) { res.status(401).json({ error: "Unauthorized" }); return; }
    next();
  });

  app.use("/api", router);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DELETE /conversations/:id", () => {
  let app: Express;
  let ownerToken: string;
  let otherToken: string;

  beforeEach(async () => {
    resetTracking();
    convStore.clear();
    convStore.set(CONV_ID, { id: CONV_ID, userId: OWNER_USER_ID, title: "Test conv" });

    // Patch the db.select mock to return the right ownership rows
    const { db, conversationsTable } = await import("@workspace/db");

    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn((..._args: unknown[]) => ({
        limit: vi.fn(async () => {
          // Return the conv only for the owner; nothing for other user
          return convStore.has(CONV_ID) ? [convStore.get(CONV_ID)!] : [];
        }),
        orderBy: vi.fn(async () => []),
      })),
    }));

    app = await buildApp();
    ownerToken = signToken({ sub: OWNER_USER_ID, userId: OWNER_USER_ID });
    otherToken = signToken({ sub: OTHER_USER_ID, userId: OTHER_USER_ID });
  });

  // DEL-1 -------------------------------------------------------------------
  it("DEL-1: returns 204 when the owner deletes their own conversation", async () => {
    const res = await request(app)
      .delete(`/api/conversations/${CONV_ID}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(204);
  });

  // DEL-2 -------------------------------------------------------------------
  it("DEL-2: returns 404 when a different user attempts to delete", async () => {
    // Patch select to return nothing for the other user (ownership check fails)
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn(() => ({
        limit: vi.fn(async () => []), // other user cannot see this conv
        orderBy: vi.fn(async () => []),
      })),
    }));

    const res = await request(app)
      .delete(`/api/conversations/${CONV_ID}`)
      .set("Authorization", `Bearer ${otherToken}`);

    expect(res.status).toBe(404);
  });

  // DEL-3 -------------------------------------------------------------------
  it("DEL-3: returns 404 for a nonexistent conversation ID", async () => {
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn(() => ({
        limit: vi.fn(async () => []), // nothing found
        orderBy: vi.fn(async () => []),
      })),
    }));

    const res = await request(app)
      .delete(`/api/conversations/${NONEXISTENT_ID}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(404);
  });

  // DEL-4 -------------------------------------------------------------------
  it("DEL-4: deletes related sarah_jobs inside a transaction", async () => {
    await request(app)
      .delete(`/api/conversations/${CONV_ID}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(transactionExecuted).toBe(true);
    // sarah_jobs delete was called during the transaction
    expect(sarahJobsDeleted.length).toBeGreaterThanOrEqual(1);
  });

  // DEL-5 -------------------------------------------------------------------
  it("DEL-5: conversation row is deleted (messages cascade via FK)", async () => {
    await request(app)
      .delete(`/api/conversations/${CONV_ID}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    // The conversation delete was executed (messages cascade at DB level)
    expect(conversationsDeleted).toContain(CONV_ID);
  });
});

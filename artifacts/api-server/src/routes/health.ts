import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.setHeader("Cache-Control", "no-store");
  res.json(data);
});

async function databaseReadiness(_req: unknown, res: {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void };
  json(body: unknown): void;
}): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pool.query("select 1"),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("database health check timed out")), 2_000);
        timeout.unref();
      }),
    ]);
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable" });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

router.get("/readyz", databaseReadiness);
router.get("/health/database", databaseReadiness);

export default router;

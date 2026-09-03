/**
 * Sets video_object_key for all 10 existing AI Agent Course lessons so they
 * stream from Cloudflare R2 via short-lived presigned URLs.
 *
 * Safe to re-run — idempotent UPDATEs only; never inserts or deletes rows.
 *
 * Mismatch note: R2 contains lesson-1.mp4 through lesson-11.mp4 (11 objects)
 * but the database only has 10 lesson records (orders 1–10). lesson-11.mp4
 * exists in R2 but has no corresponding DB row. This script maps the 10 DB
 * records correctly and reports the mismatch at the end.
 *
 * Run:  pnpm --filter @workspace/scripts run update-all-lessons
 */
import pg from "pg";

const { Pool } = pg;

const LESSON_KEYS: Record<number, string> = {
  1:  "courses/ai-agent-builder/lesson-1.mp4",
  2:  "courses/ai-agent-builder/lesson-2.mp4",
  3:  "courses/ai-agent-builder/lesson-3.mp4",
  4:  "courses/ai-agent-builder/lesson-4.mp4",
  5:  "courses/ai-agent-builder/lesson-5.mp4",
  6:  "courses/ai-agent-builder/lesson-6.mp4",
  7:  "courses/ai-agent-builder/lesson-7.mp4",
  8:  "courses/ai-agent-builder/lesson-8.mp4",
  9:  "courses/ai-agent-builder/lesson-9.mp4",
  10: "courses/ai-agent-builder/lesson-10.mp4",
  11: "courses/ai-agent-builder/lesson-11.mp4",
};

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({ connectionString: dbUrl });

  try {
    // Resolve the course
    const courseRes = await pool.query(
      "SELECT id FROM platform_courses WHERE slug = 'ai-agent-builder' LIMIT 1",
    );
    if (!courseRes.rows.length) {
      throw new Error("Course 'ai-agent-builder' not found in the database");
    }
    const courseId = courseRes.rows[0].id as string;

    // Count existing lessons (sanity check before writing)
    const countRes = await pool.query(
      `SELECT COUNT(*) AS n FROM platform_lessons WHERE course_id = $1`,
      [courseId],
    );
    const lessonCount = parseInt(countRes.rows[0].n as string, 10);
    console.log(`\nFound ${lessonCount} lesson records for 'ai-agent-builder'.`);

    const results: Array<{ order: number; title: string; id: string; key: string; changed: boolean }> = [];

    for (const [orderStr, objectKey] of Object.entries(LESSON_KEYS)) {
      const order = parseInt(orderStr, 10);

      const res = await pool.query<{
        id: string;
        title: string;
        order: number;
        video_object_key: string | null;
      }>(
        `UPDATE platform_lessons
           SET video_object_key = $1,
               updated_at       = NOW()
         WHERE course_id = $2
           AND "order"   = $3
         RETURNING id, title, "order", video_object_key`,
        [objectKey, courseId, order],
      );

      if (!res.rows.length) {
        console.error(`  ⚠  Lesson ${order}: no record found — skipped`);
        continue;
      }

      const row = res.rows[0];
      results.push({
        order: row.order,
        title: row.title,
        id: row.id,
        key: row.video_object_key ?? objectKey,
        changed: row.video_object_key === objectKey,
      });
    }

    // Print results table
    console.log("\nLesson R2 key mapping:\n");
    console.log(
      "  Order  Title".padEnd(45) + "  Object Key",
    );
    console.log("  " + "─".repeat(78));
    for (const r of results.sort((a, b) => a.order - b.order)) {
      const label = `  ${String(r.order).padEnd(5)}  ${r.title}`.padEnd(45);
      console.log(`${label}  ${r.key}`);
    }

    console.log(`\n✓ Updated ${results.length} lesson records.`);

    if (results.length < 11) {
      console.error(`\n⚠  WARNING: Only ${results.length}/11 lessons were updated.`);
      if (results.length === 10) {
        console.error(
          "   Lesson 11 DB record may not exist yet.",
          "Run: pnpm --filter @workspace/scripts run seed-lesson11",
        );
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

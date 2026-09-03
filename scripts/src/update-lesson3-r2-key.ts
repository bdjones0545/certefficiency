/**
 * Sets video_object_key = 'courses/ai-agent-builder/lesson-3.mp4' on the
 * existing Lesson 3 record so the R2 playback endpoint can serve it.
 *
 * Safe to re-run — idempotent UPDATE with RETURNING.
 *
 * Run:  pnpm --filter @workspace/scripts run update-lesson3
 */
import pg from "pg";

const { Pool } = pg;

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({ connectionString: dbUrl });

  try {
    // Resolve the course ID
    const courseRes = await pool.query(
      "SELECT id FROM platform_courses WHERE slug = 'ai-agent-builder' LIMIT 1",
    );
    if (!courseRes.rows.length) throw new Error("Course 'ai-agent-builder' not found in DB");
    const courseId = courseRes.rows[0].id as string;

    // Set the R2 object key for Lesson 3
    const updateRes = await pool.query(
      `UPDATE platform_lessons
       SET video_object_key = $1,
           updated_at       = NOW()
       WHERE course_id = $2 AND "order" = 3
       RETURNING id, title, "order", video_object_key`,
      ["courses/ai-agent-builder/lesson-3.mp4", courseId],
    );

    if (!updateRes.rows.length) {
      throw new Error("Lesson 3 not found for course " + courseId);
    }

    const row = updateRes.rows[0];
    console.log(`\n✓ Updated Lesson ${row.order}: "${row.title}"`);
    console.log(`  id              : ${row.id}`);
    console.log(`  video_object_key: ${row.video_object_key}`);
    console.log("\nLesson 3 is now wired to R2. Enrolled users can play it via /playback.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

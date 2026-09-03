/**
 * Creates the missing Lesson 11 record for the AI Agent Course and sets its
 * R2 object key.  Safe to run more than once — uses an upsert (INSERT ... ON
 * CONFLICT DO NOTHING) guarded by (course_id, "order"), so a second run
 * leaves the existing row untouched.
 *
 * Run:  pnpm --filter @workspace/scripts run seed-lesson11
 */
import pg from "pg";

const { Pool } = pg;

const LESSON_11 = {
  title: "Deploying and Operating Your Complete AI Worker",
  description:
    "Connect the complete system, validate the worker's identity, knowledge, skills, tools, memory, permissions, and persistent operation, and prepare it for secure real-world use.",
  instructorNotes:
    "This is the capstone lesson. Work through the final checklist before considering your agent production-ready.",
  duration: "~40 min",
  order: 11,
  freePreview: false,
  videoObjectKey: "courses/ai-agent-builder/lesson-11.mp4",
  videoEnvVar: "AI_LESSON_11_VIDEO_ID",
} as const;

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({ connectionString: dbUrl });

  try {
    // ── Resolve the course ──────────────────────────────────────────────────
    const courseRes = await pool.query<{ id: string }>(
      "SELECT id FROM platform_courses WHERE slug = 'ai-agent-builder' LIMIT 1",
    );
    if (!courseRes.rows.length) {
      throw new Error("Course 'ai-agent-builder' not found in the database");
    }
    const courseId = courseRes.rows[0].id;

    // ── Guard: confirm no existing Lesson 11 already (detect before inserting)
    const existingRes = await pool.query<{ id: string; title: string }>(
      `SELECT id, title FROM platform_lessons WHERE course_id = $1 AND "order" = 11 LIMIT 1`,
      [courseId],
    );

    if (existingRes.rows.length) {
      const row = existingRes.rows[0];
      console.log(`\n↩  Lesson 11 already exists — no changes made.`);
      console.log(`   id   : ${row.id}`);
      console.log(`   title: ${row.title}`);

      // Still ensure video_object_key is set (handles partial prior runs)
      await pool.query(
        `UPDATE platform_lessons
           SET video_object_key = $1, updated_at = NOW()
         WHERE course_id = $2 AND "order" = 11 AND (video_object_key IS NULL OR video_object_key = '')`,
        [LESSON_11.videoObjectKey, courseId],
      );
      console.log(`   video_object_key: ${LESSON_11.videoObjectKey} (ensured)\n`);
      return;
    }

    // ── Insert Lesson 11 ────────────────────────────────────────────────────
    const insertRes = await pool.query<{ id: string }>(
      `INSERT INTO platform_lessons
         (course_id, "order", title, description, instructor_notes, duration,
          free_preview, video_object_key, video_env_var, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING id`,
      [
        courseId,
        LESSON_11.order,
        LESSON_11.title,
        LESSON_11.description,
        LESSON_11.instructorNotes,
        LESSON_11.duration,
        LESSON_11.freePreview,
        LESSON_11.videoObjectKey,
        LESSON_11.videoEnvVar,
      ],
    );

    const newId = insertRes.rows[0].id;

    // ── Verify final lesson count ───────────────────────────────────────────
    const countRes = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM platform_lessons WHERE course_id = $1`,
      [courseId],
    );

    console.log(`\n✓ Created Lesson 11`);
    console.log(`   id              : ${newId}`);
    console.log(`   title           : ${LESSON_11.title}`);
    console.log(`   order           : ${LESSON_11.order}`);
    console.log(`   free_preview    : ${LESSON_11.freePreview}`);
    console.log(`   video_object_key: ${LESSON_11.videoObjectKey}`);
    console.log(`   duration        : ${LESSON_11.duration}`);
    console.log(`\n   Total lesson count: ${countRes.rows[0].n}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

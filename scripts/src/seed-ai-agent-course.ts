/**
 * Seed the AI Agent Builder course into Stripe + the platform_courses / platform_lessons tables.
 * Safe to run multiple times (idempotent).
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run seed-ai-course
 */

import { getUncachableStripeClient as getStripeClient } from "./stripeClient.js";
import pg from "pg";

const { Pool } = pg;

const COURSE_SLUG = "ai-agent-builder";
const COURSE_TITLE = "How to Build an AI Agent";
const PRICE_USD_CENTS = 49700; // $497

const LESSONS = [
  {
    order: 1,
    title: "Introduction",
    description:
      "Course overview, what you will build, the full architecture, and what makes production AI agents different from chatbots.",
    instructorNotes:
      "Watch this lesson first. It lays the conceptual foundation for everything that follows.",
    duration: "~18 min",
    freePreview: true,
    videoEnvVar: "AI_LESSON_1_VIDEO_ID",
  },
  {
    order: 2,
    title: "Planning Your AI Worker",
    description:
      "Define the agent's purpose, capabilities, boundaries, and personality. Map out the full system before writing a line of code.",
    instructorNotes:
      "Spend time on the planning worksheet before moving to the build lessons.",
    duration: "~25 min",
    freePreview: false,
    videoEnvVar: "AI_LESSON_2_VIDEO_ID",
  },
  {
    order: 3,
    title: "Building the Foundation",
    description:
      "Set up the project structure, runtime environment, dependencies, and configuration that every production agent needs.",
    instructorNotes:
      "Follow along in your own terminal. The repo scaffold is linked below.",
    duration: "~30 min",
    freePreview: false,
    videoEnvVar: "AI_LESSON_3_VIDEO_ID",
  },
  {
    order: 4,
    title: "Creating the Agent Identity",
    description:
      "Build the agent's system prompt, persona, domain knowledge, and response style using the Hermes framework.",
    instructorNotes:
      "Identity is the most important design decision you will make. Take your time here.",
    duration: "~28 min",
    freePreview: false,
    videoEnvVar: "AI_LESSON_4_VIDEO_ID",
  },
  {
    order: 5,
    title: "Adding Skills & Memory",
    description:
      "Implement conversation memory, long-term knowledge storage, and modular skills that your agent can call on demand.",
    instructorNotes:
      "Memory design is what separates a useful agent from a toy. Reference the Obsidian vault pattern.",
    duration: "~32 min",
    freePreview: false,
    videoEnvVar: "AI_LESSON_5_VIDEO_ID",
  },
  {
    order: 6,
    title: "Connecting Tools",
    description:
      "Wire up external tools — search, calendar, email, APIs, databases — and give the agent real-world execution capabilities.",
    instructorNotes: "Use the tool-calling patterns shown here as templates for any new tool.",
    duration: "~28 min",
    freePreview: false,
    videoEnvVar: "AI_LESSON_6_VIDEO_ID",
  },
  {
    order: 7,
    title: "Persistent Infrastructure",
    description:
      "Stand up the persistent VM, process manager, database, and logging stack that keeps your agent running 24/7.",
    instructorNotes:
      "This is the lesson most tutorials skip. Do not skip it.",
    duration: "~35 min",
    freePreview: false,
    videoEnvVar: "AI_LESSON_7_VIDEO_ID",
  },
  {
    order: 8,
    title: "Internet Access & Cloudflare Tunnel",
    description:
      "Expose your agent securely to the web using Cloudflare Tunnel — no open ports, no public IP, production-grade security.",
    instructorNotes:
      "The tunnel approach is how CertEfficiency itself works in production.",
    duration: "~30 min",
    freePreview: false,
    videoEnvVar: "AI_LESSON_8_VIDEO_ID",
  },
  {
    order: 9,
    title: "Production Deployment",
    description:
      "Configure environment secrets, health checks, auto-restart policies, monitoring, and alerting for a production-grade rollout.",
    instructorNotes: "Run through the deployment checklist in the lesson resources before going live.",
    duration: "~35 min",
    freePreview: false,
    videoEnvVar: "AI_LESSON_9_VIDEO_ID",
  },
  {
    order: 10,
    title: "Final Build & Real-World Applications",
    description:
      "Complete the full agent build, walk through real business workflow examples, and map your next steps for expanding the platform.",
    instructorNotes:
      "By the end of this lesson you will have a fully operational production AI agent.",
    duration: "~40 min",
    freePreview: false,
    videoEnvVar: "AI_LESSON_10_VIDEO_ID",
  },
];

async function main() {
  // ── 1. Stripe ──────────────────────────────────────────────────────────────
  const stripe = await getStripeClient();

  let productId: string;
  let priceId: string;

  // Check for existing product
  const existing = await stripe.products.search({
    query: `name:"${COURSE_TITLE}"`,
    limit: 1,
  });

  if (existing.data.length > 0) {
    productId = existing.data[0].id;
    console.log(`✓ Found existing product: ${COURSE_TITLE} (${productId})`);

    // Find active price for this product
    const prices = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 1,
    });

    if (prices.data.length > 0) {
      priceId = prices.data[0].id;
      console.log(`✓ Found existing price: $${prices.data[0].unit_amount! / 100} (${priceId})`);
    } else {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: PRICE_USD_CENTS,
        currency: "usd",
      });
      priceId = price.id;
      console.log(`✓ Created price: $${PRICE_USD_CENTS / 100} one-time (${priceId})`);
    }
  } else {
    const product = await stripe.products.create({
      name: COURSE_TITLE,
      description:
        "Learn how to design, build, deploy, and manage production-ready AI agents. " +
        "10 comprehensive HD lessons with lifetime access.",
      metadata: { courseSlug: COURSE_SLUG },
    });
    productId = product.id;
    console.log(`✓ Created product: ${COURSE_TITLE} (${productId})`);

    const price = await stripe.prices.create({
      product: productId,
      unit_amount: PRICE_USD_CENTS,
      currency: "usd",
    });
    priceId = price.id;
    console.log(`✓ Created price: $${PRICE_USD_CENTS / 100} one-time (${priceId})`);
  }

  // ── 2. Database ────────────────────────────────────────────────────────────
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    // Upsert course
    const courseResult = await pool.query(
      `INSERT INTO platform_courses (slug, title, subtitle, description, instructor, price_usd, published, stripe_product_id, stripe_price_id)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
       ON CONFLICT (slug) DO UPDATE SET
         title            = EXCLUDED.title,
         subtitle         = EXCLUDED.subtitle,
         description      = EXCLUDED.description,
         published        = true,
         stripe_product_id = EXCLUDED.stripe_product_id,
         stripe_price_id  = EXCLUDED.stripe_price_id,
         updated_at       = NOW()
       RETURNING id`,
      [
        COURSE_SLUG,
        COURSE_TITLE,
        "Learn how to design, build, deploy, and manage production-ready AI agents using the exact architecture I use in my own business.",
        "This course teaches far more than prompting. You'll build a complete AI worker with identity, memory, skills, tools, persistent infrastructure, secure networking, and real-world business applications.",
        "CertEfficiency",
        497,
        productId,
        priceId,
      ],
    );

    const courseId: string = courseResult.rows[0].id;
    console.log(`✓ Upserted course in DB (id: ${courseId})`);

    // Upsert lessons
    for (const lesson of LESSONS) {
      await pool.query(
        `INSERT INTO platform_lessons (course_id, title, description, instructor_notes, video_env_var, duration, "order", free_preview)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
        [
          courseId,
          lesson.title,
          lesson.description,
          lesson.instructorNotes,
          lesson.videoEnvVar,
          lesson.duration,
          lesson.order,
          lesson.freePreview,
        ],
      );
    }
    console.log(`✓ Upserted ${LESSONS.length} lessons`);
  } finally {
    await pool.end();
  }

  // ── 3. Instructions ────────────────────────────────────────────────────────
  console.log("\n────────────────────────────────────────");
  console.log("AI Agent course is ready.");
  console.log("Stripe price ID (already stored in DB — no extra env var needed).");
  console.log("\nOptional: set HeyGen video IDs as Replit Secrets:");
  for (const l of LESSONS) {
    console.log(`  ${l.videoEnvVar}=<heygen-embed-id>`);
  }
  console.log("────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

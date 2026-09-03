/**
 * Seed the NSCA CSCS Practical & Applied Masterclass product and price in Stripe.
 *
 * Run once:
 *   pnpm --filter @workspace/scripts run seed-course
 *
 * After running, copy the printed PRICE_ID into the CSCS_COURSE_PRICE_ID secret
 * in your Replit workspace (Secrets tab or environment-secrets skill).
 */
import { getUncachableStripeClient } from "./stripeClient.js";

const PRODUCT_NAME = "NSCA CSCS Practical & Applied Masterclass";
const PRICE_USD = 49700; // $497.00 in cents

async function seed() {
  const stripe = await getUncachableStripeClient();

  // Idempotent: check if product already exists
  const existing = await stripe.products.search({
    query: `name:'${PRODUCT_NAME}' AND active:'true'`,
  });

  let productId: string;

  if (existing.data.length > 0) {
    productId = existing.data[0].id;
    console.log(`✓ Product already exists: ${productId}`);
  } else {
    const product = await stripe.products.create({
      name: PRODUCT_NAME,
      description:
        "10 HD lessons covering every domain of the CSCS Practical & Applied section. Lifetime access. Future updates included.",
      metadata: {
        courseId: "cscs-practical",
        platform: "certefficiency",
      },
    });
    productId = product.id;
    console.log(`✓ Created product: ${product.name} (${productId})`);
  }

  // Check if a $497 price already exists for this product
  const prices = await stripe.prices.list({ product: productId, active: true });
  const existingPrice = prices.data.find((p) => p.unit_amount === PRICE_USD && p.currency === "usd");

  if (existingPrice) {
    console.log(`✓ Price already exists: ${existingPrice.id}`);
    console.log(`\n→ Set this in your Replit Secrets:\n  CSCS_COURSE_PRICE_ID=${existingPrice.id}\n`);
    return;
  }

  const price = await stripe.prices.create({
    product: productId,
    unit_amount: PRICE_USD,
    currency: "usd",
  });

  console.log(`✓ Created price: $${PRICE_USD / 100} one-time (${price.id})`);
  console.log(`\n→ Set this in your Replit Secrets:\n  CSCS_COURSE_PRICE_ID=${price.id}\n`);
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});

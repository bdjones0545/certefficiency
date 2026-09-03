import { db } from "./index";
import { certificationsTable } from "./schema";
import { eq } from "drizzle-orm";

const CERTIFICATIONS = [
  {
    name: "NSCA Certified Strength and Conditioning Specialist",
    code: "NSCA-CSCS",
    category: "Fitness & Strength",
    description: "The gold standard for strength and conditioning professionals working with athletes. Covers exercise science, nutrition, program design, testing, and administration.",
  },
  {
    name: "NASM Certified Personal Trainer",
    code: "NASM-CPT",
    category: "Personal Training",
    description: "Industry-leading personal trainer certification using the Optimum Performance Training (OPT) model. Covers assessment, program design, and client relations.",
  },
  {
    name: "ACSM Certified Exercise Physiologist",
    code: "ACSM-EP",
    category: "Clinical Exercise",
    description: "Advanced clinical certification for exercise physiologists working with healthy populations and those with controlled diseases. Covers ECG, fitness testing, and health appraisal.",
  },
  {
    name: "ACE Certified Personal Trainer",
    code: "ACE-CPT",
    category: "Personal Training",
    description: "Comprehensive personal training certification from the American Council on Exercise. Focuses on client interviews, functional and physiological assessments, and program design.",
  },
  {
    name: "Project Management Professional",
    code: "PMP",
    category: "Project Management",
    description: "The world's leading project management certification from PMI. Covers predictive, agile, and hybrid project delivery frameworks.",
  },
  {
    name: "CompTIA Security+",
    code: "COMPTIA-SEC+",
    category: "Cybersecurity",
    description: "Vendor-neutral cybersecurity certification covering threats, vulnerabilities, cryptography, network security, identity management, and risk management.",
  },
  {
    name: "AWS Certified Solutions Architect – Associate",
    code: "AWS-SAA-C03",
    category: "Cloud Computing",
    description: "Design and deploy scalable, highly available, and fault-tolerant systems on AWS. Covers compute, storage, networking, databases, security, and cost optimization.",
  },
  {
    name: "ACSM Certified Personal Trainer",
    code: "ACSM-CPT",
    category: "Personal Training",
    description: "Entry-level personal trainer certification from the American College of Sports Medicine. Covers exercise testing, prescription, and client education.",
  },
  {
    name: "NASM Certified Nutrition Coach",
    code: "NASM-CNC",
    category: "Nutrition",
    description: "Nutrition coaching certification covering macronutrients, micronutrients, meal planning, behavioral change, and client counseling strategies.",
  },
  {
    name: "Google Cloud Professional Cloud Architect",
    code: "GCP-PCA",
    category: "Cloud Computing",
    description: "Design, develop, and manage robust, secure, scalable, and highly available solutions using Google Cloud technologies.",
  },
  {
    name: "Certified Information Systems Security Professional",
    code: "CISSP",
    category: "Cybersecurity",
    description: "Advanced cybersecurity certification for experienced security practitioners, covering security and risk management, asset security, architecture, communication, and software development security.",
  },
  {
    name: "Microsoft Azure Administrator",
    code: "AZ-104",
    category: "Cloud Computing",
    description: "Implement, monitor, and maintain Microsoft Azure solutions, including major services related to compute, storage, network, and security.",
  },
];

export async function seedCertifications() {
  console.log("Seeding certifications...");
  let added = 0;
  let skipped = 0;

  for (const cert of CERTIFICATIONS) {
    const existing = await db.select({ id: certificationsTable.id })
      .from(certificationsTable)
      .where(eq(certificationsTable.code, cert.code))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(certificationsTable).values(cert);
      added++;
      console.log(`  Added: ${cert.code}`);
    } else {
      skipped++;
    }
  }

  console.log(`Seed complete. Added: ${added}, Skipped: ${skipped}`);
}

// Run if called directly
seedCertifications()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });

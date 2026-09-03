// ---------------------------------------------------------------------------
// CertEfficiency — Centralized Landing Page Content & Pricing
//
// Edit this file to update all copy and pricing across the landing page.
// ---------------------------------------------------------------------------

export const SITE_NAME = "CertEfficiency";

// ---------------------------------------------------------------------------
// Pricing tiers
// ---------------------------------------------------------------------------

export interface PricingTier {
  id: string;
  name: string;
  tagline: string;
  price: string | null; // null = contact sales
  pricePeriod: string;
  description: string;
  cta: string;
  ctaHref: string;
  featured: boolean;
  features: string[];
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: "individual",
    name: "Individual",
    tagline: "For one learner",
    price: null,
    pricePeriod: "/ month",
    description: "One learner preparing for a professional certification.",
    cta: "Start a Conversation",
    ctaHref: "/auth/register",
    featured: false,
    features: [
      "Personal conversation with Sarah",
      "One active certification workspace",
      "File uploads for source materials",
      "Personalized study planning",
      "AI-generated study materials",
      "Interactive practice in chat",
      "Continuous learning memory",
      "Progress summaries",
      "Desktop and mobile access",
    ],
  },
  {
    id: "professional",
    name: "Professional",
    tagline: "For serious learners",
    price: null,
    pricePeriod: "/ month",
    description: "Multiple certifications or expanded usage.",
    cta: "Start a Conversation",
    ctaHref: "/auth/register",
    featured: true,
    features: [
      "Everything in Individual",
      "Multiple certification workspaces",
      "Expanded conversation history",
      "Higher upload limits",
      "Additional study-plan generation",
      "Cross-certification learner profile",
      "Priority support",
    ],
  },
  {
    id: "organization",
    name: "Organization",
    tagline: "For teams",
    price: null,
    pricePeriod: "contact us",
    description: "Schools, training companies, employers, and certification organizations.",
    cta: "Explore for Organizations",
    ctaHref: "mailto:hello@certefficiency.com",
    featured: false,
    features: [
      "Private certification environments",
      "Multiple learners per workspace",
      "Controlled source materials",
      "Custom Sarah instructions",
      "Instructor reporting",
      "Cohort management",
      "Content approval workflows",
      "Administrative controls",
      "Custom certifications",
      "Internal workforce credentials",
    ],
  },
];

// ---------------------------------------------------------------------------
// Animated prompts (cycling in the prompts demo section)
// ---------------------------------------------------------------------------

export const ANIMATED_PROMPTS = [
  "Create a six-week study plan for my exam.",
  "Explain this topic in simpler terms.",
  "Quiz me on what I studied yesterday.",
  "Turn this handbook into a study guide.",
  "Show me the concepts I keep missing.",
  "Do you think I am ready for the exam?",
];

// ---------------------------------------------------------------------------
// Certification examples (flexibility section)
// ---------------------------------------------------------------------------

export const CERT_EXAMPLES = [
  { prompt: "Help me prepare for the CSCS exam.", area: "Health & Fitness" },
  { prompt: "Build a study plan for CompTIA Security+.", area: "Information Technology" },
  { prompt: "Turn my PMP materials into a six-week course.", area: "Project Management" },
  { prompt: "Quiz me for my EMT certification.", area: "Healthcare" },
  { prompt: "Help our employees prepare for a safety credential.", area: "Safety & Compliance" },
  { prompt: "Create a study workspace for our CPA prep.", area: "Finance & Accounting" },
];

// ---------------------------------------------------------------------------
// Sarah capabilities
// ---------------------------------------------------------------------------

export const SARAH_CAPABILITIES = [
  "Understanding certification requirements",
  "Organizing source materials",
  "Creating study plans",
  "Producing structured study materials",
  "Explaining difficult concepts",
  "Asking follow-up questions",
  "Generating practice questions",
  "Evaluating learner responses",
  "Identifying recurring mistakes",
  "Revisiting weak topics",
  "Tracking learning history",
  "Recommending what to study next",
  "Adapting explanations to the learner",
  "Maintaining context over time",
];

// ---------------------------------------------------------------------------
// Individual benefits
// ---------------------------------------------------------------------------

export const INDIVIDUAL_BENEFITS = [
  "Less time deciding what to study",
  "Explanations tailored to you",
  "Continuous learning context across sessions",
  "Practice based on actual weaknesses",
  "Flexible preparation across devices",
  "A direct path back into studying",
];

// ---------------------------------------------------------------------------
// Organization capabilities
// ---------------------------------------------------------------------------

export const ORG_CAPABILITIES = [
  "Private Sarah configurations per certification",
  "Organization-controlled source materials",
  "Custom tutoring instructions",
  "Cohort access and management",
  "Learner conversation history",
  "Instructor visibility and reporting",
  "Assignment prompts",
  "Approved assessments",
  "Progress summaries",
  "Content governance",
  "Custom certifications",
  "Internal workforce credentials",
];

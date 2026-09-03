/**
 * Static course catalog.
 *
 * Video embed IDs are read from environment variables so they can be configured
 * without code changes. Set LESSON_N_VIDEO_ID (N = 1–10) in your Replit Secrets
 * to the HeyGen video ID for each lesson.
 *
 * HeyGen embed URL format: https://app.heygen.com/embeds/{VIDEO_ID}
 */

export interface Lesson {
  number: number;
  title: string;
  duration: string;
  description: string;
  free: boolean;
  videoEmbedId: string | null;
  videoEmbedUrl: string | null;
}

export interface Course {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  priceUsd: number; // dollars
  priceStripe: number; // cents
  lessons: Lesson[];
}

function heygenUrl(videoId: string | null): string | null {
  if (!videoId || videoId.startsWith("placeholder")) return null;
  return `https://app.heygen.com/embeds/${videoId}`;
}

function lessonVideoId(n: number): string | null {
  return process.env[`LESSON_${n}_VIDEO_ID`] || null;
}

const LESSON_DATA = [
  { number: 1, title: "Introduction", duration: "~12 min", description: "Welcome to the course. Learn how the Practical & Applied domain is structured and what to expect on exam day.", free: true },
  { number: 2, title: "Movement Assessment", duration: "~20 min", description: "Master functional movement screening, overhead squat analysis, and corrective strategies.", free: false },
  { number: 3, title: "Exercise Technique", duration: "~22 min", description: "Biomechanical breakdowns of major strength movements with cueing frameworks.", free: false },
  { number: 4, title: "Program Design", duration: "~25 min", description: "Periodization models, load-volume progressions, and athlete periodization case studies.", free: false },
  { number: 5, title: "Speed & Agility", duration: "~18 min", description: "Sprint mechanics, change-of-direction drills, and speed development programming.", free: false },
  { number: 6, title: "Olympic Lifting", duration: "~20 min", description: "Clean, snatch, and jerk technique analysis for both coaching and exam scenarios.", free: false },
  { number: 7, title: "Testing & Evaluation", duration: "~18 min", description: "Field and laboratory tests: VO2max, strength, power, and body composition protocols.", free: false },
  { number: 8, title: "Special Populations", duration: "~20 min", description: "Programming adaptations for youth, older adults, and athletes returning from injury.", free: false },
  { number: 9, title: "Case Studies", duration: "~22 min", description: "Work through realistic exam-style client scenarios from intake to program execution.", free: false },
  { number: 10, title: "Final Review", duration: "~15 min", description: "High-yield exam tips, test-taking strategy, and a rapid-fire review of key concepts.", free: false },
];

function buildLesson(data: typeof LESSON_DATA[number]): Lesson {
  const videoId = lessonVideoId(data.number);
  return {
    ...data,
    videoEmbedId: videoId,
    videoEmbedUrl: heygenUrl(videoId),
  };
}

export const COURSES: Record<string, Course> = {
  "cscs-practical": {
    id: "cscs-practical",
    title: "NSCA CSCS Practical & Applied Masterclass",
    subtitle:
      "Master the Practical & Applied portion of the CSCS exam through concise lessons designed to help you think like a strength coach—not memorize like a student.",
    description:
      "10 focused HD lessons covering every domain of the CSCS Practical & Applied section. Built for coaches who want to pass—not just study.",
    priceUsd: 497,
    priceStripe: 49700,
    lessons: LESSON_DATA.map(buildLesson),
  },
};

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Logo } from "@/components/logo";
import {
  Lock,
  Play,
  CheckCircle2,
  Star,
  ChevronRight,
  Video,
  Clock,
  Users,
  Award,
  Zap,
  BookOpen,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGetMe } from "@workspace/api-client-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface LessonData {
  number: number;
  title: string;
  duration: string;
  description: string;
  free: boolean;
  videoEmbedUrl: string | null;
  locked: boolean;
}

interface CourseData {
  id: string;
  title: string;
  subtitle: string;
  priceUsd: number;
  lessons: LessonData[];
  hasAccess: boolean;
}

interface ProgressStats {
  completedLessons: number;
  totalLessons: number;
  percentage: number;
  lastWatchedLesson: number | null;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem("certefficiency_token");
  const resp = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({ error: "Request failed" }));
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data as T;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function VideoPlaceholder({ lesson }: { lesson: LessonData }) {
  return (
    <div className="w-full aspect-video bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl flex flex-col items-center justify-center text-white gap-4 shadow-2xl">
      <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
        <Video className="w-8 h-8 text-white/60" />
      </div>
      <div className="text-center px-8">
        <p className="text-lg font-semibold">Lesson {lesson.number}: {lesson.title}</p>
        <p className="text-sm text-white/50 mt-1">
          Video will appear here once configured.
        </p>
        <p className="text-xs text-white/30 mt-2">
          Set LESSON_{lesson.number}_VIDEO_ID in your Replit Secrets.
        </p>
      </div>
    </div>
  );
}

function LessonCard({
  lesson,
  isActive,
  hasAccess,
  progress,
  onClick,
}: {
  lesson: LessonData;
  isActive: boolean;
  hasAccess: boolean;
  progress?: { watchPercentage: number; completed: boolean };
  onClick: () => void;
}) {
  const isAccessible = lesson.free || hasAccess;
  const pct = progress?.watchPercentage ?? 0;
  const done = progress?.completed ?? false;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isAccessible}
      aria-current={isActive ? "true" : undefined}
      className={cn(
        "w-full text-left p-4 rounded-2xl border transition-all duration-200 group",
        isActive
          ? "border-blue-500 bg-blue-50 shadow-sm"
          : isAccessible
            ? "border-gray-200 hover:border-gray-300 hover:bg-gray-50 bg-white"
            : "border-gray-100 bg-gray-50 cursor-not-allowed",
      )}
    >
      <div className="flex items-center gap-4">
        {/* Number / icon */}
        <div
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-bold",
            done
              ? "bg-green-500 text-white"
              : isActive
                ? "bg-blue-500 text-white"
                : isAccessible
                  ? "bg-gray-100 text-gray-600"
                  : "bg-gray-100 text-gray-400",
          )}
        >
          {done ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : isActive ? (
            <Play className="w-4 h-4" />
          ) : (
            lesson.number
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "font-semibold text-[15px] truncate",
                !isAccessible && "text-gray-400",
              )}
            >
              {lesson.title}
            </span>
            {lesson.free && (
              <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full uppercase tracking-wide shrink-0">
                Free
              </span>
            )}
          </div>
          <p className="text-[13px] text-gray-500 mt-0.5">{lesson.duration}</p>
          {pct > 0 && !done && (
            <div className="mt-2 h-1 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>

        {/* Right side */}
        <div className="shrink-0">
          {!isAccessible ? (
            <Lock className="w-4 h-4 text-gray-300" />
          ) : done ? null : (
            <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
          )}
        </div>
      </div>
    </button>
  );
}

function PremiumOverlay({
  course,
  onDismiss,
  onUnlock,
  isCheckingOut,
}: {
  course: CourseData;
  onDismiss: () => void;
  onUnlock: () => void;
  isCheckingOut: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(12px)" }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="course-unlock-title" className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-300 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 px-5 sm:px-8 py-6 sm:py-8 text-center">
          <div className="w-16 h-16 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-8 h-8 text-amber-400" />
          </div>
          <h2 id="course-unlock-title" className="text-2xl font-bold text-white">Ready for the rest?</h2>
          <p className="text-gray-400 mt-2 text-[15px] leading-relaxed">
            Unlock the remaining lessons and complete the entire Practical &amp; Applied course.
          </p>
        </div>

        {/* Locked lessons (blurred) */}
        <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-gray-100">
          <div className="space-y-2 select-none" style={{ filter: "blur(1.5px)", pointerEvents: "none" }}>
            {course.lessons.slice(1).map((l) => (
              <div key={l.number} className="flex items-center gap-3 py-1.5">
                <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                <span className="text-[14px] text-gray-700 font-medium">
                  Lesson {l.number}: {l.title}
                </span>
                <span className="ml-auto text-[12px] text-gray-400">{l.duration}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Pricing + CTA */}
        <div className="px-5 sm:px-8 py-5 sm:py-6 text-center">
          <div className="flex items-baseline justify-center gap-1 mb-1">
            <span className="text-4xl font-bold text-gray-900">${course.priceUsd}</span>
          </div>
          <p className="text-[13px] text-gray-500 mb-4">One-time payment · Lifetime access</p>
          <Button
            className="w-full h-12 text-[15px] font-semibold bg-gray-900 hover:bg-gray-800 rounded-xl"
            onClick={onUnlock}
            disabled={isCheckingOut}
          >
            {isCheckingOut ? "Preparing checkout…" : "Unlock the Course"}
            {!isCheckingOut && <ChevronRight className="w-4 h-4 ml-1" />}
          </Button>
          <button
            onClick={onDismiss}
            className="mt-3 text-[13px] text-gray-400 hover:text-gray-600 transition-colors"
          >
            Continue watching Lesson 1
          </button>
        </div>
      </div>
    </div>
  );
}

function CourseDashboard({
  course,
  progressStats,
  progressByLesson,
  activeLesson,
  onLessonSelect,
}: {
  course: CourseData;
  progressStats: ProgressStats;
  progressByLesson: Record<number, { watchPercentage: number; completed: boolean }>;
  activeLesson: number;
  onLessonSelect: (n: number) => void;
}) {
  const resumeLesson = progressStats.lastWatchedLesson ?? 1;
  const avgDurationMin = 19;
  const remainingMins = (progressStats.totalLessons - progressStats.completedLessons) * avgDurationMin;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
      {[
        {
          icon: <BarChart3 className="w-5 h-5" />,
          label: "Progress",
          value: `${progressStats.percentage}%`,
          sub: `${progressStats.completedLessons} of ${progressStats.totalLessons} lessons`,
          color: "text-blue-500",
          bg: "bg-blue-50",
        },
        {
          icon: <Play className="w-5 h-5" />,
          label: "Current Lesson",
          value: `Lesson ${resumeLesson}`,
          sub: course.lessons[resumeLesson - 1]?.title ?? "",
          color: "text-purple-500",
          bg: "bg-purple-50",
        },
        {
          icon: <Clock className="w-5 h-5" />,
          label: "Time Remaining",
          value: `~${remainingMins} min`,
          sub: `${progressStats.totalLessons - progressStats.completedLessons} lessons left`,
          color: "text-amber-500",
          bg: "bg-amber-50",
        },
      ].map((card) => (
        <div key={card.label} className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center mb-2", card.bg)}>
            <span className={card.color}>{card.icon}</span>
          </div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{card.label}</p>
          <p className="text-[22px] font-bold text-gray-900 leading-tight">{card.value}</p>
          <p className="text-[12px] text-gray-500 mt-0.5 truncate">{card.sub}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function VideoCourse() {
  const [, setLocation] = useLocation();
  const { data: me } = useGetMe();
  const isLoggedIn = !!localStorage.getItem("certefficiency_token");

  const [course, setCourse] = useState<CourseData | null>(null);
  const [progressStats, setProgressStats] = useState<ProgressStats | null>(null);
  const [progressByLesson, setProgressByLesson] = useState<
    Record<number, { watchPercentage: number; completed: boolean }>
  >({});
  const [activeLesson, setActiveLesson] = useState(1);
  const [showOverlay, setShowOverlay] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLIFrameElement>(null);
  const videoSectionRef = useRef<HTMLDivElement>(null);
  const curriculumRef = useRef<HTMLDivElement>(null);
  const pricingRef = useRef<HTMLDivElement>(null);

  // Load course data
  useEffect(() => {
    apiRequest<{ course: CourseData }>("GET", "/courses/cscs-practical")
      .then(({ course: c }) => setCourse(c))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Load progress for purchased users
  useEffect(() => {
    if (!course?.hasAccess) return;
    apiRequest<{ progress: Array<{ lessonNumber: number; watchPercentage: number; completed: boolean }>; stats: ProgressStats }>(
      "GET",
      "/courses/cscs-practical/progress",
    )
      .then(({ progress, stats }) => {
        const byLesson: Record<number, { watchPercentage: number; completed: boolean }> = {};
        for (const p of progress) byLesson[p.lessonNumber] = { watchPercentage: p.watchPercentage, completed: p.completed };
        setProgressByLesson(byLesson);
        setProgressStats(stats);
        if (stats.lastWatchedLesson) setActiveLesson(stats.lastWatchedLesson);
      })
      .catch(() => {}); // non-fatal
  }, [course?.hasAccess]);

  const handleUnlock = useCallback(async () => {
    if (!isLoggedIn) {
      setLocation("/auth/login");
      return;
    }
    setIsCheckingOut(true);
    try {
      const { url, hasAccess } = await apiRequest<{ url?: string; hasAccess?: boolean }>(
        "POST",
        "/courses/cscs-practical/checkout",
      );
      if (hasAccess) {
        // Already purchased — reload
        window.location.reload();
        return;
      }
      if (url) window.location.href = url;
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Checkout failed. Please try again.");
    } finally {
      setIsCheckingOut(false);
    }
  }, [isLoggedIn, setLocation]);

  const scrollToVideo = () =>
    videoSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const scrollToPricing = () =>
    pricingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  const handleLessonSelect = (n: number) => {
    if (!course) return;
    const lesson = course.lessons[n - 1];
    if (lesson.locked) {
      setShowOverlay(true);
      return;
    }
    setActiveLesson(n);
    videoSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleNextLesson = () => {
    if (!course) return;
    const next = activeLesson + 1;
    if (next > course.lessons.length) return;
    if (course.lessons[next - 1].locked) {
      setShowOverlay(true);
    } else {
      setActiveLesson(next);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-gray-300 border-t-blue-500 animate-spin" />
      </div>
    );
  }

  if (error || !course) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center text-center px-4">
        <div>
          <p className="text-gray-600 mb-4">{error || "Course not found"}</p>
          <Link href="/"><Button variant="outline">Go Home</Button></Link>
        </div>
      </div>
    );
  }

  const activeLesson_ = course.lessons[activeLesson - 1];

  return (
    <div className="min-h-screen bg-white">
      {/* ------------------------------------------------------------------ */}
      {/* Sticky top nav                                                       */}
      {/* ------------------------------------------------------------------ */}
      <nav className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-200/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-2">
          <Link href="/">
            <Logo className="text-primary cursor-pointer shrink-0" />
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            {course.hasAccess ? (
              <span className="flex items-center gap-1.5 text-[12px] sm:text-[13px] font-semibold text-green-600 bg-green-50 px-2.5 sm:px-3 py-1 rounded-full whitespace-nowrap">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden xs:inline">Course</span> Unlocked
              </span>
            ) : (
              <Button
                size="sm"
                className="bg-gray-900 hover:bg-gray-800 rounded-xl text-[13px] whitespace-nowrap"
                onClick={handleUnlock}
                disabled={isCheckingOut}
              >
                {isCheckingOut ? "Loading…" : "Unlock Course"}
              </Button>
            )}
            {!isLoggedIn && (
              <Link href="/auth/login">
                <Button variant="ghost" size="sm" className="text-[13px] hidden sm:inline-flex">
                  Sign In
                </Button>
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* ------------------------------------------------------------------ */}
      {/* Hero Section                                                         */}
      {/* ------------------------------------------------------------------ */}
      <section className="bg-[#1D1D1F] text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20 md:py-28">
          <div className="max-w-3xl">
            <Badge className="mb-6 bg-white/10 text-white/80 border-white/20 hover:bg-white/10 text-[12px] tracking-wide uppercase">
              NSCA CSCS Preparation
            </Badge>
            <h1 className="text-3xl sm:text-4xl md:text-6xl font-bold tracking-tight leading-[1.05] mb-6">
              NSCA CSCS Practical &amp; Applied Masterclass
            </h1>
            <p className="text-[17px] md:text-xl text-white/70 leading-relaxed mb-10 max-w-2xl">
              Master the Practical &amp; Applied portion of the CSCS exam through concise lessons
              designed to help you think like a strength coach—not memorize like a student.
            </p>

            {/* Stats */}
            <div className="flex flex-wrap gap-x-8 gap-y-3 mb-10">
              {[
                { icon: <Video className="w-4 h-4" />, label: "10 HD Lessons" },
                { icon: <Clock className="w-4 h-4" />, label: "~3 Hours Total" },
                { icon: <Zap className="w-4 h-4" />, label: "Lifetime Access" },
                { icon: <Award className="w-4 h-4" />, label: "Certificate Ready" },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-2 text-white/60 text-[14px]">
                  {s.icon}
                  <span>{s.label}</span>
                </div>
              ))}
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap gap-3">
              <Button
                size="lg"
                className="bg-white text-gray-900 hover:bg-gray-100 rounded-xl font-semibold h-12 px-6 text-[15px]"
                onClick={scrollToVideo}
              >
                <Play className="w-4 h-4 mr-2" />
                Watch Free Preview
              </Button>
              {!course.hasAccess ? (
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/30 text-white hover:bg-white/10 rounded-xl font-semibold h-12 px-6 text-[15px]"
                  onClick={handleUnlock}
                  disabled={isCheckingOut}
                >
                  {isCheckingOut ? "Loading…" : "Unlock Full Course"}
                  {!isCheckingOut && <ChevronRight className="w-4 h-4 ml-1" />}
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/30 text-white hover:bg-white/10 rounded-xl font-semibold h-12 px-6 text-[15px]"
                  onClick={() => curriculumRef.current?.scrollIntoView({ behavior: "smooth" })}
                >
                  <BookOpen className="w-4 h-4 mr-2" />
                  View Curriculum
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Video Player                                                         */}
      {/* ------------------------------------------------------------------ */}
      <section ref={videoSectionRef} className="bg-[#F5F5F7] py-10 sm:py-16 px-4 sm:px-6 scroll-mt-14">
        <div className="max-w-4xl mx-auto">

          {/* Dashboard for purchased users */}
          {course.hasAccess && progressStats && (
            <CourseDashboard
              course={course}
              progressStats={progressStats}
              progressByLesson={progressByLesson}
              activeLesson={activeLesson}
              onLessonSelect={handleLessonSelect}
            />
          )}

          {/* Video player */}
          {activeLesson_.videoEmbedUrl ? (
            <div className="w-full aspect-video rounded-2xl overflow-hidden shadow-2xl bg-black">
              <iframe
                ref={videoRef}
                src={`${activeLesson_.videoEmbedUrl}${activeLesson_.free ? "?autoplay=1" : ""}`}
                allow="autoplay; fullscreen"
                allowFullScreen
                className="w-full h-full border-0"
                title={`Lesson ${activeLesson_.number}: ${activeLesson_.title}`}
              />
            </div>
          ) : (
            <VideoPlaceholder lesson={activeLesson_} />
          )}

          {/* Lesson metadata */}
          <div className="mt-5 flex flex-col gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-gray-500 mb-1">
                <span className="font-medium text-gray-900">Lesson {activeLesson_.number}</span>
                <span>·</span>
                <span className="break-words">{activeLesson_.title}</span>
                {activeLesson_.free && (
                  <span className="text-[10px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                    Free
                  </span>
                )}
              </div>
              <p className="text-[13px] text-gray-500 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                Estimated length: {activeLesson_.duration}
              </p>
              <p className="text-[14px] text-gray-600 mt-2 leading-relaxed">
                {activeLesson_.description}
              </p>
            </div>

            {/* Next lesson button — full-width on mobile for one-hand reachability */}
            {activeLesson < course.lessons.length && (
              <Button
                variant="outline"
                className="w-full sm:w-auto rounded-xl border-gray-300 text-[14px] sm:text-[13px] font-medium h-11 sm:h-9"
                onClick={handleNextLesson}
              >
                Next: <span className="ml-1 truncate max-w-[180px] sm:max-w-none inline-block align-bottom">{course.lessons[activeLesson]?.title}</span>
                <ChevronRight className="w-3.5 h-3.5 ml-1 shrink-0" />
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Course Curriculum                                                    */}
      {/* ------------------------------------------------------------------ */}
      <section ref={curriculumRef} className="py-14 sm:py-20 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10 sm:mb-12">
            <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-[#1D1D1F] mb-3">Course Curriculum</h2>
            <p className="text-[#6E6E73] text-[16px]">
              10 lessons · HD quality · Lifetime access
            </p>
          </div>

          <div className="space-y-2">
            {course.lessons.map((lesson) => (
              <LessonCard
                key={lesson.number}
                lesson={lesson}
                isActive={lesson.number === activeLesson}
                hasAccess={course.hasAccess}
                progress={progressByLesson[lesson.number]}
                onClick={() => handleLessonSelect(lesson.number)}
              />
            ))}
          </div>

          {!course.hasAccess && (
            <div className="mt-8 text-center">
              <p className="text-[#6E6E73] text-[14px] mb-4">
                Lessons 2–10 are unlocked after purchase.
              </p>
              <Button
                className="bg-gray-900 hover:bg-gray-800 rounded-xl px-8 font-semibold"
                onClick={scrollToPricing}
              >
                See Pricing
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Pricing                                                              */}
      {/* ------------------------------------------------------------------ */}
      {!course.hasAccess && (
        <section ref={pricingRef} className="bg-[#F5F5F7] py-14 sm:py-20 px-4 sm:px-6">
          <div className="max-w-lg mx-auto">
            <div className="text-center mb-8 sm:mb-10">
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-[#1D1D1F] mb-3">
                Unlock Everything. Own It Forever.
              </h2>
              <p className="text-[#6E6E73] text-[16px]">
                One payment. Complete access. No subscriptions.
              </p>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-gray-200 overflow-hidden">
              {/* Card header */}
              <div className="bg-gradient-to-br from-gray-900 to-gray-800 px-5 sm:px-8 py-6 sm:py-8 text-center">
                <p className="text-white/60 text-[13px] font-medium uppercase tracking-widest mb-2">
                  Lifetime Access
                </p>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-5xl font-bold text-white">${course.priceUsd}</span>
                </div>
                <p className="text-white/40 text-[13px] mt-1">One-time payment</p>
              </div>

              {/* Features */}
              <div className="px-5 sm:px-8 py-6 sm:py-8">
                <ul className="space-y-4 mb-8">
                  {[
                    "10 HD Lessons covering every Practical & Applied domain",
                    "Lifetime Access — never expires",
                    "Future course updates included at no cost",
                    "Optimized for Desktop and Mobile",
                    "Certificate Ready Study System",
                    "Instant access after payment",
                  ].map((feat) => (
                    <li key={feat} className="flex items-start gap-3">
                      <div className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0 mt-0.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                      </div>
                      <span className="text-[15px] text-gray-700">{feat}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  className="w-full h-14 text-[16px] font-semibold bg-gray-900 hover:bg-gray-800 rounded-2xl"
                  onClick={handleUnlock}
                  disabled={isCheckingOut}
                >
                  {isCheckingOut ? "Preparing checkout…" : "Unlock the Course"}
                  {!isCheckingOut && <ChevronRight className="w-5 h-5 ml-1" />}
                </Button>

                <p className="text-center text-[12px] text-gray-400 mt-4">
                  Secure checkout powered by Stripe · 30-day money-back guarantee
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Testimonials placeholder                                             */}
      {/* ------------------------------------------------------------------ */}
      <section className="py-14 sm:py-20 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-[#1D1D1F] mb-3">What Students Are Saying</h2>
          <p className="text-[#6E6E73] mb-12">Coaches who passed with this course.</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 text-left">
            {[
              {
                name: "Alex T.",
                role: "CSCS, D1 Strength Coach",
                quote: "The Practical & Applied section felt manageable for the first time. Passed on my first attempt.",
              },
              {
                name: "Maria L.",
                role: "CSCS Candidate",
                quote: "I'd been stuck on the applied concepts for months. These 10 lessons finally made them click.",
              },
              {
                name: "Jordan K.",
                role: "Performance Specialist",
                quote: "The case study lesson alone was worth it. Learned how to think through scenarios, not just recall facts.",
              },
            ].map((t) => (
              <div
                key={t.name}
                className="bg-[#F5F5F7] rounded-2xl p-6 text-left"
              >
                <div className="flex gap-0.5 mb-4">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-[14px] text-gray-700 leading-relaxed mb-4">"{t.quote}"</p>
                <div>
                  <p className="text-[14px] font-semibold text-gray-900">{t.name}</p>
                  <p className="text-[12px] text-gray-500">{t.role}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[12px] text-gray-400 mt-8">
            * Testimonials are illustrative placeholders. Replace with verified student reviews before launch.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Footer                                                               */}
      {/* ------------------------------------------------------------------ */}
      <footer className="bg-[#1D1D1F] text-white/40 py-8 px-4 sm:px-6 text-center text-[13px] safe-area-bottom">
        <div className="flex justify-center mb-3">
          <Logo className="text-white/30" />
        </div>
        <p>© {new Date().getFullYear()} Efficiency Strength Training · All rights reserved</p>
        <p className="mt-1">Powered by CertEfficiency</p>
      </footer>

      {/* ------------------------------------------------------------------ */}
      {/* Premium overlay (shown after free lesson ends)                       */}
      {/* ------------------------------------------------------------------ */}
      {showOverlay && (
        <PremiumOverlay
          course={course}
          onDismiss={() => setShowOverlay(false)}
          onUnlock={handleUnlock}
          isCheckingOut={isCheckingOut}
        />
      )}
    </div>
  );
}

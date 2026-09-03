import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import {
  CheckCircle2,
  ChevronRight,
  Clock,
  Lock,
  Play,
  Video,
  Loader2,
  BookOpen,
  Zap,
  Globe,
  Server,
  Brain,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const COURSE_SLUG = "ai-agent-builder";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CourseLesson {
  id: string;
  title: string;
  description: string | null;
  instructorNotes: string | null;
  duration: string | null;
  order: number;
  freePreview: boolean;
  videoUrl: string | null;          // GCS self-hosted MP4 streaming path
  videoEmbedUrl: string | null;     // HeyGen iframe fallback
  playbackEndpoint: string | null;  // R2 presigned-URL endpoint (POST)
  thumbnailUrl: string | null;      // poster image path
  locked: boolean;
}

interface CourseData {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  instructor: string;
  priceUsd: number;
  lessons: CourseLesson[];
  hasAccess: boolean;
}

interface LessonProgress {
  lessonId: string;
  watchPercentage: number;
  completed: boolean;
}

interface ProgressStats {
  completedLessons: number;
  totalLessons: number;
  percentage: number;
  lastWatchedLessonId: string | null;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("certefficiency_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchCourseData(): Promise<CourseData | null> {
  try {
    const res = await fetch(`${BASE}/api/platform/courses/${COURSE_SLUG}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.course ?? null;
  } catch {
    return null;
  }
}

async function fetchProgress(): Promise<{ progress: LessonProgress[]; stats: ProgressStats } | null> {
  try {
    const res = await fetch(`${BASE}/api/platform/courses/${COURSE_SLUG}/progress`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function saveProgress(lessonId: string, watchPercentage: number, completed = false) {
  try {
    await fetch(`${BASE}/api/platform/courses/${COURSE_SLUG}/lessons/${lessonId}/progress`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ watchPercentage, completed }),
    });
  } catch {
    // non-fatal
  }
}

async function startCheckout(): Promise<string | null> {
  try {
    const res = await fetch(`${BASE}/api/platform/courses/${COURSE_SLUG}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
    });
    if (!res.ok) {
      if (res.status === 401) return "auth";
      return null;
    }
    const data = await res.json();
    return data.url ?? null;
  } catch {
    return null;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function VideoPlaceholder({ lesson }: { lesson: CourseLesson }) {
  return (
    <div className="w-full aspect-video bg-[#0a0a0a] rounded-2xl flex flex-col items-center justify-center gap-3 border border-white/10">
      <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center">
        <Video className="w-7 h-7 text-white/40" />
      </div>
      <div className="text-center">
        <p className="text-white/60 text-[15px] font-medium">{lesson.title}</p>
        <p className="text-white/30 text-[13px] mt-1">Video will appear here once configured.</p>
        <p className="text-white/20 text-[12px]">Set {`AI_LESSON_${lesson.order}_VIDEO_ID`} in your Replit Secrets.</p>
      </div>
    </div>
  );
}

// ─── Self-hosted video player ─────────────────────────────────────────────────

function SelfHostedVideoPlayer({
  videoUrl,
  lesson,
  onProgress,
  onComplete,
}: {
  videoUrl: string;
  lesson: CourseLesson;
  onProgress: (pct: number) => void;
  onComplete: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedTimeRef = useRef(0);
  const completedRef = useRef(false);

  // Restore saved position on mount / lesson change
  useEffect(() => {
    completedRef.current = false;
    lastSavedTimeRef.current = 0;
    const saved = localStorage.getItem(`lesson_time_${lesson.id}`);
    if (saved && videoRef.current) {
      const t = parseFloat(saved);
      if (!isNaN(t) && t > 2) {
        // Wait for metadata so duration is known before seeking
        const seek = () => { if (videoRef.current) videoRef.current.currentTime = t; };
        if (videoRef.current.readyState >= 1) {
          seek();
        } else {
          videoRef.current.addEventListener("loadedmetadata", seek, { once: true });
        }
      }
    }
  }, [lesson.id, videoUrl]);

  function handleTimeUpdate() {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const pct = (v.currentTime / v.duration) * 100;

    // Persist current time for anonymous resume
    localStorage.setItem(`lesson_time_${lesson.id}`, String(v.currentTime));

    // Save progress to server every 15 s of watched content
    if (v.currentTime - lastSavedTimeRef.current >= 15) {
      lastSavedTimeRef.current = v.currentTime;
      onProgress(pct);
    }

    // Completion at 90 %
    if (pct >= 90 && !completedRef.current) {
      completedRef.current = true;
      onProgress(100);
      onComplete();
    }
  }

  function handleEnded() {
    if (!completedRef.current) {
      completedRef.current = true;
      onProgress(100);
      onComplete();
    }
  }

  return (
    <video
      ref={videoRef}
      src={videoUrl}
      poster={lesson.thumbnailUrl ? `${BASE}${lesson.thumbnailUrl}` : undefined}
      controls
      playsInline
      preload="metadata"
      className="w-full aspect-video"
      style={{ background: "#000", display: "block" }}
      onTimeUpdate={handleTimeUpdate}
      onEnded={handleEnded}
    />
  );
}

// ─── R2 presigned-URL video player ───────────────────────────────────────────

function R2VideoPlayer({
  playbackEndpoint,
  lesson,
  onProgress,
  onComplete,
}: {
  playbackEndpoint: string;
  lesson: CourseLesson;
  onProgress: (pct: number) => void;
  onComplete: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedTimeRef = useRef(0);
  const completedRef = useRef(false);
  const retryDoneRef = useRef(false);

  async function fetchPlaybackUrl() {
    setFetching(true);
    setFetchError(false);
    try {
      const res = await fetch(`${BASE}${playbackEndpoint}`, {
        method: "POST",
        headers: { ...authHeaders() },
      });
      if (!res.ok) {
        setFetchError(true);
        return;
      }
      const data = await res.json();
      setSrc(data.playbackUrl ?? null);
      retryDoneRef.current = false;
    } catch {
      setFetchError(true);
    } finally {
      setFetching(false);
    }
  }

  // Fetch a fresh URL whenever the lesson or endpoint changes
  useEffect(() => {
    completedRef.current = false;
    lastSavedTimeRef.current = 0;
    retryDoneRef.current = false;
    setSrc(null);
    setFetchError(false);
    fetchPlaybackUrl();
  }, [lesson.id, playbackEndpoint]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore saved playback position once src is resolved
  useEffect(() => {
    if (!src || !videoRef.current) return;
    const saved = localStorage.getItem(`lesson_time_${lesson.id}`);
    if (saved) {
      const t = parseFloat(saved);
      if (!isNaN(t) && t > 2) {
        const seek = () => { if (videoRef.current) videoRef.current.currentTime = t; };
        if (videoRef.current.readyState >= 1) seek();
        else videoRef.current.addEventListener("loadedmetadata", seek, { once: true });
      }
    }
  }, [src, lesson.id]);

  function handleTimeUpdate() {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    const pct = (v.currentTime / v.duration) * 100;
    localStorage.setItem(`lesson_time_${lesson.id}`, String(v.currentTime));
    if (v.currentTime - lastSavedTimeRef.current >= 15) {
      lastSavedTimeRef.current = v.currentTime;
      onProgress(pct);
    }
    if (pct >= 90 && !completedRef.current) {
      completedRef.current = true;
      onProgress(100);
      onComplete();
    }
  }

  function handleEnded() {
    if (!completedRef.current) {
      completedRef.current = true;
      onProgress(100);
      onComplete();
    }
  }

  async function handleVideoError() {
    // Attempt one silent URL refresh on error (handles expired presigned URL)
    if (!retryDoneRef.current) {
      retryDoneRef.current = true;
      await fetchPlaybackUrl();
    } else {
      setFetchError(true);
    }
  }

  if (fetching) {
    return (
      <div className="w-full aspect-video bg-[#0a0a0a] flex items-center justify-center" role="status">
        <Loader2 className="w-8 h-8 text-white/30 animate-spin" aria-hidden="true" />
        <span className="sr-only">Loading video</span>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="w-full aspect-video bg-[#0a0a0a] flex flex-col items-center justify-center gap-3">
        <p className="text-white/50 text-[14px]">Unable to load video.</p>
        <button
          onClick={() => { retryDoneRef.current = false; fetchPlaybackUrl(); }}
          className="text-white/70 hover:text-white text-[13px] underline transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!src) return null;

  return (
    <video
      ref={videoRef}
      key={src}
      src={src}
      poster={lesson.thumbnailUrl ? `${BASE}${lesson.thumbnailUrl}` : undefined}
      controls
      playsInline
      preload="metadata"
      className="w-full aspect-video"
      style={{ background: "#000", display: "block" }}
      onTimeUpdate={handleTimeUpdate}
      onEnded={handleEnded}
      onError={handleVideoError}
    />
  );
}

function PremiumOverlay({
  onClose,
  onUnlock,
  loading,
}: {
  onClose: () => void;
  onUnlock: () => void;
  loading: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: "blur(20px)", backgroundColor: "rgba(0,0,0,0.7)" }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="premium-overlay-title" className="bg-[#111] border border-white/10 rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-5 sm:px-8 pt-8 sm:pt-10 pb-5 sm:pb-6 text-center border-b border-white/10">
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mx-auto mb-4 sm:mb-5">
            <Lock className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
          </div>
          <h2 id="premium-overlay-title" className="text-xl sm:text-2xl font-bold text-white mb-2">You've completed the free lesson.</h2>
          <p className="text-white/50 text-[14px] sm:text-[15px] leading-relaxed">
            Continue building your own production-ready AI agent by unlocking the complete course.
          </p>
        </div>

        {/* Feature list */}
        <div className="px-5 sm:px-8 py-5 sm:py-6">
          <div className="grid grid-cols-1 gap-2">
            {[
              "11 Complete Lessons",
              "Production Architecture",
              "Hermes Integration",
              "Agent Skills",
              "Memory Systems",
              "VM Deployment",
              "Cloudflare Tunnel",
              "Obsidian Knowledge Vault",
              "Real Business Workflows",
              "Future Course Updates",
            ].map((item) => (
              <div key={item} className="flex items-center gap-3">
                <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                <span className="text-white/70 text-[14px]">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Price + CTA */}
        <div className="px-5 sm:px-8 pb-6 sm:pb-8 pt-2">
          <div className="text-center mb-4">
            <p className="text-white/40 text-[13px] uppercase tracking-widest mb-1">One-time payment</p>
            <p className="text-4xl font-bold text-white">$497</p>
            <p className="text-white/40 text-[13px] mt-1">Lifetime access · Future updates included</p>
          </div>
          <Button
            onClick={onUnlock}
            disabled={loading}
            className="w-full h-12 text-[15px] font-semibold bg-white text-black hover:bg-white/90 rounded-xl mb-3"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Redirecting to checkout…</>
            ) : (
              <>Unlock Full Course <ChevronRight className="w-4 h-4 ml-1" /></>
            )}
          </Button>
          <button
            onClick={onClose}
            className="w-full text-center text-white/30 hover:text-white/50 text-[13px] transition-colors py-2"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}

function CourseDashboard({
  course,
  progress,
  stats,
  onSelectLesson,
}: {
  course: CourseData;
  progress: LessonProgress[];
  stats: ProgressStats;
  onSelectLesson: (lesson: CourseLesson) => void;
}) {
  const progressMap = new Map(progress.map((p) => [p.lessonId, p]));
  const nextLesson = course.lessons.find(
    (l) => !progressMap.get(l.id)?.completed,
  ) ?? course.lessons[0];

  return (
    <section className="py-16 bg-white">
      <div className="max-w-4xl mx-auto px-6">
        <div className="mb-10">
          <h2 className="text-2xl font-bold text-gray-900 mb-1">Your Progress</h2>
          <p className="text-gray-500 text-[15px]">
            {stats.completedLessons} of {stats.totalLessons} lessons complete
          </p>

          {/* Progress bar */}
          <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-700"
              style={{ width: `${stats.percentage}%` }}
            />
          </div>
          <p className="text-[13px] text-gray-400 mt-1">{stats.percentage}% complete</p>

          {/* Continue button */}
          {nextLesson && (
            <Button
              onClick={() => onSelectLesson(nextLesson)}
              className="mt-4 bg-gray-900 hover:bg-gray-800 text-white rounded-xl px-6 h-11 text-[14px]"
            >
              <Play className="w-4 h-4 mr-2" />
              {stats.completedLessons === 0 ? "Start Learning" : "Continue Watching"}
              <span className="ml-2 text-white/50">— {nextLesson.title}</span>
            </Button>
          )}
        </div>

        {/* Lesson list */}
        <div className="space-y-2">
          {course.lessons.map((lesson) => {
            const lp = progressMap.get(lesson.id);
            const isCompleted = lp?.completed ?? false;
            const isActive = nextLesson?.id === lesson.id && !isCompleted;

            return (
              <div
                key={lesson.id}
                onClick={() => onSelectLesson(lesson)}
                className={`flex items-center gap-4 p-4 rounded-2xl cursor-pointer transition-all border ${
                  isActive
                    ? "bg-blue-50 border-blue-200"
                    : isCompleted
                    ? "bg-gray-50 border-transparent hover:bg-gray-100"
                    : "border-transparent hover:bg-gray-50"
                }`}
              >
                {/* Icon */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                  isCompleted
                    ? "bg-green-500"
                    : isActive
                    ? "bg-blue-500"
                    : "bg-gray-200"
                }`}>
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-white" />
                  ) : (
                    <span className="text-xs font-bold text-white">{lesson.order}</span>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`font-medium text-[14px] ${
                      isCompleted ? "text-gray-400 line-through" : "text-gray-900"
                    }`}>
                      {lesson.title}
                    </span>
                    {lesson.freePreview && (
                      <span className="text-[10px] font-bold text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                        FREE
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-gray-400 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {lesson.duration ?? "—"}
                    {lp && !isCompleted && lp.watchPercentage > 0 && (
                      <span className="ml-2">· {Math.round(lp.watchPercentage)}% watched</span>
                    )}
                  </p>
                </div>

                <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AiCourse() {
  const [, navigate] = useLocation();
  const [course, setCourse] = useState<CourseData | null>(null);
  const [progressData, setProgressData] = useState<LessonProgress[]>([]);
  const [progressStats, setProgressStats] = useState<ProgressStats | null>(null);
  const [activeLesson, setActiveLesson] = useState<CourseLesson | null>(null);
  const [showOverlay, setShowOverlay] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const videoSectionRef = useRef<HTMLDivElement>(null);

  const isLoggedIn = !!localStorage.getItem("certefficiency_token");

  useEffect(() => {
    async function load() {
      const data = await fetchCourseData();
      setCourse(data);
      if (data) {
        const firstLesson = data.lessons[0] ?? null;
        setActiveLesson(firstLesson);

        if (data.hasAccess) {
          const prog = await fetchProgress();
          if (prog) {
            setProgressData(prog.progress);
            setProgressStats(prog.stats);
          }
        }
      }
      setLoading(false);
    }
    load();
  }, []);

  async function handleUnlock() {
    if (!isLoggedIn) {
      navigate("/auth/login");
      return;
    }
    setCheckoutLoading(true);
    const result = await startCheckout();
    if (result === "auth") {
      navigate("/auth/login");
    } else if (result) {
      window.location.href = result;
    } else {
      setCheckoutLoading(false);
      alert("Checkout is temporarily unavailable. Please try again.");
    }
  }

  function handleLessonClick(lesson: CourseLesson) {
    if (lesson.locked) {
      setShowOverlay(true);
      return;
    }
    setActiveLesson(lesson);
    setShowOverlay(false);
    videoSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

    // Save progress: user viewed this lesson
    if (isLoggedIn && lesson.id) {
      saveProgress(lesson.id, 0);
    }
  }

  function handleLessonComplete() {
    if (!course || !activeLesson) return;

    // Save 100% completion
    if (isLoggedIn) {
      saveProgress(activeLesson.id, 100, true);
      setProgressData((prev) => {
        const next = prev.filter((p) => p.lessonId !== activeLesson.id);
        return [...next, { lessonId: activeLesson.id, watchPercentage: 100, completed: true }];
      });
    }

    // Advance to next lesson or show overlay
    const nextIdx = course.lessons.findIndex((l) => l.id === activeLesson.id) + 1;
    if (nextIdx < course.lessons.length) {
      const next = course.lessons[nextIdx];
      if (next.locked) {
        setShowOverlay(true);
      } else {
        setActiveLesson(next);
        videoSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else if (!course.hasAccess) {
      setShowOverlay(true);
    }
  }

  const PAYWALL_FEATURES = [
    { icon: Video, label: "10 Complete Lessons" },
    { icon: Server, label: "Production Architecture" },
    { icon: Brain, label: "Hermes Integration" },
    { icon: Zap, label: "Agent Skills & Memory" },
    { icon: Globe, label: "Cloudflare Tunnel" },
    { icon: BookOpen, label: "Obsidian Knowledge Vault" },
    { icon: CheckCircle2, label: "Real Business Workflows" },
    { icon: CheckCircle2, label: "Future Course Updates" },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white/30 animate-spin" />
      </div>
    );
  }

  // Fallback if course not in DB yet
  const displayTitle = course?.title ?? "How to Build an AI Agent";
  const displaySubtitle =
    course?.subtitle ??
    "Learn how to design, build, deploy, and manage production-ready AI agents using the exact architecture I use in my own business.";
  const displayDescription =
    course?.description ??
    "This course teaches far more than prompting. You'll build a complete AI worker with identity, memory, skills, tools, persistent infrastructure, secure networking, and real-world business applications.";
  const hasAccess = course?.hasAccess ?? false;
  const lessons = course?.lessons ?? [];
  const activeLesson1 = activeLesson ?? lessons[0] ?? null;

  return (
    <div className="min-h-screen bg-white">
      {/* ── Overlay ───────────────────────────────────────────────────── */}
      {showOverlay && (
        <PremiumOverlay
          onClose={() => setShowOverlay(false)}
          onUnlock={handleUnlock}
          loading={checkoutLoading}
        />
      )}

      {/* ── Nav ───────────────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-40 bg-[#0a0a0a]/80 border-b border-white/10"
           style={{ backdropFilter: "blur(20px)" }}>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-2">
          <Link href="/">
            <Logo className="text-white cursor-pointer shrink-0" />
          </Link>
          <div className="flex items-center gap-2 min-w-0">
            {!hasAccess && (
              <Button
                onClick={handleUnlock}
                disabled={checkoutLoading}
                className="h-9 px-3 sm:px-4 text-[13px] font-semibold bg-white text-black hover:bg-white/90 rounded-full whitespace-nowrap"
              >
                {checkoutLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Unlock Course"}
              </Button>
            )}
            {!isLoggedIn && (
              <Link href="/auth/login">
                <span className="hidden sm:inline text-[13px] text-white/50 hover:text-white/80 cursor-pointer transition-colors">
                  Sign In
                </span>
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <section className="bg-[#0a0a0a] pt-24 sm:pt-32 pb-16 sm:pb-20 px-4 sm:px-6">
        <div className="max-w-5xl mx-auto">
          <div className="max-w-3xl">
            <span className="inline-block text-[11px] font-bold uppercase tracking-[0.15em] text-white/40 mb-5 border border-white/10 px-3 py-1 rounded-full">
              AI AGENT DEVELOPMENT
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-[1.05] tracking-tight mb-5">
              {displayTitle}
            </h1>
            <p className="text-xl text-white/50 leading-relaxed mb-4 max-w-2xl">
              {displaySubtitle}
            </p>
            <p className="text-[15px] text-white/35 leading-relaxed mb-8 max-w-2xl">
              {displayDescription}
            </p>

            {/* Stat pills */}
            <div className="flex flex-wrap gap-4 sm:gap-5 mb-8 sm:mb-10 text-[13px] text-white/40">
              {[
                { icon: Video, text: `${lessons.length || 11} HD Lessons` },
                { icon: Clock, text: "~5 Hours Total" },
                { icon: CheckCircle2, text: "Lifetime Access" },
                { icon: Zap, text: "Future Updates Included" },
              ].map(({ icon: Icon, text }) => (
                <span key={text} className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5" />
                  {text}
                </span>
              ))}
            </div>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={() => videoSectionRef.current?.scrollIntoView({ behavior: "smooth" })}
                variant="outline"
                className="h-12 px-6 text-[15px] font-medium border-white/20 text-white bg-transparent hover:bg-white/10 rounded-xl"
              >
                <Play className="w-4 h-4 mr-2" />
                Watch Free Lesson
              </Button>
              {!hasAccess && (
                <Button
                  onClick={handleUnlock}
                  disabled={checkoutLoading}
                  className="h-12 px-6 text-[15px] font-semibold bg-white text-black hover:bg-white/90 rounded-xl"
                >
                  {checkoutLoading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Redirecting…</>
                  ) : (
                    <>🔓 Unlock Full Course — $497 <ChevronRight className="w-4 h-4 ml-1" /></>
                  )}
                </Button>
              )}
              {hasAccess && (
                <Button
                  onClick={() => videoSectionRef.current?.scrollIntoView({ behavior: "smooth" })}
                  className="h-12 px-6 text-[15px] font-semibold bg-green-500 hover:bg-green-400 text-white rounded-xl"
                >
                  <Play className="w-4 h-4 mr-2" />
                  Continue Learning
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Free Lesson Player ─────────────────────────────────────────── */}
      <section ref={videoSectionRef} className="bg-[#F5F5F7] py-10 sm:py-16 px-4 sm:px-6">
        <div className="max-w-4xl mx-auto">
          {/* Video */}
          <div className="rounded-3xl overflow-hidden shadow-xl bg-[#0a0a0a]">
            {activeLesson1?.videoUrl ? (
              /* GCS self-hosted MP4 — native HTML5 player (Lessons 1 & 2) */
              <SelfHostedVideoPlayer
                key={activeLesson1.id}
                videoUrl={`${BASE}${activeLesson1.videoUrl}`}
                lesson={activeLesson1}
                onProgress={(pct) => {
                  if (isLoggedIn && activeLesson1.id) {
                    saveProgress(activeLesson1.id, pct);
                  }
                }}
                onComplete={handleLessonComplete}
              />
            ) : activeLesson1?.playbackEndpoint ? (
              /* R2 presigned URL player — fetches short-lived URL from backend */
              <R2VideoPlayer
                key={activeLesson1.id}
                playbackEndpoint={activeLesson1.playbackEndpoint}
                lesson={activeLesson1}
                onProgress={(pct) => {
                  if (isLoggedIn && activeLesson1.id) {
                    saveProgress(activeLesson1.id, pct);
                  }
                }}
                onComplete={handleLessonComplete}
              />
            ) : activeLesson1?.videoEmbedUrl ? (
              /* HeyGen embed fallback */
              <iframe
                src={activeLesson1.videoEmbedUrl}
                className="w-full aspect-video"
                allow="autoplay; fullscreen"
                allowFullScreen
                title={activeLesson1.title}
              />
            ) : (
              /* Placeholder — no video configured yet */
              <div className="p-4">
                {activeLesson1 ? (
                  <VideoPlaceholder lesson={activeLesson1} />
                ) : (
                  <div className="w-full aspect-video bg-white/5 rounded-xl flex items-center justify-center">
                    <Loader2 className="w-8 h-8 text-white/20 animate-spin" />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Lesson meta */}
          {activeLesson1 && (
            <div className="mt-5 flex flex-col gap-4">
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-[13px] font-semibold text-gray-400 uppercase tracking-wider">
                    Lesson {activeLesson1.order}
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className="text-[13px] font-semibold text-gray-600 break-words">{activeLesson1.title}</span>
                  {activeLesson1.freePreview && (
                    <span className="text-[10px] font-bold text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                      FREE
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-gray-400 flex items-center gap-1 mb-3">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  Estimated length: {activeLesson1.duration ?? "—"}
                </p>
                {activeLesson1.description && (
                  <p className="text-[14px] text-gray-600 mb-2 leading-relaxed">{activeLesson1.description}</p>
                )}
                {activeLesson1.instructorNotes && (
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mt-3">
                    <p className="text-[12px] font-semibold text-blue-600 uppercase tracking-wide mb-1">
                      Instructor Notes
                    </p>
                    <p className="text-[13px] text-blue-800">{activeLesson1.instructorNotes}</p>
                  </div>
                )}
              </div>
              {/* Next lesson — full-width touch-friendly button on mobile */}
              <Button
                onClick={handleLessonComplete}
                variant="outline"
                className="w-full sm:w-auto h-11 sm:h-9 text-[14px] sm:text-[13px] border-gray-200 text-gray-600 hover:bg-gray-100 rounded-xl"
              >
                {hasAccess
                  ? <>Next: <span className="ml-1 truncate max-w-[180px] sm:max-w-none inline-block align-bottom">{lessons[activeLesson1.order]?.title ?? "Complete"}</span> →</>
                  : "Next Lesson →"}
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* ── Course Curriculum ─────────────────────────────────────────── */}
      <section className="py-12 sm:py-16 px-4 sm:px-6 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8 sm:mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">Course Curriculum</h2>
            <p className="text-gray-400 text-[15px]">{lessons.length || 11} lessons · HD quality · Lifetime access</p>
          </div>

          <div className="space-y-2">
            {lessons.map((lesson) => {
              const isActive = activeLesson1?.id === lesson.id;
              const progressEntry = progressData.find((p) => p.lessonId === lesson.id);
              const isCompleted = progressEntry?.completed ?? false;

              return (
                <div
                  key={lesson.id}
                  onClick={() => handleLessonClick(lesson)}
                  className={`flex items-center gap-4 px-5 py-4 rounded-2xl cursor-pointer transition-all border ${
                    isActive
                      ? "bg-blue-50 border-blue-200"
                      : lesson.locked
                      ? "border-transparent hover:bg-gray-50 opacity-60"
                      : "border-transparent hover:bg-gray-50"
                  }`}
                >
                  {/* Number / icon */}
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                    isCompleted
                      ? "bg-green-500"
                      : isActive
                      ? "bg-blue-500"
                      : lesson.locked
                      ? "bg-gray-100"
                      : "bg-gray-900"
                  }`}>
                    {isCompleted ? (
                      <CheckCircle2 className="w-4 h-4 text-white" />
                    ) : lesson.locked ? (
                      <Lock className="w-3.5 h-3.5 text-gray-400" />
                    ) : (
                      <span className="text-xs font-bold text-white">{lesson.order}</span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-gray-900 text-[14px] truncate">
                        {lesson.title}
                      </span>
                      {lesson.freePreview && (
                        <span className="text-[10px] font-bold text-green-600 bg-green-100 px-1.5 py-0.5 rounded-full uppercase tracking-wide shrink-0">
                          FREE
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {lesson.duration ?? "—"}
                    </p>
                  </div>

                  {/* Right icon */}
                  {lesson.locked ? (
                    <Lock className="w-4 h-4 text-gray-300 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>

          {!hasAccess && (
            <div className="text-center mt-8">
              <p className="text-[13px] text-gray-400 mb-4">Lessons 2–10 are unlocked after purchase.</p>
              <Button
                onClick={handleUnlock}
                disabled={checkoutLoading}
                className="bg-gray-900 hover:bg-gray-800 text-white rounded-xl px-8 h-11 text-[14px] font-semibold"
              >
                See Pricing <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* ── Pricing (non-enrolled) ────────────────────────────────────── */}
      {!hasAccess && (
        <section className="py-14 sm:py-20 px-4 sm:px-6 bg-[#F5F5F7]">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
              Unlock Everything. Own It Forever.
            </h2>
            <p className="text-gray-500 text-[15px] mb-10">
              One payment. Complete access. No subscriptions.
            </p>

            <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Dark header */}
              <div className="bg-[#0a0a0a] px-8 py-8">
                <p className="text-white/40 text-[12px] uppercase tracking-widest mb-2">
                  Lifetime access
                </p>
                <p className="text-5xl font-bold text-white mb-1">$497</p>
                <p className="text-white/30 text-[13px]">One-time · Future updates included</p>
              </div>

              {/* Features */}
              <div className="px-8 py-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left mb-6">
                  {[
                    "10 Complete HD Lessons",
                    "Production Architecture",
                    "Hermes Integration",
                    "Agent Skills & Memory",
                    "VM Deployment",
                    "Cloudflare Tunnel",
                    "Obsidian Knowledge Vault",
                    "Real Business Workflows",
                    "Future Course Updates",
                    "Lifetime Access",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                      <span className="text-[13px] text-gray-700">{item}</span>
                    </div>
                  ))}
                </div>

                <Button
                  onClick={handleUnlock}
                  disabled={checkoutLoading}
                  className="w-full h-13 text-[15px] font-semibold bg-gray-900 hover:bg-gray-800 text-white rounded-xl"
                >
                  {checkoutLoading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Redirecting to checkout…</>
                  ) : (
                    <>Unlock Full Course <ChevronRight className="w-4 h-4 ml-1" /></>
                  )}
                </Button>
                <p className="text-[12px] text-gray-400 mt-3">
                  Secure checkout via Stripe. 30-day money-back guarantee.
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Dashboard (enrolled) ──────────────────────────────────────── */}
      {hasAccess && progressStats && (
        <CourseDashboard
          course={course!}
          progress={progressData}
          stats={progressStats}
          onSelectLesson={handleLessonClick}
        />
      )}
    </div>
  );
}

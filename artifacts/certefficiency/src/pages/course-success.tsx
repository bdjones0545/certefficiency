import React, { useEffect, useState } from "react";
import { Link, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/logo";
import { CheckCircle2, ChevronRight, Loader2, Video } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ─── Access check helpers ─────────────────────────────────────────────────────

function getToken(): string | null {
  return localStorage.getItem("certefficiency_token");
}

/** Check platform course enrollment (new schema — /api/platform/courses/:slug/access) */
async function checkPlatformAccess(courseSlug: string): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  try {
    const resp = await fetch(`${BASE}/api/platform/courses/${courseSlug}/access`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.hasAccess === true;
  } catch {
    return false;
  }
}

/** Check legacy CSCS course purchase (old schema — /api/courses/cscs-practical/access) */
async function checkLegacyAccess(): Promise<boolean> {
  const token = getToken();
  if (!token) return false;
  try {
    const resp = await fetch(`${BASE}/api/courses/cscs-practical/access`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.hasAccess === true;
  } catch {
    return false;
  }
}

// ─── Course-specific copy ─────────────────────────────────────────────────────

interface CourseSuccessCopy {
  headline: string;
  items: string[];
  resumeHref: string;
  resumeLabel: string;
}

function getCourseCopy(courseType: string, courseSlug: string): CourseSuccessCopy {
  if (courseType === "platform" && courseSlug === "ai-agent-builder") {
    return {
      headline: "Your AI Agent course is unlocked.",
      items: [
        "10 complete HD lessons",
        "Production architecture walkthrough",
        "Hermes integration guide",
        "VM deployment & Cloudflare Tunnel setup",
        "Lifetime access — future updates included",
      ],
      resumeHref: "/course",
      resumeLabel: "Start Learning",
    };
  }
  // Default / legacy CSCS
  return {
    headline: "Your course is unlocked and ready to watch.",
    items: [
      "10 HD Lessons — full Practical & Applied curriculum",
      "Lifetime access — never expires",
      "Future updates included",
    ],
    resumeHref: "/video-course",
    resumeLabel: "Start Learning",
  };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CourseSuccess() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const courseType = params.get("ct") ?? "";
  const courseSlug = params.get("cs") ?? "";

  const [hasAccess, setHasAccess] = useState<boolean | null>(null);
  const [attempts, setAttempts] = useState(0);

  const copy = getCourseCopy(courseType, courseSlug);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      const access =
        courseType === "platform" && courseSlug
          ? await checkPlatformAccess(courseSlug)
          : await checkLegacyAccess();

      if (access) {
        setHasAccess(true);
      } else if (attempts < 12) {
        // Retry up to ~60 seconds
        timer = setTimeout(() => setAttempts((n) => n + 1), 5000);
      } else {
        // Show success anyway — webhook may still arrive soon
        setHasAccess(true);
      }
    }

    poll();
    return () => clearTimeout(timer);
  }, [attempts, courseType, courseSlug]);

  return (
    <div className="min-h-screen bg-[#F5F5F7] flex flex-col">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 h-14 flex items-center">
          <Link href="/">
            <Logo className="text-primary cursor-pointer" />
          </Link>
        </div>
      </nav>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="max-w-lg w-full text-center">
          {hasAccess === null ? (
            /* Polling state */
            <div className="bg-white rounded-3xl border border-gray-200 shadow-sm p-12">
              <div className="w-20 h-20 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-6">
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900 mb-3">Processing your payment…</h1>
              <p className="text-gray-500 text-[15px]">
                Confirming your purchase. This takes just a moment.
              </p>
            </div>
          ) : (
            /* Success state */
            <div className="bg-white rounded-3xl border border-gray-200 shadow-sm overflow-hidden">
              {/* Header */}
              <div className="bg-gradient-to-br from-gray-900 to-gray-800 px-8 py-10">
                <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center mx-auto mb-5">
                  <CheckCircle2 className="w-10 h-10 text-white" />
                </div>
                <h1 className="text-3xl font-bold text-white mb-2">You're in!</h1>
                <p className="text-white/60 text-[15px]">{copy.headline}</p>
              </div>

              {/* Details */}
              <div className="px-8 py-8">
                <div className="bg-gray-50 rounded-2xl p-5 mb-6 text-left">
                  <p className="text-[13px] font-semibold text-gray-400 uppercase tracking-wide mb-3">
                    What you unlocked
                  </p>
                  <div className="space-y-2">
                    {copy.items.map((item) => (
                      <div key={item} className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                        <span className="text-[14px] text-gray-700">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Link href={copy.resumeHref}>
                  <Button className="w-full h-12 text-[15px] font-semibold bg-gray-900 hover:bg-gray-800 rounded-xl mb-3">
                    <Video className="w-4 h-4 mr-2" />
                    {copy.resumeLabel}
                    <ChevronRight className="w-4 h-4 ml-1" />
                  </Button>
                </Link>

                <Link href="/">
                  <Button variant="ghost" className="w-full text-[14px] text-gray-500">
                    Return to CertEfficiency
                  </Button>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

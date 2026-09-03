import React, { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { Logo } from "@/components/logo";
import {
  PRICING_TIERS,
  ANIMATED_PROMPTS,
  CERT_EXAMPLES,
  SARAH_CAPABILITIES,
  INDIVIDUAL_BENEFITS,
  ORG_CAPABILITIES,
} from "@/config/landing-content";

// ---------------------------------------------------------------------------
// Design tokens — Apple-inspired palette used throughout the landing page
// ---------------------------------------------------------------------------
const T = {
  bg: "#FFFFFF",
  bgSoft: "#F5F5F7",
  text: "#1D1D1F",
  textMuted: "#6E6E73",
  accent: "#0071E3",
  accentHover: "#0077ED",
  border: "rgba(0,0,0,0.08)",
  chatUser: "#0071E3",
  chatAssistant: "#F5F5F7",
};

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", sans-serif';

// ---------------------------------------------------------------------------
// useFadeIn — fires once when element enters viewport
// ---------------------------------------------------------------------------
function useFadeIn(threshold = 0.12) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) { setVisible(true); return; }
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

// ---------------------------------------------------------------------------
// ChatBubble
// ---------------------------------------------------------------------------
function Bubble({ role, children }: { role: "user" | "sarah"; children: React.ReactNode }) {
  return role === "user" ? (
    <div className="flex justify-end mb-4">
      <div style={{ background: T.chatUser, color: "#fff", borderRadius: "18px 18px 4px 18px", maxWidth: "80%", padding: "12px 16px", fontSize: 15, lineHeight: 1.5 }}>
        {children}
      </div>
    </div>
  ) : (
    <div className="flex items-start gap-3 mb-4">
      <div style={{ width: 32, height: 32, borderRadius: "50%", background: T.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 13, flexShrink: 0 }}>S</div>
      <div style={{ background: T.chatAssistant, borderRadius: "4px 18px 18px 18px", maxWidth: "80%", padding: "12px 16px", fontSize: 15, lineHeight: 1.5, color: T.text }}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------
function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const isAuth = typeof localStorage !== "undefined" && !!localStorage.getItem("certefficiency_token");

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  const navLinks = [
    { label: "How It Works", href: "#how-it-works" },
    { label: "Meet Sarah", href: "#meet-sarah" },
    { label: "Certifications", href: "#certifications" },
    { label: "For Organizations", href: "#organizations" },
    { label: "Pricing", href: "#pricing" },
  ];

  const scrollTo = (href: string) => {
    setMenuOpen(false);
    if (href.startsWith("#")) {
      document.getElementById(href.slice(1))?.scrollIntoView({ behavior: "smooth" });
    }
  };

  return (
    <nav
      style={{
        position: "sticky", top: 0, zIndex: 100,
        background: scrolled ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.72)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: `1px solid ${scrolled ? T.border : "transparent"}`,
        transition: "border-color 0.3s, background 0.3s",
        fontFamily: FONT,
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px", height: 52, display: "flex", alignItems: "center", gap: 32 }}>
        {/* Logo */}
        <a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8, color: T.accent, flexShrink: 0 }}>
          <Logo className="text-[#0071E3]" />
        </a>

        {/* Desktop links */}
        <div className="hidden md:flex" style={{ gap: 28, flex: 1 }}>
          {navLinks.map((l) => (
            <a key={l.label} href={l.href} onClick={(e) => { e.preventDefault(); scrollTo(l.href); }}
              style={{ fontSize: 14, color: T.textMuted, textDecoration: "none", whiteSpace: "nowrap", transition: "color 0.2s" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = T.text)}
              onMouseLeave={(e) => (e.currentTarget.style.color = T.textMuted)}
            >{l.label}</a>
          ))}
        </div>

        {/* Right side */}
        <div className="hidden md:flex" style={{ gap: 12, alignItems: "center", marginLeft: "auto" }}>
          <Link href={isAuth ? "/app" : "/auth/login"}>
            <a style={{ fontSize: 14, color: T.text, textDecoration: "none" }}>Sign In</a>
          </Link>
          <Link href={isAuth ? "/app" : "/auth/register"}>
            <a style={{ background: T.accent, color: "#fff", borderRadius: 980, padding: "7px 16px", fontSize: 14, fontWeight: 500, textDecoration: "none", transition: "background 0.2s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = T.accentHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = T.accent)}
            >Start a Conversation</a>
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button className="md:hidden" onClick={() => setMenuOpen(!menuOpen)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", padding: 8 }} aria-label="Toggle menu">
          <div style={{ width: 20, height: 2, background: T.text, marginBottom: 5, transition: "transform 0.2s", transform: menuOpen ? "rotate(45deg) translate(5px, 5px)" : "none" }} />
          <div style={{ width: 20, height: 2, background: T.text, marginBottom: 5, opacity: menuOpen ? 0 : 1, transition: "opacity 0.2s" }} />
          <div style={{ width: 20, height: 2, background: T.text, transition: "transform 0.2s", transform: menuOpen ? "rotate(-45deg) translate(5px, -5px)" : "none" }} />
        </button>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <div style={{ borderTop: `1px solid ${T.border}`, padding: "16px 24px 24px", display: "flex", flexDirection: "column", gap: 4, background: "rgba(255,255,255,0.95)" }}>
          {navLinks.map((l) => (
            <a key={l.label} href={l.href} onClick={(e) => { e.preventDefault(); scrollTo(l.href); }}
              style={{ fontSize: 17, color: T.text, textDecoration: "none", padding: "10px 0", borderBottom: `1px solid ${T.border}` }}
            >{l.label}</a>
          ))}
          <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
            <Link href={isAuth ? "/app" : "/auth/login"} onClick={() => setMenuOpen(false)}>
              <a style={{ flex: 1, textAlign: "center", padding: "12px 0", border: `1px solid ${T.border}`, borderRadius: 12, fontSize: 15, color: T.text, textDecoration: "none" }}>Sign In</a>
            </Link>
            <Link href={isAuth ? "/app" : "/auth/register"} onClick={() => setMenuOpen(false)}>
              <a style={{ flex: 1, textAlign: "center", padding: "12px 0", background: T.accent, borderRadius: 12, fontSize: 15, color: "#fff", fontWeight: 500, textDecoration: "none" }}>Start Conversation</a>
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------
function HeroSection() {
  const isAuth = typeof localStorage !== "undefined" && !!localStorage.getItem("certefficiency_token");
  const appHref = isAuth ? "/app" : "/auth/register";

  return (
    <section style={{ background: T.bg, padding: "80px 24px 0", fontFamily: FONT, textAlign: "center" }}>
      <div style={{ maxWidth: 740, margin: "0 auto" }}>
        {/* Eyebrow */}
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.accent, marginBottom: 20 }}>
          Conversational Certification Prep
        </p>

        {/* Headline */}
        <h1 style={{ fontSize: "clamp(40px, 6vw, 72px)", fontWeight: 700, lineHeight: 1.08, letterSpacing: "-0.025em", color: T.text, margin: "0 0 24px" }}>
          Your certification journey<br />starts with a conversation.
        </h1>

        {/* Sub */}
        <p style={{ fontSize: "clamp(17px, 2.2vw, 21px)", color: T.textMuted, lineHeight: 1.55, maxWidth: 560, margin: "0 auto 36px" }}>
          Tell Sarah what certification you are pursuing, what materials you have, and where you need help. She turns that conversation into a personalized study experience.
        </p>

        {/* CTAs */}
        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginBottom: 16 }}>
          <Link href={appHref}>
            <a style={{ background: T.accent, color: "#fff", borderRadius: 980, padding: "14px 28px", fontSize: 17, fontWeight: 500, textDecoration: "none", display: "inline-block", transition: "background 0.2s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = T.accentHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = T.accent)}
            >Start a Conversation</a>
          </Link>
          <a href="#how-it-works" onClick={(e) => { e.preventDefault(); document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" }); }}
            style={{ border: `1px solid rgba(0,0,0,0.16)`, color: T.text, borderRadius: 980, padding: "14px 28px", fontSize: 17, textDecoration: "none", display: "inline-block", transition: "background 0.2s" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = T.bgSoft)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >See How Sarah Works</a>
        </div>
        <p style={{ fontSize: 14, color: T.textMuted, marginBottom: 64 }}>
          One conversation. Personalized preparation. Continuous progress.
        </p>
      </div>

      {/* Hero chat mockup */}
      <div style={{ maxWidth: 860, margin: "0 auto", borderRadius: 20, overflow: "hidden", boxShadow: "0 24px 80px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.06)", background: "#fff" }}>
        {/* Window chrome */}
        <div style={{ background: "#F3F3F5", borderBottom: `1px solid ${T.border}`, padding: "12px 16px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#FF5F57", display: "inline-block" }} />
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#FEBC2E", display: "inline-block" }} />
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#28C840", display: "inline-block" }} />
          <span style={{ fontSize: 13, color: T.textMuted, marginLeft: 8, fontFamily: FONT }}>CertEfficiency — Study Session</span>
        </div>

        <div style={{ display: "flex", height: 440 }}>
          {/* Sidebar */}
          <div className="hidden md:flex" style={{ width: 220, borderRight: `1px solid ${T.border}`, padding: "16px 12px", flexDirection: "column", gap: 4, flexShrink: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: T.textMuted, padding: "4px 8px 8px" }}>Conversations</div>
            {["CSCS Study Plan", "PMP Foundations", "Security+ Review"].map((t, i) => (
              <div key={t} style={{ padding: "8px 10px", borderRadius: 8, background: i === 0 ? T.bgSoft : "transparent", fontSize: 13, color: i === 0 ? T.text : T.textMuted, cursor: "default" }}>{t}</div>
            ))}
          </div>

          {/* Chat area */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            {/* Chat header */}
            <div style={{ borderBottom: `1px solid ${T.border}`, padding: "12px 20px", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: T.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>S</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: T.text, lineHeight: 1.2 }}>Sarah</div>
                <div style={{ fontSize: 12, color: "#34C759" }}>● AI Certification Specialist</div>
              </div>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 20px 8px", fontFamily: FONT }}>
              <Bubble role="user">I'm preparing for a professional certification and I'm not sure where to begin.</Bubble>
              <Bubble role="sarah">Let's build your study plan. What certification are you pursuing, and when is your exam?</Bubble>
              <Bubble role="user">The CSCS. My exam is in eight weeks.</Bubble>
              <Bubble role="sarah">
                Great. You can upload the exam outline, study notes, or any materials you are authorized to use. I'll help organize the content, identify your starting point, and create a study approach around your timeline.
              </Bubble>
            </div>

            {/* Suggested actions */}
            <div style={{ padding: "12px 16px 16px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {["Upload exam outline", "Build my study plan", "Assess my knowledge", "Ask Sarah a question"].map((a) => (
                <span key={a} style={{ fontSize: 12, padding: "6px 12px", borderRadius: 980, border: `1px solid ${T.border}`, color: T.textMuted, cursor: "default", background: T.bgSoft }}>{a}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Prompts Demo
// ---------------------------------------------------------------------------
function PromptsSection() {
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);
  const { ref, visible } = useFadeIn();

  useEffect(() => {
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % ANIMATED_PROMPTS.length);
        setFade(true);
      }, 300);
    }, 3200);
    return () => clearInterval(interval);
  }, []);

  return (
    <section ref={ref} style={{ background: T.bgSoft, padding: "96px 24px", fontFamily: FONT, opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: "opacity 0.7s ease, transform 0.7s ease" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
        <h2 style={{ fontSize: "clamp(32px, 4vw, 52px)", fontWeight: 700, letterSpacing: "-0.02em", color: T.text, marginBottom: 48 }}>
          Just tell Sarah what you need.
        </h2>

        <div style={{ background: "#fff", borderRadius: 16, padding: "24px 28px", boxShadow: "0 4px 24px rgba(0,0,0,0.07)", border: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: T.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 600, flexShrink: 0 }}>S</div>
            <div style={{ flex: 1, background: T.bgSoft, borderRadius: 24, padding: "12px 18px", textAlign: "left" }}>
              <span style={{ fontSize: 16, color: T.text, opacity: fade ? 1 : 0, transition: "opacity 0.3s", display: "inline-block" }}>
                "{ANIMATED_PROMPTS[index]}"
              </span>
            </div>
            <div style={{ width: 36, height: 36, borderRadius: "50%", background: T.accent, cursor: "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
          </div>
        </div>

        <p style={{ fontSize: 16, color: T.textMuted, marginTop: 32, lineHeight: 1.6 }}>
          Sarah responds with the appropriate study experience — a plan, an explanation, a quiz, or a review — based on exactly what you ask.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Core Explanation
// ---------------------------------------------------------------------------
function CoreSection() {
  const { ref, visible } = useFadeIn();
  const items = [
    "Which certification the learner is pursuing",
    "When the exam is scheduled",
    "Which materials were provided",
    "Which topics have been covered",
    "Which concepts remain unclear",
    "Which questions were answered incorrectly",
    "What the learner should study next",
  ];
  return (
    <section ref={ref} style={{ background: T.bg, padding: "96px 24px", fontFamily: FONT, opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: "opacity 0.7s ease, transform 0.7s ease" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.accent, marginBottom: 12 }}>More Than a Chatbot</p>
        <h2 style={{ fontSize: "clamp(32px, 4vw, 52px)", fontWeight: 700, letterSpacing: "-0.02em", color: T.text, marginBottom: 24, maxWidth: 620 }}>
          The conversation becomes the study system.
        </h2>
        <p style={{ fontSize: 18, color: T.textMuted, lineHeight: 1.65, maxWidth: 620, marginBottom: 40 }}>
          Sarah uses the certification goal, source materials, prior conversations, learner performance, and study history to guide preparation over time. Each interaction is part of a connected learning experience.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginBottom: 40 }}>
          {items.map((item) => (
            <div key={item} style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: T.bgSoft, borderRadius: 12 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: T.accent, flexShrink: 0 }} />
              <span style={{ fontSize: 15, color: T.text, lineHeight: 1.4 }}>Sarah remembers {item.toLowerCase()}</span>
            </div>
          ))}
        </div>
        <p style={{ fontSize: "clamp(20px, 2.5vw, 28px)", fontWeight: 600, color: T.text, letterSpacing: "-0.01em", borderLeft: `3px solid ${T.accent}`, paddingLeft: 20 }}>
          The learner should never feel like they are starting over.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// How It Works
// ---------------------------------------------------------------------------
function HowItWorksSection() {
  const { ref, visible } = useFadeIn();
  const steps = [
    {
      num: "01", title: "Start the conversation",
      body: "Tell Sarah which certification you are pursuing and what you need help with.",
      example: '"I\'m studying for the PMP exam and I have twelve weeks."',
    },
    {
      num: "02", title: "Give Sarah the right context",
      body: "Upload or describe the trusted materials that define the certification — candidate handbooks, exam outlines, professional standards, instructor materials, or personal notes.",
      example: null,
    },
    {
      num: "03", title: "Learn through conversation",
      body: "Sarah creates lessons, explains concepts, asks questions, generates practice, and adapts based on how you respond.",
      example: null,
    },
    {
      num: "04", title: "Keep improving",
      body: "Sarah maintains the study context, revisits weak areas, tracks progress, and recommends the next best action — every session.",
      example: null,
    },
  ];
  return (
    <section id="how-it-works" ref={ref} style={{ background: T.bgSoft, padding: "96px 24px", fontFamily: FONT, opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: "opacity 0.7s ease, transform 0.7s ease" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.accent, marginBottom: 12, textAlign: "center" }}>How It Works</p>
        <h2 style={{ fontSize: "clamp(32px, 4vw, 52px)", fontWeight: 700, letterSpacing: "-0.02em", color: T.text, marginBottom: 64, textAlign: "center" }}>
          Four steps. One continuous conversation.
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 24 }}>
          {steps.map((s) => (
            <div key={s.num} style={{ background: "#fff", borderRadius: 16, padding: "28px 28px", border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.accent, letterSpacing: "0.04em", marginBottom: 12 }}>{s.num}</div>
              <h3 style={{ fontSize: 20, fontWeight: 600, color: T.text, marginBottom: 10, letterSpacing: "-0.01em" }}>{s.title}</h3>
              <p style={{ fontSize: 15, color: T.textMuted, lineHeight: 1.6, marginBottom: s.example ? 14 : 0 }}>{s.body}</p>
              {s.example && (
                <p style={{ fontSize: 14, color: T.accent, fontStyle: "italic", background: "#EEF6FE", borderRadius: 8, padding: "10px 14px" }}>{s.example}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Meet Sarah
// ---------------------------------------------------------------------------
function MeetSarahSection() {
  const { ref, visible } = useFadeIn();
  return (
    <section id="meet-sarah" ref={ref} style={{ background: T.bg, padding: "96px 24px", fontFamily: FONT, opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: "opacity 0.7s ease, transform 0.7s ease" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "start" }} className="grid-responsive">
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.accent, marginBottom: 12 }}>Meet Sarah</p>
          <h2 style={{ fontSize: "clamp(32px, 4vw, 48px)", fontWeight: 700, letterSpacing: "-0.02em", color: T.text, marginBottom: 20 }}>
            A certification specialist you can talk to.
          </h2>
          <p style={{ fontSize: 17, color: T.textMuted, lineHeight: 1.65, marginBottom: 24 }}>
            Sarah is the intelligence behind CertEfficiency. She can be directed toward a certification, equipped with trusted materials, and given a clear learner goal — and from there she helps turn complex requirements into a personalized preparation experience.
          </p>
          <div style={{ padding: "16px 20px", background: "#EEF6FE", borderRadius: 12, borderLeft: `3px solid ${T.accent}` }}>
            <p style={{ fontSize: 16, color: T.text, lineHeight: 1.55, margin: 0 }}>
              Sarah does not need to know everything. She needs the right direction, trusted materials, and a clear certification goal.
            </p>
          </div>
        </div>
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {SARAH_CAPABILITIES.map((cap) => (
              <div key={cap} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 0" }}>
                <svg style={{ flexShrink: 0, marginTop: 2 }} width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke={T.accent} strokeWidth="1.5" /><path d="M5 8l2 2 4-4" stroke={T.accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span style={{ fontSize: 14, color: T.text, lineHeight: 1.4 }}>{cap}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Chat Demo — Teaching interaction
// ---------------------------------------------------------------------------
function ChatDemoSection() {
  const { ref, visible } = useFadeIn();
  return (
    <section ref={ref} style={{ background: T.bgSoft, padding: "96px 24px", fontFamily: FONT, opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: "opacity 0.7s ease, transform 0.7s ease" }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.accent, marginBottom: 12, textAlign: "center" }}>Active Learning</p>
        <h2 style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 700, letterSpacing: "-0.02em", color: T.text, marginBottom: 12, textAlign: "center" }}>
          Sarah teaches. She doesn't just answer.
        </h2>
        <p style={{ fontSize: 17, color: T.textMuted, textAlign: "center", marginBottom: 48, lineHeight: 1.55 }}>
          Every response is calibrated to where you are in your preparation — not just the question you asked.
        </p>

        <div style={{ background: "#fff", borderRadius: 20, overflow: "hidden", border: `1px solid ${T.border}`, boxShadow: "0 8px 40px rgba(0,0,0,0.07)" }}>
          <div style={{ borderBottom: `1px solid ${T.border}`, padding: "14px 20px", display: "flex", alignItems: "center", gap: 10, background: "#FAFAFA" }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: T.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 }}>S</div>
            <span style={{ fontSize: 14, fontWeight: 600, color: T.text }}>Sarah — Risk Management Review</span>
          </div>
          <div style={{ padding: "24px 20px" }}>
            <Bubble role="user">I keep getting questions about risk management wrong.</Bubble>
            <Bubble role="sarah">Before we review the answers, tell me how you currently define risk response planning.</Bubble>
            <Bubble role="user">It is deciding how to react after a risk happens.</Bubble>
            <Bubble role="sarah">That explains the confusion. Risk response planning happens before the event. Let's rebuild the concept using the terminology from your uploaded exam outline.</Bubble>
            <Bubble role="sarah">Which response strategy changes the probability or impact of a negative risk before it occurs?</Bubble>

            {/* Multiple choice */}
            <div style={{ marginLeft: 44, marginTop: 4 }}>
              {["A. Acceptance", "B. Mitigation", "C. Transfer", "D. Exploitation"].map((opt, i) => (
                <div key={opt} style={{ padding: "10px 14px", border: `1px solid ${i === 1 ? T.accent : T.border}`, borderRadius: 10, marginBottom: 8, fontSize: 14, color: i === 1 ? T.accent : T.text, background: i === 1 ? "#EEF6FE" : "#fff", cursor: "default" }}>
                  {opt} {i === 1 && <span style={{ fontSize: 12, color: T.accent, marginLeft: 8 }}>✓ Correct</span>}
                </div>
              ))}
            </div>

            <div style={{ marginLeft: 44, marginTop: 8 }}>
              <Bubble role="sarah">Correct. Mitigation reduces the probability or impact before a risk occurs. Acceptance deals with it after. This distinction appears frequently in the exam — I'll flag it in your review queue.</Bubble>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Source Materials
// ---------------------------------------------------------------------------
function SourceMaterialsSection() {
  const { ref, visible } = useFadeIn();
  return (
    <section ref={ref} style={{ background: T.bg, padding: "96px 24px", fontFamily: FONT, opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: "opacity 0.7s ease, transform 0.7s ease" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "center" }} className="grid-responsive">
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.accent, marginBottom: 12 }}>Grounded in the Materials That Matter</p>
          <h2 style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 700, letterSpacing: "-0.02em", color: T.text, marginBottom: 20 }}>
            Bring the requirements. Sarah builds the preparation around them.
          </h2>
          <p style={{ fontSize: 17, color: T.textMuted, lineHeight: 1.65, marginBottom: 20 }}>
            Certifications differ in their terminology, standards, domains, testing methods, and expected reasoning. Sarah can use trusted materials to understand the certification and shape the conversation around it.
          </p>
          <div style={{ fontSize: 13, color: T.textMuted, padding: "12px 16px", background: T.bgSoft, borderRadius: 10, lineHeight: 1.6, border: `1px solid ${T.border}` }}>
            Users and organizations are responsible for ensuring they have permission to upload and use all source materials.
          </div>
        </div>

        {/* Chat mockup with files */}
        <div style={{ background: "#fff", borderRadius: 20, border: `1px solid ${T.border}`, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.07)" }}>
          <div style={{ borderBottom: `1px solid ${T.border}`, padding: "12px 16px", background: "#FAFAFA", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: T.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>S</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Sarah</span>
          </div>
          <div style={{ padding: "20px 16px" }}>
            {/* User message with files */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8, alignItems: "flex-end" }}>
                {["Candidate Handbook.pdf", "Exam Content Outline.pdf", "Instructor Notes.docx", "Professional Standards.pdf"].map((f) => (
                  <div key={f} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "#EEF6FE", borderRadius: 10, border: `1px solid rgba(0,113,227,0.15)` }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="2" stroke={T.accent} strokeWidth="1.3" /><path d="M4 4h6M4 6.5h6M4 9h4" stroke={T.accent} strokeWidth="1.3" strokeLinecap="round" /></svg>
                    <span style={{ fontSize: 12, color: T.accent }}>{f}</span>
                  </div>
                ))}
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ background: T.chatUser, color: "#fff", borderRadius: "14px 14px 4px 14px", padding: "10px 14px", fontSize: 14, display: "inline-block" }}>Use these files to help me prepare.</span>
              </div>
            </div>

            <Bubble role="sarah">
              I have organized the materials into seven major domains and forty-three learning objectives. Would you like me to assess your current knowledge or create a study plan first?
            </Bubble>

            <div style={{ display: "flex", gap: 8, marginLeft: 44, flexWrap: "wrap" }}>
              {["Assess my knowledge", "Create my study plan"].map((btn) => (
                <span key={btn} style={{ padding: "8px 14px", border: `1px solid ${T.accent}`, borderRadius: 980, fontSize: 13, color: T.accent, cursor: "default" }}>{btn}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Study Plan
// ---------------------------------------------------------------------------
function StudyPlanSection() {
  const { ref, visible } = useFadeIn();
  return (
    <section ref={ref} style={{ background: T.bgSoft, padding: "96px 24px", fontFamily: FONT, opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: "opacity 0.7s ease, transform 0.7s ease" }}>
      <div style={{ maxWidth: 780, margin: "0 auto" }}>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.accent, marginBottom: 12, textAlign: "center" }}>Built Around the Learner</p>
        <h2 style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 700, letterSpacing: "-0.02em", color: T.text, marginBottom: 48, textAlign: "center" }}>
          No two study conversations should be identical.
        </h2>

        <div style={{ background: "#fff", borderRadius: 20, border: `1px solid ${T.border}`, overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.07)" }}>
          <div style={{ borderBottom: `1px solid ${T.border}`, padding: "12px 16px", background: "#FAFAFA", display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: T.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600 }}>S</div>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>Sarah — Study Plan</span>
          </div>
          <div style={{ padding: "24px 20px" }}>
            <Bubble role="sarah">
              You have six weeks, can study four days per week, and scored lowest in three domains. I recommend starting with a focused two-week foundation phase before adding timed practice.
            </Bubble>

            {/* Study plan card */}
            <div style={{ marginLeft: 44, background: T.bgSoft, borderRadius: 12, padding: "16px 18px", marginBottom: 16, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 10, letterSpacing: "-0.01em" }}>Week 1</div>
              {["Review Domain 1 foundations", "Complete two guided lessons", "Answer 20 targeted questions", "Revisit missed concepts on Friday"].map((item) => (
                <div key={item} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: T.accent, flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: T.textMuted }}>{item}</span>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 8, marginLeft: 44, flexWrap: "wrap" }}>
              {["Adjust this plan", "Make it more intensive", "Start today's lesson"].map((btn) => (
                <span key={btn} style={{ padding: "8px 14px", border: `1px solid ${T.border}`, borderRadius: 980, fontSize: 13, color: T.textMuted, cursor: "default", background: "#fff" }}>{btn}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Certification Flexibility
// ---------------------------------------------------------------------------
function CertFlexSection() {
  const { ref, visible } = useFadeIn();
  return (
    <section id="certifications" ref={ref} style={{ background: T.bg, padding: "96px 24px", fontFamily: FONT, opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: "opacity 0.7s ease, transform 0.7s ease" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", textAlign: "center" }}>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.accent, marginBottom: 12 }}>One Interface. Many Certifications.</p>
        <h2 style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 700, letterSpacing: "-0.02em", color: T.text, marginBottom: 16 }}>
          The conversation changes with the certification.
        </h2>
        <p style={{ fontSize: 17, color: T.textMuted, maxWidth: 560, margin: "0 auto 48px", lineHeight: 1.6 }}>
          A strength coach, project manager, cybersecurity professional, healthcare worker, or accountant may all use the same CertEfficiency interface. What changes is the context Sarah receives.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14, textAlign: "left" }}>
          {CERT_EXAMPLES.map(({ prompt, area }) => (
            <div key={area} style={{ padding: "18px 20px", background: T.bgSoft, borderRadius: 14, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: T.accent, marginBottom: 8 }}>{area}</div>
              <p style={{ fontSize: 15, color: T.text, lineHeight: 1.45, margin: 0, fontStyle: "italic" }}>"{prompt}"</p>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 13, color: T.textMuted, marginTop: 28 }}>These are examples of potential use cases. Sarah can be directed toward any certification using trusted materials.</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// For Individuals + Organizations
// ---------------------------------------------------------------------------
function AudienceSection() {
  const { ref, visible } = useFadeIn();
  const isAuth = typeof localStorage !== "undefined" && !!localStorage.getItem("certefficiency_token");
  return (
    <section ref={ref} style={{ background: T.bgSoft, padding: "96px 24px", fontFamily: FONT, opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: "opacity 0.7s ease, transform 0.7s ease" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }} className="grid-responsive">
        {/* Individuals */}
        <div style={{ background: "#fff", borderRadius: 20, padding: "36px 32px", border: `1px solid ${T.border}` }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.accent, marginBottom: 12 }}>For Individual Learners</p>
          <h3 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.015em", color: T.text, marginBottom: 14 }}>
            A personal certification tutor, available when you need it.
          </h3>
          <p style={{ fontSize: 15, color: T.textMuted, lineHeight: 1.65, marginBottom: 24 }}>
            CertEfficiency gives learners one place to ask questions, organize materials, practice, review mistakes, and decide what to study next.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px", display: "flex", flexDirection: "column", gap: 10 }}>
            {INDIVIDUAL_BENEFITS.map((b) => (
              <li key={b} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 15, color: T.text }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke={T.accent} strokeWidth="1.5" /><path d="M5 8l2 2 4-4" stroke={T.accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                {b}
              </li>
            ))}
          </ul>
          <Link href={isAuth ? "/app" : "/auth/register"}>
            <a style={{ display: "inline-block", background: T.accent, color: "#fff", borderRadius: 980, padding: "12px 22px", fontSize: 15, fontWeight: 500, textDecoration: "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = T.accentHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = T.accent)}
            >Start Studying With Sarah</a>
          </Link>
        </div>

        {/* Organizations */}
        <div id="organizations" style={{ background: T.text, borderRadius: 20, padding: "36px 32px" }}>
          <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", marginBottom: 12 }}>For Educators & Organizations</p>
          <h3 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.015em", color: "#fff", marginBottom: 14 }}>
            Turn your curriculum into a conversational learning experience.
          </h3>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.65)", lineHeight: 1.65, marginBottom: 24 }}>
            Schools, training companies, employers, instructors, and certification organizations can use CertEfficiency to create controlled learning experiences around their own approved materials.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {ORG_CAPABILITIES.slice(0, 8).map((c) => (
              <li key={c} style={{ display: "flex", alignItems: "flex-start", gap: 6, fontSize: 13, color: "rgba(255,255,255,0.7)", lineHeight: 1.4 }}>
                <span style={{ color: "rgba(255,255,255,0.4)", marginTop: 2 }}>—</span>
                {c}
              </li>
            ))}
          </ul>
          <a href="mailto:hello@certefficiency.com"
            style={{ display: "inline-block", background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)", color: "#fff", borderRadius: 980, padding: "12px 22px", fontSize: 15, fontWeight: 500, textDecoration: "none" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.18)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.12)")}
          >Explore CertEfficiency for Organizations</a>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Founder Story
// ---------------------------------------------------------------------------
function FounderSection() {
  const { ref, visible } = useFadeIn();
  return (
    <section ref={ref} style={{ background: T.bg, padding: "96px 24px", fontFamily: FONT, opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: "opacity 0.7s ease, transform 0.7s ease" }}>
      <div style={{ maxWidth: 680, margin: "0 auto", textAlign: "center" }}>
        <h2 style={{ fontSize: "clamp(26px, 3vw, 38px)", fontWeight: 700, letterSpacing: "-0.02em", color: T.text, marginBottom: 28 }}>
          It started with one person asking for help.
        </h2>
        <p style={{ fontSize: 18, color: T.textMuted, lineHeight: 1.7, marginBottom: 24 }}>
          CertEfficiency began after a certification candidate reached out to Bryan Jones on LinkedIn because they were struggling to prepare for an exam and needed better study materials.
        </p>
        <p style={{ fontSize: 18, color: T.textMuted, lineHeight: 1.7, marginBottom: 32 }}>
          Instead of sending another static guide, Bryan began building Sarah — an AI certification specialist that could listen, teach, ask questions, organize information, and continue learning with the user over time.
        </p>
        <div style={{ padding: "20px 28px", background: "#EEF6FE", borderRadius: 14, marginBottom: 36 }}>
          <p style={{ fontSize: "clamp(18px, 2.2vw, 22px)", fontWeight: 500, color: T.text, fontStyle: "italic", margin: 0, lineHeight: 1.5 }}>
            "What if preparing for a certification could begin with a conversation instead of a pile of disconnected materials?"
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
          <div style={{ width: 52, height: 52, borderRadius: "50%", background: T.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>BJ</div>
          <p style={{ fontSize: 16, fontWeight: 600, color: T.text, margin: 0 }}>Bryan Jones, MS, CSCS, PES, EP-C</p>
          <p style={{ fontSize: 14, color: T.textMuted, margin: 0 }}>Strength coach, exercise science professional, and developer of AI-powered coaching and education systems.</p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------
function PricingSection() {
  const { ref, visible } = useFadeIn();
  return (
    <section id="pricing" ref={ref} style={{ background: T.bgSoft, padding: "96px 24px", fontFamily: FONT, opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: "opacity 0.7s ease, transform 0.7s ease" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <h2 style={{ fontSize: "clamp(28px, 3.5vw, 44px)", fontWeight: 700, letterSpacing: "-0.02em", color: T.text, textAlign: "center", marginBottom: 12 }}>
          Start with a conversation. Build from there.
        </h2>
        <p style={{ fontSize: 17, color: T.textMuted, textAlign: "center", marginBottom: 56, lineHeight: 1.55 }}>
          Pricing is being finalized. Join the waitlist to be among the first to access CertEfficiency.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 }}>
          {PRICING_TIERS.map((tier) => (
            <div key={tier.id} style={{
              background: tier.featured ? T.text : "#fff",
              borderRadius: 20,
              padding: "32px 28px",
              border: tier.featured ? "none" : `1px solid ${T.border}`,
              position: "relative",
            }}>
              {tier.featured && (
                <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: T.accent, color: "#fff", fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", padding: "4px 12px", borderRadius: 980 }}>
                  Most Popular
                </div>
              )}
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: tier.featured ? "rgba(255,255,255,0.5)" : T.accent, marginBottom: 6 }}>{tier.tagline}</div>
              <h3 style={{ fontSize: 24, fontWeight: 700, color: tier.featured ? "#fff" : T.text, marginBottom: 6 }}>{tier.name}</h3>
              <p style={{ fontSize: 14, color: tier.featured ? "rgba(255,255,255,0.6)" : T.textMuted, marginBottom: 20, lineHeight: 1.5 }}>{tier.description}</p>
              <div style={{ fontSize: 15, fontWeight: 500, color: tier.featured ? "rgba(255,255,255,0.5)" : T.textMuted, marginBottom: 24, fontStyle: "italic" }}>
                {tier.price === null ? "Pricing coming soon" : `${tier.price} ${tier.pricePeriod}`}
              </div>
              <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px", display: "flex", flexDirection: "column", gap: 10 }}>
                {tier.features.map((f) => (
                  <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 14, color: tier.featured ? "rgba(255,255,255,0.8)" : T.text, lineHeight: 1.4 }}>
                    <svg style={{ flexShrink: 0, marginTop: 1 }} width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke={tier.featured ? "rgba(255,255,255,0.4)" : T.accent} strokeWidth="1.5" /><path d="M5 8l2 2 4-4" stroke={tier.featured ? "rgba(255,255,255,0.8)" : T.accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    {f}
                  </li>
                ))}
              </ul>
              <a href={tier.ctaHref}
                style={{ display: "block", textAlign: "center", padding: "13px 20px", borderRadius: 980, fontSize: 15, fontWeight: 500, textDecoration: "none",
                  background: tier.featured ? T.accent : "transparent",
                  border: tier.featured ? "none" : `1px solid ${T.border}`,
                  color: tier.featured ? "#fff" : T.text,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = tier.featured ? T.accentHover : T.bgSoft; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = tier.featured ? T.accent : "transparent"; }}
              >{tier.cta}</a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------
function FinalCTASection() {
  const { ref, visible } = useFadeIn();
  const isAuth = typeof localStorage !== "undefined" && !!localStorage.getItem("certefficiency_token");
  return (
    <section ref={ref} style={{ background: T.text, padding: "100px 24px", fontFamily: FONT, textAlign: "center", opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(24px)", transition: "opacity 0.7s ease, transform 0.7s ease" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        <h2 style={{ fontSize: "clamp(32px, 4.5vw, 56px)", fontWeight: 700, letterSpacing: "-0.025em", color: "#fff", marginBottom: 20, lineHeight: 1.1 }}>
          The next step is simple.<br />Ask Sarah.
        </h2>
        <p style={{ fontSize: 18, color: "rgba(255,255,255,0.65)", lineHeight: 1.6, marginBottom: 44 }}>
          Tell her the certification, share what you have, and start building a study experience around the way you learn.
        </p>

        {/* Chat input */}
        <div style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 16, padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, marginBottom: 32, backdropFilter: "blur(8px)" }}>
          <span style={{ flex: 1, fontSize: 16, color: "rgba(255,255,255,0.4)", textAlign: "left" }}>What certification are you preparing for?</span>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        </div>

        <div style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href={isAuth ? "/app" : "/auth/register"}>
            <a style={{ background: T.accent, color: "#fff", borderRadius: 980, padding: "14px 28px", fontSize: 17, fontWeight: 500, textDecoration: "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = T.accentHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = T.accent)}
            >Start a Conversation</a>
          </Link>
          <a href="#how-it-works" onClick={(e) => { e.preventDefault(); document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" }); }}
            style={{ border: "1px solid rgba(255,255,255,0.2)", color: "#fff", borderRadius: 980, padding: "14px 28px", fontSize: 17, textDecoration: "none" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.07)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >See How It Works</a>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------
function Footer() {
  const year = new Date().getFullYear();
  const cols = [
    { heading: "Product", links: [{ label: "How It Works", href: "#how-it-works" }, { label: "Meet Sarah", href: "#meet-sarah" }, { label: "Certifications", href: "#certifications" }, { label: "Pricing", href: "#pricing" }] },
    { heading: "Use Cases", links: [{ label: "For Individuals", href: "#" }, { label: "For Organizations", href: "#organizations" }] },
    { heading: "Company", links: [{ label: "About", href: "#" }, { label: "Contact", href: "mailto:hello@certefficiency.com" }] },
    { heading: "Legal", links: [{ label: "Privacy Policy", href: "#" }, { label: "Terms of Service", href: "#" }, { label: "Accessibility", href: "#" }] },
  ];
  return (
    <footer style={{ background: "#F5F5F7", borderTop: `1px solid ${T.border}`, padding: "56px 24px 36px", fontFamily: FONT }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr", gap: 32, marginBottom: 48 }} className="footer-grid">
          <div>
            <div style={{ color: T.accent, marginBottom: 12 }}><Logo /></div>
            <p style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.6, maxWidth: 240 }}>
              A conversational AI study system for professional certifications.
            </p>
          </div>
          {cols.map((col) => (
            <div key={col.heading}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: T.text, marginBottom: 14 }}>{col.heading}</div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {col.links.map((l) => (
                  <li key={l.label}><a href={l.href} style={{ fontSize: 14, color: T.textMuted, textDecoration: "none" }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = T.text)}
                    onMouseLeave={(e) => (e.currentTarget.style.color = T.textMuted)}
                  >{l.label}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 24, display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ fontSize: 12, color: T.textMuted }}>© {year} CertEfficiency. All rights reserved.</p>
          <p style={{ fontSize: 12, color: T.textMuted, lineHeight: 1.6, maxWidth: 680 }}>
            CertEfficiency is an independent educational platform. Unless explicitly stated, it is not affiliated with, endorsed by, or sponsored by the organizations that administer certifications referenced on the platform.
          </p>
        </div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Page — assembled
// ---------------------------------------------------------------------------
export default function Landing() {
  return (
    <div style={{ fontFamily: FONT, background: T.bg }}>
      {/* Inline responsive helpers that Tailwind grid utilities don't cover in one-off layouts */}
      <style>{`
        @media (max-width: 640px) {
          .grid-responsive { grid-template-columns: 1fr !important; gap: 20px !important; }
          .footer-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 480px) {
          .footer-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <Nav />
      <main>
        <HeroSection />
        <PromptsSection />
        <CoreSection />
        <HowItWorksSection />
        <MeetSarahSection />
        <ChatDemoSection />
        <SourceMaterialsSection />
        <StudyPlanSection />
        <CertFlexSection />
        <AudienceSection />
        <FounderSection />
        <PricingSection />
        <FinalCTASection />
      </main>
      <Footer />
    </div>
  );
}

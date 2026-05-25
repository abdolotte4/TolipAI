import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useCrmLogin } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import AuroraBackground from "./login/AuroraBackground";
import LoginCard from "./login/LoginCard";
import LiveStatsTicker from "./login/LiveStatsTicker";
import ComparisonMatrix from "./login/ComparisonMatrix";
import TestimonialMarquee from "./login/TestimonialMarquee";
import FeaturesShowcase from "./login/FeaturesShowcase";
import PricingSection from "./login/PricingSection";
import EmailCapture from "./login/EmailCapture";

// Floating sparkle particles
function Particles() {
  const particles = Array.from({ length: 18 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: 1 + Math.random() * 2,
    delay: Math.random() * 6,
    duration: 4 + Math.random() * 6,
  }));
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      {particles.map(p => (
        <div
          key={p.id}
          className="absolute rounded-full bg-white/20"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            animation: `float ${p.duration}s ${p.delay}s ease-in-out infinite alternate`,
          }}
        />
      ))}
    </div>
  );
}

// Animated badge that pulses
function PulseBadge({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.5, type: "spring", stiffness: 200 }}
      className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-500/20 to-fuchsia-500/20 border border-violet-500/30 px-4 py-1.5 text-xs font-semibold text-violet-300 mb-6 backdrop-blur-sm"
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-400" />
      </span>
      {children}
    </motion.div>
  );
}

// Word-by-word animated headline
function AnimatedHeadline() {
  const lines = [
    { text: "The First CRM That", gradient: false },
    { text: "Closes Deals", gradient: true },
    { text: "While You Sleep", gradient: false },
  ];
  return (
    <h1 className="text-5xl md:text-6xl xl:text-7xl font-bold tracking-tight text-white leading-[1.05]">
      {lines.map((line, li) => (
        <motion.div
          key={li}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 + li * 0.14, duration: 0.55, ease: "easeOut" }}
          className="block"
        >
          {line.gradient ? (
            <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-rose-400 bg-clip-text text-transparent drop-shadow-[0_0_40px_rgba(139,92,246,0.5)]">
              {line.text}
            </span>
          ) : line.text}
        </motion.div>
      ))}
    </h1>
  );
}

// Divider with glow
function GlowDivider() {
  return (
    <div className="relative my-2">
      <div className="h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />
      <div className="absolute inset-0 h-px bg-gradient-to-r from-transparent via-fuchsia-400/20 to-transparent blur-sm" />
    </div>
  );
}

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const loginMutation = useCrmLogin();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(
      { data: { email, password } },
      {
        onSuccess: (data: any) => {
          localStorage.setItem("crm_token", data.token);
          if (data.user?.role === "super_admin") {
            setLocation("/campaigns");
          } else {
            setLocation("/");
          }
        },
        onError: (error: unknown) => {
          const message = error instanceof Error ? error.message : "Unknown error";
          toast({
            title: "Login Failed",
            description: message || "Please check your credentials and try again.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950">
      <style>{`
        @keyframes float {
          from { transform: translateY(0px) scale(1); opacity: 0.3; }
          to   { transform: translateY(-20px) scale(1.5); opacity: 0.7; }
        }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .shimmer-text {
          background: linear-gradient(90deg, #a78bfa, #f0abfc, #fb7185, #f0abfc, #a78bfa);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          animation: shimmer 4s linear infinite;
        }
      `}</style>

      <AuroraBackground />
      <Particles />

      <div className="relative z-10 flex flex-col">

        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <div className="min-h-screen flex items-center justify-center px-4 py-16 md:py-24">
          <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-14 lg:gap-20 items-center">

            {/* LEFT — Value prop */}
            <div className="space-y-7 text-center lg:text-left">
              <PulseBadge>⚡ Now with AI Voice Agents — Live 24/7</PulseBadge>

              <AnimatedHeadline />

              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.52, duration: 0.5 }}
                className="text-lg text-slate-400 max-w-lg mx-auto lg:mx-0 leading-relaxed"
              >
                AI voice agents answer your seller calls 24/7. Power dialers burn through lead lists in minutes. Satellite AI evaluates property condition before you drive.{" "}
                <span className="text-slate-300 font-medium">Everything else is just a spreadsheet with extra steps.</span>
              </motion.p>

              {/* Feature pills */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6, duration: 0.45 }}
                className="flex flex-wrap gap-2 justify-center lg:justify-start"
              >
                {["24/7 AI Calls", "Power Dialer", "Satellite AI", "Skip Tracing", "Browser Dialer", "Offline PWA", "White-Label"].map((pill, i) => (
                  <motion.span
                    key={pill}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.65 + i * 0.06 }}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 backdrop-blur-sm"
                  >
                    {pill}
                  </motion.span>
                ))}
              </motion.div>

              {/* CTA buttons */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.72, duration: 0.45 }}
                className="flex gap-3 justify-center lg:justify-start flex-wrap"
              >
                <a
                  href="#all-features"
                  className="group relative rounded-xl overflow-hidden px-6 py-3 font-bold text-sm text-white shadow-xl"
                >
                  <span className="absolute inset-0 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-500 transition-all group-hover:scale-110 duration-300" />
                  <span className="relative flex items-center gap-2">
                    See All 24 Features
                    <span className="text-base">→</span>
                  </span>
                </a>
                <a
                  href="#compare"
                  className="rounded-xl border border-white/12 bg-white/5 px-6 py-3 font-semibold text-white hover:bg-white/10 transition text-sm backdrop-blur-sm"
                >
                  Compare vs. Others ↓
                </a>
              </motion.div>

              <GlowDivider />

              {/* Live stats */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.85, duration: 0.6 }}
              >
                <LiveStatsTicker />
              </motion.div>
            </div>

            {/* RIGHT — Login card */}
            <div className="flex justify-center lg:justify-end">
              <LoginCard
                email={email}
                password={password}
                isPending={loginMutation.isPending}
                onEmailChange={setEmail}
                onPasswordChange={setPassword}
                onSubmit={handleSubmit}
              />
            </div>
          </div>
        </div>

        {/* ── EMAIL CAPTURE ────────────────────────────────────────────────── */}
        <EmailCapture />

        {/* ── FEATURES SHOWCASE ────────────────────────────────────────────── */}
        <FeaturesShowcase />

        <GlowDivider />

        {/* ── COMPARISON MATRIX ────────────────────────────────────────────── */}
        <div id="compare" className="px-4 pb-16">
          <ComparisonMatrix />
        </div>

        <GlowDivider />

        {/* ── TESTIMONIAL MARQUEE ──────────────────────────────────────────── */}
        <TestimonialMarquee />

        {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.6, duration: 0.6 }}
          className="relative px-4 py-24 text-center overflow-hidden"
        >
          {/* Glow behind CTA */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-[600px] h-[300px] rounded-full bg-violet-600/10 blur-[80px]" />
          </div>

          <div className="relative z-10 max-w-2xl mx-auto space-y-6">
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-300">
              ✓ No long-term contract · Cancel anytime
            </span>
            <h2 className="text-4xl md:text-5xl font-bold text-white leading-tight">
              Stop Losing Deals to{" "}
              <span className="shimmer-text">Slower Competitors</span>
            </h2>
            <p className="text-slate-400 text-lg">
              Every day you wait, someone else is using TolipAI to call your leads, close your deals, and build the portfolio you're planning.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="mailto:info@tolipai.com"
                className="group relative rounded-xl overflow-hidden px-10 py-4 font-bold text-white text-base shadow-2xl shadow-violet-500/30 hover:shadow-violet-500/50 transition-shadow duration-300"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-500" />
                <span className="absolute inset-0 bg-gradient-to-r from-violet-400 via-fuchsia-400 to-rose-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <span className="relative">Get Access — Email Us →</span>
              </a>
              <a
                href="tel:3074882217"
                className="rounded-xl border border-white/15 bg-white/5 px-10 py-4 font-semibold text-white hover:bg-white/10 transition text-base backdrop-blur-sm"
              >
                (307) 488-2217
              </a>
            </div>
            <p className="text-xs text-slate-600 pt-2">
              Tolip Group LLC · info@tolipai.com · Real estate wholesaling CRM platform ·{" "}
              <a href="/tos" className="hover:text-slate-400 underline underline-offset-2 transition-colors">
                Terms of Service
              </a>
            </p>
          </div>
        </motion.div>

        {/* ── PRICING ───────────────────────────────────────────────────────── */}
        <PricingSection />

      </div>
    </div>
  );
}

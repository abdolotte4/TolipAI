import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, ArrowRight, CheckCircle2, Loader2, Calendar } from "lucide-react";

export default function EmailCapture() {
  const [email, setEmail]     = useState("");
  const [name,  setName]      = useState("");
  const [state, setState]     = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errMsg, setErrMsg]   = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setState("loading");
    setErrMsg("");
    try {
      const res = await fetch("/api/crm/public/waitlist", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email, name: name || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Something went wrong");
      }
      setState("success");
    } catch (err: any) {
      setErrMsg(err.message || "Could not submit. Please try again.");
      setState("error");
    }
  }

  return (
    <section
      aria-label="Get early access to TolipAI"
      className="w-full bg-gradient-to-b from-transparent via-violet-950/20 to-transparent border-y border-white/5 py-14 px-4"
    >
      <div className="max-w-2xl mx-auto text-center space-y-6">
        {/* Headline */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <p className="text-xs font-semibold tracking-widest uppercase text-violet-400 mb-2">
            Limited Access — Join the Waitlist
          </p>
          <h2 className="text-2xl md:text-3xl font-bold text-white leading-snug">
            Get Early Access to TolipAI
          </h2>
          <p className="text-slate-400 text-sm mt-2 leading-relaxed">
            We onboard new accounts weekly. Drop your email and we'll reach out within 24 hours.
          </p>
        </motion.div>

        {/* Form */}
        <AnimatePresence mode="wait">
          {state === "success" ? (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center gap-3 py-4"
            >
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              <p className="text-white font-semibold text-lg">You're on the list!</p>
              <p className="text-slate-400 text-sm">We'll email you at <span className="text-white font-medium">{email}</span> within 24 hours.</p>
            </motion.div>
          ) : (
            <motion.form
              key="form"
              onSubmit={handleSubmit}
              className="flex flex-col sm:flex-row gap-3"
            >
              <input
                type="text"
                placeholder="Your name (optional)"
                value={name}
                onChange={e => setName(e.target.value)}
                className="flex-1 min-w-0 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 backdrop-blur-sm transition"
              />
              <input
                type="email"
                required
                placeholder="Work email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="flex-[1.4] min-w-0 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-violet-500/50 backdrop-blur-sm transition"
              />
              <button
                type="submit"
                disabled={state === "loading" || !email}
                className="group relative shrink-0 rounded-xl overflow-hidden px-6 py-3 font-semibold text-sm text-white disabled:opacity-60 disabled:cursor-not-allowed transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <span className="absolute inset-0 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-500" />
                <span className="relative flex items-center gap-2">
                  {state === "loading" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <Mail className="w-4 h-4" />
                      Get Access
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </>
                  )}
                </span>
              </button>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Error */}
        {state === "error" && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-rose-400 text-xs"
          >
            {errMsg}
          </motion.p>
        )}

        {/* Calendly alternative */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="flex items-center justify-center gap-2 pt-1"
        >
          <span className="text-slate-600 text-xs">or</span>
          <a
            href="https://calendly.com/tolipai/demo"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors underline underline-offset-2"
          >
            <Calendar className="w-3.5 h-3.5" />
            Book a 15-min live demo →
          </a>
        </motion.div>

        <p className="text-[11px] text-slate-700">
          No spam. Unsubscribe anytime. By submitting you agree to our{" "}
          <a href="/tos" className="text-slate-500 hover:text-slate-400 underline underline-offset-2">Terms of Service</a>.
        </p>
      </div>
    </section>
  );
}

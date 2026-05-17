import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Phone, PhoneCall, CheckCircle, Zap, BarChart3, Brain } from "lucide-react";

const FEATURES = [
  { icon: Brain, label: "AI Lead Scoring", desc: "Every lead scored in real-time by deal potential" },
  { icon: PhoneCall, label: "Built-in Dialer", desc: "Browser-based WebRTC dialer with AI coaching" },
  { icon: BarChart3, label: "Live Analytics", desc: "Close rates, velocity, and pipeline health at a glance" },
  { icon: Zap, label: "Auto Follow-Up", desc: "AI SMS and email sequences that close while you sleep" },
];

export function TryDemo() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const formatPhone = (val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, 10);
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "loading") return;
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setErrorMsg("Please enter a valid 10-digit US phone number.");
      return;
    }
    setErrorMsg("");
    setStatus("loading");
    try {
      const res = await fetch("/api/demo/call", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: digits, name }),
      });
      const json = await res.json();
      if (res.ok) {
        setStatus("success");
      } else {
        setErrorMsg(json.error || "Failed to initiate call. Please try the contact form.");
        setStatus("error");
        setTimeout(() => setStatus("idle"), 5000);
      }
    } catch {
      setErrorMsg("Network error — please try again.");
      setStatus("error");
      setTimeout(() => setStatus("idle"), 5000);
    }
  };

  return (
    <section id="try-demo" className="py-24 bg-gradient-to-b from-background to-secondary/20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="inline-block py-1 px-3 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold tracking-wider uppercase mb-4">
            Live Demo
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-4">
            Hear TolipAI in Action
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Enter your phone number and we'll call you with a 60-second walkthrough of exactly what your sellers hear — powered by our AI voice agent.
          </p>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Feature list */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="space-y-6"
          >
            {FEATURES.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground text-lg">{label}</h3>
                  <p className="text-muted-foreground">{desc}</p>
                </div>
              </div>
            ))}
          </motion.div>

          {/* Call request form */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <div className="bg-card border border-border rounded-2xl p-8 shadow-xl">
              {status === "success" ? (
                <div className="text-center py-8">
                  <CheckCircle className="w-16 h-16 text-primary mx-auto mb-4" />
                  <h3 className="text-2xl font-bold text-foreground mb-2">Call Coming Your Way!</h3>
                  <p className="text-muted-foreground">
                    You'll receive a demo call within 30 seconds. Pick up to hear TolipAI in action.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <h3 className="text-xl font-bold text-foreground mb-1">Get a Free Demo Call</h3>
                    <p className="text-sm text-muted-foreground">We'll call you — no app needed.</p>
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium text-foreground">Your Name (optional)</label>
                    <Input
                      type="text"
                      placeholder="John Smith"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="h-12"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-sm font-medium text-foreground">Phone Number <span className="text-red-400">*</span></label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        type="tel"
                        placeholder="(555) 000-0000"
                        value={phone}
                        onChange={(e) => setPhone(formatPhone(e.target.value))}
                        required
                        className="pl-10 h-12"
                      />
                    </div>
                    {errorMsg && (
                      <p className="text-red-400 text-sm">{errorMsg}</p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    disabled={status === "loading"}
                    className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-xl shadow-[0_0_20px_rgba(212,175,55,0.3)] hover:shadow-[0_0_30px_rgba(212,175,55,0.5)] transition-all"
                  >
                    {status === "loading" ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                        Initiating call...
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <PhoneCall className="w-5 h-5" />
                        Call Me Now — It's Free
                      </span>
                    )}
                  </Button>

                  <p className="text-xs text-muted-foreground text-center">
                    US numbers only. Max 2 demo calls per hour. By requesting a call you agree to receive a one-time automated demo call from TolipAI.
                  </p>
                </form>
              )}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

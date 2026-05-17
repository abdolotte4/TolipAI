import { motion } from "framer-motion";
import { Check, Zap, Building2, Star } from "lucide-react";

const PLANS = [
  {
    name: "Starter",
    icon: Zap,
    price: 197,
    period: "/ mo",
    badge: null,
    description: "For solo wholesalers getting started with AI automation.",
    color: "from-sky-500/20 to-blue-500/10",
    border: "border-sky-500/25",
    iconColor: "text-sky-400",
    pillColor: "bg-sky-500/10 text-sky-300 border-sky-500/20",
    btnClass: "border border-white/15 bg-white/5 hover:bg-white/10 text-white",
    features: [
      "1 campaign",
      "AI Voice Agent (inbound)",
      "Two-way SMS via Twilio",
      "Click-to-call browser dialer",
      "Up to 500 leads",
      "Basic analytics dashboard",
      "Mobile PWA",
      "Email support",
    ],
  },
  {
    name: "Pro",
    icon: Star,
    price: 397,
    period: "/ mo",
    badge: "Most Popular",
    description: "For growing teams running multiple campaigns and markets.",
    color: "from-violet-500/25 to-fuchsia-500/15",
    border: "border-violet-500/40",
    iconColor: "text-violet-400",
    pillColor: "bg-violet-500/10 text-violet-300 border-violet-500/20",
    btnClass: "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-500 text-white font-bold shadow-xl shadow-violet-500/30 hover:shadow-violet-500/50",
    features: [
      "Up to 5 campaigns",
      "AI Voice Agent + Call Whisper",
      "Power Dialer (50+ calls/hr)",
      "AI SMS auto-reply",
      "5-source skip tracing",
      "Satellite property AI",
      "Distressed lead generation",
      "Cash buyer database",
      "Call coaching + transcripts",
      "Team management (5 agents)",
      "Priority support",
    ],
  },
  {
    name: "Enterprise",
    icon: Building2,
    price: null,
    period: "",
    badge: "Custom",
    description: "White-label deployment for large brokerages and investors.",
    color: "from-amber-500/15 to-orange-500/10",
    border: "border-amber-500/25",
    iconColor: "text-amber-400",
    pillColor: "bg-amber-500/10 text-amber-300 border-amber-500/20",
    btnClass: "border border-white/15 bg-white/5 hover:bg-white/10 text-white",
    features: [
      "Unlimited campaigns",
      "White-label (custom domain + logo)",
      "Custom AI personas per campaign",
      "Webhook & Zapier integrations",
      "Full audit log",
      "Contract e-signature",
      "Background job store (DB-backed)",
      "Unlimited agents & leads",
      "Dedicated account manager",
      "SLA + phone support",
      "On-premise / private cloud option",
    ],
  },
];

export default function PricingSection() {
  return (
    <section className="w-full max-w-7xl mx-auto px-4 py-20" id="pricing">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.4, duration: 0.6 }}
        className="text-center mb-14"
      >
        <span className="inline-flex items-center rounded-full bg-violet-500/10 border border-violet-500/20 px-3 py-1 text-xs font-medium text-violet-300 mb-4">
          💳 Simple, Transparent Pricing
        </span>
        <h2 className="text-3xl md:text-4xl font-bold text-white">
          Plans That{" "}
          <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            Grow With You
          </span>
        </h2>
        <p className="text-slate-400 mt-3 text-sm max-w-xl mx-auto leading-relaxed">
          No per-feature add-ons. No nickel-and-diming. Pick a plan and get every tool in that tier from day one.
        </p>
      </motion.div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
        {PLANS.map((plan, i) => {
          const Icon = plan.icon;
          const isFeatured = plan.badge === "Most Popular";
          return (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 20, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 1.5 + i * 0.1, duration: 0.45, ease: "easeOut" }}
              className={`relative rounded-2xl border ${plan.border} bg-gradient-to-b ${plan.color} backdrop-blur-sm p-6 flex flex-col gap-5 ${isFeatured ? "ring-1 ring-violet-500/40" : ""}`}
            >
              {/* Glow for featured */}
              {isFeatured && (
                <div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-violet-500/10 to-transparent pointer-events-none" />
              )}

              {/* Badge */}
              {plan.badge && (
                <span className={`absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center px-3 py-0.5 rounded-full text-[11px] font-semibold border ${plan.pillColor}`}>
                  {plan.badge}
                </span>
              )}

              {/* Plan header */}
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center bg-white/5 border border-white/10`}>
                  <Icon className={`w-4.5 h-4.5 ${plan.iconColor}`} />
                </div>
                <div>
                  <p className="font-bold text-white text-base">{plan.name}</p>
                  <p className="text-slate-500 text-[11px] leading-tight">{plan.description}</p>
                </div>
              </div>

              {/* Price */}
              <div className="flex items-end gap-1">
                {plan.price !== null ? (
                  <>
                    <span className="text-4xl font-extrabold text-white tracking-tight">
                      ${plan.price}
                    </span>
                    <span className="text-slate-400 text-sm mb-1">{plan.period}</span>
                  </>
                ) : (
                  <span className="text-3xl font-extrabold text-white tracking-tight">
                    Custom
                  </span>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-2 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-xs text-slate-300">
                    <Check className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${plan.iconColor}`} />
                    {f}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <a
                href="mailto:info@tolipai.com"
                className={`relative w-full rounded-xl px-4 py-3 text-sm text-center font-semibold transition-all duration-200 hover:scale-[1.02] ${plan.btnClass}`}
              >
                {plan.price !== null ? `Get Started — $${plan.price}/mo` : "Contact Sales →"}
              </a>
            </motion.div>
          );
        })}
      </div>

      {/* Footer note */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.9, duration: 0.5 }}
        className="text-center text-xs text-slate-600 mt-8"
      >
        All plans include a 14-day trial · No credit card required to start · Cancel anytime
      </motion.p>
    </section>
  );
}

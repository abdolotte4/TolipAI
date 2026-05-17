import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Zap, BarChart3, Star, Building2, X } from "lucide-react";

const TOGGLE_ITEMS = ["Monthly", "Yearly"];
const YEARLY_DISCOUNT = 0.20;

const PLANS = [
  {
    name: "Starter",
    icon: Zap,
    monthlyPrice: 49,
    badge: null,
    tagline: "For solo wholesalers getting their first deals.",
    color: "from-sky-500/10 to-blue-600/5",
    border: "border-sky-500/20",
    ring: "",
    iconBg: "bg-sky-500/10 border-sky-500/20",
    iconColor: "text-sky-400",
    accentColor: "text-sky-400",
    badgeCls: "",
    btnCls: "border border-white/12 bg-white/5 hover:bg-white/10 text-white",
    features: [
      { text: "1 campaign", included: true },
      { text: "Up to 250 leads", included: true },
      { text: "Click-to-call browser dialer", included: true },
      { text: "Two-way SMS (Twilio)", included: true },
      { text: "AI SMS auto-reply (50 msgs/mo)", included: true },
      { text: "Basic pipeline kanban", included: true },
      { text: "Mobile PWA (offline)", included: true },
      { text: "Email support", included: true },
      { text: "AI Voice Agent", included: false },
      { text: "Power Dialer", included: false },
      { text: "Skip tracing", included: false },
      { text: "Satellite property AI", included: false },
    ],
  },
  {
    name: "Standard",
    icon: BarChart3,
    monthlyPrice: 99,
    badge: null,
    tagline: "For growing teams running multiple markets.",
    color: "from-violet-500/10 to-indigo-600/5",
    border: "border-violet-500/20",
    ring: "",
    iconBg: "bg-violet-500/10 border-violet-500/20",
    iconColor: "text-violet-400",
    accentColor: "text-violet-400",
    badgeCls: "",
    btnCls: "border border-white/12 bg-white/5 hover:bg-white/10 text-white",
    features: [
      { text: "2 campaigns", included: true },
      { text: "Up to 1,000 leads", included: true },
      { text: "AI Voice Agent (50 calls/mo)", included: true },
      { text: "Two-way SMS (unlimited)", included: true },
      { text: "3-source skip tracing", included: true },
      { text: "Real-time analytics dashboard", included: true },
      { text: "Team management (2 agents)", included: true },
      { text: "Priority email support", included: true },
      { text: "Power Dialer", included: false },
      { text: "Satellite property AI", included: false },
      { text: "Call coaching + transcripts", included: false },
      { text: "Contract e-signature", included: false },
    ],
  },
  {
    name: "Premium",
    icon: Star,
    monthlyPrice: 299,
    badge: "Most Popular",
    tagline: "Full AI stack for serious investors and small teams.",
    color: "from-fuchsia-500/15 to-violet-600/10",
    border: "border-fuchsia-500/35",
    ring: "ring-1 ring-fuchsia-500/30",
    iconBg: "bg-fuchsia-500/15 border-fuchsia-500/30",
    iconColor: "text-fuchsia-400",
    accentColor: "text-fuchsia-400",
    badgeCls: "bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30",
    btnCls: "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-500 text-white font-bold shadow-xl shadow-fuchsia-500/25 hover:shadow-fuchsia-500/40",
    features: [
      { text: "5 campaigns", included: true },
      { text: "Unlimited leads", included: true },
      { text: "AI Voice Agent (unlimited calls)", included: true },
      { text: "Power Dialer (50+ calls/hr)", included: true },
      { text: "5-source skip tracing", included: true },
      { text: "Satellite property AI", included: true },
      { text: "Distressed lead generation", included: true },
      { text: "Cash buyer database", included: true },
      { text: "AI call coaching + transcripts", included: true },
      { text: "Call whisper for agents", included: true },
      { text: "Team management (10 agents)", included: true },
      { text: "Contract e-signature", included: true },
    ],
  },
  {
    name: "Enterprise",
    icon: Building2,
    monthlyPrice: 599,
    badge: "White-Label",
    tagline: "Custom branding, unlimited scale, dedicated support.",
    color: "from-amber-500/10 to-orange-600/5",
    border: "border-amber-500/25",
    ring: "",
    iconBg: "bg-amber-500/10 border-amber-500/20",
    iconColor: "text-amber-400",
    accentColor: "text-amber-400",
    badgeCls: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    btnCls: "border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 font-semibold",
    features: [
      { text: "Unlimited campaigns", included: true },
      { text: "White-label (custom domain + logo)", included: true },
      { text: "Custom AI personas per campaign", included: true },
      { text: "Webhook & Zapier integrations", included: true },
      { text: "Full compliance audit log", included: true },
      { text: "DB-backed background jobs", included: true },
      { text: "Unlimited agents", included: true },
      { text: "Dedicated account manager", included: true },
      { text: "SLA + phone support", included: true },
      { text: "On-premise / private cloud option", included: true },
      { text: "Custom integrations on request", included: true },
      { text: "Everything in Premium", included: true },
    ],
  },
];

// Full feature comparison matrix rows
const COMPARE_FEATURES = [
  { label: "Campaigns", values: ["1", "2", "5", "Unlimited"] },
  { label: "Leads", values: ["250", "1,000", "Unlimited", "Unlimited"] },
  { label: "AI Voice Agent calls/mo", values: ["—", "50", "Unlimited", "Unlimited"] },
  { label: "Power Dialer", values: [false, false, true, true] },
  { label: "AI SMS auto-reply", values: ["50/mo", "Unlimited", "Unlimited", "Unlimited"] },
  { label: "Skip tracing sources", values: ["—", "3", "5", "5+"] },
  { label: "Satellite property AI", values: [false, false, true, true] },
  { label: "Call coaching + transcripts", values: [false, false, true, true] },
  { label: "Cash buyer database", values: [false, false, true, true] },
  { label: "Contract e-signature", values: [false, false, true, true] },
  { label: "Team agents", values: ["1", "2", "10", "Unlimited"] },
  { label: "White-label branding", values: [false, false, false, true] },
  { label: "Dedicated account manager", values: [false, false, false, true] },
  { label: "SLA support", values: [false, false, false, true] },
];

function PlanCard({ plan, isYearly, index }: { plan: typeof PLANS[number]; index: number; isYearly: boolean }) {
  const Icon = plan.icon;
  const price = isYearly
    ? Math.round(plan.monthlyPrice * (1 - YEARLY_DISCOUNT))
    : plan.monthlyPrice;
  const isEnterprise = plan.name === "Enterprise";

  return (
    <motion.div
      key={plan.name + (isYearly ? "y" : "m")}
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.08 * index, duration: 0.4, ease: "easeOut" }}
      className={`relative rounded-2xl border ${plan.border} ${plan.ring} bg-gradient-to-b ${plan.color} backdrop-blur-sm p-6 flex flex-col gap-5`}
    >
      {plan.badge && (
        <span className={`absolute -top-3.5 left-1/2 -translate-x-1/2 inline-flex items-center px-3 py-0.5 rounded-full text-[11px] font-semibold border ${plan.badgeCls}`}>
          {plan.badge}
        </span>
      )}

      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${plan.iconBg}`}>
          <Icon className={`w-4.5 h-4.5 ${plan.iconColor}`} />
        </div>
        <div>
          <p className="font-bold text-white text-base">{plan.name}</p>
          <p className="text-slate-500 text-[11px] leading-snug">{plan.tagline}</p>
        </div>
      </div>

      <div className="flex items-end gap-1.5">
        <AnimatePresence mode="wait">
          <motion.span
            key={price}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
            className="text-4xl font-extrabold text-white tracking-tight"
          >
            ${price}
          </motion.span>
        </AnimatePresence>
        <span className="text-slate-400 text-sm mb-1">/ mo</span>
        {isYearly && (
          <span className="ml-1 mb-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
            −20%
          </span>
        )}
      </div>
      {isYearly && (
        <p className="text-[11px] text-slate-500 -mt-3">
          Billed ${price * 12}/yr · Save ${(plan.monthlyPrice - price) * 12}/yr
        </p>
      )}

      <ul className="space-y-1.5 flex-1">
        {plan.features.map((f) => (
          <li key={f.text} className={`flex items-start gap-2 text-xs ${f.included ? "text-slate-300" : "text-slate-600"}`}>
            {f.included
              ? <Check className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${plan.accentColor}`} />
              : <X className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-700" />}
            {f.text}
          </li>
        ))}
      </ul>

      <a
        href={isEnterprise ? "mailto:info@tolipai.com?subject=Enterprise Plan Inquiry" : "mailto:info@tolipai.com"}
        className={`relative w-full rounded-xl px-4 py-3 text-sm text-center transition-all duration-200 hover:scale-[1.02] ${plan.btnCls}`}
      >
        {isEnterprise ? "Contact Sales →" : `Get ${plan.name} — $${price}/mo`}
      </a>
    </motion.div>
  );
}

export default function PricingSection() {
  const [isYearly, setIsYearly] = useState(false);
  const [showCompare, setShowCompare] = useState(false);

  return (
    <section className="w-full max-w-7xl mx-auto px-4 py-20" id="pricing">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.55 }}
        className="text-center mb-10"
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
          No per-feature add-ons. No hidden charges. Every tool in each tier from day one.
        </p>

        {/* Billing toggle */}
        <div className="flex items-center justify-center gap-3 mt-6">
          <span className={`text-sm font-medium ${!isYearly ? "text-white" : "text-slate-500"}`}>Monthly</span>
          <button
            onClick={() => setIsYearly(v => !v)}
            className={`relative w-12 h-6 rounded-full transition-colors duration-300 ${isYearly ? "bg-violet-500" : "bg-white/10 border border-white/15"}`}
          >
            <motion.div
              animate={{ x: isYearly ? 24 : 2 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="absolute top-1 w-4 h-4 rounded-full bg-white shadow-md"
            />
          </button>
          <span className={`text-sm font-medium ${isYearly ? "text-white" : "text-slate-500"}`}>
            Yearly{" "}
            <span className="text-emerald-400 text-xs font-bold">−20%</span>
          </span>
        </div>
      </motion.div>

      {/* Plan cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch">
        {PLANS.map((plan, i) => (
          <PlanCard key={plan.name} plan={plan} isYearly={isYearly} index={i} />
        ))}
      </div>

      {/* Compare all features toggle */}
      <div className="mt-10 text-center">
        <button
          onClick={() => setShowCompare(v => !v)}
          className="text-sm text-slate-400 hover:text-white transition-colors underline underline-offset-4"
        >
          {showCompare ? "Hide full comparison ↑" : "Compare all features ↓"}
        </button>
      </div>

      {/* Full comparison table */}
      <AnimatePresence>
        {showCompare && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="mt-8 rounded-2xl border border-white/8 bg-white/3 backdrop-blur-sm overflow-x-auto">
              <table className="w-full text-xs min-w-[640px]">
                <thead>
                  <tr className="border-b border-white/8">
                    <th className="text-left p-4 text-slate-400 font-medium w-1/3">Feature</th>
                    {PLANS.map(p => (
                      <th key={p.name} className={`p-4 text-center font-bold ${p.accentColor}`}>{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {COMPARE_FEATURES.map((row) => (
                    <tr key={row.label} className="hover:bg-white/3 transition-colors">
                      <td className="p-4 text-slate-400">{row.label}</td>
                      {row.values.map((val, i) => (
                        <td key={i} className="p-4 text-center text-slate-300">
                          {typeof val === "boolean" ? (
                            val
                              ? <Check className={`w-4 h-4 mx-auto ${PLANS[i].accentColor}`} />
                              : <X className="w-4 h-4 mx-auto text-slate-700" />
                          ) : (
                            <span className={val === "—" ? "text-slate-700" : "font-medium"}>{val}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="mt-8 text-center space-y-2"
      >
        <p className="text-xs text-slate-600">
          All plans include 14-day free trial · No credit card to start · Cancel anytime
        </p>
        <p className="text-xs text-slate-700">
          Need a custom plan?{" "}
          <a href="mailto:info@tolipai.com" className="text-violet-400 hover:text-violet-300 underline underline-offset-2">
            Contact us at info@tolipai.com
          </a>
        </p>
      </motion.div>
    </section>
  );
}

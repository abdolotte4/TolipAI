import { motion } from "framer-motion";
import { Check, X } from "lucide-react";

const ROWS = [
  {
    capability: "24/7 AI Voice Qualification",
    tolip: "AI answers, asks price, creates lead automatically",
    other: "Voicemail or manual call-back only",
  },
  {
    capability: "Power Dialer + Voicemail Drop",
    tolip: "50+ calls/hour, one-click pre-recorded drops",
    other: "Basic click-to-call, no automation",
  },
  {
    capability: "AI SMS Auto-Reply",
    tolip: "Contextual replies with conversation memory",
    other: "Static templates or no SMS",
  },
  {
    capability: "AI Call Coaching",
    tolip: "Instant score, offer price, transcript analysis",
    other: "Listen to recordings manually",
  },
  {
    capability: "Satellite Property AI",
    tolip: "Roof condition, lot size, distress signals from space",
    other: "Not available",
  },
  {
    capability: "5-Source Skip Tracing",
    tolip: "SOS → Corporates → PeopleSearch → PropertyAPI → LLM",
    other: "Single database lookup",
  },
  {
    capability: "Real-Time Analytics",
    tolip: "Lead velocity, conversion funnel, agent ROI dashboard",
    other: "Export to Excel required",
  },
  {
    capability: "Browser Dialer (WebRTC)",
    tolip: "Built-in — laptop + headset, no phone hardware",
    other: "Requires external phone system",
  },
  {
    capability: "Offline PWA",
    tolip: "Install on iPhone/Android, works without signal",
    other: "Desktop browser only",
  },
  {
    capability: "White-Label Campaigns",
    tolip: "Custom domains, logos, colors per client brand",
    other: "One-size-fits-all branding",
  },
];

export default function ComparisonMatrix() {
  return (
    <section className="w-full max-w-5xl mx-auto mt-24 px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1, duration: 0.6 }}
      >
        <div className="text-center mb-10">
          <span className="inline-flex items-center rounded-full bg-violet-500/10 border border-violet-500/20 px-3 py-1 text-xs font-medium text-violet-300 mb-4">
            Competitive Advantage
          </span>
          <h2 className="text-3xl font-bold text-white">Why Top Wholesalers Are Switching</h2>
          <p className="text-slate-400 mt-2 text-sm">Every feature built for one thing: closing more deals, faster.</p>
        </div>

        <div className="rounded-2xl border border-white/8 overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-3 bg-white/5 border-b border-white/8">
            <div className="px-5 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Capability</div>
            <div className="px-5 py-3 text-xs font-semibold text-violet-400 uppercase tracking-wider flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center text-[10px] font-bold text-white">T</span>
              TolipAI
            </div>
            <div className="px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Other Platforms</div>
          </div>

          {/* Rows */}
          {ROWS.map((row, i) => (
            <motion.div
              key={row.capability}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 1.1 + i * 0.05, duration: 0.4 }}
              className={`grid grid-cols-3 border-b border-white/5 last:border-0 ${i % 2 === 0 ? "" : "bg-white/[0.02]"} hover:bg-white/5 transition-colors`}
            >
              <div className="px-5 py-3.5 text-sm font-medium text-slate-300">{row.capability}</div>
              <div className="px-5 py-3.5 flex items-start gap-2">
                <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span className="text-xs text-slate-300 leading-relaxed">{row.tolip}</span>
              </div>
              <div className="px-5 py-3.5 flex items-start gap-2">
                <X className="w-4 h-4 text-slate-600 shrink-0 mt-0.5" />
                <span className="text-xs text-slate-500 leading-relaxed">{row.other}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}

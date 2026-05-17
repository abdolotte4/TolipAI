import { motion } from "framer-motion";
import {
  Brain, Phone, MessageSquare, BarChart3, Satellite, Search,
  Globe, Smartphone, Zap, Users, Target,
  FileText, Bell, Map, RefreshCw, Lock, Headphones, Radio,
  Layers, GitBranch, Mic, Mail, Database, TrendingUp,
} from "lucide-react";

const FEATURES = [
  { icon: Mic, label: "AI Voice Agent", desc: "24/7 inbound call answering — AI qualifies sellers, extracts price/motivation, creates the lead", color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
  { icon: Phone, label: "Power Dialer", desc: "50+ calls/hour with one-click voicemail drop, call coaching, and disposition logging", color: "text-sky-400", bg: "bg-sky-500/10 border-sky-500/20" },
  { icon: MessageSquare, label: "AI SMS Auto-Reply", desc: "Contextual two-way SMS with full conversation memory — responds like a real agent", color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
  { icon: Brain, label: "AI Call Coaching", desc: "Instant post-call score, suggested offer price, objection analysis, and transcript summary", color: "text-fuchsia-400", bg: "bg-fuchsia-500/10 border-fuchsia-500/20" },
  { icon: Satellite, label: "Satellite Property AI", desc: "Roof condition, lot size, distress signals, and comp data from aerial imagery before you drive", color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
  { icon: Search, label: "5-Source Skip Trace", desc: "SOS → Corporates → PeopleSearch → PropertyAPI → LLM fallback — one click, best owner data", color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20" },
  { icon: BarChart3, label: "Real-Time Analytics", desc: "Lead velocity, funnel conversion, agent ROI, call volume trends, source performance", color: "text-cyan-400", bg: "bg-cyan-500/10 border-cyan-500/20" },
  { icon: Headphones, label: "Browser Dialer (WebRTC)", desc: "Call sellers directly from your laptop — no desk phone, no SIP setup, just a headset", color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/20" },
  { icon: Smartphone, label: "Offline PWA", desc: "Install on iPhone or Android — full CRM access, works without signal in rural areas", color: "text-teal-400", bg: "bg-teal-500/10 border-teal-500/20" },
  { icon: Layers, label: "White-Label Campaigns", desc: "Run unlimited client brands — custom domains, logos, phone numbers, and AI personas per campaign", color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20" },
  { icon: Zap, label: "Distressed Lead Gen", desc: "Pull pre-foreclosures, probate, tax liens, code violations — filtered by zip code and equity", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20" },
  { icon: Database, label: "Cash Buyer Database", desc: "National cash buyer DB with transaction history — match your deals to pre-qualified buyers instantly", color: "text-green-400", bg: "bg-green-500/10 border-green-500/20" },
  { icon: Target, label: "Visual Pipeline", desc: "Kanban board with drag-and-drop — move leads through stages, track ARV, equity, and offer price", color: "text-pink-400", bg: "bg-pink-500/10 border-pink-500/20" },
  { icon: Globe, label: "Webhook Integration", desc: "Auto-sync inbound calls, texts, and form submissions from any source — Zapier, Make, direct API", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20" },
  { icon: Mail, label: "Email Sequences", desc: "Automated drip campaigns with AI-generated copy — nurture cold leads while you sleep", color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20" },
  { icon: Bell, label: "Smart Notifications", desc: "Real-time alerts for new leads, seller callbacks, deal stage changes, and AI agent activity", color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
  { icon: Users, label: "Team Management", desc: "Multi-agent campaigns with role-based access, call assignment, and per-rep performance tracking", color: "text-violet-300", bg: "bg-violet-400/10 border-violet-400/20" },
  { icon: Lock, label: "Submission Links", desc: "Public seller intake forms with custom branding — inbound leads auto-created in your campaign", color: "text-slate-400", bg: "bg-slate-500/10 border-slate-500/20" },
  { icon: TrendingUp, label: "Call Quality Monitor", desc: "MOS score, jitter, and packet loss tracked per agent — identify who has audio issues before calls drop", color: "text-emerald-300", bg: "bg-emerald-400/10 border-emerald-400/20" },
  { icon: Radio, label: "Twilio Voice SDK", desc: "Full WebRTC voice calling, recording, and transcription powered by enterprise-grade Twilio infrastructure", color: "text-sky-300", bg: "bg-sky-400/10 border-sky-400/20" },
  { icon: FileText, label: "Audit Log", desc: "Complete change history for every lead — who changed what, when, for compliance and accountability", color: "text-amber-300", bg: "bg-amber-400/10 border-amber-400/20" },
  { icon: RefreshCw, label: "Background Jobs", desc: "Long-running tasks (imports, bulk skip trace, AI enrichment) run async — never block your workflow", color: "text-fuchsia-300", bg: "bg-fuchsia-400/10 border-fuchsia-400/20" },
  { icon: GitBranch, label: "Multi-Campaign Routing", desc: "Route different lead sources, phone numbers, and SMS keywords to separate campaigns automatically", color: "text-cyan-300", bg: "bg-cyan-400/10 border-cyan-400/20" },
  { icon: Map, label: "Property Intelligence", desc: "Propelio and Propwire integrations for MLS comps, ownership history, and property data enrichment", color: "text-rose-300", bg: "bg-rose-400/10 border-rose-400/20" },
];

export default function FeaturesShowcase() {
  return (
    <section className="w-full max-w-7xl mx-auto px-4 py-20" id="all-features">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.2, duration: 0.6 }}
        className="text-center mb-12"
      >
        <span className="inline-flex items-center rounded-full bg-fuchsia-500/10 border border-fuchsia-500/20 px-3 py-1 text-xs font-medium text-fuchsia-300 mb-4">
          🚀 Everything Included — No Add-Ons
        </span>
        <h2 className="text-3xl md:text-4xl font-bold text-white">
          One Platform.{" "}
          <span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
            Every Tool You Need.
          </span>
        </h2>
        <p className="text-slate-400 mt-3 text-sm max-w-xl mx-auto leading-relaxed">
          Most CRMs charge extra for dialers, AI, and analytics. TolipAI ships all 24+ features in a single platform built for real estate wholesalers — no duct tape required.
        </p>
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {FEATURES.map((feature, i) => (
          <motion.div
            key={feature.label}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 1.3 + i * 0.03, duration: 0.35 }}
            className={`rounded-xl border ${feature.bg} p-4 hover:scale-[1.02] transition-transform duration-200 cursor-default`}
          >
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-lg ${feature.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                <feature.icon className={`w-4 h-4 ${feature.color}`} />
              </div>
              <div>
                <p className={`text-sm font-semibold ${feature.color}`}>{feature.label}</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{feature.desc}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* CTA below features */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2.0, duration: 0.5 }}
        className="mt-14 text-center"
      >
        <div className="inline-flex flex-col items-center gap-4">
          <p className="text-slate-400 text-sm">Ready to replace 5 different tools with one?</p>
          <a
            href="#"
            onClick={e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-500 via-fuchsia-500 to-rose-500 px-8 py-4 font-bold text-white text-sm shadow-2xl shadow-violet-500/30 hover:shadow-violet-500/50 hover:scale-105 transition-all duration-200"
          >
            Get Access to TolipAI →
          </a>
          <p className="text-xs text-slate-600">Contact us at info@tolipai.com · (555) 201-4892</p>
        </div>
      </motion.div>
    </section>
  );
}

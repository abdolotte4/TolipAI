import { motion } from "framer-motion";
import { Home, Building2, UserCheck, BarChart2, FileText, TrendingUp } from "lucide-react";

const analysisSegments = [
  {
    icon: <BarChart2 className="w-7 h-7 text-amber-400" />,
    title: "Active Market Transitions",
    badge: "Market Analysis",
    description:
      "Properties in active market transition phases. TolipAI's pipeline tools help real estate professionals track and evaluate these opportunities through CRM workflows and property analysis dashboards.",
    bg: "bg-amber-500/10 border-amber-500/20",
    badgeClass: "bg-amber-500/15 text-amber-400 border-amber-400/30",
  },
  {
    icon: <Building2 className="w-7 h-7 text-red-400" />,
    title: "Institutional & REO Properties",
    badge: "REO / Bank Assets",
    description:
      "Properties moving through institutional disposition cycles, including REO inventory. TolipAI CRM helps real estate professionals organize and track these opportunities through the deal pipeline from research to close.",
    bg: "bg-red-500/10 border-red-500/20",
    badgeClass: "bg-red-500/15 text-red-400 border-red-400/30",
  },
  {
    icon: <UserCheck className="w-7 h-7 text-violet-400" />,
    title: "Non-Resident Property Owners",
    badge: "Non-Occupant",
    description:
      "Investment properties owned by non-occupant holders, including portfolio owners and out-of-state investors. A core segment for CRM pipeline management and property opportunity tracking inside TolipAI.",
    bg: "bg-violet-500/10 border-violet-500/20",
    badgeClass: "bg-violet-500/15 text-violet-400 border-violet-400/30",
  },
  {
    icon: <FileText className="w-7 h-7 text-orange-400" />,
    title: "Property Analysis & Market Research",
    badge: "Public Records",
    description:
      "Property analysis tools for evaluating real estate opportunities using public property records. TolipAI supports real estate professionals in organizing and researching property data for evaluation purposes.",
    bg: "bg-orange-500/10 border-orange-500/20",
    badgeClass: "bg-orange-500/15 text-orange-400 border-orange-400/30",
  },
  {
    icon: <Home className="w-7 h-7 text-sky-400" />,
    title: "Unoccupied Property Assets",
    badge: "Vacant Inventory",
    description:
      "Unoccupied properties identified through public data sources. These assets represent untapped inventory tracked inside TolipAI CRM for real estate professionals evaluating acquisition and investment strategies.",
    bg: "bg-sky-500/10 border-sky-500/20",
    badgeClass: "bg-sky-500/15 text-sky-400 border-sky-400/30",
  },
  {
    icon: <TrendingUp className="w-7 h-7 text-emerald-400" />,
    title: "Equity-Rich Property Owners",
    badge: "Low Leverage",
    description:
      "Owners with significant equity positions or clear-title properties. This segment offers flexible transaction structures and is tracked inside TolipAI CRM for real estate professionals exploring creative deal structures.",
    bg: "bg-emerald-500/10 border-emerald-500/20",
    badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-400/30",
  },
];

export function LeadTypes() {
  return (
    <section id="lead-types" className="py-24 bg-secondary/20 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <span className="inline-block py-1 px-3 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold tracking-wider uppercase mb-4">
            Property Analysis Segments
          </span>
          <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">
            Property Analysis Segments
          </h2>
          <div className="w-20 h-1 bg-primary mx-auto mb-6 rounded-full" />
          <p className="text-muted-foreground text-lg">
            TolipAI specializes in property analysis tools and CRM pipeline management for real estate professionals. We organize property research data, automate pipeline workflows, and track every opportunity inside TolipAI CRM.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {analysisSegments.map((cat, i) => (
            <motion.div
              key={cat.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              className={`rounded-2xl border p-6 ${cat.bg} flex flex-col gap-3 hover:scale-[1.02] transition-transform duration-200`}
            >
              <div className="flex items-center justify-between">
                <div className="w-12 h-12 rounded-xl bg-background/40 flex items-center justify-center">
                  {cat.icon}
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${cat.badgeClass}`}>
                  {cat.badge}
                </span>
              </div>
              <h3 className="text-lg font-bold text-foreground font-display mt-1">{cat.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{cat.description}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="mt-12 p-6 rounded-2xl border border-primary/20 bg-primary/5 text-center max-w-3xl mx-auto"
        >
          <p className="text-muted-foreground text-sm md:text-base">
            <span className="text-foreground font-semibold">TolipAI's analytics platform</span> supports property research and organizes all six segments with structured property data — then loads them directly into <span className="text-primary font-semibold">TolipAI CRM</span> for your team to action.{" "}
            <a href="#contact" className="text-primary hover:underline font-medium">Get started →</a>
          </p>
        </motion.div>
      </div>
    </section>
  );
}

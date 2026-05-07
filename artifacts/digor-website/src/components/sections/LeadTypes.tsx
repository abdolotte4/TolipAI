import { motion } from "framer-motion";
import { Home, AlertTriangle, UserX, DollarSign, Building2, TrendingUp } from "lucide-react";

const leadCategories = [
  {
    icon: <AlertTriangle className="w-7 h-7 text-amber-400" />,
    title: "Urgent Market Transitions",
    badge: "High Propensity",
    description:
      "Properties tied to owners navigating time-sensitive market transitions. This segment exhibits above-average propensity for transactional activity, making it one of the most responsive datasets for targeted outreach campaigns by real estate professionals.",
    bg: "bg-amber-500/10 border-amber-500/20",
    badgeClass: "bg-amber-500/15 text-amber-400 border-amber-400/30",
  },
  {
    icon: <Building2 className="w-7 h-7 text-red-400" />,
    title: "Institutional & REO Data",
    badge: "REO / Bank Assets",
    description:
      "Properties moving through institutional disposition cycles — including REO inventory and lender-driven sale pipelines. This dataset surfaces below-market acquisition opportunities priced through institutional processes, ideal for real estate professionals sourcing off-market inventory.",
    bg: "bg-red-500/10 border-red-500/20",
    badgeClass: "bg-red-500/15 text-red-400 border-red-400/30",
  },
  {
    icon: <UserX className="w-7 h-7 text-violet-400" />,
    title: "Non-Resident Property Owners",
    badge: "Non-Occupant",
    description:
      "Owners of investment properties residing outside the subject property — including portfolio holders, out-of-state investors, and landlords. A core high-propensity data segment for contact enrichment campaigns targeting non-occupant owners.",
    bg: "bg-violet-500/10 border-violet-500/20",
    badgeClass: "bg-violet-500/15 text-violet-400 border-violet-400/30",
  },
  {
    icon: <DollarSign className="w-7 h-7 text-orange-400" />,
    title: "Tax-Advantaged Opportunities",
    badge: "Fiscal Pressure Segment",
    description:
      "Property records tied to outstanding public tax obligations, sourced directly from county tax authority data. This segment identifies assets with elevated transactional propensity — a reliable data source for real estate professionals building acquisition pipelines.",
    bg: "bg-orange-500/10 border-orange-500/20",
    badgeClass: "bg-orange-500/15 text-orange-400 border-orange-400/30",
  },
  {
    icon: <Home className="w-7 h-7 text-sky-400" />,
    title: "Unutilized Property Assets",
    badge: "Unoccupied Inventory",
    description:
      "A curated dataset of unoccupied properties identified through utility and occupancy data signals. These assets represent untapped inventory with high enrichment potential — prime candidates for wholesale, fix-and-flip, and rental acquisition strategies.",
    bg: "bg-sky-500/10 border-sky-500/20",
    badgeClass: "bg-sky-500/15 text-sky-400 border-sky-400/30",
  },
  {
    icon: <TrendingUp className="w-7 h-7 text-emerald-400" />,
    title: "Equity-Rich Property Owners",
    badge: "Low Leverage",
    description:
      "Owners with significant equity positions or free-and-clear properties. This data segment identifies low-leverage owners with maximum transactional flexibility — ideal for real estate professionals exploring creative acquisition structures.",
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
            Property Data Segments
          </span>
          <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">
            High-Propensity Data Segments
          </h2>
          <div className="w-20 h-1 bg-primary mx-auto mb-6 rounded-full" />
          <p className="text-muted-foreground text-lg">
            Digor specializes in strategic data enrichment and operational support for high-growth real estate firms. We build curated property datasets, provide bulk contact enrichment, and manage workflow automation — all tracked inside TolipAI CRM.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {leadCategories.map((cat, i) => (
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
            <span className="text-foreground font-semibold">TolipAI's data platform</span> identifies and enriches all six segments with owner contact data through bulk data enrichment — then loads them directly into <span className="text-primary font-semibold">TolipAI CRM</span> for your team to action.{" "}
            <a href="#contact" className="text-primary hover:underline font-medium">Get started →</a>
          </p>
        </motion.div>
      </div>
    </section>
  );
}

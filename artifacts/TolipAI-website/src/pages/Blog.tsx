import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Clock } from "lucide-react";

const posts = [
  {
    slug: "organize-lead-pipeline",
    title: "How Real Estate Teams Can Organize Their Lead Pipeline",
    date: "June 20, 2026",
    readTime: "5 min read",
    excerpt: "A disorganized lead pipeline is one of the biggest obstacles to closing deals consistently. Here's how real estate teams can structure their CRM pipeline for maximum clarity and deal velocity.",
    content: `A disorganized pipeline is a silent deal killer. When leads pile up in spreadsheets, email threads, or disconnected tools, follow-ups get missed and deals fall through. The good news: setting up a structured CRM pipeline isn't complicated — it just requires consistency.

**Define your stages clearly.** Every pipeline should reflect the actual steps in your deal process. Common stages: New Lead → Contacted → Appointment Set → Qualified → Offer Made → Under Contract → Closed. Customize these to match how your team operates.

**Assign ownership on every lead.** A lead without an assigned team member is a lead that falls through the cracks. Every new lead should be assigned immediately on creation.

**Use tasks, not memory.** Every time a lead changes stage, create a follow-up task. "Call back Thursday at 2pm" is infinitely more reliable than a mental note.

**Review pipeline metrics weekly.** Track leads by stage, days in stage, and conversion rates. If leads are stalling at a particular stage, that's a process problem worth diagnosing.

TolipAI CRM is built around these principles — giving your team a structured, visual pipeline with automated task triggers and real-time reporting.`,
  },
  {
    slug: "arv-calculators",
    title: "Using ARV Calculators to Evaluate Real Estate Opportunities",
    date: "June 14, 2026",
    readTime: "6 min read",
    excerpt: "After Repair Value (ARV) is one of the most important numbers in any real estate deal. Here's how ARV calculators work and why accurate comps matter.",
    content: `After Repair Value — ARV — is the estimated market value of a property after it's been fully renovated. It's the foundation of every real estate investment calculation.

**Why ARV matters.** Your ARV determines your Maximum Allowable Offer (MAO). The standard formula: MAO = ARV × 70% − Estimated Repair Costs. Get the ARV wrong and you'll overbid or underbid — either losing money or losing deals.

**How ARV calculators work.** A good ARV calculator pulls comparable sold properties (comps) near the subject property, then adjusts for differences in square footage, bedrooms, bathrooms, condition, and location. The adjusted price per square foot is averaged across comps and multiplied by your property's square footage.

**What makes comps reliable.** Comps should be: sold within the last 6–12 months, within 0.25–1 mile of the subject property, similar in size (±20%), and similar property type (SFR to SFR, not condo to SFR).

**Manual vs. automated.** Manual comps analysis is time-consuming and prone to error. TolipAI's ARV calculator automates the comp pull, allows you to filter and exclude outliers, and computes ARV and MAO in seconds.

Using an ARV calculator consistently across every deal ensures your offer decisions are data-driven, not guesswork.`,
  },
  {
    slug: "comps-analysis-basics",
    title: "Comps Analysis Basics for Real Estate Professionals",
    date: "June 7, 2026",
    readTime: "5 min read",
    excerpt: "Comps analysis is the process of comparing recently sold properties to estimate a subject property's value. Here's what every real estate professional should know.",
    content: `Comparable sales analysis — "comps" — is how you determine what a property is worth in today's market. It's the same methodology used by appraisers, but you need to do it faster and at scale.

**What makes a good comp?**
- Sold within the last 6–12 months (more recent = more reliable)
- Similar square footage (within 15–20%)
- Same property type (SFR, condo, townhouse)
- Within reasonable proximity (0.25–1 mile in urban areas, 1–3 miles in rural)
- Similar condition (comparable to your target property after repairs)

**How to adjust for differences.** No two properties are identical. Common adjustments:
- Garage: +/− $10,000–$20,000
- Bedroom: +/− $5,000–$10,000
- Bathroom: +/− $8,000–$15,000
- Square footage: +/− price-per-sqft × difference

**Data sources.** Public record data, MLS sold listings (if licensed), and property data services are standard sources for comps. TolipAI pulls comps from public property records and integrates them directly into the ARV calculator.

**Comps in your workflow.** For every deal in your pipeline, run comps analysis before making an offer. Save the comps report to the lead card so your team can reference it throughout the deal.`,
  },
  {
    slug: "improving-crm-workflows",
    title: "Improving CRM Workflows Without Adding More Manual Work",
    date: "May 30, 2026",
    readTime: "4 min read",
    excerpt: "Most CRM problems aren't tool problems — they're workflow problems. Here's how to design CRM workflows that reduce manual work instead of adding it.",
    content: `The most common CRM complaint from real estate teams: "We're spending more time updating the CRM than actually working deals." This happens when CRM workflows are designed wrong.

**The root cause.** Most teams design their CRM around data collection rather than decision support. The result: lots of fields to fill in, but no clarity on what to do next.

**Workflow automation that actually helps.**
- Stage-change triggers: when a lead moves to "Contacted," automatically create a follow-up call task for 3 days later.
- Stale lead alerts: if a lead hasn't been updated in 7 days, notify the assigned team member.
- Appointment reminders: 24 hours before a scheduled appointment, send an automated reminder.

**Minimize required fields.** Only make fields required if they're needed for a downstream decision. Every required field that doesn't drive action is friction that slows your team down.

**Templates for common scenarios.** Create note templates for common lead interactions: "Left voicemail," "Appointment confirmed," "Offer sent." Templates reduce cognitive load and keep records consistent.

**Review and refine monthly.** Audit your pipeline monthly. Are leads moving through stages at a healthy pace? Are tasks being completed or ignored? The answers tell you where your workflow needs adjustment.

TolipAI CRM's automation configuration tools are designed to handle these workflow setups without requiring your team to manually trigger every action.`,
  },
  {
    slug: "data-organization-operations",
    title: "How Better Data Organization Supports Real Estate Operations",
    date: "May 22, 2026",
    readTime: "5 min read",
    excerpt: "The quality of your real estate operations is directly tied to the quality of your data organization. Here's how to build a data foundation that supports your team.",
    content: `Real estate operations run on data — property records, contact information, deal history, comps, and financial projections. When that data is disorganized, everything downstream suffers.

**The cost of bad data.** Duplicate leads waste team effort. Missing fields mean incomplete underwriting. Stale records lead to bad decisions. The ROI of clean, organized data is often invisible — until you don't have it.

**Establish data entry standards.** Define what fields are required at each pipeline stage. New Lead: address, source, assigned team member. Qualified: ARV, estimated repairs, MAO. Under Contract: purchase price, closing date, assigned attorney.

**Centralize everything in CRM.** Calls, emails, notes, documents, comps reports — all of it should live in the CRM lead card. If it's in an email thread, a text message, or a sticky note, it doesn't exist for the rest of your team.

**Property research workflow.** For each deal, standardize the property research checklist: pull public records, run comps, calculate ARV/MAO, verify ownership, document property condition. TolipAI CRM supports each of these steps with integrated tools.

**Audit regularly.** Monthly: review pipeline for leads missing required fields, leads stalled in a stage, and tasks past due. Quarterly: archive closed deals, clean up duplicates, and review your stage-conversion metrics.

Good data organization isn't glamorous, but it's the operational foundation that separates high-volume real estate teams from those constantly putting out fires.`,
  },
];

export default function Blog() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const [activePost, setActivePost] = useState<string | null>(null);

  const currentPost = posts.find(p => p.slug === activePost);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        {currentPost ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <button
              onClick={() => setActivePost(null)}
              className="flex items-center gap-2 text-primary hover:underline text-sm mb-8"
            >
              ← Back to Blog
            </button>
            <div className="mb-6">
              <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                <span>{currentPost.date}</span>
                <span>·</span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{currentPost.readTime}</span>
              </div>
              <h1 className="text-3xl md:text-4xl font-bold text-foreground mb-4 font-display">{currentPost.title}</h1>
              <div className="h-px bg-gradient-to-r from-primary/50 to-transparent mb-8" />
            </div>
            <div className="prose max-w-none text-foreground/80 space-y-4 leading-relaxed">
              {currentPost.content.split("\n\n").map((para, i) => {
                if (para.startsWith("**") && para.endsWith("**")) {
                  return <h3 key={i} className="text-lg font-semibold text-foreground mt-6">{para.replace(/\*\*/g, "")}</h3>;
                }
                if (para.startsWith("- ")) {
                  return (
                    <ul key={i} className="list-disc pl-6 space-y-1">
                      {para.split("\n").map((line, j) => (
                        <li key={j} className="text-foreground/80">{line.replace(/^- /, "").replace(/\*\*(.*?)\*\*/g, "$1")}</li>
                      ))}
                    </ul>
                  );
                }
                return (
                  <p key={i} className="text-foreground/80" dangerouslySetInnerHTML={{
                    __html: para.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                  }} />
                );
              })}
            </div>
          </motion.div>
        ) : (
          <>
            <div className="mb-12">
              <span className="inline-block py-1 px-3 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold tracking-wider uppercase mb-4">
                Blog
              </span>
              <h1 className="text-4xl font-bold text-foreground mb-3 font-display">TolipAI Blog</h1>
              <p className="text-muted-foreground text-lg">
                Insights on CRM workflows, property analysis, and real estate operations from the TolipAI team.
              </p>
              <div className="mt-6 h-px bg-gradient-to-r from-primary/50 to-transparent" />
            </div>

            <div className="space-y-6">
              {posts.map((post, index) => (
                <motion.div
                  key={post.slug}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.08 }}
                  className="group border border-border rounded-2xl bg-card p-6 hover:border-primary/50 hover:bg-card/80 transition-all cursor-pointer"
                  onClick={() => setActivePost(post.slug)}
                >
                  <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                    <span>{post.date}</span>
                    <span>·</span>
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{post.readTime}</span>
                  </div>
                  <h2 className="text-xl font-bold text-foreground mb-2 font-display group-hover:text-primary transition-colors">
                    {post.title}
                  </h2>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-4">{post.excerpt}</p>
                  <div className="flex items-center gap-1 text-primary text-sm font-semibold">
                    Read Article <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </motion.div>
              ))}
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}

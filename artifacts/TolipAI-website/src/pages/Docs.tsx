import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BookOpen, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

const docCategories = [
  {
    category: "Getting Started",
    articles: [
      {
        title: "Getting Started with TolipAI",
        summary: "An overview of TolipAI's CRM platform, how to access your account, and how to navigate the dashboard for the first time.",
        content: `Welcome to TolipAI. After your account is provisioned, you'll receive login credentials via email. Log in at tolipai.com/crm to access your CRM dashboard.\n\nYour dashboard shows your lead pipeline, recent activity, upcoming tasks, and key metrics. Use the left navigation to access CRM sections: Leads, Pipeline, Analytics, ARV Calculator, and Comps Analysis.\n\nFor onboarding help, contact info@tolipai.com with subject "Onboarding Request".`,
      },
      {
        title: "Setting Up Your CRM Pipeline",
        summary: "Learn how to configure your lead pipeline stages, assign team members, and set up your first workflow inside TolipAI CRM.",
        content: `TolipAI CRM uses a Kanban-style pipeline to track leads through stages. Default stages include: New Lead, Contacted, Qualified, Offer Made, Under Contract, and Closed.\n\nTo customize stages: go to Settings → Pipeline Stages → Add or rename stages to match your workflow.\n\nAssign team members to leads by opening a lead card and selecting an assignee from the dropdown. Leads can be filtered by assignee, stage, or date added.`,
      },
    ],
  },
  {
    category: "Property Analysis Tools",
    articles: [
      {
        title: "Using the ARV Calculator",
        summary: "Step-by-step guide to using TolipAI's ARV calculator to evaluate After Repair Value for any property in your pipeline.",
        content: `The ARV Calculator is accessible from the Tools menu or from within any lead card.\n\nTo calculate ARV:\n1. Enter the property address.\n2. The system automatically pulls comparable sold properties (comps) within a configurable radius.\n3. Review and adjust comps — you can remove outliers or add manual comps.\n4. The ARV is calculated as the average adjusted price per square foot × your property's square footage.\n5. The MAO (Maximum Allowable Offer) is automatically computed: MAO = ARV × 70% − Estimated Repair Costs.\n\nSave the calculation to the lead card for your team's reference.`,
      },
      {
        title: "Running Comps Analysis",
        summary: "How to pull comparable sales, filter by property characteristics, and generate comps reports inside TolipAI.",
        content: `Comps Analysis pulls recent sold properties from public record data sources. Access it from Tools → Comps Analysis or from within a lead card.\n\nFilters available:\n- Distance radius (0.25 mi to 2 mi)\n- Square footage range (±20% default)\n- Bedrooms/bathrooms match\n- Sold within last 6 or 12 months\n- Property type (SFR, Condo, etc.)\n\nOnce comps are loaded, you can view price per sq ft, days on market, and adjusted sale price. Export a PDF comps report for use in your offer package.`,
      },
    ],
  },
  {
    category: "Pipeline & Lead Management",
    articles: [
      {
        title: "Managing Lead Stages",
        summary: "How to move leads through your pipeline, add notes, and track deal progress inside TolipAI CRM.",
        content: `Move a lead to a new stage by dragging the card on the Kanban board, or by opening the lead and changing the Stage field.\n\nEach stage change is logged in the lead's activity timeline with the user who made the change and timestamp.\n\nBest practices:\n- Add a note when moving a lead to explain the reason.\n- Set a follow-up task immediately after moving a lead to Contacted or Offer Made.\n- Use lead tags to add custom categorization (e.g., "Vacant", "Probate", "Inherited").`,
      },
      {
        title: "Creating Follow-Up Tasks",
        summary: "How to create, assign, and track follow-up tasks for leads in your pipeline.",
        content: `Tasks can be created from within any lead card. Click Add Task, set a due date, assign to a team member, and add a description.\n\nTask types available: Call, Email, In-Person Visit, Administrative, Research.\n\nOverdue tasks appear in red on the dashboard task list. You'll receive an in-app notification when a task assigned to you is due.\n\nFor automated task sequences, go to Settings → Workflow Automation to configure task triggers based on stage changes or time elapsed.`,
      },
      {
        title: "Importing Client-Provided Property Records",
        summary: "How to import property records and contact lists into TolipAI CRM using CSV uploads.",
        content: `TolipAI CRM supports CSV import for bulk lead creation. Go to Leads → Import → Download CSV Template.\n\nRequired fields: Property Address, City, State, Zip.\nOptional fields: Owner Name, Lead Source, Assigned To, Stage, Tags, Notes.\n\nImportant: You are responsible for ensuring that all imported contacts and records are lawfully sourced and used for permitted business purposes, in compliance with applicable privacy laws.\n\nAfter upload, review the import preview and confirm. Imported leads appear in your pipeline under the stage you designate.`,
      },
    ],
  },
  {
    category: "Reports & Account",
    articles: [
      {
        title: "Understanding Reports and Dashboards",
        summary: "Overview of TolipAI's reporting dashboard — how to read pipeline metrics, deal velocity, and team performance.",
        content: `The Analytics dashboard is accessible from the left nav → Analytics.\n\nKey metrics displayed:\n- Total leads by stage\n- Lead-to-offer conversion rate\n- Average days to close\n- Deals closed (MTD, QTD, YTD)\n- Team member activity summary\n\nAll metrics are filterable by date range and assignee. Export reports as CSV or PDF from the top-right Export button.`,
      },
      {
        title: "Account and Billing Support",
        summary: "How to manage your TolipAI subscription, update billing information, and contact support.",
        content: `Billing is managed through your Stripe billing portal. Access it via Account → Billing → Manage Subscription.\n\nTo update your payment method: log into the Stripe portal and update your card on file.\n\nTo cancel: cancel directly in the Stripe portal or email info@tolipai.com with subject "Subscription Cancellation Request — [Your Email]".\n\nFor billing questions: email info@tolipai.com within 3 calendar days of the charge date.\n\nFor technical support: email info@tolipai.com with a description of your issue and your account email.`,
      },
    ],
  },
];

export default function Docs() {
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const [search, setSearch] = useState("");
  const [openArticle, setOpenArticle] = useState<string | null>(null);

  const filtered = search.trim()
    ? docCategories.map(cat => ({
        ...cat,
        articles: cat.articles.filter(a =>
          a.title.toLowerCase().includes(search.toLowerCase()) ||
          a.summary.toLowerCase().includes(search.toLowerCase())
        ),
      })).filter(cat => cat.articles.length > 0)
    : docCategories;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="mb-12">
          <span className="inline-block py-1 px-3 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold tracking-wider uppercase mb-4">
            Help Docs
          </span>
          <h1 className="text-4xl font-bold text-foreground mb-3 font-display">TolipAI Help Center</h1>
          <p className="text-muted-foreground text-lg mb-6">
            Guides and documentation for getting the most out of TolipAI's CRM platform, workflow tools, and property analysis features.
          </p>
          <div className="relative max-w-lg">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search help articles..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10 bg-card border-border focus:border-primary"
            />
          </div>
          <div className="mt-6 h-px bg-gradient-to-r from-primary/50 to-transparent" />
        </div>

        <div className="space-y-12">
          {filtered.map((cat, ci) => (
            <motion.div
              key={cat.category}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: ci * 0.1 }}
            >
              <h2 className="text-xl font-bold text-foreground mb-4 font-display flex items-center gap-2">
                <BookOpen className="w-5 h-5 text-primary" />
                {cat.category}
              </h2>
              <div className="space-y-3">
                {cat.articles.map((article) => (
                  <div
                    key={article.title}
                    className="border border-border rounded-xl overflow-hidden bg-card"
                  >
                    <button
                      className="w-full text-left p-5 flex items-center justify-between gap-4 hover:bg-secondary/30 transition-colors"
                      onClick={() => setOpenArticle(openArticle === article.title ? null : article.title)}
                    >
                      <div>
                        <h3 className="font-semibold text-foreground mb-1">{article.title}</h3>
                        <p className="text-sm text-muted-foreground">{article.summary}</p>
                      </div>
                      <ChevronRight
                        className={`w-5 h-5 text-primary shrink-0 transition-transform ${openArticle === article.title ? "rotate-90" : ""}`}
                      />
                    </button>
                    {openArticle === article.title && (
                      <div className="px-5 pb-5 border-t border-border/50">
                        <div className="pt-4 text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                          {article.content}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <p>No articles found for "<span className="text-foreground">{search}</span>".</p>
            <p className="mt-2 text-sm">Try a different search term or <a href="mailto:info@tolipai.com" className="text-primary hover:underline">contact support</a>.</p>
          </div>
        )}

        <div className="mt-16 p-8 rounded-2xl border border-primary/20 bg-primary/5 text-center">
          <h3 className="text-lg font-bold text-foreground mb-2 font-display">Still need help?</h3>
          <p className="text-muted-foreground mb-4 text-sm">Our team is available via email for support and onboarding questions.</p>
          <a
            href="mailto:info@tolipai.com"
            className="inline-flex items-center gap-2 text-primary font-semibold hover:underline"
          >
            info@tolipai.com
          </a>
        </div>
      </main>
      <Footer />
    </div>
  );
}

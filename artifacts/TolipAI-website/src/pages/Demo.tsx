import { useEffect } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { Play, Database, Phone, BarChart3, Zap, Brain, Shield, ArrowRight, CheckCircle } from "lucide-react";

const FEATURES = [
  {
    icon: Database,
    title: "Data Engineering & List Building",
    desc: "See how we pull, clean, and enrich distressed property data — foreclosures, tax delinquencies, vacant properties — delivering verified owner contacts with 98%+ accuracy.",
  },
  {
    icon: Brain,
    title: "AI Lead Scoring",
    desc: "Watch the AI score every lead in real-time based on deal potential, property condition, equity position, and owner motivation signals.",
  },
  {
    icon: Phone,
    title: "Managed Outreach Operations",
    desc: "Live walkthrough of our multi-channel outreach infrastructure — cold calling, SMS sequences, and voicemail drops — all compliance-driven and managed end-to-end.",
  },
  {
    icon: BarChart3,
    title: "Technical CRM Infrastructure",
    desc: "Explore the full CRM pipeline: lead intake, campaign management, conversation tracking, dialer integration, and real-time analytics dashboard.",
  },
  {
    icon: Zap,
    title: "Automation & Follow-Up Sequences",
    desc: "See our automated follow-up engine — AI-driven SMS and email sequences that nurture leads around the clock without manual intervention.",
  },
  {
    icon: Shield,
    title: "Compliance & QA Framework",
    desc: "Human-in-the-loop quality assurance protocols ensuring every record, every outreach, and every workflow meets regulatory and operational standards.",
  },
];

const STATS = [
  { value: "340%+", label: "Pipeline Growth" },
  { value: "98.2%", label: "Data Accuracy" },
  { value: "3×", label: "Operational Throughput" },
  { value: "950%", label: "Average Client ROI" },
];

export default function Demo() {
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = "Live Demo | TolipAI — Managed Marketing & Data Infrastructure";
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main>
        {/* Hero */}
        <section className="relative pt-32 pb-16 overflow-hidden">
          <div className="absolute inset-0 z-0">
            <div className="absolute inset-0 bg-background dark:bg-[#050810]" />
            <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(212,175,55,0.15) 0%, transparent 70%)" }} />
          </div>
          <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
            >
              <span className="inline-block py-1 px-3 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold tracking-wider uppercase mb-6">
                Platform Demo
              </span>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-foreground leading-tight mb-6 font-display">
                See TolipAI in Action
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
                A full walkthrough of our Managed Marketing and Data Infrastructure platform — from distressed property data pipelines to fully managed outreach operations.
              </p>
            </motion.div>
          </div>
        </section>

        {/* Video Embed */}
        <section className="py-8 pb-20">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="relative rounded-2xl overflow-hidden border border-border shadow-2xl shadow-black/40 bg-card aspect-video"
            >
              <iframe
                src="https://www.loom.com/embed/placeholder?autoplay=0"
                frameBorder="0"
                allowFullScreen
                className="absolute inset-0 w-full h-full hidden"
                title="TolipAI Platform Demo"
              />
              {/* Placeholder shown until video URL is configured */}
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b1120]">
                <div className="w-24 h-24 rounded-full bg-primary/20 border-2 border-primary/40 flex items-center justify-center mb-6 cursor-pointer hover:bg-primary/30 transition-colors group">
                  <Play className="w-10 h-10 text-primary ml-1 group-hover:scale-110 transition-transform" />
                </div>
                <p className="text-foreground text-2xl font-bold font-display mb-2">Demo Video Coming Soon</p>
                <p className="text-muted-foreground text-center max-w-md px-4">
                  Schedule a live walkthrough with our team — we'll show you exactly how TolipAI works for your acquisition operation.
                </p>
                <Button
                  asChild
                  className="mt-8 h-12 px-8 rounded-full bg-primary text-primary-foreground font-semibold shadow-[0_0_20px_rgba(212,175,55,0.3)] hover:shadow-[0_0_30px_rgba(212,175,55,0.5)] transition-all"
                >
                  <a href="/#contact">
                    Schedule a Live Demo <ArrowRight className="ml-2 w-4 h-4" />
                  </a>
                </Button>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Stats */}
        <section className="py-16 bg-card/40 border-y border-border">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {STATS.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1, duration: 0.5 }}
                  className="text-center"
                >
                  <p className="text-3xl md:text-4xl font-bold text-primary font-display mb-1">{stat.value}</p>
                  <p className="text-muted-foreground text-sm">{stat.label}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Feature Overview */}
        <section className="py-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-14"
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">What's Covered in the Demo</h2>
              <div className="w-20 h-1 bg-primary mx-auto rounded-full mb-6" />
              <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
                A complete walkthrough of every layer of the TolipAI infrastructure stack.
              </p>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {FEATURES.map(({ icon: Icon, title, desc }, i) => (
                <motion.div
                  key={title}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-50px" }}
                  transition={{ delay: i * 0.08, duration: 0.5 }}
                  className="bg-card border border-border rounded-2xl p-6 hover:border-primary/40 transition-colors shadow-lg shadow-black/10"
                >
                  <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-bold text-foreground text-lg mb-2 font-display">{title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* What to expect */}
        <section className="py-16 bg-card/40 border-y border-border">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-center mb-10"
            >
              <h2 className="text-2xl md:text-3xl font-bold mb-4 font-display">What to Expect From a Live Demo</h2>
            </motion.div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                "30-minute walkthrough of the full platform",
                "Live data pull from real property databases",
                "CRM pipeline and dialer demonstration",
                "Custom proposal based on your operation",
                "Q&A with a senior infrastructure specialist",
                "No commitment required",
              ].map((item, i) => (
                <motion.div
                  key={item}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="flex items-center gap-3"
                >
                  <CheckCircle className="w-5 h-5 text-primary flex-shrink-0" />
                  <span className="text-muted-foreground">{item}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">Ready to Scale Your Operations?</h2>
              <p className="text-muted-foreground text-lg mb-10 max-w-xl mx-auto">
                Schedule a live demo with our team. We'll show you exactly what TolipAI can do for your real estate acquisition operation — no pressure, no fluff.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Button
                  asChild
                  size="lg"
                  className="h-14 px-10 rounded-full bg-primary text-primary-foreground font-semibold shadow-[0_0_20px_rgba(212,175,55,0.3)] hover:shadow-[0_0_30px_rgba(212,175,55,0.5)] transition-all"
                >
                  <a href="/#contact">
                    Schedule a Live Demo <ArrowRight className="ml-2 w-4 h-4" />
                  </a>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="h-14 px-10 rounded-full font-semibold border-border hover:bg-secondary transition-all"
                >
                  <a href="/">
                    Back to Home
                  </a>
                </Button>
              </div>
            </motion.div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

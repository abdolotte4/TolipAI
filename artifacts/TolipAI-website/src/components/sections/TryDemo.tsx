import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { BarChart3, Brain, Zap, CheckCircle, ArrowRight } from "lucide-react";

const FEATURES = [
  { icon: Brain, label: "AI Lead Scoring", desc: "Every lead scored in real-time by deal potential and pipeline stage" },
  { icon: BarChart3, label: "Live Analytics", desc: "Pipeline health, deal velocity, and reporting at a glance" },
  { icon: Zap, label: "Automated Follow-Up Workflows", desc: "Task triggers and follow-up automation that keep deals moving" },
  { icon: CheckCircle, label: "ARV & Comps Analysis", desc: "Built-in ARV calculator and comps tools for every deal" },
];

export function TryDemo() {
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
            Platform Demo
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-4">
            See TolipAI in Action
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Request a guided product demo to see how TolipAI supports CRM workflows, lead pipeline management, and real estate analysis tools.
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

          {/* Demo CTA */}
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <div className="bg-card border border-border rounded-2xl p-8 shadow-xl text-center">
              <div className="w-20 h-20 rounded-full bg-primary/10 border-2 border-primary/30 flex items-center justify-center mx-auto mb-6">
                <ArrowRight className="w-10 h-10 text-primary" />
              </div>
              <h3 className="text-2xl font-bold text-foreground mb-3 font-display">Request a Guided Demo</h3>
              <p className="text-muted-foreground mb-8 leading-relaxed">
                Schedule a live walkthrough with our team. We'll show you TolipAI's CRM workflows, lead pipeline management, ARV calculator, and comps analysis tools in action.
              </p>
              <Button
                asChild
                className="w-full h-12 bg-primary text-primary-foreground font-semibold rounded-xl shadow-[0_0_20px_rgba(212,175,55,0.3)] hover:shadow-[0_0_30px_rgba(212,175,55,0.5)] transition-all"
              >
                <a href="/#contact">
                  Request a Demo <ArrowRight className="ml-2 w-5 h-5" />
                </a>
              </Button>
              <p className="text-xs text-muted-foreground mt-4">
                No commitment required. 30-minute walkthrough with a platform specialist.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

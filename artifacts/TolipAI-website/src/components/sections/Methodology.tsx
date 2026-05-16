import { motion } from "framer-motion";
import { ShieldCheck, FileCheck } from "lucide-react";

export function Methodology() {
  return (
    <section id="methodology" className="py-24 bg-card border-y border-border relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">Our Operating Methodology</h2>
          <div className="w-20 h-1 bg-primary mx-auto rounded-full" />
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-24 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="space-y-6"
          >
            <div className="flex items-start space-x-4">
              <div className="mt-1 bg-primary/20 p-3 rounded-xl border border-primary/30">
                <ShieldCheck className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-foreground mb-3 font-display">Human-in-the-Loop Quality Assurance</h3>
                <p className="text-muted-foreground text-lg leading-relaxed">
                  Every data record and prospect interaction passes through our proprietary quality assurance protocol. Human oversight at every stage of the pipeline ensures precision, compliance, and measurable results.
                </p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="space-y-6"
          >
            <div className="flex items-start space-x-4">
              <div className="mt-1 bg-primary/20 p-3 rounded-xl border border-primary/30">
                <FileCheck className="w-8 h-8 text-primary" />
              </div>
              <div>
                <h3 className="text-2xl font-bold text-foreground mb-3 font-display">Operational Compliance Framework</h3>
                <p className="text-muted-foreground text-lg leading-relaxed">
                  Our operations are built on a foundation of rigorous regulatory adherence. From data sourcing to outreach execution, every workflow is designed to meet and exceed industry compliance standards, protecting your business at every touchpoint.
                </p>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";

function useCountUp(end: number, duration: number = 2, prefix: string = "", suffix: string = "") {
  const [count, setCount] = useState(0);
  const [hasTriggered, setHasTriggered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasTriggered) {
          setHasTriggered(true);
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [hasTriggered]);

  useEffect(() => {
    if (!hasTriggered) return;

    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / (duration * 1000), 1);
      setCount(Math.floor(progress * end));
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  }, [end, duration, hasTriggered]);

  return { value: `${prefix}${count.toLocaleString()}${suffix}`, ref };
}

export function PerformanceDashboard() {
  const propAnalyzed = useCountUp(1250, 2);
  const pipelineLeads = useCountUp(900, 2);
  const transactionsClosed = useCountUp(45, 2);
  const revenueGenerated = useCountUp(493, 2, "$", "K");

  return (
    <section className="py-24 bg-[#0f1728] border-t border-b border-border relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-50" />
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display text-white">Client Performance Analytics</h2>
          <div className="w-20 h-1 bg-primary mx-auto rounded-full mb-6" />
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Real results from real estate professionals partnering with Tolip Group LLC's managed CRM infrastructure
          </p>
        </motion.div>

        <div className="bg-[#1e293b] rounded-2xl border border-border/50 p-6 md:p-10 shadow-2xl shadow-black/50">
          {/* TOP ROW */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="bg-[#0f1728] p-6 rounded-xl border border-border/50"
            >
              <h4 className="text-muted-foreground text-sm font-medium mb-2">Properties Analyzed</h4>
              <div ref={propAnalyzed.ref} className="text-4xl font-bold text-white mb-1 font-display">
                {propAnalyzed.value}
              </div>
              <p className="text-xs text-[#3b82f6]">Per Quarter</p>
            </motion.div>
            
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="bg-[#0f1728] p-6 rounded-xl border border-border/50"
            >
              <h4 className="text-muted-foreground text-sm font-medium mb-2">Pipeline Leads Managed</h4>
              <div ref={pipelineLeads.ref} className="text-4xl font-bold text-white mb-1 font-display">
                {pipelineLeads.value} <span className="text-lg text-muted-foreground font-normal">(72%)</span>
              </div>
              <p className="text-xs text-[#10b981]">Pipeline Engagement Rate</p>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 }}
              className="bg-[#0f1728] p-6 rounded-xl border border-border/50"
            >
              <h4 className="text-muted-foreground text-sm font-medium mb-2">Transactions Closed</h4>
              <div ref={transactionsClosed.ref} className="text-4xl font-bold text-white mb-1 font-display">
                {transactionsClosed.value}
              </div>
              <p className="text-xs text-[#f59e0b]">Verified Closings</p>
            </motion.div>

            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.4 }}
              className="bg-[#0f1728] p-6 rounded-xl border border-border/50 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-bl-full" />
              <h4 className="text-muted-foreground text-sm font-medium mb-2 relative z-10">Revenue Generated</h4>
              <div ref={revenueGenerated.ref} className="text-4xl font-bold text-primary mb-1 font-display relative z-10">
                {revenueGenerated.value}
              </div>
              <p className="text-xs text-primary/80 relative z-10">Client ROI: 950%</p>
            </motion.div>
          </div>

          {/* MIDDLE ROW */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
            {/* Funnel */}
            <div className="bg-[#0f1728] p-6 rounded-xl border border-border/50">
              <h3 className="text-lg font-semibold text-white mb-6">Deal Pipeline Funnel</h3>
              <div className="space-y-3 flex flex-col items-center">
                <motion.div 
                  initial={{ width: 0 }} whileInView={{ width: "100%" }} viewport={{ once: true }} transition={{ duration: 0.8 }}
                  className="bg-[#1e3a8a] text-white py-2 px-4 rounded text-center text-sm font-medium"
                >
                  Properties Analyzed: 1,250
                </motion.div>
                <motion.div 
                  initial={{ width: 0 }} whileInView={{ width: "80%" }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.1 }}
                  className="bg-[#0f766e] text-white py-2 px-4 rounded text-center text-sm font-medium"
                >
                  Pipeline Leads: 900
                </motion.div>
                <motion.div 
                  initial={{ width: 0 }} whileInView={{ width: "50%" }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.2 }}
                  className="bg-[#047857] text-white py-2 px-4 rounded text-center text-sm font-medium"
                >
                  Qualified: 400
                </motion.div>
                <motion.div 
                  initial={{ width: 0 }} whileInView={{ width: "30%" }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.3 }}
                  className="bg-[#b45309] text-white py-2 px-4 rounded text-center text-sm font-medium"
                >
                  Offers Made: 100
                </motion.div>
                <motion.div 
                  initial={{ width: 0 }} whileInView={{ width: "15%" }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.4 }}
                  className="bg-[#b91c1c] text-white py-2 px-4 rounded text-center text-sm font-medium"
                >
                  Deals Closed: 45
                </motion.div>
              </div>
            </div>

            {/* Performance Trend */}
            <div className="bg-[#0f1728] p-6 rounded-xl border border-border/50 flex flex-col justify-between">
              <div className="flex justify-between items-start mb-6">
                <h3 className="text-lg font-semibold text-white">Performance Trend</h3>
                <div className="flex items-center text-[#10b981] bg-[#10b981]/10 px-3 py-1 rounded-full text-sm font-medium">
                  <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                  </svg>
                  +18% Transactions Last Quarter
                </div>
              </div>
              
              <div className="h-48 flex items-end justify-between gap-2 mt-auto relative">
                <svg className="absolute inset-0 h-full w-full pointer-events-none" preserveAspectRatio="none">
                  <motion.path 
                    initial={{ pathLength: 0 }}
                    whileInView={{ pathLength: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.5, ease: "easeInOut" }}
                    d="M 10 120 L 70 100 L 130 90 L 190 70 L 250 80 L 310 40" 
                    fill="none" 
                    stroke="#10b981" 
                    strokeWidth="3"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                
                {[30, 45, 55, 75, 65, 95].map((height, i) => (
                  <div key={i} className="w-1/6 flex flex-col items-center gap-2">
                    <motion.div 
                      initial={{ height: 0 }}
                      whileInView={{ height: `${height}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.8, delay: i * 0.1 }}
                      className="w-full bg-primary/20 hover:bg-primary/40 rounded-t-sm transition-colors" 
                    />
                    <span className="text-xs text-muted-foreground">{['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'][i]}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* BOTTOM ROW */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="bg-[#0f1728] p-6 rounded-xl border border-border/50">
              <h3 className="text-lg font-semibold text-white mb-6">Operational Improvements</h3>
              <ul className="space-y-4">
                {[
                  "Automated Follow-Up Workflows: 2x pipeline engagement improvement",
                  "Accelerated Close Cycle: From 45 days to 28 days average",
                  "CRM Pipeline Organization: Full deal visibility across all stages"
                ].map((item, i) => (
                  <motion.li 
                    key={i}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.2 }}
                    className="flex items-start"
                  >
                    <div className="mt-1 mr-3 min-w-[20px] bg-[#10b981]/20 text-[#10b981] rounded-full p-1">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <span className="text-muted-foreground text-sm leading-relaxed">{item}</span>
                  </motion.li>
                ))}
              </ul>
            </div>

            <div className="bg-[#0f1728] p-6 rounded-xl border border-border/50 flex flex-col justify-center">
              <h3 className="text-lg font-semibold text-white mb-6">Impact Comparison</h3>
              <div className="flex items-end justify-center gap-8 h-32">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-20 bg-muted/30 rounded-t-md h-[40%]" />
                  <span className="text-sm font-medium text-muted-foreground">Before TolipAI</span>
                  <span className="text-xs text-muted-foreground">20 Transactions</span>
                </div>
                
                <motion.div 
                  initial={{ opacity: 0, scale: 0.5 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ type: "spring", delay: 0.4 }}
                  className="flex flex-col items-center justify-center -mt-8"
                >
                  <div className="bg-[#10b981]/20 text-[#10b981] px-3 py-1 rounded-full text-sm font-bold border border-[#10b981]/30">
                    +125% Improvement
                  </div>
                </motion.div>

                <div className="flex flex-col items-center gap-2">
                  <motion.div 
                    initial={{ height: "40%" }}
                    whileInView={{ height: "90%" }}
                    viewport={{ once: true }}
                    transition={{ duration: 1, delay: 0.2 }}
                    className="w-20 bg-primary/80 rounded-t-md" 
                  />
                  <span className="text-sm font-medium text-white">After TolipAI</span>
                  <span className="text-xs text-primary">45 Transactions</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

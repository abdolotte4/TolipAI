import { motion } from "framer-motion";
const teamBg = "/images/about-bg.jpg";

export function About() {
  const highlights = [
    "Est. 2026",
    "1+ Years Experience",
    "B2B Infrastructure",
    "Human-in-the-Loop QA"
  ];

  return (
    <section id="about" className="py-24 bg-background relative overflow-hidden">
      <div className="absolute right-0 top-0 w-1/2 h-full opacity-10 pointer-events-none">
        <img 
          src={teamBg}
          alt="Diverse business team collaborating"
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-background to-transparent" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
          >
            <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">About Tolip Group LLC</h2>
            <div className="w-20 h-1 bg-primary rounded-full mb-8" />
            <p className="text-lg text-muted-foreground leading-relaxed mb-6">
              TolipAI, a division of Tolip Group LLC, is a Managed Marketing and Data Infrastructure Agency delivering precision outreach operations, data engineering, and technical CRM infrastructure to real estate investors.
            </p>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Our integrated approach combines data engineering, managed outreach operations, and technical CRM infrastructure to deliver measurable results. We engineer systems that scale, supported by rigorous quality assurance and compliance frameworks.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <div className="grid grid-cols-2 gap-4">
              {highlights.map((highlight, idx) => (
                <div 
                  key={idx} 
                  className="bg-card border border-border/50 p-6 rounded-xl flex items-center justify-center text-center hover:border-primary/30 transition-colors shadow-lg shadow-black/5"
                >
                  <span className="font-semibold text-foreground font-display text-lg">{highlight}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

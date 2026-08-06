import { motion } from "framer-motion";
import { TrendingUp, Rocket, AlertCircle, Lightbulb, Trophy } from "lucide-react";

export function CaseStudies() {
  const studies = [
    {
      title: "From Scattered Data to Organized Pipeline",
      icon: <TrendingUp className="w-6 h-6 text-primary-foreground" />,
      challenge: "A real estate investment team was struggling to track deals across spreadsheets, email threads, and disconnected tools. Their pipeline lacked visibility, follow-up tasks fell through the cracks, and deal reporting was unreliable.",
      solution: "We onboarded the team onto TolipAI CRM and configured custom pipeline stages, automated follow-up task sequences, and reporting dashboards aligned to their deal workflow. The CRM was set up with their existing records migrated and organized.",
      results: "Within two weeks, the team had full pipeline visibility and automated follow-up reminders. Deal reporting went from a manual weekly process to real-time dashboards. The team completed their first full CRM workflow deployment within the first month, with all pipeline stages organized and automated."
    },
    {
      title: "Scaling Operations with CRM Infrastructure",
      icon: <Rocket className="w-6 h-6 text-primary-foreground" />,
      challenge: "A growing real estate acquisitions group needed to scale their operations but lacked reliable CRM infrastructure and workflow automation. Their team was spending hours on manual data entry and administrative tasks instead of analyzing deals.",
      solution: "We implemented TolipAI CRM with custom workflow automation, ARV calculator configuration, comps analysis tools, and a reporting dashboard tailored to their acquisition process. Administrative operations support was also set up to handle ongoing data entry and pipeline maintenance.",
      results: "Within 90 days, the team reduced manual administrative time by over 60%, gained consistent pipeline reporting, and used TolipAI's ARV and comps tools on every deal evaluation. CRM organization and workflow automation allowed the team to handle significantly more deals without adding headcount."
    }
  ];

  return (
    <section id="case-studies" className="py-24 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          className="mb-16 text-center"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">Client Success Stories</h2>
          <div className="w-20 h-1 bg-primary mx-auto rounded-full mb-6" />
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Measurable results delivered through CRM infrastructure and workflow automation.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {studies.map((study, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ delay: index * 0.15, duration: 0.5 }}
              className="bg-[#151c2c] rounded-2xl border border-border overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-primary to-primary/80 p-6 flex items-center gap-4">
                <div className="w-12 h-12 bg-black/20 rounded-full flex items-center justify-center backdrop-blur-sm shadow-inner">
                  {study.icon}
                </div>
                <h3 className="text-2xl font-bold text-primary-foreground font-display">{study.title}</h3>
              </div>
              
              {/* Content */}
              <div className="p-8 flex-1 flex flex-col gap-8">
                {/* Challenge */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertCircle className="w-5 h-5 text-red-500" />
                    <h4 className="text-red-500 font-bold tracking-wider text-sm">CHALLENGE</h4>
                  </div>
                  <p className="text-muted-foreground leading-relaxed bg-black/20 p-5 rounded-xl border border-red-500/10">
                    {study.challenge}
                  </p>
                </div>
                
                {/* Solution */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb className="w-5 h-5 text-blue-500" />
                    <h4 className="text-blue-500 font-bold tracking-wider text-sm">OUR SOLUTION</h4>
                  </div>
                  <p className="text-muted-foreground leading-relaxed bg-black/20 p-5 rounded-xl border border-blue-500/10">
                    {study.solution}
                  </p>
                </div>
                
                {/* Results */}
                <div className="mt-auto">
                  <div className="flex items-center gap-2 mb-3">
                    <Trophy className="w-5 h-5 text-green-500" />
                    <h4 className="text-green-500 font-bold tracking-wider text-sm">RESULTS</h4>
                  </div>
                  <p className="text-foreground leading-relaxed bg-green-500/10 p-5 rounded-xl border border-green-500/20">
                    {study.results}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

import { motion } from "framer-motion";
import { TrendingUp, Rocket, AlertCircle, Lightbulb, Trophy } from "lucide-react";

export function CaseStudies() {
  const studies = [
    {
      title: "From Struggling to Closing Deals",
      icon: <TrendingUp className="w-6 h-6 text-primary-foreground" />,
      challenge: "A real estate investor was unable to generate consistent acquisition opportunities with their previous data provider due to poor data quality. The records consisted mainly of unverified contacts with low intent scores rather than qualified property owners ready to transact.",
      solution: "We conducted a comprehensive data audit and rebuilt their acquisition pipeline from scratch. By identifying the right data sources and implementing our data verification protocols, we developed a customized data strategy aligned with their market objectives and budget.",
      results: "Through daily performance monitoring and our Human-in-the-Loop QA process, we dramatically improved data accuracy. Within two weeks, the client began receiving verified, high-intent property owner contacts. They successfully executed their first contract after a sustained period of pipeline struggles."
    },
    {
      title: "Scaling Operations with Quality Infrastructure",
      icon: <Rocket className="w-6 h-6 text-primary-foreground" />,
      challenge: "A growing real estate acquisitions group needed to scale their operations rapidly but lacked reliable data infrastructure and managed outreach capabilities. They required consistent, high-quality property data and professional outreach management to meet their ambitious growth targets.",
      solution: "We implemented a comprehensive data enrichment and data engineering strategy, leveraging advanced analytics to identify and target high-potential properties. Our managed operations team provided full-service outreach management with dedicated account oversight and regular performance reviews.",
      results: "Within three months, the client experienced a 300% increase in qualified acquisition opportunities and a 150% boost in closed transactions. The consistent flow of verified property data enabled them to scale operations confidently while maintaining excellent conversion rates."
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
            Measurable results delivered through engineered infrastructure and managed operations.
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

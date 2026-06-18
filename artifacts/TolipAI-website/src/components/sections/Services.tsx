import { motion } from "framer-motion";
import { Database, MessageSquare, Settings, Users, BarChart3 } from "lucide-react";
import { Card } from "@/components/ui/card";
const servicesBg = "/images/hero-bg.jpg";

export function Services() {
  const services = [
    {
      title: "Tolip Group LLC",
      icon: <BarChart3 className="w-8 h-8 text-primary" />,
      description: "Tolip Group LLC is the parent company behind TolipAI, delivering a wide range of professional services across real estate, technology, and business operations. Our expertise spans real estate investment, wholesaling, buying and selling houses, and managed virtual assistant services. Beyond real estate, we provide B2B marketing, advanced data analysis, business analytics, and full‑stack programming — building websites with both backend and frontend solutions. Tolip Group LLC also offers accounting services, including tax audit support, accountant portfolios, and FP&A (Financial Planning & Analysis). We combine technical infrastructure with business strategy to help clients scale efficiently and stay compliant."
    },
    {
      title: "Virtual Assistants for Real Estate",
      icon: <Users className="w-8 h-8 text-primary" />,
      description: "Trained real estate virtual assistants (VAs) handling outreach, follow-up, data entry, CRM management, and contact data coordination. Our virtual assistants specialize in property data outreach, real estate marketing, high-propensity prospect qualification, and pipeline support — so your team focuses on closing deals."
    },
    {
      title: "Data Enrichment & Contact Management",
      icon: <Database className="w-8 h-8 text-primary" />,
      description: "Individual and bulk contact data enrichment services for real estate professionals. We locate owner phone numbers, emails, and mailing addresses across all high-propensity property segments. Our property data enrichment service transforms raw property data into high-confidence, actionable owner contacts with 98%+ accuracy."
    },
    {
      title: "Managed Outreach Operations",
      icon: <MessageSquare className="w-8 h-8 text-primary" />,
      description: "End-to-end outbound outreach for real estate professionals — outbound calls, SMS campaigns, and direct mail targeting high-propensity data segments. We build and execute outreach sequences across curated property datasets. All campaigns are tracked and managed inside TolipAI CRM for full pipeline visibility."
    },
    {
      title: "ARV Calculation & Comps Analysis",
      icon: <BarChart3 className="w-8 h-8 text-primary" />,
      description: "Accurate After Repair Value (ARV) calculation and real estate comps analysis using live property data. TolipAI CRM's built-in ARV calculator and MAO calculator automatically pull comparable sales, adjust for property differences, and compute your Maximum Allowable Offer — giving real estate professionals data-driven numbers for every deal."
    },
    {
      title: "Technical CRM Infrastructure",
      icon: <Settings className="w-8 h-8 text-primary" />,
      description: "TolipAI CRM is a purpose-built real estate CRM for investors and real estate professionals. Features include lead pipeline management, ARV (After Repair Value) calculator, MAO (Maximum Allowable Offer) calculator, real estate comps analysis, task tracking, and team collaboration. Manage all high-propensity property segments from first contact to closed deal — all in one CRM."
    }
  ];

  return (
    <section id="services" className="py-24 bg-background relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <img
          src={servicesBg}
          alt=""
          className="w-full h-full object-cover opacity-5"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background" />
      </div>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">Specialized Infrastructure</h2>
          <div className="w-20 h-1 bg-primary mx-auto mb-6 rounded-full" />
          <p className="text-muted-foreground text-lg">
            From TolipAI CRM to virtual assistants and data infrastructure — we build and operate the systems that power modern real estate operations.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {services.map((service, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ delay: index * 0.15, duration: 0.6 }}
            >
              <Card className="h-full bg-card/50 border-border/50 hover:border-primary/50 hover:bg-card transition-all duration-300 p-8 group">
                <div className="w-16 h-16 rounded-2xl bg-secondary/80 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-primary/10 transition-all duration-300">
                  {service.icon}
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-4 font-display">{service.title}</h3>
                <p className="text-muted-foreground leading-relaxed">
                  {service.description}
                </p>
              </Card>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

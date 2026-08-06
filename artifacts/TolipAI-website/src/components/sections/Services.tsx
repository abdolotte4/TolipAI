import { motion } from "framer-motion";
import { MessageSquare, Settings, Users, BarChart3, Building2, Globe, Code2, Calculator } from "lucide-react";
import { Card } from "@/components/ui/card";
const servicesBg = "/images/hero-bg.jpg";

export function Services() {
  const pillars = [
    { icon: <Code2 className="w-5 h-5 text-primary" />, label: "SaaS Software Development (TolipAI)" },
    { icon: <Users className="w-5 h-5 text-primary" />, label: "CRM Support & Pipeline Management" },
    { icon: <BarChart3 className="w-5 h-5 text-primary" />, label: "Business Operations Consulting" },
    { icon: <Building2 className="w-5 h-5 text-primary" />, label: "Full-Stack Software Development" },
    { icon: <Calculator className="w-5 h-5 text-primary" />, label: "Accounting, FP&A & Tax Audit Support" },
    { icon: <Globe className="w-5 h-5 text-primary" />, label: "Business Operations & Infrastructure" },
  ];

  const services = [
    {
      title: "Property Research & CRM Data Organization",
      icon: <Users className="w-8 h-8 text-primary" />,
      description: "Tools to organize client-provided records, property information, and CRM data for permitted business purposes. Our dedicated CRM support specialists handle data entry, record management, pipeline organization, task tracking, and administrative operations inside TolipAI CRM — so your team stays focused on underwriting and closing."
    },
    {
      title: "Lead Pipeline & Client Communication Workflows",
      icon: <MessageSquare className="w-8 h-8 text-primary" />,
      description: "Lead pipeline management, appointment coordination, CRM organization, and client-approved follow-up workflows with appropriate consent and opt-out controls. We design and implement automated task sequences, notification systems, and pipeline stage triggers inside TolipAI CRM — giving your team full visibility and operational consistency across every deal."
    },
    {
      title: "ARV Calculation & Comps Analysis",
      icon: <BarChart3 className="w-8 h-8 text-primary" />,
      description: "Accurate After Repair Value (ARV) calculation and real estate comps analysis using live property data. TolipAI CRM's built-in ARV calculator and MAO calculator automatically pull comparable sales, adjust for property differences, and compute your Maximum Allowable Offer — giving real estate professionals reliable numbers for every evaluation."
    },
    {
      title: "Administrative Operations Support",
      icon: <Settings className="w-8 h-8 text-primary" />,
      description: "Administrative support for CRM management, data entry, appointment coordination, reporting, and workflow organization. TolipAI CRM is a purpose-built real estate CRM for professionals — featuring pipeline management, ARV calculator, MAO calculator, comps analysis, task tracking, and team collaboration. Manage all property segments and workflow stages — all in one platform."
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

        {/* ── Tolip Group LLC Identity Block ─────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7 }}
          className="mb-20"
        >
          <div className="rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card/60 to-card/30 p-10 md:p-14 backdrop-blur-sm">
            <div className="max-w-4xl">
              <p className="text-primary text-sm font-semibold uppercase tracking-widest mb-3">Parent Company</p>
              <h2 className="text-4xl md:text-5xl font-bold font-display text-foreground mb-5 leading-tight">
                Tolip Group LLC
              </h2>
              <div className="w-16 h-1 bg-primary rounded-full mb-6" />
              <p className="text-muted-foreground text-lg leading-relaxed mb-8 max-w-3xl">
                Tolip Group LLC is the parent company behind TolipAI. We deliver professional services spanning SaaS software development, technology infrastructure, and business operations — combining technical infrastructure with business strategy to help clients scale efficiently and stay compliant.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {pillars.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl bg-secondary/40 border border-border/50 px-4 py-3">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      {p.icon}
                    </div>
                    <span className="text-sm text-foreground font-medium leading-snug">{p.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── Specialized Services Grid ───────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">Specialized Infrastructure</h2>
          <div className="w-20 h-1 bg-primary mx-auto mb-6 rounded-full" />
          <p className="text-muted-foreground text-lg">
            From TolipAI CRM to workflow automation and pipeline management — we build and operate the systems that power modern real estate operations.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
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

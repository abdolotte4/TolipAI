import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { useEffect } from "react";
import { motion } from "framer-motion";
import { CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

const tiers = [
  {
    name: "Starter",
    price: "Contact Us",
    description: "For solo investors and small teams getting organized.",
    features: [
      "CRM setup support",
      "Pipeline organization & management",
      "Basic property analysis tools",
      "Task tracking",
      "Email support",
    ],
    cta: "Request a Demo",
    featured: false,
  },
  {
    name: "Growth",
    price: "Contact Us",
    description: "For growing teams that need automation and analytics.",
    features: [
      "CRM workflows & automation",
      "Pipeline dashboards & reporting",
      "ARV calculator",
      "Comps analysis tools",
      "Appointment coordination workflows",
      "Reporting dashboard",
      "Priority support",
    ],
    cta: "Request a Demo",
    featured: true,
  },
  {
    name: "Custom",
    price: "Contact Us",
    description: "For established teams needing full-service operations.",
    features: [
      "Custom workflow automation",
      "Real estate operations support",
      "CRM migration assistance",
      "Custom reporting & dashboards",
      "Dedicated onboarding specialist",
      "Administrative operations support",
      "Dedicated account manager",
    ],
    cta: "Talk to Sales",
    featured: false,
  },
];

export default function Pricing() {
  useEffect(() => { window.scrollTo(0, 0); }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-24">
        <div className="text-center mb-16">
          <span className="inline-block py-1 px-3 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold tracking-wider uppercase mb-4">
            Pricing
          </span>
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4 font-display">
            Simple, Transparent Pricing
          </h1>
          <div className="w-20 h-1 bg-primary mx-auto mb-6 rounded-full" />
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Choose the plan that fits your team's needs. All plans include access to TolipAI's CRM platform, workflow tools, and dedicated support.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {tiers.map((tier, index) => (
            <motion.div
              key={tier.name}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1, duration: 0.5 }}
              className={`rounded-2xl border p-8 flex flex-col ${
                tier.featured
                  ? "bg-[#0b1727] border-2 border-primary shadow-[0_0_40px_rgba(212,175,55,0.15)] md:-mt-4 md:mb-4"
                  : "bg-card border-border shadow-lg"
              }`}
            >
              {tier.featured && (
                <div className="text-center mb-4">
                  <span className="inline-block py-1 px-3 rounded-full bg-primary text-primary-foreground text-xs font-bold tracking-wider uppercase">
                    Most Popular
                  </span>
                </div>
              )}
              <h2 className={`text-2xl font-bold font-display mb-2 ${tier.featured ? "text-white" : "text-foreground"}`}>
                {tier.name}
              </h2>
              <p className={`text-sm mb-6 ${tier.featured ? "text-white/70" : "text-muted-foreground"}`}>
                {tier.description}
              </p>
              <div className="mb-8">
                <span className={`text-xl font-semibold ${tier.featured ? "text-primary" : "text-foreground"}`}>
                  {tier.price}
                </span>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                    <span className={`text-sm ${tier.featured ? "text-white/80" : "text-muted-foreground"}`}>
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>
              <Button
                className={`w-full rounded-full font-semibold ${
                  tier.featured
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "border border-primary text-primary hover:bg-primary/10 bg-transparent"
                }`}
                onClick={() => {
                  const el = document.querySelector("#contact");
                  if (el) el.scrollIntoView({ behavior: "smooth" });
                  else window.location.href = "/#contact";
                }}
              >
                {tier.cta}
              </Button>
            </motion.div>
          ))}
        </div>

        <div className="mt-16 p-8 rounded-2xl border border-primary/20 bg-primary/5 text-center">
          <h3 className="text-xl font-bold text-foreground mb-3 font-display">Not sure which plan is right for you?</h3>
          <p className="text-muted-foreground mb-6">
            Request a guided product demo to see how TolipAI supports CRM workflows, pipeline management, and real estate analysis tools.
          </p>
          <Button
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-full px-8 font-semibold"
            onClick={() => { window.location.href = "/#contact"; }}
          >
            Request a Demo
          </Button>
        </div>
      </main>
      <Footer />
    </div>
  );
}

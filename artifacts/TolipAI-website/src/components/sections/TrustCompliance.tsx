import { motion } from "framer-motion";
import { ShieldCheck, Building2, Lock, FileCheck, Globe } from "lucide-react";
import { Link } from "wouter";

const trustItems = [
  {
    icon: <Building2 className="w-6 h-6 text-primary" />,
    title: "US Registered LLC",
    desc: "Tolip Group LLC — Wyoming Limited Liability Company, registered and operating in the United States.",
  },
  {
    icon: <Globe className="w-6 h-6 text-primary" />,
    title: "Software-as-a-Service Provider",
    desc: "TolipAI is a SaaS platform. We provide CRM software and workflow automation tools — not lead brokerage, data resale, or advisory services.",
  },
  {
    icon: <ShieldCheck className="w-6 h-6 text-primary" />,
    title: "Compliance-Focused Architecture",
    desc: "Our platform is built with TCPA compliance, SMS opt-in/opt-out controls, and data handling practices aligned to applicable regulations.",
  },
  {
    icon: <Lock className="w-6 h-6 text-primary" />,
    title: "Secure Customer Data Handling",
    desc: "Customer data is processed and managed in accordance with our Privacy Policy and applicable data protection regulations.",
  },
  {
    icon: <FileCheck className="w-6 h-6 text-primary" />,
    title: "Real Estate Operations Software",
    desc: "Purpose-built for real estate professionals to manage pipelines, automate workflows, and analyze property data — all within one platform.",
  },
];

export function TrustCompliance() {
  return (
    <section id="trust" className="py-24 bg-secondary/20 border-t border-border/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          className="text-center mb-14"
        >
          <span className="inline-block py-1 px-3 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold tracking-wider uppercase mb-4">
            Trust &amp; Compliance
          </span>
          <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">
            Built on Transparency
          </h2>
          <div className="w-20 h-1 bg-primary mx-auto rounded-full mb-6" />
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            TolipAI operates as a software platform for real estate professionals. Our business information, compliance posture, and data practices are clearly documented below.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {trustItems.map((item, i) => (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ delay: i * 0.08, duration: 0.5 }}
              className="bg-card border border-border/50 rounded-2xl p-6 flex flex-col gap-3 hover:border-primary/30 transition-colors"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                {item.icon}
              </div>
              <h3 className="font-bold text-foreground font-display">{item.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Business Info Card */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="bg-card border border-border/50 rounded-2xl p-8 max-w-3xl mx-auto text-center"
        >
          <h3 className="text-lg font-bold text-foreground font-display mb-4">Business Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-muted-foreground mb-6">
            <div className="bg-background rounded-lg px-4 py-3">
              <span className="text-foreground font-semibold block mb-0.5">Company</span>
              Tolip Group LLC (TolipAI)
            </div>
            <div className="bg-background rounded-lg px-4 py-3">
              <span className="text-foreground font-semibold block mb-0.5">Entity Type</span>
              Wyoming Limited Liability Company
            </div>
            <div className="bg-background rounded-lg px-4 py-3">
              <span className="text-foreground font-semibold block mb-0.5">Address</span>
              1309 Coffeen Ave STE 1200, Sheridan, WY 82801
            </div>
            <div className="bg-background rounded-lg px-4 py-3">
              <span className="text-foreground font-semibold block mb-0.5">Contact</span>
              <a href="mailto:info@tolipai.com" className="text-primary hover:underline">info@tolipai.com</a>
              {" · "}(659) 250-4618
            </div>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Customer data is processed and managed in accordance with our{" "}
            <Link href="/privacy-policy" className="text-primary hover:underline">Privacy Policy</Link>{" "}
            and applicable regulations.
          </p>
          <div className="flex flex-wrap justify-center gap-3 text-xs">
            {[
              { label: "Privacy Policy", href: "/privacy-policy" },
              { label: "Terms of Service", href: "/terms-of-service" },
              { label: "Cookie Policy", href: "/cookie-policy" },
              { label: "Acceptable Use", href: "/acceptable-use" },
              { label: "Compliance", href: "/compliance" },
            ].map(({ label, href }) => (
              <Link key={href} href={href} className="px-3 py-1.5 rounded-full border border-border hover:border-primary/50 text-muted-foreground hover:text-primary transition-colors">
                {label}
              </Link>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

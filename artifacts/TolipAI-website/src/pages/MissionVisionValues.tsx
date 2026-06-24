import { useEffect } from "react";
import { Target, Eye, Star, Users, BarChart2, Lightbulb, Shield } from "lucide-react";

export default function MissionVisionValues() {
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = "Mission, Vision & Values | Tolip Group LLC";
  }, []);

  const values = [
    {
      icon: Users,
      title: "Client Success First",
      body: "Every engagement begins with our client's desired outcome — not a service package. We measure our performance by the tangible operational improvements our clients achieve: pipelines organized, workflows automated, and administrative overhead reduced. A client win is our only win.",
    },
    {
      icon: BarChart2,
      title: "Data-Driven Execution",
      body: "Every workflow we configure and every CRM system we build is grounded in property data, ownership records, and market intelligence. We do not rely on guesswork or generic templates. Our decisions — from pipeline structure to automation logic — are grounded in verified data and continuously refined by real-world performance.",
    },
    {
      icon: Lightbulb,
      title: "Relentless Innovation",
      body: "Real estate is not static, and neither are we. We build and evolve our own tools — CRM infrastructure, property analytics engines, ARV calculators, and workflow automation systems — to stay ahead of market conditions and give our clients advantages that off-the-shelf software cannot offer.",
    },
    {
      icon: Shield,
      title: "Integrity and Compliance",
      body: "We operate with full transparency on deliverables, timelines, and performance. Our platform is designed with compliance as a foundational requirement — not an afterthought. Clients receive clear reporting, honest communication, and systems built to operate within applicable regulatory frameworks every billing cycle.",
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-4 bg-gradient-to-b from-[#0a0f1a] to-background overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-[#d4af37]/5 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-4xl mx-auto text-center">
          <p className="text-[#d4af37] text-sm font-semibold uppercase tracking-widest mb-4">Tolip Group LLC</p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-foreground leading-tight mb-6">
            Mission, Vision <span className="text-[#d4af37]">&amp;</span> Values
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            The principles that guide every decision we make, every system we build, and every client relationship we maintain.
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-[#d4af37]/10 flex items-center justify-center">
              <Target className="w-5 h-5 text-[#d4af37]" />
            </div>
            <span className="text-[#d4af37] text-sm font-semibold uppercase tracking-widest">Mission</span>
          </div>

          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">What is TolipAI's Mission Statement?</h2>

          <blockquote className="border-l-4 border-[#d4af37] pl-6 mb-10">
            <p className="text-xl text-foreground font-medium italic leading-relaxed">
              "To deliver exceptional, measurable results for real estate professionals by providing workflow automation, CRM infrastructure, and property analytics — empowering our clients to scale their operations with confidence, consistency, and compliance."
            </p>
          </blockquote>

          <div className="grid sm:grid-cols-2 gap-6">
            {[
              {
                heading: "Outcome-Oriented Delivery",
                body: "TolipAI's mission anchors every engagement to a concrete operational result: organized pipelines, automated workflows, and reduced administrative overhead. We don't sell impressions or clicks — we deliver configured CRM systems and automation workflows that produce measurable efficiency gains for real estate professionals.",
              },
              {
                heading: "Managed Infrastructure, Not Ad-Hoc Services",
                body: "Our model functions as a fully managed technology arm embedded within our clients' operations. From CRM configuration and workflow automation to property analytics and pipeline management, we handle the infrastructure so investors can focus on underwriting and closing — not data administration.",
              },
              {
                heading: "Consistency at Scale",
                body: "We deliver consistent operational infrastructure that performs the same way at month one and month twelve. Consistency is not an aspiration — it is an operational commitment built into every workflow we design, every pipeline we configure, and every analytics system we deploy.",
              },
              {
                heading: "Compliance as a Competitive Advantage",
                body: "TolipAI integrates compliance-focused design into every workflow and system we build. This infrastructure layer transforms manual, error-prone processes into auditable, repeatable operations — reducing client risk and improving operational reliability across every market we serve.",
              },
            ].map((item) => (
              <div key={item.heading} className="bg-card border border-border rounded-2xl p-6">
                <h3 className="text-foreground font-semibold text-lg mb-2">{item.heading}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="max-w-4xl mx-auto px-4">
        <div className="border-t border-border" />
      </div>

      {/* Vision */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-[#d4af37]/10 flex items-center justify-center">
              <Eye className="w-5 h-5 text-[#d4af37]" />
            </div>
            <span className="text-[#d4af37] text-sm font-semibold uppercase tracking-widest">Vision</span>
          </div>

          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-6">What is TolipAI's Vision Statement?</h2>

          <blockquote className="border-l-4 border-[#d4af37] pl-6 mb-10">
            <p className="text-xl text-foreground font-medium italic leading-relaxed">
              "To become the most trusted CRM infrastructure and workflow automation partner for real estate professionals nationwide — recognized for our ability to design, build, and operate compliant, scalable systems through the precise application of technology, proprietary analytics, and human expertise."
            </p>
          </blockquote>

          <div className="grid sm:grid-cols-2 gap-6 mb-10">
            {[
              {
                heading: "Trusted Partnership as Strategic Identity",
                body: "TolipAI's vision is built on becoming an indispensable, long-term partner — not a rotating vendor. We aim to be the firm real estate professionals call before they expand into a new market, redesign their CRM pipeline, or need to understand why their operations underperformed. That level of trust is earned through consistent results and honest communication.",
              },
              {
                heading: "Proprietary Infrastructure at the Core",
                body: "Our vision drives continuous investment in our own tools: CRM automation engines, property analytics platforms, ARV calculators, and workflow orchestration systems. We believe proprietary infrastructure is the only durable competitive advantage in real estate services — and we build that advantage ourselves.",
              },
              {
                heading: "Nationwide Reach, Market-Level Precision",
                body: "We are building toward a model where TolipAI can deploy CRM infrastructure and workflow automation in any U.S. market within days — with the same operational depth and analytical precision we deliver today in our core markets. Scale without sacrificing quality is the operational standard we hold ourselves to.",
              },
              {
                heading: "Human Judgment Meets Automation",
                body: "Technology alone does not produce results. TolipAI's vision combines automated infrastructure with senior-level judgment on every system we configure and every pipeline we manage. The result is a platform that thinks like an investor — because it is operated by people who understand what a well-run acquisition operation looks like.",
              },
            ].map((item) => (
              <div key={item.heading} className="bg-card border border-border rounded-2xl p-6">
                <h3 className="text-foreground font-semibold text-lg mb-2">{item.heading}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>

          {/* Signature */}
          <div className="bg-[#d4af37]/5 border border-[#d4af37]/20 rounded-2xl p-8 text-center">
            <p className="text-foreground/80 text-base italic leading-relaxed max-w-2xl mx-auto mb-6">
              "Our vision isn't abstract. Every system we build, every workflow we automate, and every client relationship we maintain is a step toward becoming the firm that investors trust without question — the partner they don't have to manage, because we already know what a well-run operation looks like for them."
            </p>
            <div className="flex flex-col items-center gap-1">
              <p className="text-[#d4af37] font-bold text-lg">Abdullah Gawish</p>
              <p className="text-muted-foreground text-sm">Partner &amp; Chief Marketing Officer, Tolip Group LLC</p>
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="max-w-4xl mx-auto px-4">
        <div className="border-t border-border" />
      </div>

      {/* Values */}
      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-[#d4af37]/10 flex items-center justify-center">
              <Star className="w-5 h-5 text-[#d4af37]" />
            </div>
            <span className="text-[#d4af37] text-sm font-semibold uppercase tracking-widest">Core Values</span>
          </div>

          <h2 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">What are TolipAI's Core Values?</h2>
          <p className="text-muted-foreground mb-10 leading-relaxed max-w-2xl">
            TolipAI's core values are the operational compass that shape every client engagement and every internal decision. They define how we work, what we prioritize, and the standard of service our clients can expect — consistently.
          </p>

          <div className="grid sm:grid-cols-2 gap-6">
            {values.map((v) => {
              const Icon = v.icon;
              return (
                <div key={v.title} className="bg-card border border-border rounded-2xl p-7 flex flex-col gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-[#d4af37]/10 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-4.5 h-4.5 text-[#d4af37]" />
                    </div>
                    <h3 className="text-foreground font-bold text-lg">{v.title}</h3>
                  </div>
                  <p className="text-muted-foreground text-sm leading-relaxed">{v.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-16 px-4 bg-gradient-to-t from-[#0a0f1a] to-background">
        <div className="max-w-2xl mx-auto text-center">
          <h3 className="text-2xl font-bold text-foreground mb-3">Ready to work with a team that lives by these principles?</h3>
          <p className="text-muted-foreground mb-8">Schedule a consultation and see how TolipAI's mission translates into operational results for your real estate business.</p>
          <a href="/" className="inline-block bg-[#d4af37] text-[#0a0f1a] font-bold px-8 py-4 rounded-full hover:bg-[#d4af37]/90 transition-colors">
            Back to TolipAI.com
          </a>
        </div>
      </section>
    </div>
  );
}

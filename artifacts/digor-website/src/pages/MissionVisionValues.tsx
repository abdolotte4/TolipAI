import { useEffect } from "react";
import { Target, Eye, Star, Users, BarChart2, Lightbulb, Shield } from "lucide-react";

export default function MissionVisionValues() {
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = "Mission, Vision & Values | TolipAI LLC";
  }, []);

  const values = [
    {
      icon: Users,
      title: "Client Success First",
      body: "Every engagement begins with our client's desired outcome — not a service package. We measure our performance by the tangible results our clients achieve: enriched data records delivered, pipelines activated, operations scaled. A client win is our only win.",
    },
    {
      icon: BarChart2,
      title: "Data-Driven Execution",
      body: "Every lead we deliver is backed by property data, ownership records, and market intelligence. We do not rely on guesswork or volume plays. Our decisions — from list selection to outreach sequencing — are grounded in verified data and continuously refined by real-world performance.",
    },
    {
      icon: Lightbulb,
      title: "Relentless Innovation",
      body: "Real estate is not static, and neither are we. We build and evolve our own tools — data enrichment pipelines, property opportunity finders, ARV calculators — to stay ahead of market conditions and give our clients advantages that off-the-shelf services cannot offer.",
    },
    {
      icon: Shield,
      title: "Integrity and Transparency",
      body: "We operate with full transparency on deliverables, timelines, and performance. No vanity metrics, no inflated lead counts. Our clients receive clear reporting, honest communication, and a service that stands behind what it promises — every billing cycle.",
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
          <p className="text-[#d4af37] text-sm font-semibold uppercase tracking-widest mb-4">TolipAI LLC</p>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6">
            Mission, Vision <span className="text-[#d4af37]">&amp;</span> Values
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto leading-relaxed">
            The principles that guide every decision we make, every lead we deliver, and every client relationship we build.
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

          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">What is TolipAI's Mission Statement?</h2>

          <blockquote className="border-l-4 border-[#d4af37] pl-6 mb-10">
            <p className="text-xl text-white font-medium italic leading-relaxed">
              "To deliver exceptional, measurable results for real estate professionals by providing curated data intelligence, property analytics, and managed infrastructure services — empowering our clients to scale their operations with confidence and consistency."
            </p>
          </blockquote>

          <div className="grid sm:grid-cols-2 gap-6">
            {[
              {
                heading: "Outcome-Oriented Delivery",
                body: "TolipAI's mission anchors every engagement to a concrete result: qualified, enriched data that produces actionable opportunities. We don't sell impressions or clicks — we deliver verified property owner records that have been researched, validated, and prioritized based on market criteria that match our clients' parameters.",
              },
              {
                heading: "Managed Infrastructure, Not Ad-Hoc Services",
                body: "Our model functions as a fully managed marketing arm embedded within our clients' operations. From data enrichment and list building to outreach sequencing, we handle the infrastructure so investors can focus on underwriting and closing — not pipeline administration.",
              },
              {
                heading: "Consistency at Scale",
                body: "We deliver 15–40 enriched data records per month, every month, with the same rigor applied to record #1 and record #400. Consistency is not an aspiration — it is an operational commitment built into our process from data sourcing through client handoff.",
              },
              {
                heading: "Data Intelligence as Competitive Advantage",
                body: "TolipAI integrates property records, ownership data, market condition signals, and ARV analytics into every outreach campaign. This intelligence layer transforms broad outreach into precision targeting — reducing client costs and improving conversion rates across every market we operate in.",
              },
            ].map((item) => (
              <div key={item.heading} className="bg-card border border-border rounded-2xl p-6">
                <h3 className="text-white font-semibold text-lg mb-2">{item.heading}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{item.body}</p>
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

          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-6">What is TolipAI's Vision Statement?</h2>

          <blockquote className="border-l-4 border-[#d4af37] pl-6 mb-10">
            <p className="text-xl text-white font-medium italic leading-relaxed">
              "To become the most trusted data infrastructure partner for real estate professionals nationwide — recognized for our ability to identify, enrich, and deliver actionable property data through the precise application of technology, proprietary analytics, and human expertise."
            </p>
          </blockquote>

          <div className="grid sm:grid-cols-2 gap-6 mb-10">
            {[
              {
                heading: "Trusted Partnership as Strategic Identity",
                body: "TolipAI's vision is built on becoming an indispensable, long-term partner — not a rotating vendor. We aim to be the firm real estate professionals call before they expand into a new market, launch a new data strategy, or need to understand why a pipeline underperformed. That level of trust is earned through consistent results and honest communication.",
              },
              {
                heading: "Proprietary Intelligence at the Core",
                body: "Our vision drives continuous investment in our own tools: data enrichment pipelines, property opportunity finders, ARV calculators, and market scoring models. We believe proprietary intelligence is the only durable competitive advantage in real estate services — and we build that advantage ourselves.",
              },
              {
                heading: "Nationwide Reach, Market-Level Precision",
                body: "We are building toward a model where TolipAI can activate data pipelines in any U.S. market within days — with the same data depth and outreach precision we deliver today in our core markets. Scale without sacrificing quality is the operational standard we hold ourselves to.",
              },
              {
                heading: "Human Judgment Meets Data Infrastructure",
                body: "Technology alone does not produce deals. TolipAI's vision combines automated data infrastructure with senior-level judgment on every list we build and every lead we qualify. The result is a service that thinks like an investor — because it is operated by people who understand what closable looks like.",
              },
            ].map((item) => (
              <div key={item.heading} className="bg-card border border-border rounded-2xl p-6">
                <h3 className="text-white font-semibold text-lg mb-2">{item.heading}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>

          {/* Signature */}
          <div className="bg-[#d4af37]/5 border border-[#d4af37]/20 rounded-2xl p-8 text-center">
            <p className="text-gray-300 text-base italic leading-relaxed max-w-2xl mx-auto mb-6">
              "Our vision isn't abstract. Every lead we deliver, every tool we build, and every client relationship we maintain is a step toward becoming the firm that investors trust without question — the partner they don't have to manage, because we already know what winning looks like for them."
            </p>
            <div className="flex flex-col items-center gap-1">
              <p className="text-[#d4af37] font-bold text-lg">Abdullah Gawish</p>
              <p className="text-gray-400 text-sm">Partner &amp; Chief Marketing Officer, TolipAI LLC</p>
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

          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">What are TolipAI's Core Values?</h2>
          <p className="text-gray-400 mb-10 leading-relaxed max-w-2xl">
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
                    <h3 className="text-white font-bold text-lg">{v.title}</h3>
                  </div>
                  <p className="text-gray-400 text-sm leading-relaxed">{v.body}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-16 px-4 bg-gradient-to-t from-[#0a0f1a] to-background">
        <div className="max-w-2xl mx-auto text-center">
          <h3 className="text-2xl font-bold text-white mb-3">Ready to work with a team that lives by these principles?</h3>
          <p className="text-gray-400 mb-8">Schedule a consultation and see how TolipAI's mission translates into results for your data pipeline.</p>
          <a href="/" className="inline-block bg-[#d4af37] text-[#0a0f1a] font-bold px-8 py-4 rounded-full hover:bg-[#d4af37]/90 transition-colors">
            Back to TolipAI.com
          </a>
        </div>
      </section>
    </div>
  );
}

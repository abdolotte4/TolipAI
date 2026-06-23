import { motion } from "framer-motion";
import { Star } from "lucide-react";

export function Testimonials() {
  const testimonials = [
    {
      name: "Michael Torres",
      role: "REAL ESTATE INVESTOR",
      text: "TolipAI transformed our acquisition operations completely. Their data engineering services delivered verified property owner contacts with accuracy rates we had never seen before. Our transaction volume increased by 200% within the first quarter.",
      featured: false
    },
    {
      name: "Sarah Chen",
      role: "PORTFOLIO MANAGER",
      text: "Outstanding operational infrastructure. Within weeks of partnering with TolipAI, our acquisition pipeline was producing consistent, qualified opportunities. Their managed outreach team operates with exceptional professionalism and compliance standards. The ROI has been remarkable.",
      featured: true
    },
    {
      name: "David Williams",
      role: "REAL ESTATE ACQUISITIONS DIRECTOR",
      text: "The TolipAI team has been instrumental in scaling our operations. Their technical CRM infrastructure and data engineering capabilities are best-in-class. We've achieved results that exceeded our most optimistic projections. Highly recommend.",
      featured: false
    }
  ];

  return (
    <section className="py-24 bg-background">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">Client Testimonials</h2>
          <div className="w-20 h-1 bg-primary mx-auto rounded-full mb-6" />
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Don't just take our word for it. Hear what industry leaders are saying about Tolip Group LLC.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-stretch">
          {testimonials.map((item, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ delay: index * 0.15, duration: 0.5 }}
              className={`p-8 rounded-2xl flex flex-col h-full relative ${
                item.featured 
                  ? "bg-[#0b1727] border-2 border-primary shadow-[0_0_30px_rgba(212,175,55,0.15)] md:-mt-4 md:mb-4 z-10" 
                  : "bg-card border border-border shadow-lg"
              }`}
            >
              <div className="text-6xl font-display text-primary/40 leading-none absolute top-4 left-6">"</div>
              
              <div className="flex justify-center mb-6 mt-6">
                <div className="flex gap-1">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 fill-primary text-primary" />
                  ))}
                </div>
              </div>
              
              <p className={`text-center leading-relaxed flex-1 ${item.featured ? "text-white/90" : "text-muted-foreground"}`}>
                {item.text}
              </p>
              
              <div className="mt-8 flex flex-col items-center">
                <div className="w-14 h-14 bg-primary/20 rounded-full flex items-center justify-center mb-4 text-primary font-bold text-xl border border-primary/30">
                  {item.name.charAt(0)}
                </div>
                <h4 className="font-bold text-lg font-display text-foreground">{item.name}</h4>
                <p className="text-primary text-xs font-semibold tracking-widest mt-1">{item.role}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

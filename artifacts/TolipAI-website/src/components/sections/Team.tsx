import { motion } from "framer-motion";
import { Mail } from "lucide-react";

export function Team() {
  const leaders = [
    {
      name: "Mahmoud Aly",
      role: "Chief Executive Officer",
      email: "info@tolipai.com",
      description: "Visionary leader driving TolipAI's strategic direction, client relationships, and operational excellence. With deep expertise in B2B infrastructure and real estate acquisition markets.",
      image: "avatar-1.jpg"
    },
    {
      name: "David Holloway",
      role: "Partner&Chief Operating Officer",
      email: "david@tolipai.com",
      description: "Oversees all operational workflows, quality assurance protocols, and delivery systems ensuring every client engagement meets TolipAI's rigorous standards.",
      image: "avatar-2.jpg"
    },
    {
      name: "Abdullah Gawish",
      role: "Partner&Chief Marketing Officer",
      email: "abdullah@tolipai.com",
      description: "Leads TolipAI's marketing strategy, brand development, and client acquisition programs with a focus on data-driven outreach and market positioning.",
      image: "avatar-3.jpg"
    }
  ];

  const specialists = [
    {
      name: "Martin Adams",
      role: "Chief Technology Officer",
      email: "martin@tolipai.com",
      description: "Architects the technical infrastructure powering TolipAI's CRM systems, data engineering pipelines, and operational automation frameworks.",
      image: "avatar-4.jpg"
    },
    {
      name: "Amr Alyy",
      role: "Head Of Finance",
      email: "Amr.aly@tolipai.com",
      description: "Oversees financial planning, budgeting, and compliance. Specializes in FP&A, tax audit preparation, and building robust accounting frameworks to support sustainable growth and investor confidence.",
      image: "avatar-1.jpg"
    }
  ];

  const Card = ({ member, index }: { member: any, index: number }) => (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ delay: index * 0.1, duration: 0.5 }}
      className="text-center group bg-card p-8 rounded-2xl border border-border hover:border-primary/50 transition-colors shadow-lg shadow-black/10"
    >
      <div className="w-32 h-32 mx-auto mb-6 rounded-full overflow-hidden border-2 border-border group-hover:border-primary/50 transition-all p-1 bg-background relative">
        <img 
          src={`${import.meta.env.BASE_URL}images/${member.image}`} 
          alt={member.name}
          className="w-full h-full object-cover rounded-full filter brightness-90 group-hover:brightness-110 transition-all"
        />
      </div>
      <h3 className="text-2xl font-bold text-foreground mb-1 font-display">{member.name}</h3>
      <h4 className="text-primary font-semibold mb-3 text-sm tracking-wider uppercase">{member.role}</h4>
      <a
        href={`mailto:${member.email}`}
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors mb-4"
      >
        <Mail className="w-3.5 h-3.5" />
        {member.email}
      </a>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {member.description}
      </p>
    </motion.div>
  );

  return (
    <section id="team" className="py-24 bg-card/50 border-t border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-4xl font-bold mb-4 font-display">Executive Leadership</h2>
          <div className="w-20 h-1 bg-primary mx-auto rounded-full mb-6" />
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            A cross-functional team of technical experts and operational professionals dedicated to your success.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-8">
          {leaders.map((member, index) => (
            <Card key={index} member={member} index={index} />
          ))}
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-4xl mx-auto">
          {specialists.map((member, index) => (
            <Card key={index + 3} member={member} index={index + 3} />
          ))}
        </div>
      </div>
    </section>
  );
}

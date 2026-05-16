import { useState, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { Users, CheckSquare, Trophy, Clock } from "lucide-react";

function useCountUp(end: number, duration: number = 2) {
  const [count, setCount] = useState(0);
  const [hasTriggered, setHasTriggered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasTriggered) {
          setHasTriggered(true);
        }
      },
      { threshold: 0.1 }
    );

    if (ref.current) {
      observer.observe(ref.current);
    }

    return () => observer.disconnect();
  }, [hasTriggered]);

  useEffect(() => {
    if (!hasTriggered) return;

    let startTime: number | null = null;
    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / (duration * 1000), 1);
      setCount(Math.floor(progress * end));
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  }, [end, duration, hasTriggered]);

  return { count, ref };
}

export function SuccessStory() {
  const stats = [
    {
      icon: <Users className="w-8 h-8 text-primary" />,
      number: 64,
      label: "Happy Clients",
      suffix: "+"
    },
    {
      icon: <CheckSquare className="w-8 h-8 text-primary" />,
      number: 100,
      label: "Projects Completed",
      suffix: "%"
    },
    {
      icon: <Trophy className="w-8 h-8 text-primary" />,
      number: 150,
      label: "Awards Won",
      suffix: "+"
    },
    {
      icon: <Clock className="w-8 h-8 text-primary" />,
      number: 5,
      label: "Years Experience",
      suffix: "+"
    }
  ];

  return (
    <section className="py-20 bg-[#0c1220] border-y border-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mb-12"
        >
          <h2 className="text-3xl font-bold font-display text-white tracking-widest">SUCCESS STORY</h2>
          <div className="w-24 h-1 bg-primary mx-auto mt-4 rounded-full" />
        </motion.div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
          {stats.map((stat, index) => {
            const countUp = useCountUp(stat.number, 2.5);
            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1, duration: 0.5 }}
                className="group relative"
              >
                <div className="absolute inset-0 bg-primary/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl" />
                <div className="relative bg-card/80 backdrop-blur-sm border border-primary/30 p-8 rounded-2xl flex flex-col items-center justify-center text-center hover:border-primary transition-colors h-full">
                  <div className="w-16 h-16 bg-background rounded-full border border-border flex items-center justify-center mb-6 shadow-inner group-hover:scale-110 transition-transform duration-300">
                    {stat.icon}
                  </div>
                  <div ref={countUp.ref} className="text-4xl md:text-5xl font-bold text-white font-display mb-2 flex items-baseline">
                    {countUp.count}
                    <span className="text-primary text-2xl ml-1">{stat.suffix}</span>
                  </div>
                  <p className="text-muted-foreground text-sm font-medium tracking-wide uppercase">
                    {stat.label}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

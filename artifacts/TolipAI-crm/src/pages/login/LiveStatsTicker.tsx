import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface Stat {
  label: string;
  target: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

const STATS: Stat[] = [
  { label: "Leads Qualified by AI This Month", target: 12847, suffix: "" },
  { label: "Voicemails Dropped Automatically", target: 4291, suffix: "" },
  { label: "Est. Deals Tracked in Pipeline", target: 2.4, prefix: "$", suffix: "M", decimals: 1 },
];

function useCountUp(target: number, duration = 2000, decimals = 0) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let start: number | null = null;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(parseFloat((eased * target).toFixed(decimals)));
      if (progress < 1) requestAnimationFrame(step);
    };
    const raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, decimals]);
  return value;
}

function Counter({ stat, index }: { stat: Stat; index: number }) {
  const value = useCountUp(stat.target, 2200 + index * 200, stat.decimals ?? 0);
  const formatted = stat.decimals
    ? value.toFixed(stat.decimals)
    : Math.round(value).toLocaleString();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6 + index * 0.15, duration: 0.5 }}
      className="flex flex-col"
    >
      <span className="text-3xl font-bold text-white tabular-nums">
        {stat.prefix}{formatted}{stat.suffix}
      </span>
      <span className="text-xs text-slate-500 mt-1 leading-tight">{stat.label}</span>
    </motion.div>
  );
}

export default function LiveStatsTicker() {
  return (
    <div className="grid grid-cols-3 gap-6 pt-2">
      {STATS.map((stat, i) => (
        <Counter key={stat.label} stat={stat} index={i} />
      ))}
    </div>
  );
}

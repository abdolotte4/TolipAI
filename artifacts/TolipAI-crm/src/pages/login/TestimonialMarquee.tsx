import { motion } from "framer-motion";

const TESTIMONIALS_ROW1 = [
  {
    quote: "We went from 40 dials a day to 400. The power dialer alone paid for itself in the first week. I closed a $28k deal from a lead the AI qualified at 2am.",
    name: "Marcus T.",
    title: "Wholesaler · Phoenix, AZ",
    avatar: "M",
    color: "from-violet-500 to-fuchsia-500",
  },
  {
    quote: "The AI voice agent answers every inbound call and creates the lead automatically. My team wakes up to warm leads every morning without doing anything.",
    name: "Priya S.",
    title: "Real Estate Investor · Atlanta, GA",
    avatar: "P",
    color: "from-sky-500 to-cyan-500",
  },
  {
    quote: "Satellite property AI is insane. I can see roof condition before I drive out. Cut my field visits by 70% and stopped wasting gas on trash properties.",
    name: "DeShawn W.",
    title: "Wholesaler · Dallas, TX",
    avatar: "D",
    color: "from-emerald-500 to-teal-500",
  },
  {
    quote: "TolipAI's skip tracing pulls from 5 sources automatically. I'm reaching sellers other wholesalers can't even find. My list hit rate doubled.",
    name: "Angela R.",
    title: "Acquisitions Manager · Chicago, IL",
    avatar: "A",
    color: "from-orange-500 to-rose-500",
  },
  {
    quote: "The AI call coaching tells me exactly what offer to make and scores my conversation. I closed 3 deals last month because of the instant feedback.",
    name: "Tyler M.",
    title: "Wholesaler · Tampa, FL",
    avatar: "T",
    color: "from-amber-500 to-orange-500",
  },
  {
    quote: "I run 6 white-label campaigns for different clients. Each campaign has its own branding, its own Twilio number, its own AI agent. Clients think I built it myself.",
    name: "Sandra K.",
    title: "Wholesale Coaching Business Owner",
    avatar: "S",
    color: "from-pink-500 to-rose-500",
  },
];

const TESTIMONIALS_ROW2 = [
  {
    quote: "Browser dialer + headset = I call from my laptop anywhere. Closed a deal from my car in a Starbucks parking lot. No desk phone, no softphone setup.",
    name: "Jordan L.",
    title: "Wholesaler · Denver, CO",
    avatar: "J",
    color: "from-indigo-500 to-violet-500",
  },
  {
    quote: "The SMS auto-reply is insane. Sellers text back at 11pm, TolipAI responds with the right context, keeps them warm. I wake up to a scheduled appointment.",
    name: "Keisha B.",
    title: "Real Estate Investor · Memphis, TN",
    avatar: "K",
    color: "from-teal-500 to-emerald-500",
  },
  {
    quote: "Analytics show me exactly where leads drop off in my pipeline. I fixed one bottleneck and my conversion rate went from 4% to 11% in 30 days.",
    name: "Rafael G.",
    title: "Acquisitions Director · Houston, TX",
    avatar: "R",
    color: "from-rose-500 to-pink-500",
  },
  {
    quote: "The offline PWA works on my iPhone without signal. I'm driving rural routes, the app still loads, I can still see all my seller info. No other CRM does this.",
    name: "Chris H.",
    title: "Wholesaler · Rural Oklahoma",
    avatar: "C",
    color: "from-fuchsia-500 to-purple-500",
  },
  {
    quote: "Voicemail drop changed everything. I press one button, leave a professional voicemail, and move to the next call. 50+ voicemails an hour, zero fatigue.",
    name: "Natasha V.",
    title: "Wholesaler · Las Vegas, NV",
    avatar: "N",
    color: "from-cyan-500 to-blue-500",
  },
  {
    quote: "Distressed lead gen found me 400 pre-foreclosures in my county I didn't know about. I mailed all of them and got 12 callbacks in a week. Game changer.",
    name: "Damon F.",
    title: "Real Estate Investor · Detroit, MI",
    avatar: "D",
    color: "from-green-500 to-emerald-500",
  },
];

function TestimonialCard({ quote, name, title, avatar, color }: typeof TESTIMONIALS_ROW1[0]) {
  return (
    <div className="flex-shrink-0 w-80 mx-3 rounded-2xl border border-white/8 bg-white/[0.04] backdrop-blur-sm p-5 flex flex-col gap-3">
      <div className="flex gap-1">
        {[...Array(5)].map((_, i) => (
          <svg key={i} className="w-3.5 h-3.5 text-amber-400 fill-amber-400" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
          </svg>
        ))}
      </div>
      <p className="text-sm text-slate-300 leading-relaxed flex-1">"{quote}"</p>
      <div className="flex items-center gap-3 pt-2 border-t border-white/5">
        <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${color} flex items-center justify-center text-sm font-bold text-white shrink-0`}>
          {avatar}
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{name}</p>
          <p className="text-xs text-slate-500">{title}</p>
        </div>
      </div>
    </div>
  );
}

function MarqueeRow({ items, reverse = false, speed = 60 }: { items: typeof TESTIMONIALS_ROW1; reverse?: boolean; speed?: number }) {
  const doubled = [...items, ...items];
  const duration = items.length * speed;
  return (
    <div className="overflow-hidden w-full py-2">
      <div
        className="flex"
        style={{
          animation: `marquee-${reverse ? "reverse" : "forward"} ${duration}s linear infinite`,
        }}
      >
        {doubled.map((t, i) => (
          <TestimonialCard key={i} {...t} />
        ))}
      </div>
    </div>
  );
}

export default function TestimonialMarquee() {
  return (
    <section className="w-full py-20 relative overflow-hidden">
      {/* Section fade edges */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-slate-950 to-transparent z-10" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-40 bg-gradient-to-l from-slate-950 to-transparent z-10" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.4, duration: 0.6 }}
        className="text-center mb-10 px-4"
      >
        <span className="inline-flex items-center rounded-full bg-amber-500/10 border border-amber-500/20 px-3 py-1 text-xs font-medium text-amber-300 mb-4">
          ⭐ Real Results from Real Wholesalers
        </span>
        <h2 className="text-3xl font-bold text-white">What Our Users Are Closing</h2>
        <p className="text-slate-400 mt-2 text-sm max-w-lg mx-auto">
          Join hundreds of wholesalers already using TolipAI to close more deals with less effort.
        </p>
      </motion.div>

      <style>{`
        @keyframes marquee-forward {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes marquee-reverse {
          0%   { transform: translateX(-50%); }
          100% { transform: translateX(0); }
        }
      `}</style>

      <div className="space-y-4">
        <MarqueeRow items={TESTIMONIALS_ROW1} speed={55} />
        <MarqueeRow items={TESTIMONIALS_ROW2} reverse speed={65} />
      </div>
    </section>
  );
}

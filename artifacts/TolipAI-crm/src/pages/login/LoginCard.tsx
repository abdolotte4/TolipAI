import { motion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";

interface LoginCardProps {
  email: string;
  password: string;
  isPending: boolean;
  onEmailChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}

export default function LoginCard({
  email,
  password,
  isPending,
  onEmailChange,
  onPasswordChange,
  onSubmit,
}: LoginCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: "easeOut" }}
      className="relative w-full max-w-md"
    >
      {/* Glow halo */}
      <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-violet-500 to-fuchsia-500 opacity-20 blur-xl pointer-events-none" />

      <div className="relative rounded-2xl bg-slate-900/60 backdrop-blur-xl border border-white/10 p-8 shadow-2xl">
        {/* Logo mark */}
        <div className="mb-7 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white text-xl font-bold shadow-lg shadow-violet-500/30">
            T
          </div>
          <h2 className="text-2xl font-bold text-white">Welcome to TolipAI</h2>
          <p className="mt-1 text-sm text-slate-400">Sign in to your workspace</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Email</label>
            <input
              type="email"
              required
              placeholder="name@company.com"
              value={email}
              onChange={e => onEmailChange(e.target.value)}
              className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-white placeholder-slate-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none transition text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-slate-400 uppercase tracking-wider">Password</label>
            <input
              type="password"
              required
              placeholder="••••••••"
              value={password}
              onChange={e => onPasswordChange(e.target.value)}
              className="w-full rounded-lg bg-white/5 border border-white/10 px-4 py-3 text-white placeholder-slate-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none transition text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="mt-2 w-full flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-600 px-4 py-3 font-semibold text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:from-violet-400 hover:to-fuchsia-500 transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isPending ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Signing in…</>
            ) : (
              <>Sign In <ArrowRight className="w-4 h-4" /></>
            )}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-white/8 text-center">
          <p className="text-xs text-slate-500">
            Don't have an account?{" "}
            <span className="text-slate-400">Contact TolipAI LLC to get started.</span>
          </p>
          <div className="flex items-center justify-center gap-4 mt-2 text-xs text-slate-600">
            <a href="mailto:info@tolipai.com" className="hover:text-violet-400 transition-colors">
              info@tolipai.com
            </a>
            <span className="opacity-40">|</span>
            <a href="tel:3074882217" className="hover:text-violet-400 transition-colors">
              (307) 488-2217
            </a>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

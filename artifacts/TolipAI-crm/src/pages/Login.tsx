import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useCrmLogin } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import AuroraBackground from "./login/AuroraBackground";
import LoginCard from "./login/LoginCard";
import LiveStatsTicker from "./login/LiveStatsTicker";
import ComparisonMatrix from "./login/ComparisonMatrix";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const loginMutation = useCrmLogin();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(
      { data: { email, password } },
      {
        onSuccess: (data) => {
          localStorage.setItem("crm_token", data.token);
          if (data.user?.role === "super_admin") {
            setLocation("/campaigns");
          } else {
            setLocation("/");
          }
        },
        onError: (error: unknown) => {
          const message = error instanceof Error ? error.message : "Unknown error";
          toast({
            title: "Login Failed",
            description: message || "Please check your credentials and try again.",
            variant: "destructive",
          });
        },
      }
    );
  };

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <AuroraBackground />

      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Above the fold — hero + login card */}
        <div className="flex-1 flex items-center justify-center px-4 py-16 md:py-24">
          <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">

            {/* LEFT — Value proposition */}
            <div className="space-y-8 text-center lg:text-left">
              <div>
                <motion.span
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                  className="inline-flex items-center rounded-full bg-violet-500/10 border border-violet-500/20 px-3 py-1 text-xs font-medium text-violet-300 mb-5"
                >
                  ⚡ Now with AI Voice Agents
                </motion.span>

                <motion.h1
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1, duration: 0.55 }}
                  className="text-5xl md:text-6xl xl:text-7xl font-bold tracking-tight text-white leading-[1.08]"
                >
                  The First CRM That
                  <br />
                  <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-rose-400 bg-clip-text text-transparent">
                    Closes Deals
                  </span>
                  <br />
                  While You Sleep
                </motion.h1>

                <motion.p
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.22, duration: 0.5 }}
                  className="mt-6 text-lg text-slate-400 max-w-lg mx-auto lg:mx-0 leading-relaxed"
                >
                  AI voice agents answer your seller calls 24/7. Power dialers burn through lead lists in minutes. Satellite AI evaluates property condition before you drive. Everything else is just a spreadsheet with extra steps.
                </motion.p>
              </div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.34, duration: 0.45 }}
                className="flex gap-3 justify-center lg:justify-start flex-wrap"
              >
                <a
                  href="#features"
                  className="rounded-lg bg-white px-6 py-3 font-semibold text-slate-900 hover:bg-slate-100 transition text-sm shadow-lg"
                >
                  Watch Demo
                </a>
                <a
                  href="#features"
                  className="rounded-lg border border-white/10 bg-white/5 px-6 py-3 font-semibold text-white hover:bg-white/10 transition text-sm"
                >
                  See Features ↓
                </a>
              </motion.div>

              {/* Live counters */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5, duration: 0.5 }}
              >
                <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent mb-6" />
                <LiveStatsTicker />
              </motion.div>
            </div>

            {/* RIGHT — Login card */}
            <div className="flex justify-center lg:justify-end">
              <LoginCard
                email={email}
                password={password}
                isPending={loginMutation.isPending}
                onEmailChange={setEmail}
                onPasswordChange={setPassword}
                onSubmit={handleSubmit}
              />
            </div>
          </div>
        </div>

        {/* Below the fold — comparison matrix */}
        <div id="features" className="pb-24 px-4">
          <ComparisonMatrix />
        </div>
      </div>
    </div>
  );
}

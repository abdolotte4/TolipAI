import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import { useCrmLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Building2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

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
          // Super admins land on campaigns page; everyone else goes to dashboard
          if (data.user?.role === "super_admin") {
            setLocation("/campaigns");
          } else {
            setLocation("/");
          }
        },
        onError: (error: unknown) => {
          console.error("[CRM Login Error]", error);
          const message =
            error instanceof Error ? error.message : "Unknown error";
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
    <div className="min-h-screen w-full flex items-center justify-center bg-background relative overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 z-0">
        <img
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`}
          alt="Abstract background"
          className="w-full h-full object-cover opacity-60 mix-blend-screen"
        />
        <div className="absolute inset-0 bg-background/80 backdrop-blur-[2px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md z-10 px-4"
      >
        <Card className="glass-panel p-8 rounded-3xl">
          <div className="flex flex-col items-center mb-8 text-center">
            <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mb-4 border border-primary/30 shadow-[0_0_30px_rgba(99,102,241,0.3)]">
              <Building2 className="w-8 h-8 text-primary" />
            </div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">TolipAI Portal</h1>
            <p className="text-muted-foreground mt-2">Sign in to your workspace</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-muted-foreground">Email Address</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@company.com"
                required
                className="bg-background/50 border-white/10 h-12 text-base px-4 rounded-xl focus:border-primary focus:ring-primary/20 focus:bg-background transition-all"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-muted-foreground">Password</Label>
              <Input
                id="password"
                type="password"
                required
                className="bg-background/50 border-white/10 h-12 text-base px-4 rounded-xl focus:border-primary focus:ring-primary/20 focus:bg-background transition-all"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <Button
              type="submit"
              className="w-full h-12 rounded-xl bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-white shadow-lg shadow-primary/25 mt-4 text-base font-semibold"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Signing in..." : (
                <>Sign In <ArrowRight className="w-4 h-4 ml-2" /></>
              )}
            </Button>
          </form>

          <div className="mt-6 pt-5 border-t border-white/8 text-center">
            <p className="text-sm text-muted-foreground">
              Don't have an account?{" "}
              <span className="text-foreground/80">Contact TolipAI LLC to get started.</span>
            </p>
            <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted-foreground/70">
              <a href="mailto:info@tolipai.com" className="hover:text-primary transition-colors">
                info@tolipai.com
              </a>
              <span className="opacity-30">|</span>
              <a href="tel:5552014892" className="hover:text-primary transition-colors">
                (555) 201-4892
              </a>
            </div>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}

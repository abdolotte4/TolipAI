import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, Mail, ArrowRight, CheckCircle, BookOpen, LayoutGrid } from "lucide-react";

export function Hero() {
  const [email, setEmail] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  const scrollTo = (href: string) => {
    const element = document.querySelector(href);
    if (element) {
      element.scrollIntoView({ behavior: "smooth" });
    }
  };

  const handleEmailCapture = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || emailStatus === "loading") return;
    setEmailStatus("loading");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "", email, company: "", plan: "basic" }),
      });
      if (res.ok) {
        setEmailStatus("success");
        setEmail("");
      } else {
        setEmailStatus("error");
        setTimeout(() => setEmailStatus("idle"), 3000);
      }
    } catch {
      setEmailStatus("error");
      setTimeout(() => setEmailStatus("idle"), 3000);
    }
  };

  return (
    <section className="relative min-h-screen flex items-center justify-center pt-20 overflow-hidden">
      {/* Professional gradient background */}
      <div className="absolute inset-0 z-0 overflow-hidden">
        <div className="absolute inset-0 bg-background dark:bg-[#050810]" />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 60% at 50% -10%, rgba(212,175,55,0.18) 0%, transparent 70%)" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 60% 50% at -10% 110%, rgba(99,102,241,0.08) 0%, transparent 65%)" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 50% 40% at 110% 100%, rgba(212,175,55,0.08) 0%, transparent 60%)" }} />
        <svg className="absolute inset-0 w-full h-full opacity-[0.06] dark:opacity-[0.07]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <pattern id="dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="#d4af37" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dots)" />
        </svg>
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center flex flex-col items-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="max-w-4xl"
        >
          <span className="inline-block py-1 px-3 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm font-semibold tracking-wider uppercase mb-6">
            CRM Software & Workflow Automation
          </span>
          <h1 className="text-4xl sm:text-5xl md:text-7xl font-bold text-foreground leading-tight mb-6">
            Real Estate CRM Software &<br className="hidden md:block" />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-primary/60">
              Workflow Automation
            </span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            TolipAI provides AI workflow automation, CRM software, lead pipeline management, ARV calculators, comps analysis, and administrative operations tools for real estate professionals.
          </p>

          <div className="mb-8">
            <p className="text-muted-foreground mb-6">
              Request a guided product demo to see how TolipAI supports CRM workflows, lead pipeline management, and real estate analysis tools.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 flex-wrap">
              <Button
                size="lg"
                onClick={() => scrollTo("#contact")}
                className="w-full sm:w-auto bg-primary text-primary-foreground hover:bg-primary/90 h-14 px-8 rounded-full font-semibold text-base shadow-[0_0_20px_rgba(212,175,55,0.3)] hover:shadow-[0_0_30px_rgba(212,175,55,0.5)] transition-all"
              >
                Request a Demo
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => scrollTo("#services")}
                className="w-full sm:w-auto h-14 px-8 rounded-full font-semibold text-base border-border hover:bg-secondary transition-all"
              >
                <BookOpen className="mr-2 h-4 w-4" />
                View Features
              </Button>
              <Button
                size="lg"
                variant="outline"
                asChild
                className="w-full sm:w-auto h-14 px-8 rounded-full font-semibold text-base border-border hover:bg-secondary transition-all"
              >
                <a href="/pricing">
                  <LayoutGrid className="mr-2 h-4 w-4" />
                  Explore Platform
                </a>
              </Button>
            </div>
          </div>

          {/* Email Capture */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="max-w-md mx-auto"
          >
            {emailStatus === "success" ? (
              <div className="flex items-center justify-center gap-2 text-primary font-semibold py-3">
                <CheckCircle className="w-5 h-5" />
                You're on the list — we'll be in touch!
              </div>
            ) : (
              <form onSubmit={handleEmailCapture} className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="Enter your email to get early access"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-10 h-12 rounded-full bg-background/60 backdrop-blur border-border focus:border-primary"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={emailStatus === "loading"}
                  className="h-12 px-6 rounded-full bg-primary text-primary-foreground font-semibold whitespace-nowrap"
                >
                  {emailStatus === "loading" ? "..." : (
                    <>Get Access <ArrowRight className="ml-1 w-4 h-4" /></>
                  )}
                </Button>
              </form>
            )}
            {emailStatus === "error" && (
              <p className="text-red-400 text-sm mt-2 text-center">Something went wrong — please try again.</p>
            )}
            <p className="text-xs text-muted-foreground mt-2 text-center">No spam. Just platform updates and exclusive insights.</p>
          </motion.div>
        </motion.div>
      </div>

      <motion.div
        className="absolute bottom-10 left-1/2 -translate-x-1/2 cursor-pointer z-10"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 1 }}
        onClick={() => scrollTo("#services")}
      >
        <motion.div
          animate={{ y: [0, 10, 0] }}
          transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        >
          <ChevronDown className="w-8 h-8 text-muted-foreground hover:text-primary transition-colors" />
        </motion.div>
      </motion.div>
    </section>
  );
}

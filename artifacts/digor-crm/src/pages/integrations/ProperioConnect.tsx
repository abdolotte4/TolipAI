import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2,
  ExternalLink, RefreshCw, Trash2, Building2, Wifi, WifiOff, ShieldCheck,
} from "lucide-react";
import { apiRawFetch as apiFetch } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCrmGetMe } from "@workspace/api-client-react";


export default function ProperioConnect() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useCrmGetMe();
  const isAdmin = me?.role === "admin" || me?.role === "super_admin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [testing, setTesting] = useState(false);

  const { data: config, isLoading } = useQuery<any>({
    queryKey: ["propelio-config"],
    queryFn: () => apiFetch("/scraper-engine/integrations/propelio"),
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      apiFetch("/scraper-engine/integrations/propelio", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast({ title: "Propelio credentials saved", description: "Your Propelio login is now stored for this campaign." });
      setEmail("");
      setPassword("");
      qc.invalidateQueries({ queryKey: ["propelio-config"] });
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const invalidateMutation = useMutation({
    mutationFn: () => apiFetch("/scraper-engine/integrations/propelio/session", { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Session cleared", description: "Propelio will re-login on next scrape job." });
      qc.invalidateQueries({ queryKey: ["propelio-config"] });
    },
    onError: (err: Error) => toast({ title: "Clear failed", description: err.message, variant: "destructive" }),
  });

  async function handleTest() {
    setTesting(true);
    try {
      const result = await apiFetch("/scraper-engine/integrations/propelio/test", { method: "POST" });
      toast({ title: result.success ? "Login successful!" : "Login failed", description: result.success ? "Propelio credentials are working correctly." : (result.error || "Check your email and password."), variant: result.success ? "default" : "destructive" });
      qc.invalidateQueries({ queryKey: ["propelio-config"] });
    } catch (err: any) {
      toast({ title: "Test failed", description: err.message, variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  const configured = config?.configured;
  const sessionActive = config?.sessionActive;
  const emailMasked = config?.emailMasked;

  return (
    <div className="space-y-6 pb-20 w-full max-w-none">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <Building2 className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-2xl font-display font-bold">Propelio</h1>
              <p className="text-sm text-muted-foreground">Cash buyers, comps &amp; owner data</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <a href="https://propelio.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              Open Propelio <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      </motion.div>

      <Card className="rounded-2xl border-white/5 bg-card p-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : configured ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertCircle className="w-5 h-5 text-amber-400" />}
            <div>
              <p className="font-medium text-sm">{isLoading ? "Checking status…" : configured ? "Credentials configured" : "Not configured"}</p>
              {configured && emailMasked && <p className="text-xs text-muted-foreground mt-0.5">Account: {emailMasked}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {configured && <Badge variant="outline" className={sessionActive ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-secondary text-muted-foreground border-white/10"}>{sessionActive ? <><Wifi className="w-3 h-3 mr-1" /> Session active</> : <><WifiOff className="w-3 h-3 mr-1" /> No session</>}</Badge>}
            {isAdmin && configured && <Button variant="outline" size="sm" className="rounded-xl gap-1.5 border-white/10 text-xs h-7" onClick={handleTest} disabled={testing}>{testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} Test login</Button>}
            {isAdmin && configured && sessionActive && <Button variant="outline" size="sm" className="rounded-xl gap-1.5 border-white/10 text-xs h-7 hover:bg-amber-500/10 hover:border-amber-500/20 hover:text-amber-400" onClick={() => invalidateMutation.mutate()} disabled={invalidateMutation.isPending}>{invalidateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Reset session</Button>}
          </div>
        </div>
      </Card>

      <Card className="rounded-2xl border-white/5 bg-card overflow-hidden min-h-[88vh]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
            <div>
              <div className="font-semibold text-sm">Propelio CRM window</div>
              <div className="text-xs text-muted-foreground">This site blocks iframe embedding, so use the direct open link instead.</div>
            </div>
            <a href="https://propelio.com" target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              Pop out <ExternalLink className="w-3 h-3" />
            </a>
          </div>
          <div className="h-[calc(88vh-48px)] flex items-center justify-center p-6">
            <div className="max-w-md text-center space-y-3">
              <div className="text-sm font-medium">Embedded view unavailable</div>
              <p className="text-xs text-muted-foreground">
                Propelio blocks being loaded inside an iframe. Use the open link above, then save credentials here for scraper jobs.
              </p>
            </div>
          </div>
      </Card>

      {isAdmin && (
        <Card className="rounded-2xl border-white/5 bg-card p-6 space-y-5">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">{configured ? "Update credentials" : "Connect your account"}</h2>
          </div>
          <p className="text-xs text-muted-foreground">Enter your Propelio email and password. They are stored AES-256 encrypted and used only by the scraper engine to pull cash buyers and comps for your campaign.</p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Propelio Email</Label>
              <Input type="email" placeholder="you@example.com" className="bg-background/50 rounded-xl" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Propelio Password</Label>
              <div className="relative">
                <Input type={showPw ? "text" : "password"} placeholder="••••••••" className="bg-background/50 rounded-xl pr-10" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <Button className="w-full rounded-xl gap-2 shadow-lg shadow-primary/20" disabled={!email.trim() || !password.trim() || saveMutation.isPending} onClick={() => saveMutation.mutate({ email: email.trim(), password: password.trim() })}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            {configured ? "Update credentials" : "Save credentials"}
          </Button>
          {configured && <div className="pt-1 border-t border-white/5"><button className="text-xs text-destructive/70 hover:text-destructive flex items-center gap-1.5 mt-3" onClick={() => { if (confirm("Remove Propelio credentials for this campaign?")) saveMutation.mutate({ email: "", password: "" }); }}><Trash2 className="w-3 h-3" /> Remove credentials</button></div>}
        </Card>
      )}
    </div>
  );
}

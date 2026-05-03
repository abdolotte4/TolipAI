import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2,
  ExternalLink, RefreshCw, Trash2, Zap, Wifi, WifiOff, ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCrmGetMe } from "@workspace/api-client-react";

function apiFetch(path: string, options?: RequestInit) {
  const token = localStorage.getItem("crm_token");
  return fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  }).then(async (r) => {
    const json = await r.json();
    if (!r.ok) throw new Error(json?.error || `Request failed: ${r.status}`);
    return json;
  });
}

export default function PropwireConnect() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useCrmGetMe();
  const isAdmin = me?.role === "admin" || me?.role === "super_admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [testing, setTesting] = useState(false);

  const { data: config, isLoading } = useQuery<any>({
    queryKey: ["propwire-config"],
    queryFn: () => apiFetch("/scraper-engine/integrations/propwire"),
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      apiFetch("/scraper-engine/integrations/propwire", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast({ title: "Propwire credentials saved", description: "Your Propwire login is now stored for this campaign." });
      setEmail("");
      setPassword("");
      qc.invalidateQueries({ queryKey: ["propwire-config"] });
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const invalidateMutation = useMutation({
    mutationFn: () =>
      apiFetch("/scraper-engine/integrations/propwire/session", { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Session cleared", description: "Propwire will re-login on next scrape job." });
      qc.invalidateQueries({ queryKey: ["propwire-config"] });
    },
    onError: (err: Error) =>
      toast({ title: "Clear failed", description: err.message, variant: "destructive" }),
  });

  async function handleTest() {
    setTesting(true);
    try {
      const result = await apiFetch("/scraper-engine/integrations/propwire/test", { method: "POST" });
      if (result.success) {
        toast({ title: "Login successful!", description: "Propwire credentials are working correctly." });
      } else {
        toast({ title: "Login failed", description: result.error || "Check your email and password.", variant: "destructive" });
      }
      qc.invalidateQueries({ queryKey: ["propwire-config"] });
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
    <div className="space-y-6 pb-20 max-w-2xl">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
              <Zap className="w-6 h-6 text-sky-400" />
            </div>
            <div>
              <h1 className="text-2xl font-display font-bold">Propwire</h1>
              <p className="text-sm text-muted-foreground">Property data, history &amp; nearby investors</p>
            </div>
          </div>
          <a href="https://www.propwire.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            Open Propwire <ExternalLink className="w-3.5 h-3.5" />
          </a>
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
            {configured && (
              <Badge variant="outline" className={sessionActive ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-secondary text-muted-foreground border-white/10"}>
                {sessionActive ? <><Wifi className="w-3 h-3 mr-1" /> Session active</> : <><WifiOff className="w-3 h-3 mr-1" /> No session</>}
              </Badge>
            )}
            {isAdmin && configured && (
              <Button variant="outline" size="sm" className="rounded-xl gap-1.5 border-white/10 text-xs h-7" onClick={handleTest} disabled={testing}>
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                Test login
              </Button>
            )}
            {isAdmin && configured && sessionActive && (
              <Button variant="outline" size="sm" className="rounded-xl gap-1.5 border-white/10 text-xs h-7 hover:bg-amber-500/10 hover:border-amber-500/20 hover:text-amber-400" onClick={() => invalidateMutation.mutate()} disabled={invalidateMutation.isPending}>
                {invalidateMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Reset session
              </Button>
            )}
          </div>
        </div>
      </Card>

      {isAdmin && (
        <Card className="rounded-2xl border-white/5 bg-card p-6 space-y-5">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">{configured ? "Update credentials" : "Connect your account"}</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Enter your Propwire email and password. They are stored AES-256 encrypted and used only by the scraper engine to pull nearby investor data for your campaign.
          </p>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Propwire Email</Label>
              <Input type="email" placeholder="you@example.com" className="bg-background/50 rounded-xl" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Propwire Password</Label>
              <div className="relative">
                <Input type={showPw ? "text" : "password"} placeholder="••••••••" className="bg-background/50 rounded-xl pr-10" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <Button className="w-full rounded-xl gap-2 shadow-lg shadow-primary/20" disabled={!email.trim() || !password.trim() || saveMutation.isPending} onClick={() => saveMutation.mutate({ email: email.trim(), password: password.trim() })}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            {configured ? "Update credentials" : "Save credentials"}
          </Button>

          {configured && (
            <div className="pt-1 border-t border-white/5">
              <button className="text-xs text-destructive/70 hover:text-destructive flex items-center gap-1.5 mt-3" onClick={() => { if (confirm("Remove Propwire credentials for this campaign?")) saveMutation.mutate({ email: "", password: "" }); }}>
                <Trash2 className="w-3 h-3" /> Remove credentials
              </button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

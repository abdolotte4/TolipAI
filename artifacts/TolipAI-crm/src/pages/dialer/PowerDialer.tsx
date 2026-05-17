import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, PhoneCall, PhoneOff, PhoneMissed, SkipForward,
  Play, Square, ArrowLeft, Loader2, CheckCircle2, AlertCircle,
  VolumeX, Calendar, User, MapPin, DollarSign, Clock, BarChart2,
  ChevronRight, RefreshCw, Voicemail, Layers, Zap,
} from "lucide-react";
import { apiRawFetch as apiFetch } from "@/lib/api";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCrmGetMe } from "@workspace/api-client-react";

type Disposition = "answered" | "no_answer" | "voicemail" | "dnc" | "callback" | "skip";

const DISPOSITION_BUTTONS: {
  value: Disposition;
  label: string;
  icon: any;
  color: string;
}[] = [
  { value: "answered",  label: "Answered",   icon: PhoneCall,   color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20" },
  { value: "no_answer", label: "No Answer",  icon: PhoneMissed, color: "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20" },
  { value: "voicemail", label: "Voicemail",  icon: Voicemail,   color: "bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/20" },
  { value: "callback",  label: "Callback",   icon: Calendar,    color: "bg-purple-500/10 text-purple-400 border-purple-500/30 hover:bg-purple-500/20" },
  { value: "dnc",       label: "Do Not Call", icon: VolumeX,    color: "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20" },
  { value: "skip",      label: "Skip",        icon: SkipForward, color: "bg-secondary text-muted-foreground border-white/10 hover:bg-secondary/80" },
];

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-xl font-bold ${color}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
    </div>
  );
}

export default function PowerDialer() {
  const { toast } = useToast();
  const { data: me } = useCrmGetMe();

  const [agentPhone, setAgentPhone] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>(["new", "contacted", "follow_up"]);
  const [lines, setLines] = useState(1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [disposingId, setDisposingId] = useState<Disposition | null>(null);

  const { data: session, isLoading: sessionLoading, refetch: refetchSession } = useQuery<any>({
    queryKey: ["power-dial-session", sessionId],
    queryFn: () => apiFetch(`/twilio/voice/power-dial/session/${sessionId}`),
    enabled: !!sessionId,
    refetchInterval: sessionId ? 5000 : false,
  });

  const startMutation = useMutation({
    mutationFn: () => apiFetch("/twilio/voice/power-dial/session", {
      method: "POST",
      body: JSON.stringify({
        agentPhone,
        filters: { status: statusFilter },
        lines,
      }),
    }),
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      toast({ title: `Power Session started — ${data.total} leads queued` });
    },
    onError: (err: Error) =>
      toast({ title: "Failed to start session", description: err.message, variant: "destructive" }),
  });

  const callMutation = useMutation({
    mutationFn: () => apiFetch(`/twilio/voice/power-dial/session/${sessionId}/call`, { method: "POST" }),
    onMutate: () => setCalling(true),
    onSettled: () => setCalling(false),
    onSuccess: (data) => {
      toast({ title: `Calling ${data.leadPhone}`, description: "Your phone will ring first, then the lead." });
      refetchSession();
    },
    onError: (err: Error) =>
      toast({ title: "Call failed", description: err.message, variant: "destructive" }),
  });

  const disposeMutation = useMutation({
    mutationFn: (disposition: Disposition) =>
      apiFetch(`/twilio/voice/power-dial/session/${sessionId}/disposition`, {
        method: "POST",
        body: JSON.stringify({ disposition }),
      }),
    onMutate: (d) => setDisposingId(d),
    onSettled: () => setDisposingId(null),
    onSuccess: (data) => {
      if (data.done) {
        toast({ title: "Session complete!", description: `All ${data.stats?.total} leads have been dialed.` });
      }
      refetchSession();
    },
    onError: (err: Error) =>
      toast({ title: "Disposition failed", description: err.message, variant: "destructive" }),
  });

  const endMutation = useMutation({
    mutationFn: () => apiFetch(`/twilio/voice/power-dial/session/${sessionId}`, { method: "DELETE" }),
    onSuccess: () => {
      setSessionId(null);
      toast({ title: "Session ended" });
    },
  });

  const toggleStatus = (s: string) =>
    setStatusFilter((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );

  const done = session && session.currentIndex >= session.total;
  const currentLead = session?.currentLead;

  // ── Setup screen ─────────────────────────────────────────────────────────────
  if (!sessionId) {
    return (
      <div className="space-y-6 pb-20 max-w-2xl">
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="rounded-xl border border-white/10 bg-card hover:bg-secondary">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-display font-bold flex items-center gap-2">
              <Phone className="w-6 h-6 text-primary" />
              Power Dialer
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              Auto-dial leads one by one — bridge on answer, skip on no-answer.
            </p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
            <div className="p-5 border-b border-border bg-secondary/20">
              <h2 className="font-semibold">Session Setup</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Configure who to call and where to reach you.
              </p>
            </div>
            <div className="p-5 space-y-5">
              <div className="space-y-2">
                <Label>Your Phone Number</Label>
                <Input
                  className="bg-background/50 rounded-xl font-mono"
                  placeholder="+15551234567"
                  value={agentPhone}
                  onChange={e => setAgentPhone(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Twilio will call <strong>this number</strong> first. When you answer, it bridges to the lead.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Lead Status Filter</Label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: "new", label: "New" },
                    { value: "contacted", label: "Contacted" },
                    { value: "follow_up", label: "Follow Up" },
                    { value: "negotiating", label: "Negotiating" },
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => toggleStatus(value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                        statusFilter.includes(value)
                          ? "bg-primary/10 text-primary border-primary/30"
                          : "bg-secondary text-muted-foreground border-white/10 hover:bg-secondary/80"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Only leads with a phone number will be dialed (up to 200 per session).
                </p>
              </div>

              {/* Simultaneous Lines Selector */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                  Simultaneous Lines
                  {lines > 1 && (
                    <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded px-1.5 py-0.5 font-normal flex items-center gap-1">
                      <Zap className="w-2.5 h-2.5" /> Power Mode
                    </span>
                  )}
                </Label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      onClick={() => setLines(n)}
                      className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                        lines === n
                          ? n === 1
                            ? "bg-primary/10 text-primary border-primary/30"
                            : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                          : "bg-secondary text-muted-foreground border-white/10 hover:bg-secondary/80"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {lines === 1
                    ? "Single-line mode: dials one lead at a time."
                    : `Multi-line mode: dials ${lines} leads simultaneously. First to answer connects — the rest hang up automatically.`}
                </p>
              </div>

              <Button
                className="w-full gap-2"
                disabled={!agentPhone || statusFilter.length === 0 || startMutation.isPending}
                onClick={() => startMutation.mutate()}
              >
                {startMutation.isPending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : lines > 1 ? <Zap className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {lines > 1 ? `Start ${lines}-Line Power Session` : "Start Power Session"}
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (sessionLoading && !session) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Session complete ──────────────────────────────────────────────────────────
  if (done || session?.status === "done") {
    const stats = session?.stats;
    return (
      <div className="space-y-6 pb-20 max-w-2xl">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
          <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
            <div className="p-8 text-center space-y-4">
              <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto" />
              <h2 className="text-2xl font-display font-bold">Session Complete</h2>
              <p className="text-muted-foreground">You've dialed through all {stats?.total} leads in this session.</p>
              {stats && (
                <div className="grid grid-cols-5 gap-4 mt-6 pt-6 border-t border-border">
                  <StatBadge label="Total" value={stats.total} color="text-foreground" />
                  <StatBadge label="Answered" value={stats.answered} color="text-emerald-400" />
                  <StatBadge label="Voicemail" value={stats.voicemail} color="text-blue-400" />
                  <StatBadge label="No Answer" value={stats.noAnswer} color="text-amber-400" />
                  <StatBadge label="Callbacks" value={stats.callback} color="text-purple-400" />
                </div>
              )}
              <Button className="mt-4" onClick={() => setSessionId(null)}>
                Start New Session
              </Button>
            </div>
          </Card>
        </motion.div>
      </div>
    );
  }

  const stats = session?.stats;
  const progress = session ? Math.round((session.currentIndex / session.total) * 100) : 0;

  return (
    <div className="space-y-4 pb-20 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-xl border border-white/10 bg-card hover:bg-secondary"
            onClick={() => { if (confirm("End this power dial session?")) endMutation.mutate(); }}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-display font-bold flex items-center gap-2">
              <Phone className="w-5 h-5 text-primary" /> Power Dialer
              {session?.lines > 1 && (
                <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full px-2 py-0.5 font-normal flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" /> {session.lines}-Line
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">
              Lead {(session?.currentIndex ?? 0) + 1} of {session?.total ?? "…"}
              {session?.lines > 1 ? ` · ${session.lines} simultaneous lines` : ""}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs h-8"
          onClick={() => { if (confirm("End this power dial session?")) endMutation.mutate(); }}
          disabled={endMutation.isPending}
        >
          <Square className="w-3.5 h-3.5" /> End Session
        </Button>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      {/* Stats bar */}
      {stats && (
        <Card className="rounded-xl border-white/5 bg-card p-4">
          <div className="grid grid-cols-5 gap-4 text-center">
            <StatBadge label="Called" value={stats.called} color="text-foreground" />
            <StatBadge label="Answered" value={stats.answered} color="text-emerald-400" />
            <StatBadge label="Voicemail" value={stats.voicemail} color="text-blue-400" />
            <StatBadge label="No Answer" value={stats.noAnswer} color="text-amber-400" />
            <StatBadge label="Callbacks" value={stats.callback} color="text-purple-400" />
          </div>
        </Card>
      )}

      {/* Current Lead */}
      <AnimatePresence mode="wait">
        {currentLead ? (
          <motion.div
            key={currentLead.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
              <div className="p-5 border-b border-border bg-secondary/20 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">{currentLead.sellerName}</p>
                    <p className="text-xs text-muted-foreground font-mono">{currentLead.phone || "No phone"}</p>
                  </div>
                </div>
                <Badge className="bg-secondary text-muted-foreground border-white/10 border text-xs capitalize">
                  {currentLead.status}
                </Badge>
              </div>

              <div className="p-5 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {currentLead.address && (
                    <div className="flex items-start gap-2 col-span-2">
                      <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <span className="text-foreground">
                        {currentLead.address}{currentLead.city ? `, ${currentLead.city}` : ""}
                        {currentLead.state ? `, ${currentLead.state}` : ""}
                      </span>
                    </div>
                  )}
                  {currentLead.askingPrice && (
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-muted-foreground" />
                      <span>Asking: ${Number(currentLead.askingPrice).toLocaleString()}</span>
                    </div>
                  )}
                  {currentLead.howSoon && (
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span>Timeline: {currentLead.howSoon}</span>
                    </div>
                  )}
                  {currentLead.reasonForSelling && (
                    <div className="flex items-start gap-2 col-span-2">
                      <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <span className="text-muted-foreground">{currentLead.reasonForSelling}</span>
                    </div>
                  )}
                </div>

                {!session?.currentCallSid ? (
                  <Button
                    className="w-full gap-2 mt-2"
                    disabled={calling || !currentLead.phone}
                    onClick={() => callMutation.mutate()}
                  >
                    {calling
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <PhoneCall className="w-4 h-4" />}
                    {currentLead.phone ? "Call Now" : "No Phone — Skip"}
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Call in progress · SID: <span className="font-mono text-xs">{session.currentCallSid.slice(-8)}</span>
                  </div>
                )}
              </div>
            </Card>
          </motion.div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <Card className="rounded-2xl border-white/5 bg-card p-8 text-center">
              <RefreshCw className="w-8 h-8 text-muted-foreground mx-auto mb-3 animate-spin" />
              <p className="text-muted-foreground text-sm">Loading next lead…</p>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Disposition buttons */}
      {currentLead && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
            <div className="p-4 border-b border-border bg-secondary/10">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Log Result & Move to Next</p>
            </div>
            <div className="p-4 grid grid-cols-3 gap-2">
              {DISPOSITION_BUTTONS.map(({ value, label, icon: Icon, color }) => (
                <Button
                  key={value}
                  variant="outline"
                  className={`gap-1.5 h-10 text-xs font-medium border ${color}`}
                  disabled={!!disposingId}
                  onClick={() => disposeMutation.mutate(value)}
                >
                  {disposingId === value
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : <Icon className="w-3.5 h-3.5" />}
                  {label}
                </Button>
              ))}
            </div>
          </Card>
        </motion.div>
      )}

      {/* Disposition history */}
      {session?.dispositions?.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
            <div className="p-4 border-b border-border bg-secondary/10">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Call History ({session.dispositions.length})
              </p>
            </div>
            <div className="divide-y divide-border max-h-48 overflow-y-auto">
              {[...session.dispositions].reverse().map((d: any, i: number) => (
                <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{d.leadName}</p>
                    <p className="text-xs text-muted-foreground truncate">{d.leadPhone}</p>
                  </div>
                  <Badge className={`text-[10px] shrink-0 ${
                    d.disposition === "answered" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                    d.disposition === "voicemail" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
                    d.disposition === "callback" ? "bg-purple-500/10 text-purple-400 border-purple-500/30" :
                    d.disposition === "dnc" ? "bg-red-500/10 text-red-400 border-red-500/30" :
                    "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  } border`}>
                    {d.disposition.replace("_", " ")}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

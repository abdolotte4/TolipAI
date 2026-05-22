import { useState, useCallback, useRef, useEffect } from "react";
import {
  PhoneOff, PhoneCall, Mic, MicOff, Loader2,
  Signal, AlertCircle, CheckCircle2, Activity, Wifi, Sparkles, Voicemail, PauseCircle,
  PhoneForwarded, X, Hash, ClipboardList, BookmarkPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { usePhone } from "@/contexts/PhoneContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrowserDialerProps {
  leadPhone: string | null | undefined;
  leadId?: number | null;
  leadName?: string;
  onCallLogged?: (callSid: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function qualityColor(mos: number | null): string {
  if (mos === null) return "text-muted-foreground";
  if (mos >= 4.0) return "text-emerald-400";
  if (mos >= 3.5) return "text-yellow-400";
  return "text-red-400";
}

function qualityLabel(mos: number | null): string {
  if (mos === null) return "—";
  if (mos >= 4.0) return "Excellent";
  if (mos >= 3.5) return "Good";
  if (mos >= 3.0) return "Fair";
  return "Poor";
}

function authFetch(path: string, options?: RequestInit) {
  const token = localStorage.getItem("crm_token");
  return fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options?.headers || {}),
    },
  }).then(async (r) => {
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((json as any)?.error || `HTTP ${r.status}`);
    return json;
  });
}

const DTMF_KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function BrowserDialer({ leadPhone, leadId, leadName, onCallLogged }: BrowserDialerProps) {
  const { toast } = useToast();
  const phone = usePhone();

  const coachingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const [record, setRecord] = useState(true);
  const [lastCallSid, setLastCallSid] = useState<string | null>(null);
  const [lastCallRecorded, setLastCallRecorded] = useState(false);
  const [disposition, setDisposition] = useState<string | null>(null);
  const [dispositionSaved, setDispositionSaved] = useState(false);
  const [coaching, setCoaching] = useState<any | null>(null);
  const [coachingLoading, setCoachingLoading] = useState(false);
  const [showCoaching, setShowCoaching] = useState(false);
  const [coachingCountdown, setCoachingCountdown] = useState<number | null>(null);
  const [summary, setSummary] = useState<any | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [droppingVoicemail, setDroppingVoicemail] = useState(false);
  const [showDTMF, setShowDTMF] = useState(false);
  const [summarySaved, setSummarySaved] = useState(false);

  const [transferOpen, setTransferOpen] = useState(false);
  const [transferNumber, setTransferNumber] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [transferActive, setTransferActive] = useState(false);

  const status = phone.status;
  const isActive = status === "calling" || status === "in-progress" || status === "disconnecting";
  const canCall = !!leadPhone && (status === "idle" || status === "ready" || status === "error");

  // ── Auto-scroll transcript to bottom on new segments ──────────────────────
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [phone.liveTranscript]);

  // ── Auto-fetch AI coaching ─────────────────────────────────────────────────
  const autoFetchCoaching = useCallback(async (sid: string) => {
    const WAIT_SECONDS = 90;
    let remaining = WAIT_SECONDS;
    setCoachingCountdown(remaining);

    const tick = setInterval(() => {
      remaining -= 1;
      setCoachingCountdown(remaining);
      if (remaining <= 0) clearInterval(tick);
    }, 1000);

    coachingTimerRef.current = setTimeout(async () => {
      clearInterval(tick);
      setCoachingCountdown(null);
      setCoachingLoading(true);
      try {
        const data = await authFetch("/twilio/voice/coach", {
          method: "POST",
          body: JSON.stringify({ callSid: sid }),
        });
        setCoaching(data.coaching);
        setShowCoaching(true);
      } catch { }
      finally { setCoachingLoading(false); }
    }, WAIT_SECONDS * 1000);
  }, []);

  // ── Start call ─────────────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
    if (!leadPhone) return;

    setDisposition(null);
    setDispositionSaved(false);
    setCoaching(null);
    setShowCoaching(false);
    setCoachingCountdown(null);
    setTransferActive(false);
    setLastCallSid(null);
    setSummary(null);
    setSummaryLoading(false);
    setSummarySaved(false);

    try {
      await phone.startCall(leadPhone, leadId ?? null, leadName || "Unknown", record);
      // Track last call sid once available
      const checkSid = setInterval(() => {
        if (phone.currentCallSid) {
          setLastCallSid(phone.currentCallSid);
          setLastCallRecorded(record);
          if (onCallLogged) onCallLogged(phone.currentCallSid);
          clearInterval(checkSid);
        }
      }, 200);
      // Clear interval after 10s regardless
      setTimeout(() => clearInterval(checkSid), 10000);
    } catch (err: any) {
      toast({ title: "Failed to start call", description: err.message, variant: "destructive" });
    }
  }, [leadPhone, leadId, leadName, record, phone, onCallLogged, toast]);

  // ── Save disposition ───────────────────────────────────────────────────────
  const saveDisposition = useCallback(async (d: string) => {
    setDisposition(d);
    const sid = lastCallSid || phone.currentCallSid;
    if (sid) {
      try {
        await authFetch(`/twilio/voice/log/${sid}`, {
          method: "PATCH",
          body: JSON.stringify({ disposition: d }),
        });
        setDispositionSaved(true);
      } catch { }
    }
  }, [lastCallSid, phone.currentCallSid]);

  // ── Manual AI coaching ─────────────────────────────────────────────────────
  const getCoaching = useCallback(async () => {
    const sid = lastCallSid;
    if (!sid) return;
    if (coachingTimerRef.current) { clearTimeout(coachingTimerRef.current); coachingTimerRef.current = null; }
    setCoachingCountdown(null);
    setCoachingLoading(true);
    setCoaching(null);
    try {
      const data = await authFetch("/twilio/voice/coach", {
        method: "POST",
        body: JSON.stringify({ callSid: sid }),
      });
      setCoaching(data.coaching);
      setShowCoaching(true);
    } catch (err: any) {
      toast({ title: "AI Coaching unavailable", description: err.message, variant: "destructive" });
    } finally {
      setCoachingLoading(false);
    }
  }, [lastCallSid, toast]);

  // ── Voicemail drop ─────────────────────────────────────────────────────────
  const dropVoicemail = useCallback(async () => {
    const sid = phone.currentCallSid;
    if (!sid) { toast({ title: "No active call SID", variant: "destructive" }); return; }
    setDroppingVoicemail(true);
    try {
      await authFetch("/twilio/voice/voicemail-drop", {
        method: "POST",
        body: JSON.stringify({ callSid: sid }),
      });
      toast({ title: "Voicemail dropped", description: "Message is playing. You can move to the next lead." });
      phone.hangUp();
    } catch (err: any) {
      toast({ title: "Voicemail drop failed", description: err.message, variant: "destructive" });
    } finally {
      setDroppingVoicemail(false);
    }
  }, [phone, toast]);

  // ── Warm transfer ──────────────────────────────────────────────────────────
  const initiateWarmTransfer = useCallback(async () => {
    const callSid = phone.currentCallSid;
    if (!callSid || !transferNumber.trim()) return;
    setTransferring(true);
    try {
      await authFetch("/twilio/voice/warm-transfer", {
        method: "POST",
        body: JSON.stringify({ callSid, transferTo: transferNumber.trim() }),
      });
      setTransferActive(true);
      setTransferOpen(false);
      setTransferNumber("");
      toast({ title: "Warm transfer initiated", description: `Connecting to ${transferNumber.trim()}…` });
    } catch (err: any) {
      toast({ title: "Transfer failed", description: err.message, variant: "destructive" });
    } finally {
      setTransferring(false);
    }
  }, [transferNumber, phone.currentCallSid, toast]);

  const completeTransfer = useCallback(async () => {
    const callSid = phone.currentCallSid;
    if (!callSid) { phone.hangUp(); return; }
    try {
      await authFetch("/twilio/voice/complete-transfer", { method: "POST", body: JSON.stringify({ callSid }) });
      toast({ title: "Transfer complete", description: "You have left the conference." });
    } catch {
      phone.hangUp();
    }
    setTransferActive(false);
  }, [phone, toast]);

  // ── Save call summary to lead notes ────────────────────────────────────────
  const saveToLead = useCallback(async () => {
    if (!summary || !leadId) return;
    const parts: string[] = [];
    if (summary.sellerSituation) parts.push(`**Situation:** ${summary.sellerSituation}`);
    if (Array.isArray(summary.keyPoints) && summary.keyPoints.length > 0) {
      parts.push(`**Key Points:**\n${(summary.keyPoints as string[]).map((p) => `• ${p}`).join("\n")}`);
    }
    if (summary.nextStep) parts.push(`**Recommended Next Step:** ${summary.nextStep}`);
    if (summary.motivationLabel) parts.push(`**Motivation:** ${summary.motivationLabel} (${summary.motivationScore}/10)`);
    const content = `📞 Call Summary\n\n${parts.join("\n\n")}`;
    try {
      await authFetch(`/crm/leads/${leadId}/notes`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setSummarySaved(true);
      toast({ title: "Saved to lead notes" });
    } catch (err: any) {
      toast({ title: "Failed to save note", description: err.message, variant: "destructive" });
    }
  }, [summary, leadId, toast]);

  // ── Fetch post-call AI summary ──────────────────────────────────────────────
  const fetchSummary = useCallback(async (liveText: string, sid?: string | null) => {
    if (!liveText.trim() && !sid) return;
    setSummaryLoading(true);
    setSummary(null);
    try {
      const data = await authFetch("/twilio/voice/call-summary", {
        method: "POST",
        body: JSON.stringify({
          callSid: sid ?? undefined,
          transcript: liveText.trim() || undefined,
          leadId: leadId ?? undefined,
        }),
      });
      setSummary(data.summary);
    } catch { }
    finally { setSummaryLoading(false); }
  }, [leadId]);

  // ── Track when call ends for coaching + summary ─────────────────────────────
  const prevStatus = useRef(status);
  if (prevStatus.current !== status) {
    if (prevStatus.current === "in-progress" && status === "idle") {
      if (lastCallRecorded && lastCallSid) {
        autoFetchCoaching(lastCallSid);
      }
      // Fetch summary from live transcript immediately (no wait)
      const liveText = phone.liveTranscript.map(s => s.text).join(" ");
      fetchSummary(liveText, lastCallSid);
    }
    prevStatus.current = status;
  }

  return (
    <div className="rounded-2xl border border-white/5 bg-card overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-secondary/20 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            status === "in-progress" ? "bg-emerald-400 animate-pulse" :
            status === "ready" ? "bg-emerald-400" :
            status === "calling" ? "bg-blue-400 animate-pulse" :
            status === "error" ? "bg-red-400" : "bg-muted-foreground/40"
          }`} />
          <span className="text-sm font-semibold">Browser Dialer</span>
          <Badge className={`text-[10px] border ${
            status === "in-progress" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
            status === "calling" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
            status === "ready" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
            status === "initializing" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
            status === "error" ? "bg-red-500/10 text-red-400 border-red-500/30" :
            "bg-secondary text-muted-foreground border-white/10"
          }`}>
            {status === "idle" ? "Off" :
             status === "initializing" ? "Starting…" :
             status === "ready" ? "Ready" :
             status === "calling" ? "Calling…" :
             status === "in-progress" ? (transferActive ? "In conference" : "In call") :
             status === "disconnecting" ? "Ending…" : "Error"}
          </Badge>
          {transferActive && (
            <Badge className="text-[10px] border bg-violet-500/10 text-violet-400 border-violet-500/30 animate-pulse">
              Transfer Active
            </Badge>
          )}
        </div>
        {leadPhone && <span className="text-xs font-mono text-muted-foreground">{leadPhone}</span>}
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* No phone number */}
        {!leadPhone && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Add a phone number to this lead to enable in-browser calling.
          </div>
        )}

        {/* No caller ID */}
        {status === "ready" && !phone.callerIdUsed && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">No outbound phone number configured</p>
              <p className="mt-0.5 text-amber-400/80">Add a Twilio Phone Number in campaign settings.</p>
              <a href="/integrations/twilio" className="underline mt-1 inline-block">Add phone number →</a>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && phone.errorMsg && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Connection error</p>
              <p className="mt-0.5 text-red-400/80">{phone.errorMsg}</p>
              <a href="/integrations/twilio" className="underline mt-1 inline-block">Configure Voice credentials →</a>
            </div>
          </div>
        )}

        {/* In-call panel */}
        {isActive && (
          <div className="rounded-xl bg-secondary/30 border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-mono font-semibold">
                <div className={`w-2 h-2 rounded-full ${phone.held ? "bg-amber-400 animate-pulse" : "bg-emerald-400 animate-pulse"}`} />
                {fmtDuration(phone.duration)}
                {phone.held && (
                  <Badge className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse ml-1">
                    On Hold
                  </Badge>
                )}
              </div>
              {status === "in-progress" && !phone.held && (
                <div className={`text-xs font-medium ${qualityColor(phone.analytics.mos)}`}>
                  {qualityLabel(phone.analytics.mos)}
                  {phone.analytics.mos !== null && (
                    <span className="ml-1 opacity-70">({phone.analytics.mos.toFixed(1)} MOS)</span>
                  )}
                </div>
              )}
            </div>

            {status === "in-progress" && (
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: "MOS", value: phone.analytics.mos?.toFixed(2) ?? "—", icon: Signal },
                  { label: "Jitter", value: phone.analytics.jitter != null ? `${phone.analytics.jitter}ms` : "—", icon: Activity },
                  { label: "Pkt Loss", value: phone.analytics.packetLoss != null ? `${phone.analytics.packetLoss}%` : "—", icon: Wifi },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="bg-background/40 rounded-lg p-2">
                    <Icon className="w-3 h-3 mx-auto mb-1 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-xs font-mono font-medium">{value}</p>
                  </div>
                ))}
              </div>
            )}

            {transferActive && (
              <div className="flex items-center gap-2 p-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-xs text-violet-300">
                <PhoneForwarded className="w-3.5 h-3.5 shrink-0" />
                <div>
                  <span className="font-medium">Conference active</span>
                  <span className="text-violet-400/70 ml-1">— Lead + Transfer target connected</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Live AI Coaching Suggestion Panel */}
        {isActive && phone.aiSuggestion && (
          <div className="rounded-xl bg-violet-500/5 border border-violet-500/20 p-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-violet-400 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 animate-pulse" /> Live AI Coaching
              </p>
              <button
                onClick={phone.clearAiSuggestion}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Dismiss"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs text-foreground/90 leading-relaxed">{phone.aiSuggestion}</p>
          </div>
        )}

        {/* Live Transcript — dual-speaker bubbles */}
        {isActive && phone.liveTranscript.length > 0 && (
          <div className="rounded-xl bg-secondary/20 border border-border overflow-hidden">
            <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Live Transcript</p>
            </div>
            <div
              ref={transcriptRef}
              className="p-2.5 space-y-2 max-h-40 overflow-y-auto"
            >
              {phone.liveTranscript.map((seg, i) => {
                const isAgent = seg.track === "outbound";
                return (
                  <div key={i} className={`flex gap-1.5 ${isAgent ? "flex-row-reverse" : "flex-row"}`}>
                    <div className={`px-2.5 py-1.5 rounded-2xl text-xs max-w-[85%] leading-relaxed ${
                      isAgent
                        ? "bg-primary/15 text-foreground/90 rounded-tr-sm"
                        : "bg-background/70 border border-border text-foreground/85 rounded-tl-sm"
                    }`}>
                      <span className={`block text-[9px] font-semibold mb-0.5 ${isAgent ? "text-primary/70" : "text-muted-foreground"}`}>
                        {isAgent ? "You" : "Seller"}
                      </span>
                      {seg.text}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* DTMF Keypad */}
        {isActive && showDTMF && (
          <div className="rounded-xl bg-secondary/20 border border-border p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5" /> Keypad
              </p>
              <button onClick={() => setShowDTMF(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {DTMF_KEYS.flat().map((key) => (
                <button
                  key={key}
                  onMouseDown={(e) => { e.preventDefault(); phone.sendDTMF(key); }}
                  className="h-10 rounded-xl text-sm font-semibold bg-background/50 hover:bg-secondary border border-white/5 hover:border-white/15 transition-colors active:scale-95"
                >
                  {key}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Warm Transfer Input */}
        {transferOpen && status === "in-progress" && (
          <div className="rounded-xl bg-violet-500/5 border border-violet-500/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-violet-400 flex items-center gap-1.5">
                <PhoneForwarded className="w-3 h-3" /> Warm Transfer
              </p>
              <button onClick={() => setTransferOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">Lead will be placed on hold. You'll speak with the second party first, then bridge them together.</p>
            <div className="flex gap-2">
              <Input
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={transferNumber}
                onChange={(e) => setTransferNumber(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && transferNumber.trim()) initiateWarmTransfer(); }}
                className="bg-background/60 border-violet-500/30 text-sm h-8 rounded-lg"
                autoFocus
              />
              <Button
                size="sm"
                className="h-8 bg-violet-600 hover:bg-violet-700 text-white text-xs px-3 shrink-0"
                disabled={!transferNumber.trim() || transferring}
                onClick={initiateWarmTransfer}
              >
                {transferring ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Connect"}
              </Button>
            </div>
          </div>
        )}

        {/* Post-call quality */}
        {status === "idle" && (phone.lastAnalytics.mos !== null || phone.lastAnalytics.jitter !== null) && (
          <div className="rounded-xl bg-secondary/20 border border-border p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Last call quality
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "MOS", value: phone.lastAnalytics.mos?.toFixed(2) ?? "—" },
                { label: "Jitter", value: phone.lastAnalytics.jitter != null ? `${phone.lastAnalytics.jitter}ms` : "—" },
                { label: "Pkt Loss", value: phone.lastAnalytics.packetLoss != null ? `${phone.lastAnalytics.packetLoss}%` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-background/40 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="text-xs font-mono font-medium">{value}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Post-call AI Summary */}
        {status === "idle" && lastCallSid && summaryLoading && (
          <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/15 p-3 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
            <p className="text-xs text-emerald-400">Generating call summary…</p>
          </div>
        )}

        {status === "idle" && lastCallSid && summary && (
          <div className="rounded-xl bg-gradient-to-br from-emerald-500/5 to-cyan-500/5 border border-emerald-500/20 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                <ClipboardList className="w-3 h-3" /> Call Summary
              </p>
              {summary.motivationScore != null && (
                <Badge className={`text-[10px] border ${
                  summary.motivationScore >= 9 ? "bg-red-500/10 text-red-400 border-red-500/20" :
                  summary.motivationScore >= 7 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                  summary.motivationScore >= 5 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                  "bg-blue-500/10 text-blue-400 border-blue-500/20"
                }`}>
                  {summary.motivationScore >= 9 ? "🔥" : summary.motivationScore >= 7 ? "✅" : summary.motivationScore >= 5 ? "⚡" : "❄️"}
                  {" "}{summary.motivationLabel ?? `${summary.motivationScore}/10`}
                </Badge>
              )}
            </div>

            {summary.sellerSituation && (
              <p className="text-xs text-muted-foreground leading-relaxed">{summary.sellerSituation}</p>
            )}

            {Array.isArray(summary.keyPoints) && summary.keyPoints.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Key Points</p>
                <ul className="space-y-0.5">
                  {(summary.keyPoints as string[]).map((pt, i) => (
                    <li key={i} className="text-xs flex gap-1.5">
                      <span className="text-emerald-400 shrink-0">·</span>
                      <span className="text-foreground/80">{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {summary.nextStep && (
              <div className="p-2 rounded-lg bg-background/50 border border-white/5">
                <p className="text-[10px] text-muted-foreground mb-0.5">Recommended next step</p>
                <p className="text-xs font-medium text-cyan-300">{summary.nextStep}</p>
              </div>
            )}

            {/* Save to Lead Notes */}
            {leadId && !summarySaved && (
              <Button
                size="sm"
                variant="outline"
                className="w-full gap-1.5 text-xs border-emerald-500/30 text-emerald-400 hover:text-emerald-300 hover:border-emerald-400/50 hover:bg-emerald-500/5 h-7"
                onClick={saveToLead}
              >
                <BookmarkPlus className="w-3.5 h-3.5" /> Save to Lead Notes
              </Button>
            )}
            {summarySaved && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 px-1">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Saved to lead notes
              </div>
            )}
          </div>
        )}

        {/* Disposition picker */}
        {status === "idle" && lastCallSid && !dispositionSaved && (
          <div className="rounded-xl bg-secondary/20 border border-border p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">How did the call go?</p>
            <div className="flex flex-wrap gap-1.5">
              {["Answered", "No Answer", "Left Voicemail", "Not Interested", "Wrong Number", "Callback Requested"].map((opt) => (
                <button
                  key={opt}
                  onClick={() => saveDisposition(opt)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    disposition === opt
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background/40 border-border text-muted-foreground hover:text-foreground hover:border-white/20"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}

        {dispositionSaved && (
          <div className="flex items-center gap-2 text-xs text-emerald-400 px-1">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            Disposition logged: <span className="font-medium">{disposition}</span>
          </div>
        )}

        {/* AI Call Coaching */}
        {status === "idle" && lastCallSid && lastCallRecorded && (
          <div className="space-y-2">
            {coachingCountdown !== null && coachingCountdown > 0 && (
              <div className="rounded-xl bg-indigo-500/5 border border-indigo-500/15 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
                  <p className="text-xs font-semibold text-indigo-400">AI Coaching — Waiting for transcription…</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-all duration-1000"
                      style={{ width: `${((90 - coachingCountdown) / 90) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono w-8">{coachingCountdown}s</span>
                </div>
                <Button variant="ghost" size="sm" className="w-full text-xs text-indigo-400 hover:text-indigo-300 h-7" onClick={getCoaching}>
                  Try now anyway
                </Button>
              </div>
            )}

            {coachingLoading && (
              <div className="rounded-xl bg-indigo-500/5 border border-indigo-500/15 p-3 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                <p className="text-xs text-indigo-400">Analyzing call with AI…</p>
              </div>
            )}

            {showCoaching && coaching && (
              <div className="rounded-xl bg-indigo-500/5 border border-indigo-500/20 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-indigo-400 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3" /> AI Call Coaching
                  </p>
                  {coaching.score != null && (
                    <Badge className={`text-[10px] border ${
                      coaching.score >= 8 ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                      coaching.score >= 5 ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                      "bg-red-500/10 text-red-400 border-red-500/20"
                    }`}>
                      {coaching.score}/10
                    </Badge>
                  )}
                </div>
                {coaching.strengths && <p className="text-xs text-emerald-400">✓ {coaching.strengths}</p>}
                {coaching.improvements && <p className="text-xs text-amber-400">→ {coaching.improvements}</p>}
                {coaching.followUpTask && (
                  <div className="p-2 rounded-lg bg-background/40 border border-white/5">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Suggested next step</p>
                    <p className="text-xs font-medium">{coaching.followUpTask}</p>
                  </div>
                )}
                {coaching.suggestedOffer != null && (
                  <div className="p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Suggested offer</p>
                    <p className="text-xs font-semibold text-emerald-400">${Number(coaching.suggestedOffer).toLocaleString()}</p>
                    {coaching.offerRationale && <p className="text-[10px] text-muted-foreground mt-0.5">{coaching.offerRationale}</p>}
                  </div>
                )}
              </div>
            )}

            {coachingCountdown === null && !coachingLoading && !showCoaching && (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 text-xs border-indigo-500/30 text-indigo-400 hover:text-indigo-300 hover:border-indigo-400/50 hover:bg-indigo-500/5"
                onClick={getCoaching}
              >
                <Sparkles className="w-3 h-3" /> Get AI Coaching
              </Button>
            )}
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center gap-2">
          {!isActive ? (
            <Button
              className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
              disabled={status === "initializing" || !canCall}
              onClick={startCall}
            >
              {status === "initializing" ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</>
              ) : (
                <><PhoneCall className="w-4 h-4" /> {leadName ? `Call ${leadName.split(" ")[0]}` : "Call"}</>
              )}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="icon"
                className={`h-9 w-9 rounded-xl transition-colors ${
                  phone.muted ? "bg-amber-500/20 border-amber-500/50 text-amber-400" : "border-border text-muted-foreground hover:text-foreground"
                }`}
                disabled={status !== "in-progress"}
                onClick={phone.toggleMute}
                title={phone.muted ? "Unmute" : "Mute"}
              >
                {phone.muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </Button>

              <Button
                variant="outline"
                size="icon"
                className={`h-9 w-9 rounded-xl transition-colors ${
                  phone.held ? "bg-amber-500/20 border-amber-500/50 text-amber-400 hover:bg-amber-500/30" : "border-border text-muted-foreground hover:text-foreground hover:border-white/20"
                }`}
                disabled={status !== "in-progress"}
                onClick={phone.toggleHold}
                title={phone.held ? "Resume" : "Hold"}
              >
                <PauseCircle className="w-4 h-4" />
              </Button>

              {/* DTMF Toggle */}
              <Button
                variant="outline"
                size="icon"
                className={`h-9 w-9 rounded-xl transition-colors ${
                  showDTMF ? "bg-primary/20 border-primary/40 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                }`}
                disabled={status !== "in-progress"}
                onClick={() => setShowDTMF((v) => !v)}
                title="Keypad"
              >
                <Hash className="w-4 h-4" />
              </Button>

              {/* Warm Transfer */}
              {!transferActive ? (
                <Button
                  variant="outline"
                  size="icon"
                  className={`h-9 w-9 rounded-xl transition-colors ${
                    transferOpen ? "bg-violet-500/20 border-violet-500/50 text-violet-400" : "border-border text-muted-foreground hover:text-violet-400 hover:border-violet-500/40"
                  }`}
                  disabled={status !== "in-progress"}
                  onClick={() => setTransferOpen((o) => !o)}
                  title="Warm transfer"
                >
                  <PhoneForwarded className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-xl border-violet-500/40 text-violet-400 hover:bg-violet-500/10 text-xs px-2"
                  onClick={completeTransfer}
                >
                  Complete Transfer
                </Button>
              )}

              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-xl border-violet-500/40 text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/60 transition-colors"
                disabled={status !== "in-progress" || droppingVoicemail || phone.held}
                onClick={dropVoicemail}
                title="Drop voicemail"
              >
                {droppingVoicemail ? <Loader2 className="w-4 h-4 animate-spin" /> : <Voicemail className="w-4 h-4" />}
              </Button>

              <Button
                className="flex-1 gap-2 bg-red-600 hover:bg-red-700 text-white"
                onClick={phone.hangUp}
                disabled={status === "disconnecting"}
              >
                {status === "disconnecting" ? <><Loader2 className="w-4 h-4 animate-spin" /> Ending…</> : <><PhoneOff className="w-4 h-4" /> End Call</>}
              </Button>
            </>
          )}
        </div>

        {/* Recording toggle + caller ID */}
        {!isActive && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={record}
                onChange={(e) => setRecord(e.target.checked)}
                className="rounded"
              />
              Record call &amp; transcribe
            </label>
            {phone.callerIdUsed && <span className="font-mono">{phone.callerIdUsed}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

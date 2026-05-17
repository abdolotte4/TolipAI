import { useState, useEffect, useRef, useCallback } from "react";
import { Device, Call } from "@twilio/voice-sdk";
import {
  PhoneOff, PhoneCall, Mic, MicOff, Loader2,
  Signal, AlertCircle, CheckCircle2, Activity, Wifi, Sparkles, Voicemail, PauseCircle,
  PhoneForwarded, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type DialerStatus =
  | "idle"
  | "initializing"
  | "ready"
  | "calling"
  | "in-progress"
  | "disconnecting"
  | "error";

interface CallAnalytics {
  mos: number | null;
  jitter: number | null;
  packetLoss: number | null;
}

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
  }).then(async r => {
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
    return json;
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BrowserDialer({ leadPhone, leadId, leadName, onCallLogged }: BrowserDialerProps) {
  const { toast } = useToast();

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentCallSidRef = useRef<string | null>(null);
  const coachingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wasRecordedRef = useRef(false);

  const [status, setStatus] = useState<DialerStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [analytics, setAnalytics] = useState<CallAnalytics>({ mos: null, jitter: null, packetLoss: null });
  const [lastAnalytics, setLastAnalytics] = useState<CallAnalytics>({ mos: null, jitter: null, packetLoss: null });
  const [callerIdUsed, setCallerIdUsed] = useState<string | null>(null);
  const [record, setRecord] = useState(false);

  const [lastCallSid, setLastCallSid] = useState<string | null>(null);
  const [lastCallRecorded, setLastCallRecorded] = useState(false);
  const [disposition, setDisposition] = useState<string | null>(null);
  const [dispositionSaved, setDispositionSaved] = useState(false);
  const [coaching, setCoaching] = useState<any | null>(null);
  const [coachingLoading, setCoachingLoading] = useState(false);
  const [showCoaching, setShowCoaching] = useState(false);
  const [coachingCountdown, setCoachingCountdown] = useState<number | null>(null);
  const [droppingVoicemail, setDroppingVoicemail] = useState(false);
  const [held, setHeld] = useState(false);

  // Warm transfer states
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferNumber, setTransferNumber] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [transferActive, setTransferActive] = useState(false);
  const [conferenceRoom, setConferenceRoom] = useState<string | null>(null);

  // ── Teardown helper ────────────────────────────────────────────────────────
  const destroyDevice = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (coachingTimerRef.current) { clearTimeout(coachingTimerRef.current); coachingTimerRef.current = null; }
    if (callRef.current) { callRef.current.disconnect(); callRef.current = null; }
    if (deviceRef.current) { deviceRef.current.destroy(); deviceRef.current = null; }
  }, []);

  useEffect(() => () => destroyDevice(), [destroyDevice]);

  // ── Initialize Twilio Device ───────────────────────────────────────────────
  const initDevice = useCallback(async (): Promise<boolean> => {
    if (deviceRef.current) return true;
    setStatus("initializing");
    setErrorMsg("");
    try {
      try {
        const warmStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        warmStream.getTracks().forEach(t => t.stop());
      } catch (micErr: any) {
        const errName = micErr?.name || "";
        if (errName === "NotAllowedError" || errName === "PermissionDeniedError") {
          setErrorMsg("Microphone access denied. Click the 🔒 icon in your browser's address bar and allow microphone, then refresh.");
          setStatus("error");
          return false;
        }
        if (errName === "NotFoundError" || errName === "NotReadableError") {
          setErrorMsg("No microphone found or it is in use by another application. Connect a headset and try again.");
          setStatus("error");
          return false;
        }
      }

      const { token, callerId } = await authFetch("/twilio/voice/token", { method: "POST" });
      setCallerIdUsed(callerId || null);

      const device = new Device(token, {
        logLevel: "warn",
        codecPreferences: ["opus", "pcmu"] as any,
        audioConstraints: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      } as any);

      device.on("error", (err: any) => {
        const code = err?.code;
        let msg = err?.message || "Device error";
        if (code === 31402) {
          msg = "Audio device error (31402): Your microphone was allowed but could not start. Try: close other apps using the mic, reconnect your headset, or use Chrome/Edge. Then click ↺ to retry.";
        }
        if (code === 31003) {
          msg = "Connection dropped (31003): Check your internet connection and click ↺ to reconnect.";
        }
        setErrorMsg(msg);
        setStatus("error");
        toast({ title: "Browser dialer error", description: msg, variant: "destructive" });
      });

      device.on("tokenWillExpire", async () => {
        try {
          const { token: newToken } = await authFetch("/twilio/voice/token", { method: "POST" });
          device.updateToken(newToken);
        } catch { /* ignore */ }
      });

      await device.register();
      deviceRef.current = device;
      setStatus("ready");
      return true;
    } catch (err: any) {
      const msg = err?.message || "Failed to initialize browser dialer";
      setErrorMsg(msg);
      setStatus("error");
      return false;
    }
  }, [toast]);

  // ── Auto-fetch AI coaching after call ends (if recorded) ───────────────────
  const autoFetchCoaching = useCallback(async (sid: string) => {
    // Wait 90 seconds for Twilio recording + OpenAI transcription to complete
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
      } catch {
        // Silently fail — user can still trigger manually
      } finally {
        setCoachingLoading(false);
      }
    }, WAIT_SECONDS * 1000);
  }, []);

  // ── Start call ─────────────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
    if (!leadPhone) return;
    const ready = await initDevice();
    if (!ready || !deviceRef.current) return;

    setStatus("calling");
    setDuration(0);
    setAnalytics({ mos: null, jitter: null, packetLoss: null });
    setMuted(false);
    setLastCallSid(null);
    setDisposition(null);
    setDispositionSaved(false);
    setCoaching(null);
    setShowCoaching(false);
    setCoachingCountdown(null);
    setTransferActive(false);
    setConferenceRoom(null);
    wasRecordedRef.current = record;

    try {
      const params: Record<string, string> = {
        To: leadPhone,
        CallerId: callerIdUsed || "",
        ...(record ? { Record: "true" } : {}),
      };

      const call = await deviceRef.current.connect({ params });
      callRef.current = call;

      call.on("accept", async (c: Call) => {
        setStatus("in-progress");
        const sid = c.parameters?.CallSid || null;
        currentCallSidRef.current = sid;

        timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);

        try {
          await authFetch("/twilio/voice/log", {
            method: "POST",
            body: JSON.stringify({
              callSid: sid,
              leadId: leadId ?? null,
              toNumber: leadPhone,
              fromNumber: callerIdUsed,
              direction: "outbound",
            }),
          });
          if (sid && onCallLogged) onCallLogged(sid);
        } catch { /* non-critical */ }
      });

      call.on("sample", (sample: any) => {
        if (!sample) return;
        const live: CallAnalytics = {
          mos: typeof sample.mos === "number" ? Math.round(sample.mos * 100) / 100 : null,
          jitter: typeof sample.jitter === "number" ? Math.round(sample.jitter * 10) / 10 : null,
          packetLoss: typeof sample.packetsLostFraction === "number"
            ? Math.round(sample.packetsLostFraction * 1000) / 10
            : null,
        };
        setAnalytics(live);
      });

      call.on("disconnect", async (_c: Call) => {
        setStatus("idle");
        setHeld(false);
        setTransferOpen(false);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

        const sid = currentCallSidRef.current;
        const finalMos = analytics.mos;
        const finalJitter = analytics.jitter;
        const finalPacketLoss = analytics.packetLoss;
        setLastAnalytics({ mos: finalMos, jitter: finalJitter, packetLoss: finalPacketLoss });

        if (sid) {
          setLastCallSid(sid);
          setLastCallRecorded(wasRecordedRef.current);

          // Auto-trigger coaching if call was recorded
          if (wasRecordedRef.current) {
            autoFetchCoaching(sid);
          }
        }

        if (sid) {
          try {
            await authFetch(`/twilio/voice/log/${sid}`, {
              method: "PATCH",
              body: JSON.stringify({
                status: "completed",
                mos: finalMos,
                jitter: finalJitter,
                packetLoss: finalPacketLoss,
              }),
            });
          } catch { /* non-critical */ }
        }

        callRef.current = null;
        currentCallSidRef.current = null;
      });

      call.on("cancel", () => {
        setStatus("idle");
        setHeld(false);
        setTransferOpen(false);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        callRef.current = null;
        currentCallSidRef.current = null;
      });

      call.on("error", (err: any) => {
        const msg = err?.message || "Call error";
        setErrorMsg(msg);
        setStatus("error");
        setHeld(false);
        setTransferOpen(false);
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        callRef.current = null;
        currentCallSidRef.current = null;
      });

    } catch (err: any) {
      const msg = err?.message || "Failed to start call";
      setErrorMsg(msg);
      setStatus(deviceRef.current ? "ready" : "error");
    }
  }, [leadPhone, leadId, record, callerIdUsed, analytics, initDevice, onCallLogged, autoFetchCoaching]);

  // ── Save disposition ───────────────────────────────────────────────────────
  const saveDisposition = useCallback(async (d: string) => {
    setDisposition(d);
    if (lastCallSid) {
      try {
        await authFetch(`/twilio/voice/log/${lastCallSid}`, {
          method: "PATCH",
          body: JSON.stringify({ disposition: d }),
        });
        setDispositionSaved(true);
      } catch { /* non-critical */ }
    }
  }, [lastCallSid]);

  // ── Manual AI coaching fetch ───────────────────────────────────────────────
  const getCoaching = useCallback(async () => {
    if (!lastCallSid) return;
    // Cancel auto-countdown if still pending
    if (coachingTimerRef.current) { clearTimeout(coachingTimerRef.current); coachingTimerRef.current = null; }
    setCoachingCountdown(null);
    setCoachingLoading(true);
    setCoaching(null);
    try {
      const data = await authFetch("/twilio/voice/coach", {
        method: "POST",
        body: JSON.stringify({ callSid: lastCallSid }),
      });
      setCoaching(data.coaching);
      setShowCoaching(true);
    } catch (err: any) {
      toast({ title: "AI Coaching unavailable", description: err.message, variant: "destructive" });
    } finally {
      setCoachingLoading(false);
    }
  }, [lastCallSid, toast]);

  // ── Hold / Resume ──────────────────────────────────────────────────────────
  const toggleHold = useCallback(async () => {
    if (!callRef.current || status !== "in-progress") return;
    const newHeld = !held;
    callRef.current.mute(newHeld);
    setHeld(newHeld);
    const sid = currentCallSidRef.current;
    if (sid) {
      authFetch("/twilio/voice/hold", {
        method: "POST",
        body: JSON.stringify({ callSid: sid, hold: newHeld }),
      }).catch(() => { /* non-critical */ });
    }
  }, [held, status]);

  // ── Warm transfer ──────────────────────────────────────────────────────────
  const initiateWarmTransfer = useCallback(async () => {
    const callSid = currentCallSidRef.current;
    if (!callSid || !transferNumber.trim()) return;
    setTransferring(true);
    try {
      const data = await authFetch("/twilio/voice/warm-transfer", {
        method: "POST",
        body: JSON.stringify({ callSid, transferTo: transferNumber.trim() }),
      });
      setConferenceRoom(data.conferenceRoom);
      setTransferActive(true);
      setTransferOpen(false);
      setTransferNumber("");
      toast({
        title: "Warm transfer initiated",
        description: `Connecting to ${transferNumber.trim()}… All parties are joining the conference.`,
      });
    } catch (err: any) {
      toast({ title: "Transfer failed", description: err.message, variant: "destructive" });
    } finally {
      setTransferring(false);
    }
  }, [transferNumber, toast]);

  const completeTransfer = useCallback(async () => {
    const callSid = currentCallSidRef.current;
    if (!callSid) {
      if (callRef.current) callRef.current.disconnect();
      return;
    }
    try {
      await authFetch("/twilio/voice/complete-transfer", {
        method: "POST",
        body: JSON.stringify({ callSid }),
      });
      toast({ title: "Transfer complete", description: "You have left the conference. The parties remain connected." });
    } catch {
      if (callRef.current) callRef.current.disconnect();
    }
    setTransferActive(false);
    setConferenceRoom(null);
  }, [toast]);

  // ── Voicemail drop ─────────────────────────────────────────────────────────
  const dropVoicemail = useCallback(async () => {
    const callSid = currentCallSidRef.current;
    if (!callSid) {
      toast({ title: "No active call SID", variant: "destructive" });
      return;
    }
    setDroppingVoicemail(true);
    try {
      await authFetch("/twilio/voice/voicemail-drop", {
        method: "POST",
        body: JSON.stringify({ callSid }),
      });
      toast({ title: "Voicemail dropped", description: "Message is playing. You can move to the next lead." });
      if (callRef.current) callRef.current.disconnect();
    } catch (err: any) {
      toast({ title: "Voicemail drop failed", description: err.message, variant: "destructive" });
    } finally {
      setDroppingVoicemail(false);
    }
  }, [toast]);

  // ── Hang up ────────────────────────────────────────────────────────────────
  const hangUp = useCallback(() => {
    setStatus("disconnecting");
    if (callRef.current) {
      callRef.current.disconnect();
    } else {
      setStatus("idle");
    }
  }, []);

  // ── Toggle mute ────────────────────────────────────────────────────────────
  const toggleMute = useCallback(() => {
    if (!callRef.current) return;
    const next = !muted;
    callRef.current.mute(next);
    setMuted(next);
  }, [muted]);

  // ─────────────────────────────────────────────────────────────────────────

  const isActive = status === "calling" || status === "in-progress" || status === "disconnecting";
  const canCall = !!leadPhone && (status === "idle" || status === "ready" || status === "error");

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
             status === "disconnecting" ? "Ending…" :
             "Error"}
          </Badge>
          {transferActive && (
            <Badge className="text-[10px] border bg-violet-500/10 text-violet-400 border-violet-500/30 animate-pulse">
              Transfer Active
            </Badge>
          )}
        </div>
        {leadPhone && (
          <span className="text-xs font-mono text-muted-foreground">{leadPhone}</span>
        )}
      </div>

      {/* Body */}
      <div className="p-4 space-y-3">
        {/* No phone number warning */}
        {!leadPhone && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" />
            Add a phone number to this lead to enable in-browser calling.
          </div>
        )}

        {/* No caller ID warning */}
        {status === "ready" && !callerIdUsed && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">No outbound phone number configured</p>
              <p className="mt-0.5 text-amber-400/80">Voice SDK is connected. Add a Twilio Phone Number in campaign settings so outbound calls display the correct caller ID.</p>
              <a href="/integrations/twilio" className="underline mt-1 inline-block">
                Add phone number →
              </a>
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && errorMsg && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Connection error</p>
              <p className="mt-0.5 text-red-400/80">{errorMsg}</p>
              <a href="/integrations/twilio" className="underline mt-1 inline-block">
                Configure Voice credentials →
              </a>
            </div>
          </div>
        )}

        {/* In-call panel */}
        {isActive && (
          <div className="rounded-xl bg-secondary/30 border border-border p-3 space-y-2">
            {/* Duration */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-mono font-semibold">
                <div className={`w-2 h-2 rounded-full ${held ? "bg-amber-400 animate-pulse" : "bg-emerald-400 animate-pulse"}`} />
                {fmtDuration(duration)}
                {held && (
                  <Badge className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse ml-1">
                    On Hold
                  </Badge>
                )}
              </div>
              {status === "in-progress" && !held && (
                <div className={`text-xs font-medium ${qualityColor(analytics.mos)}`}>
                  {qualityLabel(analytics.mos)}
                  {analytics.mos !== null && (
                    <span className="ml-1 opacity-70">({analytics.mos.toFixed(1)} MOS)</span>
                  )}
                </div>
              )}
            </div>

            {/* Live quality metrics */}
            {status === "in-progress" && (
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: "MOS", value: analytics.mos?.toFixed(2) ?? "—", icon: Signal },
                  { label: "Jitter", value: analytics.jitter != null ? `${analytics.jitter}ms` : "—", icon: Activity },
                  { label: "Pkt Loss", value: analytics.packetLoss != null ? `${analytics.packetLoss}%` : "—", icon: Wifi },
                ].map(({ label, value, icon: Icon }) => (
                  <div key={label} className="bg-background/40 rounded-lg p-2">
                    <Icon className="w-3 h-3 mx-auto mb-1 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-xs font-mono font-medium">{value}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Conference info when transfer is active */}
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

        {/* Warm Transfer Input Panel */}
        {transferOpen && status === "in-progress" && (
          <div className="rounded-xl bg-violet-500/5 border border-violet-500/20 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-violet-400 flex items-center gap-1.5">
                <PhoneForwarded className="w-3 h-3" /> Warm Transfer — Enter second number
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
                onChange={e => setTransferNumber(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && transferNumber.trim()) initiateWarmTransfer(); }}
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

        {/* Post-call analytics */}
        {status === "idle" && (lastAnalytics.mos !== null || lastAnalytics.jitter !== null) && (
          <div className="rounded-xl bg-secondary/20 border border-border p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Last call quality
            </p>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "MOS", value: lastAnalytics.mos?.toFixed(2) ?? "—" },
                { label: "Jitter", value: lastAnalytics.jitter != null ? `${lastAnalytics.jitter}ms` : "—" },
                { label: "Pkt Loss", value: lastAnalytics.packetLoss != null ? `${lastAnalytics.packetLoss}%` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="bg-background/40 rounded-lg p-2">
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="text-xs font-mono font-medium">{value}</p>
                </div>
              ))}
            </div>
            {lastAnalytics.mos !== null && (
              <p className={`text-xs mt-2 text-center font-medium ${qualityColor(lastAnalytics.mos)}`}>
                {qualityLabel(lastAnalytics.mos)} call quality
              </p>
            )}
          </div>
        )}

        {/* Disposition picker — shown after call ends */}
        {status === "idle" && lastCallSid && !dispositionSaved && (
          <div className="rounded-xl bg-secondary/20 border border-border p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">How did the call go?</p>
            <div className="flex flex-wrap gap-1.5">
              {["Answered", "No Answer", "Left Voicemail", "Not Interested", "Wrong Number", "Callback Requested"].map(opt => (
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

        {/* Disposition saved confirmation */}
        {status === "idle" && dispositionSaved && (
          <div className="flex items-center gap-2 text-xs text-emerald-400 px-1">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            Disposition logged: <span className="font-medium">{disposition}</span>
          </div>
        )}

        {/* AI Call Coaching Panel — auto-appears after recorded calls */}
        {status === "idle" && lastCallSid && lastCallRecorded && (
          <div className="space-y-2">
            {/* Countdown while waiting for transcription */}
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
                <p className="text-[10px] text-muted-foreground">
                  Twilio is processing the recording. AI analysis will appear automatically.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs text-indigo-400 hover:text-indigo-300 h-7"
                  onClick={getCoaching}
                >
                  Try now anyway
                </Button>
              </div>
            )}

            {/* Loading state */}
            {coachingLoading && (
              <div className="rounded-xl bg-indigo-500/5 border border-indigo-500/15 p-3 flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                <p className="text-xs text-indigo-400">Analyzing call with AI…</p>
              </div>
            )}

            {/* Coaching result */}
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
                {coaching.strengths && (
                  <p className="text-xs text-emerald-400">✓ {coaching.strengths}</p>
                )}
                {coaching.improvements && (
                  <p className="text-xs text-amber-400">→ {coaching.improvements}</p>
                )}
                {coaching.followUpTask && (
                  <div className="p-2 rounded-lg bg-background/40 border border-white/5">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Suggested next step</p>
                    <p className="text-xs font-medium">{coaching.followUpTask}</p>
                  </div>
                )}
                {coaching.suggestedOffer != null && (
                  <div className="p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                    <p className="text-[10px] text-muted-foreground mb-0.5">Suggested offer</p>
                    <p className="text-xs font-semibold text-emerald-400">
                      ${Number(coaching.suggestedOffer).toLocaleString()}
                    </p>
                    {coaching.offerRationale && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">{coaching.offerRationale}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Manual trigger — shown if countdown has finished but no coaching yet */}
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
                  muted ? "bg-amber-500/20 border-amber-500/50 text-amber-400" : "border-border text-muted-foreground hover:text-foreground"
                }`}
                disabled={status !== "in-progress"}
                onClick={toggleMute}
                title={muted ? "Unmute" : "Mute"}
              >
                {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </Button>

              {/* Hold / Resume */}
              <Button
                variant="outline"
                size="icon"
                className={`h-9 w-9 rounded-xl transition-colors ${
                  held
                    ? "bg-amber-500/20 border-amber-500/50 text-amber-400 hover:bg-amber-500/30"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-white/20"
                }`}
                disabled={status !== "in-progress"}
                onClick={toggleHold}
                title={held ? "Resume — unmute and reconnect audio" : "Hold — mute mic and play hold music to caller"}
              >
                <PauseCircle className="w-4 h-4" />
              </Button>

              {/* Warm Transfer */}
              {!transferActive ? (
                <Button
                  variant="outline"
                  size="icon"
                  className={`h-9 w-9 rounded-xl transition-colors ${
                    transferOpen
                      ? "bg-violet-500/20 border-violet-500/50 text-violet-400"
                      : "border-border text-muted-foreground hover:text-violet-400 hover:border-violet-500/40"
                  }`}
                  disabled={status !== "in-progress"}
                  onClick={() => setTransferOpen(o => !o)}
                  title="Warm transfer — dial a second party and bridge them in"
                >
                  <PhoneForwarded className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-xl border-violet-500/40 text-violet-400 hover:bg-violet-500/10 text-xs px-2"
                  onClick={completeTransfer}
                  title="Complete transfer — leave the conference and connect the two parties"
                >
                  Complete Transfer
                </Button>
              )}

              <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-xl border-violet-500/40 text-violet-400 hover:bg-violet-500/10 hover:border-violet-500/60 transition-colors"
                disabled={status !== "in-progress" || droppingVoicemail || held}
                onClick={dropVoicemail}
                title="Drop voicemail — plays a pre-recorded message and hangs up"
              >
                {droppingVoicemail
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Voicemail className="w-4 h-4" />
                }
              </Button>
              <Button
                className="flex-1 gap-2 bg-red-600 hover:bg-red-700 text-white"
                onClick={hangUp}
                disabled={status === "disconnecting"}
              >
                {status === "disconnecting"
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Ending…</>
                  : <><PhoneOff className="w-4 h-4" /> End Call</>
                }
              </Button>
            </>
          )}
        </div>

        {/* Recording toggle + caller ID note */}
        {!isActive && (
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={record}
                onChange={e => setRecord(e.target.checked)}
                className="rounded"
              />
              Record call &amp; transcribe
            </label>
            {callerIdUsed && (
              <span className="font-mono">{callerIdUsed}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

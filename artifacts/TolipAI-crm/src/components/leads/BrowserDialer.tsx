import { useState, useEffect, useRef, useCallback } from "react";
import { Device, Call } from "@twilio/voice-sdk";
import {
  Phone, PhoneOff, PhoneCall, Mic, MicOff, Loader2,
  Signal, AlertCircle, CheckCircle2, Activity, Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

  const [status, setStatus] = useState<DialerStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [analytics, setAnalytics] = useState<CallAnalytics>({ mos: null, jitter: null, packetLoss: null });
  const [lastAnalytics, setLastAnalytics] = useState<CallAnalytics>({ mos: null, jitter: null, packetLoss: null });
  const [callerIdUsed, setCallerIdUsed] = useState<string | null>(null);
  const [record, setRecord] = useState(false);

  // ── Teardown helper ────────────────────────────────────────────────────────
  const destroyDevice = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
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
      const { token, callerId } = await authFetch("/twilio/voice/token", { method: "POST" });
      setCallerIdUsed(callerId || null);

      const device = new Device(token, {
        logLevel: "warn",
        codecPreferences: ["opus", "pcmu"] as any,
      });

      device.on("error", (err: any) => {
        const msg = err?.message || "Device error";
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

  // ── Start call ─────────────────────────────────────────────────────────────
  const startCall = useCallback(async () => {
    if (!leadPhone) return;
    const ready = await initDevice();
    if (!ready || !deviceRef.current) return;

    setStatus("calling");
    setDuration(0);
    setAnalytics({ mos: null, jitter: null, packetLoss: null });
    setMuted(false);

    try {
      const params: Record<string, string> = {
        To: leadPhone,
        ...(record ? { Record: "true" } : {}),
      };

      const call = await deviceRef.current.connect({ params });
      callRef.current = call;

      call.on("accept", async (c: Call) => {
        setStatus("in-progress");
        const sid = c.parameters?.CallSid || null;
        currentCallSidRef.current = sid;

        // Start duration timer
        timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);

        // Log call creation to backend
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
        // Real-time quality metrics from the SDK
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

      call.on("disconnect", async (c: Call) => {
        setStatus("idle");
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

        // Capture final metrics
        const sid = currentCallSidRef.current;
        const finalMos = analytics.mos;
        const finalJitter = analytics.jitter;
        const finalPacketLoss = analytics.packetLoss;
        setLastAnalytics({ mos: finalMos, jitter: finalJitter, packetLoss: finalPacketLoss });
        setDuration(d => { /* capture for PATCH */ return d; });

        // Update call log with final analytics
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
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        callRef.current = null;
        currentCallSidRef.current = null;
      });

      call.on("error", (err: any) => {
        const msg = err?.message || "Call error";
        setErrorMsg(msg);
        setStatus("error");
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        callRef.current = null;
        currentCallSidRef.current = null;
      });

    } catch (err: any) {
      const msg = err?.message || "Failed to start call";
      setErrorMsg(msg);
      setStatus(deviceRef.current ? "ready" : "error");
    }
  }, [leadPhone, leadId, record, callerIdUsed, analytics, initDevice, onCallLogged]);

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
             status === "in-progress" ? "In call" :
             status === "disconnecting" ? "Ending…" :
             "Error"}
          </Badge>
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

        {/* Error */}
        {status === "error" && errorMsg && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Connection error</p>
              <p className="mt-0.5 text-red-400/80">{errorMsg}</p>
              {errorMsg.toLowerCase().includes("voice") && (
                <a href="/integrations/twilio" className="underline mt-1 inline-block">
                  Configure Voice credentials →
                </a>
              )}
            </div>
          </div>
        )}

        {/* In-call panel */}
        {isActive && (
          <div className="rounded-xl bg-secondary/30 border border-border p-3 space-y-2">
            {/* Duration */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-mono font-semibold">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                {fmtDuration(duration)}
              </div>
              {status === "in-progress" && (
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

        {/* Controls */}
        <div className="flex items-center gap-2">
          {!isActive ? (
            <Button
              className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
              disabled={!canCall || status === "initializing"}
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

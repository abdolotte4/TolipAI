import { useState, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Phone, Loader2, AlertCircle, Mic, MessageSquare, Image,
  PhoneCall, PhoneOff, X, Keyboard, Hash,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Device, type Call } from "@twilio/voice-sdk";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PhoneNumber {
  id: string;
  sid: string;
  number: string;
  name: string;
  capabilities?: { voice?: boolean; sms?: boolean; mms?: boolean };
}

// ─── Quick-dial state ──────────────────────────────────────────────────────────

type DialStatus = "idle" | "initializing" | "ready" | "calling" | "in-progress" | "error";

function fmtDuration(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ─── Quick-dial dialog ─────────────────────────────────────────────────────────

function QuickDialDialog({
  fromNumber,
  onClose,
}: {
  fromNumber: PhoneNumber;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<DialStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (callRef.current) { callRef.current.disconnect(); callRef.current = null; }
    if (deviceRef.current) { deviceRef.current.destroy(); deviceRef.current = null; }
  }, []);

  const startCall = useCallback(async () => {
    const dest = to.trim();
    if (!dest) return;
    setStatus("initializing");
    setErrorMsg("");
    try {
      const { token } = await apiFetch("/twilio/voice/token");
      const device = new Device(token, { logLevel: "error" });
      deviceRef.current = device;
      await device.register();
      setStatus("calling");
      const call = await device.connect({
        params: { To: dest },
      });
      callRef.current = call;
      call.on("accept", () => {
        setStatus("in-progress");
        setDuration(0);
        timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      });
      call.on("disconnect", () => {
        setStatus("idle");
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      });
      call.on("error", (err: any) => {
        setStatus("error");
        setErrorMsg(err?.message || "Call error");
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      });
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err?.message || "Failed to start call");
      toast({ title: "Call failed", description: err?.message, variant: "destructive" });
    }
  }, [to, toast]);

  const hangUp = () => {
    callRef.current?.disconnect();
    callRef.current = null;
    setStatus("idle");
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const toggleMute = () => {
    if (!callRef.current) return;
    const next = !muted;
    callRef.current.mute(next);
    setMuted(next);
  };

  const handleClose = () => { cleanup(); onClose(); };

  const isActive = status === "calling" || status === "in-progress";

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-sm"
      >
        <Card className="rounded-2xl border-white/10 bg-card shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="px-5 py-4 bg-secondary/30 border-b border-border flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold flex items-center gap-2">
                <Phone className="w-4 h-4 text-emerald-400" /> Quick Call
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Calling from <span className="font-mono text-foreground">{fromNumber.number}</span>
              </p>
            </div>
            <button
              onClick={handleClose}
              className="text-muted-foreground hover:text-foreground transition-colors"
              disabled={isActive}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4">
            {/* Status */}
            {status !== "idle" && (
              <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-xl ${
                status === "in-progress" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" :
                status === "calling"     ? "bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse" :
                status === "error"       ? "bg-red-500/10 text-red-400 border border-red-500/20" :
                "bg-secondary text-muted-foreground border border-border"
              }`}>
                {status === "in-progress" && (
                  <><div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Connected — {fmtDuration(duration)}</>
                )}
                {status === "calling" && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Connecting…</>}
                {status === "initializing" && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Initializing…</>}
                {status === "error" && <><AlertCircle className="w-3.5 h-3.5" /> {errorMsg}</>}
              </div>
            )}

            {/* Destination input */}
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                <Keyboard className="w-3 h-3" /> Destination number
              </label>
              <Input
                type="tel"
                placeholder="+1 (555) 000-0000"
                value={to}
                onChange={e => setTo(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !isActive && to.trim()) startCall(); }}
                disabled={isActive}
                className="bg-background/60 border-border rounded-xl font-mono"
                autoFocus
              />
            </div>

            {/* Controls */}
            <div className="flex gap-2">
              {!isActive ? (
                <Button
                  className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={!to.trim() || status === "initializing"}
                  onClick={startCall}
                >
                  {status === "initializing"
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</>
                    : <><PhoneCall className="w-4 h-4" /> Call</>
                  }
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="icon"
                    className={`h-10 w-10 rounded-xl ${muted ? "bg-amber-500/20 border-amber-500/50 text-amber-400" : "border-border text-muted-foreground"}`}
                    disabled={status !== "in-progress"}
                    onClick={toggleMute}
                    title={muted ? "Unmute" : "Mute"}
                  >
                    <Mic className="w-4 h-4" />
                  </Button>
                  <Button
                    className="flex-1 gap-2 bg-red-600 hover:bg-red-700 text-white"
                    onClick={hangUp}
                  >
                    <PhoneOff className="w-4 h-4" /> End Call
                  </Button>
                </>
              )}
            </div>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}

// ─── Number card ───────────────────────────────────────────────────────────────

function NumberCard({
  num,
  onCall,
}: {
  num: PhoneNumber;
  onCall: (n: PhoneNumber) => void;
}) {
  const caps = num.capabilities ?? {};
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.01 }}
    >
      <Card className="rounded-2xl border-white/5 bg-card p-4 flex items-center gap-4">
        <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
          <Phone className="w-5 h-5 text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-mono font-semibold text-base text-foreground">{num.number}</p>
          {num.name && num.name !== num.number && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{num.name}</p>
          )}
          <div className="flex gap-1.5 mt-1.5 flex-wrap">
            {caps.voice !== false && (
              <Badge className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 gap-1">
                <Mic className="w-2.5 h-2.5" /> Voice
              </Badge>
            )}
            {caps.sms !== false && (
              <Badge className="text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20 gap-1">
                <MessageSquare className="w-2.5 h-2.5" /> SMS
              </Badge>
            )}
            {caps.mms && (
              <Badge className="text-[10px] bg-violet-500/10 text-violet-400 border border-violet-500/20 gap-1">
                <Image className="w-2.5 h-2.5" /> MMS
              </Badge>
            )}
          </div>
        </div>
        <Button
          size="sm"
          className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shrink-0"
          onClick={() => onCall(num)}
        >
          <PhoneCall className="w-3.5 h-3.5" /> Call from this number
        </Button>
      </Card>
    </motion.div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function PhoneNumbersPage() {
  const [dialingFrom, setDialingFrom] = useState<PhoneNumber | null>(null);

  const { data, isLoading, isError, refetch } = useQuery<{ phoneNumbers: PhoneNumber[] }>({
    queryKey: ["twilio-phone-numbers"],
    queryFn: () => apiFetch("/twilio/phone-numbers"),
    staleTime: 60_000,
  });

  const numbers = data?.phoneNumbers ?? [];

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-display font-bold flex items-center gap-2">
              <Hash className="w-6 h-6 text-primary" /> Phone Numbers
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Twilio numbers configured for your campaign. Click a number to place a call from it.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <Loader2 className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </motion.div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <Card className="p-8 rounded-2xl border-white/5 text-center">
          <AlertCircle className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Failed to load phone numbers.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => refetch()}>
            Try again
          </Button>
        </Card>
      ) : numbers.length === 0 ? (
        <Card className="p-8 rounded-2xl border-white/5 text-center">
          <Phone className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">No phone numbers found</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add a Twilio phone number in your campaign's Twilio settings.
          </p>
          <Button variant="outline" size="sm" className="mt-4" asChild>
            <a href="/integrations/twilio">Go to Twilio Settings</a>
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {numbers.map(num => (
            <NumberCard key={num.sid || num.number} num={num} onCall={setDialingFrom} />
          ))}
        </div>
      )}

      {/* Quick-dial dialog */}
      {dialingFrom && (
        <QuickDialDialog
          fromNumber={dialingFrom}
          onClose={() => setDialingFrom(null)}
        />
      )}
    </div>
  );
}

import { useState, useEffect, useRef } from "react";
import { usePhone } from "@/contexts/PhoneContext";
import {
  PhoneOff, Mic, MicOff, PauseCircle, Hash,
  ChevronDown, ChevronUp, MessageSquare, Lightbulb, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

function fmtDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const DTMF_KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["*", "0", "#"],
];

export default function ActiveCallBar() {
  const {
    status, muted, held, duration, analytics, activeLeadName,
    hangUp, toggleMute, toggleHold, sendDTMF,
    liveTranscript, aiSuggestion, clearTranscript,
  } = usePhone();

  const [showDTMF, setShowDTMF] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [dismissedSuggestion, setDismissedSuggestion] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showTranscript && transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [liveTranscript, showTranscript]);

  // Auto-open transcript panel when first segment arrives
  useEffect(() => {
    if (liveTranscript.length === 1) setShowTranscript(true);
  }, [liveTranscript.length]);

  // Reset dismissed suggestion when a new one arrives
  useEffect(() => {
    if (aiSuggestion && aiSuggestion !== dismissedSuggestion) {
      setDismissedSuggestion(null);
    }
  }, [aiSuggestion]);

  if (status !== "in-progress" && status !== "calling" && status !== "disconnecting") {
    return null;
  }

  const activeSuggestion = aiSuggestion && aiSuggestion !== dismissedSuggestion ? aiSuggestion : null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9998] flex flex-col"
      style={{
        background: "hsl(var(--card))",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 -8px 32px -8px rgba(0,0,0,0.6)",
      }}
    >
      {/* ── Live Transcript Panel ─────────────────────────────────────────── */}
      {showTranscript && (
        <div className="border-b border-white/5 max-h-56 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 bg-secondary/30 border-b border-white/5">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Live Transcript
              </span>
              {liveTranscript.length === 0 && (
                <span className="text-xs text-muted-foreground/60 italic">Waiting for speech…</span>
              )}
            </div>
            <button
              onClick={() => setShowTranscript(false)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
            {liveTranscript.length === 0 ? (
              <div className="text-center py-4 text-xs text-muted-foreground/50">
                Transcript will appear as the conversation progresses…
              </div>
            ) : (
              liveTranscript.map((seg, i) => (
                <div key={i} className={`flex gap-2 ${seg.track === "outbound" ? "flex-row-reverse" : "flex-row"}`}>
                  <div className={`max-w-[75%] px-3 py-1.5 rounded-2xl text-xs leading-relaxed ${
                    seg.track === "outbound"
                      ? "bg-primary/10 border border-primary/20 text-foreground"
                      : "bg-secondary border border-border text-foreground"
                  }`}>
                    <span className={`text-[10px] font-semibold block mb-0.5 ${
                      seg.track === "outbound" ? "text-primary/70" : "text-blue-400/70"
                    }`}>
                      {seg.track === "outbound" ? "Agent" : "Caller"}
                    </span>
                    {seg.text}
                  </div>
                </div>
              ))
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>
      )}

      {/* ── AI Suggestion Card ────────────────────────────────────────────── */}
      {activeSuggestion && (
        <div className="border-b border-white/5 px-4 py-2.5 flex items-start gap-3 bg-amber-500/5">
          <div className="w-6 h-6 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide mb-0.5">AI Suggestion</p>
            <p className="text-xs text-foreground leading-relaxed">{activeSuggestion}</p>
          </div>
          <button
            onClick={() => setDismissedSuggestion(aiSuggestion)}
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors flex-shrink-0 mt-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── DTMF Keypad ───────────────────────────────────────────────────── */}
      {showDTMF && (
        <div className="border-b border-white/5 px-4 py-3">
          <div className="max-w-xs mx-auto">
            <div className="grid grid-cols-3 gap-2">
              {DTMF_KEYS.flat().map((key) => (
                <button
                  key={key}
                  onMouseDown={(e) => { e.preventDefault(); sendDTMF(key); }}
                  className="h-10 rounded-xl text-sm font-semibold bg-secondary/60 hover:bg-secondary border border-white/5 hover:border-white/15 transition-colors active:scale-95"
                >
                  {key}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Main Controls Row ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${
            status === "calling" ? "bg-blue-400 animate-pulse" :
            held ? "bg-amber-400 animate-pulse" :
            "bg-emerald-400 animate-pulse"
          }`} />
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">
              {activeLeadName || "Call in progress"}
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">{fmtDuration(duration)}</span>
              {held && <span className="text-amber-400 font-medium">On Hold</span>}
              {analytics.mos !== null && (
                <span className={`font-medium ${
                  analytics.mos >= 4.0 ? "text-emerald-400" :
                  analytics.mos >= 3.5 ? "text-yellow-400" : "text-red-400"
                }`}>
                  {analytics.mos.toFixed(1)} MOS
                </span>
              )}
              {liveTranscript.length > 0 && (
                <span className="text-blue-400/60 font-mono text-[10px]">
                  {liveTranscript.length} seg
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Transcript toggle */}
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-colors relative ${
              showTranscript
                ? "bg-blue-500/20 border-blue-500/40 text-blue-400"
                : "bg-secondary/40 border-white/5 text-muted-foreground hover:text-foreground"
            }`}
            title="Live Transcript"
          >
            <MessageSquare className="w-4 h-4" />
            {liveTranscript.length > 0 && !showTranscript && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-blue-500 rounded-full text-[9px] font-bold text-white flex items-center justify-center">
                {liveTranscript.length > 9 ? "9+" : liveTranscript.length}
              </span>
            )}
          </button>

          <button
            onClick={toggleMute}
            className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-colors ${
              muted
                ? "bg-amber-500/20 border-amber-500/40 text-amber-400"
                : "bg-secondary/40 border-white/5 text-muted-foreground hover:text-foreground"
            }`}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>

          <button
            onClick={toggleHold}
            className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-colors ${
              held
                ? "bg-amber-500/20 border-amber-500/40 text-amber-400"
                : "bg-secondary/40 border-white/5 text-muted-foreground hover:text-foreground"
            }`}
            title={held ? "Resume" : "Hold"}
          >
            <PauseCircle className="w-4 h-4" />
          </button>

          <button
            onClick={() => setShowDTMF((v) => !v)}
            className={`w-9 h-9 rounded-xl flex items-center justify-center border transition-colors ${
              showDTMF
                ? "bg-primary/20 border-primary/40 text-primary"
                : "bg-secondary/40 border-white/5 text-muted-foreground hover:text-foreground"
            }`}
            title="Keypad"
          >
            <Hash className="w-4 h-4" />
          </button>

          <Button
            size="sm"
            className="gap-2 bg-red-600 hover:bg-red-700 text-white h-9 px-4 rounded-xl"
            onClick={hangUp}
            disabled={status === "disconnecting"}
          >
            <PhoneOff className="w-4 h-4" />
            <span className="hidden sm:inline">End</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

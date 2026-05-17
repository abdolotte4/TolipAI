import { useState } from "react";
import { usePhone } from "@/contexts/PhoneContext";
import {
  PhoneOff, Mic, MicOff, PauseCircle, Hash,
  Phone, ChevronDown, ChevronUp,
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
  const { status, muted, held, duration, analytics, activeLeadName, hangUp, toggleMute, toggleHold, sendDTMF } = usePhone();
  const [showDTMF, setShowDTMF] = useState(false);

  if (status !== "in-progress" && status !== "calling" && status !== "disconnecting") {
    return null;
  }

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-[9998]"
      style={{
        background: "hsl(var(--card))",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 -8px 32px -8px rgba(0,0,0,0.6)",
      }}
    >
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

      <div className="flex items-center justify-between gap-3 px-4 py-3 max-w-4xl mx-auto">
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
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
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

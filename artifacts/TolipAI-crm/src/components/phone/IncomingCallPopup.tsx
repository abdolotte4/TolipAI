import { usePhone } from "@/contexts/PhoneContext";
import { PhoneCall, PhoneOff, User } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function IncomingCallPopup() {
  const { incomingCallInfo, hasPendingIncoming, acceptIncoming, declineIncoming } = usePhone();

  if (!incomingCallInfo) return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-[9999] w-80 rounded-2xl shadow-2xl overflow-hidden"
      style={{
        background: "hsl(var(--card))",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 25px 50px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)",
      }}
    >
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            Incoming Call
          </span>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-emerald-400">Ringing</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <User className="w-6 h-6 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm truncate">
              {incomingCallInfo.leadName || "Unknown Caller"}
            </p>
            <p className="text-xs text-muted-foreground font-mono mt-0.5">
              {incomingCallInfo.phone}
            </p>
            {incomingCallInfo.leadName && (
              <p className="text-[10px] text-muted-foreground/60 mt-0.5">CRM Lead</p>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            className="flex-1 gap-2 bg-red-600 hover:bg-red-700 text-white h-11 rounded-xl"
            onClick={declineIncoming}
          >
            <PhoneOff className="w-4 h-4" />
            Decline
          </Button>
          <Button
            className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white h-11 rounded-xl"
            disabled={!hasPendingIncoming}
            onClick={() => acceptIncoming(incomingCallInfo.leadId)}
          >
            <PhoneCall className="w-4 h-4" />
            Accept
          </Button>
        </div>
      </div>
    </div>
  );
}

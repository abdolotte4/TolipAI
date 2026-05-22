import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, Loader2, AlertCircle, MessageSquare,
  PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  Hash, RefreshCw, User, Search, Play, Pause, Square, ExternalLink,
  Delete, Plus, Send, Keyboard, X, ChevronLeft,
} from "lucide-react";
import { apiRawFetch } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { usePhone } from "@/contexts/PhoneContext";
import { formatDistanceToNow, format } from "date-fns";
import { Link } from "wouter";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PhoneNumber {
  id: string;
  sid: string;
  number: string;
  name: string;
  capabilities?: { voice?: boolean; sms?: boolean; mms?: boolean };
}

interface Conversation {
  contact: string;
  totalCalls: number;
  totalSms: number;
  lastActivity: string;
  lastCall?: string;
  lastDirection: string;
  lastStatus: string;
  lastDuration: number | null;
  lastSnippet: string | null;
  leadId: number | null;
  hasRecording: boolean;
  unreadCount?: number;
}

interface ThreadItem {
  id: number;
  type: "call" | "sms";
  direction: string;
  status?: string;
  duration?: number | null;
  recordingUrl?: string | null;
  recordingSid?: string | null;
  transcript?: string | null;
  content?: string;
  fromNumber: string;
  toNumber: string;
  createdAt: string;
}

interface ContactHistory {
  thread: ThreadItem[];
  calls: any[];
  total: number;
  lead: { id: number; sellerName: string; phone: string; address: string; status: string } | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtPhone(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1"))
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10)
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

function fmtDuration(sec: number | null) {
  if (!sec) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─── Mini Audio Player ─────────────────────────────────────────────────────────

function MiniPlayer({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const proxyUrl = `/api/twilio/voice/recording-proxy?url=${encodeURIComponent(url)}`;

  // ── Cleanup: pause + release audio resources on unmount (MEM-02) ───────────
  useEffect(() => {
    const el = audioRef.current;
    return () => {
      if (el) { el.pause(); el.src = ""; }
    };
  }, []);
  const toggle = async () => {
    const el = audioRef.current; if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { await el.play(); setPlaying(true); }
  };
  const stop = () => {
    const el = audioRef.current; if (!el) return;
    el.pause(); el.currentTime = 0; setPlaying(false); setProgress(0);
  };
  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  return (
    <div className="flex items-center gap-2 bg-secondary/40 rounded-lg px-3 py-2 mt-2">
      <audio ref={audioRef} src={proxyUrl}
        onTimeUpdate={e => setProgress(e.currentTarget.currentTime)}
        onDurationChange={e => setDuration(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); setProgress(0); }} />
      <button onClick={toggle} className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/80 transition-colors flex-shrink-0">
        {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
      </button>
      <button onClick={stop} className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:bg-secondary/80 flex-shrink-0">
        <Square className="w-2.5 h-2.5" />
      </button>
      <div className="flex-1 h-1.5 bg-border rounded-full cursor-pointer relative overflow-hidden"
        onClick={e => {
          if (!audioRef.current || !duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
        }}>
        <div className="absolute inset-y-0 left-0 bg-primary rounded-full" style={{ width: duration > 0 ? `${(progress / duration) * 100}%` : "0%" }} />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
        {duration > 0 ? fmtTime(duration) : "—"}
      </span>
    </div>
  );
}

// ─── Call Bubble ───────────────────────────────────────────────────────────────

function CallBubble({ item, ownedNumber }: { item: ThreadItem; ownedNumber: string }) {
  const isOutbound = item.direction === "outbound";
  const ownedDigits = ownedNumber.replace(/\D/g, "").slice(-10);
  const fromDigits = (item.fromNumber || "").replace(/\D/g, "").slice(-10);
  const isSentByUs = fromDigits === ownedDigits;
  const Icon = isOutbound
    ? (item.status === "no-answer" || item.status === "busy" ? PhoneMissed : PhoneOutgoing)
    : PhoneIncoming;
  const iconColor = item.status === "no-answer" || item.status === "busy" || item.status === "failed"
    ? "text-red-400" : isOutbound ? "text-emerald-400" : "text-blue-400";
  return (
    <div className={`flex gap-3 ${isSentByUs ? "flex-row-reverse" : "flex-row"}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${isSentByUs ? "bg-emerald-500/10" : "bg-blue-500/10"}`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div className={`max-w-[70%] space-y-1 ${isSentByUs ? "items-end" : "items-start"} flex flex-col`}>
        <div className={`rounded-2xl px-4 py-3 text-sm ${isSentByUs ? "bg-primary/10 border border-primary/20" : "bg-secondary border border-border"}`}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Icon className={`w-3 h-3 ${iconColor}`} />
            <span className="capitalize">{isOutbound ? "Outbound call" : "Inbound call"}</span>
            {item.duration ? <span>· {fmtDuration(item.duration)}</span> : null}
          </div>
          <div className="text-foreground font-medium">
            {item.status === "no-answer" ? "No Answer" :
             item.status === "busy" ? "Busy" :
             item.status === "failed" ? "Failed" :
             item.status === "completed" || item.status === "in-progress" ? "Connected" :
             item.status}
          </div>
          {item.transcript && (
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed line-clamp-3">{item.transcript}</p>
          )}
          {item.recordingUrl && <MiniPlayer url={item.recordingUrl} />}
        </div>
        <span className="text-[10px] text-muted-foreground px-1">
          {format(new Date(item.createdAt), "MMM d, h:mm a")}
        </span>
      </div>
    </div>
  );
}

// ─── SMS Bubble ────────────────────────────────────────────────────────────────

function SmsBubble({ item, ownedNumber }: { item: ThreadItem; ownedNumber: string }) {
  const ownedDigits = ownedNumber.replace(/\D/g, "").slice(-10);
  const fromDigits = (item.fromNumber || "").replace(/\D/g, "").slice(-10);
  const isOutgoing = fromDigits === ownedDigits || item.direction === "outgoing";
  return (
    <div className={`flex gap-3 ${isOutgoing ? "flex-row-reverse" : "flex-row"}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${isOutgoing ? "bg-primary/10" : "bg-secondary"}`}>
        <MessageSquare className={`w-4 h-4 ${isOutgoing ? "text-primary" : "text-muted-foreground"}`} />
      </div>
      <div className={`max-w-[72%] space-y-1 ${isOutgoing ? "items-end" : "items-start"} flex flex-col`}>
        <div className={`rounded-2xl px-4 py-2.5 text-sm ${isOutgoing ? "bg-primary text-primary-foreground" : "bg-secondary border border-border text-foreground"}`}>
          <p className="leading-relaxed">{item.content || "(empty)"}</p>
        </div>
        <span className="text-[10px] text-muted-foreground px-1">
          {format(new Date(item.createdAt), "MMM d, h:mm a")}
        </span>
      </div>
    </div>
  );
}

// ─── Dial Pad ─────────────────────────────────────────────────────────────────

function DialPad({
  onCall,
  onSms,
  fromNumber,
}: {
  onCall: (num: string) => void;
  onSms: (num: string) => void;
  fromNumber?: string;
}) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
  const subtext: Record<string, string> = {
    "2": "ABC", "3": "DEF", "4": "GHI", "5": "JKL",
    "6": "MNO", "7": "PQRS", "8": "TUV", "9": "WXYZ",
    "0": "+",
  };

  const appendChar = (ch: string) => {
    setInput(p => p.length < 20 ? p + ch : p);
  };

  const handleKey = (k: string) => {
    if (k === "0" && longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }
    appendChar(k);
    inputRef.current?.focus();
  };

  const handlePointerDown = (k: string) => {
    if (k !== "0") return;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      appendChar("+");
    }, 600);
  };

  const handlePointerUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cleaned = e.target.value.replace(/[^0-9+*#]/g, "").slice(0, 20);
    setInput(cleaned);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (input) onCall(input);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 py-6 px-4 max-w-xs mx-auto">
      {/* Display — real input for paste & direct typing */}
      <div className="w-full flex items-center gap-2 bg-secondary/60 border border-border rounded-2xl px-5 py-3.5 focus-within:ring-1 focus-within:ring-primary/40">
        <Keyboard className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        <input
          ref={inputRef}
          type="tel"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
          placeholder="Enter number"
          className="flex-1 bg-transparent font-mono text-xl text-center text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
        />
        {input ? (
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={() => setInput(p => p.slice(0, -1))}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <Delete className="w-4 h-4" />
          </button>
        ) : (
          <button
            onClick={() => appendChar("+")}
            className="text-muted-foreground hover:text-primary transition-colors font-mono text-lg font-bold leading-none"
            title="Add +"
          >
            +
          </button>
        )}
      </div>

      {/* Keys */}
      <div className="grid grid-cols-3 gap-3 w-full">
        {keys.map(k => (
          <button
            key={k}
            onClick={() => handleKey(k)}
            onPointerDown={() => handlePointerDown(k)}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className="flex flex-col items-center justify-center h-14 rounded-2xl bg-card border border-border hover:bg-secondary transition-colors active:scale-95 select-none"
          >
            <span className="text-xl font-semibold text-foreground leading-none">{k}</span>
            {subtext[k] && (
              <span className="text-[9px] text-muted-foreground tracking-widest mt-0.5">{subtext[k]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-3 w-full mt-1">
        <Button
          className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          disabled={!input}
          onClick={() => input && onCall(input)}
        >
          <PhoneCall className="w-4 h-4" />
          Call
        </Button>
        <Button
          variant="outline"
          className="flex-1 gap-2"
          disabled={!input}
          onClick={() => input && onSms(input)}
        >
          <MessageSquare className="w-4 h-4" />
          SMS
        </Button>
      </div>

      {fromNumber && (
        <p className="text-xs text-muted-foreground text-center">
          From: <span className="font-mono text-foreground">{fromNumber}</span>
        </p>
      )}
    </div>
  );
}

// ─── Conversation List Item ────────────────────────────────────────────────────

function ConversationItem({
  conv, selected, onClick,
}: { conv: Conversation; selected: boolean; onClick: () => void }) {
  const isSmsOnly = conv.totalCalls === 0 && conv.totalSms > 0;
  const isMixed = conv.totalCalls > 0 && conv.totalSms > 0;
  const lastTs = conv.lastActivity || conv.lastCall;
  const missedOrFailed = ["no-answer", "busy", "failed", "missed"].includes(conv.lastStatus);
  const hasUnread = (conv.unreadCount ?? 0) > 0;

  let Icon = conv.lastDirection === "inbound" ? PhoneIncoming : PhoneOutgoing;
  if (isSmsOnly) Icon = MessageSquare as any;

  let subtext = "";
  if (conv.lastSnippet && (isSmsOnly || (isMixed && conv.lastStatus === "sms"))) {
    subtext = conv.lastSnippet;
  } else {
    const parts: string[] = [];
    if (conv.totalCalls > 0) parts.push(`${conv.totalCalls} call${conv.totalCalls !== 1 ? "s" : ""}`);
    if (conv.totalSms > 0) parts.push(`${conv.totalSms} SMS`);
    if (conv.lastDuration) parts.push(fmtDuration(conv.lastDuration) ?? "");
    if (conv.hasRecording) parts.push("🎙");
    subtext = parts.filter(Boolean).join(" · ");
  }

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-secondary/60 ${selected ? "bg-primary/5 border-r-2 border-primary" : ""}`}
    >
      <div className="relative w-10 h-10 flex-shrink-0">
        <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary/20 to-accent/20 border border-border flex items-center justify-center">
          <User className="w-5 h-5 text-muted-foreground" />
        </div>
        {hasUnread && !selected && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-amber-500 text-[9px] font-bold text-white flex items-center justify-center leading-none">
            {conv.unreadCount! > 99 ? "99+" : conv.unreadCount}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={`font-medium text-sm truncate ${hasUnread && !selected ? "text-foreground font-semibold" : "text-foreground"}`}>
            {fmtPhone(conv.contact)}
          </span>
          {lastTs && (
            <span className={`text-[10px] flex-shrink-0 ${hasUnread && !selected ? "text-amber-500 font-medium" : "text-muted-foreground"}`}>
              {formatDistanceToNow(new Date(lastTs), { addSuffix: true })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Icon className={`w-3 h-3 flex-shrink-0 ${missedOrFailed ? "text-red-400" : isSmsOnly ? "text-sky-400" : "text-muted-foreground"}`} />
          <span className={`text-xs truncate ${missedOrFailed ? "text-red-400" : hasUnread && !selected ? "text-foreground" : "text-muted-foreground"}`}>
            {subtext}
          </span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        {conv.leadId && (
          <Badge className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20">Lead</Badge>
        )}
      </div>
    </button>
  );
}

// ─── Number Sidebar Item ───────────────────────────────────────────────────────

function NumberItem({
  num, selected, onClick,
}: { num: PhoneNumber; selected: boolean; onClick: () => void }) {
  const caps = num.capabilities ?? {};
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-secondary/60 ${selected ? "bg-primary/5 border-r-2 border-primary" : ""}`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${selected ? "bg-primary/10 border border-primary/20" : "bg-secondary border border-border"}`}>
        <Phone className={`w-4 h-4 ${selected ? "text-primary" : "text-muted-foreground"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-mono text-sm font-semibold text-foreground truncate">{num.number}</p>
        {num.name && num.name !== num.number && (
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{num.name}</p>
        )}
        <div className="flex gap-1 mt-1 flex-wrap">
          {caps.voice !== false && (
            <span className="text-[9px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded px-1.5 py-0.5">Voice</span>
          )}
          {caps.sms !== false && (
            <span className="text-[9px] bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded px-1.5 py-0.5">SMS</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ManualDialerPage() {
  const phone = usePhone();
  const { startCall } = phone;
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedNumber, setSelectedNumber] = useState<PhoneNumber | null>(null);
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [composeText, setComposeText] = useState("");
  const [showDialPad, setShowDialPad] = useState(false);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const prevPhoneStatus = useRef(phone.status);

  // ── Data queries — must be declared BEFORE effects that reference them ─────
  // (Declaring after a useEffect that lists them in its dep array causes a
  //  "Cannot access '…' before initialization" TDZ crash in the built bundle.)
  const { data: numbersData, isLoading: numbersLoading, isError: numbersError, error: numbersErr, refetch: refetchNumbers } =
    useQuery<{ phoneNumbers: PhoneNumber[] }>({
      queryKey: ["twilio-phone-numbers"],
      queryFn: () => apiRawFetch("/twilio/phone-numbers"),
      staleTime: 60_000,
    });

  // ── SSE-driven real-time conversation refresh (Phase 2.1) ─────────────────
  // Listens for new_inbound_sms and call_logged events pushed from the server
  // and immediately invalidates the conversation list — no 30s wait.
  useEffect(() => {
    const token = localStorage.getItem("crm_token");
    if (!token) return;

    const es = new EventSource(`/api/crm/events?token=${encodeURIComponent(token)}`);

    const handleSms = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { to?: string; from?: string };
        const ownedNumbers = numbersData?.phoneNumbers?.map(n => n.number) ?? [];
        const affectedNumber = ownedNumbers.find(num => {
          const d = num.replace(/\D/g, "");
          return (
            (data.to?.replace(/\D/g, "") ?? "").endsWith(d.slice(-10)) ||
            (data.from?.replace(/\D/g, "") ?? "").endsWith(d.slice(-10))
          );
        }) ?? selectedNumber?.number;
        if (affectedNumber) {
          qc.invalidateQueries({ queryKey: ["phone-number-convs", affectedNumber] });
          if (selectedContact) {
            qc.invalidateQueries({ queryKey: ["phone-number-history", affectedNumber, selectedContact] });
          }
        } else {
          qc.invalidateQueries({ queryKey: ["phone-number-convs"] });
        }
      } catch { /* ignore malformed */ }
    };

    const handleCallLogged = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { to?: string; from?: string };
        const ownedNumbers = numbersData?.phoneNumbers?.map(n => n.number) ?? [];
        const affectedNumber = ownedNumbers.find(num => {
          const d = num.replace(/\D/g, "");
          return (
            (data.to?.replace(/\D/g, "") ?? "").endsWith(d.slice(-10)) ||
            (data.from?.replace(/\D/g, "") ?? "").endsWith(d.slice(-10))
          );
        }) ?? selectedNumber?.number;
        if (affectedNumber) {
          qc.invalidateQueries({ queryKey: ["phone-number-convs", affectedNumber] });
          if (selectedContact) {
            qc.invalidateQueries({ queryKey: ["phone-number-history", affectedNumber, selectedContact] });
          }
        }
      } catch { /* ignore malformed */ }
    };

    es.addEventListener("new_inbound_sms", handleSms);
    es.addEventListener("call_logged", handleCallLogged);
    es.onerror = () => { /* SSE will auto-reconnect */ };

    return () => {
      es.removeEventListener("new_inbound_sms", handleSms);
      es.removeEventListener("call_logged", handleCallLogged);
      es.close();
    };
  }, [qc, selectedNumber?.number, selectedContact, numbersData?.phoneNumbers]);

  // ── Auto-refresh conversation list when a call ends ────────────────────────
  if (prevPhoneStatus.current !== phone.status) {
    const wasActive = prevPhoneStatus.current === "in-progress" || prevPhoneStatus.current === "calling";
    prevPhoneStatus.current = phone.status;
    if (wasActive && phone.status === "idle" && selectedNumber?.number) {
      const num = selectedNumber.number;
      const contact = selectedContact;
      setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["phone-number-convs", num] });
        if (contact) qc.invalidateQueries({ queryKey: ["phone-number-history", num, contact] });
      }, 3000);
    }
  }

  const { data: convsData, isLoading: convsLoading, refetch: refetchConvs } =
    useQuery<{ conversations: Conversation[]; total: number }>({
      queryKey: ["phone-number-convs", selectedNumber?.number],
      queryFn: () => apiRawFetch(`/twilio/phone-numbers/${encodeURIComponent(selectedNumber!.number)}/conversations`),
      enabled: !!selectedNumber,
      staleTime: 30_000,
      refetchInterval: 30_000,
    });

  const { data: historyData, isLoading: historyLoading } =
    useQuery<ContactHistory>({
      queryKey: ["phone-number-history", selectedNumber?.number, selectedContact],
      queryFn: () => apiRawFetch(`/twilio/phone-numbers/${encodeURIComponent(selectedNumber!.number)}/conversations/${encodeURIComponent(selectedContact!)}`),
      enabled: !!selectedNumber && !!selectedContact,
      staleTime: 15_000,
      refetchInterval: 20_000,
    });

  const markReadMutation = useMutation({
    mutationFn: ({ number, contact }: { number: string; contact: string }) =>
      apiRawFetch(
        `/twilio/phone-numbers/${encodeURIComponent(number)}/conversations/${encodeURIComponent(contact)}/read`,
        { method: "POST" }
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["phone-number-convs", selectedNumber?.number] });
    },
  });

  const sendSmsMutation = useMutation({
    mutationFn: ({ to, content }: { to: string; content: string }) =>
      apiRawFetch("/twilio/messages", {
        method: "POST",
        body: JSON.stringify({
          phoneNumberId: selectedNumber!.number,
          to,
          content,
          leadId: historyData?.lead?.id ?? null,
        }),
      }),
    onSuccess: () => {
      setComposeText("");
      qc.invalidateQueries({ queryKey: ["phone-number-history", selectedNumber?.number, selectedContact] });
      qc.invalidateQueries({ queryKey: ["phone-number-convs", selectedNumber?.number] });
      toast({ title: "Message sent" });
    },
    onError: (err: Error) => toast({ title: "Failed to send", description: err.message, variant: "destructive" }),
  });

  const numbers = numbersData?.phoneNumbers ?? [];
  const conversations = convsData?.conversations ?? [];
  const thread = historyData?.thread ?? [];

  const filteredConvs = search
    ? conversations.filter(c => c.contact.includes(search.replace(/\D/g, "")))
    : conversations;

  const handleSelectNumber = useCallback((num: PhoneNumber) => {
    setSelectedNumber(num);
    setSelectedContact(null);
    setShowDialPad(false);
  }, []);

  const handleSelectContact = useCallback((contact: string) => {
    setSelectedContact(contact);
    setShowDialPad(false);
    if (selectedNumber) {
      markReadMutation.mutate({ number: selectedNumber.number, contact });
    }
  }, [selectedNumber, markReadMutation]);

  const handleCall = (number?: string) => {
    const target = number || selectedContact;
    if (!target || !selectedNumber) return;
    startCall(target, null, fmtPhone(target), true);
    toast({ title: "Calling…", description: `Dialing ${fmtPhone(target)} from ${selectedNumber.number}` });
  };

  const handleSms = (number: string) => {
    setSelectedContact(number);
    setShowDialPad(false);
  };

  const handleSendSms = () => {
    if (!selectedContact || !composeText.trim() || !selectedNumber) return;
    sendSmsMutation.mutate({ to: selectedContact, content: composeText.trim() });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendSms();
    }
  };

  return (
    <div className="flex h-[calc(100vh-5rem)] -mx-4 md:-mx-8 -my-4 md:-my-8 overflow-hidden">

      {/* ── Left: Owned numbers ──────────────────────────────────────────── */}
      <div className="w-60 shrink-0 border-r border-border bg-card flex flex-col">
        <div className="px-4 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Numbers</span>
          </div>
          <button onClick={() => refetchNumbers()} className="text-muted-foreground hover:text-foreground transition-colors" title="Refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {numbersLoading ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : numbersError ? (
            <div className="px-4 py-6 text-center">
              <AlertCircle className="w-6 h-6 text-amber-400/60 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">{(numbersErr as any)?.message || "Could not load numbers"}</p>
              <Link href="/integrations/twilio">
                <Button variant="link" size="sm" className="text-xs mt-2">Configure Twilio →</Button>
              </Link>
            </div>
          ) : numbers.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <Phone className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-xs text-muted-foreground">No numbers found</p>
              <Link href="/integrations/twilio">
                <Button variant="link" size="sm" className="text-xs mt-1">Set up Twilio →</Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {numbers.map(num => (
                <NumberItem
                  key={num.sid || num.number}
                  num={num}
                  selected={selectedNumber?.number === num.number}
                  onClick={() => handleSelectNumber(num)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Middle: Conversations ─────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-border bg-background flex flex-col">
        {selectedNumber ? (
          <>
            <div className="px-4 py-3 border-b border-border">
              <div className="flex items-center justify-between mb-2.5">
                <div className="min-w-0">
                  <p className="font-mono font-semibold text-sm text-foreground truncate">{selectedNumber.number}</p>
                  {selectedNumber.name && selectedNumber.name !== selectedNumber.number && (
                    <p className="text-[11px] text-muted-foreground truncate">{selectedNumber.name}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => { setShowDialPad(true); setSelectedContact(null); }}
                    className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${showDialPad ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}
                    title="New conversation"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button onClick={() => refetchConvs()} className="text-muted-foreground hover:text-foreground">
                    <RefreshCw className={`w-3.5 h-3.5 ${convsLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search contacts…"
                  className="w-full bg-secondary border border-border rounded-lg pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Dial pad entry as first item when showDialPad */}
              {showDialPad && (
                <button
                  className="w-full flex items-center gap-3 px-4 py-3.5 text-left bg-primary/5 border-r-2 border-primary"
                  onClick={() => setShowDialPad(true)}
                >
                  <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                    <Plus className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm text-primary">New Conversation</p>
                    <p className="text-xs text-muted-foreground">Dial or text any number</p>
                  </div>
                </button>
              )}

              {convsLoading ? (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredConvs.length === 0 && !showDialPad ? (
                <div className="px-4 py-8 text-center">
                  <Phone className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No conversations yet</p>
                  <button onClick={() => setShowDialPad(true)} className="text-xs text-primary hover:underline mt-1">
                    Start one →
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {filteredConvs.map(conv => (
                    <ConversationItem
                      key={conv.contact}
                      conv={conv}
                      selected={!showDialPad && selectedContact === conv.contact}
                      onClick={() => handleSelectContact(conv.contact)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center px-6 text-center">
            <div>
              <Phone className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Select a phone number to view conversations</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Right: Thread / Dial Pad ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        <AnimatePresence mode="wait">

          {/* Dial Pad mode */}
          {showDialPad && selectedNumber ? (
            <motion.div
              key="dialpad"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              className="flex flex-col h-full"
            >
              <div className="px-6 py-4 border-b border-border bg-card/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <Plus className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">New Conversation</p>
                    <p className="text-xs text-muted-foreground">Call or send a message to any number</p>
                  </div>
                </div>
                <button onClick={() => setShowDialPad(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 flex items-center justify-center overflow-y-auto">
                <DialPad
                  fromNumber={selectedNumber.number}
                  onCall={num => { handleCall(num); setShowDialPad(false); }}
                  onSms={handleSms}
                />
              </div>
            </motion.div>
          ) : selectedContact && selectedNumber ? (

            /* Thread mode */
            <motion.div
              key={`thread-${selectedContact}`}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              className="flex flex-col h-full"
            >
              {/* Thread header */}
              <div className="px-6 py-4 border-b border-border bg-card/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary/20 to-accent/20 border border-border flex items-center justify-center">
                    <User className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{fmtPhone(selectedContact)}</p>
                    {historyData?.lead && (
                      <p className="text-xs text-muted-foreground truncate max-w-xs">
                        {historyData.lead.sellerName} · {historyData.lead.address}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {historyData?.lead && (
                    <Link href={`/leads/${historyData.lead.id}`}>
                      <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                        <ExternalLink className="w-3.5 h-3.5" /> View Lead
                      </Button>
                    </Link>
                  )}
                  <Button
                    size="sm"
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                    onClick={() => handleCall()}
                  >
                    <PhoneCall className="w-3.5 h-3.5" />
                    Call
                  </Button>
                </div>
              </div>

              {/* Thread items */}
              <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
                {historyLoading ? (
                  <div className="flex items-center justify-center h-24">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                ) : thread.length === 0 ? (
                  <div className="text-center py-12">
                    <MessageSquare className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">No messages or calls yet</p>
                    <p className="text-xs text-muted-foreground mt-1">Start the conversation below</p>
                  </div>
                ) : (
                  <>
                    {thread.map(item =>
                      item.type === "sms" ? (
                        <SmsBubble key={`sms-${item.id}`} item={item} ownedNumber={selectedNumber.number} />
                      ) : (
                        <CallBubble key={`call-${item.id}`} item={item} ownedNumber={selectedNumber.number} />
                      )
                    )}
                    <div ref={threadEndRef} />
                  </>
                )}
              </div>

              {/* Compose box */}
              <div className="px-4 py-3 border-t border-border bg-card/50">
                <div className="flex items-end gap-2">
                  <div className="flex-1 bg-secondary border border-border rounded-2xl px-4 py-2.5 flex items-end gap-2">
                    <textarea
                      value={composeText}
                      onChange={e => setComposeText(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={`Message ${fmtPhone(selectedContact)}…`}
                      rows={1}
                      className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none focus:outline-none max-h-28 leading-relaxed"
                      style={{ overflowY: composeText.split("\n").length > 3 ? "auto" : "hidden" }}
                    />
                  </div>
                  <Button
                    size="icon"
                    className="w-10 h-10 rounded-2xl bg-primary hover:bg-primary/80 flex-shrink-0"
                    disabled={!composeText.trim() || sendSmsMutation.isPending}
                    onClick={handleSendSms}
                  >
                    {sendSmsMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <div className="flex items-center justify-between mt-2 px-1">
                  <span className="text-[10px] text-muted-foreground">
                    From: <span className="font-mono">{selectedNumber.number}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {composeText.length}/1600 · Enter to send
                  </span>
                </div>
              </div>
            </motion.div>
          ) : (

            /* Empty state */
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex items-center justify-center px-8 text-center"
            >
              <div>
                <div className="w-20 h-20 rounded-3xl bg-primary/5 border border-primary/10 flex items-center justify-center mx-auto mb-5">
                  <PhoneCall className="w-9 h-9 text-primary/30" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">Manual Dialer</h3>
                <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                  {selectedNumber
                    ? "Select a conversation or click + to start a new call or message."
                    : "Choose a phone number on the left to get started."}
                </p>
                {selectedNumber && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4 gap-2"
                    onClick={() => setShowDialPad(true)}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    New Conversation
                  </Button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

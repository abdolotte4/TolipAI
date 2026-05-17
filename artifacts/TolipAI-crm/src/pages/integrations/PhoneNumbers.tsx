import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, Loader2, AlertCircle, Mic, MessageSquare, Image,
  PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed,
  Hash, RefreshCw, Clock, Voicemail, ChevronRight,
  User, Search, Play, Pause, Square, ExternalLink,
  ArrowLeft,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { usePhone } from "@/contexts/PhoneContext";
import { formatDistanceToNow, format } from "date-fns";
import { useRef } from "react";
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
  lastCall: string;
  lastDirection: string;
  lastStatus: string;
  lastDuration: number | null;
  leadId: number | null;
  hasRecording: boolean;
}

interface CallLog {
  id: number;
  callSid: string;
  fromNumber: string;
  toNumber: string;
  direction: string;
  status: string;
  duration: number | null;
  recordingUrl: string | null;
  recordingSid: string | null;
  transcript: string | null;
  disposition: string | null;
  leadId: number | null;
  createdAt: string;
}

interface ContactHistory {
  calls: CallLog[];
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

  const toggle = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { await el.play(); setPlaying(true); }
  };

  const stop = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause(); el.currentTime = 0;
    setPlaying(false); setProgress(0);
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-2 bg-secondary/40 rounded-lg px-3 py-2 mt-2">
      <audio
        ref={audioRef}
        src={proxyUrl}
        onTimeUpdate={e => setProgress(e.currentTarget.currentTime)}
        onDurationChange={e => setDuration(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
      />
      <button onClick={toggle} className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-primary-foreground hover:bg-primary/80 transition-colors flex-shrink-0">
        {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 ml-0.5" />}
      </button>
      <button onClick={stop} className="w-6 h-6 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:bg-secondary/80 flex-shrink-0">
        <Square className="w-2.5 h-2.5" />
      </button>
      <div
        className="flex-1 h-1.5 bg-border rounded-full cursor-pointer relative overflow-hidden"
        onClick={e => {
          if (!audioRef.current || !duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          audioRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
        }}
      >
        <div className="absolute inset-y-0 left-0 bg-primary rounded-full" style={{ width: duration > 0 ? `${(progress / duration) * 100}%` : "0%" }} />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
        {duration > 0 ? fmtTime(duration) : "—"}
      </span>
    </div>
  );
}

// ─── Call Bubble ───────────────────────────────────────────────────────────────

function CallBubble({ call, ownedNumber }: { call: CallLog; ownedNumber: string }) {
  const isOutbound = call.direction === "outbound";
  const ownedDigits = ownedNumber.replace(/\D/g, "").slice(-10);
  const fromDigits = (call.fromNumber || "").replace(/\D/g, "").slice(-10);
  const isSentByUs = fromDigits === ownedDigits;

  const Icon = isOutbound
    ? (call.status === "no-answer" || call.status === "busy" ? PhoneMissed : PhoneOutgoing)
    : PhoneIncoming;

  const iconColor = call.status === "no-answer" || call.status === "busy" || call.status === "failed"
    ? "text-red-400"
    : isOutbound ? "text-emerald-400" : "text-blue-400";

  return (
    <div className={`flex gap-3 ${isSentByUs ? "flex-row-reverse" : "flex-row"}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${
        isSentByUs ? "bg-emerald-500/10" : "bg-blue-500/10"
      }`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <div className={`max-w-[70%] space-y-1 ${isSentByUs ? "items-end" : "items-start"} flex flex-col`}>
        <div className={`rounded-2xl px-4 py-3 text-sm ${
          isSentByUs
            ? "bg-primary/10 border border-primary/20"
            : "bg-secondary border border-border"
        }`}>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Icon className={`w-3 h-3 ${iconColor}`} />
            <span className="capitalize">{isOutbound ? "Outbound call" : "Inbound call"}</span>
            {call.duration && <span>· {fmtDuration(call.duration)}</span>}
          </div>
          <div className="text-foreground font-medium">
            {call.status === "no-answer" ? "No Answer" :
             call.status === "busy" ? "Busy" :
             call.status === "failed" ? "Failed" :
             call.status === "completed" || call.status === "in-progress" ? "Connected" :
             call.status}
          </div>
          {call.transcript && (
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed line-clamp-3">{call.transcript}</p>
          )}
          {call.recordingUrl && (
            <MiniPlayer url={call.recordingUrl} />
          )}
        </div>
        <span className="text-[10px] text-muted-foreground px-1">
          {format(new Date(call.createdAt), "MMM d, h:mm a")}
        </span>
      </div>
    </div>
  );
}

// ─── Conversation List Item ────────────────────────────────────────────────────

function ConversationItem({
  conv,
  selected,
  onClick,
}: {
  conv: Conversation;
  selected: boolean;
  onClick: () => void;
}) {
  const Icon = conv.lastDirection === "inbound" ? PhoneIncoming : PhoneOutgoing;
  const missedOrFailed = ["no-answer", "busy", "failed", "missed"].includes(conv.lastStatus);

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-secondary/60 ${
        selected ? "bg-primary/5 border-r-2 border-primary" : ""
      }`}
    >
      <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary/20 to-accent/20 border border-border flex items-center justify-center flex-shrink-0">
        <User className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm text-foreground truncate">{fmtPhone(conv.contact)}</span>
          <span className="text-[10px] text-muted-foreground flex-shrink-0">
            {formatDistanceToNow(new Date(conv.lastCall), { addSuffix: true })}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <Icon className={`w-3 h-3 flex-shrink-0 ${missedOrFailed ? "text-red-400" : "text-muted-foreground"}`} />
          <span className={`text-xs truncate ${missedOrFailed ? "text-red-400" : "text-muted-foreground"}`}>
            {conv.totalCalls} call{conv.totalCalls !== 1 ? "s" : ""}
            {conv.lastDuration ? ` · ${fmtDuration(conv.lastDuration)}` : ""}
            {conv.hasRecording ? " · 🎙" : ""}
          </span>
        </div>
      </div>
      {conv.leadId && (
        <Badge className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/20 flex-shrink-0">Lead</Badge>
      )}
    </button>
  );
}

// ─── Number Sidebar Item ───────────────────────────────────────────────────────

function NumberItem({
  num,
  selected,
  onClick,
}: {
  num: PhoneNumber;
  selected: boolean;
  onClick: () => void;
}) {
  const caps = num.capabilities ?? {};
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-secondary/60 ${
        selected ? "bg-primary/5 border-r-2 border-primary" : ""
      }`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
        selected ? "bg-primary/10 border border-primary/20" : "bg-secondary border border-border"
      }`}>
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

export default function PhoneNumbersPage() {
  const { startCall } = usePhone();
  const { toast } = useToast();
  const [selectedNumber, setSelectedNumber] = useState<PhoneNumber | null>(null);
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const { data: numbersData, isLoading: numbersLoading, isError: numbersError, error: numbersErr, refetch: refetchNumbers } = useQuery<{ phoneNumbers: PhoneNumber[] }>({
    queryKey: ["twilio-phone-numbers"],
    queryFn: () => apiFetch("/twilio/phone-numbers"),
    staleTime: 60_000,
  });

  const { data: convsData, isLoading: convsLoading, refetch: refetchConvs } = useQuery<{ conversations: Conversation[]; total: number }>({
    queryKey: ["phone-number-convs", selectedNumber?.number],
    queryFn: () => apiFetch(`/twilio/phone-numbers/${encodeURIComponent(selectedNumber!.number)}/conversations`),
    enabled: !!selectedNumber,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: historyData, isLoading: historyLoading } = useQuery<ContactHistory>({
    queryKey: ["phone-number-history", selectedNumber?.number, selectedContact],
    queryFn: () => apiFetch(`/twilio/phone-numbers/${encodeURIComponent(selectedNumber!.number)}/conversations/${encodeURIComponent(selectedContact!)}`),
    enabled: !!selectedNumber && !!selectedContact,
    staleTime: 15_000,
  });

  const numbers = numbersData?.phoneNumbers ?? [];
  const conversations = convsData?.conversations ?? [];

  const filteredConvs = search
    ? conversations.filter(c => c.contact.includes(search.replace(/\D/g, "")))
    : conversations;

  const handleSelectNumber = useCallback((num: PhoneNumber) => {
    setSelectedNumber(num);
    setSelectedContact(null);
  }, []);

  const handleCall = () => {
    if (!selectedContact || !selectedNumber) return;
    startCall(selectedContact, selectedNumber.number);
    toast({ title: "Calling…", description: `Dialing ${fmtPhone(selectedContact)} from ${selectedNumber.number}` });
  };

  return (
    <div className="flex h-[calc(100vh-5rem)] -mx-4 md:-mx-8 -my-4 md:-my-8 overflow-hidden">

      {/* ── Left: Owned numbers ─────────────────────────────────────────── */}
      <div className="w-64 shrink-0 border-r border-border bg-card flex flex-col">
        <div className="px-4 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Hash className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">Phone Numbers</span>
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

      {/* ── Middle: Conversations ────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-border bg-background flex flex-col">
        {selectedNumber ? (
          <>
            <div className="px-4 py-4 border-b border-border">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-mono font-semibold text-sm text-foreground">{selectedNumber.number}</p>
                  {selectedNumber.name && selectedNumber.name !== selectedNumber.number && (
                    <p className="text-[11px] text-muted-foreground">{selectedNumber.name}</p>
                  )}
                </div>
                <button onClick={() => refetchConvs()} className="text-muted-foreground hover:text-foreground">
                  <RefreshCw className={`w-3.5 h-3.5 ${convsLoading ? "animate-spin" : ""}`} />
                </button>
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
              {convsLoading ? (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredConvs.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Phone className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">No calls found for this number</p>
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {filteredConvs.map(conv => (
                    <ConversationItem
                      key={conv.contact}
                      conv={conv}
                      selected={selectedContact === conv.contact}
                      onClick={() => setSelectedContact(conv.contact)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center px-6 text-center">
            <div>
              <Hash className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Select a number from the left to see its call history</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Right: Call Thread + Contact Info ────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {selectedContact && selectedNumber ? (
          <>
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
                  onClick={handleCall}
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  Call Now
                </Button>
              </div>
            </div>

            {/* Call thread */}
            <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
              {historyLoading ? (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : !historyData || historyData.calls.length === 0 ? (
                <div className="text-center py-12">
                  <Phone className="w-8 h-8 text-muted-foreground/20 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">No call history between these numbers</p>
                </div>
              ) : (
                <>
                  {[...historyData.calls].reverse().map(call => (
                    <CallBubble key={call.id} call={call} ownedNumber={selectedNumber.number} />
                  ))}
                </>
              )}
            </div>

            {/* Quick-dial bar */}
            <div className="px-6 py-4 border-t border-border bg-card/50">
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-secondary rounded-xl px-4 py-2.5 text-sm text-muted-foreground">
                  Calling from <span className="font-mono text-foreground">{selectedNumber.number}</span>
                </div>
                <Button
                  className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={handleCall}
                >
                  <PhoneCall className="w-4 h-4" />
                  Call {fmtPhone(selectedContact)}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center px-8 text-center">
            <div>
              <div className="w-16 h-16 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center mx-auto mb-4">
                <PhoneCall className="w-8 h-8 text-primary/30" />
              </div>
              <h3 className="font-semibold text-foreground mb-1">Select a conversation</h3>
              <p className="text-sm text-muted-foreground max-w-sm">
                {selectedNumber
                  ? "Click a contact from the middle panel to see the full call history"
                  : "Choose a phone number from the left sidebar, then select a contact"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Voicemail,
  PhoneIncoming,
  PhoneMissed,
  Play,
  Pause,
  Square,
  UserPlus,
  FileText,
  Clock,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp,
  Bot,
  Check,
  Search,
  Inbox,
  Phone,
} from "lucide-react";
import { apiRawFetch, apiFetch } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";

// ── Types ─────────────────────────────────────────────────────────────────────

interface VoicemailEntry {
  id: number;
  callSid: string;
  fromNumber: string;
  toNumber: string;
  duration: number | null;
  status: string;
  disposition: string | null;
  recordingUrl: string | null;
  recordingSid: string | null;
  transcript: string | null;
  aiCoachingSummary: string | null;
  leadId: number | null;
  campaignId: number | null;
  createdAt: string;
  updatedAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(sec: number | null) {
  if (!sec) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtPhone(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1"))
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10)
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

function dispositionLabel(disp: string | null, status: string) {
  if (disp === "ai_qualified") return { label: "AI Qualified", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
  if (disp === "ai_unqualified") return { label: "AI Unqualified", color: "bg-orange-500/10 text-orange-400 border-orange-500/20" };
  if (disp === "ai_pending") return { label: "AI In Progress", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" };
  if (disp === "inbound_lead") return { label: "Inbound Lead", color: "bg-purple-500/10 text-purple-400 border-purple-500/20" };
  if (status === "no-answer" || status === "missed") return { label: "Missed", color: "bg-red-500/10 text-red-400 border-red-500/20" };
  return { label: disp || status || "Unknown", color: "bg-secondary text-muted-foreground border-border" };
}

// ── Audio Player ──────────────────────────────────────────────────────────────

function AudioPlayer({ url, callSid }: { url: string; callSid: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);

  const toggle = async () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      setLoading(true);
      try {
        await el.play();
        setPlaying(true);
      } catch {
        // Autoplay blocked or error
      } finally {
        setLoading(false);
      }
    }
  };

  const stop = () => {
    const el = audioRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
    setPlaying(false);
    setProgress(0);
  };

  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    el.currentTime = pct * duration;
  };

  const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  return (
    <div className="flex items-center gap-3 bg-secondary/40 rounded-xl px-4 py-3 mt-3">
      <audio
        ref={audioRef}
        src={url}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration)}
        onEnded={() => { setPlaying(false); setProgress(0); }}
      />
      <button
        onClick={toggle}
        disabled={loading}
        className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground flex-shrink-0 hover:bg-primary/80 transition-colors disabled:opacity-50"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
      </button>
      <button
        onClick={stop}
        className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-muted-foreground flex-shrink-0 hover:bg-secondary/80 transition-colors"
      >
        <Square className="w-3 h-3" />
      </button>
      <div
        className="flex-1 h-2 bg-border rounded-full cursor-pointer relative overflow-hidden"
        onClick={seekTo}
      >
        <div
          className="absolute inset-y-0 left-0 bg-primary rounded-full transition-all"
          style={{ width: duration > 0 ? `${(progress / duration) * 100}%` : "0%" }}
        />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
        {duration > 0 ? `${fmtTime(progress)} / ${fmtTime(duration)}` : "—:——"}
      </span>
    </div>
  );
}

// ── Assign Lead Dialog ────────────────────────────────────────────────────────

function AssignLeadButton({ vm, onAssigned }: { vm: VoicemailEntry; onAssigned: () => void }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const createLead = async () => {
    if (!address.trim()) { toast({ title: "Address required", variant: "destructive" }); return; }
    setSubmitting(true);
    try {
      const res = await apiFetch("/leads", {
        method: "POST",
        body: JSON.stringify({
          sellerName: name.trim() || "Unknown (voicemail)",
          phone: vm.fromNumber,
          address: address.trim(),
          leadSource: "Inbound Voicemail",
          status: "new",
          notes: vm.transcript ? `Voicemail transcript:\n${vm.transcript}` : "Inbound voicemail — no transcript yet.",
        }),
      });
      toast({ title: "Lead created", description: `Created lead for ${address.trim()}` });
      onAssigned();
      setOpen(false);
      setLocation(`/leads/${res.id}`);
    } catch (e: any) {
      toast({ title: "Failed to create lead", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  if (vm.leadId) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setLocation(`/leads/${vm.leadId}`)}
        className="text-xs gap-1.5"
      >
        <Check className="w-3.5 h-3.5 text-emerald-400" />
        View Lead
      </Button>
    );
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="text-xs gap-1.5">
        <UserPlus className="w-3.5 h-3.5" />
        Create Lead
      </Button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-4"
            >
              <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                    <UserPlus className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground">Create Lead from Voicemail</h3>
                    <p className="text-xs text-muted-foreground">Caller: {fmtPhone(vm.fromNumber)}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Seller Name</label>
                    <input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Unknown (voicemail)"
                      className="mt-1 w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Property Address <span className="text-red-400">*</span></label>
                    <input
                      value={address}
                      onChange={e => setAddress(e.target.value)}
                      placeholder="123 Main St, Cleveland, OH 44101"
                      className="mt-1 w-full bg-secondary border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>
                  {vm.transcript && (
                    <div className="bg-secondary/50 rounded-xl p-3 border border-border">
                      <p className="text-xs text-muted-foreground font-medium mb-1">Transcript (will be added to notes)</p>
                      <p className="text-xs text-foreground leading-relaxed line-clamp-3">{vm.transcript}</p>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 mt-6">
                  <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button className="flex-1" onClick={createLead} disabled={submitting}>
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <UserPlus className="w-4 h-4 mr-2" />}
                    Create Lead
                  </Button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Voicemail Card ────────────────────────────────────────────────────────────

function VoicemailCard({ vm, onRefresh }: { vm: VoicemailEntry; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const { label, color } = dispositionLabel(vm.disposition, vm.status);
  const isAiHandled = vm.disposition?.startsWith("ai_");

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isAiHandled ? "bg-violet-500/10" : "bg-red-500/10"}`}>
                {isAiHandled
                  ? <Bot className="w-5 h-5 text-violet-400" />
                  : <PhoneMissed className="w-5 h-5 text-red-400" />
                }
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-foreground text-sm">{fmtPhone(vm.fromNumber)}</span>
                  <Badge variant="outline" className={`text-[10px] px-2 py-0 ${color}`}>{label}</Badge>
                  {vm.leadId && (
                    <Badge variant="outline" className="text-[10px] px-2 py-0 bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                      Lead #{vm.leadId}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatDistanceToNow(new Date(vm.createdAt), { addSuffix: true })}
                  </span>
                  {vm.duration && (
                    <span>{fmtDuration(vm.duration)}</span>
                  )}
                  {vm.toNumber && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      → {fmtPhone(vm.toNumber)}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <AssignLeadButton vm={vm} onAssigned={onRefresh} />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setExpanded(e => !e)}
                className="text-xs gap-1"
              >
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {/* Quick transcript preview */}
          {vm.transcript && !expanded && (
            <p className="mt-3 text-xs text-muted-foreground leading-relaxed line-clamp-2 pl-13">
              {vm.transcript}
            </p>
          )}

          {/* Recording player (always visible if recording exists) */}
          {vm.recordingUrl && (
            <AudioPlayer url={vm.recordingUrl} callSid={vm.callSid} />
          )}
        </div>

        {/* Expanded details */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="border-t border-border px-5 pb-5 pt-4 space-y-4">
                {/* Transcript */}
                {vm.transcript && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {isAiHandled ? "AI Transcript" : "Transcript"}
                      </span>
                    </div>
                    <div className="bg-secondary/40 rounded-xl p-3 border border-border">
                      <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{vm.transcript}</p>
                    </div>
                  </div>
                )}

                {/* AI Coaching/Qualification summary */}
                {vm.aiCoachingSummary && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Bot className="w-3.5 h-3.5 text-violet-400" />
                      <span className="text-xs font-semibold text-violet-400 uppercase tracking-wider">AI Analysis</span>
                    </div>
                    <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-3">
                      {(() => {
                        try {
                          const parsed = JSON.parse(vm.aiCoachingSummary);
                          return (
                            <div className="space-y-2 text-sm">
                              {parsed.score != null && (
                                <div className="flex items-center gap-2">
                                  <span className="text-muted-foreground">Score:</span>
                                  <span className="font-bold text-violet-300">{parsed.score}/10</span>
                                </div>
                              )}
                              {parsed.strengths && <p><span className="text-muted-foreground">Strengths:</span> {parsed.strengths}</p>}
                              {parsed.improvements && <p><span className="text-muted-foreground">Improve:</span> {parsed.improvements}</p>}
                              {parsed.followUpTask && <p><span className="text-muted-foreground">Next:</span> {parsed.followUpTask}</p>}
                              {parsed.suggestedOffer && <p><span className="text-muted-foreground">Suggested Offer:</span> <span className="font-semibold text-emerald-400">${Number(parsed.suggestedOffer).toLocaleString()}</span></p>}
                            </div>
                          );
                        } catch {
                          return <p className="text-sm text-foreground">{vm.aiCoachingSummary}</p>;
                        }
                      })()}
                    </div>
                  </div>
                )}

                {/* Call metadata */}
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div><span className="font-medium">Call SID:</span> <span className="font-mono text-[10px]">{vm.callSid}</span></div>
                  <div><span className="font-medium">Status:</span> {vm.status}</div>
                  <div><span className="font-medium">Received:</span> {format(new Date(vm.createdAt), "MMM d, yyyy h:mm a")}</div>
                  {vm.duration && <div><span className="font-medium">Duration:</span> {fmtDuration(vm.duration)}</div>}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const FILTER_OPTIONS = [
  { value: "all", label: "All Inbound" },
  { value: "missed", label: "Missed" },
  { value: "ai_handled", label: "AI Handled" },
  { value: "has_recording", label: "Has Recording" },
  { value: "unassigned", label: "Unassigned" },
];

export default function VoicemailInbox() {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [refresh, setRefresh] = useState(0);
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, error } = useQuery<{ voicemails: VoicemailEntry[]; total: number }>({
    queryKey: ["voicemail-inbox", refresh],
    queryFn: () => apiRawFetch("/twilio/voice/voicemails"),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const voicemails = data?.voicemails ?? [];

  const filtered = voicemails.filter(vm => {
    if (filter === "missed" && !["no-answer", "missed", "busy", "failed"].includes(vm.status) && !vm.disposition?.includes("unqualified")) return false;
    if (filter === "ai_handled" && !vm.disposition?.startsWith("ai_")) return false;
    if (filter === "has_recording" && !vm.recordingUrl) return false;
    if (filter === "unassigned" && vm.leadId) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!vm.fromNumber.includes(q) && !vm.toNumber.includes(q) && !(vm.transcript || "").toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const statsAll = voicemails.length;
  const statsMissed = voicemails.filter(v => ["no-answer", "missed", "busy", "failed"].includes(v.status)).length;
  const statsAi = voicemails.filter(v => v.disposition?.startsWith("ai_")).length;
  const statsRecorded = voicemails.filter(v => v.recordingUrl).length;
  const statsUnassigned = voicemails.filter(v => !v.leadId).length;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Voicemail className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Voicemail Inbox</h1>
            <p className="text-sm text-muted-foreground">Inbound calls, voicemails & AI-handled conversations</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { setRefresh(r => r + 1); qc.invalidateQueries({ queryKey: ["voicemail-inbox"] }); }}
          className="gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Total", value: statsAll, icon: PhoneIncoming, color: "text-primary" },
          { label: "Missed", value: statsMissed, icon: PhoneMissed, color: "text-red-400" },
          { label: "AI Handled", value: statsAi, icon: Bot, color: "text-violet-400" },
          { label: "Recorded", value: statsRecorded, icon: Voicemail, color: "text-blue-400" },
          { label: "Unassigned", value: statsUnassigned, icon: UserPlus, color: "text-amber-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="rounded-xl border-white/5 bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
                <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
              </div>
              <Icon className={`w-5 h-5 ${color} opacity-60`} />
            </div>
          </Card>
        ))}
      </div>

      {/* Filters + Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by phone or transcript…"
            className="w-full bg-secondary border border-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors border ${filter === opt.value ? "bg-primary/10 text-primary border-primary/30" : "bg-secondary text-muted-foreground border-border hover:text-foreground"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
          Failed to load voicemails. Please try again.
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
          <Inbox className="w-10 h-10 opacity-30" />
          <p className="text-sm">
            {voicemails.length === 0 ? "No inbound calls yet." : "No calls match the current filter."}
          </p>
          {voicemails.length === 0 && (
            <p className="text-xs opacity-70">
              Make sure your Twilio webhook is set to <code className="bg-secondary px-1 rounded">/api/twilio/voice/inbound</code>
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {voicemails.length} inbound calls
          </p>
          {filtered.map(vm => (
            <VoicemailCard key={vm.id} vm={vm} onRefresh={() => setRefresh(r => r + 1)} />
          ))}
        </div>
      )}
    </div>
  );
}

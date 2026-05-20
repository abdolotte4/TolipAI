import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Phone, PhoneCall, PhoneOff, PhoneMissed, SkipForward,
  Play, Square, ArrowLeft, Loader2, CheckCircle2, AlertCircle,
  VolumeX, Calendar, User, MapPin, DollarSign, Clock, BarChart2,
  ChevronRight, RefreshCw, Voicemail, Layers, Zap, Upload,
  FileSpreadsheet, Download, ChevronLeft, ChevronDown, PenLine,
  Hash, CheckCheck, List, MessageSquare,
} from "lucide-react";
import { apiRawFetch as apiFetch } from "@/lib/api";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCrmGetMe } from "@workspace/api-client-react";
import { usePhone } from "@/contexts/PhoneContext";

// ── Types ────────────────────────────────────────────────────────────────────

type Disposition = "answered" | "no_answer" | "voicemail" | "dnc" | "callback" | "skip";

const DISPOSITION_BUTTONS: {
  value: Disposition;
  label: string;
  icon: any;
  color: string;
}[] = [
  { value: "answered",  label: "Answered",    icon: PhoneCall,   color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20" },
  { value: "no_answer", label: "No Answer",   icon: PhoneMissed, color: "bg-amber-500/10 text-amber-400 border-amber-500/30 hover:bg-amber-500/20" },
  { value: "voicemail", label: "Voicemail",   icon: Voicemail,   color: "bg-blue-500/10 text-blue-400 border-blue-500/30 hover:bg-blue-500/20" },
  { value: "callback",  label: "Callback",    icon: Calendar,    color: "bg-purple-500/10 text-purple-400 border-purple-500/30 hover:bg-purple-500/20" },
  { value: "dnc",       label: "Do Not Call", icon: VolumeX,     color: "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20" },
  { value: "skip",      label: "Skip",        icon: SkipForward, color: "bg-secondary text-muted-foreground border-white/10 hover:bg-secondary/80" },
];

interface ListContact {
  id: number;
  name: string;
  address: string;
  phones: string[];
  notes: string;
  phoneDispos: Record<string, { dispo: string; ts: string }>;
  overallDispo: string | null;
}

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`text-xl font-bold ${color}`}>{value}</span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
    </div>
  );
}

// ── CSV Parser ────────────────────────────────────────────────────────────────

function parseCSV(raw: string): ListContact[] {
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map(h => h.trim().replace(/^"|"$/g, "").toLowerCase());

  const findCol = (...names: string[]) => {
    for (const n of names) {
      const i = headers.findIndex(h => h.includes(n));
      if (i !== -1) return i;
    }
    return -1;
  };

  const nameIdx    = findCol("name", "seller", "owner", "contact");
  const addressIdx = findCol("address", "addr", "property");
  const notesIdx   = findCol("notes", "note", "comment");
  const phoneIdxs: number[] = [];
  for (let p = 1; p <= 5; p++) {
    const i = findCol(`phone${p}`, `phone_${p}`, `ph${p}`, `number${p}`, `mobile${p}`);
    if (i !== -1) phoneIdxs.push(i);
  }
  // Fallback: any column with "phone" or "number" not already captured
  if (phoneIdxs.length === 0) {
    headers.forEach((h, i) => {
      if ((h.includes("phone") || h.includes("number") || h.includes("cell") || h.includes("mobile")) && !phoneIdxs.includes(i)) {
        phoneIdxs.push(i);
      }
    });
  }

  return lines.slice(1).map((line, idx) => {
    // Simple CSV parse (handles quoted fields)
    const cols: string[] = [];
    let cur = "";
    let inQuote = false;
    for (const ch of line + ",") {
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === "," && !inQuote) { cols.push(cur.trim()); cur = ""; continue; }
      cur += ch;
    }

    const get = (i: number) => (i >= 0 ? (cols[i] || "").trim() : "");
    const phones = phoneIdxs.map(i => get(i)).filter(Boolean);

    return {
      id: idx,
      name: get(nameIdx) || `Contact ${idx + 1}`,
      address: get(addressIdx) || "",
      phones,
      notes: get(notesIdx) || "",
      phoneDispos: {},
      overallDispo: null,
    } satisfies ListContact;
  }).filter(c => c.phones.length > 0 || c.name !== `Contact ${c.id + 1}`);
}

function exportCSV(contacts: ListContact[]): void {
  const maxPhones = Math.max(...contacts.map(c => c.phones.length), 1);
  const phoneHeaders = Array.from({ length: maxPhones }, (_, i) => `Phone${i + 1}`);
  const phoneDispoHeaders = Array.from({ length: maxPhones }, (_, i) => `Phone${i + 1}_Dispo`);
  const headers = ["Name", "Address", ...phoneHeaders, ...phoneDispoHeaders, "Overall_Dispo", "Notes"];

  const rows = contacts.map(c => {
    const phones = phoneHeaders.map((_, i) => c.phones[i] || "");
    const dispos = phoneHeaders.map((_, i) => {
      const p = c.phones[i];
      return p ? (c.phoneDispos[p]?.dispo || "") : "";
    });
    return [c.name, c.address, ...phones, ...dispos, c.overallDispo || "", c.notes];
  });

  const csv = [headers, ...rows].map(row =>
    row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")
  ).join("\n");

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `list_dialer_results_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── List Dialer Component ─────────────────────────────────────────────────────

function ListDialer() {
  const { toast } = useToast();
  const { startCall, status: callStatus, activeLeadName } = usePhone();

  const [step, setStep] = useState<"setup" | "active" | "done">("setup");
  const [csvText, setCsvText] = useState("");
  const [contacts, setContacts] = useState<ListContact[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [currentPhoneIdx, setCurrentPhoneIdx] = useState(0);
  const [isCalling, setIsCalling] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [autoSmsEnabled, setAutoSmsEnabled] = useState(false);
  const [autoSmsFrom, setAutoSmsFrom] = useState("");
  const [autoSmsTemplate, setAutoSmsTemplate] = useState(
    "Hi, I just tried to reach you regarding your property. Feel free to call me back at your convenience!"
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setCsvText(ev.target?.result as string || ""); };
    reader.readAsText(file);
  };

  const handleStart = () => {
    const parsed = parseCSV(csvText);
    if (parsed.length === 0) {
      toast({ title: "No contacts found", description: "Check your CSV format — need Name, Address, Phone1 columns.", variant: "destructive" });
      return;
    }
    setContacts(parsed);
    setCurrentIdx(0);
    setCurrentPhoneIdx(0);
    setStep("active");
    toast({ title: `${parsed.length} contacts loaded`, description: "Ready to dial." });
  };

  const current = contacts[currentIdx];

  const handleCall = async () => {
    if (!current || isCalling) return;
    const phone = current.phones[currentPhoneIdx];
    if (!phone) return;
    setIsCalling(true);
    try {
      await startCall(phone, null, current.name, true);
    } catch {
      toast({ title: "Call failed", variant: "destructive" });
    } finally {
      setIsCalling(false);
    }
  };

  const handleDispo = (dispo: Disposition) => {
    if (!current) return;
    const phone = current.phones[currentPhoneIdx];

    setContacts(prev => prev.map((c, i) => {
      if (i !== currentIdx) return c;
      const newPhoneDispos = { ...c.phoneDispos };
      if (phone) {
        newPhoneDispos[phone] = { dispo, ts: new Date().toISOString() };
      }
      const allDispos = Object.values(newPhoneDispos).map(d => d.dispo);
      const overallDispo = allDispos.includes("answered") ? "answered"
        : allDispos.includes("callback") ? "callback"
        : allDispos.includes("voicemail") ? "voicemail"
        : allDispos.includes("dnc") ? "dnc"
        : allDispos.every(d => d === "no_answer") ? "no_answer"
        : null;
      return { ...c, phoneDispos: newPhoneDispos, overallDispo: overallDispo || c.overallDispo, notes: noteInput || c.notes };
    }));

    setNoteInput("");

    if (autoSmsEnabled && autoSmsFrom && phone && (dispo === "no_answer" || dispo === "voicemail")) {
      apiFetch("/twilio/auto-missed-call-sms", {
        method: "POST",
        body: JSON.stringify({ to: phone, from: autoSmsFrom, message: autoSmsTemplate }),
      }).then(() => {
        toast({ title: "Auto-SMS sent", description: `Follow-up sent to ${phone}` });
      }).catch(() => {
        toast({ title: "Auto-SMS failed", description: "Could not send follow-up text.", variant: "destructive" });
      });
    }

    // If there are more phones and this wasn't answered/dnc, move to next phone
    const hasMorePhones = currentPhoneIdx < current.phones.length - 1;
    if (hasMorePhones && dispo !== "answered" && dispo !== "dnc" && dispo !== "callback") {
      setCurrentPhoneIdx(p => p + 1);
      return;
    }

    // Move to next contact
    if (currentIdx < contacts.length - 1) {
      setCurrentIdx(i => i + 1);
      setCurrentPhoneIdx(0);
    } else {
      setStep("done");
    }
  };

  const handleNavContact = (dir: "prev" | "next") => {
    if (dir === "prev" && currentIdx > 0) {
      setCurrentIdx(i => i - 1);
      setCurrentPhoneIdx(0);
    } else if (dir === "next" && currentIdx < contacts.length - 1) {
      setCurrentIdx(i => i + 1);
      setCurrentPhoneIdx(0);
    }
  };

  // ── Setup Step ──────────────────────────────────────────────────────────────
  if (step === "setup") {
    return (
      <div className="space-y-5 max-w-2xl">
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-5 border-b border-border bg-secondary/20">
            <h2 className="font-semibold flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-primary" />
              Upload Contact List
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              CSV with columns: <span className="font-mono text-foreground">Name, Address, Phone1, Phone2…Phone5</span>
            </p>
          </div>
          <div className="p-5 space-y-4">
            <div className="border-2 border-dashed border-white/10 rounded-xl p-6 text-center hover:border-primary/30 transition-colors cursor-pointer"
              onClick={() => fileRef.current?.click()}>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileUpload} />
              <Upload className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm font-medium text-muted-foreground">Click to upload CSV</p>
              <p className="text-xs text-muted-foreground/60 mt-1">or paste your data below</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Or paste CSV data</Label>
              <textarea
                className="w-full h-40 bg-background/50 border border-border rounded-xl px-3 py-2.5 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
                placeholder={`Name,Address,Phone1,Phone2,Phone3\nJohn Smith,123 Oak St Tampa FL,+18135551234,+18135555678,\nMary Jones,456 Pine Ave Orlando FL,+14075559876,,`}
                value={csvText}
                onChange={e => setCsvText(e.target.value)}
              />
            </div>

            {csvText && (() => {
              const preview = parseCSV(csvText);
              return preview.length > 0 ? (
                <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-2">
                  <CheckCheck className="w-4 h-4 flex-shrink-0" />
                  <span><strong>{preview.length}</strong> contacts parsed · up to <strong>{Math.max(...preview.map(c => c.phones.length))}</strong> phones each</span>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-400">
                  Could not parse contacts. Check your CSV has Name, Address, Phone1 columns.
                </div>
              );
            })()}

            {/* Missed Call Auto-SMS */}
            <div className="rounded-xl border border-border bg-secondary/20 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Missed Call Auto-SMS</p>
                    <p className="text-xs text-muted-foreground">Auto-text on No Answer / Voicemail</p>
                  </div>
                </div>
                <button
                  onClick={() => setAutoSmsEnabled(e => !e)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${autoSmsEnabled ? "bg-primary" : "bg-secondary border border-border"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${autoSmsEnabled ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
              {autoSmsEnabled && (
                <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Your Twilio From Number</Label>
                    <Input
                      className="bg-background/50 rounded-xl font-mono text-xs"
                      placeholder="+15551234567"
                      value={autoSmsFrom}
                      onChange={e => setAutoSmsFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Message Template</Label>
                    <textarea
                      className="w-full h-20 bg-background/50 border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
                      value={autoSmsTemplate}
                      onChange={e => setAutoSmsTemplate(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">Sent automatically after No Answer or Voicemail dispositions.</p>
                  </div>
                </div>
              )}
            </div>

            <Button
              className="w-full gap-2"
              disabled={!csvText.trim() || parseCSV(csvText).length === 0}
              onClick={handleStart}
            >
              <Play className="w-4 h-4" />
              Start Dialing
            </Button>
          </div>
        </Card>

        {/* Sample format */}
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-4 border-b border-border bg-secondary/10">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">CSV Format Guide</p>
          </div>
          <div className="p-4 overflow-x-auto">
            <table className="text-[11px] w-full">
              <thead>
                <tr className="border-b border-border">
                  {["Name", "Address", "Phone1", "Phone2", "Phone3", "Phone4", "Phone5"].map(h => (
                    <th key={h} className="text-left px-2 py-1.5 text-muted-foreground font-mono font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["John Smith", "123 Oak St, Tampa FL", "+18135551234", "+18135555678", "", "", ""],
                  ["Mary Jones", "456 Pine, Orlando FL", "+14075559876", "+14075553210", "+14075558888", "", ""],
                ].map((row, i) => (
                  <tr key={i} className="border-b border-border/50">
                    {row.map((cell, j) => (
                      <td key={j} className="px-2 py-1.5 font-mono text-foreground/70">{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  }

  // ── Done Step ───────────────────────────────────────────────────────────────
  if (step === "done") {
    const answered  = contacts.filter(c => c.overallDispo === "answered").length;
    const voicemail = contacts.filter(c => c.overallDispo === "voicemail").length;
    const noAnswer  = contacts.filter(c => c.overallDispo === "no_answer").length;
    const callbacks = contacts.filter(c => c.overallDispo === "callback").length;
    const dnc       = contacts.filter(c => c.overallDispo === "dnc").length;

    return (
      <div className="space-y-5 max-w-2xl">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
          <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
            <div className="p-8 text-center space-y-4">
              <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto" />
              <h2 className="text-2xl font-display font-bold">List Complete</h2>
              <p className="text-muted-foreground">You've dialed through all {contacts.length} contacts.</p>
              <div className="grid grid-cols-5 gap-4 mt-6 pt-6 border-t border-border">
                <StatBadge label="Total"    value={contacts.length} color="text-foreground" />
                <StatBadge label="Answered" value={answered}  color="text-emerald-400" />
                <StatBadge label="VM"       value={voicemail} color="text-blue-400" />
                <StatBadge label="No Ans"   value={noAnswer}  color="text-amber-400" />
                <StatBadge label="Callback" value={callbacks} color="text-purple-400" />
              </div>
              <div className="flex gap-3 mt-2 justify-center">
                <Button variant="outline" className="gap-2" onClick={() => exportCSV(contacts)}>
                  <Download className="w-4 h-4" /> Export Results CSV
                </Button>
                <Button onClick={() => { setStep("setup"); setCsvText(""); setContacts([]); }}>
                  Start New List
                </Button>
              </div>
            </div>
          </Card>
        </motion.div>

        {/* Results table */}
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-4 border-b border-border bg-secondary/10 flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Results</p>
            <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" onClick={() => exportCSV(contacts)}>
              <Download className="w-3 h-3" /> Export
            </Button>
          </div>
          <div className="divide-y divide-border max-h-80 overflow-y-auto">
            {contacts.map((c, i) => (
              <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{c.address}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {c.phones.map((p, pi) => {
                      const d = c.phoneDispos[p]?.dispo;
                      return (
                        <span key={pi} className={`text-[9px] px-1.5 py-0.5 rounded font-mono border ${
                          d === "answered" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                          d === "voicemail" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                          d === "callback" ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                          d === "dnc" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                          d === "no_answer" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                          "bg-secondary text-muted-foreground border-white/10"
                        }`}>
                          {p.slice(-7)} {d ? `· ${d.replace("_", " ")}` : "· pending"}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <Badge className={`text-[10px] shrink-0 border ${
                  c.overallDispo === "answered" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                  c.overallDispo === "callback" ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                  c.overallDispo === "voicemail" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                  c.overallDispo === "dnc" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                  c.overallDispo === "no_answer" ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                  "bg-secondary text-muted-foreground border-white/10"
                }`}>
                  {c.overallDispo?.replace("_", " ") || "pending"}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  // ── Active Step ─────────────────────────────────────────────────────────────
  if (!current) return null;
  const currentPhone = current.phones[currentPhoneIdx];
  const progress = Math.round((currentIdx / contacts.length) * 100);
  const isOnCall = callStatus === "in-progress" || callStatus === "calling";

  return (
    <div className="space-y-4 pb-24 max-w-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-xl border border-white/10 bg-card hover:bg-secondary"
            onClick={() => { if (confirm("End this list dialing session?")) setStep("setup"); }}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-display font-bold flex items-center gap-2">
              <List className="w-5 h-5 text-primary" /> List Dialer
            </h1>
            <p className="text-xs text-muted-foreground">
              Contact {currentIdx + 1} of {contacts.length}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-8" onClick={() => exportCSV(contacts)}>
            <Download className="w-3.5 h-3.5" /> Export
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs h-8"
            onClick={() => { if (confirm("End session?")) setStep("done"); }}>
            <Square className="w-3.5 h-3.5" /> End
          </Button>
        </div>
      </div>

      {/* Progress */}
      <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      {/* Quick stats */}
      <Card className="rounded-xl border-white/5 bg-card p-3">
        <div className="grid grid-cols-4 gap-3 text-center">
          {[
            { label: "Total", value: contacts.length, color: "text-foreground" },
            { label: "Answered", value: contacts.filter(c => c.overallDispo === "answered").length, color: "text-emerald-400" },
            { label: "Callback", value: contacts.filter(c => c.overallDispo === "callback").length, color: "text-purple-400" },
            { label: "Remaining", value: contacts.length - currentIdx, color: "text-muted-foreground" },
          ].map(({ label, value, color }) => (
            <div key={label} className="flex flex-col items-center gap-0.5">
              <span className={`text-lg font-bold ${color}`}>{value}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Contact Card */}
      <AnimatePresence mode="wait">
        <motion.div key={current.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
          <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
            <div className="p-5 border-b border-border bg-secondary/20 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <User className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">{current.name}</p>
                  {current.address && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="w-3 h-3" /> {current.address}
                    </p>
                  )}
                </div>
              </div>
              {/* Contact navigation */}
              <div className="flex items-center gap-1">
                <button disabled={currentIdx === 0}
                  onClick={() => handleNavContact("prev")}
                  className="w-7 h-7 rounded-lg bg-secondary border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button disabled={currentIdx === contacts.length - 1}
                  onClick={() => handleNavContact("next")}
                  className="w-7 h-7 rounded-lg bg-secondary border border-border flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {/* Phone numbers */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Phone Numbers</p>
                <div className="space-y-2">
                  {current.phones.map((phone, pi) => {
                    const isActive = pi === currentPhoneIdx;
                    const dispo = current.phoneDispos[phone]?.dispo;
                    return (
                      <div key={pi}
                        onClick={() => !isOnCall && setCurrentPhoneIdx(pi)}
                        className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                          isActive
                            ? "bg-primary/10 border-primary/30"
                            : "bg-secondary/30 border-white/5 hover:bg-secondary/50"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                            isActive ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"
                          }`}>
                            {pi + 1}
                          </div>
                          <span className="font-mono text-sm text-foreground">{phone}</span>
                        </div>
                        {dispo ? (
                          <Badge className={`text-[10px] border shrink-0 ${
                            dispo === "answered" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                            dispo === "voicemail" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                            dispo === "callback" ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                            dispo === "dnc" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                            "bg-amber-500/10 text-amber-400 border-amber-500/20"
                          }`}>{dispo.replace("_", " ")}</Badge>
                        ) : isActive ? (
                          <Badge className="text-[10px] border bg-primary/10 text-primary border-primary/20">Active</Badge>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Current number calling display */}
              {currentPhone && (
                <div className="p-3 rounded-xl bg-secondary/20 border border-white/5">
                  <p className="text-[11px] text-muted-foreground mb-1">Currently dialing</p>
                  <p className="font-mono font-semibold text-foreground">{currentPhone}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Phone {currentPhoneIdx + 1} of {current.phones.length}
                  </p>
                </div>
              )}

              {/* Call button or in-progress indicator */}
              {isOnCall ? (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Call in progress with {activeLeadName || current.name}
                </div>
              ) : (
                <Button className="w-full gap-2 mt-1" disabled={!currentPhone || isCalling} onClick={handleCall}>
                  {isCalling ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneCall className="w-4 h-4" />}
                  {currentPhone ? `Call ${currentPhone}` : "No phone available"}
                </Button>
              )}

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                  <PenLine className="w-3 h-3" /> Notes
                </Label>
                <textarea
                  className="w-full h-16 bg-background/50 border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
                  placeholder="Add call notes…"
                  value={noteInput || current.notes}
                  onChange={e => setNoteInput(e.target.value)}
                />
              </div>
            </div>
          </Card>
        </motion.div>
      </AnimatePresence>

      {/* Disposition buttons */}
      <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
        <div className="p-4 border-b border-border bg-secondary/10">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Log Disposition & Advance</p>
        </div>
        <div className="p-4 grid grid-cols-3 gap-2">
          {DISPOSITION_BUTTONS.map(({ value, label, icon: Icon, color }) => (
            <Button key={value} variant="outline" className={`gap-1.5 h-10 text-xs font-medium border ${color}`}
              onClick={() => handleDispo(value)}>
              <Icon className="w-3.5 h-3.5" />
              {label}
            </Button>
          ))}
        </div>
      </Card>

      {/* History for this contact */}
      {Object.keys(current.phoneDispos).length > 0 && (
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-4 border-b border-border bg-secondary/10">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">This Contact's History</p>
          </div>
          <div className="divide-y divide-border">
            {Object.entries(current.phoneDispos).map(([phone, { dispo, ts }]) => (
              <div key={phone} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-muted-foreground">{phone}</span>
                <Badge className={`text-[10px] border ${
                  dispo === "answered" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                  dispo === "voicemail" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" :
                  dispo === "callback" ? "bg-purple-500/10 text-purple-400 border-purple-500/20" :
                  dispo === "dnc" ? "bg-red-500/10 text-red-400 border-red-500/20" :
                  "bg-amber-500/10 text-amber-400 border-amber-500/20"
                }`}>{dispo.replace("_", " ")}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── CRM Dialer (original) ─────────────────────────────────────────────────────

function CRMDialer() {
  const { toast } = useToast();
  const { data: me } = useCrmGetMe();
  const { startCall, status: browserCallStatus } = usePhone();

  const [callMode, setCallMode] = useState<"browser" | "bridge">("browser");
  const [agentPhone, setAgentPhone] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>(["new", "contacted", "follow_up"]);
  const [lines, setLines] = useState(1);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [disposingId, setDisposingId] = useState<Disposition | null>(null);

  const [autoSmsEnabled, setAutoSmsEnabled] = useState(false);
  const [autoSmsFrom, setAutoSmsFrom] = useState("");
  const [autoSmsTemplate, setAutoSmsTemplate] = useState(
    "Hi, I just tried to reach you regarding your property. Feel free to call me back at your convenience!"
  );
  const pendingLeadRef = useRef<any>(null);

  const { data: session, isLoading: sessionLoading, refetch: refetchSession } = useQuery<any>({
    queryKey: ["power-dial-session", sessionId],
    queryFn: () => apiFetch(`/twilio/voice/power-dial/session/${sessionId}`),
    enabled: !!sessionId,
    refetchInterval: sessionId ? 5000 : false,
  });

  // Listen for auto-advance SSE events so the UI updates instantly without waiting for the poll
  useEffect(() => {
    if (!sessionId) return;
    const token = localStorage.getItem("crm_token");
    if (!token) return;
    const es = new EventSource(`/api/crm/events?token=${encodeURIComponent(token)}`);
    es.addEventListener("power_dial_call_ended", (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        if (d.sessionId !== sessionId) return;
        const durSec = d.callDuration ?? 0;
        const mins = Math.floor(durSec / 60);
        const secs = durSec % 60;
        const durStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
        const disp = d.disposition === "answered" ? "Answered" : "No Answer";
        if (d.done) {
          toast({ title: "Session complete!", description: `All leads dialed.` });
        } else {
          toast({
            title: `Call ended (${durStr}) · ${disp}`,
            description: d.nextLeadName ? `Next: ${d.nextLeadName}` : "Moving to next lead…",
          });
        }
        refetchSession();
      } catch { }
    });
    return () => es.close();
  }, [sessionId, refetchSession, toast]);

  const startMutation = useMutation({
    mutationFn: () => apiFetch("/twilio/voice/power-dial/session", {
      method: "POST",
      body: JSON.stringify({
        callMode,
        agentPhone: callMode === "bridge" ? agentPhone : undefined,
        filters: { status: statusFilter },
        lines,
      }),
    }),
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      toast({ title: `Power Session started — ${data.total} leads queued` });
    },
    onError: (err: Error) =>
      toast({ title: "Failed to start session", description: err.message, variant: "destructive" }),
  });

  const callMutation = useMutation({
    mutationFn: async () => {
      if (callMode === "browser") {
        // Browser call: use Twilio SDK directly — no need for the bridge API
        const lead = session?.currentLead;
        if (!lead?.phone) throw new Error("No phone number for current lead");
        await startCall(lead.phone, lead.id ?? null, lead.name ?? lead.phone, true);
        return { leadPhone: lead.phone };
      }
      return apiFetch(`/twilio/voice/power-dial/session/${sessionId}/call`, { method: "POST" });
    },
    onMutate: () => setCalling(true),
    onSettled: () => setCalling(false),
    onSuccess: (data) => {
      const desc = callMode === "bridge"
        ? "Your phone will ring first, then the lead."
        : "Browser call connected.";
      toast({ title: `Calling ${(data as any).leadPhone}`, description: desc });
      if (callMode === "bridge") refetchSession();
    },
    onError: (err: Error) =>
      toast({ title: "Call failed", description: err.message, variant: "destructive" }),
  });

  const disposeMutation = useMutation({
    mutationFn: (disposition: Disposition) =>
      apiFetch(`/twilio/voice/power-dial/session/${sessionId}/disposition`, {
        method: "POST",
        body: JSON.stringify({ disposition }),
      }),
    onMutate: (d) => {
      setDisposingId(d);
      pendingLeadRef.current = session?.currentLead;
    },
    onSettled: () => setDisposingId(null),
    onSuccess: (data, disposition) => {
      if (autoSmsEnabled && autoSmsFrom && (disposition === "no_answer" || disposition === "voicemail")) {
        const phone = pendingLeadRef.current?.phone;
        const leadId = pendingLeadRef.current?.id;
        if (phone) {
          apiFetch("/twilio/auto-missed-call-sms", {
            method: "POST",
            body: JSON.stringify({ to: phone, from: autoSmsFrom, message: autoSmsTemplate, leadId }),
          }).then(() => {
            toast({ title: "Auto-SMS sent", description: `Follow-up sent to ${phone}` });
          }).catch(() => {
            toast({ title: "Auto-SMS failed", description: "Could not send follow-up text.", variant: "destructive" });
          });
        }
      }
      if (data.done) {
        toast({ title: "Session complete!", description: `All ${data.stats?.total} leads have been dialed.` });
      }
      refetchSession();
    },
    onError: (err: Error) =>
      toast({ title: "Disposition failed", description: err.message, variant: "destructive" }),
  });

  const endMutation = useMutation({
    mutationFn: () => apiFetch(`/twilio/voice/power-dial/session/${sessionId}`, { method: "DELETE" }),
    onSuccess: () => { setSessionId(null); toast({ title: "Session ended" }); },
  });

  const toggleStatus = (s: string) =>
    setStatusFilter((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]);

  const done = session && session.currentIndex >= session.total;
  const currentLead = session?.currentLead;

  if (!sessionId) {
    return (
      <div className="space-y-6 pb-20 max-w-2xl">
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-5 border-b border-border bg-secondary/20">
            <h2 className="font-semibold">Session Setup</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Configure who to call and where to reach you.</p>
          </div>
          <div className="p-5 space-y-5">
            {/* Call Mode Toggle */}
            <div className="space-y-2">
              <Label>Call Mode</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setCallMode("browser")}
                  className={`py-2.5 rounded-xl text-sm font-medium border transition-colors flex items-center justify-center gap-2 ${
                    callMode === "browser"
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-secondary text-muted-foreground border-white/10 hover:bg-secondary/80"
                  }`}
                >
                  <PhoneCall className="w-3.5 h-3.5" />
                  Browser Call
                </button>
                <button
                  onClick={() => setCallMode("bridge")}
                  className={`py-2.5 rounded-xl text-sm font-medium border transition-colors flex items-center justify-center gap-2 ${
                    callMode === "bridge"
                      ? "bg-primary/10 text-primary border-primary/30"
                      : "bg-secondary text-muted-foreground border-white/10 hover:bg-secondary/80"
                  }`}
                >
                  <Phone className="w-3.5 h-3.5" />
                  Bridge (Phone)
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {callMode === "browser"
                  ? "Calls go through your browser using your microphone."
                  : "Twilio calls your physical phone first, then bridges to the lead."}
              </p>
            </div>

            {/* Bridge mode: physical phone number input */}
            {callMode === "bridge" && (
              <div className="space-y-2">
                <Label>Your Phone Number</Label>
                <Input className="bg-background/50 rounded-xl font-mono" placeholder="+15551234567"
                  value={agentPhone} onChange={e => setAgentPhone(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">Twilio will call <strong>this number</strong> first. When you answer, it bridges to the lead.</p>
              </div>
            )}
            <div className="space-y-2">
              <Label>Lead Status Filter</Label>
              <div className="flex flex-wrap gap-2">
                {[
                  { value: "new", label: "New" },
                  { value: "contacted", label: "Contacted" },
                  { value: "follow_up", label: "Follow Up" },
                  { value: "negotiating", label: "Negotiating" },
                ].map(({ value, label }) => (
                  <button key={value} onClick={() => toggleStatus(value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      statusFilter.includes(value)
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "bg-secondary text-muted-foreground border-white/10 hover:bg-secondary/80"
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">Only leads with a phone number will be dialed (up to 200 per session).</p>
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-muted-foreground" />
                Simultaneous Lines
                {lines > 1 && (
                  <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded px-1.5 py-0.5 font-normal flex items-center gap-1">
                    <Zap className="w-2.5 h-2.5" /> Power Mode
                  </span>
                )}
              </Label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(n => (
                  <button key={n} onClick={() => setLines(n)}
                    className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                      lines === n
                        ? n === 1 ? "bg-primary/10 text-primary border-primary/30" : "bg-amber-500/10 text-amber-400 border-amber-500/30"
                        : "bg-secondary text-muted-foreground border-white/10 hover:bg-secondary/80"
                    }`}>
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {lines === 1 ? "Single-line mode: dials one lead at a time." : `Multi-line mode: dials ${lines} leads simultaneously.`}
              </p>
            </div>
            {/* Missed Call Auto-SMS */}
            <div className="rounded-xl border border-border bg-secondary/20 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Missed Call Auto-SMS</p>
                    <p className="text-xs text-muted-foreground">Auto-text on No Answer / Voicemail</p>
                  </div>
                </div>
                <button
                  onClick={() => setAutoSmsEnabled(e => !e)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${autoSmsEnabled ? "bg-primary" : "bg-secondary border border-border"}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${autoSmsEnabled ? "translate-x-6" : "translate-x-1"}`} />
                </button>
              </div>
              {autoSmsEnabled && (
                <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Send From (Twilio Number)</Label>
                    <Input
                      className="bg-background/50 rounded-xl font-mono text-xs"
                      placeholder="+15551234567"
                      value={autoSmsFrom}
                      onChange={e => setAutoSmsFrom(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Message Template</Label>
                    <textarea
                      className="w-full h-20 bg-background/50 border border-border rounded-xl px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40 resize-none"
                      value={autoSmsTemplate}
                      onChange={e => setAutoSmsTemplate(e.target.value)}
                    />
                    <p className="text-[10px] text-muted-foreground">Sent automatically after No Answer or Voicemail dispositions.</p>
                  </div>
                </div>
              )}
            </div>

            <Button
              className="w-full gap-2"
              disabled={(callMode === "bridge" && !agentPhone) || statusFilter.length === 0 || startMutation.isPending}
              onClick={() => startMutation.mutate()}
            >
              {startMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : lines > 1 ? <Zap className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {lines > 1 ? `Start ${lines}-Line Power Session` : "Start Power Session"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (sessionLoading && !session) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  }

  if (done || session?.status === "done") {
    const stats = session?.stats;
    return (
      <div className="space-y-6 pb-20 max-w-2xl">
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-8 text-center space-y-4">
            <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto" />
            <h2 className="text-2xl font-display font-bold">Session Complete</h2>
            <p className="text-muted-foreground">You've dialed through all {stats?.total} leads in this session.</p>
            {stats && (
              <div className="grid grid-cols-5 gap-4 mt-6 pt-6 border-t border-border">
                <StatBadge label="Total"    value={stats.total}    color="text-foreground" />
                <StatBadge label="Answered" value={stats.answered} color="text-emerald-400" />
                <StatBadge label="VM"       value={stats.voicemail} color="text-blue-400" />
                <StatBadge label="No Ans"   value={stats.noAnswer} color="text-amber-400" />
                <StatBadge label="Callbacks" value={stats.callback} color="text-purple-400" />
              </div>
            )}
            <Button className="mt-4" onClick={() => setSessionId(null)}>Start New Session</Button>
          </div>
        </Card>
      </div>
    );
  }

  const stats = session?.stats;
  const progress = session ? Math.round((session.currentIndex / session.total) * 100) : 0;

  return (
    <div className="space-y-4 pb-20 max-w-2xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="rounded-xl border border-white/10 bg-card hover:bg-secondary"
            onClick={() => { if (confirm("End this power dial session?")) endMutation.mutate(); }}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="text-xl font-display font-bold flex items-center gap-2">
              <Phone className="w-5 h-5 text-primary" /> Power Dialer
              {session?.lines > 1 && (
                <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full px-2 py-0.5 font-normal flex items-center gap-1">
                  <Zap className="w-2.5 h-2.5" /> {session.lines}-Line
                </span>
              )}
            </h1>
            <p className="text-xs text-muted-foreground">Lead {(session?.currentIndex ?? 0) + 1} of {session?.total ?? "…"}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs h-8"
          onClick={() => { if (confirm("End this power dial session?")) endMutation.mutate(); }} disabled={endMutation.isPending}>
          <Square className="w-3.5 h-3.5" /> End Session
        </Button>
      </div>

      <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
      </div>

      {stats && (
        <Card className="rounded-xl border-white/5 bg-card p-4">
          <div className="grid grid-cols-5 gap-4 text-center">
            <StatBadge label="Called"    value={stats.called}    color="text-foreground" />
            <StatBadge label="Answered"  value={stats.answered}  color="text-emerald-400" />
            <StatBadge label="VM"        value={stats.voicemail} color="text-blue-400" />
            <StatBadge label="No Ans"    value={stats.noAnswer}  color="text-amber-400" />
            <StatBadge label="Callbacks" value={stats.callback}  color="text-purple-400" />
          </div>
        </Card>
      )}

      <AnimatePresence mode="wait">
        {currentLead ? (
          <motion.div key={currentLead.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
            <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
              <div className="p-5 border-b border-border bg-secondary/20 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">{currentLead.sellerName}</p>
                    <p className="text-xs text-muted-foreground font-mono">{currentLead.phone || "No phone"}</p>
                  </div>
                </div>
                <Badge className="bg-secondary text-muted-foreground border-white/10 border text-xs capitalize">{currentLead.status}</Badge>
              </div>
              <div className="p-5 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {currentLead.address && (
                    <div className="flex items-start gap-2 col-span-2">
                      <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <span>{currentLead.address}{currentLead.city ? `, ${currentLead.city}` : ""}{currentLead.state ? `, ${currentLead.state}` : ""}</span>
                    </div>
                  )}
                  {currentLead.askingPrice && (
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-muted-foreground" />
                      <span>Asking: ${Number(currentLead.askingPrice).toLocaleString()}</span>
                    </div>
                  )}
                  {currentLead.howSoon && (
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      <span>Timeline: {currentLead.howSoon}</span>
                    </div>
                  )}
                  {currentLead.reasonForSelling && (
                    <div className="flex items-start gap-2 col-span-2">
                      <AlertCircle className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <span className="text-muted-foreground">{currentLead.reasonForSelling}</span>
                    </div>
                  )}
                </div>
                {!session?.currentCallSid ? (
                  <Button className="w-full gap-2 mt-2" disabled={calling || !currentLead.phone} onClick={() => callMutation.mutate()}>
                    {calling ? <Loader2 className="w-4 h-4 animate-spin" /> : <PhoneCall className="w-4 h-4" />}
                    {currentLead.phone ? "Call Now" : "No Phone — Skip"}
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Call in progress · SID: <span className="font-mono text-xs">{session.currentCallSid.slice(-8)}</span>
                  </div>
                )}
              </div>
            </Card>
          </motion.div>
        ) : (
          <Card className="rounded-2xl border-white/5 bg-card p-8 text-center">
            <RefreshCw className="w-8 h-8 text-muted-foreground mx-auto mb-3 animate-spin" />
            <p className="text-muted-foreground text-sm">Loading next lead…</p>
          </Card>
        )}
      </AnimatePresence>

      {currentLead && (
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-4 border-b border-border bg-secondary/10">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Log Result & Move to Next</p>
          </div>
          <div className="p-4 grid grid-cols-3 gap-2">
            {DISPOSITION_BUTTONS.map(({ value, label, icon: Icon, color }) => (
              <Button key={value} variant="outline" className={`gap-1.5 h-10 text-xs font-medium border ${color}`}
                disabled={!!disposingId} onClick={() => disposeMutation.mutate(value)}>
                {disposingId === value ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Icon className="w-3.5 h-3.5" />}
                {label}
              </Button>
            ))}
          </div>
        </Card>
      )}

      {session?.dispositions?.length > 0 && (
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-4 border-b border-border bg-secondary/10">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Call History ({session.dispositions.length})
            </p>
          </div>
          <div className="divide-y divide-border max-h-48 overflow-y-auto">
            {[...session.dispositions].reverse().map((d: any, i: number) => (
              <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{d.leadName}</p>
                  <p className="text-xs text-muted-foreground truncate">{d.leadPhone}</p>
                </div>
                <Badge className={`text-[10px] shrink-0 border ${
                  d.disposition === "answered" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" :
                  d.disposition === "voicemail" ? "bg-blue-500/10 text-blue-400 border-blue-500/30" :
                  d.disposition === "callback" ? "bg-purple-500/10 text-purple-400 border-purple-500/30" :
                  d.disposition === "dnc" ? "bg-red-500/10 text-red-400 border-red-500/30" :
                  "bg-amber-500/10 text-amber-400 border-amber-500/30"
                } border`}>
                  {d.disposition.replace("_", " ")}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PowerDialer() {
  const [mode, setMode] = useState<"crm" | "list">("crm");

  return (
    <div className="space-y-6 pb-20">
      {/* Page Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="icon" className="rounded-xl border border-white/10 bg-card hover:bg-secondary">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Phone className="w-6 h-6 text-primary" />
            Power Dialer
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Auto-dial leads from your CRM or upload a custom list.
          </p>
        </div>
      </motion.div>

      {/* Mode Selector */}
      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <div className="inline-flex rounded-xl border border-border bg-card p-1 gap-1">
          <button
            onClick={() => setMode("crm")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              mode === "crm"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <BarChart2 className="w-4 h-4" />
            CRM Dialer
          </button>
          <button
            onClick={() => setMode("list")}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              mode === "list"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary"
            }`}
          >
            <FileSpreadsheet className="w-4 h-4" />
            List Dialer
          </button>
        </div>
      </motion.div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {mode === "crm" ? (
          <motion.div key="crm" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }}>
            <CRMDialer />
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
            <ListDialer />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

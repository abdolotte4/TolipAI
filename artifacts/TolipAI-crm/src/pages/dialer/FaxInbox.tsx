import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  FileText, Send, Download, Loader2, AlertCircle, RefreshCw,
  PhoneIncoming, PhoneOutgoing, CheckCircle2, XCircle, Clock,
  Printer, ExternalLink, Info, Settings,
} from "lucide-react";
import { apiRawFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Link } from "wouter";

interface FaxRecord {
  id: number;
  direction: "inbound" | "outbound";
  status: string;
  fromNumber: string;
  toNumber: string;
  numPages: number | null;
  pdfUrl: string | null;
  faxSid: string | null;
  errorMessage: string | null;
  createdAt: string;
  leadId: number | null;
  leadName: string | null;
}

function fmtPhone(raw: string) {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1"))
    return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  if (d.length === 10)
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string; icon: React.ElementType }> = {
    received:   { label: "Received",   className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: CheckCircle2 },
    sent:       { label: "Sent",       className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: CheckCircle2 },
    delivered:  { label: "Delivered",  className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: CheckCircle2 },
    queued:     { label: "Queued",     className: "bg-sky-500/10 text-sky-400 border-sky-500/20",            icon: Clock },
    delivering: { label: "Delivering", className: "bg-sky-500/10 text-sky-400 border-sky-500/20",            icon: Clock },
    processing: { label: "Processing", className: "bg-sky-500/10 text-sky-400 border-sky-500/20",            icon: Clock },
    failed:     { label: "Failed",     className: "bg-red-500/10 text-red-400 border-red-500/20",            icon: XCircle },
    "no-answer":{ label: "No Answer",  className: "bg-amber-500/10 text-amber-400 border-amber-500/20",      icon: XCircle },
  };
  const cfg = map[status] ?? { label: status, className: "bg-secondary text-muted-foreground border-border", icon: Info };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border ${cfg.className}`}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

function FaxRow({ fax }: { fax: FaxRecord }) {
  const isIn = fax.direction === "inbound";
  const Icon = isIn ? PhoneIncoming : PhoneOutgoing;
  return (
    <div className="flex items-center gap-4 px-5 py-4 border-b border-border/50 hover:bg-secondary/30 transition-colors">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isIn ? "bg-sky-500/10 border border-sky-500/20" : "bg-emerald-500/10 border border-emerald-500/20"}`}>
        <Icon className={`w-5 h-5 ${isIn ? "text-sky-400" : "text-emerald-400"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-mono text-sm font-semibold text-foreground">
            {isIn ? fmtPhone(fax.fromNumber) : fmtPhone(fax.toNumber)}
          </span>
          <StatusBadge status={fax.status} />
          {fax.leadId && fax.leadName && (
            <Link href={`/leads/${fax.leadId}`}>
              <span className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline cursor-pointer">
                <ExternalLink className="w-3 h-3" />{fax.leadName}
              </span>
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{isIn ? "From" : "To"}: <span className="font-mono">{isIn ? fmtPhone(fax.fromNumber) : fmtPhone(fax.toNumber)}</span></span>
          {fax.numPages != null && <span>· {fax.numPages} page{fax.numPages !== 1 ? "s" : ""}</span>}
          {fax.errorMessage && <span className="text-red-400 truncate max-w-xs">· {fax.errorMessage}</span>}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-xs text-muted-foreground">
          {format(new Date(fax.createdAt), "MMM d, h:mm a")}
        </span>
        {fax.pdfUrl && (
          <a
            href={fax.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <Download className="w-3.5 h-3.5" /> PDF
          </a>
        )}
      </div>
    </div>
  );
}

function SendFaxPanel({ onSent }: { onSent: () => void }) {
  const { toast } = useToast();
  const [to, setTo] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");

  const sendMutation = useMutation({
    mutationFn: () => apiRawFetch("/twilio/fax/send", {
      method: "POST",
      body: JSON.stringify({ to, mediaUrl }),
    }),
    onSuccess: () => {
      toast({ title: "Fax queued", description: "Your fax is being sent. Check Outbox for status." });
      setTo(""); setMediaUrl("");
      onSent();
    },
    onError: (err: Error) => toast({ title: "Send failed", description: err.message, variant: "destructive" }),
  });

  const setupMutation = useMutation({
    mutationFn: () => apiRawFetch("/twilio/fax/setup-webhook", { method: "POST" }),
    onSuccess: (data: any) => toast({
      title: "Fax webhook configured",
      description: `Inbound faxes now route to this server. Configured ${data.configured} number(s).`,
    }),
    onError: (err: Error) => toast({ title: "Webhook setup failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="max-w-lg mx-auto py-8 px-4 space-y-6">
      <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Send className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Send a Fax</p>
            <p className="text-xs text-muted-foreground">Send a PDF to any fax-capable number</p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">Recipient fax number</label>
            <input
              type="tel"
              value={to}
              onChange={e => setTo(e.target.value)}
              placeholder="+1 (307) 000-0000"
              className="w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">PDF document URL (must be publicly accessible)</label>
            <input
              type="url"
              value={mediaUrl}
              onChange={e => setMediaUrl(e.target.value)}
              placeholder="https://example.com/document.pdf"
              className="w-full bg-secondary border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Host your PDF at a public URL (e.g. Google Drive shared link, Dropbox, S3). Twilio will fetch and fax it.
            </p>
          </div>
        </div>

        <Button
          className="w-full gap-2"
          disabled={!to || !mediaUrl || sendMutation.isPending}
          onClick={() => sendMutation.mutate()}
        >
          {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Send Fax
        </Button>
      </div>

      <div className="rounded-2xl border border-border bg-card/50 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-muted-foreground" />
          <p className="text-sm font-medium text-foreground">Fax Webhook Setup</p>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          Click below to configure your Twilio phone number to receive incoming faxes on this server.
          Do this once from your Railway/production URL to ensure faxes route correctly.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={setupMutation.isPending}
          onClick={() => setupMutation.mutate()}
        >
          {setupMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Settings className="w-3.5 h-3.5" />}
          Configure Inbound Fax Webhook
        </Button>
      </div>

      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="flex gap-3">
          <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-amber-300">Activating Fax on your Twilio Number</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              To enable fax on <span className="font-mono text-foreground">+13074882217</span>:
            </p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Log into <strong className="text-foreground">Twilio Console → Phone Numbers → Manage → Active Numbers</strong></li>
              <li>Click on your number <span className="font-mono text-foreground">+1 (307) 488-2217</span></li>
              <li>Under <strong className="text-foreground">Fax Configuration</strong>, set <em>A Fax Comes In</em> to <em>Webhook</em></li>
              <li>Paste your production URL: <span className="font-mono text-foreground break-all">https://[your-railway-app].up.railway.app/api/twilio/fax/inbound</span></li>
              <li>Or just click <strong className="text-foreground">"Configure Inbound Fax Webhook"</strong> above from your Railway URL</li>
            </ol>
            <p className="text-xs text-muted-foreground mt-2">
              <strong className="text-foreground">Note:</strong> Most US local numbers support fax. If you don't see a Fax section, the number may need to be a Fax-capable number — you can purchase one in Twilio Console under <em>Buy a Number → Fax</em> capability.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FaxInbox() {
  const [tab, setTab] = useState<"inbound" | "outbound" | "send">("inbound");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: inboundData, isLoading: inboundLoading, refetch: refetchInbound } =
    useQuery<{ faxes: FaxRecord[] }>({
      queryKey: ["fax-list-inbound"],
      queryFn: () => apiRawFetch("/twilio/fax/list?direction=inbound"),
      staleTime: 30_000,
      refetchInterval: 60_000,
    });

  const { data: outboundData, isLoading: outboundLoading, refetch: refetchOutbound } =
    useQuery<{ faxes: FaxRecord[] }>({
      queryKey: ["fax-list-outbound"],
      queryFn: () => apiRawFetch("/twilio/fax/list?direction=outbound"),
      staleTime: 30_000,
    });

  const inboundFaxes = inboundData?.faxes ?? [];
  const outboundFaxes = outboundData?.faxes ?? [];

  const tabs = [
    { id: "inbound" as const,  label: "Inbound",  count: inboundFaxes.length,  icon: PhoneIncoming },
    { id: "outbound" as const, label: "Outbox",   count: outboundFaxes.length, icon: PhoneOutgoing },
    { id: "send" as const,     label: "Send Fax", count: null,                 icon: Send },
  ];

  return (
    <div className="space-y-6">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Printer className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="font-display font-bold text-2xl text-foreground">Fax Inbox</h1>
          <p className="text-sm text-muted-foreground">Send and receive faxes via your Twilio number</p>
        </div>
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => { refetchInbound(); refetchOutbound(); }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 bg-secondary/50 rounded-xl p-1 w-fit">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id
                ? "bg-card text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
            {t.count != null && t.count > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${tab === t.id ? "bg-primary/10 text-primary" : "bg-border text-muted-foreground"}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "send" ? (
        <SendFaxPanel onSent={() => { setTab("outbound"); refetchOutbound(); }} />
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {(tab === "inbound" ? inboundLoading : outboundLoading) ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (tab === "inbound" ? inboundFaxes : outboundFaxes).length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <div className="w-14 h-14 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center mb-4">
                <FileText className="w-7 h-7 text-primary/30" />
              </div>
              <p className="font-semibold text-foreground mb-1">
                {tab === "inbound" ? "No incoming faxes yet" : "No outbound faxes yet"}
              </p>
              <p className="text-sm text-muted-foreground max-w-xs">
                {tab === "inbound"
                  ? "Faxes sent to your Twilio number will appear here automatically once you configure the fax webhook."
                  : "Faxes you send will appear here."}
              </p>
              {tab === "inbound" && (
                <Button variant="link" size="sm" className="mt-3 text-primary" onClick={() => setTab("send")}>
                  Configure fax webhook →
                </Button>
              )}
            </div>
          ) : (
            <div>
              {(tab === "inbound" ? inboundFaxes : outboundFaxes).map(fax => (
                <FaxRow key={fax.id} fax={fax} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

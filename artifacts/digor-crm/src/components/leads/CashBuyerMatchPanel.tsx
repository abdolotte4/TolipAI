import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sparkles, Search, RefreshCw, Phone, Mail, MapPin, TrendingUp, Building2,
  Wallet, CalendarClock, Eye, AlertTriangle, CheckCircle2,
} from "lucide-react";

type Buyer = {
  id?: string;
  buyerName: string;
  llcName?: string | null;
  type: "flipper" | "landlord" | "lender" | "hedge_fund" | "wholesaler" | string;
  matchScore?: number | null;
  portfolioSize?: number | null;
  portfolioValue?: number | null;
  avgPurchasePrice?: number | null;
  lastPurchaseDate?: string | null;
  phones?: any[] | null;
  emails?: any[] | null;
  addresses?: any[] | null;
  classificationReason?: string | null;
  source?: string | null;
};

type JobStatus = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  progress?: number;
  message?: string;
  error?: string | null;
  result?: any;
};

const TYPE_STYLES: Record<string, string> = {
  flipper:    "bg-orange-500/15 text-orange-300 border-orange-500/30",
  landlord:   "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  lender:     "bg-purple-500/15 text-purple-300 border-purple-500/30",
  hedge_fund: "bg-rose-500/15 text-rose-300 border-rose-500/30",
  wholesaler: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

const TYPE_LABELS: Record<string, string> = {
  flipper: "Flipper",
  landlord: "Landlord",
  lender: "Hard-Money Lender",
  hedge_fund: "Hedge Fund / Institutional",
  wholesaler: "Wholesaler",
};

function fmtMoney(n?: number | null) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${Math.round(n)}`;
}

function ScoreRing({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const radius = 22;
  const c = 2 * Math.PI * radius;
  const dash = (v / 100) * c;
  const color = v >= 80 ? "text-emerald-400" : v >= 60 ? "text-amber-400" : "text-rose-400";
  return (
    <div className="relative w-14 h-14 shrink-0">
      <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
        <circle cx="28" cy="28" r={radius} stroke="currentColor"
                className="text-white/10" strokeWidth="5" fill="none" />
        <circle cx="28" cy="28" r={radius} stroke="currentColor"
                className={color} strokeWidth="5" fill="none" strokeLinecap="round"
                strokeDasharray={`${dash} ${c - dash}`} />
      </svg>
      <div className={`absolute inset-0 flex items-center justify-center text-xs font-bold ${color}`}>
        {v}
      </div>
    </div>
  );
}

export function CashBuyerMatchPanel({ leadId }: { leadId: string }) {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Buyer | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load existing matches on mount ──
  const refreshList = async () => {
    setLoadingList(true);
    try {
      const res = await fetch(`/api/scraper-engine/leads/${leadId}/buyers`);
      if (res.ok) {
        const data = await res.json();
        setBuyers(data.buyers ?? data ?? []);
      }
    } catch {
      /* noop */
    } finally {
      setLoadingList(false);
    }
  };
  useEffect(() => { refreshList(); /* eslint-disable-next-line */ }, [leadId]);

  // ── Poll job ──
  useEffect(() => {
    if (!jobId) return;
    if (job?.status === "completed" || job?.status === "failed") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/scraper-engine/jobs/${jobId}`);
        if (!res.ok) return;
        const data: JobStatus = await res.json();
        setJob(data);
        if (data.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);
          await refreshList();
        } else if (data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(data.error || "Search failed.");
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line
  }, [jobId, job?.status]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    setJob(null);
    try {
      const res = await fetch(`/api/scraper-engine/cash-buyers/${leadId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as any));
        throw new Error(err.error || `Failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      setJobId(data.jobId || data.id);
      setJob({ id: data.jobId || data.id, status: "queued", progress: 0 });
    } catch (e: any) {
      setError(e?.message || "Could not start search.");
    } finally {
      setStarting(false);
    }
  };

  const isRunning = job && (job.status === "queued" || job.status === "running");

  return (
    <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30
                          flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-display font-bold text-base">Cash Buyer AI Match</h3>
            <p className="text-xs text-muted-foreground">
              Scans recent cash sales near this lead, classifies investors with Kimi K2,
              then skip-traces phone &amp; email.
            </p>
          </div>
        </div>
        <Button
          onClick={handleStart}
          disabled={starting || Boolean(isRunning)}
          className="rounded-xl gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {starting || isRunning ? (
            <><RefreshCw className="w-4 h-4 animate-spin" /> Searching…</>
          ) : (
            <><Search className="w-4 h-4" /> Find Cash Buyers</>
          )}
        </Button>
      </div>

      {/* Job progress */}
      {job && (
        <div className="px-5 py-3 border-b border-border bg-secondary/20">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-muted-foreground">
              {job.message || (job.status === "completed" ? "Done" : "Working…")}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {Math.round(job.progress ?? 0)}%
            </span>
          </div>
          <Progress value={job.progress ?? 0} className="h-1.5" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="m-5 p-3 rounded-lg bg-red-500/10 border border-red-500/20
                        text-xs text-red-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      {/* Body */}
      <div className="p-5">
        {loadingList ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2" />
            Loading existing matches…
          </div>
        ) : buyers.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            No buyers yet. Click <span className="text-primary">Find Cash Buyers</span> to
            scan the area for recent cash transactions.
          </div>
        ) : (
          <div className="space-y-3">
            {buyers.map((b, i) => (
              <div key={b.id ?? `${b.buyerName}-${i}`}
                   className="p-4 rounded-xl border border-white/5 bg-secondary/30 hover:bg-secondary/50
                              transition-colors flex items-start gap-4">
                <ScoreRing value={Number(b.matchScore ?? 0)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h4 className="font-semibold text-sm truncate">
                      {b.llcName || b.buyerName}
                    </h4>
                    <Badge className={`text-[10px] border ${TYPE_STYLES[b.type] ?? "bg-secondary"}`}>
                      {TYPE_LABELS[b.type] ?? b.type}
                    </Badge>
                    {b.lastPurchaseDate && (
                      <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                        <CalendarClock className="w-3 h-3" />
                        Last buy {new Date(b.lastPurchaseDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] mt-2">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Building2 className="w-3 h-3" /> Portfolio:{" "}
                      <span className="text-foreground font-medium">
                        {b.portfolioSize ?? "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Wallet className="w-3 h-3" /> Value:{" "}
                      <span className="text-foreground font-medium">{fmtMoney(b.portfolioValue)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <TrendingUp className="w-3 h-3" /> Avg:{" "}
                      <span className="text-foreground font-medium">{fmtMoney(b.avgPurchasePrice)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Phone className="w-3 h-3" /> Contacts:{" "}
                      <span className="text-foreground font-medium">
                        {(b.phones?.length ?? 0) + (b.emails?.length ?? 0)}
                      </span>
                    </div>
                  </div>
                  {b.classificationReason && (
                    <p className="text-[11px] text-muted-foreground/80 mt-2 italic line-clamp-2">
                      {b.classificationReason}
                    </p>
                  )}
                </div>
                <Button size="sm" variant="outline"
                        className="rounded-lg gap-1.5 shrink-0"
                        onClick={() => setSelected(b)}>
                  <Eye className="w-3.5 h-3.5" /> Details
                </Button>
              </div>
            ))}
          </div>
        )}

        {job?.status === "completed" && (
          <div className="mt-4 inline-flex items-center gap-2 text-xs text-emerald-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> Search complete — {buyers.length} buyer(s) matched.
          </div>
        )}
      </div>

      {/* Detail modal */}
      <Dialog open={Boolean(selected)} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg rounded-2xl">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {selected.llcName || selected.buyerName}
                  <Badge className={`text-[10px] border ${TYPE_STYLES[selected.type] ?? "bg-secondary"}`}>
                    {TYPE_LABELS[selected.type] ?? selected.type}
                  </Badge>
                </DialogTitle>
                <DialogDescription>
                  Match score{" "}
                  <span className="text-foreground font-semibold">
                    {Math.round(Number(selected.matchScore ?? 0))}/100
                  </span>{" "}
                  · {selected.source ?? "scraper-engine"}
                </DialogDescription>
              </DialogHeader>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3 my-2">
                <div className="p-3 rounded-xl bg-secondary/40 border border-white/5">
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Portfolio</div>
                  <div className="text-base font-bold">{selected.portfolioSize ?? "—"}</div>
                </div>
                <div className="p-3 rounded-xl bg-secondary/40 border border-white/5">
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Value</div>
                  <div className="text-base font-bold">{fmtMoney(selected.portfolioValue)}</div>
                </div>
                <div className="p-3 rounded-xl bg-secondary/40 border border-white/5">
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide">Avg Buy</div>
                  <div className="text-base font-bold">{fmtMoney(selected.avgPurchasePrice)}</div>
                </div>
              </div>

              {/* Phones */}
              {selected.phones && selected.phones.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide mb-1.5">Phones</div>
                  <div className="space-y-1">
                    {selected.phones.map((p: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Phone className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="font-mono">{p.number ?? p}</span>
                        {p.type && <Badge variant="outline" className="text-[10px]">{p.type}</Badge>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Emails */}
              {selected.emails && selected.emails.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide mb-1.5">Emails</div>
                  <div className="space-y-1">
                    {selected.emails.map((e: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <Mail className="w-3.5 h-3.5 text-sky-400" />
                        <span>{e.address ?? e}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Addresses */}
              {selected.addresses && selected.addresses.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide mb-1.5">Mailing</div>
                  <div className="space-y-1">
                    {selected.addresses.map((a: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <MapPin className="w-3.5 h-3.5 text-amber-400" />
                        <span>{typeof a === "string" ? a : a.full || `${a.street}, ${a.city}`}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selected.classificationReason && (
                <p className="text-xs text-muted-foreground italic mt-3 border-t border-border pt-3">
                  {selected.classificationReason}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
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
  buyerType: "flipper" | "landlord" | "lender" | "hedge_fund" | "wholesaler" | string;
  matchScore?: number | null;
  portfolioSize?: number | null;
  portfolioValue?: number | null;
  avgPurchasePrice?: number | null;
  lastPurchaseDate?: string | null;
  phones?: any[] | null;
  emails?: any[] | null;
  mailingAddress?: string | null;
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

type Source = "ai" | "propelio" | "propwire";

export function CashBuyerMatchPanel({ leadId, leadAddress }: { leadId: string; leadAddress?: string | null }) {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Buyer | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Source + Propelio/Propwire filters ──
  const [source, setSource] = useState<Source>("ai");
  const [distanceMiles, setDistanceMiles] = useState<number>(1);
  const [activeWithin, setActiveWithin] = useState<string>("12");
  const [minProperties, setMinProperties] = useState<number>(2);
  const [landlords, setLandlords] = useState<boolean>(true);
  const [flippers, setFlippers] = useState<boolean>(true);
  const [maxResults, setMaxResults] = useState<number>(100);
  const [maxBuyers, setMaxBuyers] = useState<number>(50);

  // ── Load existing matches after a completed job ──
  const refreshList = useCallback(async (completedJobId?: string) => {
    if (!completedJobId) {
      setLoadingList(false);
      return;
    }
    setLoadingList(true);
    try {
      const res = await fetch(`/api/scraper-engine/jobs/${completedJobId}`);
      if (res.ok) {
        const data = await res.json();
        const raw = data.result;
        const normalized: Buyer[] = Array.isArray(raw) ? raw :
          (raw?.buyers ?? raw?.listings ?? raw?.results ?? data.buyers ?? []);
        setBuyers(normalized);
      }
    } catch {
      /* noop */
    } finally {
      setLoadingList(false);
    }
  }, []);
  useEffect(() => {
    // Reset loading state whenever the active lead changes
    setLoadingList(false);
    setBuyers([]);
    setJob(null);
    setJobId(null);
    setError(null);
  }, [leadId]);

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
          await refreshList(jobId);
        } else if (data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(data.error || "Search failed.");
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId, job?.status, refreshList]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    setJob(null);
    try {
      const startJob = async (path: string, body: Record<string, any>) => {
        const res = await fetch(`/api/scraper-engine${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({} as any));
          throw new Error(err.error || err.detail || `Failed (HTTP ${res.status})`);
        }
        return res.json();
      };

      if (source === "propelio") {
        if (!leadAddress) throw new Error("This lead has no address — cannot search Propelio.");
        const data = await startJob("/scrape/propelio/cash-buyers", {
          address: leadAddress,
          distance_miles: distanceMiles,
          active_within: activeWithin,
          min_properties: minProperties,
          landlords,
          flippers,
          max_results: maxResults,
          lead_id: Number(leadId),
        });
        setJobId(data.job_id || data.id);
        setJob({ id: data.job_id || data.id, status: "queued", progress: 0 });
        return;
      } else if (source === "propwire") {
        if (!leadAddress) throw new Error("This lead has no address — cannot search Propwire.");
        const data = await startJob("/scrape/propwire/cash-buyers-nearby", {
          query: leadAddress,
          radius_miles: distanceMiles,
          min_properties: minProperties,
          max_results: maxResults,
          lead_id: Number(leadId),
        });
        setJobId(data.job_id || data.id);
        setJob({ id: data.job_id || data.id, status: "queued", progress: 0 });
        return;
      }
      const data = await startJob("/scrape/cash-buyers", {
        lead_id: Number(leadId),
        max_buyers: maxBuyers,
      });
      setJobId(data.job_id || data.id);
      setJob({ id: data.job_id || data.id, status: "queued", progress: 0 });
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
            <h3 className="font-display font-bold text-base">Cash Buyer Search</h3>
            <p className="text-xs text-muted-foreground">
              AI match, Propelio investor panel, or Propwire nearby buyers — results merge into this list.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as Source)}
            disabled={starting || Boolean(isRunning)}
            className="rounded-lg bg-secondary/40 border border-white/10 text-xs px-2 py-1.5 outline-none"
          >
            <option value="ai">AI Match (Kimi K2)</option>
            <option value="propelio">Propelio (authenticated)</option>
            <option value="propwire">Propwire (authenticated)</option>
          </select>
          <Button
            onClick={handleStart}
            disabled={starting || Boolean(isRunning)}
            className="rounded-xl gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {starting || isRunning ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Searching…</>
            ) : (
              <><Search className="w-4 h-4" /> Find Buyers</>
            )}
          </Button>
        </div>
      </div>

      {/* Filters panel — always visible (AI gets max-buyers; Propelio/Propwire get distance etc.) */}
      <div className="px-5 py-3 border-b border-border bg-secondary/10 grid grid-cols-2 sm:grid-cols-6 gap-3 text-xs">
        {/* AI: max buyers control */}
        {source === "ai" && (
          <label className="flex flex-col gap-1 col-span-2 sm:col-span-2">
            <span className="text-muted-foreground">Max buyers to profile</span>
            <input type="number" min={10} max={200} step={10} value={maxBuyers}
              onChange={(e) => setMaxBuyers(Number(e.target.value))}
              className="rounded-md bg-secondary/40 border border-white/10 px-2 py-1 outline-none" />
          </label>
        )}
        {/* Propelio / Propwire specific controls */}
        {source !== "ai" && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Distance (mi)</span>
              <input type="number" min={0.25} step={0.25} value={distanceMiles}
                onChange={(e) => setDistanceMiles(Number(e.target.value))}
                className="rounded-md bg-secondary/40 border border-white/10 px-2 py-1 outline-none" />
            </label>
            {source === "propelio" && (
              <label className="flex flex-col gap-1">
                <span className="text-muted-foreground">Active within (mo)</span>
                <select value={activeWithin}
                  onChange={(e) => setActiveWithin(e.target.value)}
                  className="rounded-md bg-secondary/40 border border-white/10 px-2 py-1 outline-none">
                  <option value="3">3</option>
                  <option value="6">6</option>
                  <option value="12">12</option>
                  <option value="24">24</option>
                  <option value="any">Any</option>
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Min properties</span>
              <input type="number" min={1} step={1} value={minProperties}
                onChange={(e) => setMinProperties(Number(e.target.value))}
                className="rounded-md bg-secondary/40 border border-white/10 px-2 py-1 outline-none" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground">Max results</span>
              <input type="number" min={10} step={10} value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
                className="rounded-md bg-secondary/40 border border-white/10 px-2 py-1 outline-none" />
            </label>
            {source === "propelio" && (
              <>
                <label className="flex items-center gap-2 mt-4">
                  <input type="checkbox" checked={landlords}
                    onChange={(e) => setLandlords(e.target.checked)} />
                  <span>Landlords</span>
                </label>
                <label className="flex items-center gap-2 mt-4">
                  <input type="checkbox" checked={flippers}
                    onChange={(e) => setFlippers(e.target.checked)} />
                  <span>Flippers</span>
                </label>
              </>
            )}
          </>
        )}
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
                    {(() => {
                      const isGeneric = !b.buyerName || b.buyerName.startsWith("Investor —") || b.buyerName.startsWith("investor::");
                      const name = isGeneric
                        ? (b.llcName || b.mailingAddress || b.buyerName || "Unknown Investor")
                        : (b.llcName || b.buyerName);
                      return (
                        <h4 className={`font-semibold text-sm truncate ${isGeneric && !b.llcName ? "text-muted-foreground italic" : ""}`}>
                          {name}
                          {isGeneric && !b.llcName && (
                            <span className="ml-1.5 text-[10px] not-italic font-normal text-amber-400">(area investor)</span>
                          )}
                        </h4>
                      );
                    })()}
                    <Badge className={`text-[10px] border ${TYPE_STYLES[b.buyerType] ?? "bg-secondary"}`}>
                      {TYPE_LABELS[b.buyerType] ?? b.buyerType}
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
                  <Badge className={`text-[10px] border ${TYPE_STYLES[selected.buyerType] ?? "bg-secondary"}`}>
                    {TYPE_LABELS[selected.buyerType] ?? selected.buyerType}
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

              {/* Mailing Address */}
              {selected.mailingAddress && (
                <div className="mt-3">
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wide mb-1.5">Mailing</div>
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="w-3.5 h-3.5 text-amber-400" />
                    <span>{selected.mailingAddress}</span>
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

export default CashBuyerMatchPanel;

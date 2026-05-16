import { useMemo, useState, lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  Database, Search, Download, Filter, X, Sparkles,
  Building2, MapPin, ExternalLink, Phone, Mail, Loader2, PhoneCall,
} from "lucide-react";

import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCrmGetMe } from "@workspace/api-client-react";

const BrowserDialer = lazy(() => import("@/components/leads/BrowserDialer"));

type DialEntry = { phone: string; leadId: number; name: string };

type Buyer = {
  id: number;
  leadId: number;
  buyerName: string;
  llcName: string | null;
  buyerType: string;
  matchScore: number;
  matchReasons: string[];
  portfolioSize: number | null;
  portfolioValue: string | null;
  portfolioAppreciation: string | null;
  avgPurchasePrice: string | null;
  lastPurchaseDate: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  mailingAddress: string | null;
  phones: string[];
  emails: string[];
  principals: { name: string; role?: string }[];
  source: string;
  createdAt: string;
  leadAddress: string | null;
};

type ListResp = { buyers: Buyer[]; total: number; page: number; limit: number };
type Facets = { sources: string[]; buyerTypes: string[]; states: string[]; totalRows: number };

const SOURCE_LABEL: Record<string, string> = {
  "scraper-engine": "AI",
  "propelio": "Propelio",
  "propwire": "Propwire",
};
const SOURCE_BADGE: Record<string, string> = {
  "scraper-engine": "bg-violet-500/10 text-violet-300 border-violet-500/30",
  "propelio": "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  "propwire": "bg-sky-500/10 text-sky-300 border-sky-500/30",
};
const TYPE_BADGE: Record<string, string> = {
  flipper: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  landlord: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  hedge_fund: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  lender: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  wholesaler: "bg-pink-500/10 text-pink-300 border-pink-500/30",
  unknown: "bg-secondary text-muted-foreground border-white/10",
};

function authFetch(path: string): Promise<any> {
  const token = localStorage.getItem("crm_token");
  return fetch(`/api${path}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  }).then((r) => {
    if (!r.ok) throw new Error(`Request failed: ${r.status}`);
    return r.json();
  });
}

function fmtMoney(v: string | null): string {
  if (!v) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function fmtPct(v: string | null): string {
  if (!v) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

export default function CashBuyersAll() {
  const { toast } = useToast();
  const { data: me } = useCrmGetMe();

  // ─── Filter state ──────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [buyerTypes, setBuyerTypes] = useState<string[]>([]);
  const [states, setStates] = useState<string[]>([]);
  const [minPortfolioSize, setMinPortfolioSize] = useState("");
  const [maxPortfolioSize, setMaxPortfolioSize] = useState("");
  const [minScore, setMinScore] = useState("");
  const [page, setPage] = useState(1);
  const limit = 50;
  const [showFilters, setShowFilters] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dialEntry, setDialEntry] = useState<DialEntry | null>(null);

  // Build a stable query string for both list + export
  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (search) p.set("search", search);
    if (sources.length) p.set("source", sources.join(","));
    if (buyerTypes.length) p.set("buyerType", buyerTypes.join(","));
    if (states.length) p.set("state", states.join(","));
    if (minPortfolioSize) p.set("minPortfolioSize", minPortfolioSize);
    if (maxPortfolioSize) p.set("maxPortfolioSize", maxPortfolioSize);
    if (minScore) p.set("minScore", minScore);
    return p;
  }, [search, sources, buyerTypes, states, minPortfolioSize, maxPortfolioSize, minScore]);

  const listParams = useMemo(() => {
    const p = new URLSearchParams(queryParams);
    p.set("page", String(page));
    p.set("limit", String(limit));
    return p.toString();
  }, [queryParams, page]);

  const { data, isLoading, isFetching } = useQuery<ListResp>({
    queryKey: ["cash-buyers-all", listParams],
    queryFn: () => authFetch(`/scraper-engine/buyers?${listParams}`),
    enabled: !!me,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const { data: facets } = useQuery<Facets>({
    queryKey: ["cash-buyers-facets"],
    queryFn: () => authFetch("/scraper-engine/buyers/facets"),
    enabled: !!me,
    staleTime: 5 * 60_000,
  });

  const buyers = data?.buyers ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  function toggle(list: string[], setList: (v: string[]) => void, value: string) {
    setPage(1);
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function clearAll() {
    setSearch("");
    setSearchInput("");
    setSources([]);
    setBuyerTypes([]);
    setStates([]);
    setMinPortfolioSize("");
    setMaxPortfolioSize("");
    setMinScore("");
    setPage(1);
  }

  async function downloadCsv() {
    setExporting(true);
    try {
      const token = localStorage.getItem("crm_token");
      const res = await fetch(`/api/scraper-engine/buyers/export.csv?${queryParams.toString()}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cash-buyers-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "CSV downloaded", description: `${total.toLocaleString()} buyers exported.` });
    } catch (err) {
      toast({ title: "Export failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  const activeFilterCount =
    sources.length + buyerTypes.length + states.length +
    (minPortfolioSize ? 1 : 0) + (maxPortfolioSize ? 1 : 0) + (minScore ? 1 : 0) +
    (search ? 1 : 0);

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold flex items-center gap-2">
            <Database className="w-7 h-7 text-primary" />
            Cash Buyer Database
          </h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <p className="text-muted-foreground text-sm">
              {me?.role === "super_admin"
                ? "All campaigns — every buyer discovered across Propelio, Propwire, and AI scrapers."
                : `Showing buyers for your campaign only — discovered via Propelio, Propwire & AI.`}
            </p>
            {me?.role !== "super_admin" && me?.campaignName && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-primary/10 border border-primary/20 text-primary">
                <Database className="w-3 h-3" />
                {me.campaignName}
              </span>
            )}
            {me?.role === "super_admin" && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/10 border border-amber-500/20 text-amber-400">
                Super Admin — All Campaigns
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="rounded-xl gap-2 border-white/10 hover:bg-secondary"
            onClick={() => setShowFilters((v) => !v)}
          >
            <Filter className="w-4 h-4" />
            Filters
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px] h-4">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
          <Button
            className="rounded-xl gap-2 shadow-lg shadow-primary/20"
            onClick={downloadCsv}
            disabled={exporting || total === 0}
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Export CSV
          </Button>
        </div>
      </motion.div>

      {/* Search */}
      <form
        className="relative max-w-xl"
        onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(searchInput.trim()); }}
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, LLC, address, city…"
          className="pl-9 pr-24 bg-card rounded-xl border-white/10"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        {searchInput && (
          <button
            type="button"
            onClick={() => { setSearchInput(""); setSearch(""); setPage(1); }}
            className="absolute right-20 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-secondary"
          >
            <X className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        )}
        <Button type="submit" size="sm" className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 rounded-lg">
          Search
        </Button>
      </form>

      {/* Filters panel */}
      {showFilters && (
        <Card className="rounded-2xl border-white/5 bg-card p-5 space-y-5">
          {/* Source */}
          <div>
            <Label className="text-xs uppercase text-muted-foreground tracking-wider">Source</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {(facets?.sources ?? []).map((s) => (
                <button
                  key={s}
                  onClick={() => toggle(sources, setSources, s)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                    sources.includes(s)
                      ? SOURCE_BADGE[s] ?? "bg-primary/10 text-primary border-primary/30"
                      : "border-white/10 text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {SOURCE_LABEL[s] ?? s}
                </button>
              ))}
              {(!facets?.sources?.length) && <span className="text-xs text-muted-foreground">No data yet.</span>}
            </div>
          </div>

          {/* Buyer Type */}
          <div>
            <Label className="text-xs uppercase text-muted-foreground tracking-wider">Buyer Type</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {(facets?.buyerTypes ?? []).map((t) => (
                <button
                  key={t}
                  onClick={() => toggle(buyerTypes, setBuyerTypes, t)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors capitalize ${
                    buyerTypes.includes(t)
                      ? TYPE_BADGE[t] ?? "bg-primary/10 text-primary border-primary/30"
                      : "border-white/10 text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {t.replace("_", " ")}
                </button>
              ))}
              {(!facets?.buyerTypes?.length) && <span className="text-xs text-muted-foreground">No data yet.</span>}
            </div>
          </div>

          {/* State */}
          {(facets?.states?.length ?? 0) > 0 && (
            <div>
              <Label className="text-xs uppercase text-muted-foreground tracking-wider">State</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {facets!.states.map((st) => (
                  <button
                    key={st}
                    onClick={() => toggle(states, setStates, st)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono border transition-colors ${
                      states.includes(st)
                        ? "bg-primary/10 text-primary border-primary/30"
                        : "border-white/10 text-muted-foreground hover:bg-secondary"
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Numeric filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Min Portfolio Size</Label>
              <Input
                type="number" min={0}
                className="bg-background/50 rounded-xl"
                placeholder="e.g. 5"
                value={minPortfolioSize}
                onChange={(e) => { setPage(1); setMinPortfolioSize(e.target.value); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Max Portfolio Size</Label>
              <Input
                type="number" min={0}
                className="bg-background/50 rounded-xl"
                placeholder="e.g. 500"
                value={maxPortfolioSize}
                onChange={(e) => { setPage(1); setMaxPortfolioSize(e.target.value); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Min Match Score (0–100)</Label>
              <Input
                type="number" min={0} max={100}
                className="bg-background/50 rounded-xl"
                placeholder="e.g. 50"
                value={minScore}
                onChange={(e) => { setPage(1); setMinScore(e.target.value); }}
              />
            </div>
          </div>

          {activeFilterCount > 0 && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={clearAll} className="gap-1.5 text-muted-foreground">
                <X className="w-3.5 h-3.5" />
                Clear all filters
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Stats */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="secondary" className="px-3 py-1 text-sm rounded-xl">
          <Database className="w-3.5 h-3.5 mr-1.5" />
          {total.toLocaleString()} match{total === 1 ? "" : "es"}
        </Badge>
        {isFetching && !isLoading && (
          <span className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" /> updating…
          </span>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="grid gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-card animate-pulse" />
          ))}
        </div>
      ) : buyers.length === 0 ? (
        <Card className="rounded-2xl border-white/5 bg-card p-16 flex flex-col items-center text-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Database className="w-8 h-8 text-primary" />
          </div>
          <div>
            <p className="font-display font-semibold text-lg">
              {activeFilterCount > 0 ? "No buyers match these filters" : "No cash buyers yet"}
            </p>
            <p className="text-muted-foreground text-sm mt-1 max-w-md">
              {activeFilterCount > 0
                ? "Try widening your filters or clearing them to see all results."
                : "Open a lead and run a Cash Buyer Match (AI / Propelio / Propwire). Results appear here as they're discovered."}
            </p>
          </div>
          {activeFilterCount > 0 && (
            <Button variant="outline" className="rounded-xl gap-2" onClick={clearAll}>
              <X className="w-4 h-4" /> Clear filters
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-3">
          {buyers.map((b, i) => (
            <motion.div
              key={b.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 10) * 0.02 }}
            >
              <Card className="rounded-2xl border-white/5 bg-card hover:bg-card/80 transition-all p-5">
                <div className="flex items-start gap-4">
                  {/* Score circle */}
                  <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 flex flex-col items-center justify-center">
                    <span className="text-lg font-bold text-primary leading-none">{b.matchScore}</span>
                    <span className="text-[9px] uppercase text-muted-foreground tracking-wider mt-0.5">Score</span>
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Top row */}
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        {(() => {
                          const isGeneric = !b.buyerName || b.buyerName.startsWith("Investor —") || b.buyerName.startsWith("investor::");
                          const displayName = isGeneric
                            ? (b.llcName || b.mailingAddress || b.buyerName || "Unknown Investor")
                            : (b.llcName && b.llcName !== b.buyerName ? b.llcName : b.buyerName);
                          const subName = isGeneric ? null : (b.llcName && b.llcName !== b.buyerName ? b.buyerName : null);
                          return (
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className={`font-semibold truncate ${isGeneric ? "text-muted-foreground italic" : "text-foreground"}`}>
                                {displayName}
                              </h3>
                              {subName && (
                                <span className="text-xs text-muted-foreground truncate flex items-center gap-1">
                                  <Building2 className="w-3 h-3" /> {subName}
                                </span>
                              )}
                              {isGeneric && !b.llcName && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                  No name (area investor)
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        {(b.city || b.state) && (
                          <p className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <MapPin className="w-3 h-3" />
                            {[b.city, b.state, b.zip].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${SOURCE_BADGE[b.source] ?? "bg-secondary text-muted-foreground border-white/10"}`}>
                          {SOURCE_LABEL[b.source] ?? b.source}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border capitalize ${TYPE_BADGE[b.buyerType] ?? TYPE_BADGE.unknown}`}>
                          {b.buyerType.replace("_", " ")}
                        </span>
                      </div>
                    </div>

                    {/* Stats grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <Stat label="Portfolio" value={b.portfolioSize != null ? `${b.portfolioSize} props` : "—"} />
                      <Stat label="Portfolio Value" value={fmtMoney(b.portfolioValue)} />
                      <Stat label="Avg Purchase" value={fmtMoney(b.avgPurchasePrice)} />
                      <Stat label="Appreciation" value={fmtPct(b.portfolioAppreciation)} />
                    </div>

                    {/* Contacts */}
                    {(b.phones?.length || b.emails?.length) ? (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1">
                        {b.phones?.slice(0, 2).map((p) => (
                          <span key={p} className="flex items-center gap-1.5">
                            <a href={`tel:${p}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                              <Phone className="w-3 h-3" /> {p}
                            </a>
                            <button
                              onClick={() => setDialEntry({ phone: p, leadId: b.leadId, name: b.buyerName || b.llcName || "Cash Buyer" })}
                              className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                              title="Call via Browser Dialer"
                            >
                              <PhoneCall className="w-2.5 h-2.5" /> Call
                            </button>
                          </span>
                        ))}
                        {b.emails?.slice(0, 2).map((e) => (
                          <a key={e} href={`mailto:${e}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                            <Mail className="w-3 h-3" /> {e}
                          </a>
                        ))}
                      </div>
                    ) : null}

                    {/* Match reasons */}
                    {b.matchReasons?.length ? (
                      <div className="flex items-start gap-1.5 pt-1">
                        <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 flex-shrink-0" />
                        <p className="text-xs text-muted-foreground">{b.matchReasons.slice(0, 3).join(" · ")}</p>
                      </div>
                    ) : null}

                    {/* Footer: lead link */}
                    <div className="flex items-center justify-between pt-2 border-t border-white/5">
                      <span className="text-[10px] uppercase text-muted-foreground tracking-wider">
                        Discovered {new Date(b.createdAt).toLocaleDateString()}
                      </span>
                      <Link href={`/leads/${b.leadId}`}>
                        <a className="text-xs text-primary hover:underline flex items-center gap-1">
                          {b.leadAddress ? `Lead: ${b.leadAddress}` : `Lead #${b.leadId}`}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </Link>
                    </div>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            Page {page} of {totalPages.toLocaleString()} · {limit} per page
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm" className="rounded-xl"
              disabled={page <= 1 || isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline" size="sm" className="rounded-xl"
              disabled={page >= totalPages || isFetching}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Browser Dialer modal — triggered by "Call" button on buyer phone numbers */}
      {dialEntry && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setDialEntry(null)}
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm">
            <Suspense fallback={<div className="h-40 animate-pulse bg-card rounded-2xl border border-white/10" />}>
              <BrowserDialer
                leadPhone={dialEntry.phone}
                leadId={dialEntry.leadId}
                leadName={dialEntry.name}
              />
            </Suspense>
            <p className="text-center text-xs text-muted-foreground mt-2">
              Click outside to close — call will log against Lead #{dialEntry.leadId}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary/30 border border-white/5 px-3 py-2">
      <p className="text-[10px] uppercase text-muted-foreground tracking-wider">{label}</p>
      <p className="text-sm font-semibold text-foreground mt-0.5">{value}</p>
    </div>
  );
}

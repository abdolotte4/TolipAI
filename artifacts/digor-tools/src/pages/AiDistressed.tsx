import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Sparkles, Search, RefreshCw, AlertTriangle, CheckCircle2, MapPin,
  Calendar, DollarSign, Building2, Hammer, Scale, Landmark, Banknote, Globe2,
} from "lucide-react";

const CATEGORIES: Array<{ id: string; label: string; icon: any; desc: string }> = [
  { id: "county_clerk",       label: "County Clerk",        icon: Landmark, desc: "Lis pendens & deeds" },
  { id: "public_trustee",     label: "Public Trustee",      icon: Scale,    desc: "Trustee sales (CO, AZ, etc.)" },
  { id: "probate_court",      label: "Probate Court",       icon: Building2, desc: "Estate / inheritance properties" },
  { id: "tax_assessor",       label: "Tax Assessor",        icon: DollarSign, desc: "Tax-delinquent records" },
  { id: "government_reo",     label: "Government REO",      icon: Banknote, desc: "HUD, VA, Fannie/Freddie" },
  { id: "auction_aggregator", label: "Auction Aggregator",  icon: Hammer,   desc: "Auction.com, Hubzu, Xome" },
];

type Listing = {
  id?: string;
  address: string;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  type?: string | null;
  saleDate?: string | null;
  openingBid?: number | null;
  ownerName?: string | null;
  parcelId?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
};

type JobStatus = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | string;
  progress?: number;
  message?: string;
  error?: string | null;
  result?: { listings?: Listing[]; counts?: Record<string, number> };
};

function fmtMoney(n?: number | null) {
  if (n == null) return "—";
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function TypeBadge({ type }: { type?: string | null }) {
  if (!type) return null;
  const map: Record<string, string> = {
    trustee_sale:   "bg-rose-500/15 text-rose-300 border-rose-500/30",
    auction:        "bg-orange-500/15 text-orange-300 border-orange-500/30",
    preforeclosure: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    lien:           "bg-purple-500/15 text-purple-300 border-purple-500/30",
    reo:            "bg-sky-500/15 text-sky-300 border-sky-500/30",
    probate:        "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  };
  return (
    <Badge variant="outline" className={`text-[10px] capitalize ${map[type] ?? ""}`}>
      {type.replace(/_/g, " ")}
    </Badge>
  );
}

export default function AiDistressed() {
  const { pin } = useAuth();
  const [zip, setZip] = useState("");
  const [city, setCity] = useState("");
  const [county, setCounty] = useState("");
  const [state, setState] = useState("");
  const [selected, setSelected] = useState<string[]>(CATEGORIES.map(c => c.id));
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const toggle = (id: string) =>
    setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));

  useEffect(() => {
    if (!jobId) return;
    if (job?.status === "completed" || job?.status === "failed") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/scraper-engine/distressed/${jobId}`, {
          headers: { "X-Tools-Pin": pin || "" },
        });
        if (!res.ok) return;
        const data: JobStatus = await res.json();
        setJob(data);
        if (data.result?.listings) setListings(data.result.listings);
        if (data.status === "completed" || data.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          if (data.status === "failed") setError(data.error || "Search failed.");
        }
      } catch {
        /* keep polling */
      }
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line
  }, [jobId, job?.status, pin]);

  const handleStart = async () => {
    setError(null);
    if (!state.trim()) { setError("State is required (e.g. FL, CA, AZ)."); return; }
    if (selected.length === 0) { setError("Pick at least one source category."); return; }
    setStarting(true);
    setListings([]);
    setJob(null);
    try {
      const res = await fetch(`/api/scraper-engine/distressed`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tools-Pin": pin || "" },
        body: JSON.stringify({
          zip:    zip.trim()   || undefined,
          city:   city.trim()  || undefined,
          county: county.trim()|| undefined,
          state:  state.trim().toUpperCase(),
          categories: selected,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as any));
        throw new Error(err.error || `Failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      setJobId(data.jobId || data.id);
      setJob({ id: data.jobId || data.id, status: "queued", progress: 0 });
    } catch (e: any) {
      setError(e?.message || "Could not start.");
    } finally {
      setStarting(false);
    }
  };

  const isRunning = job && (job.status === "queued" || job.status === "running");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30
                        flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">AI Multi-Source Distressed</h1>
          <p className="text-sm text-muted-foreground">
            Free public-record scraping powered by Crawl4AI + Playwright + Kimi K2.
            27 sources across 6 categories.
          </p>
        </div>
      </div>

      {/* Search form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Search Parameters</CardTitle>
          <CardDescription>
            County / state are used to look up the right public-record source. ZIP narrows the result set.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">State *</Label>
              <Input value={state} onChange={e => setState(e.target.value)}
                     placeholder="FL" maxLength={2} className="uppercase" />
            </div>
            <div>
              <Label className="text-xs">County</Label>
              <Input value={county} onChange={e => setCounty(e.target.value)}
                     placeholder="Orange" />
            </div>
            <div>
              <Label className="text-xs">City</Label>
              <Input value={city} onChange={e => setCity(e.target.value)} placeholder="Orlando" />
            </div>
            <div>
              <Label className="text-xs">ZIP</Label>
              <Input value={zip} onChange={e => setZip(e.target.value)} placeholder="32801" />
            </div>
          </div>

          <div>
            <Label className="text-xs mb-2 block">Source categories</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {CATEGORIES.map(cat => {
                const Icon = cat.icon;
                const checked = selected.includes(cat.id);
                return (
                  <label key={cat.id}
                         className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer
                                     transition-colors ${
                                       checked
                                         ? "border-primary/50 bg-primary/5"
                                         : "border-white/5 bg-secondary/30 hover:bg-secondary/50"
                                     }`}>
                    <Checkbox checked={checked} onCheckedChange={() => toggle(cat.id)}
                              className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-primary" />
                        <span className="text-sm font-medium">{cat.label}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{cat.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button
            onClick={handleStart}
            disabled={starting || Boolean(isRunning)}
            className="rounded-xl gap-2 w-full sm:w-auto"
          >
            {starting || isRunning ? (
              <><RefreshCw className="w-4 h-4 animate-spin" /> Scraping…</>
            ) : (
              <><Search className="w-4 h-4" /> Run AI Multi-Source Scrape</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Progress */}
      {job && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground inline-flex items-center gap-2">
                {job.status === "completed" ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                )}
                {job.message || job.status}
              </span>
              <span className="tabular-nums text-xs text-muted-foreground">
                {Math.round(job.progress ?? 0)}% · job {job.id?.slice(0, 8)}
              </span>
            </div>
            <Progress value={job.progress ?? 0} className="h-1.5" />

            {job.result?.counts && (
              <div className="flex flex-wrap gap-2 pt-1">
                {Object.entries(job.result.counts).map(([k, v]) => (
                  <Badge key={k} variant="outline" className="text-[10px]">
                    {k}: {v}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {listings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {listings.length} distressed listing{listings.length !== 1 ? "s" : ""} found
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">Address</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Sale Date</th>
                  <th className="py-2 pr-3">Opening Bid</th>
                  <th className="py-2 pr-3">Owner</th>
                  <th className="py-2 pr-3">Source</th>
                </tr>
              </thead>
              <tbody>
                {listings.map((l, i) => (
                  <tr key={l.id ?? i}
                      className="border-b border-border/50 hover:bg-secondary/30">
                    <td className="py-2 pr-3">
                      <div className="flex items-start gap-2">
                        <MapPin className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                        <div>
                          <div className="font-medium">{l.address}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {[l.city, l.state, l.zip].filter(Boolean).join(", ")}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2 pr-3"><TypeBadge type={l.type} /></td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground inline-flex items-center gap-1">
                      {l.saleDate && <Calendar className="w-3 h-3" />}
                      {l.saleDate ? new Date(l.saleDate).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{fmtMoney(l.openingBid)}</td>
                    <td className="py-2 pr-3 text-xs truncate max-w-[180px]">
                      {l.ownerName || "—"}
                    </td>
                    <td className="py-2 pr-3">
                      {l.sourceUrl ? (
                        <a href={l.sourceUrl} target="_blank" rel="noreferrer"
                           className="text-primary hover:underline inline-flex items-center gap-1 text-xs">
                          <Globe2 className="w-3 h-3" /> {l.source || "link"}
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">{l.source || "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

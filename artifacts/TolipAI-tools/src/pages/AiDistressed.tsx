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
import { Sparkles, Search, RefreshCw, AlertTriangle, CheckCircle2, MapPin, Calendar, DollarSign, Building2, Hammer, Scale, Landmark, Banknote, Globe2 } from "lucide-react";

const CATEGORIES = [
  { id: "county_clerk", label: "County Clerk", icon: Landmark, desc: "Lis pendens & deeds" },
  { id: "public_trustee", label: "Public Trustee", icon: Scale, desc: "Trustee sales (CO, AZ, etc.)" },
  { id: "probate_court", label: "Probate Court", icon: Building2, desc: "Estate / inheritance properties" },
  { id: "tax_assessor", label: "Tax Assessor", icon: DollarSign, desc: "Tax-delinquent records" },
  { id: "government_reo", label: "Government REO", icon: Banknote, desc: "HUD, VA, Fannie/Freddie" },
  { id: "auction_aggregator", label: "Auction Aggregator", icon: Hammer, desc: "Auction.com, Hubzu, Xome" },
];

function fmtMoney(n?: number | null) { if (n == null) return "—"; return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`; }

function TypeBadge({ type }: { type?: string | null }) { if (!type) return null; return <Badge variant="outline" className="text-[10px] capitalize">{type.replace(/_/g, " ")}</Badge>; }

export default function AiDistressed() {
  const { pin } = useAuth();
  const [zip, setZip] = useState("");
  const [city, setCity] = useState("");
  const [county, setCounty] = useState("");
  const [state, setState] = useState("");
  const [selected, setSelected] = useState<string[]>(CATEGORIES.map(c => c.id));
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<any>(null);
  const [listings, setListings] = useState<any[]>([]);
  const [starting, setStarting] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const toggle = (id: string) => setSelected(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]));
  const normalizeListings = (data: any): any[] => {
    if (Array.isArray(data?.result)) return data.result;
    if (Array.isArray(data?.result?.listings)) return data.result.listings;
    if (Array.isArray(data?.result?.results)) return data.result.results;
    if (Array.isArray(data?.listings)) return data.listings;
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data?.data)) return data.data;
    return [];
  };

  useEffect(() => {
    if (!jobId) return;
    if (job?.status === "completed" || job?.status === "failed") {
      if (pollRef.current) clearInterval(pollRef.current);
      setFinished(true);
      return;
    }
    pollRef.current = setInterval(async () => {
      const res = await fetch(`/api/tools/distressed/status/${jobId}`, { headers: { "X-Tools-Pin": pin || "" } });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem("TolipAI_tools_pin");
        window.location.href = "/";
        return;
      }
      if (!res.ok) return;
      const data = await res.json();
      setJob(data);
      setListings(normalizeListings(data));
      if (data.status === "completed" || data.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        setFinished(true);
      }
    }, 2500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId, job?.status, pin]);

  const handleStart = async () => {
    setError(null);
    if (!state.trim()) { setError("State is required (e.g. FL, CA, AZ)."); return; }
    if (selected.length === 0) { setError("Pick at least one source category."); return; }
    setStarting(true);
    setFinished(false);
    setListings([]);
    setJob(null);
    try {
      const res = await fetch(`/api/tools/distressed/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tools-Pin": pin || "" },
        body: JSON.stringify({ zip: zip.trim() || undefined, city: city.trim() || undefined, county: county.trim() || undefined, state: state.trim().toUpperCase(), categories: selected }),
      });
      if (res.status === 401 || res.status === 403) {
        localStorage.removeItem("TolipAI_tools_pin");
        window.location.href = "/";
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as any));
        throw new Error(err.error || `Failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      setJobId(data.jobId || data.id);
      setJob({ id: data.jobId || data.id, status: data.status || "queued", progress: 0 });
      setListings(normalizeListings(data));
      setFinished(data.status === "completed" || data.status === "failed");
    } catch (e: any) { setError(e?.message || "Could not start."); }
    finally { setStarting(false); }
  };

  return <div className="space-y-6"><Card><CardHeader><CardTitle>AI Multi-Source Distressed</CardTitle><CardDescription>Free public-record scraping powered by Crawl4AI + Playwright + Kimi K2.</CardDescription></CardHeader><CardContent><div className="grid grid-cols-1 md:grid-cols-4 gap-3">{['State','County','City','ZIP'].map((x, i) => <div key={x}><Label className="text-xs">{x}</Label><Input value={[state, county, city, zip][i]} onChange={e => [setState,setCounty,setCity,setZip][i](e.target.value)} /></div>)}</div><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mt-4">{CATEGORIES.map(cat => { const checked = selected.includes(cat.id); const Icon = cat.icon; return <label key={cat.id} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${checked ? "border-primary/50 bg-primary/5" : "border-white/5 bg-secondary/30"}`}><Checkbox checked={checked} onCheckedChange={() => toggle(cat.id)} className="mt-0.5" /><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><Icon className="w-4 h-4 text-primary" /><span className="text-sm font-medium">{cat.label}</span></div><p className="text-[11px] text-muted-foreground mt-0.5">{cat.desc}</p></div></label>; })}</div>{error && <Alert variant="destructive" className="mt-4"><AlertTriangle className="h-4 w-4" /><AlertTitle>Error</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}<Button onClick={handleStart} disabled={starting} className="rounded-xl gap-2 w-full sm:w-auto mt-4">{starting ? <><RefreshCw className="w-4 h-4 animate-spin" /> Scraping…</> : <><Search className="w-4 h-4" /> Run AI Multi-Source Scrape</>}</Button></CardContent></Card>{job && <Card><CardContent className="pt-6 space-y-3"><div className="flex items-center justify-between text-sm"><span className="text-muted-foreground inline-flex items-center gap-2">{job.status === "completed" ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <RefreshCw className={`${finished ? "hidden" : "animate-spin"} w-4 h-4 text-primary`} />}{job.message || job.status}</span><span className="tabular-nums text-xs text-muted-foreground">{Math.round(job.progress ?? 0)}% · job {String(job.id || job.jobId || "").slice(0, 8)}</span></div><Progress value={job.progress ?? 0} className="h-1.5" /></CardContent></Card>}{listings.length > 0 && <Card><CardHeader><CardTitle>{listings.length} distressed listings found</CardTitle></CardHeader><CardContent className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>Address</th><th>Type</th><th>Sale Date</th><th>Opening Bid</th><th>Owner</th><th>Source</th></tr></thead><tbody>{listings.map((l, i) => <tr key={l.id ?? i}><td>{l.address}</td><td><TypeBadge type={l.distressType || l.distress_type} /></td><td>{(l.saleDate || l.sale_date) ? new Date(l.saleDate || l.sale_date).toLocaleDateString() : "—"}</td><td>{fmtMoney(l.openingBid ?? l.opening_bid)}</td><td>{l.ownerName || l.owner_name || "—"}</td><td>{l.source || "—"}</td></tr>)}</tbody></table></CardContent></Card>}</div>;
}

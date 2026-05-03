import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  MapPin, Search, Play, CheckSquare, Square, AlertTriangle,
  Download, Plus, RefreshCw, Loader2, ChevronRight, X,
  Home, Gavel, DollarSign, ScrollText, Building2, Landmark,
  ShoppingBag, Satellite, Phone, Mail, ExternalLink, CheckCircle2,
  Zap, Filter, SlidersHorizontal,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useCrmGetMe } from "@workspace/api-client-react";

type LeadTypeKey =
  | "county_clerk" | "public_trustee" | "tax_assessor"
  | "probate_court" | "government_reo" | "auction_aggregator"
  | "homeharvest" | "satellite_dfd";

interface LeadType {
  key: LeadTypeKey;
  label: string;
  description: string;
  icon: any;
  color: string;
  badgeClass: string;
  distressType: string;
  engine: "distressed" | "homeharvest" | "satellite";
}

interface AreaTarget {
  city: string;
  county: string;
  state: string;
  zip: string;
}

interface JobState {
  jobId: string;
  engine: "distressed" | "homeharvest" | "satellite";
  label: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  message?: string;
  listings: any[];
  markdownTable?: string;
}

const LEAD_TYPES: LeadType[] = [
  { key: "county_clerk", label: "Pre-Foreclosure", description: "Lis pendens filings — owner behind on mortgage", icon: Home, color: "text-orange-400", badgeClass: "bg-orange-500/10 text-orange-300 border-orange-500/30", distressType: "preforeclosure", engine: "distressed" },
  { key: "public_trustee", label: "Foreclosure / Trustee Sale", description: "Active auction listings from county trustees", icon: Gavel, color: "text-red-400", badgeClass: "bg-red-500/10 text-red-300 border-red-500/30", distressType: "trustee_sale", engine: "distressed" },
  { key: "tax_assessor", label: "Tax Delinquent", description: "Overdue property taxes — risk of tax lien sale", icon: DollarSign, color: "text-yellow-400", badgeClass: "bg-yellow-500/10 text-yellow-300 border-yellow-500/30", distressType: "tax_lien", engine: "distressed" },
  { key: "probate_court", label: "Probate / Inherited", description: "Estate court records — inherited & distressed sales", icon: ScrollText, color: "text-purple-400", badgeClass: "bg-purple-500/10 text-purple-300 border-purple-500/30", distressType: "probate", engine: "distressed" },
  { key: "government_reo", label: "REO / Government", description: "HUD, Fannie Mae, Freddie Mac, VA, USDA", icon: Landmark, color: "text-blue-400", badgeClass: "bg-blue-500/10 text-blue-300 border-blue-500/30", distressType: "reo", engine: "distressed" },
  { key: "auction_aggregator", label: "Auction Properties", description: "Auction.com, Hubzu, Xome listings", icon: ShoppingBag, color: "text-indigo-400", badgeClass: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30", distressType: "auction", engine: "distressed" },
  { key: "homeharvest", label: "MLS Listings + Skip Trace", description: "Zillow / Realtor.com listings with free OSINT contact info", icon: Building2, color: "text-emerald-400", badgeClass: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", distressType: "mls_listing", engine: "homeharvest" },
  { key: "satellite_dfd", label: "Damaged Buildings (AI)", description: "Satellite + AI damage detection — flood, fire, neglect", icon: Satellite, color: "text-rose-400", badgeClass: "bg-rose-500/10 text-rose-300 border-rose-500/30", distressType: "damaged", engine: "satellite" },
];

const DISTRESS_TYPE_BADGE: Record<string, string> = {
  preforeclosure: "bg-orange-500/10 text-orange-300 border-orange-500/30",
  trustee_sale: "bg-red-500/10 text-red-300 border-red-500/30",
  tax_lien: "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
  probate: "bg-purple-500/10 text-purple-300 border-purple-500/30",
  reo: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  auction: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
  mls_listing: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  damaged: "bg-rose-500/10 text-rose-300 border-rose-500/30",
};

function apiFetch(path: string, init?: RequestInit) {
  const token = localStorage.getItem("crm_token");
  return fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  }).then(async r => {
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `Request failed ${r.status}`);
    return data;
  });
}

function toolsFetch(path: string, init?: RequestInit) {
  const token = localStorage.getItem("crm_token");
  return fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Tools-Pin": token ? token : "",
      ...(init?.headers || {}),
    },
  }).then(async r => {
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `Request failed ${r.status}`);
    return data;
  });
}

function LeadRow({ lead, onImport, importing }: { lead: any; onImport: (l: any) => void; importing: boolean }) {
  const distressType = lead.distress_type || lead.distressType || "unknown";
  const badgeClass = DISTRESS_TYPE_BADGE[distressType] || "bg-secondary text-muted-foreground border-white/10";
  const phones: string[] = Array.isArray(lead.phones) ? lead.phones.map((p: any) => typeof p === "string" ? p : p?.number || "").filter(Boolean) : [];
  const emails: string[] = Array.isArray(lead.emails) ? lead.emails.map((e: any) => typeof e === "string" ? e : e?.email || "").filter(Boolean) : [];
  const hasDnc = Array.isArray(lead.phones) && lead.phones.some((p: any) => p?.dnc_status === "flagged");
  const addr = lead.address || [lead.street, lead.city, lead.state].filter(Boolean).join(", ");
  const owner = lead.owner_name || lead.ownerName || lead.sellerName || "—";
  const equity = lead.estimated_equity ? `$${Number(lead.estimated_equity).toLocaleString()}` : lead.equity ? `$${Number(lead.equity).toLocaleString()}` : "—";

  return (
    <motion.tr initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="border-b border-border hover:bg-secondary/30 transition-colors group">
      <td className="px-4 py-3"><div className="font-medium text-sm text-foreground leading-snug">{addr || "—"}</div>{lead.city && <div className="text-xs text-muted-foreground">{[lead.city, lead.state, lead.zip].filter(Boolean).join(", ")}</div>}</td>
      <td className="px-4 py-3 text-sm text-foreground">{owner}</td>
      <td className="px-4 py-3"><Badge variant="outline" className={`text-xs ${badgeClass}`}>{distressType.replace(/_/g, " ")}</Badge></td>
      <td className="px-4 py-3 text-sm font-mono text-emerald-400">{equity}</td>
      <td className="px-4 py-3"><div className="space-y-1">{phones.slice(0, 2).map((p, i) => (<div key={i} className="flex items-center gap-1 text-xs text-foreground"><Phone className="w-3 h-3 text-muted-foreground flex-shrink-0" /><span>{p}</span>{hasDnc && i === 0 && <span title="DNC flagged"><AlertTriangle className="w-3 h-3 text-yellow-400" /></span>}</div>))}{phones.length === 0 && <span className="text-xs text-muted-foreground italic">—</span>}</div></td>
      <td className="px-4 py-3"><div className="space-y-1">{emails.slice(0, 2).map((e, i) => (<div key={i} className="flex items-center gap-1 text-xs text-foreground"><Mail className="w-3 h-3 text-muted-foreground flex-shrink-0" /><span className="truncate max-w-[140px]">{e}</span></div>))}{emails.length === 0 && <span className="text-xs text-muted-foreground italic">—</span>}</div></td>
      <td className="px-4 py-3"><div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">{lead.listing_url && <a href={lead.listing_url} target="_blank" rel="noopener noreferrer"><Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1"><ExternalLink className="w-3 h-3" /> View</Button></a>}<Button variant="outline" size="sm" className="h-7 px-2 text-xs gap-1 text-primary border-primary/30 hover:bg-primary/10" onClick={() => onImport(lead)} disabled={importing}><Plus className="w-3 h-3" /> Import</Button></div></td>
    </motion.tr>
  );
}

export default function DistressedLeadGen() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useCrmGetMe();
  const [area, setArea] = useState<AreaTarget>({ city: "", county: "", state: "FL", zip: "" });
  const [selectedTypes, setSelectedTypes] = useState<Set<LeadTypeKey>>(new Set(["county_clerk", "public_trustee", "tax_assessor"]));
  const [limit, setLimit] = useState(10);
  const [doSkipTrace, setDoSkipTrace] = useState(true);
  const [doDncCheck, setDoDncCheck] = useState(true);
  const [saveToCrm, setSaveToCrm] = useState(false);
  const [mlsSite, setMlsSite] = useState<"zillow" | "realtor.com" | "all">("zillow");
  const [mlsListingType, setMlsListingType] = useState<"for_sale" | "sold" | "pending">("for_sale");
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [importingLead, setImportingLead] = useState<number | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [view, setView] = useState<"setup" | "results">("setup");

  const activeJob = jobs.find(j => j.jobId === activeJobId) ?? jobs[0] ?? null;
  const allListings = jobs.flatMap(j => j.listings);
  const filteredListings = searchFilter ? allListings.filter(l => { const q = searchFilter.toLowerCase(); return ((l.address || "").toLowerCase().includes(q) || (l.owner_name || "").toLowerCase().includes(q) || (l.city || "").toLowerCase().includes(q) || (l.zip || "").toLowerCase().includes(q)); }) : allListings;

  const toggle = (key: LeadTypeKey) => setSelectedTypes(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const selectAll = () => setSelectedTypes(new Set(LEAD_TYPES.map(t => t.key as LeadTypeKey)));

  return <div className="p-6 text-foreground space-y-4"><Card className="p-6"><h1 className="text-2xl font-bold">Distressed Lead Gen</h1><p className="text-sm text-muted-foreground mt-2">Build distressed lead lists from multiple sources and import them into CRM.</p><div className="mt-4 grid gap-3 md:grid-cols-4"><div><Label className="text-xs">City</Label><Input value={area.city} onChange={e => setArea(a => ({ ...a, city: e.target.value }))} /></div><div><Label className="text-xs">County</Label><Input value={area.county} onChange={e => setArea(a => ({ ...a, county: e.target.value }))} /></div><div><Label className="text-xs">State</Label><Input value={area.state} onChange={e => setArea(a => ({ ...a, state: e.target.value }))} /></div><div><Label className="text-xs">ZIP</Label><Input value={area.zip} onChange={e => setArea(a => ({ ...a, zip: e.target.value }))} /></div></div><div className="mt-4 flex flex-wrap gap-2">{LEAD_TYPES.map(type => <button key={type.key} onClick={() => toggle(type.key)} className={`rounded-full border px-3 py-1 text-xs ${selectedTypes.has(type.key) ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border"}`}>{type.label}</button>)}<Button variant="outline" size="sm" onClick={selectAll}>Select all</Button></div><div className="mt-4 flex items-center gap-3"><Button disabled={isRunning} className="gap-2"><Play className="w-4 h-4" /> Run Search</Button><Button variant="outline" className="gap-2"><Download className="w-4 h-4" /> Export</Button></div></Card><Card className="p-6"><div className="flex items-center justify-between"><h2 className="font-semibold">Results</h2><Badge variant="outline">{filteredListings.length} leads</Badge></div><div className="mt-4 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-muted-foreground"><th className="px-4 py-2">Address</th><th className="px-4 py-2">Owner</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Equity</th><th className="px-4 py-2">Phone</th><th className="px-4 py-2">Email</th><th className="px-4 py-2">Actions</th></tr></thead><tbody>{filteredListings.map((lead, i) => <LeadRow key={i} lead={lead} onImport={() => {}} importing={false} />)}</tbody></table></div></Card></div>;
}

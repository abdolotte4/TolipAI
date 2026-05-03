import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
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

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Lead type definitions ────────────────────────────────────────────────────

const LEAD_TYPES: LeadType[] = [
  {
    key: "county_clerk",
    label: "Pre-Foreclosure",
    description: "Lis pendens filings — owner behind on mortgage",
    icon: Home,
    color: "text-orange-400",
    badgeClass: "bg-orange-500/10 text-orange-300 border-orange-500/30",
    distressType: "preforeclosure",
    engine: "distressed",
  },
  {
    key: "public_trustee",
    label: "Foreclosure / Trustee Sale",
    description: "Active auction listings from county trustees",
    icon: Gavel,
    color: "text-red-400",
    badgeClass: "bg-red-500/10 text-red-300 border-red-500/30",
    distressType: "trustee_sale",
    engine: "distressed",
  },
  {
    key: "tax_assessor",
    label: "Tax Delinquent",
    description: "Overdue property taxes — risk of tax lien sale",
    icon: DollarSign,
    color: "text-yellow-400",
    badgeClass: "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
    distressType: "tax_lien",
    engine: "distressed",
  },
  {
    key: "probate_court",
    label: "Probate / Inherited",
    description: "Estate court records — inherited & distressed sales",
    icon: ScrollText,
    color: "text-purple-400",
    badgeClass: "bg-purple-500/10 text-purple-300 border-purple-500/30",
    distressType: "probate",
    engine: "distressed",
  },
  {
    key: "government_reo",
    label: "REO / Government",
    description: "HUD, Fannie Mae, Freddie Mac, VA, USDA",
    icon: Landmark,
    color: "text-blue-400",
    badgeClass: "bg-blue-500/10 text-blue-300 border-blue-500/30",
    distressType: "reo",
    engine: "distressed",
  },
  {
    key: "auction_aggregator",
    label: "Auction Properties",
    description: "Auction.com, Hubzu, Xome listings",
    icon: ShoppingBag,
    color: "text-indigo-400",
    badgeClass: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
    distressType: "auction",
    engine: "distressed",
  },
  {
    key: "homeharvest",
    label: "MLS Listings + Skip Trace",
    description: "Zillow / Realtor.com listings with free OSINT contact info",
    icon: Building2,
    color: "text-emerald-400",
    badgeClass: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    distressType: "mls_listing",
    engine: "homeharvest",
  },
  {
    key: "satellite_dfd",
    label: "Damaged Buildings (AI)",
    description: "Satellite + AI damage detection — flood, fire, neglect",
    icon: Satellite,
    color: "text-rose-400",
    badgeClass: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    distressType: "damaged",
    engine: "satellite",
  },
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const DISTRESS_TYPE_BADGE: Record<string, string> = {
  preforeclosure:  "bg-orange-500/10 text-orange-300 border-orange-500/30",
  trustee_sale:    "bg-red-500/10 text-red-300 border-red-500/30",
  tax_lien:        "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
  probate:         "bg-purple-500/10 text-purple-300 border-purple-500/30",
  reo:             "bg-blue-500/10 text-blue-300 border-blue-500/30",
  auction:         "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",
  mls_listing:     "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  damaged:         "bg-rose-500/10 text-rose-300 border-rose-500/30",
};

// ─── Auth fetch helpers ───────────────────────────────────────────────────────

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

// ─── LeadRow component ────────────────────────────────────────────────────────

function LeadRow({ lead, onImport, importing }: { lead: any; onImport: (l: any) => void; importing: boolean }) {
  const distressType = lead.distress_type || lead.distressType || "unknown";
  const badgeClass = DISTRESS_TYPE_BADGE[distressType] || "bg-secondary text-muted-foreground border-white/10";
  const phones: string[] = Array.isArray(lead.phones)
    ? lead.phones.map((p: any) => typeof p === "string" ? p : p?.number || "").filter(Boolean)
    : [];
  const emails: string[] = Array.isArray(lead.emails)
    ? lead.emails.map((e: any) => typeof e === "string" ? e : e?.email || "").filter(Boolean)
    : [];
  const hasDnc = Array.isArray(lead.phones) && lead.phones.some((p: any) => p?.dnc_status === "flagged");

  const addr = lead.address || [lead.street, lead.city, lead.state].filter(Boolean).join(", ");
  const owner = lead.owner_name || lead.ownerName || lead.sellerName || "—";
  const equity = lead.estimated_equity
    ? `$${Number(lead.estimated_equity).toLocaleString()}`
    : lead.equity ? `$${Number(lead.equity).toLocaleString()}` : "—";

  return (
    <motion.tr
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-b border-border hover:bg-secondary/30 transition-colors group"
    >
      <td className="px-4 py-3">
        <div className="font-medium text-sm text-foreground leading-snug">{addr || "—"}</div>
        {lead.city && <div className="text-xs text-muted-foreground">{[lead.city, lead.state, lead.zip].filter(Boolean).join(", ")}</div>}
      </td>
      <td className="px-4 py-3 text-sm text-foreground">{owner}</td>
      <td className="px-4 py-3">
        <Badge variant="outline" className={`text-xs ${badgeClass}`}>
          {distressType.replace(/_/g, " ")}
        </Badge>
      </td>
      <td className="px-4 py-3 text-sm font-mono text-emerald-400">{equity}</td>
      <td className="px-4 py-3">
        <div className="space-y-1">
          {phones.slice(0, 2).map((p, i) => (
            <div key={i} className="flex items-center gap-1 text-xs text-foreground">
              <Phone className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span>{p}</span>
              {hasDnc && i === 0 && <span title="DNC flagged"><AlertTriangle className="w-3 h-3 text-yellow-400" /></span>}
            </div>
          ))}
          {phones.length === 0 && <span className="text-xs text-muted-foreground italic">—</span>}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="space-y-1">
          {emails.slice(0, 2).map((e, i) => (
            <div key={i} className="flex items-center gap-1 text-xs text-foreground">
              <Mail className="w-3 h-3 text-muted-foreground flex-shrink-0" />
              <span className="truncate max-w-[140px]">{e}</span>
            </div>
          ))}
          {emails.length === 0 && <span className="text-xs text-muted-foreground italic">—</span>}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {lead.listing_url && (
            <a href={lead.listing_url} target="_blank" rel="noopener noreferrer">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                <ExternalLink className="w-3 h-3" /> View
              </Button>
            </a>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1 text-primary border-primary/30 hover:bg-primary/10"
            onClick={() => onImport(lead)}
            disabled={importing}
          >
            <Plus className="w-3 h-3" /> Import
          </Button>
        </div>
      </td>
    </motion.tr>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DistressedLeadGen() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: me } = useCrmGetMe();

  // Area
  const [area, setArea] = useState<AreaTarget>({ city: "", county: "", state: "FL", zip: "" });

  // Lead type selection
  const [selectedTypes, setSelectedTypes] = useState<Set<LeadTypeKey>>(
    new Set(["county_clerk", "public_trustee", "tax_assessor"])
  );

  // Options
  const [limit, setLimit] = useState(10);
  const [doSkipTrace, setDoSkipTrace] = useState(true);
  const [doDncCheck, setDoDncCheck] = useState(true);
  const [saveToCrm, setSaveToCrm] = useState(false);
  const [mlsSite, setMlsSite] = useState<"zillow" | "realtor.com" | "all">("zillow");
  const [mlsListingType, setMlsListingType] = useState<"for_sale" | "sold" | "pending">("for_sale");

  // Jobs
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Results view
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [importingLead, setImportingLead] = useState<number | null>(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [view, setView] = useState<"setup" | "results">("setup");

  const activeJob = jobs.find(j => j.jobId === activeJobId) ?? jobs[0] ?? null;
  const allListings = jobs.flatMap(j => j.listings);
  const filteredListings = searchFilter
    ? allListings.filter(l => {
        const q = searchFilter.toLowerCase();
        return (
          (l.address || "").toLowerCase().includes(q) ||
          (l.owner_name || "").toLowerCase().includes(q) ||
          (l.city || "").toLowerCase().includes(q) ||
          (l.zip || "").toLowerCase().includes(q)
        );
      })
    : allListings;

  // Toggle a lead type
  const toggle = (key: LeadTypeKey) => {
    setSelectedTypes(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAll = () => setSelectedTypes(new Set(LEAD_TYPES.map(t => t.key as LeadTypeKey)));
  const clearAll = () => setSelectedTypes(new Set());

  // Poll job progress
  const pollJobs = (jobList: JobState[]) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      let allDone = true;
      const updated = await Promise.all(
        jobList.map(async j => {
          if (j.status === "completed" || j.status === "failed") return j;
          try {
            const data = await apiFetch(`/scraper-engine/jobs/${j.jobId}`);
            const status = data.status === "done" ? "completed" : data.status;
            const listings = data.listings || data.result?.listings || [];
            const markdownTable = data.result?.markdown_table;
            if (status !== "completed" && status !== "failed") allDone = false;
            return { ...j, status, progress: data.progress ?? j.progress, message: data.message, listings, markdownTable };
          } catch {
            allDone = false;
            return j;
          }
        })
      );
      setJobs(updated);
      if (allDone) {
        clearInterval(pollRef.current!);
        setIsRunning(false);
        const total = updated.flatMap(j => j.listings).length;
        toast({ title: `Lead gen complete`, description: `${total} leads found across ${updated.length} scan(s)` });
      }
    }, 3000);
  };

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // Submit
  const handleRun = async () => {
    const types = Array.from(selectedTypes);
    if (types.length === 0) {
      toast({ title: "Select at least one lead type", variant: "destructive" }); return;
    }
    if (!area.state) {
      toast({ title: "Select a state", variant: "destructive" }); return;
    }

    setIsRunning(true);
    setJobs([]);
    setView("results");

    const distressedCategories = types
      .map(k => LEAD_TYPES.find(t => t.key === k))
      .filter(t => t?.engine === "distressed")
      .map(t => t!.key);

    const doHomeharvest = types.includes("homeharvest");
    const doSatellite = types.includes("satellite_dfd");

    const newJobs: JobState[] = [];

    try {
      // ── Distressed sources ──────────────────────────────────────────────
      if (distressedCategories.length > 0) {
        const payload: any = {
          categories: distressedCategories,
          state: area.state,
        };
        if (area.zip) payload.zip = area.zip;
        if (area.city) payload.city = area.city;
        if (area.county) payload.county = area.county;

        const job = await apiFetch("/scraper-engine/lead-gen/distressed", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        newJobs.push({
          jobId: job.jobId || job.id || job.job_id,
          engine: "distressed",
          label: `Public Records (${distressedCategories.length} categories)`,
          status: "queued",
          progress: 0,
          listings: [],
        });
      }

      // ── HomeHarvest MLS + skip trace ────────────────────────────────────
      if (doHomeharvest && area.city) {
        const job = await apiFetch("/scraper-engine/lead-gen/foreclosure", {
          method: "POST",
          body: JSON.stringify({
            city: area.city,
            state: area.state,
            listingType: mlsListingType,
            site: mlsSite,
            limit,
            doSkipTrace,
            doDncCheck,
            saveToCrm,
          }),
        });
        newJobs.push({
          jobId: job.jobId || job.id || job.job_id,
          engine: "homeharvest",
          label: `MLS Listings — ${mlsSite} (${area.city}, ${area.state})`,
          status: "queued",
          progress: 0,
          listings: [],
        });
      } else if (doHomeharvest && !area.city) {
        toast({ title: "City required for MLS scan", description: "Enter a city to use the MLS listing scanner.", variant: "destructive" });
      }

      // ── Satellite damage ────────────────────────────────────────────────
      if (doSatellite) {
        const job = await apiFetch("/scraper-engine/ai/satellite-dfd", {
          method: "POST",
          body: JSON.stringify({
            city: area.city || "",
            state: area.state,
            zip: area.zip || "",
            minScore: 40,
            maxResults: limit,
            useAiScoring: true,
          }),
          headers: { "X-Tools-Pin": "" },
        }).catch(() => null);
        if (job?.jobId || job?.id) {
          newJobs.push({
            jobId: job.jobId || job.id,
            engine: "satellite",
            label: `Satellite Damage Scan — ${area.state}`,
            status: "queued",
            progress: 0,
            listings: [],
          });
        }
      }

      if (newJobs.length === 0) {
        setIsRunning(false);
        toast({ title: "No jobs started", description: "Check your selections and try again.", variant: "destructive" });
        return;
      }

      setJobs(newJobs);
      if (newJobs.length > 0) setActiveJobId(newJobs[0].jobId);
      pollJobs(newJobs);

    } catch (err: any) {
      setIsRunning(false);
      toast({ title: "Failed to start scan", description: err.message, variant: "destructive" });
    }
  };

  // Import a single lead to CRM
  const importLead = async (lead: any) => {
    const id = lead.id ?? Math.random();
    setImportingLead(id);
    try {
      const phones: string[] = Array.isArray(lead.phones)
        ? lead.phones.map((p: any) => typeof p === "string" ? p : p?.number || "").filter(Boolean)
        : [];
      const emails: string[] = Array.isArray(lead.emails)
        ? lead.emails.map((e: any) => typeof e === "string" ? e : e?.email || "").filter(Boolean)
        : [];

      const payload = {
        sellerName: lead.owner_name || lead.ownerName || "Unknown Owner",
        phone: phones[0] || "",
        email: emails[0] || "",
        address: lead.street || lead.address?.split(",")[0] || lead.address || "",
        city: lead.city || area.city || "",
        state: lead.state || area.state || "",
        zip: lead.zip || area.zip || "",
        arv: lead.estimated_value || lead.zestimate || null,
        notes: [
          `Distress type: ${lead.distress_type || lead.distressType || "unknown"}`,
          `Source: ${lead.source || "distressed-lead-gen"}`,
          lead.listing_url ? `Listing: ${lead.listing_url}` : "",
          phones.length > 1 ? `Additional phones: ${phones.slice(1).join(", ")}` : "",
          emails.length > 1 ? `Additional emails: ${emails.slice(1).join(", ")}` : "",
        ].filter(Boolean).join("\n"),
        leadSource: "distressed_lead_gen",
        status: "new",
      };

      await apiFetch("/crm/leads", { method: "POST", body: JSON.stringify(payload) });
      qc.invalidateQueries({ queryKey: ["crm-leads"] });
      toast({ title: "Lead imported", description: `${payload.sellerName} added to your Leads tab` });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImportingLead(null);
    }
  };

  // Import all visible leads
  const importAll = async () => {
    for (const lead of filteredListings.slice(0, 50)) {
      await importLead(lead);
    }
  };

  // Export CSV
  const exportCsv = () => {
    if (!filteredListings.length) return;
    const headers = ["address","city","state","zip","owner","distress_type","estimated_equity","phone1","phone2","email1","source"];
    const rows = filteredListings.map(l => {
      const phones = Array.isArray(l.phones) ? l.phones.map((p: any) => typeof p === "string" ? p : p?.number || "") : [];
      const emails = Array.isArray(l.emails) ? l.emails.map((e: any) => typeof e === "string" ? e : e?.email || "") : [];
      return [
        l.address || [l.street, l.city, l.state].filter(Boolean).join(", "),
        l.city || "", l.state || "", l.zip || "",
        l.owner_name || "",
        l.distress_type || l.distressType || "",
        l.estimated_equity || "",
        phones[0] || "", phones[1] || "",
        emails[0] || "",
        l.source || "",
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `distressed-leads-${area.state}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const overallProgress = jobs.length
    ? Math.round(jobs.reduce((s, j) => s + j.progress, 0) / jobs.length)
    : 0;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Zap className="w-6 h-6 text-primary" />
            Distressed Lead Gen
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automatically find motivated sellers from public records, MLS listings, and AI satellite data — free.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={view === "setup" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("setup")}
            className="gap-1.5"
          >
            <SlidersHorizontal className="w-4 h-4" /> Setup
          </Button>
          <Button
            variant={view === "results" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("results")}
            className="gap-1.5"
          >
            <Filter className="w-4 h-4" /> Results
            {allListings.length > 0 && (
              <Badge className="ml-1 h-4 px-1.5 text-[10px]">{allListings.length}</Badge>
            )}
          </Button>
        </div>
      </motion.div>

      {view === "setup" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Area + Options */}
          <div className="lg:col-span-1 space-y-4">
            {/* Area Card */}
            <Card className="p-5 space-y-4 bg-card border-border">
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm">Target Area</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">State *</Label>
                  <select
                    value={area.state}
                    onChange={e => setArea(a => ({ ...a, state: e.target.value }))}
                    className="w-full h-9 px-3 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">ZIP Code</Label>
                  <Input
                    placeholder="32801"
                    value={area.zip}
                    onChange={e => setArea(a => ({ ...a, zip: e.target.value }))}
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">City</Label>
                  <Input
                    placeholder="Orlando"
                    value={area.city}
                    onChange={e => setArea(a => ({ ...a, city: e.target.value }))}
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">County</Label>
                  <Input
                    placeholder="Orange"
                    value={area.county}
                    onChange={e => setArea(a => ({ ...a, county: e.target.value }))}
                    className="h-9"
                  />
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground">
                State is required. ZIP + City narrow results to your exact market.
              </p>
            </Card>

            {/* Options Card */}
            <Card className="p-5 space-y-4 bg-card border-border">
              <div className="flex items-center gap-2 mb-1">
                <SlidersHorizontal className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm">Options</span>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Max results per scan</Label>
                <div className="flex items-center gap-2">
                  {[5, 10, 15, 20].map(n => (
                    <button
                      key={n}
                      onClick={() => setLimit(n)}
                      className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        limit === n
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border text-muted-foreground hover:bg-secondary"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2.5">
                {[
                  { id: "skipTrace", label: "Free OSINT skip trace", sub: "TruePeopleSearch, FastPeopleSearch, CyberBgChecks", value: doSkipTrace, set: setDoSkipTrace },
                  { id: "dncCheck", label: "DNC / carrier flag", sub: "Twilio Lookup — flags VOIP/DNC numbers", value: doDncCheck, set: setDoDncCheck },
                  { id: "saveCrm", label: "Auto-save to Cash Buyers DB", sub: "Persists to Cash Buyer Matches table", value: saveToCrm, set: setSaveToCrm },
                ].map(opt => (
                  <div key={opt.id} className="flex items-start gap-3">
                    <Checkbox
                      id={opt.id}
                      checked={opt.value}
                      onCheckedChange={v => opt.set(!!v)}
                      className="mt-0.5"
                    />
                    <div>
                      <label htmlFor={opt.id} className="text-xs font-medium text-foreground cursor-pointer">{opt.label}</label>
                      <p className="text-[10px] text-muted-foreground">{opt.sub}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* MLS options — only shown when homeharvest selected */}
              {selectedTypes.has("homeharvest") && (
                <div className="pt-3 border-t border-border space-y-3">
                  <p className="text-xs font-semibold text-emerald-400">MLS / HomeHarvest Options</p>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Listing source</Label>
                    <div className="flex gap-2 flex-wrap">
                      {(["zillow", "realtor.com", "all"] as const).map(s => (
                        <button
                          key={s}
                          onClick={() => setMlsSite(s)}
                          className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                            mlsSite === s
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                              : "bg-background border-border text-muted-foreground hover:bg-secondary"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Listing type</Label>
                    <div className="flex gap-2 flex-wrap">
                      {(["for_sale", "sold", "pending"] as const).map(t => (
                        <button
                          key={t}
                          onClick={() => setMlsListingType(t)}
                          className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                            mlsListingType === t
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                              : "bg-background border-border text-muted-foreground hover:bg-secondary"
                          }`}
                        >
                          {t.replace("_", " ")}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </Card>

            {/* Run Button */}
            <Button
              className="w-full gap-2 h-11 text-base font-semibold"
              onClick={handleRun}
              disabled={isRunning || selectedTypes.size === 0}
            >
              {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {isRunning ? "Scanning…" : "Run Lead Gen"}
            </Button>

            {isRunning && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Overall progress</span>
                  <span>{overallProgress}%</span>
                </div>
                <Progress value={overallProgress} className="h-2" />
                {jobs.map(j => (
                  <div key={j.jobId} className="text-xs text-muted-foreground flex items-center gap-1.5">
                    {j.status === "completed" ? (
                      <CheckCircle2 className="w-3 h-3 text-green-400" />
                    ) : j.status === "failed" ? (
                      <X className="w-3 h-3 text-red-400" />
                    ) : (
                      <Loader2 className="w-3 h-3 animate-spin text-primary" />
                    )}
                    <span>{j.label}</span>
                    <span className="ml-auto">{j.progress}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right: Lead Type Grid */}
          <div className="lg:col-span-2">
            <Card className="p-5 bg-card border-border h-full">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-primary" />
                  <span className="font-semibold text-sm">Lead Types</span>
                  <Badge variant="outline" className="text-xs">{selectedTypes.size} selected</Badge>
                </div>
                <div className="flex gap-2">
                  <button onClick={selectAll} className="text-xs text-primary hover:underline">Select All</button>
                  <span className="text-muted-foreground">·</span>
                  <button onClick={clearAll} className="text-xs text-muted-foreground hover:underline">Clear</button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {LEAD_TYPES.map(type => {
                  const Icon = type.icon;
                  const selected = selectedTypes.has(type.key);
                  return (
                    <motion.div
                      key={type.key}
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => toggle(type.key)}
                      className={`
                        relative flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all duration-200
                        ${selected
                          ? "border-primary/50 bg-primary/5 shadow-[0_0_0_1px_rgba(99,102,241,0.3)]"
                          : "border-border bg-background/50 hover:bg-secondary/50 hover:border-border/80"}
                      `}
                    >
                      <div className={`mt-0.5 p-2 rounded-lg ${selected ? "bg-primary/10" : "bg-secondary"}`}>
                        <Icon className={`w-4 h-4 ${selected ? "text-primary" : type.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground">{type.label}</span>
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${type.badgeClass}`}>
                            {type.distressType.replace("_", " ")}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{type.description}</p>
                        {type.key === "homeharvest" && (
                          <p className="text-[10px] text-emerald-400 mt-0.5">Requires city • includes free skip trace</p>
                        )}
                        {type.key === "satellite_dfd" && (
                          <p className="text-[10px] text-rose-400 mt-0.5">AI-powered • needs LLM key configured</p>
                        )}
                      </div>
                      <div className={`absolute top-3 right-3 w-4 h-4 rounded-full border flex items-center justify-center transition-colors ${
                        selected ? "bg-primary border-primary" : "border-border"
                      }`}>
                        {selected && <CheckCircle2 className="w-3 h-3 text-primary-foreground" />}
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Upcoming types */}
              <div className="mt-4 pt-4 border-t border-border">
                <p className="text-xs font-semibold text-muted-foreground mb-3 uppercase tracking-wider">Coming Soon</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Vacant Properties", icon: "🚪" },
                    { label: "Absentee Owner", icon: "📭" },
                    { label: "Code Violations", icon: "⚠️" },
                    { label: "HOA Liens", icon: "🔒" },
                    { label: "Divorce Filings", icon: "📋" },
                    { label: "Water/Utility Shutoff", icon: "💧" },
                  ].map(t => (
                    <span key={t.label} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border bg-secondary/30 text-xs text-muted-foreground">
                      <span>{t.icon}</span> {t.label}
                    </span>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </div>
      ) : (
        /* ── Results View ──────────────────────────────────────────────────── */
        <div className="space-y-4">
          {/* Job status pills */}
          {jobs.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              {jobs.map(j => (
                <button
                  key={j.jobId}
                  onClick={() => setActiveJobId(j.jobId)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
                    activeJobId === j.jobId
                      ? "bg-primary/10 border-primary/40 text-primary"
                      : "bg-card border-border text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {j.status === "completed" ? (
                    <CheckCircle2 className="w-3 h-3 text-green-400" />
                  ) : j.status === "failed" ? (
                    <X className="w-3 h-3 text-red-400" />
                  ) : (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  {j.label}
                  <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">{j.listings.length}</Badge>
                </button>
              ))}
              <button
                onClick={() => setView("setup")}
                className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronRight className="w-3 h-3 rotate-180" /> Back to Setup
              </button>
            </div>
          )}

          {/* Overall progress bar */}
          {isRunning && (
            <Card className="p-4 bg-card border-border">
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                <span className="font-medium">Scanning in progress…</span>
                <span>{overallProgress}%</span>
              </div>
              <Progress value={overallProgress} className="h-2" />
              {activeJob && activeJob.message && (
                <p className="text-xs text-muted-foreground mt-2 italic">{activeJob.message}</p>
              )}
            </Card>
          )}

          {/* Results toolbar */}
          {allListings.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  placeholder="Filter by address, owner, ZIP…"
                  value={searchFilter}
                  onChange={e => setSearchFilter(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <Badge variant="outline" className="text-xs">{filteredListings.length} leads</Badge>
              <Button variant="outline" size="sm" className="gap-1.5 h-9" onClick={exportCsv}>
                <Download className="w-3.5 h-3.5" /> Export CSV
              </Button>
              <Button size="sm" className="gap-1.5 h-9" onClick={importAll}>
                <Plus className="w-3.5 h-3.5" /> Import All to Leads
              </Button>
            </div>
          )}

          {/* Results table */}
          {filteredListings.length > 0 ? (
            <Card className="bg-card border-border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px]">
                  <thead>
                    <tr className="border-b border-border bg-secondary/30">
                      {["Address", "Owner", "Type", "Est. Equity", "Phone(s)", "Email(s)", "Actions"].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredListings.map((lead, i) => (
                      <LeadRow
                        key={i}
                        lead={lead}
                        onImport={importLead}
                        importing={importingLead !== null}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Card className="p-12 bg-card border-border text-center">
              {isRunning ? (
                <div className="space-y-3">
                  <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
                  <p className="text-muted-foreground text-sm">Scanning public records…</p>
                  <p className="text-xs text-muted-foreground">Results will appear here as they come in.</p>
                </div>
              ) : jobs.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-muted-foreground font-medium">No leads found</p>
                  <p className="text-xs text-muted-foreground">
                    Try a different area, broader state selection, or add more lead type categories.
                  </p>
                  <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => setView("setup")}>
                    <SlidersHorizontal className="w-3.5 h-3.5" /> Adjust Settings
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Zap className="w-10 h-10 text-primary/30 mx-auto" />
                  <p className="text-muted-foreground font-medium">No scan run yet</p>
                  <Button size="sm" className="mt-2 gap-1.5" onClick={() => setView("setup")}>
                    <SlidersHorizontal className="w-3.5 h-3.5" /> Configure & Run
                  </Button>
                </div>
              )}
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

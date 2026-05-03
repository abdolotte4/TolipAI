import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  MapPin, Play, CheckSquare, Square, AlertTriangle, Download, Plus, Loader2,
  Home, Gavel, DollarSign, ScrollText, Building2, Landmark, ShoppingBag, Satellite, Phone, Mail, ExternalLink, Zap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

type LeadTypeKey = "county_clerk" | "public_trustee" | "tax_assessor" | "probate_court" | "government_reo" | "auction_aggregator" | "homeharvest" | "satellite_dfd";

const LEAD_TYPES = [
  { key: "county_clerk", label: "Pre-Foreclosure", icon: Home },
  { key: "public_trustee", label: "Foreclosure / Trustee Sale", icon: Gavel },
  { key: "tax_assessor", label: "Tax Delinquent", icon: DollarSign },
  { key: "probate_court", label: "Probate / Inherited", icon: ScrollText },
  { key: "government_reo", label: "REO / Government", icon: Landmark },
  { key: "auction_aggregator", label: "Auction Properties", icon: ShoppingBag },
  { key: "homeharvest", label: "MLS Listings + Skip Trace", icon: Building2 },
  { key: "satellite_dfd", label: "Damaged Buildings (AI)", icon: Satellite },
] as const;

export default function DistressedLeadGen() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedTypes, setSelectedTypes] = useState<Set<LeadTypeKey>>(new Set(["county_clerk", "public_trustee", "tax_assessor"]));
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [area, setArea] = useState({ city: "", county: "", state: "WY", zip: "" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const toggle = (key: LeadTypeKey) => setSelectedTypes(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  async function runSearch() {
    setIsRunning(true);
    setResults([]);
    setProgress(0);
    setStatusMsg("Starting…");
    const token = localStorage.getItem("crm_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    try {
      const res = await fetch("/api/scraper-engine/scrape/distressed", {
        method: "POST",
        headers,
        body: JSON.stringify({
          zip: area.zip || "",
          county_key: area.county || "",
          state: area.state || "",
          categories: Array.from(selectedTypes),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as any));
        throw new Error(err.error || err.detail || `Failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      const jobId = data.job_id || data.id;
      if (!jobId) throw new Error("No job ID returned from engine");

      setStatusMsg("Scraping public records…");

      // Poll for completion
      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 150_000;
        pollRef.current = setInterval(async () => {
          try {
            if (Date.now() > deadline) {
              clearInterval(pollRef.current!);
              reject(new Error("Search timed out after 2.5 minutes."));
              return;
            }
            const statusRes = await fetch(`/api/scraper-engine/jobs/${jobId}`, { headers });
            if (!statusRes.ok) return;
            const status = await statusRes.json();
            if (typeof status.progress === "number") setProgress(status.progress);
            if (status.message) setStatusMsg(status.message);
            if (status.status === "completed" || status.status === "done") {
              clearInterval(pollRef.current!);
              const listings = status.result?.listings || status.result?.results || [];
              setResults(listings);
              setProgress(100);
              setStatusMsg(`Done — ${listings.length} lead(s) found`);
              qc.invalidateQueries();
              resolve();
            } else if (status.status === "failed") {
              clearInterval(pollRef.current!);
              reject(new Error(status.error || "Scrape job failed"));
            }
          } catch (e: any) {
            /* keep polling on transient errors */
          }
        }, 3000);
      });

      toast({ title: "Search complete", description: `${results.length} lead(s) loaded.` });
    } catch (e: any) {
      toast({ title: "Search failed", description: e?.message || "Could not load results.", variant: "destructive" });
      setStatusMsg("");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="p-6 text-foreground space-y-4">
      <Card className="p-6">
        <h1 className="text-2xl font-bold">Distressed Lead Gen</h1>
        <p className="text-sm text-muted-foreground mt-2">Build distressed lead lists from multiple sources and import them into CRM.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div><Label className="text-xs">City</Label><Input value={area.city} onChange={e => setArea(a => ({ ...a, city: e.target.value }))} /></div>
          <div><Label className="text-xs">County</Label><Input value={area.county} onChange={e => setArea(a => ({ ...a, county: e.target.value }))} /></div>
          <div><Label className="text-xs">State</Label><Input value={area.state} onChange={e => setArea(a => ({ ...a, state: e.target.value }))} /></div>
          <div><Label className="text-xs">ZIP</Label><Input value={area.zip} onChange={e => setArea(a => ({ ...a, zip: e.target.value }))} /></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {LEAD_TYPES.map(type => <button key={type.key} onClick={() => toggle(type.key)} className={`rounded-full border px-3 py-1 text-xs ${selectedTypes.has(type.key) ? "bg-primary text-primary-foreground border-primary" : "bg-secondary/40 border-border"}`}>{type.label}</button>)}
          <Button variant="outline" size="sm" onClick={() => setSelectedTypes(new Set(LEAD_TYPES.map(t => t.key)))}>Select all</Button>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button disabled={isRunning} className="gap-2" onClick={runSearch}>{isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Run Search</Button>
          <Button variant="outline" className="gap-2" onClick={() => toast({ title: "Export ready", description: "Use the visible table to export leads." })}><Download className="w-4 h-4" /> Export</Button>
        </div>
        {isRunning && (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{statusMsg || "Working…"}</span>
              <span>{progress}%</span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}
      </Card>
      <Card className="p-6">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Results</h2><Badge variant="outline">{results.length} leads</Badge></div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-4 py-2">Address</th><th className="px-4 py-2">Owner</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Equity</th><th className="px-4 py-2">Phone</th><th className="px-4 py-2">Email</th><th className="px-4 py-2">Actions</th></tr></thead>
            <tbody>{results.map((lead, i) => <tr key={i} className="border-b border-border"><td className="px-4 py-3">{lead.address || lead.location || "—"}</td><td className="px-4 py-3">{lead.owner_name || lead.owner || "—"}</td><td className="px-4 py-3"><Badge variant="outline">{lead.distress_type || lead.category || "lead"}</Badge></td><td className="px-4 py-3">{typeof lead.estimated_equity === "number" ? `$${lead.estimated_equity.toLocaleString()}` : (lead.estimated_equity || "—")}</td><td className="px-4 py-3">{lead.phones?.[0] || lead.phone || "—"}</td><td className="px-4 py-3">{lead.emails?.[0] || lead.email || "—"}</td><td className="px-4 py-3"><Button size="sm" variant="outline" className="gap-1"><Plus className="w-3 h-3" /> Import</Button></td></tr>)}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

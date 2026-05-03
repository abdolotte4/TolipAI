import { useState } from "react";
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
  const pin = localStorage.getItem("TOOLS_PIN") || localStorage.getItem("crm_token") || "";
  const [selectedTypes, setSelectedTypes] = useState<Set<LeadTypeKey>>(new Set(["county_clerk", "public_trustee", "tax_assessor"]));
  const [isRunning, setIsRunning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [area, setArea] = useState({ city: "", county: "", state: "WY", zip: "" });

  const toggle = (key: LeadTypeKey) => setSelectedTypes(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  async function runSearch() {
    setIsRunning(true);
    try {
      const res = await fetch("/api/tools/distressed/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tools-Pin": pin || "",
        },
        body: JSON.stringify({
          city: area.city || undefined,
          county: area.county || undefined,
          state: area.state || undefined,
          zip: area.zip || undefined,
          categories: Array.from(selectedTypes),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({} as any));
        throw new Error(err.error || `Failed (HTTP ${res.status})`);
      }
      const data = await res.json();
      setResults(data.result?.listings || data.listings || []);
      toast({ title: "Search complete", description: "Lead results loaded." });
      qc.invalidateQueries();
    } catch (e: any) {
      toast({ title: "Search failed", description: e?.message || "Could not load results.", variant: "destructive" });
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
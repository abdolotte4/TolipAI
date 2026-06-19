import { useState, useEffect, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import {
  useCrmGetComps,
  useCrmCreateComp,
  useCrmDeleteComp,
  useCrmRecalculateComps,
} from "@workspace/api-client-react";
import { apiFetch } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  BarChart2, RefreshCw, Plus, Loader2, Database, Sparkles,
  TrendingUp, TrendingDown, AlertCircle, Trash2,
} from "lucide-react";

function fmt$(v: any) {
  if (!v && v !== 0) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));
}

export default function CompsSection({ leadId, lead }: { leadId: number; lead: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ address: "", beds: "", baths: "", sqft: "", yearBuilt: "", salePrice: "", soldDate: "", notes: "" });
  const [radiusMiles, setRadiusMiles] = useState("0.25");
  const [fetchingComps, setFetchingComps] = useState(false);
  const [compsPolling, setCompsPolling] = useState<{ jobToken: string; count: number; actualRadius: number } | null>(null);
  const [expandedBreakdown, setExpandedBreakdown] = useState<number | null>(null);

  const { data: comps = [], isLoading: compsLoading } = useCrmGetComps(leadId);
  const compsKey = [`/api/crm/leads/${leadId}/comps`];
  const leadKey = [`/api/crm/leads/${leadId}`];

  const marketSqftRate = useMemo(() => {
    const rates = (comps as any[])
      .filter((c: any) => c.salePrice > 0 && c.sqft > 0)
      .map((c: any) => c.salePrice / c.sqft)
      .sort((a: number, b: number) => a - b);
    if (rates.length === 0) return 50;
    const mid = Math.floor(rates.length / 2);
    return rates.length % 2 === 0
      ? Math.round((rates[mid - 1] + rates[mid]) / 2)
      : rates[mid];
  }, [comps]);

  function calcBreakdown(comp: any) {
    const subjectBeds  = lead?.beds != null ? Number(lead.beds) : null;
    const subjectBaths = lead?.baths != null ? parseFloat(lead.baths) : null;
    const subjectSqft  = lead?.sqft != null ? Number(lead.sqft) : null;
    const subjectYear  = lead?.yearBuilt != null ? Number(lead.yearBuilt) : null;
    const compBeds     = comp.beds != null ? Number(comp.beds) : null;
    const compBaths    = comp.baths != null ? parseFloat(comp.baths) : null;
    const compSqft     = comp.sqft != null ? Number(comp.sqft) : null;
    const compYear     = comp.yearBuilt != null ? Number(comp.yearBuilt) : null;
    const salePrice    = comp.salePrice ?? 0;

    const bedAdj  = subjectBeds  != null && compBeds  != null ? (subjectBeds  - compBeds)  * 12500 : 0;
    const bathAdj = subjectBaths != null && compBaths != null ? (subjectBaths - compBaths) * 7500  : 0;
    const sqftAdj = subjectSqft  != null && compSqft  != null ? Math.round((subjectSqft - compSqft) * marketSqftRate) : 0;
    const yearAdj = subjectYear  != null && compYear  != null ? (subjectYear  - compYear)  * 150   : 0;
    let   timeAdj = 0;
    if (comp.soldDate) {
      const soldMs = new Date(comp.soldDate).getTime();
      if (!isNaN(soldMs)) {
        const monthsAgo = (Date.now() - soldMs) / (1000 * 60 * 60 * 24 * 30.5);
        timeAdj = Math.round(salePrice * 0.03 * (monthsAgo / 12));
      }
    }
    return { bedAdj, bathAdj, sqftAdj, yearAdj, timeAdj, marketSqftRate,
             subjectBeds, subjectBaths, subjectSqft, subjectYear,
             compBeds, compBaths, compSqft, compYear };
  }

  const lookupCompMutation = useMutation({
    mutationFn: async (address: string) => {
      const resp = await fetch(`/api/crm/leads/${leadId}/comp-address-lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ address }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Lookup failed");
      return data;
    },
    onSuccess: (data) => {
      setForm(f => ({
        ...f,
        beds:      data.beds       != null ? String(data.beds)       : f.beds,
        baths:     data.baths      != null ? String(data.baths)      : f.baths,
        sqft:      data.sqft       != null ? String(data.sqft)       : f.sqft,
        yearBuilt: data.yearBuilt  != null ? String(data.yearBuilt)  : f.yearBuilt,
        salePrice: data.lastSalePrice != null ? String(data.lastSalePrice) : f.salePrice,
        soldDate:  data.lastSaleDate  || f.soldDate,
      }));
      toast({ title: "Property data filled from PropertyAPI" });
    },
    onError: (err: any) => {
      toast({ title: "Lookup failed", description: err.message, variant: "destructive" });
    },
  });

  function applyFetchCompsResult(data: any) {
    qc.invalidateQueries({ queryKey: compsKey });
    qc.invalidateQueries({ queryKey: leadKey });
    if (data.added === 0) {
      toast({ title: data.message ?? "No recent sales found in that radius" });
    } else if (data.aiGenerated) {
      toast({
        title: `${data.added} AI-estimated comp${data.added !== 1 ? "s" : ""} added`,
        description: (data.arv ? `ARV estimated at ${fmt$(data.arv)}. ` : "") +
          "PropertyAPI credits exhausted — comps are AI-estimated and labeled. Verify before making offers.",
        variant: "default",
      });
    } else {
      toast({
        title: `${data.added} comp${data.added !== 1 ? "s" : ""} added from PropertyAPI`,
        description: data.arv ? `ARV updated to ${fmt$(data.arv)}` : undefined,
      });
    }
  }

  const [rentcastLoading, setRentcastLoading] = useState(false);
  const [rentcastData, setRentcastData] = useState<{ price: number; low: number; high: number } | null>(null);

  const [attomAvmLoading, setAttomAvmLoading] = useState(false);
  const [attomAvmData, setAttomAvmData] = useState<{ value: number; low: number; high: number; confidence: number } | null>(null);

  useEffect(() => {
    const r = (lead as any)?.rentcastAvm;
    if (r && typeof r.price === "number") {
      setRentcastData({ price: r.price, low: r.low, high: r.high });
    }
    const a = (lead as any)?.attomAvm;
    if (a && typeof a.value === "number") {
      setAttomAvmData({ value: a.value, low: a.low, high: a.high, confidence: a.confidence ?? 0 });
    }
  }, [(lead as any)?.rentcastAvm?.fetchedAt, (lead as any)?.attomAvm?.fetchedAt]);

  async function handleRentcastValuation() {
    setRentcastLoading(true);
    try {
      const data = await apiFetch(`/leads/${leadId}/rentcast-valuation`, { method: "POST" });
      if (data?.error) throw new Error(data.error);
      const next = { price: data.price, low: data.low, high: data.high };
      setRentcastData(next);
      qc.setQueryData([`/api/crm/leads/${leadId}`], (old: any) =>
        old ? { ...old, rentcastAvm: { ...next, fetchedAt: new Date().toISOString() } } : old
      );
    } catch (err: any) {
      toast({ title: "Rentcast failed", description: err.message, variant: "destructive" });
    } finally {
      setRentcastLoading(false);
    }
  }

  async function handleAttomAvm() {
    setAttomAvmLoading(true);
    try {
      const data = await apiFetch(`/leads/${leadId}/attom-avm`, { method: "POST" });
      if (data?.error) throw new Error(data.error);
      const next = { value: data.value, low: data.low, high: data.high, confidence: data.confidence };
      setAttomAvmData(next);
      qc.setQueryData([`/api/crm/leads/${leadId}`], (old: any) =>
        old ? { ...old, attomAvm: { ...next, fetchedAt: new Date().toISOString() } } : old
      );
    } catch (err: any) {
      toast({ title: "ATTOM AVM failed", description: err.message, variant: "destructive" });
    } finally {
      setAttomAvmLoading(false);
    }
  }

  const [fetchingAiComps, setFetchingAiComps] = useState(false);
  async function handleFetchCompsAi() {
    if (fetchingAiComps || fetchingComps || compsPolling) return;
    setFetchingAiComps(true);
    try {
      const data = await apiFetch(`/leads/${leadId}/fetch-comps-ai`, { method: "POST" });
      if (data?.error) throw new Error(data.error);
      applyFetchCompsResult(data);
      toast({
        title: "AI comps generated",
        description: `${data.added} AI-estimated comps saved. ARV updated.`,
      });
    } catch (err: any) {
      toast({ title: "AI comps failed", description: err.message, variant: "destructive" });
    } finally {
      setFetchingAiComps(false);
    }
  }

  const [detectingCondition, setDetectingCondition] = useState(false);
  async function handleDetectCondition() {
    if (detectingCondition) return;
    setDetectingCondition(true);
    try {
      const data = await apiFetch(`/leads/${leadId}/detect-condition`, { method: "POST" });
      if (data?.error) throw new Error(data.error);
      qc.invalidateQueries({ queryKey: [`/api/crm/leads/${leadId}`] });
      qc.invalidateQueries({ queryKey: [`/api/crm/leads/${leadId}/notes`] });
      toast({
        title: `Condition: ${data.condition}/10`,
        description: `Discount factor ${Math.round((data.discountFactor ?? 0.8) * 100)}% applied. ${data.rationale ?? ""}`,
      });
    } catch (err: any) {
      toast({ title: "Detect condition failed", description: err.message, variant: "destructive" });
    } finally {
      setDetectingCondition(false);
    }
  }

  async function handleFetchComps() {
    if (fetchingComps || compsPolling) return;
    setFetchingComps(true);
    try {
      const resp = await fetch(`/api/crm/leads/${leadId}/fetch-comps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ radiusMiles: parseFloat(radiusMiles) }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Failed to start fetch");
      if (data.status === "pending") {
        setCompsPolling({ jobToken: data.jobToken, count: data.count, actualRadius: data.actualRadius });
      } else {
        applyFetchCompsResult(data);
      }
    } catch (err: any) {
      toast({ title: "Fetch comps failed", description: err.message, variant: "destructive" });
    } finally {
      setFetchingComps(false);
    }
  }

  useEffect(() => {
    if (!compsPolling) return;
    let interval: ReturnType<typeof setInterval> | null = null;
    interval = setInterval(async () => {
      try {
        const resp = await fetch(
          `/api/crm/leads/${leadId}/fetch-comps/poll?token=${encodeURIComponent(compsPolling.jobToken)}`,
          { credentials: "include" },
        );
        const data = await resp.json();
        if (!resp.ok) {
          if (interval) clearInterval(interval);
          setCompsPolling(null);
          toast({ title: "Fetch comps failed", description: data.error ?? "Export failed", variant: "destructive" });
          return;
        }
        if (data.status === "done") {
          if (interval) clearInterval(interval);
          setCompsPolling(null);
          applyFetchCompsResult(data);
        }
      } catch {
        // network blip — keep polling
      }
    }, 2000);
    return () => { if (interval) clearInterval(interval); };
  }, [compsPolling?.jobToken, leadId]);

  const createMutation = useCrmCreateComp({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: compsKey });
        qc.invalidateQueries({ queryKey: leadKey });
        setForm({ address: "", beds: "", baths: "", sqft: "", yearBuilt: "", salePrice: "", soldDate: "", notes: "" });
        setShowForm(false);
        toast({ title: "Comp added — ARV updated" });
      },
      onError: () => toast({ title: "Failed to add comp", variant: "destructive" }),
    },
  });
  const deleteMutation = useCrmDeleteComp({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: compsKey });
        qc.invalidateQueries({ queryKey: leadKey });
        toast({ title: "Comp removed — ARV updated" });
      },
    },
  });
  const recalcMutation = useCrmRecalculateComps({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: compsKey });
        qc.invalidateQueries({ queryKey: leadKey });
        toast({ title: "ARV recalculated from comps" });
      },
    },
  });

  const { avgAdjusted, arv, askingPrice, dealRatio, dealFlag, compsWithAdj } = useMemo(() => {
    const compsWithAdj = (comps as any[]).filter((c: any) => c.adjustedPrice != null && c.adjustedPrice > 0);
    const avgAdjusted = compsWithAdj.length > 0
      ? Math.round(compsWithAdj.reduce((s: number, c: any) => s + c.adjustedPrice, 0) / compsWithAdj.length)
      : null;
    const arv = lead?.arv ? parseFloat(lead.arv) : null;
    const askingPrice = lead?.askingPrice ? parseFloat(lead.askingPrice) : null;
    const dealRatio = arv && askingPrice ? arv / askingPrice : null;
    const dealFlag = dealRatio != null
      ? (dealRatio >= 1.7 ? "good" : dealRatio >= 1.3 ? "warning" : "bad")
      : null;
    return { avgAdjusted, arv, askingPrice, dealRatio, dealFlag, compsWithAdj };
  }, [comps, lead?.arv, lead?.askingPrice]);

  return (
    <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-secondary/30 p-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <BarChart2 className="w-5 h-5 text-primary" />
          <h2 className="font-display font-semibold">Comparable Sales</h2>
          <Badge variant="secondary" className="text-xs">{(comps as any[]).length} comps</Badge>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {(comps as any[]).length > 0 && (
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1"
              disabled={recalcMutation.isPending}
              onClick={() => recalcMutation.mutate({ leadId })}
            >
              <RefreshCw className={`w-3 h-3 ${recalcMutation.isPending ? "animate-spin" : ""}`} />
              Recalculate
            </Button>
          )}
          <div className="flex items-center gap-1">
            <select
              value={radiusMiles}
              onChange={e => setRadiusMiles(e.target.value)}
              disabled={fetchingComps || !!compsPolling}
              className="h-7 text-xs rounded border border-border bg-background px-1.5 cursor-pointer"
              title="Search radius in miles"
            >
              <option value="0.25">0.25 mi</option>
              <option value="0.5">0.5 mi</option>
              <option value="1">1 mi</option>
              <option value="2">2 mi</option>
            </select>
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1 border-primary/40 text-primary hover:bg-primary/10"
              disabled={fetchingComps || !!compsPolling || fetchingAiComps}
              onClick={handleFetchComps}
              title="Auto-fetch recently-sold comparable properties from PropertyAPI within the selected radius"
            >
              {(fetchingComps || compsPolling)
                ? <><RefreshCw className="w-3 h-3 animate-spin" /> {fetchingComps ? "Starting…" : "Processing…"}</>
                : <><Database className="w-3 h-3" /> Fetch Comps</>
              }
            </Button>
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1 border-violet-500/40 text-violet-500 hover:bg-violet-500/10"
              disabled={fetchingAiComps || fetchingComps || !!compsPolling}
              onClick={handleFetchCompsAi}
              title="Generate comparable sales using AI (saved permanently to this lead)"
            >
              {fetchingAiComps
                ? <><RefreshCw className="w-3 h-3 animate-spin" /> Asking AI…</>
                : <><Sparkles className="w-3 h-3" /> AI Comps</>
              }
            </Button>
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1 border-amber-500/40 text-amber-500 hover:bg-amber-500/10"
              disabled={detectingCondition}
              onClick={handleDetectCondition}
              title="Use AI to read the notes & activity log and infer property condition (1-10). Updates MAO with the right discount factor (70/80/90 rule)."
            >
              {detectingCondition
                ? <><RefreshCw className="w-3 h-3 animate-spin" /> Analyzing…</>
                : <><Sparkles className="w-3 h-3" /> Detect Condition</>
              }
            </Button>
          </div>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setShowForm(s => !s)}>
            <Plus className="w-3.5 h-3.5" /> Add Comp
          </Button>
        </div>
      </div>

      {(fetchingComps || compsPolling) && (
        <div className="mx-4 mt-3 p-2.5 bg-primary/5 border border-primary/20 rounded-lg text-xs text-muted-foreground flex items-center gap-2">
          <RefreshCw className="w-3 h-3 animate-spin text-primary shrink-0" />
          {fetchingComps
            ? <span>Starting PropertyAPI search within {radiusMiles} mi…</span>
            : <span>
                Processing {compsPolling!.count} properties within {compsPolling!.actualRadius} mi
                {compsPolling!.actualRadius < parseFloat(radiusMiles) ? ` (auto-shrunk from ${radiusMiles} mi)` : ""} — PropertyAPI export in progress, checking every 2 seconds…
              </span>
          }
        </div>
      )}

      <div className="mx-4 mt-3 p-3 rounded-xl bg-secondary/20 border border-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">Rentcast AVM</p>
          {rentcastData ? (
            <p className="text-sm font-bold text-primary">
              {fmt$(rentcastData.price)}
              <span className="text-xs font-normal text-muted-foreground ml-2">
                Range: {fmt$(rentcastData.low)} – {fmt$(rentcastData.high)}
              </span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Not fetched yet (uses 1 credit)</p>
          )}
        </div>
        <Button size="sm" variant="outline" className="rounded-xl gap-2 shrink-0"
          onClick={handleRentcastValuation} disabled={rentcastLoading}>
          {rentcastLoading ? <><Loader2 className="w-3 h-3 animate-spin" /> Fetching…</> : "Get Rentcast Estimate"}
        </Button>
      </div>

      <div className="mx-4 mt-3 p-3 rounded-xl bg-secondary/20 border border-border flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-muted-foreground">ATTOM AVM</p>
          {attomAvmData ? (
            <p className="text-sm font-bold text-primary">
              {fmt$(attomAvmData.value)}
              <span className="text-xs font-normal text-muted-foreground ml-2">
                Range: {fmt$(attomAvmData.low)} – {fmt$(attomAvmData.high)}
                {" · "}Confidence: {attomAvmData.confidence}%
              </span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Not fetched yet</p>
          )}
        </div>
        <Button size="sm" variant="outline" className="rounded-xl gap-2 shrink-0"
          onClick={handleAttomAvm} disabled={attomAvmLoading}>
          {attomAvmLoading ? <><Loader2 className="w-3 h-3 animate-spin" /> Fetching…</> : "Get ATTOM AVM"}
        </Button>
      </div>

      {(avgAdjusted || arv) && (
        <div className="mx-4 mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {avgAdjusted && (
            <div className="p-3 bg-primary/5 border border-primary/20 rounded-xl">
              <p className="text-xs text-muted-foreground mb-0.5">Avg Adjusted Comp Value</p>
              <p className="text-lg font-bold text-primary">{fmt$(avgAdjusted)}</p>
              <p className="text-xs text-muted-foreground">{compsWithAdj.length} comp{compsWithAdj.length !== 1 ? "s" : ""} with adjustments</p>
            </div>
          )}
          {arv && (
            <div className={`p-3 rounded-xl border ${
              dealFlag === "good"    ? "bg-green-500/10 border-green-500/30" :
              dealFlag === "warning" ? "bg-yellow-500/10 border-yellow-500/30" :
              dealFlag === "bad"     ? "bg-red-500/10 border-red-500/30" :
              "bg-primary/5 border-primary/20"
            }`}>
              <p className="text-xs text-muted-foreground mb-0.5">Auto-Calculated ARV</p>
              <p className={`text-lg font-bold ${
                dealFlag === "good" ? "text-green-400" :
                dealFlag === "warning" ? "text-yellow-400" :
                dealFlag === "bad" ? "text-red-400" : "text-primary"
              }`}>{fmt$(arv)}</p>
              {dealRatio != null && (
                <div className="flex items-center gap-1 mt-0.5">
                  {dealFlag === "good" ? <TrendingUp className="w-3 h-3 text-green-400" /> :
                   dealFlag === "bad"  ? <TrendingDown className="w-3 h-3 text-red-400" /> :
                   <AlertCircle className="w-3 h-3 text-yellow-400" />}
                  <span className={`text-xs font-medium ${
                    dealFlag === "good" ? "text-green-400" :
                    dealFlag === "bad"  ? "text-red-400" : "text-yellow-400"
                  }`}>
                    ARV/Asking = {dealRatio.toFixed(2)}x
                    {dealFlag === "good" ? " — Strong deal" :
                     dealFlag === "warning" ? " — Borderline" : " — Below 1.7x threshold"}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {(comps as any[]).length > 0 && (
        <div className="mx-4 mt-3 px-3 py-2 bg-blue-500/5 border border-blue-500/10 rounded-xl text-xs text-muted-foreground">
          <span className="font-medium text-blue-400">Adjustment factors: </span>
          ±$12,500/bed · ±$7,500/bath · ±market $/sqft · ±$150/year built · +3%/yr time adj (sold date)
        </div>
      )}

      {showForm && (
        <div className="p-4 border-b border-border bg-secondary/20 space-y-3 mt-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="col-span-2 md:col-span-3">
              <Label className="text-xs">Address *</Label>
              <div className="flex gap-1.5 mt-1">
                <Input
                  className="h-8 text-sm flex-1"
                  value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  placeholder="123 Main St, City, ST 12345"
                />
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  className="h-8 text-xs px-2 gap-1 border-primary/40 text-primary hover:bg-primary/10 shrink-0"
                  disabled={!form.address || form.address.length < 5 || lookupCompMutation.isPending}
                  onClick={() => lookupCompMutation.mutate(form.address)}
                  title="Auto-fill beds, baths, sqft, year, sale price and date from PropertyAPI (1 credit)"
                >
                  {lookupCompMutation.isPending
                    ? <><RefreshCw className="w-3 h-3 animate-spin" /> Looking up…</>
                    : <><Database className="w-3 h-3" /> Auto-Fill</>
                  }
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">Enter address then click Auto-Fill to pull sale data from PropertyAPI (1 credit)</p>
            </div>
            <div>
              <Label className="text-xs">Beds</Label>
              <Input type="number" className="mt-1 h-8 text-sm" value={form.beds} onChange={e => setForm(f => ({ ...f, beds: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Baths</Label>
              <Input type="number" step="0.5" className="mt-1 h-8 text-sm" value={form.baths} onChange={e => setForm(f => ({ ...f, baths: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Sq Ft</Label>
              <Input type="number" className="mt-1 h-8 text-sm" value={form.sqft} onChange={e => setForm(f => ({ ...f, sqft: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Year Built</Label>
              <Input type="number" placeholder="e.g. 1995" className="mt-1 h-8 text-sm" value={form.yearBuilt} onChange={e => setForm(f => ({ ...f, yearBuilt: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Sale Price *</Label>
              <Input type="number" className="mt-1 h-8 text-sm" value={form.salePrice} onChange={e => setForm(f => ({ ...f, salePrice: e.target.value }))} placeholder="$" />
            </div>
            <div>
              <Label className="text-xs">Sold Date</Label>
              <Input type="date" className="mt-1 h-8 text-sm" value={form.soldDate} onChange={e => setForm(f => ({ ...f, soldDate: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => createMutation.mutate({ leadId, data: { ...form, beds: form.beds ? Number(form.beds) : undefined, baths: form.baths ? Number(form.baths) : undefined, sqft: form.sqft ? Number(form.sqft) : undefined, yearBuilt: form.yearBuilt ? Number(form.yearBuilt) : undefined, salePrice: form.salePrice ? Number(form.salePrice) : undefined } })} disabled={createMutation.isPending || !form.address || !form.salePrice}>
              {createMutation.isPending ? "Adding..." : "Add & Auto-Adjust"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="p-4 space-y-2">
        {(comps as any[]).length === 0 && !showForm && (
          <p className="text-center text-muted-foreground text-sm italic py-4">
            No comps yet. Add comparable sales and ARV will be auto-calculated.
          </p>
        )}
        {(comps as any[]).map((comp: any) => (
          <div key={comp.id} className="p-3 bg-secondary/30 rounded-xl group">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{comp.address}</p>
                <div className="flex gap-3 text-xs text-muted-foreground mt-0.5 flex-wrap items-center">
                  {comp.beds   != null && <span>{comp.beds}bd</span>}
                  {comp.baths  != null && <span>{comp.baths}ba</span>}
                  {comp.sqft   != null && <span>{comp.sqft.toLocaleString()} sqft</span>}
                  {comp.yearBuilt != null && <span>Built {comp.yearBuilt}</span>}
                  {comp.soldDate && (() => {
                    const months = Math.floor((Date.now() - new Date(comp.soldDate).getTime()) / (1000 * 60 * 60 * 24 * 30.5));
                    const label = `Sold ${comp.soldDate}`;
                    if (months > 18) return <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 font-medium">{label} · {months}mo old ⚠</span>;
                    if (months > 12) return <span className="px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-400 font-medium">{label} · {months}mo old</span>;
                    return <span className="text-green-400/80">{label}</span>;
                  })()}
                </div>
              </div>
              <div className="text-right flex-shrink-0 space-y-0.5">
                {comp.salePrice != null && <p className="text-sm text-muted-foreground line-through">{fmt$(comp.salePrice)}</p>}
                {comp.adjustedPrice != null && (
                  <p className="text-sm font-semibold text-green-400">{fmt$(comp.adjustedPrice)} <span className="text-xs font-normal text-muted-foreground">adj.</span></p>
                )}
                {comp.adjustedPrice != null && lead?.sqft ? (
                  <p className="text-xs text-muted-foreground">${Math.round(comp.adjustedPrice / lead.sqft)}/sqft adj.</p>
                ) : comp.pricePerSqft != null && (
                  <p className="text-xs text-muted-foreground">${comp.pricePerSqft}/sqft raw</p>
                )}
              </div>
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive/80 ml-1 mt-0.5"
                onClick={() => deleteMutation.mutate({ leadId, compId: comp.id })}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {comp.adjustedPrice != null && comp.salePrice != null && (() => {
              const delta = comp.adjustedPrice - comp.salePrice;
              const isOpen = expandedBreakdown === comp.id;
              const bd = isOpen ? calcBreakdown(comp) : null;
              const fmtAdj = (n: number) => n === 0 ? "—" : `${n > 0 ? "+" : ""}${Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`;
              return (
                <div className="mt-1.5">
                  <button
                    onClick={() => setExpandedBreakdown(isOpen ? null : comp.id)}
                    className={`text-xs px-2 py-0.5 rounded-md w-fit cursor-pointer transition-opacity hover:opacity-80 ${delta > 0 ? "bg-green-500/10 text-green-400" : delta < 0 ? "bg-red-500/10 text-red-400" : "bg-secondary text-muted-foreground"}`}
                  >
                    {delta > 0 ? "+" : ""}{fmt$(delta)} adjustment {isOpen ? "▲" : "▼"}
                  </button>
                  {isOpen && bd && (
                    <div className="mt-1.5 text-xs rounded-lg bg-background/60 border border-white/8 p-2.5 space-y-1 font-mono">
                      <div className="flex justify-between text-muted-foreground pb-1 border-b border-white/8 mb-1">
                        <span>Base sale price</span>
                        <span className="text-white">{fmt$(comp.salePrice)}</span>
                      </div>
                      {bd.compBeds != null && bd.subjectBeds != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Beds ({bd.compBeds} → {bd.subjectBeds} bed, ×$12,500)</span>
                          <span className={bd.bedAdj >= 0 ? "text-green-400" : "text-red-400"}>{fmtAdj(bd.bedAdj)}</span>
                        </div>
                      )}
                      {bd.compBaths != null && bd.subjectBaths != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Baths ({bd.compBaths} → {bd.subjectBaths} ba, ×$7,500)</span>
                          <span className={bd.bathAdj >= 0 ? "text-green-400" : "text-red-400"}>{fmtAdj(bd.bathAdj)}</span>
                        </div>
                      )}
                      {bd.compSqft != null && bd.subjectSqft != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Sqft ({bd.compSqft.toLocaleString()} → {bd.subjectSqft.toLocaleString()}, ×${Math.round(bd.marketSqftRate)}/sqft)</span>
                          <span className={bd.sqftAdj >= 0 ? "text-green-400" : "text-red-400"}>{fmtAdj(bd.sqftAdj)}</span>
                        </div>
                      )}
                      {bd.compYear != null && bd.subjectYear != null && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Year ({bd.compYear} → {bd.subjectYear}, ×$150)</span>
                          <span className={bd.yearAdj >= 0 ? "text-green-400" : "text-red-400"}>{fmtAdj(bd.yearAdj)}</span>
                        </div>
                      )}
                      {bd.timeAdj !== 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Time adj (3%/yr since sold)</span>
                          <span className="text-green-400">{fmtAdj(bd.timeAdj)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-white/8 pt-1 mt-1 font-semibold">
                        <span className="text-muted-foreground">Adjusted price</span>
                        <span className="text-white">{fmt$(comp.adjustedPrice)}</span>
                      </div>
                      <p className="text-muted-foreground/60 text-[10px] pt-0.5">Market rate: ${Math.round(bd.marketSqftRate)}/sqft (median of {(comps as any[]).filter((c:any) => c.salePrice > 0 && c.sqft > 0).length} comps)</p>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ))}
      </div>
    </Card>
  );
}

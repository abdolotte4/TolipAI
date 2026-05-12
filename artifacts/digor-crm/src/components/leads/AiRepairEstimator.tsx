import { memo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Wrench, Check, Loader2, Sparkles } from "lucide-react";

function fmt$(v: any) {
  if (!v && v !== 0) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));
}

const AiRepairEstimator = memo(function AiRepairEstimator({ leadId, onApplied }: { leadId: number; onApplied: (total: number) => void }) {
  const { toast } = useToast();
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ items: any[]; totalCost: number; disclaimer: string } | null>(null);

  async function handleEstimate() {
    if (!desc.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const token = localStorage.getItem("crm_token");
      const resp = await fetch(`/api/crm/leads/${leadId}/ai-repair-estimate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ description: desc }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Estimate failed");
      setResult(data);
      toast({ title: `AI Repair Estimate: ${fmt$(data.totalCost)}`, description: "Review the breakdown and click Apply to save." });
    } catch (err: any) {
      toast({ title: "Estimate failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
      <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
        <Wrench className="w-5 h-5 text-primary" />
        <h2 className="font-display font-semibold">AI Repair Estimator</h2>
        <Badge variant="secondary" className="text-xs gap-1"><Sparkles className="w-3 h-3" />AI</Badge>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <Label className="text-muted-foreground text-xs mb-1 block">Describe the repairs needed (plain language)</Label>
          <Textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            rows={4}
            className="bg-background/80 rounded-xl border-white/10 text-sm resize-none"
            placeholder="e.g. Roof needs full replacement, living room carpet, bathroom needs new tiles, kitchen needs new fridge and countertops, HVAC is old…"
          />
        </div>
        <Button
          className="w-full gap-2 rounded-xl"
          onClick={handleEstimate}
          disabled={loading || !desc.trim()}
        >
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Estimating…</> : <><Sparkles className="w-4 h-4" /> Estimate Repair Cost</>}
        </Button>

        {result && (
          <div className="space-y-3">
            <div className="overflow-auto rounded-xl border border-white/10">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-secondary/50 text-muted-foreground">
                    <th className="text-left p-2 font-medium">Item</th>
                    <th className="text-right p-2 font-medium">Qty</th>
                    <th className="text-right p-2 font-medium">Unit Cost</th>
                    <th className="text-right p-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item: any, i: number) => (
                    <tr key={i} className="border-t border-white/5 hover:bg-secondary/20">
                      <td className="p-2">
                        <div className="font-medium text-foreground">{item.item}</div>
                        {item.notes && <div className="text-muted-foreground/70">{item.notes}</div>}
                      </td>
                      <td className="p-2 text-right text-muted-foreground">{item.qty} {item.unit}</td>
                      <td className="p-2 text-right text-muted-foreground">{fmt$(item.unitCost)}</td>
                      <td className="p-2 text-right font-semibold text-foreground">{fmt$(item.total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-primary/30 bg-primary/5">
                    <td colSpan={3} className="p-2 font-bold text-primary">Total Estimated Repair Cost</td>
                    <td className="p-2 text-right font-bold text-primary text-sm">{fmt$(result.totalCost)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {result.disclaimer && (
              <p className="text-[10px] text-muted-foreground/60 italic">{result.disclaimer}</p>
            )}
            <Button
              variant="default"
              size="sm"
              className="w-full rounded-xl gap-2"
              onClick={() => { onApplied(result.totalCost); toast({ title: `ERC set to ${fmt$(result.totalCost)}` }); }}
            >
              <Check className="w-3.5 h-3.5" /> Apply as Est. Repair Cost (ERC)
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
});

export default AiRepairEstimator;

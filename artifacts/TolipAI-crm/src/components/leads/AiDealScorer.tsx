import { memo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Loader2, Sparkles } from "lucide-react";

const AiDealScorer = memo(function AiDealScorer({ leadId }: { leadId: number }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  const clamp = (s: any) => {
    let num = parseInt(s);
    if (isNaN(num)) return 5;
    if (num > 10) return Math.round(num / 10);
    return Math.min(Math.max(num, 1), 10);
  };

  async function handleScore() {
    setLoading(true);
    setResult(null);
    try {
      const token = localStorage.getItem("crm_token");
      const resp = await fetch(`/api/crm/leads/${leadId}/ai-deal-score`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!resp.ok) throw new Error("Scoring failed");
      const data = await resp.json();
      setResult(data);
      setTimeout(() => {
        document.getElementById(`score-result-${leadId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch (err: any) {
      toast({ title: "Scoring failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  const scoreColor = (s: any) => {
    const val = clamp(s);
    return val >= 8 ? "text-green-400" : val >= 6 ? "text-yellow-400" : "text-red-400";
  };

  const gradeColor = (g: string) =>
    g?.startsWith("A") ? "bg-green-500/20 text-green-400" :
    g?.startsWith("B") ? "bg-yellow-500/20 text-yellow-400" : "bg-red-500/20 text-red-400";

  return (
    <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
      <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-primary" />
        <h2 className="font-display font-semibold">AI Deal Scorer</h2>
        <Badge variant="secondary" className="text-xs gap-1"><Sparkles className="w-3 h-3" />AI</Badge>
      </div>

      <div className="p-4 space-y-4">
        <Button className="w-full gap-2 rounded-xl" onClick={handleScore} disabled={loading}>
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing Activity Logs…</> : <><Sparkles className="w-4 h-4" /> Score This Deal</>}
        </Button>

        {result && (
          <div id={`score-result-${leadId}`} className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/40 border border-white/5">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Deal Score</p>
                <p className={`text-4xl font-bold ${scoreColor(result.score)}`}>
                  {clamp(result.score)}<span className="text-lg text-muted-foreground">/10</span>
                </p>
                <p className="text-sm text-muted-foreground mt-1">{result.verdict}</p>
              </div>
              <Badge className={`text-2xl font-bold px-4 py-2 ${gradeColor(result.grade)}`}>{result.grade}</Badge>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Profit Potential", data: result.profitPotential },
                { label: "Seller Motivation", data: result.sellerMotivation },
                { label: "Deal Risk", data: result.dealRisk },
                { label: "Urgency", data: result.urgency },
              ].map(({ label, data }) => data && (
                <div key={label} className="p-3 rounded-xl bg-secondary/30 border border-white/5">
                  <p className="text-xs text-muted-foreground mb-1">{label}</p>
                  <p className={`text-lg font-bold ${scoreColor(data.score)}`}>{clamp(data.score)}/10</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-tight">{data.note}</p>
                </div>
              ))}
            </div>

            {result.recommendation && (
              <div className="p-3 rounded-xl bg-primary/10 border border-primary/20">
                <p className="text-xs font-semibold text-primary mb-1">Recommendation</p>
                <p className="text-sm italic">"{result.recommendation}"</p>
              </div>
            )}

            {result.positives?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-400 mb-2">Positives</p>
                <ul className="space-y-1">
                  {result.positives.map((p: string, i: number) => (
                    <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-green-400">✓</span>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.redFlags?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-red-400 mb-2">Red Flags</p>
                <ul className="space-y-1">
                  {result.redFlags.map((f: string, i: number) => (
                    <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-red-400">⚠</span>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
});

export default AiDealScorer;

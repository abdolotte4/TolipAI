import { memo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Phone, Copy, Check, Loader2, Sparkles } from "lucide-react";

const AiSellerScript = memo(function AiSellerScript({ leadId }: { leadId: number }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setResult(null);
    try {
      const token = localStorage.getItem("crm_token");
      const resp = await fetch(`/api/crm/leads/${leadId}/ai-seller-script`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Script generation failed");
      setResult(data);
    } catch (err: any) {
      toast({ title: "Script generation failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function copyAll() {
    if (!result) return;
    const text = [
      "OPENING:\n" + result.opening,
      "BUILD RAPPORT:\n" + result.buildRapport,
      "DISCOVER PAIN:\n" + result.discoverPain,
      "PRESENT OFFER:\n" + result.presentOffer,
      "HANDLE OBJECTIONS:\n" + result.handleObjections?.map((o: any) => `Q: ${o.objection}\nA: ${o.response}`).join("\n\n"),
      "CLOSING:\n" + result.closing,
      result.tipsForThisLead?.length ? "TIPS:\n" + result.tipsForThisLead.map((t: string) => "• " + t).join("\n") : "",
    ].filter(Boolean).join("\n\n---\n\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const Section = ({ title, content }: { title: string; content: string }) => (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-primary uppercase tracking-wide">{title}</p>
      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap bg-secondary/30 p-3 rounded-xl border border-white/5">{content}</p>
    </div>
  );

  return (
    <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
      <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
        <Phone className="w-5 h-5 text-primary" />
        <h2 className="font-display font-semibold">AI Seller Script</h2>
        <Badge variant="secondary" className="text-xs gap-1"><Sparkles className="w-3 h-3" />AI</Badge>
      </div>
      <div className="p-4 space-y-4">
        <Button className="w-full gap-2 rounded-xl" onClick={handleGenerate} disabled={loading}>
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating Script…</> : <><Sparkles className="w-4 h-4" /> Generate Call Script</>}
        </Button>
        {result && (
          <div className="space-y-4">
            <Button variant="outline" size="sm" className="w-full gap-2 rounded-xl" onClick={copyAll}>
              {copied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Full Script</>}
            </Button>
            {result.opening && <Section title="Opening" content={result.opening} />}
            {result.buildRapport && <Section title="Build Rapport" content={result.buildRapport} />}
            {result.discoverPain && <Section title="Discover Pain Points" content={result.discoverPain} />}
            {result.presentOffer && <Section title="Present Offer" content={result.presentOffer} />}
            {result.handleObjections?.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-primary uppercase tracking-wide">Handle Objections</p>
                {result.handleObjections.map((o: any, i: number) => (
                  <div key={i} className="bg-secondary/30 p-3 rounded-xl border border-white/5 space-y-1">
                    <p className="text-xs font-semibold text-yellow-400">"{o.objection}"</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{o.response}</p>
                  </div>
                ))}
              </div>
            )}
            {result.closing && <Section title="Closing" content={result.closing} />}
            {result.tipsForThisLead?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-green-400 uppercase tracking-wide mb-2">Tips for This Lead</p>
                <ul className="space-y-1">{result.tipsForThisLead.map((t: string, i: number) => <li key={i} className="text-xs text-muted-foreground flex gap-2"><span className="text-green-400">•</span>{t}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
});

export default AiSellerScript;

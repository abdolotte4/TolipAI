import { memo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Copy, Check, Loader2, Sparkles } from "lucide-react";

const AiOfferLetter = memo(function AiOfferLetter({ leadId }: { leadId: number }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ subject: string; letter: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setResult(null);
    try {
      const token = localStorage.getItem("crm_token");
      const resp = await fetch(`/api/crm/leads/${leadId}/ai-offer-letter`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Letter generation failed");
      setResult(data);
    } catch (err: any) {
      toast({ title: "Letter generation failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function copyLetter() {
    if (!result) return;
    navigator.clipboard.writeText(`Subject: ${result.subject}\n\n${result.letter}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
      <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
        <FileText className="w-5 h-5 text-primary" />
        <h2 className="font-display font-semibold">AI Offer Letter</h2>
        <Badge variant="secondary" className="text-xs gap-1"><Sparkles className="w-3 h-3" />AI</Badge>
      </div>
      <div className="p-4 space-y-4">
        <Button className="w-full gap-2 rounded-xl" onClick={handleGenerate} disabled={loading}>
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating Letter…</> : <><Sparkles className="w-4 h-4" /> Generate Offer Letter</>}
        </Button>
        {result && (
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-secondary/40 border border-white/5">
              <p className="text-xs text-muted-foreground mb-1">Subject Line</p>
              <p className="text-sm font-semibold">{result.subject}</p>
            </div>
            <div className="p-4 rounded-xl bg-secondary/30 border border-white/5">
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">{result.letter}</p>
            </div>
            <Button variant="outline" size="sm" className="w-full gap-2 rounded-xl" onClick={copyLetter}>
              {copied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy Letter</>}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
});

export default AiOfferLetter;

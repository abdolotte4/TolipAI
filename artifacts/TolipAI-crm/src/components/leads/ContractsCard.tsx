import { memo, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  FileSignature, Plus, Copy, Check, ExternalLink, RefreshCw,
  Loader2, Clock, CheckCircle2, XCircle, Eye, Send, Ban,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { format } from "date-fns";

type ContractStatus = "draft" | "sent" | "viewed" | "signed" | "declined" | "voided";

interface Contract {
  id: number;
  contractType: string;
  sellerName: string;
  sellerEmail: string | null;
  buyerName: string;
  propertyAddress: string;
  purchasePrice: string;
  earnestMoney: string;
  closingDays: number;
  status: ContractStatus;
  signingUrl: string | null;
  signedAt: string | null;
  emailSentAt: string | null;
  createdAt: string;
}

const STATUS_CONFIG: Record<ContractStatus, { label: string; color: string; icon: React.ElementType }> = {
  draft:    { label: "Draft",    color: "bg-slate-500/10 text-slate-400 border-slate-500/20",     icon: FileSignature },
  sent:     { label: "Sent",     color: "bg-sky-500/10 text-sky-400 border-sky-500/20",           icon: Send },
  viewed:   { label: "Viewed",   color: "bg-amber-500/10 text-amber-400 border-amber-500/20",     icon: Eye },
  signed:   { label: "Signed",   color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", icon: CheckCircle2 },
  declined: { label: "Declined", color: "bg-red-500/10 text-red-400 border-red-500/20",           icon: XCircle },
  voided:   { label: "Voided",   color: "bg-slate-500/10 text-slate-500 border-slate-500/20",     icon: Ban },
};

interface FormState {
  sellerName: string;
  sellerEmail: string;
  sellerPhone: string;
  buyerName: string;
  contractType: string;
  purchasePrice: string;
  earnestMoney: string;
  closingDays: string;
  includeAssignment: boolean;
  additionalTerms: string;
}

const DEFAULT_FORM: FormState = {
  sellerName: "",
  sellerEmail: "",
  sellerPhone: "",
  buyerName: "",
  contractType: "purchase_agreement",
  purchasePrice: "",
  earnestMoney: "500",
  closingDays: "30",
  includeAssignment: true,
  additionalTerms: "",
};

const ContractsCard = memo(function ContractsCard({
  leadId,
  lead,
}: {
  leadId: number;
  lead: any;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(() => ({
    ...DEFAULT_FORM,
    sellerName: lead?.sellerName || "",
    sellerEmail: lead?.email || "",
    sellerPhone: lead?.phone || "",
    purchasePrice: lead?.mao ? Math.floor(parseFloat(lead.mao)).toString() : "",
  }));
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const { data: contracts = [], isLoading } = useQuery<Contract[]>({
    queryKey: ["contracts", leadId],
    queryFn: async () => {
      const res = await apiFetch(`/crm/contracts?leadId=${leadId}`);
      if (Array.isArray(res)) return res as Contract[];
      if (res && Array.isArray((res as any).contracts)) return (res as any).contracts as Contract[];
      return [] as Contract[];
    },
    staleTime: 10_000,
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form & { leadId: number }) =>
      apiFetch("/crm/contracts", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["contracts", leadId] });
      toast({
        title: "Contract created",
        description: result.emailSent
          ? `Sent to ${form.sellerEmail} for signature.`
          : "Copy the signing link and send it to the seller.",
      });
      setShowForm(false);
    },
    onError: (err: any) => {
      toast({ title: "Failed to create contract", description: err.message, variant: "destructive" });
    },
  });

  const voidMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/crm/contracts/${id}/void`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contracts", leadId] });
      toast({ title: "Contract voided" });
    },
  });

  const resendMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/crm/contracts/${id}/resend`, { method: "POST" }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["contracts", leadId] });
      toast({ title: res.emailSent ? "Reminder sent" : "New link generated" });
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.purchasePrice) {
      toast({ title: "Purchase price required", variant: "destructive" }); return;
    }
    createMutation.mutate({ ...form, leadId });
  }

  function setField<K extends keyof FormState>(k: K) {
    return (v: FormState[K]) => setForm(f => ({ ...f, [k]: v }));
  }

  function copyLink(contract: Contract) {
    if (!contract.signingUrl) return;
    navigator.clipboard.writeText(contract.signingUrl);
    setCopiedId(contract.id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Signing link copied", description: "Send it to the seller via SMS or email." });
  }

  return (
    <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
      <div className="bg-secondary/30 p-4 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileSignature className="w-5 h-5 text-violet-400" />
          <h2 className="font-display font-semibold">E-Sign Contracts</h2>
          {contracts.length > 0 && (
            <Badge variant="secondary" className="text-xs">{contracts.length}</Badge>
          )}
        </div>
        {!showForm && (
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5 bg-violet-600 hover:bg-violet-700 text-white"
            onClick={() => setShowForm(true)}
          >
            <Plus className="w-3.5 h-3.5" />
            Send Contract
          </Button>
        )}
      </div>

      <div className="p-4 space-y-4">

        {/* Create form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="space-y-4 p-4 rounded-xl bg-secondary/30 border border-white/5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-foreground">New E-Sign Contract</p>
              <button type="button" onClick={() => setShowForm(false)} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Contract Type</Label>
                <select
                  value={form.contractType}
                  onChange={e => setField("contractType")(e.target.value)}
                  className="w-full h-9 px-3 rounded-xl border border-border bg-background/50 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <option value="purchase_agreement">Purchase &amp; Sale Agreement</option>
                  <option value="assignment">Assignment of Contract</option>
                </select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Seller Name *</Label>
                <Input
                  value={form.sellerName}
                  onChange={e => setField("sellerName")(e.target.value)}
                  placeholder="Full legal name"
                  className="h-9 rounded-xl text-sm"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Seller Email (optional)</Label>
                <Input
                  type="email"
                  value={form.sellerEmail}
                  onChange={e => setField("sellerEmail")(e.target.value)}
                  placeholder="seller@email.com"
                  className="h-9 rounded-xl text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Buyer / Your Company Name</Label>
                <Input
                  value={form.buyerName}
                  onChange={e => setField("buyerName")(e.target.value)}
                  placeholder="Leave blank to auto-fill"
                  className="h-9 rounded-xl text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Purchase Price *</Label>
                <Input
                  type="number"
                  value={form.purchasePrice}
                  onChange={e => setField("purchasePrice")(e.target.value)}
                  placeholder="e.g. 85000"
                  className="h-9 rounded-xl text-sm"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Earnest Money ($)</Label>
                <Input
                  type="number"
                  value={form.earnestMoney}
                  onChange={e => setField("earnestMoney")(e.target.value)}
                  placeholder="500"
                  className="h-9 rounded-xl text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Closing Days</Label>
                <Input
                  type="number"
                  value={form.closingDays}
                  onChange={e => setField("closingDays")(e.target.value)}
                  placeholder="30"
                  className="h-9 rounded-xl text-sm"
                />
              </div>

              <div className="col-span-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.includeAssignment}
                    onChange={e => setField("includeAssignment")(e.target.checked)}
                    className="w-4 h-4 rounded border-border text-violet-600"
                  />
                  <span className="text-xs text-muted-foreground">Include assignment clause (allows you to wholesale this contract)</span>
                </label>
              </div>

              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Additional Terms (optional)</Label>
                <Textarea
                  value={form.additionalTerms}
                  onChange={e => setField("additionalTerms")(e.target.value)}
                  placeholder="Any custom terms, contingencies, or notes…"
                  className="rounded-xl text-sm min-h-[60px] resize-none"
                />
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="flex-1 gap-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white"
                size="sm"
              >
                {createMutation.isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Creating…</>
                ) : (
                  <><FileSignature className="w-3.5 h-3.5" /> Generate &amp; Send</>
                )}
              </Button>
            </div>
          </form>
        )}

        {/* Contracts list */}
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-xs">
            <Loader2 className="w-4 h-4 animate-spin mx-auto mb-2" /> Loading contracts…
          </div>
        ) : contracts.length === 0 && !showForm ? (
          <div className="text-center py-8">
            <FileSignature className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No contracts yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Generate a purchase agreement and send the seller a signing link in seconds.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {contracts.map(c => {
              const cfg = STATUS_CONFIG[c.status] || STATUS_CONFIG.draft;
              const StatusIcon = cfg.icon;
              return (
                <div key={c.id} className="rounded-xl bg-secondary/30 border border-white/5 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">
                        {c.contractType === "assignment" ? "Assignment" : "Purchase Agreement"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{c.sellerName} · {c.propertyAddress}</p>
                    </div>
                    <Badge className={`${cfg.color} border text-[10px] shrink-0 gap-1`}>
                      <StatusIcon className="w-2.5 h-2.5" />
                      {cfg.label}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Price: <span className="text-foreground font-medium">${parseFloat(c.purchasePrice).toLocaleString()}</span></span>
                    <span>Earnest: <span className="text-foreground font-medium">${parseFloat(c.earnestMoney).toLocaleString()}</span></span>
                    <span>Close: <span className="text-foreground font-medium">{c.closingDays}d</span></span>
                    <span>Created: <span className="text-foreground">{format(new Date(c.createdAt), "MMM d, yyyy")}</span></span>
                    {c.signedAt && (
                      <span className="text-emerald-400">Signed: {format(new Date(c.signedAt), "MMM d, yyyy h:mm a")}</span>
                    )}
                  </div>

                  {/* Actions */}
                  {c.status !== "voided" && c.status !== "signed" && c.signingUrl && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => copyLink(c)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 border border-violet-500/20 hover:bg-violet-500/20 transition-colors"
                      >
                        {copiedId === c.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copiedId === c.id ? "Copied!" : "Copy Link"}
                      </button>
                      <a
                        href={c.signingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20 hover:bg-sky-500/20 transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Preview
                      </a>
                      <button
                        onClick={() => resendMutation.mutate(c.id)}
                        disabled={resendMutation.isPending}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-secondary text-muted-foreground border border-border hover:text-foreground transition-colors"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Resend
                      </button>
                      <button
                        onClick={() => { if (confirm("Void this contract? This cannot be undone.")) voidMutation.mutate(c.id); }}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                      >
                        <Ban className="w-3 h-3" />
                        Void
                      </button>
                    </div>
                  )}

                  {c.status === "signed" && (
                    <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 rounded-lg px-3 py-2 border border-emerald-500/20">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Contract fully executed — both parties have agreed
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
});

export default ContractsCard;

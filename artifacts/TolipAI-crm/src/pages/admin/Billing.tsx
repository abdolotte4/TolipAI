import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  CreditCard,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Calendar,
  TrendingUp,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface SubscriptionStatus {
  configured: boolean;
  status?: string;
  planName?: string;
  amount?: number | null;
  currency?: string;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
}

const STATUS_CONFIG: Record<string, { label: string; icon: any; cardClass: string; badgeClass: string }> = {
  active:   { label: "Active",   icon: CheckCircle2,    cardClass: "bg-emerald-500/5 border-emerald-500/20", badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  trialing: { label: "Trial",    icon: CheckCircle2,    cardClass: "bg-blue-500/5 border-blue-500/20",      badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  past_due: { label: "Past Due", icon: AlertTriangle,   cardClass: "bg-amber-500/5 border-amber-500/20",    badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  canceled: { label: "Canceled", icon: XCircle,         cardClass: "bg-red-500/5 border-red-500/20",        badgeClass: "bg-red-500/10 text-red-400 border-red-500/20" },
  unpaid:   { label: "Unpaid",   icon: AlertTriangle,   cardClass: "bg-red-500/5 border-red-500/20",        badgeClass: "bg-red-500/10 text-red-400 border-red-500/20" },
};

export default function Billing() {
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  const { data: sub, isLoading: subLoading } = useQuery<SubscriptionStatus>({
    queryKey: ["subscription-status"],
    queryFn: () => apiFetch("/billing/subscription"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const openPortal = async () => {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const data = await apiFetch("/billing/portal", { method: "POST" });
      if (data?.url) {
        window.location.href = data.url;
      } else {
        setPortalError("Could not retrieve billing portal URL. Please try again.");
      }
    } catch (err: any) {
      setPortalError(err?.message || "Failed to open billing portal.");
    } finally {
      setPortalLoading(false);
    }
  };

  const sc = STATUS_CONFIG[sub?.status ?? ""] ?? STATUS_CONFIG["active"];
  const StatusIcon = sc.icon;

  const nextDate = sub?.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd * 1000).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })
    : null;

  const amountStr = sub?.amount != null
    ? `$${sub.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} / mo`
    : null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-3">
          <CreditCard className="w-7 h-7 text-primary" />
          Subscription &amp; Billing
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage your TolipAI subscription, invoices, and payment details.
        </p>
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        {subLoading ? (
          <div className="flex items-center gap-3 p-5 border-b border-border bg-secondary/30">
            <div className="w-9 h-9 rounded-xl bg-secondary animate-pulse" />
            <div className="space-y-1.5">
              <div className="h-3.5 w-32 rounded bg-secondary animate-pulse" />
              <div className="h-3 w-48 rounded bg-secondary animate-pulse" />
            </div>
          </div>
        ) : sub?.configured ? (
          <div className={`p-5 border-b border-border ${sc.cardClass}`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl border flex-shrink-0 ${sc.cardClass}`}>
                  <StatusIcon className={`w-5 h-5 ${
                    sub.status === "active" || sub.status === "trialing" ? "text-emerald-400" :
                    sub.status === "past_due" || sub.status === "unpaid" ? "text-amber-400" :
                    "text-red-400"
                  }`} />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-foreground text-sm">{sub.planName}</p>
                    <Badge variant="outline" className={`text-xs px-2 py-0 ${sc.badgeClass}`}>{sc.label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Your TolipAI CRM workspace is fully active.
                  </p>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 text-right text-xs text-muted-foreground">
                {amountStr && (
                  <span className="flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" />
                    {amountStr}
                  </span>
                )}
                {nextDate && (
                  <span className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    {sub.cancelAtPeriodEnd ? `Cancels ${nextDate}` : `Renews ${nextDate}`}
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-5 border-b border-border bg-secondary/20">
            <div className="p-2 rounded-xl bg-secondary border border-border">
              <CheckCircle2 className="w-5 h-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">Active Subscription</p>
              <p className="text-xs text-muted-foreground">
                Your TolipAI CRM workspace is fully active.
              </p>
            </div>
          </div>
        )}

        <div className="p-6 space-y-6">
          <div>
            <p className="text-sm font-semibold text-foreground mb-3">
              Through the Stripe billing portal you can:
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-muted-foreground">
              {[
                { icon: Receipt, text: "View & download invoices" },
                { icon: CreditCard, text: "Update payment method" },
                { icon: RefreshCw, text: "Change or cancel your plan" },
                { icon: ShieldCheck, text: "View upcoming renewal dates" },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-primary flex-shrink-0" />
                  {text}
                </li>
              ))}
            </ul>
          </div>

          {portalError && (
            <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-sm">
              <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                <p className="font-medium text-destructive">Could not open billing portal</p>
                <p className="text-destructive/80">{portalError}</p>
                <p className="text-muted-foreground">
                  Need help?{" "}
                  <a href="mailto:info@tolipai.com" className="text-primary hover:underline">
                    info@tolipai.com
                  </a>
                </p>
              </div>
            </div>
          )}

          <button
            onClick={openPortal}
            disabled={portalLoading}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            {portalLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Opening portal…
              </>
            ) : (
              <>
                <ExternalLink className="w-4 h-4" />
                Open Billing Portal
              </>
            )}
          </button>

          <p className="text-xs text-center text-muted-foreground">
            You'll be redirected to Stripe's secure hosted portal.
            <br />
            Your subscription is managed by TolipAI LLC.
          </p>
        </div>
      </div>

      <p className="text-sm text-center text-muted-foreground">
        Billing questions?{" "}
        <a href="mailto:info@tolipai.com" className="text-primary hover:underline">
          info@tolipai.com
        </a>
      </p>
    </div>
  );
}

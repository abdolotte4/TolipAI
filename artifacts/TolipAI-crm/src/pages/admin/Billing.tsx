import { useState } from "react";
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
} from "lucide-react";

export default function Billing() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPortal = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch("/billing/portal", { method: "POST" });
      if (data?.url) {
        window.location.href = data.url;
      } else {
        setError("Could not retrieve billing portal URL. Please try again.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to open billing portal.");
    } finally {
      setLoading(false);
    }
  };

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
        <div className="flex items-center gap-3 p-5 border-b border-border bg-green-500/5">
          <div className="p-2 rounded-xl bg-green-500/10 border border-green-500/20">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <p className="font-semibold text-foreground text-sm">Active Subscription</p>
            <p className="text-xs text-muted-foreground">
              Your TolipAI CRM workspace is fully active.
            </p>
          </div>
        </div>

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

          {error && (
            <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-xl text-sm">
              <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
              <div className="space-y-1">
                <p className="font-medium text-destructive">Could not open billing portal</p>
                <p className="text-destructive/80">{error}</p>
                <p className="text-muted-foreground">
                  Need help?{" "}
                  <a
                    href="mailto:info@tolipai.com"
                    className="text-primary hover:underline"
                  >
                    info@tolipai.com
                  </a>
                </p>
              </div>
            </div>
          )}

          <button
            onClick={openPortal}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            {loading ? (
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

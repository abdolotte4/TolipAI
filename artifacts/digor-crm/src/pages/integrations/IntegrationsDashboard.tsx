import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Clock3, Loader2, Shield, Wifi, WifiOff, Phone, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCrmGetMe } from "@workspace/api-client-react";

function apiFetch(path: string) {
  const token = localStorage.getItem("crm_token");
  return fetch(`/api${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }).then(async (r) => {
    const json = await r.json();
    if (!r.ok) throw new Error(json?.error || `Request failed: ${r.status}`);
    return json;
  });
}

function statusTone(active: boolean) {
  return active ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" : "bg-secondary text-muted-foreground border-white/10";
}

function statusIcon(active: boolean) {
  return active ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />;
}

function ServiceCard({ title, description, active, lastUsed, loading, href }: { title: string; description: string; active: boolean; lastUsed?: string; loading?: boolean; href?: string; }) {
  const inner = (
    <Card className={`rounded-2xl border-white/5 bg-card p-5 transition-colors ${href ? "hover:bg-secondary/30 cursor-pointer" : ""}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          {loading ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /> : active ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <AlertCircle className="w-5 h-5 text-amber-400" />}
          {href && <ArrowRight className="w-4 h-4 text-muted-foreground/40" />}
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className={statusTone(active)}>{statusIcon(active)}{active ? "Active" : "Inactive"}</Badge>
        {lastUsed && <Badge variant="outline" className="bg-background/50 text-muted-foreground border-white/10"><Clock3 className="w-3 h-3 mr-1" />Last used {lastUsed}</Badge>}
      </div>
    </Card>
  );
  if (href) return <Link href={href}>{inner}</Link>;
  return inner;
}

export default function IntegrationsDashboard() {
  const { data: me } = useCrmGetMe();
  const isSuperAdmin = me?.role === "super_admin";
  const isAdmin = me?.role === "admin" || isSuperAdmin;

  const propelio = useQuery({ queryKey: ["integrations-propelio"], queryFn: () => apiFetch("/scraper-engine/integrations/propelio"), enabled: isSuperAdmin });
  const propwire = useQuery({ queryKey: ["integrations-propwire"], queryFn: () => apiFetch("/scraper-engine/integrations/propwire"), enabled: isSuperAdmin });
  const twilio = useQuery({ queryKey: ["twilio-config"], queryFn: () => apiFetch("/twilio/config"), enabled: isAdmin, retry: false });

  return (
    <div className="space-y-6 pb-20 max-w-3xl">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-display font-bold">Integrations Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Live status for connected data providers and communication tools.</p>
      </motion.div>

      {isAdmin && (
        <>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Communications</div>
          <div className="grid gap-4">
            <ServiceCard
              href="/integrations/twilio"
              title="Twilio"
              description="Click-to-call, two-way SMS, and inbound webhook routing for your campaign."
              active={!!(twilio.data?.configured && twilio.data?.twilioEnabled)}
              lastUsed={twilio.data?.phoneNumber ? `via ${twilio.data.phoneNumber}` : undefined}
              loading={twilio.isLoading}
            />
          </div>
        </>
      )}

      {isSuperAdmin && (
        <>
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mt-4">Data Providers</div>
          <div className="grid gap-4 md:grid-cols-2">
            <ServiceCard href="/integrations/propelio" title="Propelio" description="Cash buyers, comps, and owner data." active={!!propelio.data?.sessionActive} lastUsed={propelio.data?.emailMasked ? `as ${propelio.data.emailMasked}` : undefined} loading={propelio.isLoading} />
            <ServiceCard href="/integrations/propwire" title="Propwire" description="Property history, comps, and nearby investors." active={!!propwire.data?.sessionActive} lastUsed={propwire.data?.emailMasked ? `as ${propwire.data.emailMasked}` : undefined} loading={propwire.isLoading} />
            <ServiceCard title="ATTOM" description="Primary property data source for lead enrichment." active={true} lastUsed="configured in backend" />
            <ServiceCard title="BrightData" description="Residential proxy / scraping access layer." active={true} lastUsed="configured in backend" />
          </div>
        </>
      )}

      {!isAdmin && (
        <Card className="rounded-2xl border-white/5 bg-card p-6">
          <div className="flex items-center gap-3">
            <Shield className="w-5 h-5 text-amber-400" />
            <div>
              <h1 className="text-xl font-semibold">Integrations</h1>
              <p className="text-sm text-muted-foreground">This dashboard is for admins only.</p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

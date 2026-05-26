import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  Activity,
  Bot,
  Phone,
  Database,
  Cpu,
  Zap,
  ExternalLink,
  Clock,
  Shield,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

type ServiceStatus = "ok" | "degraded" | "error" | "unconfigured";

interface ServiceResult {
  status: ServiceStatus;
  latencyMs: number | null;
  detail: string;
  checkedAt: string;
}

interface HealthData {
  overallStatus: ServiceStatus;
  services: {
    openai: ServiceResult;
    groq: ServiceResult;
    twilio: ServiceResult;
    scraperEngine: ServiceResult;
    attom: ServiceResult;
    database: ServiceResult;
  };
  scraperEngineDetails: { metrics: any; circuits: any } | null;
  engineUrl: string | null;
  generatedAt: string;
}

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<ServiceStatus, { icon: React.ElementType; color: string; bg: string; border: string; label: string }> = {
  ok:           { icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10",  border: "border-emerald-500/30", label: "Operational"  },
  degraded:     { icon: AlertCircle,  color: "text-amber-400",   bg: "bg-amber-500/10",    border: "border-amber-500/30",   label: "Degraded"     },
  error:        { icon: XCircle,      color: "text-red-400",     bg: "bg-red-500/10",      border: "border-red-500/30",     label: "Error"        },
  unconfigured: { icon: HelpCircle,   color: "text-muted-foreground", bg: "bg-secondary/60", border: "border-border",      label: "Not Configured" },
};

const SERVICE_META: Record<keyof HealthData["services"], { label: string; icon: React.ElementType; docsUrl?: string }> = {
  database:      { label: "PostgreSQL Database",     icon: Database,  docsUrl: undefined },
  openai:        { label: "OpenAI",                  icon: Bot,       docsUrl: "https://platform.openai.com/docs" },
  groq:          { label: "Groq",                    icon: Zap,       docsUrl: "https://console.groq.com" },
  twilio:        { label: "Twilio Voice & SMS",      icon: Phone,     docsUrl: "https://console.twilio.com" },
  scraperEngine: { label: "AWS Scraper Engine",      icon: Cpu,       docsUrl: undefined },
  attom:         { label: "ATTOM Data API",          icon: Activity,  docsUrl: "https://api.gateway.attomdata.com" },
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusPill({ status }: { status: ServiceStatus }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      <Icon className="w-3.5 h-3.5" />
      {cfg.label}
    </span>
  );
}

function LatencyBadge({ ms }: { ms: number | null }) {
  if (ms === null) return null;
  const color = ms < 300 ? "text-emerald-400" : ms < 1000 ? "text-amber-400" : "text-red-400";
  return (
    <span className={`text-xs font-mono ${color} flex items-center gap-1`}>
      <Clock className="w-3 h-3" />
      {ms}ms
    </span>
  );
}

function ServiceCard({
  id,
  data,
  meta,
}: {
  id: string;
  data: ServiceResult;
  meta: { label: string; icon: React.ElementType; docsUrl?: string };
}) {
  const cfg = STATUS_CONFIG[data.status];
  const Icon = meta.icon;
  const StatusIcon = cfg.icon;

  return (
    <div className={`rounded-2xl border p-5 transition-all duration-200 ${cfg.border} ${cfg.bg} hover:shadow-md`}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl ${cfg.bg} border ${cfg.border}`}>
            <Icon className={`w-5 h-5 ${cfg.color}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground text-sm">{meta.label}</span>
              {meta.docsUrl && (
                <a
                  href={meta.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Open docs"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(data.checkedAt), { addSuffix: true })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LatencyBadge ms={data.latencyMs} />
          <StatusPill status={data.status} />
        </div>
      </div>
      <p className={`text-sm leading-relaxed ${data.status === "error" ? "text-red-300" : data.status === "degraded" ? "text-amber-300" : "text-muted-foreground"}`}>
        {data.detail}
      </p>
    </div>
  );
}

function OverallStatusBanner({ status, generatedAt }: { status: ServiceStatus; generatedAt: string }) {
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  const messages: Record<ServiceStatus, string> = {
    ok: "All systems operational",
    degraded: "Some services are degraded — check details below",
    error: "One or more services are down — action required",
    unconfigured: "Some services not configured",
  };
  return (
    <div className={`rounded-2xl border p-5 flex items-center justify-between ${cfg.bg} ${cfg.border}`}>
      <div className="flex items-center gap-3">
        <Icon className={`w-7 h-7 ${cfg.color}`} />
        <div>
          <div className={`font-bold text-lg ${cfg.color}`}>{messages[status]}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Last checked {formatDistanceToNow(new Date(generatedAt), { addSuffix: true })}
          </div>
        </div>
      </div>
      <StatusPill status={status} />
    </div>
  );
}

function CircuitBreakersPanel({ circuits }: { circuits: any }) {
  if (!circuits) return null;
  const entries = Object.entries(circuits);
  if (!entries.length) return null;
  return (
    <div className="rounded-2xl border border-border bg-card/50 p-5">
      <h3 className="font-semibold text-sm text-foreground mb-3 flex items-center gap-2">
        <Activity className="w-4 h-4 text-primary" />
        Scraper Engine Circuit Breakers
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {entries.map(([name, state]: [string, any]) => {
          const isOpen = state?.state === "open" || state === "open";
          return (
            <div
              key={name}
              className={`rounded-lg px-3 py-2 text-xs flex items-center gap-2 border ${
                isOpen
                  ? "bg-red-500/10 border-red-500/30 text-red-400"
                  : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              }`}
            >
              {isOpen ? <XCircle className="w-3.5 h-3.5 flex-shrink-0" /> : <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />}
              <span className="font-medium truncate">{name}</span>
              {isOpen && <Badge variant="destructive" className="ml-auto text-[10px] px-1 py-0">OPEN</Badge>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SystemHealth() {
  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
    dataUpdatedAt,
  } = useQuery<HealthData>({
    queryKey: ["system-health"],
    queryFn: () => apiFetch("/admin/system-health"),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });

  const serviceOrder: (keyof HealthData["services"])[] = [
    "database",
    "openai",
    "groq",
    "twilio",
    "scraperEngine",
    "attom",
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <Shield className="w-6 h-6 text-primary" />
            System Health
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time status of all integrated services. Auto-refreshes every 30 seconds.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          {isFetching ? "Checking…" : "Refresh Now"}
        </Button>
      </div>

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-4">
          <div className="h-20 rounded-2xl bg-secondary/40 animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-28 rounded-2xl bg-secondary/40 animate-pulse" />
            ))}
          </div>
        </div>
      )}

      {/* Error state */}
      {error && !data && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center text-red-400">
          <XCircle className="w-8 h-8 mx-auto mb-2" />
          <p className="font-semibold">Failed to load health data</p>
          <p className="text-sm text-muted-foreground mt-1">{(error as Error).message}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {/* Data loaded */}
      {data && (
        <>
          {/* Overall banner */}
          <OverallStatusBanner status={data.overallStatus} generatedAt={data.generatedAt} />

          {/* Engine URL info */}
          {data.engineUrl && (
            <div className="rounded-xl border border-border bg-card/50 px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Cpu className="w-4 h-4 text-primary flex-shrink-0" />
              <span className="font-medium text-foreground">Scraper Engine URL:</span>
              <code className="font-mono text-xs bg-secondary px-2 py-0.5 rounded text-foreground">{data.engineUrl}</code>
            </div>
          )}

          {/* Service cards grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {serviceOrder.map((key) => (
              <ServiceCard
                key={key}
                id={key}
                data={data.services[key]}
                meta={SERVICE_META[key]}
              />
            ))}
          </div>

          {/* Circuit breakers (only if scraper is up) */}
          {data.scraperEngineDetails?.circuits && (
            <CircuitBreakersPanel circuits={data.scraperEngineDetails.circuits} />
          )}

          {/* Footer timestamp */}
          <p className="text-xs text-muted-foreground text-center pb-2">
            Last full check at {new Date(data.generatedAt).toLocaleTimeString()} —
            next refresh in ~30s
          </p>
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";
import {
  Gauge, Wifi, AlertTriangle, TrendingUp, TrendingDown, Minus,
  Phone, Clock, Activity, ChevronDown,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// ── MOS quality helpers ───────────────────────────────────────────────────────

function mosLabel(mos: number | null): string {
  if (mos == null) return "No data";
  if (mos >= 4.0) return "Excellent";
  if (mos >= 3.5) return "Good";
  if (mos >= 3.0) return "Fair";
  return "Poor";
}

function mosColor(mos: number | null): string {
  if (mos == null) return "text-slate-500";
  if (mos >= 4.0) return "text-emerald-400";
  if (mos >= 3.5) return "text-sky-400";
  if (mos >= 3.0) return "text-amber-400";
  return "text-red-400";
}

function mosBg(mos: number | null): string {
  if (mos == null) return "bg-slate-500/10 border-slate-500/20";
  if (mos >= 4.0) return "bg-emerald-400/10 border-emerald-400/20";
  if (mos >= 3.5) return "bg-sky-400/10 border-sky-400/20";
  if (mos >= 3.0) return "bg-amber-400/10 border-amber-400/20";
  return "bg-red-400/10 border-red-400/20";
}

function mosBarColor(mos: number | null): string {
  if (mos == null) return "#64748b";
  if (mos >= 4.0) return "#34d399";
  if (mos >= 3.5) return "#38bdf8";
  if (mos >= 3.0) return "#fbbf24";
  return "#f87171";
}

function fmt(n: number | null, suffix = "", decimals = 2): string {
  if (n == null) return "—";
  return `${n.toFixed(decimals)}${suffix}`;
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── Trend delta badge ─────────────────────────────────────────────────────────

function TrendBadge({ last7d, prev7d }: { last7d: number | null; prev7d: number | null }) {
  if (last7d == null || prev7d == null) return <span className="text-xs text-slate-600">—</span>;
  const delta = last7d - prev7d;
  if (Math.abs(delta) < 0.01) return <Minus className="w-3.5 h-3.5 text-slate-500" />;
  const up = delta > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? "text-emerald-400" : "text-red-400"}`}>
      {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
      {Math.abs(delta).toFixed(2)}
    </span>
  );
}

// ── Quality band stacked bar ──────────────────────────────────────────────────

function BandBar({ bands, total }: { bands: { excellent: number; good: number; fair: number; poor: number }; total: number }) {
  if (!total) return <div className="h-2 rounded-full bg-white/5 w-full" />;
  const pct = (n: number) => `${Math.round((n / total) * 100)}%`;
  return (
    <div className="flex h-2 rounded-full overflow-hidden w-full gap-px">
      {bands.excellent > 0 && <div className="bg-emerald-400" style={{ width: pct(bands.excellent) }} title={`Excellent: ${bands.excellent}`} />}
      {bands.good > 0      && <div className="bg-sky-400"     style={{ width: pct(bands.good) }}      title={`Good: ${bands.good}`} />}
      {bands.fair > 0      && <div className="bg-amber-400"   style={{ width: pct(bands.fair) }}      title={`Fair: ${bands.fair}`} />}
      {bands.poor > 0      && <div className="bg-red-400"     style={{ width: pct(bands.poor) }}      title={`Poor: ${bands.poor}`} />}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CallQualityDashboard() {
  const [days, setDays] = useState(30);
  const [sortBy, setSortBy] = useState<"avgMos" | "avgJitter" | "avgPacketLoss" | "totalCalls">("avgMos");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["call-quality", days],
    queryFn: () => apiFetch(`/analytics/call-quality?days=${days}`),
    staleTime: 60_000,
  });

  const summary = data?.summary;
  const agents: any[] = data?.agents ?? [];
  const trend: any[] = data?.trend ?? [];

  const sorted = [...agents].sort((a, b) => {
    if (sortBy === "avgMos") return (b.avgMos ?? -1) - (a.avgMos ?? -1);
    if (sortBy === "avgJitter") return (a.avgJitter ?? 999) - (b.avgJitter ?? 999);
    if (sortBy === "avgPacketLoss") return (a.avgPacketLoss ?? 999) - (b.avgPacketLoss ?? 999);
    return b.totalCalls - a.totalCalls;
  });

  const coveragePct = summary?.totalCalls
    ? Math.round((summary.callsWithQuality / summary.totalCalls) * 100)
    : 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Gauge className="w-6 h-6 text-primary" />
            Call Quality
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Per-agent MOS score, jitter, and packet loss — ranked best to worst
          </p>
        </div>

        {/* Period picker */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Period:</span>
          <div className="flex rounded-xl overflow-hidden border border-border">
            {[7, 14, 30, 60, 90].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${days === d ? "bg-primary text-primary-foreground" : "hover:bg-secondary text-muted-foreground"}`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="rounded-2xl border-white/5 bg-card p-5 animate-pulse h-28" />
          ))}
        </div>
      ) : isError ? (
        <Card className="rounded-2xl border-red-500/20 bg-red-500/5 p-6 text-center text-red-400 text-sm">
          Failed to load call quality data.
        </Card>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            {
              label: "Avg MOS Score",
              value: fmt(summary?.avgMos, "", 2),
              sub: summary?.avgMos != null ? mosLabel(summary.avgMos) : "No data",
              icon: Gauge,
              color: mosColor(summary?.avgMos),
              bg: mosBg(summary?.avgMos),
            },
            {
              label: "Avg Jitter",
              value: fmt(summary?.avgJitter, " ms", 1),
              sub: summary?.avgJitter != null
                ? summary.avgJitter < 20 ? "Low (healthy)" : summary.avgJitter < 50 ? "Moderate" : "High (degraded)"
                : "No data",
              icon: Wifi,
              color: summary?.avgJitter == null ? "text-slate-500"
                : summary.avgJitter < 20 ? "text-emerald-400"
                : summary.avgJitter < 50 ? "text-amber-400"
                : "text-red-400",
              bg: "bg-card border-white/5",
            },
            {
              label: "Avg Packet Loss",
              value: fmt(summary?.avgPacketLoss, "%", 2),
              sub: summary?.avgPacketLoss != null
                ? summary.avgPacketLoss < 1 ? "Negligible" : summary.avgPacketLoss < 3 ? "Moderate" : "Severe"
                : "No data",
              icon: AlertTriangle,
              color: summary?.avgPacketLoss == null ? "text-slate-500"
                : summary.avgPacketLoss < 1 ? "text-emerald-400"
                : summary.avgPacketLoss < 3 ? "text-amber-400"
                : "text-red-400",
              bg: "bg-card border-white/5",
            },
            {
              label: "Calls Analyzed",
              value: summary?.callsWithQuality?.toLocaleString() ?? "0",
              sub: `${coveragePct}% of ${summary?.totalCalls?.toLocaleString() ?? 0} total`,
              icon: Activity,
              color: "text-primary",
              bg: "bg-card border-white/5",
            },
          ].map(({ label, value, sub, icon: Icon, color, bg }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
            >
              <Card className={`rounded-2xl border p-5 ${bg}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
                  </div>
                  <Icon className={`w-5 h-5 ${color} opacity-70`} />
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

        {/* MOS trend chart */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="xl:col-span-2"
        >
          <Card className="rounded-2xl border-white/5 bg-card p-5">
            <h2 className="font-semibold text-sm flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-primary" />
              Daily MOS Trend
              <span className="text-xs font-normal text-muted-foreground ml-1">— last {days} days (calls with quality data)</span>
            </h2>
            {trend.length === 0 ? (
              <div className="flex items-center justify-center h-44 text-muted-foreground text-sm">
                No quality data for this period.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={trend} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mosGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0a" />
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#64748b" }} />
                  <YAxis domain={[1, 5]} tick={{ fontSize: 11, fill: "#64748b" }} />
                  <Tooltip
                    contentStyle={{ background: "#0f172a", border: "1px solid #ffffff10", borderRadius: 12, fontSize: 12 }}
                    formatter={(v: any, name: string) => [Number(v).toFixed(2), name === "avgMos" ? "Avg MOS" : name]}
                  />
                  {/* Quality band reference lines via reference areas */}
                  <Area type="monotone" dataKey="avgMos" stroke="#6366f1" strokeWidth={2} fill="url(#mosGrad)" name="avgMos" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
            {/* Band legend */}
            <div className="flex items-center gap-4 mt-3 flex-wrap">
              {[
                { label: "Excellent ≥4.0", color: "bg-emerald-400" },
                { label: "Good ≥3.5",      color: "bg-sky-400" },
                { label: "Fair ≥3.0",      color: "bg-amber-400" },
                { label: "Poor <3.0",      color: "bg-red-400" },
              ].map(({ label, color }) => (
                <div key={label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className={`w-2.5 h-2.5 rounded-sm ${color}`} />
                  {label}
                </div>
              ))}
            </div>
          </Card>
        </motion.div>

        {/* Quality band distribution */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <Card className="rounded-2xl border-white/5 bg-card p-5 h-full">
            <h2 className="font-semibold text-sm flex items-center gap-2 mb-4">
              <Activity className="w-4 h-4 text-primary" />
              Quality Distribution
            </h2>
            {!summary || summary.callsWithQuality === 0 ? (
              <div className="flex items-center justify-center h-44 text-muted-foreground text-sm">
                No quality data yet.
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart
                    data={[
                      { name: "Excellent", count: summary.bands.excellent, color: "#34d399" },
                      { name: "Good",      count: summary.bands.good,      color: "#38bdf8" },
                      { name: "Fair",      count: summary.bands.fair,      color: "#fbbf24" },
                      { name: "Poor",      count: summary.bands.poor,      color: "#f87171" },
                    ]}
                    margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0a" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} />
                    <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
                    <Tooltip
                      contentStyle={{ background: "#0f172a", border: "1px solid #ffffff10", borderRadius: 12, fontSize: 12 }}
                      formatter={(v: any) => [`${v} calls`]}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {[
                        { name: "Excellent", count: summary.bands.excellent, color: "#34d399" },
                        { name: "Good",      count: summary.bands.good,      color: "#38bdf8" },
                        { name: "Fair",      count: summary.bands.fair,      color: "#fbbf24" },
                        { name: "Poor",      count: summary.bands.poor,      color: "#f87171" },
                      ].map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-3 space-y-1.5">
                  {[
                    { label: "Excellent", count: summary.bands.excellent, color: "bg-emerald-400" },
                    { label: "Good",      count: summary.bands.good,      color: "bg-sky-400" },
                    { label: "Fair",      count: summary.bands.fair,      color: "bg-amber-400" },
                    { label: "Poor",      count: summary.bands.poor,      color: "bg-red-400" },
                  ].map(({ label, count, color }) => {
                    const pct = summary.callsWithQuality > 0
                      ? Math.round((count / summary.callsWithQuality) * 100)
                      : 0;
                    return (
                      <div key={label} className="flex items-center gap-2 text-xs">
                        <div className={`w-2 h-2 rounded-sm shrink-0 ${color}`} />
                        <span className="text-muted-foreground w-16">{label}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-muted-foreground w-8 text-right">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Card>
        </motion.div>
      </div>

      {/* Per-agent table */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
      >
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-5 border-b border-border flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold flex items-center gap-2">
                <Phone className="w-4 h-4 text-primary" />
                Agent Quality Rankings
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {agents.length} agent{agents.length !== 1 ? "s" : ""} with calls in the last {days} days
              </p>
            </div>

            {/* Sort control */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Sort by:</span>
              <div className="flex rounded-lg overflow-hidden border border-border">
                {(["avgMos", "avgJitter", "avgPacketLoss", "totalCalls"] as const).map(key => (
                  <button
                    key={key}
                    onClick={() => setSortBy(key)}
                    className={`px-2.5 py-1.5 text-xs transition-colors ${sortBy === key ? "bg-primary/20 text-primary" : "hover:bg-secondary text-muted-foreground"}`}
                  >
                    {key === "avgMos" ? "MOS" : key === "avgJitter" ? "Jitter" : key === "avgPacketLoss" ? "Packet Loss" : "Calls"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
          ) : sorted.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground text-sm">
              No call data for this period. Calls with MOS scores appear here after agents use the Browser Dialer.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/20">
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Agent</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">MOS Score</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-[120px]">Quality Mix</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Jitter</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Packet Loss</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">7d Trend</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Calls</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Avg Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sorted.map((agent, idx) => (
                    <tr key={agent.userId} className="hover:bg-secondary/30 transition-colors">
                      {/* Rank */}
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-bold ${idx === 0 ? "text-amber-400" : idx === 1 ? "text-slate-400" : idx === 2 ? "text-orange-600" : "text-muted-foreground/50"}`}>
                          #{idx + 1}
                        </span>
                      </td>

                      {/* Agent */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                            {agent.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-foreground text-sm leading-tight">{agent.name}</p>
                            <p className="text-xs text-muted-foreground">{agent.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* MOS Score */}
                      <td className="px-5 py-3.5">
                        {agent.avgMos != null ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-baseline gap-1.5">
                              <span className={`text-lg font-bold ${mosColor(agent.avgMos)}`}>
                                {agent.avgMos.toFixed(2)}
                              </span>
                              <span className="text-xs text-muted-foreground">/ 5.0</span>
                            </div>
                            <Badge
                              variant="outline"
                              className={`text-[10px] px-1.5 py-0 w-fit border ${mosBg(agent.avgMos)} ${mosColor(agent.avgMos)}`}
                            >
                              {mosLabel(agent.avgMos)}
                            </Badge>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">—</span>
                        )}
                      </td>

                      {/* Quality band bar */}
                      <td className="px-5 py-3.5">
                        <div className="space-y-1 min-w-[100px]">
                          <BandBar bands={agent.bands} total={agent.callsWithQuality} />
                          <div className="flex gap-2 text-[10px] text-muted-foreground">
                            <span className="text-emerald-400">{agent.bands.excellent}E</span>
                            <span className="text-sky-400">{agent.bands.good}G</span>
                            <span className="text-amber-400">{agent.bands.fair}F</span>
                            <span className="text-red-400">{agent.bands.poor}P</span>
                          </div>
                        </div>
                      </td>

                      {/* Jitter */}
                      <td className="px-5 py-3.5">
                        <span className={`font-mono text-sm ${agent.avgJitter == null ? "text-muted-foreground" : agent.avgJitter < 20 ? "text-emerald-400" : agent.avgJitter < 50 ? "text-amber-400" : "text-red-400"}`}>
                          {fmt(agent.avgJitter, " ms", 1)}
                        </span>
                      </td>

                      {/* Packet loss */}
                      <td className="px-5 py-3.5">
                        <span className={`font-mono text-sm ${agent.avgPacketLoss == null ? "text-muted-foreground" : agent.avgPacketLoss < 1 ? "text-emerald-400" : agent.avgPacketLoss < 3 ? "text-amber-400" : "text-red-400"}`}>
                          {fmt(agent.avgPacketLoss, "%", 2)}
                        </span>
                      </td>

                      {/* 7d trend */}
                      <td className="px-5 py-3.5">
                        <TrendBadge last7d={agent.mosLast7d} prev7d={agent.mosPrev7d} />
                      </td>

                      {/* Total calls */}
                      <td className="px-5 py-3.5">
                        <div>
                          <span className="font-semibold">{agent.totalCalls}</span>
                          {agent.callsWithQuality !== agent.totalCalls && (
                            <span className="text-xs text-muted-foreground ml-1">({agent.callsWithQuality} scored)</span>
                          )}
                        </div>
                      </td>

                      {/* Avg duration */}
                      <td className="px-5 py-3.5">
                        <span className="flex items-center gap-1 text-muted-foreground text-sm">
                          <Clock className="w-3.5 h-3.5" />
                          {fmtDuration(agent.avgDuration)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </motion.div>

      {/* Footer explainer */}
      <p className="text-xs text-muted-foreground pb-4">
        MOS (Mean Opinion Score) ranges from 1–5. Quality data is captured automatically from Browser Dialer calls.
        Jitter below 20 ms and packet loss below 1% are ideal for clear voice calls.
        <span className="ml-2 text-emerald-400">■</span> Excellent ≥4.0
        <span className="ml-2 text-sky-400">■</span> Good ≥3.5
        <span className="ml-2 text-amber-400">■</span> Fair ≥3.0
        <span className="ml-2 text-red-400">■</span> Poor &lt;3.0
      </p>
    </div>
  );
}

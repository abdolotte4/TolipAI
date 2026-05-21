import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, Users, CheckCircle2, Clock, ArrowRight,
  PhoneCall, BarChart2, RefreshCw, Loader2, Trophy, FileText,
  Target, AlertCircle, Activity, Mail, Phone,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useCrmGetMe } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";

const COLORS = ["#6366f1", "#22d3ee", "#f59e0b", "#10b981", "#f43f5e", "#a78bfa", "#fb923c", "#34d399"];

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  under_contract: "Under Contract",
  closed: "Closed",
  dead: "Dead / Lost",
};

function StatCard({ label, value, sub, icon: Icon, color = "text-primary" }: {
  label: string; value: string | number; sub?: string; icon: any; color?: string;
}) {
  return (
    <Card className="rounded-2xl border-white/5 bg-card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
          <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
      </div>
    </Card>
  );
}

const FUNNEL_COLORS: Record<string, string> = {
  new: "#6366f1",
  contacted: "#22d3ee",
  qualified: "#f59e0b",
  under_contract: "#f97316",
  closed: "#10b981",
  dead: "#6b7280",
};

function fmtDuration(sec: number | null) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function closeRateColor(rate: number) {
  if (rate >= 20) return "text-emerald-400";
  if (rate >= 10) return "text-amber-400";
  return "text-red-400";
}

function closeRateBadge(rate: number) {
  if (rate >= 20) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (rate >= 10) return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  if (rate > 0)   return "bg-orange-500/10 text-orange-400 border-orange-500/20";
  return "bg-secondary text-muted-foreground border-white/10";
}

function getCampaignNote(campaign: any): string {
  const rate = campaign.closeRate;
  const total = campaign.totalLeads;
  const closed = campaign.closedLeads;
  const daysStr = campaign.avgDaysToClose != null ? ` avg ${campaign.avgDaysToClose}d to close` : "";

  if (total === 0) return "No leads yet";
  if (rate >= 25) return `Top performer — ${closed} closed of ${total} leads${daysStr}`;
  if (rate >= 15) return `Strong conversion — ${closed} closed of ${total} leads${daysStr}`;
  if (rate >= 5)  return `Active pipeline — ${closed} closed, ${campaign.underContract} under contract${daysStr}`;
  if (closed > 0) return `${closed} closed of ${total} leads${daysStr}`;
  if (campaign.underContract > 0) return `${campaign.underContract} under contract, no closed yet`;
  if (campaign.contactedLeads > 0) return `${campaign.contactedLeads} contacted, nurturing pipeline`;
  return `${total} new lead${total !== 1 ? "s" : ""} in pipeline`;
}

// ─── Campaign Performance Table ───────────────────────────────────────────────

function CampaignPerformanceSection({ refresh }: { refresh: number }) {
  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["analytics-campaigns", refresh],
    queryFn: () => apiFetch("/analytics/campaigns"),
    staleTime: 60_000,
  });

  const campaigns = data?.campaigns ?? [];

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
      <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
        <div className="p-5 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-400" /> Campaign Performance &amp; Close Rates
          </h2>
          <span className="text-xs text-muted-foreground">Ranked by close rate</span>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
            <AlertCircle className="w-4 h-4" /> Failed to load campaign data.
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            No campaigns found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-secondary/20">
                  {["#", "Campaign", "Leads", "Closed", "Under Contract", "Close Rate", "Avg Days", "Notes"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/4">
                {campaigns.map((c: any, i: number) => (
                  <tr key={c.campaignId} className={`hover:bg-secondary/20 transition-colors ${i % 2 === 0 ? "" : "bg-secondary/5"}`}>
                    {/* Rank */}
                    <td className="px-4 py-3 w-10">
                      {i === 0 && c.closeRate > 0 ? (
                        <Trophy className="w-4 h-4 text-amber-400" />
                      ) : (
                        <span className="text-xs font-mono text-muted-foreground">{i + 1}</span>
                      )}
                    </td>

                    {/* Campaign name */}
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground truncate max-w-[180px] block">{c.campaignName}</span>
                    </td>

                    {/* Total leads */}
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm">{c.totalLeads.toLocaleString()}</span>
                    </td>

                    {/* Closed */}
                    <td className="px-4 py-3">
                      <span className={`font-mono text-sm font-semibold ${c.closedLeads > 0 ? "text-emerald-400" : "text-muted-foreground"}`}>
                        {c.closedLeads}
                      </span>
                    </td>

                    {/* Under contract */}
                    <td className="px-4 py-3">
                      <span className={`font-mono text-sm ${c.underContract > 0 ? "text-amber-400" : "text-muted-foreground"}`}>
                        {c.underContract}
                      </span>
                    </td>

                    {/* Close rate with progress bar */}
                    <td className="px-4 py-3 min-w-[120px]">
                      <div className="flex items-center gap-2">
                        <Badge className={`text-[11px] font-mono font-semibold border ${closeRateBadge(c.closeRate)}`}>
                          {c.closeRate.toFixed(1)}%
                        </Badge>
                        <div className="flex-1 h-1.5 rounded-full bg-secondary/50 overflow-hidden min-w-[50px]">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(c.closeRate * 3, 100)}%`,
                              background: c.closeRate >= 20 ? "#10b981" : c.closeRate >= 10 ? "#f59e0b" : "#6366f1",
                            }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Avg days to close */}
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-muted-foreground">
                        {c.avgDaysToClose != null ? `${c.avgDaysToClose}d` : "—"}
                      </span>
                    </td>

                    {/* Auto-generated note */}
                    <td className="px-4 py-3 max-w-[260px]">
                      <div className="flex items-start gap-1.5">
                        <FileText className="w-3 h-3 text-muted-foreground/50 shrink-0 mt-0.5" />
                        <span className="text-xs text-muted-foreground leading-snug">{getCampaignNote(c)}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </motion.div>
  );
}

// ─── Live Activity Feed ────────────────────────────────────────────────────────

interface ActivityEvent {
  type: string;
  leadName?: string;
  address?: string;
  phone?: string;
  source?: string;
  leadId?: number | null;
  ts: number;
}

function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("crm_token");
    if (!token) return;
    const es = new EventSource(`/api/crm/events?token=${encodeURIComponent(token)}`);

    es.addEventListener("connected", () => setConnected(true));
    es.onerror = () => setConnected(false);

    const push = (type: string) => (e: MessageEvent) => {
      try {
        const d = JSON.parse(e.data);
        setEvents(prev => [{ type, ...d, ts: d.ts ?? Date.now() }, ...prev].slice(0, 50));
      } catch { }
    };

    (["lead_created", "incoming_call", "call_attempt", "email_open"] as const)
      .forEach(t => es.addEventListener(t, push(t)));

    return () => es.close();
  }, []);

  const icon = (type: string) => {
    if (type === "lead_created")  return <Users className="w-3.5 h-3.5 text-primary" />;
    if (type === "incoming_call") return <Phone className="w-3.5 h-3.5 text-emerald-400" />;
    if (type === "call_attempt")  return <PhoneCall className="w-3.5 h-3.5 text-cyan-400" />;
    if (type === "email_open")    return <Mail className="w-3.5 h-3.5 text-amber-400" />;
    return <Activity className="w-3.5 h-3.5 text-muted-foreground" />;
  };

  const label = (ev: ActivityEvent) => {
    if (ev.type === "lead_created")
      return `New lead: ${ev.leadName || "Unknown"}${ev.address ? ` — ${ev.address}` : ""}${ev.source ? ` via ${ev.source}` : ""}`;
    if (ev.type === "incoming_call")
      return `${ev.leadName || ev.phone || "Unknown"} is calling in`;
    if (ev.type === "call_attempt")
      return `Call logged for ${ev.leadName || ev.phone || "lead"}`;
    if (ev.type === "email_open")
      return `${ev.leadName || "A lead"} opened an email`;
    return "Activity";
  };

  const timeAgo = (ts: number) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 5)    return "just now";
    if (s < 60)   return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
      <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2 text-sm">
            <Activity className="w-4 h-4 text-primary" /> Live Activity Feed
          </h2>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-muted-foreground/40"}`} />
            <span className="text-xs text-muted-foreground">{connected ? "Connected" : "Connecting…"}</span>
          </div>
        </div>
        {events.length === 0 ? (
          <div className="px-5 py-8 text-center text-muted-foreground text-sm">
            Waiting for activity… new leads, incoming calls, and email opens will appear here in real time.
          </div>
        ) : (
          <div className="divide-y divide-white/4 max-h-[280px] overflow-y-auto">
            {events.map((ev, i) => (
              <div key={i} className="px-5 py-2.5 flex items-center gap-3 hover:bg-secondary/20 transition-colors">
                <div className="shrink-0">{icon(ev.type)}</div>
                <p className="flex-1 text-sm text-foreground truncate">{label(ev)}</p>
                <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">{timeAgo(ev.ts)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </motion.div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────

export default function AnalyticsDashboard() {
  const [refresh, setRefresh] = useState(0);
  const { data: meData } = useCrmGetMe();
  const isSuperAdmin = meData?.role === "super_admin";

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["analytics-dashboard", refresh],
    queryFn: () => apiFetch("/analytics/dashboard"),
    staleTime: 60_000,
  });

  const { data: callData, isLoading: callLoading } = useQuery<any>({
    queryKey: ["analytics-calls-summary", refresh],
    queryFn: () => apiFetch("/analytics/calls"),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3 text-muted-foreground text-sm">
        <AlertCircle className="w-8 h-8 opacity-40" />
        <p>Failed to load analytics. Please try again.</p>
        <Button variant="outline" size="sm" onClick={() => setRefresh(r => r + 1)} className="gap-2">
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </Button>
      </div>
    );
  }

  const { summary, velocity, funnel, topSources, weeklyTrend } = data || {};

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-primary" /> Analytics Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Lead velocity, conversion funnel, and campaign performance</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/analytics/calls">
            <Button variant="outline" size="sm" className="gap-2 rounded-xl border-white/10">
              <PhoneCall className="w-4 h-4" /> Call Report <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
          <Button
            variant="ghost" size="icon"
            className="rounded-xl border border-white/10 bg-card hover:bg-secondary"
            onClick={() => setRefresh(r => r + 1)}
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </motion.div>

      {/* KPI Cards */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Leads" value={(summary?.totalLeads ?? 0).toLocaleString()} icon={Users} color="text-primary" />
        <StatCard
          label="Close Rate"
          value={`${summary?.closeRate ?? 0}%`}
          sub={`${summary?.closedLeads ?? 0} closed`}
          icon={CheckCircle2}
          color="text-emerald-400"
        />
        <StatCard
          label="Avg Days to Close"
          value={summary?.avgDaysToClose != null ? `${summary.avgDaysToClose}d` : "—"}
          sub={summary?.totalClosed ? `from ${summary.totalClosed} deals` : "no closed leads yet"}
          icon={Clock}
          color="text-amber-400"
        />
        <StatCard
          label="Total Calls"
          value={(callData?.summary?.totalCalls ?? 0).toLocaleString()}
          sub={callLoading ? "loading…" : `${callData?.summary?.answerRate ?? 0}% answer rate`}
          icon={PhoneCall}
          color="text-cyan-400"
        />
      </motion.div>

      {/* Live Activity Feed */}
      <ActivityFeed />

      {/* Lead Velocity Chart */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-5 border-b border-border">
            <h2 className="font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Lead Velocity — Last 8 Weeks
            </h2>
          </div>
          <div className="p-5">
            {velocity?.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={velocity} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="velGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="week" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "#1c1c2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
                    labelStyle={{ color: "#e2e8f0" }}
                  />
                  <Area type="monotone" dataKey="count" name="New Leads" stroke="#6366f1" fill="url(#velGrad)" strokeWidth={2} dot={{ r: 4, fill: "#6366f1" }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No lead data yet.</div>
            )}
          </div>
        </Card>
      </motion.div>

      {/* Conversion Funnel + Top Sources */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Funnel */}
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-5 border-b border-border">
            <h2 className="font-semibold">Conversion Funnel</h2>
          </div>
          <div className="p-5">
            {funnel?.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={funnel} layout="vertical" margin={{ top: 0, right: 30, left: 80, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                  <XAxis type="number" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="status"
                    tick={{ fill: "#9ca3af", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={s => STATUS_LABELS[s] || s}
                    width={80}
                  />
                  <Tooltip
                    contentStyle={{ background: "#1c1c2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
                    formatter={(v: any, _n: any, p: any) => [v, STATUS_LABELS[p.payload.status] || p.payload.status]}
                  />
                  <Bar dataKey="count" name="Leads" radius={[0, 6, 6, 0]}>
                    {funnel.map((entry: any) => (
                      <Cell key={entry.status} fill={FUNNEL_COLORS[entry.status] || "#6366f1"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No lead data yet.</div>
            )}
          </div>
        </Card>

        {/* Top Lead Sources */}
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-5 border-b border-border">
            <h2 className="font-semibold">Top Lead Sources</h2>
          </div>
          <div className="p-5">
            {topSources?.length > 0 ? (
              <div className="space-y-3">
                {topSources.map((s: any, i: number) => {
                  const max = topSources[0].count;
                  const pct = max > 0 ? Math.round((s.count / max) * 100) : 0;
                  return (
                    <div key={s.source} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-foreground truncate max-w-[200px]">{s.source}</span>
                        <span className="text-muted-foreground font-mono text-xs ml-2">{s.count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: COLORS[i % COLORS.length] }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No source data yet.</div>
            )}
          </div>
        </Card>
      </motion.div>

      {/* Campaign Performance — super_admin only (cross-campaign view) */}
      {isSuperAdmin && <CampaignPerformanceSection refresh={refresh} />}

      {/* Weekly Multi-Status Trend */}
      {weeklyTrend?.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
            <div className="p-5 border-b border-border">
              <h2 className="font-semibold">Weekly Status Breakdown — Last 12 Weeks</h2>
            </div>
            <div className="p-5">
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={weeklyTrend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    {[
                      { id: "gNew", color: "#6366f1" },
                      { id: "gContacted", color: "#22d3ee" },
                      { id: "gContract", color: "#f97316" },
                      { id: "gClosed", color: "#10b981" },
                    ].map(({ id, color }) => (
                      <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={color} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="week" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "#1c1c2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
                    labelStyle={{ color: "#e2e8f0" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af", paddingTop: 12 }} />
                  <Area type="monotone" dataKey="new" name="New" stroke="#6366f1" fill="url(#gNew)" strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="contacted" name="Contacted" stroke="#22d3ee" fill="url(#gContacted)" strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="contract" name="Under Contract" stroke="#f97316" fill="url(#gContract)" strokeWidth={1.5} dot={false} />
                  <Area type="monotone" dataKey="closed" name="Closed" stroke="#10b981" fill="url(#gClosed)" strokeWidth={1.5} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, Users, CheckCircle2, Clock, ArrowRight,
  PhoneCall, BarChart2, RefreshCw, Loader2,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
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

export default function AnalyticsDashboard() {
  const [refresh, setRefresh] = useState(0);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["analytics-dashboard", refresh],
    queryFn: () => apiFetch("/crm/analytics/dashboard"),
    staleTime: 60_000,
  });

  const { data: callData, isLoading: callLoading } = useQuery<any>({
    queryKey: ["analytics-calls-summary", refresh],
    queryFn: () => apiFetch("/crm/analytics/calls"),
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
      <div className="flex items-center justify-center h-96 text-muted-foreground text-sm">
        Failed to load analytics. Please try again.
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

      {/* Weekly Multi-Status Trend */}
      {weeklyTrend?.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
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

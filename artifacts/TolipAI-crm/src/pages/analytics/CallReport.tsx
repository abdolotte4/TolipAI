import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  Phone, PhoneCall, PhoneIncoming, PhoneMissed, Clock, Users,
  BarChart2, ArrowLeft, RefreshCw, Loader2, TrendingUp,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

const DISPOSITION_COLORS: Record<string, string> = {
  answered: "#10b981",
  completed: "#10b981",
  "no-answer": "#f59e0b",
  busy: "#f97316",
  failed: "#f43f5e",
  voicemail: "#a78bfa",
  initiated: "#6366f1",
  "in-progress": "#22d3ee",
  unknown: "#6b7280",
};

function fmtDuration(sec: number | null) {
  if (!sec || sec === 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

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

export default function CallReport() {
  const [refresh, setRefresh] = useState(0);

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["analytics-calls", refresh],
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
      <div className="flex items-center justify-center h-96 text-muted-foreground text-sm">
        Failed to load call analytics. Please try again.
      </div>
    );
  }

  const { summary, volume, dispositions, agents } = data || {};

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/analytics">
            <Button variant="ghost" size="icon" className="rounded-xl border border-white/10 bg-card hover:bg-secondary">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-display font-bold flex items-center gap-2">
              <PhoneCall className="w-6 h-6 text-primary" /> Call Report
            </h1>
            <p className="text-muted-foreground text-sm mt-0.5">Volume, duration, dispositions, and agent performance</p>
          </div>
        </div>
        <Button
          variant="ghost" size="icon"
          className="rounded-xl border border-white/10 bg-card hover:bg-secondary"
          onClick={() => setRefresh(r => r + 1)}
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      </motion.div>

      {/* KPI Cards */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Calls"
          value={(summary?.totalCalls ?? 0).toLocaleString()}
          sub={`${summary?.outbound ?? 0} out · ${summary?.inbound ?? 0} in`}
          icon={Phone}
          color="text-primary"
        />
        <StatCard
          label="Answer Rate"
          value={`${summary?.answerRate ?? 0}%`}
          sub={`${summary?.answered ?? 0} answered`}
          icon={PhoneCall}
          color="text-emerald-400"
        />
        <StatCard
          label="Avg Duration"
          value={fmtDuration(summary?.avgDurationSec)}
          sub={`Total: ${fmtDuration(summary?.totalDurationSec)}`}
          icon={Clock}
          color="text-amber-400"
        />
        <StatCard
          label="Active Agents"
          value={summary?.activeAgents ?? 0}
          sub="with call activity"
          icon={Users}
          color="text-cyan-400"
        />
      </motion.div>

      {/* Volume + Duration Chart */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-5 border-b border-border">
            <h2 className="font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Call Volume — Last 8 Weeks
            </h2>
          </div>
          <div className="p-5">
            {volume?.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={volume} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="outGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="inGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="week" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "#1c1c2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
                    labelStyle={{ color: "#e2e8f0" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, color: "#9ca3af", paddingTop: 12 }} />
                  <Area type="monotone" dataKey="outbound" name="Outbound" stroke="#6366f1" fill="url(#outGrad)" strokeWidth={2} dot={{ r: 3, fill: "#6366f1" }} />
                  <Area type="monotone" dataKey="inbound" name="Inbound" stroke="#22d3ee" fill="url(#inGrad)" strokeWidth={2} dot={{ r: 3, fill: "#22d3ee" }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No call data yet.</div>
            )}
          </div>
        </Card>
      </motion.div>

      {/* Disposition Pie + Avg Duration Bar */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
        className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Disposition Breakdown */}
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-5 border-b border-border">
            <h2 className="font-semibold">Disposition Breakdown</h2>
          </div>
          <div className="p-5">
            {dispositions?.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={dispositions}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {dispositions.map((entry: any, i: number) => (
                      <Cell
                        key={entry.name}
                        fill={DISPOSITION_COLORS[entry.name] || `hsl(${(i * 47) % 360}, 70%, 60%)`}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#1c1c2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
                  />
                  <Legend
                    formatter={(value: string) => (
                      <span style={{ color: "#9ca3af", fontSize: 11, textTransform: "capitalize" }}>{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No disposition data yet.</div>
            )}
          </div>
        </Card>

        {/* Avg Duration by Week */}
        <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
          <div className="p-5 border-b border-border">
            <h2 className="font-semibold">Avg Call Duration by Week (sec)</h2>
          </div>
          <div className="p-5">
            {volume?.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={volume} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="week" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: "#1c1c2e", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, fontSize: 12 }}
                    formatter={(v: any) => [`${v}s`, "Avg Duration"]}
                    labelStyle={{ color: "#e2e8f0" }}
                  />
                  <Bar dataKey="avgDuration" name="Avg Duration (s)" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No call data yet.</div>
            )}
          </div>
        </Card>
      </motion.div>

      {/* Agent Performance Table */}
      {agents?.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
            <div className="p-5 border-b border-border">
              <h2 className="font-semibold flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" /> Agent Performance
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/20">
                    <th className="text-left p-3 text-xs text-muted-foreground font-medium">Agent</th>
                    <th className="text-right p-3 text-xs text-muted-foreground font-medium">Total Calls</th>
                    <th className="text-right p-3 text-xs text-muted-foreground font-medium">Outbound</th>
                    <th className="text-right p-3 text-xs text-muted-foreground font-medium">Answered</th>
                    <th className="text-right p-3 text-xs text-muted-foreground font-medium">Avg Duration</th>
                    <th className="text-right p-3 text-xs text-muted-foreground font-medium">Total Talk Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {agents.map((a: any) => (
                    <tr key={a.userId} className="hover:bg-secondary/20 transition-colors">
                      <td className="p-3 font-medium">{a.name}</td>
                      <td className="p-3 text-right text-muted-foreground">{a.totalCalls}</td>
                      <td className="p-3 text-right text-muted-foreground">{a.outbound}</td>
                      <td className="p-3 text-right">
                        <span className={a.answered > 0 ? "text-emerald-400" : "text-muted-foreground"}>{a.answered}</span>
                      </td>
                      <td className="p-3 text-right text-muted-foreground font-mono text-xs">{fmtDuration(a.avgDuration)}</td>
                      <td className="p-3 text-right text-muted-foreground font-mono text-xs">{fmtDuration(a.totalDuration)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

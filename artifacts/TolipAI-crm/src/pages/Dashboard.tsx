import { useCrmGetStats, useCrmGetMe } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Users, UserPlus, FileSignature, DollarSign, CheckSquare, ArrowUpRight, CreditCard, Calendar, AlertTriangle, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { apiFetch } from "@/lib/api";

// ── Subscription status types ─────────────────────────────────────────────────

interface SubscriptionStatus {
  configured: boolean;
  status?: string;
  planName?: string;
  amount?: number | null;
  currency?: string;
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
}

// ── Subscription Banner ───────────────────────────────────────────────────────

function SubscriptionBanner() {
  const { data: sub, isLoading } = useQuery<SubscriptionStatus>({
    queryKey: ["subscription-status"],
    queryFn: () => apiFetch("/billing/subscription"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="h-14 rounded-2xl bg-card/50 animate-pulse border border-white/5" />
    );
  }

  if (!sub?.configured) return null;

  const statusConfig: Record<string, { label: string; className: string }> = {
    active:   { label: "Active",    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    trialing: { label: "Trial",     className: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
    past_due: { label: "Past due",  className: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    canceled: { label: "Canceled",  className: "bg-red-500/10 text-red-400 border-red-500/20" },
    unpaid:   { label: "Unpaid",    className: "bg-red-500/10 text-red-400 border-red-500/20" },
    paused:   { label: "Paused",    className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
  };
  const sc = statusConfig[sub.status ?? ""] ?? { label: sub.status ?? "Unknown", className: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" };
  const isProblem = sub.status === "past_due" || sub.status === "unpaid" || sub.status === "canceled";

  const nextDate = sub.currentPeriodEnd
    ? new Date(sub.currentPeriodEnd * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : null;

  const amountStr = sub.amount != null
    ? `$${sub.amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} / mo`
    : null;

  return (
    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
      <Card className={`flex items-center justify-between gap-4 px-5 py-3.5 rounded-2xl border shadow-sm ${isProblem ? "bg-amber-500/5 border-amber-500/20" : "bg-card/50 border-white/5"}`}>
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2 rounded-xl flex-shrink-0 ${isProblem ? "bg-amber-500/10 border border-amber-500/20" : "bg-primary/10 border border-primary/20"}`}>
            {isProblem
              ? <AlertTriangle className="w-4 h-4 text-amber-400" />
              : <CreditCard className="w-4 h-4 text-primary" />}
          </div>
          <div className="flex items-center gap-2.5 flex-wrap min-w-0">
            <span className="font-semibold text-sm text-foreground truncate">{sub.planName}</span>
            <Badge variant="outline" className={`text-xs px-2 py-0 ${sc.className}`}>{sc.label}</Badge>
            {amountStr && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                {amountStr}
              </span>
            )}
            {nextDate && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                {sub.cancelAtPeriodEnd ? `Cancels ${nextDate}` : `Renews ${nextDate}`}
              </span>
            )}
          </div>
        </div>
        <Link href="/admin/billing" className="flex-shrink-0">
          <Button variant="outline" size="sm" className="text-xs rounded-xl h-7 px-3 gap-1.5">
            Manage <ArrowUpRight className="w-3 h-3" />
          </Button>
        </Link>
      </Card>
    </motion.div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { data: stats, isLoading } = useCrmGetStats();
  const { data: me } = useCrmGetMe();

  const isAdmin = me?.role === "admin";

  if (isLoading || !stats) {
    return (
      <div className="animate-pulse space-y-8">
        <div className="h-8 bg-card w-48 rounded"></div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-card rounded-2xl"></div>)}
        </div>
      </div>
    );
  }

  const chartData = stats.leadsByStatus.map(s => ({
    name: s.status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()),
    count: s.count
  }));

  const StatCard = ({ title, value, icon: Icon, color, delay }: any) => (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <Card className="p-6 rounded-2xl border-white/5 bg-card/50 backdrop-blur-sm hover:bg-card/80 transition-all shadow-lg hover:shadow-xl hover:-translate-y-1 relative overflow-hidden group">
        <div className={`absolute top-0 right-0 w-32 h-32 bg-${color}-500/10 rounded-full blur-3xl -mr-10 -mt-10 transition-transform group-hover:scale-150`}></div>
        <div className="flex items-start justify-between relative z-10">
          <div>
            <p className="text-muted-foreground font-medium text-sm mb-1">{title}</p>
            <h3 className="text-4xl font-display font-bold text-foreground">{value}</h3>
          </div>
          <div className={`p-3 rounded-xl bg-${color}-500/10 border border-${color}-500/20`}>
            <Icon className={`w-6 h-6 text-${color}-500`} />
          </div>
        </div>
      </Card>
    </motion.div>
  );

  return (
    <div className="space-y-8 pb-10">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Here's what's happening with your leads today.</p>
        </div>
        <Link href="/leads/new">
          <button className="px-5 py-2.5 bg-primary text-white rounded-xl font-medium shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:-translate-y-0.5 transition-all">
            + Add Lead
          </button>
        </Link>
      </motion.div>

      {isAdmin && <SubscriptionBanner />}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Total Leads" value={stats.totalLeads} icon={Users} color="blue" delay={0.1} />
        <StatCard title="New Leads" value={stats.newLeads} icon={UserPlus} color="indigo" delay={0.2} />
        <StatCard title="Under Contract" value={stats.underContract} icon={FileSignature} color="purple" delay={0.3} />
        <StatCard title="Closed Deals" value={stats.closed} icon={DollarSign} color="emerald" delay={0.4} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 }} className="lg:col-span-2">
          <Card className="p-6 rounded-2xl border-white/5 bg-card h-full shadow-lg">
            <h3 className="font-display font-bold text-lg mb-6">Pipeline Distribution</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  <XAxis dataKey="name" stroke="rgba(255,255,255,0.3)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }}
                    itemStyle={{ color: 'hsl(var(--primary))' }}
                  />
                  <Area type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 }}>
          <Card className="p-6 rounded-2xl border-white/5 bg-card h-full shadow-lg flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-display font-bold text-lg">Action Items</h3>
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
                {stats.pendingTasks} pending
              </Badge>
            </div>
            
            <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4 py-8">
              <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
                <CheckSquare className="w-8 h-8 text-muted-foreground" />
              </div>
              <div>
                <p className="text-foreground font-medium">You have {stats.pendingTasks} tasks to complete.</p>
                <p className="text-muted-foreground text-sm mt-1">Keep your deals moving forward.</p>
              </div>
              <Link href="/tasks">
                <Button className="mt-2 rounded-xl" variant="outline">View All Tasks</Button>
              </Link>
            </div>
          </Card>
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
        <Card className="p-0 overflow-hidden rounded-2xl border-white/5 bg-card shadow-lg">
          <div className="p-6 border-b border-border flex items-center justify-between">
            <h3 className="font-display font-bold text-lg">Recent Leads</h3>
            <Link href="/leads">
              <Button variant="ghost" size="sm" className="text-primary hover:text-primary/80">
                View All <ArrowUpRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider">
                  <th className="p-4 font-medium">Seller Name</th>
                  <th className="p-4 font-medium">Property Address</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium text-right">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stats.recentLeads.slice(0, 5).map(lead => (
                  <tr key={lead.id} className="hover:bg-secondary/30 transition-colors">
                    <td className="p-4 font-medium text-foreground">
                      <Link href={`/leads/${lead.id}`} className="hover:text-primary transition-colors">
                        {lead.sellerName}
                      </Link>
                    </td>
                    <td className="p-4 text-muted-foreground text-sm">{lead.address}</td>
                    <td className="p-4">
                      <Badge variant="outline" className={`
                        ${lead.status === 'new' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : ''}
                        ${lead.status === 'contacted' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : ''}
                        ${lead.status === 'qualified' ? 'bg-green-500/10 text-green-400 border-green-500/20' : ''}
                      `}>
                        {lead.status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="p-4 text-muted-foreground text-sm text-right">
                      {new Date(lead.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {stats.recentLeads.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-muted-foreground">
                      No leads added yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}

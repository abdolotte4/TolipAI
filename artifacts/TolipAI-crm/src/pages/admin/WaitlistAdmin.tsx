import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Users2, Search, Download, ExternalLink,
  Loader2, Mail, TrendingUp, Clock, ChevronLeft, ChevronRight, X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { Link } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WaitlistRow {
  id: number;
  firstName: string | null;
  lastName:  string | null;
  email:     string | null;
  notes:     string | null;
  createdAt: string | null;
}

interface WaitlistResponse {
  rows:       WaitlistRow[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
  stats: {
    total:      number;
    last7days:  number;
    last30days: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color = "text-primary" }: {
  label: string; value: number; icon: any; color?: string;
}) {
  return (
    <Card className="p-5 rounded-2xl border-white/5 bg-card flex items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value.toLocaleString()}</p>
      </div>
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WaitlistAdmin() {
  const [search, setSearch] = useState("");
  const [from,   setFrom]   = useState("");
  const [to,     setTo]     = useState("");
  const [page,   setPage]   = useState(1);
  const [exporting, setExporting] = useState(false);

  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (from)   params.set("from",   from);
  if (to)     params.set("to",     to);
  params.set("page",  String(page));
  params.set("limit", "50");

  const { data, isLoading, isError, refetch } = useQuery<WaitlistResponse>({
    queryKey: ["crm-waitlist", search, from, to, page],
    queryFn:  () => apiFetch(`/crm/admin/waitlist?${params.toString()}`),
    placeholderData: (prev) => prev,
  });

  const handleSearch = useCallback((val: string) => {
    setSearch(val);
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setSearch(""); setFrom(""); setTo(""); setPage(1);
  }, []);

  const hasFilters = search || from || to;

  async function handleExport() {
    setExporting(true);
    try {
      const token = localStorage.getItem("crm_token");
      const ep = new URLSearchParams();
      if (search) ep.set("search", search);
      if (from)   ep.set("from", from);
      if (to)     ep.set("to", to);
      const resp = await fetch(`/api/crm/admin/waitlist/export?${ep.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error("Export failed");
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `tolipai-waitlist-${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const rows       = data?.rows       ?? [];
  const stats      = data?.stats      ?? { total: 0, last7days: 0, last30days: 0 };
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
            <Users2 className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Waitlist Signups</h1>
            <p className="text-xs text-muted-foreground">Landing page email captures from TolipAI.com</p>
          </div>
        </div>
        <Button
          onClick={handleExport}
          disabled={exporting || !data?.total}
          variant="outline"
          className="gap-2 border-emerald-500/30 text-emerald-400 hover:text-emerald-300 hover:border-emerald-400/50 hover:bg-emerald-500/5"
        >
          {exporting
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Exporting…</>
            : <><Download className="w-4 h-4" /> Export CSV</>
          }
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Signups"   value={stats.total}      icon={Mail}        color="text-violet-400" />
        <StatCard label="Last 7 Days"     value={stats.last7days}  icon={Clock}       color="text-blue-400"   />
        <StatCard label="Last 30 Days"    value={stats.last30days} icon={TrendingUp}  color="text-emerald-400"/>
      </div>

      {/* Filters */}
      <Card className="p-4 rounded-2xl border-white/5 bg-card">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or email…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="pl-9 bg-background/50 border-white/10 focus:border-violet-500/50"
            />
          </div>
          <div className="flex gap-2 items-center">
            <label className="text-xs text-muted-foreground whitespace-nowrap">From</label>
            <Input
              type="date"
              value={from}
              onChange={e => { setFrom(e.target.value); setPage(1); }}
              className="w-36 bg-background/50 border-white/10 focus:border-violet-500/50 text-sm"
            />
          </div>
          <div className="flex gap-2 items-center">
            <label className="text-xs text-muted-foreground whitespace-nowrap">To</label>
            <Input
              type="date"
              value={to}
              onChange={e => { setTo(e.target.value); setPage(1); }}
              className="w-36 bg-background/50 border-white/10 focus:border-violet-500/50 text-sm"
            />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground hover:text-foreground shrink-0">
              <X className="w-3.5 h-3.5" /> Clear
            </Button>
          )}
        </div>
        {data && (
          <p className="text-xs text-muted-foreground mt-3">
            Showing {rows.length} of <strong className="text-foreground">{data.total}</strong> result{data.total !== 1 ? "s" : ""}
            {hasFilters && <> — filtered</>}
          </p>
        )}
      </Card>

      {/* Table */}
      <Card className="rounded-2xl border-white/5 bg-card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading…
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
            <p>Failed to load waitlist. Make sure you have admin access.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground">
            <Users2 className="w-10 h-10 opacity-20" />
            <p className="text-sm">{hasFilters ? "No results match your filters." : "No waitlist signups yet."}</p>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-secondary/30">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Notes</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Joined</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Lead</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/4">
                {rows.map((row, i) => {
                  const name = [row.firstName, row.lastName].filter(Boolean).join(" ") || "—";
                  const joined = row.createdAt ? format(new Date(row.createdAt), "MMM d, yyyy · h:mm a") : "—";
                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-secondary/30 transition-colors ${i % 2 === 0 ? "" : "bg-secondary/10"}`}
                    >
                      <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">
                        {name}
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={`mailto:${row.email}`}
                          className="text-violet-400 hover:text-violet-300 flex items-center gap-1.5 transition-colors"
                        >
                          <Mail className="w-3.5 h-3.5 shrink-0" />
                          {row.email || "—"}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell max-w-xs truncate">
                        {row.notes
                          ? row.notes.replace(/^Joined waitlist from landing page[^.]*\.\s*/i, "").trim() || "—"
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                        {joined}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/leads/${row.id}`}>
                          <a className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                            <ExternalLink className="w-3.5 h-3.5" />
                            View
                          </a>
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-muted-foreground text-xs">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="gap-1 h-8"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
            </Button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const n = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
              return (
                <Button
                  key={n}
                  variant={n === page ? "default" : "outline"}
                  size="sm"
                  className="h-8 w-8 p-0 text-xs"
                  onClick={() => setPage(n)}
                >
                  {n}
                </Button>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              className="gap-1 h-8"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Footer note */}
      <p className="text-xs text-muted-foreground text-center pb-2">
        Waitlist signups are stored as CRM leads with source "landing_page_waitlist" — click View to see the full lead record.
      </p>
    </div>
  );
}

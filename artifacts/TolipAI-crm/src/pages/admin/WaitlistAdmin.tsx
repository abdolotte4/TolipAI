import { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Users2, Search, Download, X, Loader2,
  Mail, TrendingUp, Clock, ChevronLeft, ChevronRight,
  Trash2, Phone, Building2, User, ChevronDown,
  Pencil, Check,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  Tooltip, CartesianGrid,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiFetch } from "@/lib/api";
import { Link } from "wouter";

// ─── Types ────────────────────────────────────────────────────────────────────

type WaitlistStatus = "pending" | "contacted" | "converted" | "nurture" | "churned";

interface WaitlistRow {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  source: string | null;
  status: WaitlistStatus;
  notes: string | null;
  created_at: string;
}

interface WaitlistResponse {
  rows: WaitlistRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  stats: { total: number; last7days: number; last30days: number };
}

interface ChartDay { date: string; count: number }

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CYCLE: WaitlistStatus[] = ["pending", "contacted", "converted", "nurture", "churned"];

const STATUS_META: Record<WaitlistStatus, { label: string; color: string }> = {
  pending:   { label: "Pending",   color: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  contacted: { label: "Contacted", color: "bg-blue-500/15 text-blue-300 border-blue-500/30" },
  converted: { label: "Converted", color: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  nurture:   { label: "Nurture",   color: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
  churned:   { label: "Churned",   color: "bg-red-500/15 text-red-400 border-red-500/30" },
};

const SOURCE_LABELS: Record<string, string> = {
  landing_hero:    "Hero",
  landing_compare: "Compare",
  landing_cta:     "CTA",
  referral:        "Referral",
  organic:         "Organic",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function autoTag(email: string): { label: string; icon: typeof User } {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const personal = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "me.com", "aol.com"];
  return personal.includes(domain)
    ? { label: "Individual",  icon: User }
    : { label: "Company",     icon: Building2 };
}

function nextStatus(current: WaitlistStatus): WaitlistStatus {
  const idx = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

// ─── NoteCell ─────────────────────────────────────────────────────────────────
// Click-to-edit inline notes with auto-save on blur.

function NoteCell({
  rowId,
  initialNote,
  onSave,
}: {
  rowId: string;
  initialNote: string | null;
  onSave: (id: string, notes: string) => Promise<void>;
}) {
  const [editing, setEditing]   = useState(false);
  const [value,   setValue]     = useState(initialNote ?? "");
  const [saved,   setSaved]     = useState(false);
  const [saving,  setSaving]    = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Keep in sync when parent data refreshes
  useEffect(() => { setValue(initialNote ?? ""); }, [initialNote]);

  function startEdit() {
    setEditing(true);
    setSaved(false);
    setTimeout(() => {
      ref.current?.focus();
      // place cursor at end
      const len = ref.current?.value.length ?? 0;
      ref.current?.setSelectionRange(len, len);
    }, 0);
  }

  async function handleBlur() {
    setEditing(false);
    const trimmed = value.trim();
    if (trimmed === (initialNote ?? "").trim()) return;
    setSaving(true);
    try {
      await onSave(rowId, trimmed);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") { setValue(initialNote ?? ""); setEditing(false); }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ref.current?.blur(); }
  }

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        rows={2}
        placeholder="Add a note… (Enter to save, Esc to cancel)"
        className="w-full min-w-[180px] max-w-[260px] rounded-lg border border-violet-500/50 bg-background/80 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-violet-500/60 shadow-sm"
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      className="group flex items-start gap-1.5 text-left max-w-[220px] min-w-[120px]"
      title="Click to edit note"
    >
      {saving ? (
        <Loader2 className="w-3 h-3 text-muted-foreground animate-spin mt-0.5 shrink-0" />
      ) : saved ? (
        <Check className="w-3 h-3 text-emerald-400 mt-0.5 shrink-0" />
      ) : (
        <Pencil className="w-3 h-3 text-muted-foreground/40 group-hover:text-muted-foreground mt-0.5 shrink-0 transition-colors" />
      )}
      <span className={`text-xs leading-snug line-clamp-2 ${value ? "text-foreground/80" : "text-muted-foreground/50 italic"}`}>
        {saved ? <span className="text-emerald-400 not-italic">Saved</span> : (value || "Add note…")}
      </span>
    </button>
  );
}

// ─── Small Components ─────────────────────────────────────────────────────────

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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WaitlistAdmin() {
  const qc = useQueryClient();

  const [search,   setSearch]   = useState("");
  const [status,   setStatus]   = useState("all");
  const [from,     setFrom]     = useState("");
  const [to,       setTo]       = useState("");
  const [page,     setPage]     = useState(1);
  const [toDelete, setToDelete] = useState<WaitlistRow | null>(null);
  const [exporting, setExporting] = useState(false);

  // ── Queries ──
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (search)           params.set("search", search);
  if (from)             params.set("from",   from);
  if (to)               params.set("to",     to);
  params.set("page",  String(page));
  params.set("limit", "50");

  const { data, isLoading, isError } = useQuery<WaitlistResponse>({
    queryKey: ["crm-waitlist", status, search, from, to, page],
    queryFn:  () => apiFetch(`/crm/admin/waitlist?${params}`),
    placeholderData: (prev) => prev,
  });

  const { data: chartData } = useQuery<{ days: ChartDay[] }>({
    queryKey: ["crm-waitlist-chart"],
    queryFn:  () => apiFetch("/crm/admin/waitlist/chart"),
    staleTime: 5 * 60_000,
  });

  // ── Mutations ──
  const patchStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/crm/admin/waitlist/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm-waitlist"] }),
  });

  const patchNotes = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      apiFetch(`/crm/admin/waitlist/${id}`, { method: "PATCH", body: JSON.stringify({ notes }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm-waitlist"] }),
  });

  const saveNote = useCallback(
    (id: string, notes: string) => patchNotes.mutateAsync({ id, notes }),
    [patchNotes]
  );

  const deleteEntry = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/crm/admin/waitlist/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-waitlist"] });
      qc.invalidateQueries({ queryKey: ["crm-waitlist-chart"] });
      setToDelete(null);
    },
  });

  // ── Handlers ──
  const clearFilters = useCallback(() => {
    setSearch(""); setStatus("all"); setFrom(""); setTo(""); setPage(1);
  }, []);

  const hasFilters = search || status !== "all" || from || to;

  async function handleExport() {
    setExporting(true);
    try {
      const ep = new URLSearchParams();
      if (status !== "all") ep.set("status", status);
      if (search) ep.set("search", search);
      if (from)   ep.set("from", from);
      if (to)     ep.set("to", to);
      const token = localStorage.getItem("crm_token");
      const resp  = await fetch(`/api/crm/admin/waitlist/export?${ep}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error("Export failed");
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement("a"), {
        href: url, download: `tolipai-waitlist-${new Date().toISOString().split("T")[0]}.csv`,
      });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) { alert(e.message); }
    finally { setExporting(false); }
  }

  const rows       = data?.rows       ?? [];
  const stats      = data?.stats      ?? { total: 0, last7days: 0, last30days: 0 };
  const totalPages = data?.totalPages ?? 1;
  const chartDays  = chartData?.days  ?? [];

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
            <Users2 className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Waitlist</h1>
            <p className="text-xs text-muted-foreground">Landing-page signups · {stats.total} total</p>
          </div>
        </div>
        <Button
          onClick={handleExport}
          disabled={exporting || !data?.total}
          variant="outline"
          className="gap-2 border-emerald-500/30 text-emerald-400 hover:text-emerald-300 hover:border-emerald-400/50"
        >
          {exporting
            ? <><Loader2 className="w-4 h-4 animate-spin" />Exporting…</>
            : <><Download className="w-4 h-4" />Export CSV</>}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Signups"  value={stats.total}      icon={Mail}       color="text-violet-400" />
        <StatCard label="Last 7 Days"    value={stats.last7days}  icon={Clock}      color="text-blue-400"   />
        <StatCard label="Last 30 Days"   value={stats.last30days} icon={TrendingUp} color="text-emerald-400"/>
      </div>

      {/* Growth Chart */}
      {chartDays.length > 0 && (
        <Card className="p-5 rounded-2xl border-white/5 bg-card">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
            Daily Signups — Last 30 Days
          </p>
          <ResponsiveContainer width="100%" height={140}>
            <AreaChart data={chartDays} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="wlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}    />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 10, fill: "#64748b" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 10,
                  fontSize: 12,
                  color: "hsl(var(--foreground))",
                }}
                itemStyle={{ color: "#a78bfa" }}
                cursor={{ stroke: "rgba(139,92,246,0.2)", strokeWidth: 1 }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#8b5cf6"
                strokeWidth={2}
                fill="url(#wlGrad)"
                dot={false}
                activeDot={{ r: 4, fill: "#8b5cf6" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Filters */}
      <Card className="p-4 rounded-2xl border-white/5 bg-card">
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search email, name, phone…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="pl-9 bg-background/50 border-white/10 focus:border-violet-500/50"
            />
          </div>
          <Select value={status} onValueChange={v => { setStatus(v); setPage(1); }}>
            <SelectTrigger className="w-36 bg-background/50 border-white/10 focus:border-violet-500/50">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_CYCLE.map(s => (
                <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex gap-2 items-center">
            <label className="text-xs text-muted-foreground whitespace-nowrap">From</label>
            <Input
              type="date" value={from}
              onChange={e => { setFrom(e.target.value); setPage(1); }}
              className="w-36 bg-background/50 border-white/10 text-sm"
            />
          </div>
          <div className="flex gap-2 items-center">
            <label className="text-xs text-muted-foreground whitespace-nowrap">To</label>
            <Input
              type="date" value={to}
              onChange={e => { setTo(e.target.value); setPage(1); }}
              className="w-36 bg-background/50 border-white/10 text-sm"
            />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-muted-foreground shrink-0">
              <X className="w-3.5 h-3.5" /> Clear
            </Button>
          )}
        </div>
        {data && (
          <p className="text-xs text-muted-foreground mt-3">
            Showing {rows.length} of <strong className="text-foreground">{data.total}</strong> result{data.total !== 1 ? "s" : ""}
            {hasFilters && <> · filtered</>}
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
            <p className="text-sm">Failed to load waitlist.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground">
            <Users2 className="w-10 h-10 opacity-20" />
            <p className="text-sm">{hasFilters ? "No results match your filters." : "No waitlist signups yet."}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 bg-secondary/30">
                  {["Email / Tag", "Name", "Phone", "Source", "Status", "Notes", "Joined", ""].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/4">
                {rows.map((row, i) => {
                  const tag    = autoTag(row.email);
                  const TagIcon = tag.icon;
                  const sm     = STATUS_META[row.status] ?? STATUS_META.pending;
                  const ns     = nextStatus(row.status);
                  const joining = row.created_at
                    ? format(new Date(row.created_at), "MMM d, yyyy")
                    : "—";

                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-secondary/30 transition-colors ${i % 2 === 0 ? "" : "bg-secondary/10"}`}
                    >
                      {/* Email + auto-tag */}
                      <td className="px-4 py-3">
                        <a
                          href={`mailto:${row.email}`}
                          className="text-violet-400 hover:text-violet-300 transition-colors text-sm truncate block max-w-[200px]"
                        >
                          {row.email}
                        </a>
                        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
                          <TagIcon className="w-3 h-3" />
                          {tag.label}
                        </span>
                      </td>

                      {/* Name */}
                      <td className="px-4 py-3 text-foreground whitespace-nowrap">
                        {row.name || <span className="text-muted-foreground">—</span>}
                      </td>

                      {/* Phone */}
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.phone
                          ? <a href={`tel:${row.phone}`} className="flex items-center gap-1 text-slate-300 hover:text-white transition-colors text-xs">
                              <Phone className="w-3 h-3" />{row.phone}
                            </a>
                          : <span className="text-muted-foreground text-xs">—</span>}
                      </td>

                      {/* Source */}
                      <td className="px-4 py-3">
                        <span className="text-xs text-muted-foreground">
                          {SOURCE_LABELS[row.source ?? ""] ?? row.source ?? "—"}
                        </span>
                      </td>

                      {/* Status — click to cycle */}
                      <td className="px-4 py-3">
                        <button
                          onClick={() => patchStatus.mutate({ id: row.id, status: ns })}
                          disabled={patchStatus.isPending}
                          title={`Click to set → ${STATUS_META[ns].label}`}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium transition-all hover:opacity-80 cursor-pointer ${sm.color}`}
                        >
                          {sm.label}
                          <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                        </button>
                      </td>

                      {/* Notes — click-to-edit, auto-save on blur */}
                      <td className="px-4 py-3">
                        <NoteCell
                          rowId={row.id}
                          initialNote={row.notes}
                          onSave={saveNote}
                        />
                      </td>

                      {/* Joined */}
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {joining}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-7 h-7 text-red-400/60 hover:text-red-400 hover:bg-red-500/10"
                            onClick={() => setToDelete(row)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
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
          <p className="text-muted-foreground text-xs">Page {page} of {totalPages}</p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="gap-1 h-8">
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
            </Button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const n = Math.max(1, Math.min(totalPages - 4, page - 2)) + i;
              return (
                <Button key={n} variant={n === page ? "default" : "outline"} size="sm" className="h-8 w-8 p-0 text-xs" onClick={() => setPage(n)}>
                  {n}
                </Button>
              );
            })}
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="gap-1 h-8">
              Next <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      <AlertDialog open={!!toDelete} onOpenChange={o => { if (!o) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this signup?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{toDelete?.email}</strong> will be permanently removed from the waitlist. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => toDelete && deleteEntry.mutate(toDelete.id)}
            >
              {deleteEntry.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <p className="text-xs text-muted-foreground text-center pb-2">
        Click any status badge to cycle it forward · Click any note to edit and auto-save · Signups auto-tagged by email domain
      </p>
    </div>
  );
}

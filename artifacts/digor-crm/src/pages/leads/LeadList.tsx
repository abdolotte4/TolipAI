import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { motion } from "framer-motion";
import { Search, Plus, MapPin, Phone, User, Filter, Clock, AlertTriangle, Trash2, Building2, Calendar, RefreshCw } from "lucide-react";
import { useCrmGetLeads, useCrmDeleteLead } from "@workspace/api-client-react";
import { useCampaignGovernance } from "@/hooks/use-campaign-governance";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 20;

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  contacted: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  qualified: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  negotiating: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  under_contract: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  closed: "bg-green-500/10 text-green-400 border-green-500/20",
  dead: "bg-red-500/10 text-red-400 border-red-500/20",
};

export default function LeadList() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; address: string } | null>(null);
  const [, setLocation] = useLocation();

  const handleSearch = (val: string) => {
    setSearch(val);
    setPage(1);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(val), 400);
  };

  const handleStatusFilter = (val: string) => { setStatusFilter(val); setPage(1); };

  const { data, isLoading, isError, refetch } = useCrmGetLeads({
    search: debouncedSearch || undefined,
    status: statusFilter || undefined,
    page,
    limit: PAGE_SIZE,
  });

  const totalPages = data?.total ? Math.ceil(data.total / PAGE_SIZE) : 1;
  const { canDeleteLeads, isSuperAdmin } = useCampaignGovernance();
  const deleteMutation = useCrmDeleteLead();
  const qc = useQueryClient();
  const { toast } = useToast();

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["/api/crm/leads"] });
          toast({ title: "Lead deleted" });
          setDeleteTarget(null);
        },
        onError: (e: any) => {
          toast({ title: "Delete failed", description: e.message, variant: "destructive" });
          setDeleteTarget(null);
        },
      }
    );
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold">All Leads</h1>
          <p className="text-muted-foreground mt-1">
            {data?.total != null ? `${data.total.toLocaleString()} total leads` : "Manage and track your properties"}
          </p>
        </div>
        <Link href="/leads/new">
          <Button className="rounded-xl px-6 bg-gradient-to-r from-primary to-accent hover:opacity-90 shadow-lg shadow-primary/20">
            <Plus className="w-4 h-4 mr-2" /> New Lead
          </Button>
        </Link>
      </div>

      <Card className="p-4 rounded-2xl border-white/5 bg-card shadow-lg flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search by name, address, or phone..." 
            className="pl-9 bg-background/50 border-white/10 rounded-xl"
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <select 
            className="h-9 px-3 rounded-xl bg-background/50 border border-white/10 text-sm focus:outline-none focus:border-primary"
            value={statusFilter}
            onChange={(e) => handleStatusFilter(e.target.value)}
          >
            <option value="">All Statuses</option>
            <option value="new">New</option>
            <option value="contacted">Contacted</option>
            <option value="qualified">Qualified</option>
            <option value="negotiating">Negotiating</option>
            <option value="under_contract">Under Contract</option>
            <option value="closed">Closed</option>
            <option value="dead">Dead</option>
          </select>
        </div>
      </Card>

      {isError ? (
        <div className="text-center py-20 bg-card rounded-2xl border border-white/5">
          <AlertTriangle className="w-10 h-10 text-destructive mx-auto mb-3" />
          <h3 className="text-lg font-medium text-foreground">Could not load leads</h3>
          <p className="text-muted-foreground mt-1 text-sm mb-4">Check your connection and try again.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Retry
          </Button>
        </div>
      ) : isLoading ? (
        <div className="space-y-4">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-card rounded-2xl animate-pulse"></div>)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {data?.leads.map((lead) => {
            const createdDate = new Date((lead as any).createdAt);
            const updatedDate = new Date((lead as any).updatedAt || (lead as any).createdAt);
            const daysSinceUpdate = Math.floor((Date.now() - updatedDate.getTime()) / 86400000);
            const createdLabel = createdDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            const updatedLabel = daysSinceUpdate < 1 ? "today" : daysSinceUpdate === 1 ? "yesterday" : `${daysSinceUpdate}d ago`;
            const statusClass = STATUS_COLORS[lead.status] ?? "bg-secondary text-muted-foreground border-border";

            return (
              <motion.div
                key={lead.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.15 }}
                className="relative group"
              >
                <Link href={`/leads/${lead.id}`}>
                  <Card className="p-0 rounded-2xl border-white/5 bg-card hover:bg-secondary/40 transition-colors cursor-pointer group shadow-sm hover:shadow-md">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center p-5 gap-5">
                      <div className="flex-1 space-y-3 w-full">
                        <div className="flex justify-between items-start">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-display font-semibold text-lg text-foreground group-hover:text-primary transition-colors truncate pr-2">
                              {lead.address}
                            </h3>
                            <div className="flex items-center text-sm text-muted-foreground mt-1 gap-4 flex-wrap">
                              <span className="flex items-center"><User className="w-3.5 h-3.5 mr-1.5"/> {lead.sellerName}</span>
                              {lead.phone && <span className="flex items-center"><Phone className="w-3.5 h-3.5 mr-1.5"/> {lead.phone}</span>}
                              {lead.city && <span className="flex items-center"><MapPin className="w-3.5 h-3.5 mr-1.5"/> {lead.city}, {lead.state}</span>}
                              {isSuperAdmin && (lead as any).campaignName && (
                                <span className="flex items-center gap-1 text-xs text-primary/80 bg-primary/10 border border-primary/20 px-2 py-0.5 rounded-full">
                                  <Building2 className="w-3 h-3" />{(lead as any).campaignName}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-4 mt-1.5 flex-wrap">
                              <span className="flex items-center gap-1 text-xs text-muted-foreground/55">
                                <Calendar className="w-3 h-3" />
                                Submitted {createdLabel}
                              </span>
                              {(lead as any).updatedAt && (lead as any).updatedAt !== (lead as any).createdAt && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground/55">
                                  <RefreshCw className="w-3 h-3" />
                                  Updated {updatedLabel}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            {daysSinceUpdate >= 14 && (
                              <span className="flex items-center gap-1 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-full">
                                <AlertTriangle className="w-3 h-3" />{daysSinceUpdate}d
                              </span>
                            )}
                            {daysSinceUpdate >= 7 && daysSinceUpdate < 14 && (
                              <span className="flex items-center gap-1 text-xs text-orange-400 bg-orange-500/10 border border-orange-500/20 px-2 py-0.5 rounded-full">
                                <Clock className="w-3 h-3" />{daysSinceUpdate}d
                              </span>
                            )}
                            <Badge variant="outline" className={`capitalize px-3 py-1 ${statusClass}`}>
                              {lead.status.replace("_", " ")}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      <div className="w-full sm:w-auto flex sm:flex-col justify-between sm:items-end gap-2 sm:gap-1 bg-background/50 sm:bg-transparent p-3 sm:p-0 rounded-xl sm:rounded-none border sm:border-none border-border">
                        <div className="text-xs text-muted-foreground uppercase tracking-wider">Est. Value</div>
                        <div className="font-semibold text-emerald-400">
                          {lead.arv ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(lead.arv) : "TBD"}
                        </div>
                      </div>
                    </div>
                  </Card>
                </Link>

                {canDeleteLeads && (
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleteTarget({ id: lead.id, address: lead.address });
                    }}
                    className="absolute top-3 right-3 p-1.5 rounded-lg text-muted-foreground/0 group-hover:text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                    title="Delete lead"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </motion.div>
            );
          })}
          {data?.leads.length === 0 && (
            <div className="text-center py-20 bg-card rounded-2xl border border-white/5">
              <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
                <Search className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium text-foreground">No leads found</h3>
              <p className="text-muted-foreground mt-1">Try adjusting your filters or search term.</p>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages} &nbsp;·&nbsp; {data?.total?.toLocaleString()} leads
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl border-white/10"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
            >
              ← Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl border-white/10"
              disabled={page >= totalPages}
              onClick={() => setPage(p => p + 1)}
            >
              Next →
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent className="bg-card border-white/10 rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Lead</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to permanently delete <strong className="text-foreground">{deleteTarget?.address}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 hover:bg-secondary">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={handleConfirmDelete}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete Lead"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

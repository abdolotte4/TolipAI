import { useState } from "react";
import { useLocation } from "wouter";
import { motion } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import { useCrmGetLeads, useCrmUpdateLead, useCrmDeleteLead } from "@workspace/api-client-react";
import { useCampaignGovernance } from "@/hooks/use-campaign-governance";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { GripVertical, Phone, Mail, Clock, AlertTriangle, Trash2 } from "lucide-react";
import { differenceInDays } from "date-fns";
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

const COLUMNS = [
  { id: "new",            label: "New",            color: "bg-slate-500" },
  { id: "contacted",      label: "Contacted",       color: "bg-blue-500" },
  { id: "qualified",      label: "Qualified",       color: "bg-purple-500" },
  { id: "negotiating",    label: "Negotiating",     color: "bg-orange-500" },
  { id: "under_contract", label: "Under Contract",  color: "bg-yellow-500" },
  { id: "closed",         label: "Closed",          color: "bg-green-500" },
  { id: "dead",           label: "Dead",            color: "bg-red-400" },
];

function fmt$(v: any) {
  if (!v) return null;
  return "$" + Number(v).toLocaleString();
}

function AgingBadge({ date }: { date: string }) {
  const days = differenceInDays(new Date(), new Date(date));
  if (days < 3) return null;
  const color = days >= 14 ? "bg-red-100 text-red-700 border-red-200"
    : days >= 7 ? "bg-orange-100 text-orange-700 border-orange-200"
    : "bg-yellow-100 text-yellow-700 border-yellow-200";
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border ${color}`}>
      <Clock className="w-3 h-3" />
      {days}d
    </span>
  );
}

function LeadCard({
  lead,
  isDragging = false,
  canDelete,
  onDelete,
}: {
  lead: any;
  isDragging?: boolean;
  canDelete: boolean;
  onDelete: (lead: any) => void;
}) {
  const [, setLocation] = useLocation();
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: lead.id.toString() });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <Card
        className={`p-3 mb-2 cursor-pointer hover:shadow-md transition-shadow select-none ${isDragging ? "shadow-lg ring-2 ring-primary/30 rotate-1" : ""}`}
        onClick={() => setLocation(`/leads/${lead.id}`)}
      >
        <div className="flex items-start gap-2">
          <div
            {...listeners}
            className="mt-0.5 text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing flex-shrink-0"
            onClick={e => e.stopPropagation()}
          >
            <GripVertical className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1 mb-1">
              <p className="font-semibold text-sm truncate">{lead.sellerName}</p>
              <div className="flex items-center gap-1 flex-shrink-0">
                <AgingBadge date={lead.updatedAt || lead.createdAt} />
                {canDelete && (
                  <button
                    className="p-0.5 text-muted-foreground/30 hover:text-destructive transition-colors rounded"
                    onClick={e => { e.stopPropagation(); onDelete(lead); }}
                    title="Delete lead"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <p className="text-xs text-muted-foreground truncate mb-1.5">{lead.address}</p>
            {(lead.phone || lead.email) && (
              <div className="flex gap-2 text-xs text-muted-foreground mb-1.5">
                {lead.phone && <span className="flex items-center gap-0.5"><Phone className="w-3 h-3" />{lead.phone}</span>}
                {lead.email && <span className="flex items-center gap-0.5 truncate"><Mail className="w-3 h-3" />{lead.email}</span>}
              </div>
            )}
            <div className="flex items-center justify-between">
              {lead.mao ? (
                <span className="text-xs font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded">
                  MAO {fmt$(lead.mao)}
                </span>
              ) : lead.askingPrice ? (
                <span className="text-xs text-muted-foreground">
                  Ask {fmt$(lead.askingPrice)}
                </span>
              ) : (
                <span />
              )}
              {lead.leadSource && (
                <span className="text-xs text-muted-foreground/70 truncate max-w-[80px]">{lead.leadSource}</span>
              )}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function Pipeline() {
  const { data: leadsData, isLoading } = useCrmGetLeads({ limit: 500 });
  const leads: any[] = (leadsData as any)?.leads || [];
  const { canDeleteLeads } = useCampaignGovernance();
  const updateLead = useCrmUpdateLead();
  const deleteLead = useCrmDeleteLead();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; sellerName: string; address: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const leadsByStatus: Record<string, any[]> = {};
  COLUMNS.forEach(col => { leadsByStatus[col.id] = []; });
  leads.forEach((lead: any) => {
    const col = leadsByStatus[lead.status];
    if (col) col.push(lead);
    else if (leadsByStatus["new"]) leadsByStatus["new"].push(lead);
  });

  const activeLead = activeId ? leads.find((l: any) => l.id.toString() === activeId) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const leadId = parseInt(active.id as string);
    const lead = leads.find((l: any) => l.id === leadId);
    if (!lead) return;

    let newStatus = over.id as string;
    const isColumn = COLUMNS.some(c => c.id === newStatus);
    if (!isColumn) {
      const overLead = leads.find((l: any) => l.id.toString() === newStatus);
      if (overLead) newStatus = overLead.status;
      else return;
    }

    if (newStatus === lead.status) return;

    queryClient.setQueryData(["crm", "leads", {}], (old: any[]) =>
      (old || []).map((l: any) => l.id === leadId ? { ...l, status: newStatus } : l)
    );

    try {
      await updateLead.mutateAsync({ id: leadId, data: { status: newStatus } as any });
      toast({ title: `Lead moved to ${COLUMNS.find(c => c.id === newStatus)?.label}` });
    } catch {
      queryClient.invalidateQueries({ queryKey: ["crm", "leads"] });
      toast({ title: "Failed to update lead", variant: "destructive" });
    }
  }

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    deleteLead.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="h-full flex flex-col"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Pipeline</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {leads.length} lead{leads.length !== 1 ? "s" : ""} · Drag cards to move through stages
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
          <span className="text-orange-600">7d+ no update</span>
          <AlertTriangle className="w-3.5 h-3.5 text-red-400 ml-2" />
          <span className="text-red-600">14d+ no update</span>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4 flex-1">
          {COLUMNS.map(col => {
            const colLeads = leadsByStatus[col.id] || [];
            return (
              <SortableContext
                key={col.id}
                id={col.id}
                items={colLeads.map((l: any) => l.id.toString())}
                strategy={verticalListSortingStrategy}
              >
                <div
                  className="flex-shrink-0 w-64 flex flex-col"
                  style={{ minHeight: "200px" }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                    <span className="text-sm font-semibold text-foreground">{col.label}</span>
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {colLeads.length}
                    </Badge>
                  </div>

                  <div
                    className="flex-1 rounded-xl bg-secondary/30 p-2 min-h-[120px]"
                    data-column-id={col.id}
                  >
                    {colLeads.length === 0 && (
                      <div className="flex items-center justify-center h-20 text-xs text-muted-foreground/50 italic">
                        Drop here
                      </div>
                    )}
                    {colLeads.map((lead: any) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        canDelete={canDeleteLeads}
                        onDelete={(l) => setDeleteTarget({ id: l.id, sellerName: l.sellerName, address: l.address })}
                      />
                    ))}
                  </div>
                </div>
              </SortableContext>
            );
          })}
        </div>

        <DragOverlay>
          {activeLead ? (
            <div className="w-64">
              <LeadCard
                lead={activeLead}
                isDragging
                canDelete={false}
                onDelete={() => {}}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

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
              {deleteLead.isPending ? "Deleting..." : "Delete Lead"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

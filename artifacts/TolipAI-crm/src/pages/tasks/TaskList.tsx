import { useState } from "react";
import { format, isPast, isWithinInterval, addHours } from "date-fns";
import {
  CheckSquare, Circle, Clock, CheckCircle2, Plus, X, AlertTriangle, Zap,
  User, Calendar, Flag, ChevronDown, Loader2
} from "lucide-react";
import { useCrmGetTasks, useCrmUpdateTask, useCrmCreateTask, useCrmGetUsers } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCampaignGovernance } from "@/hooks/use-campaign-governance";

function DueBadge({ dueDate, status }: { dueDate: string | null; status: string }) {
  if (!dueDate || status === "completed") return null;
  const d = new Date(dueDate);
  const now = new Date();
  const isOverdue = isPast(d);
  const isDueSoon = !isOverdue && isWithinInterval(d, { start: now, end: addHours(now, 24) });

  if (isOverdue) {
    return (
      <span className="flex items-center text-red-400 font-semibold text-xs">
        <AlertTriangle className="w-3 h-3 mr-1" />
        Overdue · {format(d, "MMM d")}
      </span>
    );
  }
  if (isDueSoon) {
    return (
      <span className="flex items-center text-amber-400 font-semibold text-xs">
        <Clock className="w-3 h-3 mr-1" />
        Due soon · {format(d, "MMM d, h:mm a")}
      </span>
    );
  }
  return (
    <span className="flex items-center text-muted-foreground text-xs">
      <Calendar className="w-3 h-3 mr-1" />
      Due {format(d, "MMM d, yyyy")}
    </span>
  );
}

function PriorityBadge({ priority }: { priority?: string }) {
  if (!priority || priority === "normal") return null;
  return (
    <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] px-1.5 py-0 h-4 font-semibold">
      <Flag className="w-2.5 h-2.5 mr-1" /> HIGH
    </Badge>
  );
}

function SourceBadge({ source }: { source?: string }) {
  if (!source || source === "manual") return null;
  return (
    <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20 text-[10px] px-1.5 py-0 h-4 font-semibold">
      <Zap className="w-2.5 h-2.5 mr-1" /> AUTO
    </Badge>
  );
}

interface CreateTaskForm {
  title: string;
  description: string;
  dueDate: string;
  priority: string;
  assignedTo: string;
}

export default function TaskList() {
  const [filter, setFilter] = useState<string>("pending");
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateTaskForm>({
    title: "", description: "", dueDate: "", priority: "normal", assignedTo: "",
  });

  const queryClient = useQueryClient();
  const { me, isSuperAdmin } = useCampaignGovernance();
  const isAdmin = isSuperAdmin || me?.role === "admin";

  const { data: tasks, isLoading } = useCrmGetTasks({ status: filter === "all" ? undefined : filter === "overdue" ? "pending" : filter } as any);
  const { data: usersData } = useCrmGetUsers() as any;
  const updateMutation = useCrmUpdateTask();
  const createMutation = useCrmCreateTask();

  const allUsers: any[] = usersData?.users ?? usersData ?? [];

  const displayedTasks = (() => {
    if (!tasks) return [];
    if (filter === "overdue") {
      return tasks.filter((t: any) => t.status === "pending" && t.dueDate && isPast(new Date(t.dueDate)));
    }
    return tasks;
  })();

  const overdueCount = tasks?.filter((t: any) => t.status === "pending" && t.dueDate && isPast(new Date(t.dueDate))).length ?? 0;

  const toggleStatus = (task: any) => {
    const newStatus = task.status === "pending" ? "completed" : "pending";
    updateMutation.mutate(
      { id: task.id, data: { status: newStatus } as any },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/crm/tasks"] }) }
    );
  };

  const handleCreate = () => {
    if (!form.title.trim()) return;
    createMutation.mutate(
      {
        data: {
          title: form.title,
          description: form.description || undefined,
          dueDate: form.dueDate || undefined,
          priority: form.priority,
          assignedTo: form.assignedTo ? parseInt(form.assignedTo) : undefined,
        } as any,
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/crm/tasks"] });
          setShowCreate(false);
          setForm({ title: "", description: "", dueDate: "", priority: "normal", assignedTo: "" });
        },
      }
    );
  };

  const filterTabs = [
    { key: "pending", label: "Pending" },
    { key: "overdue", label: "Overdue", count: overdueCount },
    { key: "completed", label: "Completed" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="max-w-5xl mx-auto pb-10">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Task Management</h1>
          <p className="text-muted-foreground mt-1">Follow-ups, action items, and automated tasks.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors"
        >
          <Plus className="w-4 h-4" /> New Task
        </button>
      </div>

      <div className="flex bg-secondary p-1 rounded-xl border border-white/5 mb-6 w-fit">
        {filterTabs.map(tab => (
          <button
            key={tab.key}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${filter === tab.key ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setFilter(tab.key)}
          >
            {tab.label}
            {tab.count ? (
              <span className="bg-red-500/20 text-red-400 text-xs px-1.5 py-0 rounded-full font-bold min-w-[18px] text-center">
                {tab.count}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {isLoading ? (
          [1, 2, 3].map(i => <div key={i} className="h-20 bg-card rounded-2xl animate-pulse" />)
        ) : displayedTasks.length === 0 ? (
          <div className="text-center py-20 bg-card rounded-2xl border border-white/5">
            <CheckSquare className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-foreground">No tasks found</h3>
            <p className="text-muted-foreground">
              {filter === "overdue" ? "No overdue tasks. Great work!" : "You're all caught up!"}
            </p>
          </div>
        ) : (
          displayedTasks.map((task: any) => {
            const isOverdue = task.dueDate && isPast(new Date(task.dueDate)) && task.status === "pending";
            return (
              <Card
                key={task.id}
                className={`p-5 rounded-2xl border-white/5 bg-card hover:bg-secondary/40 transition-colors flex items-start gap-4 shadow-sm ${isOverdue ? "border-red-500/20" : ""}`}
              >
                <button
                  onClick={() => toggleStatus(task)}
                  disabled={updateMutation.isPending}
                  className="mt-0.5 text-muted-foreground hover:text-primary transition-colors flex-shrink-0"
                >
                  {task.status === "completed" ? (
                    <CheckCircle2 className="w-6 h-6 text-primary" />
                  ) : (
                    <Circle className="w-6 h-6" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <p className={`font-medium text-base ${task.status === "completed" ? "line-through text-muted-foreground" : "text-foreground"}`}>
                      {task.title}
                    </p>
                    <PriorityBadge priority={task.priority} />
                    <SourceBadge source={task.source} />
                    {task.escalated && (
                      <Badge className="bg-red-500/10 text-red-400 border-red-500/20 text-[10px] px-1.5 py-0 h-4 font-semibold">
                        <AlertTriangle className="w-2.5 h-2.5 mr-1" /> ESCALATED
                      </Badge>
                    )}
                  </div>
                  {task.description && (
                    <p className="text-sm text-muted-foreground mb-2 line-clamp-1">{task.description}</p>
                  )}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    {task.leadId && task.leadAddress && (
                      <Link href={`/leads/${task.leadId}`} className="text-primary hover:underline flex items-center text-xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-primary/60 mr-1.5" />
                        {task.leadAddress}
                      </Link>
                    )}
                    {task.assignedToName && (
                      <span className="flex items-center text-xs text-muted-foreground">
                        <User className="w-3 h-3 mr-1" />
                        {task.assignedToName}
                      </span>
                    )}
                    <DueBadge dueDate={task.dueDate} status={task.status} />
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-white/10 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between p-6 border-b border-white/5">
              <h2 className="text-lg font-display font-bold">New Task</h2>
              <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Title *</label>
                <input
                  className="w-full bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary/50"
                  placeholder="e.g. Call seller back"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Description</label>
                <textarea
                  className="w-full bg-background border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-primary/50 resize-none"
                  rows={2}
                  placeholder="Optional details..."
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Due Date</label>
                  <input
                    type="datetime-local"
                    className="w-full bg-background border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary/50"
                    value={form.dueDate}
                    onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Priority</label>
                  <div className="relative">
                    <select
                      className="w-full bg-background border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary/50 appearance-none pr-8"
                      value={form.priority}
                      onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                    >
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              </div>

              {isAdmin && allUsers.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Assign To</label>
                  <div className="relative">
                    <select
                      className="w-full bg-background border border-white/10 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary/50 appearance-none pr-8"
                      value={form.assignedTo}
                      onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}
                    >
                      <option value="">Unassigned</option>
                      {allUsers.map((u: any) => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 p-6 border-t border-white/5">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 bg-secondary hover:bg-secondary/80 text-foreground px-4 py-2.5 rounded-xl font-medium text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!form.title.trim() || createMutation.isPending}
                className="flex-1 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2"
              >
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create Task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

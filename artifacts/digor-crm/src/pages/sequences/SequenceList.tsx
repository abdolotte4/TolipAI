import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Mail, ChevronDown, ChevronRight, Edit2, Check, X, Clock
} from "lucide-react";


type Step = { id: number; sequenceId: number; dayOffset: number; subject: string; body: string };
type Sequence = { id: number; name: string; description: string | null; isActive: boolean; steps: Step[]; createdAt: string };

function StepEditor({
  step,
  sequenceId,
  onDelete,
}: {
  step: Step;
  sequenceId: number;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ dayOffset: step.dayOffset, subject: step.subject, body: step.body });
  const { toast } = useToast();
  const qc = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: () => apiFetch(`/sequences/${sequenceId}/steps/${step.id}`, {
      method: "PATCH",
      body: JSON.stringify(form),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-sequences"] });
      setEditing(false);
      toast({ title: "Step updated" });
    },
    onError: (err: any) => toast({ title: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/sequences/${sequenceId}/steps/${step.id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-sequences"] });
      onDelete();
    },
    onError: (err: any) => toast({ title: err.message, variant: "destructive" }),
  });

  if (!editing) {
    return (
      <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50 group">
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold text-xs flex-shrink-0 mt-0.5">
          D{step.dayOffset}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{step.subject}</p>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{step.body}</p>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(true)}>
            <Edit2 className="w-3.5 h-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => deleteMutation.mutate()}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 space-y-3">
      <div className="flex gap-3">
        <div className="w-28">
          <Label className="text-xs">Day After Lead Created</Label>
          <Input
            type="number"
            min={0}
            value={form.dayOffset}
            onChange={e => setForm(f => ({ ...f, dayOffset: parseInt(e.target.value) || 0 }))}
            className="mt-1 h-8 text-sm"
          />
        </div>
        <div className="flex-1">
          <Label className="text-xs">Subject</Label>
          <Input
            value={form.subject}
            onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            className="mt-1 h-8 text-sm"
            placeholder="Subject line..."
          />
        </div>
      </div>
      <div>
        <Label className="text-xs">Email Body (use {"{{"} name {"}}"}  or {"{{"} address {"}}"}  as variables)</Label>
        <Textarea
          value={form.body}
          onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          className="mt-1 text-sm resize-none"
          rows={4}
          placeholder="Hi {{name}}, ..."
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          <Check className="w-3.5 h-3.5 mr-1" /> Save
        </Button>
        <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
          <X className="w-3.5 h-3.5 mr-1" /> Cancel
        </Button>
      </div>
    </div>
  );
}

function NewStepForm({ sequenceId, onCreated }: { sequenceId: number; onCreated: () => void }) {
  const [form, setForm] = useState({ dayOffset: 1, subject: "", body: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => apiFetch(`/sequences/${sequenceId}/steps`, {
      method: "POST",
      body: JSON.stringify(form),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-sequences"] });
      setForm({ dayOffset: 1, subject: "", body: "" });
      onCreated();
      toast({ title: "Step added" });
    },
    onError: (err: any) => toast({ title: err.message, variant: "destructive" }),
  });

  return (
    <div className="p-3 rounded-lg border border-dashed border-border space-y-3 mt-2">
      <p className="text-xs font-medium text-muted-foreground">New Step</p>
      <div className="flex gap-3">
        <div className="w-28">
          <Label className="text-xs">Day Offset</Label>
          <Input
            type="number"
            min={0}
            value={form.dayOffset}
            onChange={e => setForm(f => ({ ...f, dayOffset: parseInt(e.target.value) || 0 }))}
            className="mt-1 h-8 text-sm"
          />
        </div>
        <div className="flex-1">
          <Label className="text-xs">Subject</Label>
          <Input
            value={form.subject}
            onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            className="mt-1 h-8 text-sm"
            placeholder="Subject line..."
          />
        </div>
      </div>
      <div>
        <Label className="text-xs">Body</Label>
        <Textarea
          value={form.body}
          onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          className="mt-1 text-sm resize-none"
          rows={3}
          placeholder="Hi {{name}}, we'd love to make an offer on your property at {{address}}..."
        />
      </div>
      <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.subject || !form.body}>
        <Plus className="w-3.5 h-3.5 mr-1" /> Add Step
      </Button>
    </div>
  );
}

function SequenceCard({ seq }: { seq: Sequence }) {
  const [expanded, setExpanded] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameForm, setNameForm] = useState({ name: seq.name, description: seq.description || "" });
  const [showNewStep, setShowNewStep] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiFetch(`/sequences/${seq.id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["crm-sequences"] }); setEditingName(false); toast({ title: "Sequence updated" }); },
    onError: (err: any) => toast({ title: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/sequences/${seq.id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["crm-sequences"] }); toast({ title: "Sequence deleted" }); },
    onError: (err: any) => toast({ title: err.message, variant: "destructive" }),
  });

  return (
    <Card className="overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 flex-shrink-0">
            <Mail className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="space-y-2">
                <Input value={nameForm.name} onChange={e => setNameForm(f => ({ ...f, name: e.target.value }))}
                  className="h-8 text-sm font-medium" placeholder="Sequence name" />
                <Input value={nameForm.description} onChange={e => setNameForm(f => ({ ...f, description: e.target.value }))}
                  className="h-7 text-xs" placeholder="Description (optional)" />
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs" onClick={() => updateMutation.mutate(nameForm)}>Save</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingName(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{seq.name}</p>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingName(true)}>
                    <Edit2 className="w-3 h-3" />
                  </Button>
                </div>
                {seq.description && <p className="text-sm text-muted-foreground">{seq.description}</p>}
              </>
            )}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{seq.isActive ? "Active" : "Paused"}</span>
              <Switch
                checked={seq.isActive}
                onCheckedChange={v => updateMutation.mutate({ isActive: v })}
              />
            </div>
            <Badge variant="secondary" className="text-xs">
              <Clock className="w-3 h-3 mr-1" />
              {seq.steps.length} step{seq.steps.length !== 1 ? "s" : ""}
            </Badge>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={() => { if (confirm("Delete this sequence?")) deleteMutation.mutate(); }}>
              <Trash2 className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setExpanded(e => !e)}>
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t pt-3 space-y-2">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Email Steps</p>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowNewStep(s => !s)}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Step
                </Button>
              </div>

              {seq.steps.length === 0 && !showNewStep && (
                <p className="text-sm text-muted-foreground italic text-center py-4">
                  No steps yet. Add the first email step above.
                </p>
              )}

              {seq.steps.map(step => (
                <StepEditor
                  key={step.id}
                  step={step}
                  sequenceId={seq.id}
                  onDelete={() => qc.invalidateQueries({ queryKey: ["crm-sequences"] })}
                />
              ))}

              {showNewStep && (
                <NewStepForm sequenceId={seq.id} onCreated={() => setShowNewStep(false)} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

export default function SequenceList() {
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", description: "" });
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: sequences = [], isLoading } = useQuery<Sequence[]>({
    queryKey: ["crm-sequences"],
    queryFn: () => apiFetch("/sequences"),
  });

  const createMutation = useMutation({
    mutationFn: () => apiFetch("/sequences", { method: "POST", body: JSON.stringify(newForm) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-sequences"] });
      setNewForm({ name: "", description: "" });
      setShowNew(false);
      toast({ title: "Sequence created" });
    },
    onError: (err: any) => toast({ title: err.message, variant: "destructive" }),
  });

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Email Sequences</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automated follow-up emails sent to leads based on how many days since they were created.
            Use <code className="bg-secondary px-1 rounded text-xs">{"{{name}}"}</code> and{" "}
            <code className="bg-secondary px-1 rounded text-xs">{"{{address}}"}</code> as variables.
          </p>
        </div>
        <Button onClick={() => setShowNew(s => !s)}>
          <Plus className="w-4 h-4 mr-2" /> New Sequence
        </Button>
      </div>

      <AnimatePresence>
        {showNew && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <Card className="p-4 space-y-3 border-primary/30">
              <p className="font-semibold">New Email Sequence</p>
              <div>
                <Label>Name</Label>
                <Input value={newForm.name} onChange={e => setNewForm(f => ({ ...f, name: e.target.value }))}
                  className="mt-1" placeholder="e.g. New Lead Follow-Up" />
              </div>
              <div>
                <Label>Description (optional)</Label>
                <Input value={newForm.description} onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))}
                  className="mt-1" placeholder="What is this sequence for?" />
              </div>
              <div className="flex gap-2">
                <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending || !newForm.name}>
                  Create Sequence
                </Button>
                <Button variant="outline" onClick={() => setShowNew(false)}>Cancel</Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" />
        </div>
      ) : sequences.length === 0 ? (
        <div className="text-center py-16">
          <Mail className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-semibold text-foreground">No sequences yet</p>
          <p className="text-sm text-muted-foreground mt-1">Create your first email sequence to start automated follow-ups.</p>
          <Button className="mt-4" onClick={() => setShowNew(true)}>
            <Plus className="w-4 h-4 mr-2" /> Create Sequence
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {sequences.map(seq => <SequenceCard key={seq.id} seq={seq} />)}
        </div>
      )}
    </motion.div>
  );
}

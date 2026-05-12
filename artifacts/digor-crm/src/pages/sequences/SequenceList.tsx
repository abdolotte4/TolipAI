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
  Plus, Trash2, Mail, MessageSquare, Package, ChevronDown, ChevronRight,
  Edit2, Check, X, Clock, Bot,
} from "lucide-react";

type StepType = "email" | "sms" | "direct_mail" | "ai_sms";

type Step = {
  id: number;
  sequenceId: number;
  dayOffset: number;
  type: StepType;
  subject: string;
  body: string;
};

type Sequence = {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  steps: Step[];
  createdAt: string;
};

const STEP_TYPE_META: Record<StepType, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  email: { label: "Email", icon: Mail, color: "text-blue-500" },
  sms: { label: "SMS", icon: MessageSquare, color: "text-green-500" },
  direct_mail: { label: "Direct Mail", icon: Package, color: "text-orange-500" },
  ai_sms: { label: "AI SMS", icon: Bot, color: "text-purple-500" },
};

function StepTypeBadge({ type }: { type: StepType }) {
  const meta = STEP_TYPE_META[type] || STEP_TYPE_META.email;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${meta.color}`}>
      <Icon className="w-3 h-3" /> {meta.label}
    </span>
  );
}

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
  const [form, setForm] = useState({
    dayOffset: step.dayOffset,
    type: step.type || "email",
    subject: step.subject,
    body: step.body,
  });
  const { toast } = useToast();
  const qc = useQueryClient();
  const stepType = (form.type || "email") as StepType;
  const bodyLabel =
    stepType === "email" ? "Email Body (use {{name}}, {{address}}, {{city}}, {{state}} as variables)" :
    stepType === "sms" ? `SMS Message (${form.body.length}/160 chars — ${Math.ceil(form.body.length / 160)} segment${form.body.length > 160 ? "s" : ""})` :
    stepType === "ai_sms" ? "Goal / Prompt Override for AI (optional — leave blank to let the AI reply naturally)" :
    "Letter Body / Postcard Text";

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
          <div className="flex items-center gap-2 mb-0.5">
            <StepTypeBadge type={step.type || "email"} />
            {(step.type === "email" || !step.type) && (
              <p className="text-sm font-medium truncate">{step.subject}</p>
            )}
            {step.type === "direct_mail" && step.subject && (
              <p className="text-xs text-muted-foreground">Template #{step.subject}</p>
            )}
          </div>
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
      {/* Row 1: Day + Type */}
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
          <Label className="text-xs">Step Type</Label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {(["email", "sms", "direct_mail", "ai_sms"] as StepType[]).map(t => {
              const meta = STEP_TYPE_META[t];
              const Icon = meta.icon;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, type: t }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors ${
                    form.type === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Subject — email only; templateId — direct_mail */}
      {stepType === "email" && (
        <div>
          <Label className="text-xs">Subject</Label>
          <Input
            value={form.subject}
            onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            className="mt-1 h-8 text-sm"
            placeholder="Subject line..."
          />
        </div>
      )}

      {stepType === "direct_mail" && (
        <div>
          <Label className="text-xs">Brevo Template ID</Label>
          <Input
            value={form.subject}
            onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            className="mt-1 h-8 text-sm font-mono"
            placeholder="e.g. 42"
          />
        </div>
      )}

      {/* Body */}
      <div>
        <Label className="text-xs">{bodyLabel}</Label>
        <Textarea
          value={form.body}
          onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          className="mt-1 text-sm resize-none"
          rows={stepType === "sms" ? 3 : stepType === "ai_sms" ? 2 : 4}
          placeholder={
            stepType === "email" ? "Hi {{name}}, ..." :
            stepType === "sms" ? "Hi {{name}}, we're interested in your property at {{address}}..." :
            stepType === "ai_sms" ? "e.g. Try to schedule a showing. Mention we pay cash and close fast. (leave blank for default AI behaviour)" :
            "Dear {{name}},\n\nWe are interested in purchasing your property at {{address}} in {{city}}, {{state}}..."
          }
          maxLength={stepType === "sms" ? 1600 : stepType === "ai_sms" ? 500 : undefined}
        />
        {stepType === "ai_sms" && (
          <p className="text-[11px] mt-1 text-purple-400">
            AI SMS sends a context-aware reply generated by AI (~$0.005/message). Requires Twilio + AI SMS enabled on the campaign.
          </p>
        )}
        {stepType === "sms" && form.body.length > 140 && (
          <p className={`text-[11px] mt-1 ${form.body.length > 160 ? "text-orange-500" : "text-muted-foreground"}`}>
            {form.body.length > 160
              ? `${Math.ceil(form.body.length / 153)} segments (~$${(Math.ceil(form.body.length / 153) * 0.0079).toFixed(4)} per send)`
              : `${160 - form.body.length} chars remaining in 1 segment`}
          </p>
        )}
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
  const [form, setForm] = useState<{ dayOffset: number; type: StepType; subject: string; body: string }>({
    dayOffset: 1,
    type: "email",
    subject: "",
    body: "",
  });
  const { toast } = useToast();
  const qc = useQueryClient();
  const stepType = form.type;

  const mutation = useMutation({
    mutationFn: () => apiFetch(`/sequences/${sequenceId}/steps`, {
      method: "POST",
      body: JSON.stringify(form),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-sequences"] });
      setForm({ dayOffset: 1, type: "email", subject: "", body: "" });
      onCreated();
      toast({ title: "Step added" });
    },
    onError: (err: any) => toast({ title: err.message, variant: "destructive" }),
  });

  const canSubmit = (stepType === "ai_sms" || form.body.trim()) &&
    (stepType !== "email" || form.subject.trim()) &&
    !mutation.isPending;

  return (
    <div className="p-3 rounded-lg border border-dashed border-border space-y-3 mt-2">
      <p className="text-xs font-medium text-muted-foreground">New Step</p>

      {/* Day + Type */}
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
          <Label className="text-xs">Step Type</Label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {(["email", "sms", "direct_mail", "ai_sms"] as StepType[]).map(t => {
              const meta = STEP_TYPE_META[t];
              const Icon = meta.icon;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, type: t }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium border transition-colors ${
                    form.type === t
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Subject / Template ID */}
      {stepType === "email" && (
        <div>
          <Label className="text-xs">Subject</Label>
          <Input
            value={form.subject}
            onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            className="mt-1 h-8 text-sm"
            placeholder="Subject line..."
          />
        </div>
      )}
      {stepType === "direct_mail" && (
        <div>
          <Label className="text-xs">Brevo Template ID</Label>
          <Input
            value={form.subject}
            onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
            className="mt-1 h-8 text-sm font-mono"
            placeholder="e.g. 42"
          />
        </div>
      )}

      {/* Body */}
      <div>
        <Label className="text-xs">
          {stepType === "email" ? "Body" :
           stepType === "sms" ? `SMS Message (${form.body.length}/160)` :
           "Letter / Postcard Text"}
        </Label>
        <Textarea
          value={form.body}
          onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          className="mt-1 text-sm resize-none"
          rows={3}
          placeholder={
            stepType === "email" ? "Hi {{name}}, we'd love to make an offer on your property at {{address}}..." :
            stepType === "sms" ? "Hi {{name}}, we're interested in your property at {{address}}. Reply STOP to opt out." :
            "Dear {{name}},\nWe are interested in purchasing your property at {{address}}, {{city}} {{state}}."
          }
          maxLength={stepType === "sms" ? 1600 : stepType === "ai_sms" ? 500 : undefined}
        />
        {stepType === "ai_sms" && (
          <p className="text-[11px] mt-1 text-purple-400">
            AI SMS sends a context-aware reply generated by AI (~$0.005/message). Requires Twilio + AI SMS enabled on the campaign.
          </p>
        )}
        {stepType === "sms" && form.body.length > 140 && (
          <p className={`text-[11px] mt-1 ${form.body.length > 160 ? "text-orange-500" : "text-muted-foreground"}`}>
            {form.body.length > 160
              ? `${Math.ceil(form.body.length / 153)} segments`
              : `${160 - form.body.length} chars remaining`}
          </p>
        )}
      </div>

      <Button size="sm" onClick={() => mutation.mutate()} disabled={!canSubmit}>
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

  const stepTypeCounts = seq.steps.reduce((acc, s) => {
    const t = s.type || "email";
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

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
                {seq.steps.length > 0 && (
                  <div className="flex gap-2 mt-1">
                    {Object.entries(stepTypeCounts).map(([type, count]) => {
                      const meta = STEP_TYPE_META[type as StepType] || STEP_TYPE_META.email;
                      const Icon = meta.icon;
                      return (
                        <span key={type} className={`inline-flex items-center gap-1 text-[10px] font-medium ${meta.color}`}>
                          <Icon className="w-2.5 h-2.5" /> {count}
                        </span>
                      );
                    })}
                  </div>
                )}
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
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Sequence Steps</p>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowNewStep(s => !s)}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Step
                </Button>
              </div>

              {seq.steps.length === 0 && !showNewStep && (
                <p className="text-sm text-muted-foreground italic text-center py-4">
                  No steps yet. Add an email, SMS, or direct mail step.
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
          <h1 className="text-2xl font-bold text-foreground">Sequences</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automated multi-channel sequences — email, SMS, and direct mail — sent based on days since a lead was created.
            Use <code className="bg-secondary px-1 rounded text-xs">{"{{name}}"}</code>,{" "}
            <code className="bg-secondary px-1 rounded text-xs">{"{{address}}"}</code>,{" "}
            <code className="bg-secondary px-1 rounded text-xs">{"{{city}}"}</code>,{" "}
            <code className="bg-secondary px-1 rounded text-xs">{"{{state}}"}</code> as variables.
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
              <p className="font-semibold">New Sequence</p>
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
          <p className="text-sm text-muted-foreground mt-1">Create your first sequence to start automated multi-channel follow-ups.</p>
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

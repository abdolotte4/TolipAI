import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Globe, Users, TrendingUp, Plus, Settings, AlertCircle, Eye, EyeOff, ShieldAlert, SlidersHorizontal, Trash2, KeyRound, Phone, ChevronDown } from "lucide-react";

interface Campaign {
  id: number;
  name: string;
  slug: string;
  active: boolean;
  maxUsers: number | null;
  allowLeadDeletion: boolean;
  skipTraceDailyLimit: number;
  fetchCompsDailyLimit: number;
  openPhoneNumberId: string | null;
  openPhoneNumber: string | null;
  dialerEnabled: boolean;
  aiSmsEnabled: boolean;
  aiSmsPersonality: string | null;
  aiSmsMaxRepliesPerDay: number;
  userCount: number;
  leadCount: number;
  createdAt: string;
}

interface OpenPhoneNumber {
  id: string;
  name?: string;
  number?: string;
}


async function fetchCampaigns(): Promise<Campaign[]> {
  return apiFetch("/campaigns");
}

async function createCampaign(data: {
  name: string; slug: string;
  adminName: string; adminEmail: string; adminPassword: string;
  maxUsers: number | null; allowLeadDeletion: boolean;
  skipTraceDailyLimit: number; fetchCompsDailyLimit: number;
  openPhoneNumberId?: string | null; openPhoneNumber?: string | null; dialerEnabled?: boolean;
}): Promise<Campaign> {
  return apiFetch("/campaigns", { method: "POST", body: JSON.stringify(data) });
}

async function updateGovernance(id: number, data: {
  maxUsers: number | null; allowLeadDeletion: boolean;
  skipTraceDailyLimit: number; fetchCompsDailyLimit: number;
  openPhoneNumberId?: string | null; openPhoneNumber?: string | null; dialerEnabled?: boolean;
  aiSmsEnabled?: boolean; aiSmsPersonality?: string; aiSmsMaxRepliesPerDay?: number;
}): Promise<Campaign> {
  return apiFetch(`/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}

async function toggleCampaign(id: number, active: boolean): Promise<Campaign> {
  return apiFetch(`/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ active }) });
}

function slugify(text: string) {
  return text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

interface FormState {
  name: string;
  slug: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  maxUsers: string;
  allowLeadDeletion: boolean;
  skipTraceDailyLimit: string;
  fetchCompsDailyLimit: string;
  openPhoneNumberId: string;
  openPhoneNumber: string;
  dialerEnabled: boolean;
}

const defaultForm: FormState = {
  name: "", slug: "", adminName: "", adminEmail: "", adminPassword: "",
  maxUsers: "", allowLeadDeletion: true,
  skipTraceDailyLimit: "1", fetchCompsDailyLimit: "1",
  openPhoneNumberId: "", openPhoneNumber: "", dialerEnabled: false,
};

export default function CampaignList() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["crm-campaigns"],
    queryFn: fetchCampaigns,
  });

  const createMutation = useMutation({
    mutationFn: createCampaign,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-campaigns"] });
      setDialogOpen(false);
      resetForm();
      toast({ title: "Campaign created", description: "The client workspace and admin account have been set up." });
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => toggleCampaign(id, active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["crm-campaigns"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateGovernance>[1] }) =>
      updateGovernance(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-campaigns"] });
      setEditTarget(null);
      toast({ title: "Campaign settings saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [editTarget, setEditTarget] = useState<Campaign | null>(null);
  const [editMaxUsers, setEditMaxUsers] = useState("");
  const [editAllowDeletion, setEditAllowDeletion] = useState(true);
  const [editSkipTraceLimit, setEditSkipTraceLimit] = useState("1");
  const [editFetchCompsLimit, setEditFetchCompsLimit] = useState("1");
  const [editOpenPhoneNumberId, setEditOpenPhoneNumberId] = useState<string>("");
  const [editOpenPhoneNumber, setEditOpenPhoneNumber] = useState<string>("");
  const [editDialerEnabled, setEditDialerEnabled] = useState(false);
  const [editAiSmsEnabled, setEditAiSmsEnabled] = useState(false);
  const [editAiSmsPersonality, setEditAiSmsPersonality] = useState("professional_investor");
  const [editAiSmsMaxReplies, setEditAiSmsMaxReplies] = useState("5");
  const [opPhoneNumbers, setOpPhoneNumbers] = useState<OpenPhoneNumber[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("crm_token");
    fetch("/api/twilio/phone-numbers", {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    })
      .then(r => r.json())
      .then(d => setOpPhoneNumbers(d.phoneNumbers || []))
      .catch(() => {});
  }, []);

  // Delete campaign state
  const [deleteTarget, setDeleteTarget] = useState<Campaign | null>(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteShowPassword, setDeleteShowPassword] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: ({ id, password }: { id: number; password: string }) =>
      apiFetch(`/campaigns/${id}`, {
        method: "DELETE",
        body: JSON.stringify({ superAdminPassword: password }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-campaigns"] });
      setDeleteTarget(null);
      setDeletePassword("");
      toast({ title: "Campaign deleted", description: "The campaign and all its data have been permanently removed." });
    },
    onError: (e: any) => {
      toast({ title: "Deletion failed", description: e.message, variant: "destructive" });
    },
  });

  const openEditDialog = (campaign: Campaign) => {
    setEditTarget(campaign);
    setEditMaxUsers(campaign.maxUsers != null ? String(campaign.maxUsers) : "");
    setEditAllowDeletion(campaign.allowLeadDeletion);
    setEditSkipTraceLimit(String(campaign.skipTraceDailyLimit ?? 1));
    setEditFetchCompsLimit(String(campaign.fetchCompsDailyLimit ?? 1));
    setEditOpenPhoneNumberId(campaign.openPhoneNumberId ?? "");
    setEditOpenPhoneNumber(campaign.openPhoneNumber ?? "");
    setEditDialerEnabled(campaign.dialerEnabled ?? false);
    setEditAiSmsEnabled(campaign.aiSmsEnabled ?? false);
    setEditAiSmsPersonality(campaign.aiSmsPersonality ?? "professional_investor");
    setEditAiSmsMaxReplies(String(campaign.aiSmsMaxRepliesPerDay ?? 5));
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget) return;
    const selectedNum = opPhoneNumbers.find(n => n.id === editOpenPhoneNumberId);
    editMutation.mutate({
      id: editTarget.id,
      data: {
        maxUsers: editMaxUsers ? parseInt(editMaxUsers) : null,
        allowLeadDeletion: editAllowDeletion,
        skipTraceDailyLimit: Math.max(1, parseInt(editSkipTraceLimit) || 1),
        fetchCompsDailyLimit: Math.max(1, parseInt(editFetchCompsLimit) || 1),
        openPhoneNumberId: editOpenPhoneNumberId || null,
        openPhoneNumber: selectedNum?.number || editOpenPhoneNumber || null,
        dialerEnabled: editDialerEnabled,
        aiSmsEnabled: editAiSmsEnabled,
        aiSmsPersonality: editAiSmsPersonality,
        aiSmsMaxRepliesPerDay: Math.min(50, Math.max(1, parseInt(editAiSmsMaxReplies) || 5)),
      },
    });
  };

  const [dialogOpen, setDialogOpen] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState<FormState>(defaultForm);

  const resetForm = () => setForm(defaultForm);

  const handleNameChange = (name: string) => {
    setForm(f => ({ ...f, name, slug: slugify(name) }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const selectedNum = opPhoneNumbers.find(n => n.id === form.openPhoneNumberId);
    createMutation.mutate({
      name: form.name,
      slug: form.slug,
      adminName: form.adminName,
      adminEmail: form.adminEmail,
      adminPassword: form.adminPassword,
      maxUsers: form.maxUsers ? parseInt(form.maxUsers) : null,
      allowLeadDeletion: form.allowLeadDeletion,
      skipTraceDailyLimit: Math.max(1, parseInt(form.skipTraceDailyLimit) || 1),
      fetchCompsDailyLimit: Math.max(1, parseInt(form.fetchCompsDailyLimit) || 1),
      openPhoneNumberId: form.openPhoneNumberId || null,
      openPhoneNumber: selectedNum?.number || null,
      dialerEnabled: form.dialerEnabled,
    });
  };

  return (
    <div className="max-w-6xl mx-auto pb-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Client Campaigns</h1>
          <p className="text-muted-foreground mt-1">Each campaign is an isolated workspace for one client.</p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-gradient-to-r from-primary to-accent text-white hover:from-primary/90 hover:to-accent/90 shadow-lg"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Campaign
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {[
          { label: "Total Campaigns", value: campaigns.length, icon: Globe, color: "text-primary" },
          { label: "Active Campaigns", value: campaigns.filter(c => c.active).length, icon: TrendingUp, color: "text-emerald-400" },
          { label: "Total Users", value: campaigns.reduce((s, c) => s + c.userCount, 0), icon: Users, color: "text-violet-400" },
        ].map(stat => (
          <Card key={stat.label} className="p-5 rounded-2xl border-white/5 bg-card shadow-lg">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-secondary rounded-xl">
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <div>
                <div className="text-2xl font-bold">{stat.value}</div>
                <div className="text-xs text-muted-foreground">{stat.label}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Campaign grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i} className="p-6 rounded-2xl border-white/5 bg-card animate-pulse h-44" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <Card className="p-12 rounded-2xl border-white/5 bg-card text-center">
          <Globe className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-40" />
          <p className="text-lg font-medium text-muted-foreground">No campaigns yet</p>
          <p className="text-sm text-muted-foreground mt-1">Create your first client campaign to get started.</p>
          <Button className="mt-6" onClick={() => setDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create First Campaign
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {campaigns.map((campaign, i) => (
            <motion.div
              key={campaign.id}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card className="p-6 rounded-2xl border-white/5 bg-card shadow-lg hover:border-primary/20 transition-all duration-200 group">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 border border-white/10 flex items-center justify-center font-bold text-primary text-lg">
                      {campaign.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">{campaign.name}</h3>
                      <code className="text-xs text-muted-foreground font-mono">{campaign.slug}</code>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={campaign.active
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-secondary text-muted-foreground"
                    }
                  >
                    {campaign.active ? "Active" : "Inactive"}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="bg-secondary/50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-foreground">{campaign.leadCount}</div>
                    <div className="text-xs text-muted-foreground">Leads</div>
                  </div>
                  <div className="bg-secondary/50 rounded-xl p-3 text-center">
                    <div className="text-xl font-bold text-foreground">
                      {campaign.userCount}
                      {campaign.maxUsers != null && (
                        <span className="text-xs text-muted-foreground font-normal">/{campaign.maxUsers}</span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">Users</div>
                  </div>
                </div>

                {/* Governance flags */}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {campaign.maxUsers != null && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
                      Max {campaign.maxUsers} users
                    </span>
                  )}
                  {!campaign.allowLeadDeletion && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-400 border border-orange-500/20 flex items-center gap-1">
                      <ShieldAlert className="w-3 h-3" /> No deletion
                    </span>
                  )}
                  <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    ST {campaign.skipTraceDailyLimit}/day
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-400 border border-teal-500/20">
                    Comps {campaign.fetchCompsDailyLimit}/day
                  </span>
                </div>

                <div className="flex gap-2">
                  <Link href={`/leads?campaign=${campaign.id}`} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full text-xs border-white/10 hover:bg-primary/10 hover:text-primary hover:border-primary/30">
                      <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
                      View Leads
                    </Button>
                  </Link>
                  <Link href={`/admin/users?campaign=${campaign.id}`}>
                    <Button variant="outline" size="sm" className="text-xs border-white/10 hover:bg-primary/10 hover:text-primary hover:border-primary/30" title="Manage users">
                      <Settings className="w-3.5 h-3.5" />
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs border-white/10 hover:bg-violet-500/10 hover:text-violet-400 hover:border-violet-500/30"
                    onClick={() => openEditDialog(campaign)}
                    title="Campaign governance settings"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs border-white/10 hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/30"
                    onClick={() => toggleMutation.mutate({ id: campaign.id, active: !campaign.active })}
                    title={campaign.active ? "Deactivate campaign" : "Activate campaign"}
                  >
                    {campaign.active ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs border-red-500/20 text-red-400 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/40"
                    onClick={() => { setDeleteTarget(campaign); setDeletePassword(""); setDeleteShowPassword(false); }}
                    title="Delete campaign permanently"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Delete Campaign Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeletePassword(""); } }}>
        <DialogContent className="bg-card border-white/10 rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-5 h-5" /> Delete Campaign
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              This will permanently delete <strong className="text-foreground">{deleteTarget?.name}</strong> and all its leads, users, tasks, and data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 space-y-4">
            <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive flex gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                <strong>{deleteTarget?.leadCount} leads</strong> and <strong>{deleteTarget?.userCount} users</strong> in this campaign will be permanently deleted.
              </span>
            </div>

            <div className="space-y-2">
              <Label htmlFor="delete-password" className="flex items-center gap-1.5">
                <KeyRound className="w-4 h-4 text-muted-foreground" />
                Enter your super admin password to confirm
              </Label>
              <div className="relative">
                <Input
                  id="delete-password"
                  type={deleteShowPassword ? "text" : "password"}
                  placeholder="Your password"
                  className="bg-background/50 border-destructive/30 focus:border-destructive rounded-xl pr-10"
                  value={deletePassword}
                  onChange={e => setDeletePassword(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && deletePassword && deleteTarget) {
                      deleteMutation.mutate({ id: deleteTarget.id, password: deletePassword });
                    }
                  }}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setDeleteShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {deleteShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1 border-white/10"
                onClick={() => { setDeleteTarget(null); setDeletePassword(""); }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="flex-1 shadow-lg shadow-destructive/20"
                disabled={!deletePassword || deleteMutation.isPending}
                onClick={() => deleteTarget && deleteMutation.mutate({ id: deleteTarget.id, password: deletePassword })}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete Campaign"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Governance Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(open) => { if (!open) setEditTarget(null); }}>
        <DialogContent className="bg-card border-white/10 rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle>Campaign Settings</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Update governance rules for <strong className="text-foreground">{editTarget?.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-5 mt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-max-users">Max Users (optional)</Label>
                <Input
                  id="edit-max-users"
                  type="number"
                  min="1"
                  placeholder="Unlimited"
                  className="bg-background/50 border-white/10 rounded-xl"
                  value={editMaxUsers}
                  onChange={(e) => setEditMaxUsers(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Allow Lead Deletion</Label>
                <div className="flex items-center gap-3 h-9">
                  <Switch
                    checked={editAllowDeletion}
                    onCheckedChange={setEditAllowDeletion}
                  />
                  <span className="text-sm text-muted-foreground">{editAllowDeletion ? "Allowed" : "Disabled"}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-st-limit">Enrichments / day</Label>
                <Input
                  id="edit-st-limit"
                  type="number"
                  min="1"
                  className="bg-background/50 border-white/10 rounded-xl"
                  value={editSkipTraceLimit}
                  onChange={(e) => setEditSkipTraceLimit(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-fc-limit">Fetch Comps / day</Label>
                <Input
                  id="edit-fc-limit"
                  type="number"
                  min="1"
                  className="bg-background/50 border-white/10 rounded-xl"
                  value={editFetchCompsLimit}
                  onChange={(e) => setEditFetchCompsLimit(e.target.value)}
                />
              </div>
            </div>
            {/* OpenPhone Settings */}
            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-green-400" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">OpenPhone / Dialer</span>
              </div>
              <div className="space-y-2">
                <Label>Assigned Phone Number</Label>
                <div className="relative">
                  <select
                    value={editOpenPhoneNumberId}
                    onChange={e => {
                      const selected = opPhoneNumbers.find(n => n.id === e.target.value);
                      setEditOpenPhoneNumberId(e.target.value);
                      setEditOpenPhoneNumber(selected?.number || "");
                    }}
                    className="w-full h-10 pl-3 pr-8 rounded-xl border border-border bg-background/50 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none"
                  >
                    <option value="">— No number assigned (use state match) —</option>
                    {opPhoneNumbers.map(n => (
                      <option key={n.id} value={n.id}>
                        {n.name || n.number} {n.name && n.number ? `(${n.number})` : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                </div>
                <p className="text-xs text-muted-foreground">If set, this number is always used for calls and texts in this campaign. If left blank, the system picks the number matching the lead's state automatically.</p>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={editDialerEnabled} onCheckedChange={setEditDialerEnabled} />
                <div>
                  <p className="text-sm font-medium">{editDialerEnabled ? "Dialer enabled" : "Dialer disabled"}</p>
                  <p className="text-xs text-muted-foreground">When enabled, campaign users see Call and Text buttons on every lead.</p>
                </div>
              </div>
            </div>

            {/* AI SMS Settings */}
            <div className="border-t border-border pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-base">🤖</span>
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">AI SMS Auto-Reply</span>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={editAiSmsEnabled} onCheckedChange={setEditAiSmsEnabled} />
                <div>
                  <p className="text-sm font-medium">{editAiSmsEnabled ? "AI auto-reply enabled" : "AI auto-reply disabled"}</p>
                  <p className="text-xs text-muted-foreground">When enabled, inbound SMS from leads are automatically answered by AI. Requires Twilio to be configured.</p>
                </div>
              </div>
              {editAiSmsEnabled && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">AI Personality</Label>
                    <select
                      value={editAiSmsPersonality}
                      onChange={e => setEditAiSmsPersonality(e.target.value)}
                      className="w-full h-9 pl-3 pr-8 rounded-xl border border-border bg-background/50 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none"
                    >
                      <option value="professional_investor">Professional Investor — formal, concise, offer-focused</option>
                      <option value="friendly">Friendly — warm, conversational, relationship-building</option>
                      <option value="aggressive">Aggressive — direct, urgency-creating, deal-focused</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Max AI Replies per Lead per Day</Label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={editAiSmsMaxReplies}
                      onChange={e => setEditAiSmsMaxReplies(e.target.value)}
                      className="h-8 text-sm bg-background/50 border-white/10 rounded-xl"
                    />
                    <p className="text-xs text-muted-foreground">Prevents the AI from over-messaging. Recommended: 3–10 per day.</p>
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1 border-white/10"
                onClick={() => setEditTarget(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-gradient-to-r from-primary to-accent text-white"
                disabled={editMutation.isPending}
              >
                {editMutation.isPending ? "Saving..." : "Save Settings"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Campaign Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-card border-white/10 rounded-2xl max-w-lg">
          <DialogHeader>
            <DialogTitle>Create New Campaign</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Set up an isolated workspace for a new client and create their admin account.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5 mt-2">
            <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 text-sm text-muted-foreground flex gap-2">
              <AlertCircle className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
              <span>This will create the campaign and an admin account. The admin will use the email and password below to log in.</span>
            </div>

            <div className="space-y-4">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Campaign Details</div>
              <div className="space-y-2">
                <Label htmlFor="camp-name">Campaign Name</Label>
                <Input
                  id="camp-name"
                  placeholder="e.g. Acme Real Estate"
                  required
                  className="bg-background/50 border-white/10 rounded-xl"
                  value={form.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="camp-slug">Slug (auto-generated)</Label>
                <Input
                  id="camp-slug"
                  placeholder="e.g. acme-real-estate"
                  required
                  className="bg-background/50 border-white/10 rounded-xl font-mono"
                  value={form.slug}
                  onChange={(e) => setForm(f => ({ ...f, slug: slugify(e.target.value) }))}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Governance</div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="max-users">Max Users (optional)</Label>
                  <Input
                    id="max-users"
                    type="number"
                    min="1"
                    placeholder="Unlimited"
                    className="bg-background/50 border-white/10 rounded-xl"
                    value={form.maxUsers}
                    onChange={(e) => setForm(f => ({ ...f, maxUsers: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Allow Lead Deletion</Label>
                  <div className="flex items-center gap-3 h-9">
                    <Switch
                      checked={form.allowLeadDeletion}
                      onCheckedChange={(v) => setForm(f => ({ ...f, allowLeadDeletion: v }))}
                    />
                    <span className="text-sm text-muted-foreground">{form.allowLeadDeletion ? "Allowed" : "Disabled"}</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="st-limit">Enrichments / day</Label>
                  <Input
                    id="st-limit"
                    type="number"
                    min="1"
                    placeholder="1"
                    className="bg-background/50 border-white/10 rounded-xl"
                    value={form.skipTraceDailyLimit}
                    onChange={(e) => setForm(f => ({ ...f, skipTraceDailyLimit: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fc-limit">Fetch Comps / day</Label>
                  <Input
                    id="fc-limit"
                    type="number"
                    min="1"
                    placeholder="1"
                    className="bg-background/50 border-white/10 rounded-xl"
                    value={form.fetchCompsDailyLimit}
                    onChange={(e) => setForm(f => ({ ...f, fetchCompsDailyLimit: e.target.value }))}
                  />
                </div>
              </div>
            </div>

            {/* OpenPhone / Dialer */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-green-400" />
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">OpenPhone / Dialer</div>
              </div>
              <div className="space-y-2">
                <Label>Assigned Phone Number</Label>
                <div className="relative">
                  <select
                    value={form.openPhoneNumberId}
                    onChange={e => {
                      const selected = opPhoneNumbers.find(n => n.id === e.target.value);
                      setForm(f => ({ ...f, openPhoneNumberId: e.target.value, openPhoneNumber: selected?.number || "" }));
                    }}
                    className="w-full h-10 pl-3 pr-8 rounded-xl border border-border bg-background/50 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none"
                  >
                    <option value="">— No number (auto state-match) —</option>
                    {opPhoneNumbers.map(n => (
                      <option key={n.id} value={n.id}>
                        {n.name || n.number} {n.name && n.number ? `(${n.number})` : ""}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.dialerEnabled}
                  onCheckedChange={v => setForm(f => ({ ...f, dialerEnabled: v }))}
                />
                <div>
                  <p className="text-sm font-medium">{form.dialerEnabled ? "Dialer enabled" : "Dialer disabled"}</p>
                  <p className="text-xs text-muted-foreground">When enabled, users in this campaign can call and text leads via OpenPhone.</p>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Campaign Admin Account</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="admin-name">Full Name</Label>
                  <Input
                    id="admin-name"
                    placeholder="John Smith"
                    required
                    className="bg-background/50 border-white/10 rounded-xl"
                    value={form.adminName}
                    onChange={(e) => setForm(f => ({ ...f, adminName: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-email">Email</Label>
                  <Input
                    id="admin-email"
                    type="email"
                    placeholder="admin@client.com"
                    required
                    className="bg-background/50 border-white/10 rounded-xl"
                    value={form.adminEmail}
                    onChange={(e) => setForm(f => ({ ...f, adminEmail: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-pass">Password</Label>
                <div className="relative">
                  <Input
                    id="admin-pass"
                    type={showPassword ? "text" : "password"}
                    placeholder="Strong password for the client admin"
                    required
                    minLength={8}
                    className="bg-background/50 border-white/10 rounded-xl pr-10"
                    value={form.adminPassword}
                    onChange={(e) => setForm(f => ({ ...f, adminPassword: e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1 border-white/10" onClick={() => { setDialogOpen(false); resetForm(); }}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-gradient-to-r from-primary to-accent text-white"
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? "Creating..." : "Create Campaign"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

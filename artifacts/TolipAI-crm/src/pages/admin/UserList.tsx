import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCrmGetMe } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useToast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Users, Shield, User, Plus, Pencil, Trash2,
  Eye, EyeOff, ShieldCheck, Building2, Crown,
  KeyRound, Copy, Check, Clock,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface CrmUser {
  id: number;
  name: string;
  email: string;
  role: string;
  status: string;
  campaignId: number | null;
  isOwner?: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

interface Campaign {
  id: number;
  name: string;
  slug: string;
}

function apiUrl(path: string) {
  return `/api/crm${path}`;
}

function authHeaders() {
  const token = localStorage.getItem("crm_token");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function formatLastActive(dateStr: string | null): { label: string; isOnline: boolean } {
  if (!dateStr) return { label: "Never logged in", isOnline: false };
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 2) return { label: "Active now", isOnline: true };
  if (diffMin < 60) return { label: `${diffMin}m ago`, isOnline: false };
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return { label: `${diffH}h ago`, isOnline: false };
  return { label: formatDistanceToNow(date, { addSuffix: true }), isOnline: false };
}

async function fetchUsers(campaignId?: number): Promise<CrmUser[]> {
  const qs = campaignId ? `?campaignId=${campaignId}` : "";
  const r = await fetch(apiUrl(`/users${qs}`), { headers: authHeaders() });
  if (!r.ok) throw new Error("Failed to fetch users");
  return r.json();
}

async function fetchCampaigns(): Promise<Campaign[]> {
  const r = await fetch(apiUrl("/campaigns"), { headers: authHeaders() });
  if (!r.ok) return [];
  return r.json();
}

async function fetchUserPassword(id: number): Promise<{ password: string; name: string }> {
  const r = await fetch(apiUrl(`/users/${id}/password`), { headers: authHeaders() });
  const text = await r.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Server returned an unexpected response. Ensure the API server is running and try again.");
  }
  if (!r.ok) throw new Error(json.error || "Failed to fetch password");
  return json;
}

async function createUser(data: Partial<CrmUser> & { password: string; campaignId?: number | null }): Promise<CrmUser> {
  const r = await fetch(apiUrl("/users"), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || "Failed to create user");
  return json;
}

async function updateUser(id: number, data: Partial<CrmUser> & { password?: string }): Promise<CrmUser> {
  const r = await fetch(apiUrl(`/users/${id}`), {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(data),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error || "Failed to update user");
  return json;
}

async function deleteUser(id: number): Promise<void> {
  const r = await fetch(apiUrl(`/users/${id}`), { method: "DELETE", headers: authHeaders() });
  if (!r.ok) {
    const json = await r.json();
    throw new Error(json.error || "Failed to delete user");
  }
}

const ALL_ROLES = [
  { value: "admin", label: "Admin", description: "Full campaign management" },
  { value: "sales", label: "Sales", description: "Leads, notes, tasks" },
  { value: "va", label: "VA", description: "Assigned leads only" },
];

const ROLE_ICONS: Record<string, any> = {
  super_admin: ShieldCheck,
  admin: Shield,
  sales: User,
  va: User,
};

const ROLE_COLORS: Record<string, string> = {
  super_admin: "text-amber-400",
  admin: "text-primary",
  sales: "text-foreground",
  va: "text-muted-foreground",
};

interface FormState {
  name: string;
  email: string;
  role: string;
  status: string;
  password: string;
  campaignId: string;
}

const defaultForm: FormState = { name: "", email: "", role: "sales", status: "active", password: "", campaignId: "" };

export default function UserList() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: me } = useCrmGetMe();
  const isSuperAdmin = me?.role === "super_admin";
  const isAdmin = me?.role === "admin" || isSuperAdmin;
  const amIOwner = (me as any)?.isOwner === true || isSuperAdmin;

  const searchParams = new URLSearchParams(window.location.search);
  const filterCampaignId = searchParams.get("campaign") ? parseInt(searchParams.get("campaign")!) : (isSuperAdmin ? undefined : (me?.campaignId ?? undefined));

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["crm-users", filterCampaignId],
    queryFn: () => fetchUsers(filterCampaignId ? Number(filterCampaignId) : undefined),
    enabled: !!me,
  });

  const { data: campaigns = [] } = useQuery({
    queryKey: ["crm-campaigns"],
    queryFn: fetchCampaigns,
    enabled: isSuperAdmin,
  });

  const campaignMap = new Map<number, Campaign>(campaigns.map(c => [c.id, c]));

  const createMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["crm-users"] }); closeDialog(); toast({ title: "User created successfully" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateUser(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["crm-users"] }); closeDialog(); toast({ title: "User updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["crm-users"] }); setDeleteTarget(null); toast({ title: "User removed" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<CrmUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CrmUser | null>(null);
  const [form, setForm] = useState<FormState>(defaultForm);
  const [showPassword, setShowPassword] = useState(false);

  // Password reveal state
  const [revealTarget, setRevealTarget] = useState<CrmUser | null>(null);
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null);
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [showRevealedPwd, setShowRevealedPwd] = useState(false);
  const [copied, setCopied] = useState(false);

  const openReveal = async (user: CrmUser) => {
    setRevealTarget(user);
    setRevealedPassword(null);
    setRevealError(null);
    setShowRevealedPwd(false);
    setCopied(false);
    setRevealLoading(true);
    try {
      const result = await fetchUserPassword(user.id);
      setRevealedPassword(result.password);
    } catch (e: any) {
      setRevealError(e.message);
    } finally {
      setRevealLoading(false);
    }
  };

  const closeReveal = () => {
    setRevealTarget(null);
    setRevealedPassword(null);
    setRevealError(null);
    setShowRevealedPwd(false);
    setCopied(false);
  };

  const copyPassword = () => {
    if (revealedPassword) {
      navigator.clipboard.writeText(revealedPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const openCreate = () => {
    setEditingUser(null);
    setForm({ ...defaultForm, campaignId: filterCampaignId ? String(filterCampaignId) : (me?.campaignId ? String(me.campaignId) : "") });
    setShowPassword(false);
    setDialogOpen(true);
  };

  const openEdit = (user: CrmUser) => {
    setEditingUser(user);
    setForm({ name: user.name, email: user.email, role: user.role, status: user.status, password: "", campaignId: user.campaignId ? String(user.campaignId) : "" });
    setShowPassword(false);
    setDialogOpen(true);
  };

  const closeDialog = () => { setDialogOpen(false); setEditingUser(null); setForm(defaultForm); };

  const isSelfEdit = editingUser?.id === me?.id;
  const availableRoles = amIOwner ? ALL_ROLES : ALL_ROLES.filter(r => r.value !== "admin");
  const nameEmailRoleRestricted =
    (isSelfEdit && !isSuperAdmin) ||
    (!isSuperAdmin && !amIOwner && !isSelfEdit && editingUser?.role === "admin");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const resolvedCampaignId = form.campaignId ? parseInt(form.campaignId) : (me?.campaignId ?? null);
    if (editingUser) {
      const data: any = { status: form.status };
      if (!nameEmailRoleRestricted) {
        data.name = form.name;
        data.email = form.email;
        data.role = form.role;
      }
      if (form.password) data.password = form.password;
      updateMutation.mutate({ id: editingUser.id, data });
    } else {
      createMutation.mutate({ ...form, campaignId: resolvedCampaignId });
    }
  };

  const pending = createMutation.isPending || updateMutation.isPending;

  const groupedByCampaign = (() => {
    if (!isSuperAdmin) return null;
    const superAdminUsers = users.filter(u => u.role === "super_admin");
    const campaignGroups = new Map<number | null, CrmUser[]>();
    for (const user of users) {
      if (user.role === "super_admin") continue;
      const key = user.campaignId;
      if (!campaignGroups.has(key)) campaignGroups.set(key, []);
      campaignGroups.get(key)!.push(user);
    }
    return { superAdminUsers, campaignGroups };
  })();

  // colCount: user, [campaign], role, status, [last active], joined, actions
  const colCount = isSuperAdmin ? 7 : isAdmin ? 6 : 5;

  return (
    <div className="max-w-6xl mx-auto pb-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold">Team Management</h1>
          <p className="text-muted-foreground mt-1">
            {isSuperAdmin ? "Manage users across all campaigns." : "Manage team access for your campaign."}
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="bg-gradient-to-r from-primary to-accent text-white hover:from-primary/90 hover:to-accent/90 shadow-lg"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add User
        </Button>
      </div>

      <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-secondary/50 text-muted-foreground text-xs uppercase tracking-wider border-b border-border">
                <th className="p-5 font-medium">User</th>
                {isSuperAdmin && <th className="p-5 font-medium">Campaign</th>}
                <th className="p-5 font-medium">Role</th>
                <th className="p-5 font-medium">Status</th>
                {(isSuperAdmin || isAdmin) && <th className="p-5 font-medium">Last Active</th>}
                <th className="p-5 font-medium">Joined</th>
                <th className="p-5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                [1, 2, 3].map(i => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: colCount }).map((_, j) => (
                      <td key={j} className="p-5"><div className="h-6 w-24 bg-secondary rounded" /></td>
                    ))}
                  </tr>
                ))
              ) : isSuperAdmin && groupedByCampaign ? (
                <>
                  {groupedByCampaign.superAdminUsers.length > 0 && (
                    <>
                      <tr className="bg-amber-500/5 border-y border-amber-500/10">
                        <td colSpan={colCount} className="px-5 py-2.5">
                          <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 uppercase tracking-wider">
                            <ShieldCheck className="w-3.5 h-3.5" />
                            System — Super Admins
                          </div>
                        </td>
                      </tr>
                      {groupedByCampaign.superAdminUsers.map(user => (
                        <UserRow key={user.id} user={user} me={me} isSuperAdmin={isSuperAdmin} isAdmin={isAdmin} amIOwner={amIOwner} campaignLabel={null} onEdit={openEdit} onDelete={setDeleteTarget} onRevealPassword={openReveal} />
                      ))}
                    </>
                  )}

                  {campaigns.map(campaign => {
                    const campaignUsers = groupedByCampaign.campaignGroups.get(campaign.id) ?? [];
                    return (
                      <CampaignGroup
                        key={campaign.id}
                        campaign={campaign}
                        users={campaignUsers}
                        me={me}
                        isSuperAdmin={isSuperAdmin}
                        isAdmin={isAdmin}
                        amIOwner={amIOwner}
                        onEdit={openEdit}
                        onDelete={setDeleteTarget}
                        onRevealPassword={openReveal}
                        colCount={colCount}
                      />
                    );
                  })}

                  {(() => {
                    const noCampaignUsers = groupedByCampaign.campaignGroups.get(null) ?? [];
                    if (noCampaignUsers.length === 0) return null;
                    return (
                      <>
                        <tr className="bg-secondary/30 border-y border-border">
                          <td colSpan={colCount} className="px-5 py-2.5">
                            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                              <Building2 className="w-3.5 h-3.5" />
                              No Campaign Assigned
                            </div>
                          </td>
                        </tr>
                        {noCampaignUsers.map(user => (
                          <UserRow key={user.id} user={user} me={me} isSuperAdmin={isSuperAdmin} isAdmin={isAdmin} amIOwner={amIOwner} campaignLabel="—" onEdit={openEdit} onDelete={setDeleteTarget} onRevealPassword={openReveal} />
                        ))}
                      </>
                    );
                  })()}

                  {users.length === 0 && (
                    <tr>
                      <td colSpan={colCount} className="p-12 text-center text-muted-foreground">
                        <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        No users found.
                      </td>
                    </tr>
                  )}
                </>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="p-12 text-center text-muted-foreground">
                    <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
                    No users in this campaign yet.
                  </td>
                </tr>
              ) : (
                users.map(user => (
                  <UserRow key={user.id} user={user} me={me} isSuperAdmin={isSuperAdmin} isAdmin={isAdmin} amIOwner={amIOwner} campaignLabel={undefined} onEdit={openEdit} onDelete={setDeleteTarget} onRevealPassword={openReveal} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={closeDialog}>
        <DialogContent className="bg-card border-white/10 rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle>{editingUser ? "Edit User" : "Add Team Member"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-2">
            {nameEmailRoleRestricted && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                <Shield className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>Name, email, and role can only be changed by the campaign owner.</span>
              </div>
            )}
            <TooltipProvider delayDuration={200}>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Full Name</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Input
                        required={!nameEmailRoleRestricted}
                        disabled={nameEmailRoleRestricted}
                        placeholder="Jane Doe"
                        className="bg-background/50 border-white/10 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                        value={form.name}
                        onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                      />
                    </div>
                  </TooltipTrigger>
                  {nameEmailRoleRestricted && (
                    <TooltipContent side="top">Only the campaign owner can change these.</TooltipContent>
                  )}
                </Tooltip>
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Input
                        required={!nameEmailRoleRestricted}
                        disabled={nameEmailRoleRestricted}
                        type="email"
                        placeholder="jane@company.com"
                        className="bg-background/50 border-white/10 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
                        value={form.email}
                        onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                      />
                    </div>
                  </TooltipTrigger>
                  {nameEmailRoleRestricted && (
                    <TooltipContent side="top">Only the campaign owner can change these.</TooltipContent>
                  )}
                </Tooltip>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Role</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <Select
                        value={form.role}
                        onValueChange={(v) => setForm(f => ({ ...f, role: v }))}
                        disabled={nameEmailRoleRestricted}
                      >
                        <SelectTrigger className="bg-background/50 border-white/10 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-white/10">
                          {availableRoles.map(r => (
                            <SelectItem key={r.value} value={r.value}>
                              <div>
                                <div className="font-medium">{r.label}</div>
                                <div className="text-xs text-muted-foreground">{r.description}</div>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </TooltipTrigger>
                  {nameEmailRoleRestricted && (
                    <TooltipContent side="top">Only the campaign owner can change these.</TooltipContent>
                  )}
                </Tooltip>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm(f => ({ ...f, status: v }))}>
                  <SelectTrigger className="bg-background/50 border-white/10 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10">
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {isSuperAdmin && !editingUser && (
              <div className="space-y-2">
                <Label>Campaign</Label>
                <Select value={form.campaignId} onValueChange={(v) => setForm(f => ({ ...f, campaignId: v }))}>
                  <SelectTrigger className="bg-background/50 border-white/10 rounded-xl">
                    <SelectValue placeholder="Select campaign…" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-white/10">
                    {campaigns.map(c => (
                      <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>{editingUser ? "New Password (leave blank to keep current)" : "Password"}</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder={editingUser ? "Enter new password to change" : "Minimum 8 characters"}
                  required={!editingUser}
                  minLength={editingUser ? 0 : 8}
                  className="bg-background/50 border-white/10 rounded-xl pr-10"
                  value={form.password}
                  onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
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
            </TooltipProvider>

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1 border-white/10" onClick={closeDialog}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1 bg-gradient-to-r from-primary to-accent text-white"
                disabled={pending}
              >
                {pending ? "Saving..." : editingUser ? "Save Changes" : "Add User"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Password Reveal Dialog */}
      <Dialog open={!!revealTarget} onOpenChange={closeReveal}>
        <DialogContent className="bg-card border-white/10 rounded-2xl max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-amber-400" />
              Password for {revealTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-2 space-y-3">
            <p className="text-xs text-muted-foreground">
              This is the password the user most recently logged in with. Changing their password
              via the edit dialog will update this record.
            </p>
            {revealLoading && (
              <div className="h-10 flex items-center gap-2 text-muted-foreground text-sm">
                <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                Decrypting…
              </div>
            )}
            {revealError && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                {revealError}
              </div>
            )}
            {revealedPassword && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 p-3 rounded-xl bg-secondary/50 border border-white/10">
                  <code className="flex-1 text-sm font-mono tracking-wide text-foreground">
                    {showRevealedPwd ? revealedPassword : "•".repeat(revealedPassword.length)}
                  </code>
                  <button
                    type="button"
                    onClick={() => setShowRevealedPwd(s => !s)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title={showRevealedPwd ? "Hide" : "Show"}
                  >
                    {showRevealedPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={copyPassword}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy to clipboard"
                  >
                    {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
                {copied && <p className="text-xs text-emerald-400 text-center">Copied to clipboard!</p>}
              </div>
            )}
            <Button variant="outline" className="w-full border-white/10" onClick={closeReveal}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent className="bg-card border-white/10 rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove User</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to remove <strong className="text-foreground">{deleteTarget?.name}</strong>? They will no longer be able to access this campaign.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 hover:bg-secondary">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? "Removing..." : "Remove User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CampaignGroup({
  campaign,
  users,
  me,
  isSuperAdmin,
  isAdmin,
  amIOwner,
  onEdit,
  onDelete,
  onRevealPassword,
  colCount,
}: {
  campaign: Campaign;
  users: CrmUser[];
  me: any;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  amIOwner: boolean;
  onEdit: (u: CrmUser) => void;
  onDelete: (u: CrmUser) => void;
  onRevealPassword: (u: CrmUser) => void;
  colCount: number;
}) {
  return (
    <>
      <tr className="bg-primary/5 border-y border-primary/10">
        <td colSpan={colCount} className="px-5 py-2.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-primary/80 uppercase tracking-wider">
            <Building2 className="w-3.5 h-3.5" />
            {campaign.name}
            <span className="ml-1 text-muted-foreground font-normal normal-case tracking-normal">
              ({users.length} {users.length === 1 ? "user" : "users"})
            </span>
          </div>
        </td>
      </tr>
      {users.length === 0 ? (
        <tr>
          <td colSpan={colCount} className="px-5 py-4 text-sm text-muted-foreground text-center">
            No users in this campaign yet.
          </td>
        </tr>
      ) : (
        users.map(user => (
          <UserRow key={user.id} user={user} me={me} isSuperAdmin={isSuperAdmin} isAdmin={isAdmin} amIOwner={amIOwner} campaignLabel={campaign.name} onEdit={onEdit} onDelete={onDelete} onRevealPassword={onRevealPassword} />
        ))
      )}
    </>
  );
}

function UserRow({
  user,
  me,
  isSuperAdmin,
  isAdmin,
  amIOwner,
  campaignLabel,
  onEdit,
  onDelete,
  onRevealPassword,
}: {
  user: CrmUser;
  me: any;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  amIOwner: boolean;
  campaignLabel: string | null | undefined;
  onEdit: (u: CrmUser) => void;
  onDelete: (u: CrmUser) => void;
  onRevealPassword: (u: CrmUser) => void;
}) {
  const RoleIcon = ROLE_ICONS[user.role] || User;
  const isMe = user.id === me?.id;
  const canActOnUser = user.role === "super_admin"
    ? false
    : user.role === "admin"
      ? (isSuperAdmin || amIOwner)
      : true;

  const { label: lastActiveLabel, isOnline } = formatLastActive(user.lastLoginAt);

  return (
    <tr className="hover:bg-secondary/30 transition-colors">
      <td className="p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary/20 to-accent/20 flex items-center justify-center border border-white/5 relative">
            <span className="font-bold text-primary">{user.name.charAt(0).toUpperCase()}</span>
            {isOnline && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-card" title="Active now" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-medium text-foreground">{user.name}</p>
              {isMe && <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-primary/20">You</Badge>}
              {user.isOwner && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-500/15 text-amber-400 border-amber-500/25 flex items-center gap-1">
                  <Crown className="w-2.5 h-2.5" /> Owner
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
        </div>
      </td>
      {isSuperAdmin && (
        <td className="p-5">
          {campaignLabel === null ? (
            <span className="text-xs text-amber-400/70 font-medium">System</span>
          ) : campaignLabel !== undefined ? (
            <span className="text-sm text-muted-foreground">{campaignLabel}</span>
          ) : null}
        </td>
      )}
      <td className="p-5">
        <div className="flex items-center gap-2 text-sm">
          <RoleIcon className={`w-4 h-4 ${ROLE_COLORS[user.role] || "text-muted-foreground"}`} />
          <span className="capitalize">{user.role.replace("_", " ")}</span>
        </div>
      </td>
      <td className="p-5">
        <Badge
          variant="outline"
          className={user.status === "active"
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-secondary text-muted-foreground"
          }
        >
          {user.status}
        </Badge>
      </td>
      {(isSuperAdmin || isAdmin) && (
        <td className="p-5">
          <div className={`flex items-center gap-1.5 text-sm ${isOnline ? "text-emerald-400" : "text-muted-foreground"}`}>
            {isOnline
              ? <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
              : <Clock className="w-3.5 h-3.5 opacity-60" />
            }
            <span>{lastActiveLabel}</span>
          </div>
        </td>
      )}
      <td className="p-5 text-sm text-muted-foreground">
        {format(new Date(user.createdAt), "MMM d, yyyy")}
      </td>
      <td className="p-5 text-right">
        <div className="flex items-center justify-end gap-1">
          {isSuperAdmin && user.role !== "super_admin" && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-amber-500/10 hover:text-amber-400 text-muted-foreground/50"
                    onClick={() => onRevealPassword(user)}
                  >
                    <KeyRound className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">View password</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {canActOnUser && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 hover:bg-primary/10 hover:text-primary"
                onClick={() => onEdit(user)}
                title="Edit user"
              >
                <Pencil className="w-4 h-4" />
              </Button>
              {!isMe && !user.isOwner && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onDelete(user)}
                  title="Delete user"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </>
          )}
          {!canActOnUser && !isMe && user.role !== "super_admin" && (
            <span className="text-xs text-muted-foreground/50 pr-2">Owner only</span>
          )}
        </div>
      </td>
    </tr>
  );
}

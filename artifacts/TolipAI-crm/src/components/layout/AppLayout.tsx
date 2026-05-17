import React, { useEffect, useRef, useState } from "react";
import { apiFetch, apiRawFetch } from "@/lib/api";
import { useLocation, Link } from "wouter";
import {
  LayoutDashboard,
  Users,
  CheckSquare,
  Settings,
  Link as LinkIcon,
  LogOut,
  Menu,
  Building,
  Globe,
  Shield,
  Columns,
  Mail,
  Bell,
  X,
  Sun,
  Moon,
  BookUser,
  Database,
  Zap,
  Plug,
  Phone,
  BarChart2,
  PhoneCall,
  Gauge,
  Users2,
  CreditCard,
  Hash,
  Voicemail,
} from "lucide-react";
import { useTheme } from "@/hooks/use-theme";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCrmGetMe } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

interface AppLayoutProps {
  children: React.ReactNode;
}

function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    // Browsers suspend AudioContext until a user gesture — resume() honours that
    // without throwing, so the sound plays correctly after the first interaction.
    ctx.resume().then(() => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
      setTimeout(() => ctx.close(), 600);
    }).catch(() => {});
  } catch (_) {}
}


function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const prevUnread = useRef<number | null>(null);
  useEffect(() => { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); }, []);
  const { data } = useQuery<any>({ queryKey: ["crm-notifications"], queryFn: () => apiFetch("/notifications"), refetchInterval: 15_000 });
  const markAllRead = useMutation({ mutationFn: () => apiFetch("/notifications/read-all", { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["crm-notifications"] }) });
  const markRead = useMutation({ mutationFn: (id: number) => apiFetch(`/notifications/${id}/read`, { method: "POST" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["crm-notifications"] }) });
  const unread = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];
  useEffect(() => { if (prevUnread.current === null) { prevUnread.current = unread; return; } if (unread > prevUnread.current) { const newCount = unread - prevUnread.current; playNotificationSound(); if ("Notification" in window && Notification.permission === "granted") new Notification("TolipAI CRM", { body: newCount === 1 ? "You have 1 new notification." : `You have ${newCount} new notifications.`, icon: "/favicon.ico", tag: "crm-notification" }); } prevUnread.current = unread; }, [unread]);
  useEffect(() => { const base = "TolipAI CRM"; document.title = unread > 0 ? `(${unread}) ${base}` : base; return () => { document.title = base; }; }, [unread]);
  return (<div className="relative"><button onClick={() => { setOpen(o => !o); }} className="relative p-2 rounded-xl hover:bg-secondary transition-colors" title="Notifications"><Bell className="w-5 h-5 text-muted-foreground" />{unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center px-1">{unread > 99 ? "99+" : unread}</span>}</button>{open && (<><div className="fixed inset-0 z-40" onClick={() => setOpen(false)} /><div className="absolute left-0 bottom-12 z-50 w-80 bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"><div className="flex items-center justify-between p-3 border-b border-border bg-secondary/30"><span className="font-semibold text-sm">Notifications</span><div className="flex items-center gap-1">{unread > 0 && <button onClick={() => markAllRead.mutate()} className="text-xs text-primary hover:underline px-2">Mark all read</button>}<button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-secondary"><X className="w-3.5 h-3.5" /></button></div></div><div className="max-h-80 overflow-y-auto">{notifications.length === 0 ? <div className="p-6 text-center text-muted-foreground text-sm italic">No notifications yet.</div> : notifications.map((n: any) => (<div key={n.id} className={`p-3 border-b border-border last:border-0 cursor-pointer hover:bg-secondary/50 transition-colors ${!n.read ? "bg-primary/5" : ""}`} onClick={() => { if (!n.read) markRead.mutate(n.id); if (n.leadId) window.location.href = `/crm/leads/${n.leadId}`; setOpen(false); }}><p className="text-sm text-foreground leading-snug">{n.content}</p><p className="text-xs text-muted-foreground mt-1">{format(new Date(n.createdAt), "MMM d, h:mm a")}</p>{!n.read && <span className="inline-block w-2 h-2 rounded-full bg-primary mt-1" />}</div>))}</div></div></>)} </div>);
}

export function AppLayout({ children }: AppLayoutProps) {
  const [location, setLocation] = useLocation();
  const { data: user, isLoading, isError } = useCrmGetMe();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const { isDark, toggleTheme } = useTheme();
  useEffect(() => { if (isError) setLocation("/login"); }, [isError, setLocation]);
  const handleLogout = () => { localStorage.removeItem("crm_token"); setLocation("/login"); };
  const [sseLeadDelta, setSseLeadDelta] = React.useState(0);
  const sseRef = useRef<EventSource | null>(null);
  useEffect(() => {
    const token = localStorage.getItem("crm_token");
    if (!token || !user) return;
    if (sseRef.current) return;
    const es = new EventSource(`/api/crm/events?token=${encodeURIComponent(token)}`);
    sseRef.current = es;
    const handler = () => setSseLeadDelta(d => d + 1);
    es.addEventListener("lead_created", handler);
    return () => { es.close(); sseRef.current = null; };
  }, [user]);
  const { data: newLeadsData } = useQuery<any>({ queryKey: ["crm-stats"], queryFn: () => apiFetch("/stats"), refetchInterval: 60_000, enabled: !!user });
  useEffect(() => { if (newLeadsData) setSseLeadDelta(0); }, [newLeadsData]);
  const { data: pendingTasksData } = useQuery<any>({ queryKey: ["crm-nav-pending-tasks"], queryFn: () => apiFetch("/tasks?status=pending"), refetchInterval: 30_000, enabled: !!user });
  const { data: voicemailCountData } = useQuery<any>({ queryKey: ["crm-voicemail-unread-count"], queryFn: () => apiRawFetch("/twilio/voice/voicemails/unread-count"), refetchInterval: 30_000, enabled: !!user });
  if (isLoading || !user) return <div className="min-h-screen bg-background flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary" /></div>;
  const isSuperAdmin = user.role === "super_admin";
  const isAdmin = user.role === "admin" || isSuperAdmin;
  const newLeadsCount: number = (newLeadsData?.newLeadsLast24h ?? 0) + sseLeadDelta;
  const pendingTasksCount: number = Array.isArray(pendingTasksData) ? pendingTasksData.length : 0;
  const voicemailUnreadCount: number = voicemailCountData?.count ?? 0;
  const mainNavItems = isSuperAdmin ? [{ label: "Campaigns", href: "/campaigns", icon: Globe }, { label: "All Leads", href: "/leads", icon: Users, badge: newLeadsCount }, { label: "Pipeline", href: "/pipeline", icon: Columns }, { label: "Analytics", href: "/analytics", icon: BarChart2 }, { label: "Call Quality", href: "/analytics/call-quality", icon: Gauge }, { label: "All Tasks", href: "/tasks", icon: CheckSquare, badge: pendingTasksCount }, { label: "Buyers List", href: "/buyers", icon: BookUser }, { label: "Cash Buyer DB", href: "/cash-buyers", icon: Database }, { label: "Distressed Lead Gen", href: "/lead-gen", icon: Zap }, { label: "Power Dialer", href: "/dialer/power", icon: PhoneCall }, { label: "Voicemail Inbox", href: "/voicemail", icon: Voicemail, badge: voicemailUnreadCount }] : [{ label: "Dashboard", href: "/", icon: LayoutDashboard }, { label: "Leads", href: "/leads", icon: Users, badge: newLeadsCount }, { label: "Pipeline", href: "/pipeline", icon: Columns }, { label: "Analytics", href: "/analytics", icon: BarChart2 }, { label: "Call Quality", href: "/analytics/call-quality", icon: Gauge }, { label: "Tasks", href: "/tasks", icon: CheckSquare, badge: pendingTasksCount }, { label: "Buyers List", href: "/buyers", icon: BookUser }, { label: "Cash Buyer DB", href: "/cash-buyers", icon: Database }, { label: "Distressed Lead Gen", href: "/lead-gen", icon: Zap }, { label: "Power Dialer", href: "/dialer/power", icon: PhoneCall }, { label: "Voicemail Inbox", href: "/voicemail", icon: Voicemail, badge: voicemailUnreadCount }];
  const adminNavItems = [{ label: "Team Users", href: "/admin/users", icon: Settings }, { label: "Submission Links", href: "/admin/links", icon: LinkIcon }, { label: "Email Sequences", href: "/admin/sequences", icon: Mail }, ...(!isSuperAdmin ? [{ label: "Billing", href: "/admin/billing", icon: CreditCard }] : [])];
  const superAdminNavItems = [{ label: "Waitlist", href: "/admin/waitlist", icon: Users2 }];
  const NavLink = ({ href, icon: Icon, label, badge }: { href: string; icon: any; label: string; badge?: number }) => { const isActive = href === "/" ? location === "/" : location.startsWith(href); return (<Link href={href} onClick={() => setIsMobileMenuOpen(false)}><div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200 ${isActive ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground hover:bg-secondary"}`}><Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? "text-primary" : ""}`} /><span className="flex-1">{label}</span>{badge != null && badge > 0 && <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold leading-none">{badge > 99 ? "99+" : badge}</span>}</div></Link>); };
  return (<div className="min-h-screen bg-background flex flex-col md:flex-row"><div className="md:hidden flex items-center justify-between p-4 border-b border-border bg-card"><div className="flex items-center gap-2"><Building className="w-6 h-6 text-primary" /><span className="font-display font-bold text-lg">TolipAI CRM</span></div><Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}><Menu className="w-6 h-6" /></Button></div><div className={`fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border transform transition-transform duration-200 ease-in-out flex flex-col md:translate-x-0 md:static ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}><div className="p-6 hidden md:flex items-center gap-3"><div className="bg-primary/10 p-2 rounded-xl border border-primary/20 shadow-[0_0_15px_rgba(99,102,241,0.2)]"><Building className="w-6 h-6 text-primary" /></div><div><span className="font-display font-bold text-xl tracking-tight block">TolipAI CRM</span>{isSuperAdmin && <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/20 mt-0.5">Super Admin</Badge>}{!isSuperAdmin && (user as any).campaignName && <span className="text-xs text-muted-foreground truncate block max-w-[130px]">{(user as any).campaignName}</span>}</div></div><div className="flex-1 overflow-y-auto py-4 px-3 space-y-1"><div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-3">{isSuperAdmin ? "System" : "Main Menu"}</div>{mainNavItems.map((item) => (<NavLink key={item.href} {...item} />))}{isAdmin && (<><div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-8 mb-2 px-3">Integrations</div><NavLink href="/integrations" icon={Shield} label="Integrations" /><NavLink href="/integrations/twilio" icon={Phone} label="Twilio" /><NavLink href="/phone-numbers" icon={Hash} label="Phone Numbers" /></>)}{isSuperAdmin && (<><NavLink href="/integrations/propelio" icon={Building} label="Propelio" /><NavLink href="/integrations/propwire" icon={Plug} label="Propwire" /></>)}{isAdmin && (<><div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-8 mb-2 px-3">Administration</div>{adminNavItems.map((item) => (<NavLink key={item.href} {...item} />))}{isSuperAdmin && superAdminNavItems.map((item) => (<NavLink key={item.href} {...item} />))}</>)}
        </div><div className="p-4 border-t border-border bg-card/50"><div className="flex items-center gap-2 mb-3 px-1"><div className="w-9 h-9 rounded-full bg-gradient-to-tr from-primary to-accent flex items-center justify-center text-primary-foreground font-bold shadow-lg flex-shrink-0 text-sm">{user.name.charAt(0).toUpperCase()}</div><div className="overflow-hidden min-w-0 flex-1"><div className="font-medium text-sm truncate text-foreground">{user.name}</div><div className="text-xs text-muted-foreground flex items-center gap-1">{isSuperAdmin && <Shield className="w-3 h-3 text-amber-400" />}<span className="capitalize">{user.role.replace("_", " ")}</span></div></div><div className="flex items-center gap-1"><button onClick={toggleTheme} title={isDark ? "Switch to light mode" : "Switch to dark mode"} className="p-2 rounded-xl hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground">{isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</button><NotificationBell /></div></div><Button variant="outline" className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10 hover:border-destructive/20" onClick={handleLogout}><LogOut className="w-4 h-4 mr-2" />Sign Out</Button></div></div><div className="flex-1 flex flex-col h-screen overflow-hidden bg-background relative"><div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" /><main className="flex-1 overflow-y-auto p-4 pb-20 md:p-8 md:pb-20 z-10">{children}</main></div>{isMobileMenuOpen && <div className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)} />}</div>);
}

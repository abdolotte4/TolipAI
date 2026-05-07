import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Mail, Users, LogOut, Eye,
  Clock, CheckCircle, AlertCircle, RefreshCw, ExternalLink, CreditCard
} from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

interface Contact {
  id: number; name: string; email: string; company?: string | null;
  phone?: string | null; service?: string | null; message: string;
  read: boolean; createdAt: string;
}
interface StripeSubscriber {
  id: string; customerId: string; name: string; email: string;
  company: string; planLabel: string; planAmount: string; priceId: string;
  status: string; currentPeriodStart: string; currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean; createdAt: string; stripeUrl: string;
  tosAccepted: boolean; tosAcceptedAt: string | null;
}
interface Stats {
  totalContacts: number; unreadContacts: number;
  totalSubscribers: number; recentContacts: Contact[];
}

function LoginPage({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      onLogin(data.token);
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0e1a] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">DIGOR<span className="text-[#d4af37]">.</span></h1>
          <p className="text-gray-400 mt-2">Admin Panel</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-[#111827] border border-[#1f2937] rounded-2xl p-8 shadow-2xl">
          <h2 className="text-xl font-semibold text-white mb-6">Sign In</h2>
          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Username</label>
              <input
                type="text" value={username} onChange={e => setUsername(e.target.value)} required
                className="w-full px-4 py-3 bg-[#0a0e1a] border border-[#374151] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#d4af37] transition-colors"
                placeholder="Enter username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Password</label>
              <input
                type="password" value={password} onChange={e => setPassword(e.target.value)} required
                className="w-full px-4 py-3 bg-[#0a0e1a] border border-[#374151] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-[#d4af37] transition-colors"
                placeholder="Enter password"
              />
            </div>
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full mt-6 py-3 bg-[#d4af37] text-[#0a0e1a] font-semibold rounded-lg hover:bg-[#b8962e] transition-colors disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, sub, color }: { icon: any; label: string; value: number; sub?: string; color: string }) {
  return (
    <div className="bg-[#111827] border border-[#1f2937] rounded-xl p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-gray-400 text-sm font-medium">{label}</p>
          <p className="text-3xl font-bold text-white mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-500 mt-1">{sub}</p>}
        </div>
        <div className={`p-3 rounded-lg ${color}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [tab, setTab] = useState<"overview" | "contacts" | "subscribers">("overview");
  const [stats, setStats] = useState<Stats | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [stripeSubscribers, setStripeSubscribers] = useState<StripeSubscriber[]>([]);
  const [stripeTotal, setStripeTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [expandedContact, setExpandedContact] = useState<number | null>(null);

  const headers = { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" };

  const fetchStats = useCallback(async () => {
    const res = await fetch(`${API_BASE}/api/admin/stats`, { headers });
    if (res.ok) setStats(await res.json());
  }, [token]);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${API_BASE}/api/admin/contacts?limit=50`, { headers });
    if (res.ok) { const d = await res.json(); setContacts(d.contacts); }
    setLoading(false);
  }, [token]);

  const fetchStripeSubscriptions = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${API_BASE}/api/stripe/subscriptions`, { headers });
    if (res.ok) {
      const d = await res.json();
      setStripeSubscribers(d.subscriptions);
      setStripeTotal(d.total);
    }
    setLoading(false);
  }, [token]);

  const markRead = async (id: number) => {
    await fetch(`${API_BASE}/api/admin/contacts/${id}/read`, { method: "PATCH", headers });
    setContacts(prev => prev.map(c => c.id === id ? { ...c, read: true } : c));
    fetchStats();
  };

  useEffect(() => { fetchStats(); fetchStripeSubscriptions(); }, [fetchStats, fetchStripeSubscriptions]);
  useEffect(() => { if (tab === "contacts") fetchContacts(); }, [tab, fetchContacts]);
  useEffect(() => { if (tab === "subscribers") fetchStripeSubscriptions(); }, [tab, fetchStripeSubscriptions]);

  const serviceLabels: Record<string, string> = {
    "data-engineering": "Data Engineering",
    "managed-outreach": "Managed Outreach",
    "crm-infrastructure": "Technical CRM",
    "full-suite": "Full Suite",
  };

  return (
    <div className="min-h-screen bg-[#0a0e1a] text-white">
      {/* Header */}
      <header className="bg-[#111827] border-b border-[#1f2937] px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">DIGOR<span className="text-[#d4af37]">.</span> <span className="text-gray-400 font-normal text-sm">Admin</span></h1>
          <nav className="hidden md:flex gap-1">
            {(["overview", "contacts", "subscribers"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${tab === t ? "bg-[#d4af37] text-[#0a0e1a]" : "text-gray-400 hover:text-white hover:bg-[#1f2937]"}`}>
                {t}
              </button>
            ))}
          </nav>
        </div>
        <button onClick={onLogout} className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors text-sm">
          <LogOut className="w-4 h-4" /> Sign Out
        </button>
      </header>

      {/* Mobile tabs */}
      <div className="md:hidden flex gap-1 p-4 bg-[#111827] border-b border-[#1f2937]">
        {(["overview", "contacts", "subscribers"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium capitalize transition-colors ${tab === t ? "bg-[#d4af37] text-[#0a0e1a]" : "text-gray-400 hover:text-white bg-[#1f2937]"}`}>
            {t}
          </button>
        ))}
      </div>

      <main className="p-6 max-w-7xl mx-auto">

        {/* OVERVIEW */}
        {tab === "overview" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Dashboard Overview</h2>
              <button onClick={fetchStats} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <StatCard icon={Mail} label="Total Inquiries" value={stats?.totalContacts ?? 0} sub="All time" color="bg-blue-500/20 text-blue-400" />
              <StatCard icon={AlertCircle} label="Unread Inquiries" value={stats?.unreadContacts ?? 0} sub="Needs attention" color="bg-amber-500/20 text-amber-400" />
              <StatCard icon={CreditCard} label="Stripe Subscribers" value={stripeTotal} sub="Live from Stripe" color="bg-green-500/20 text-green-400" />
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-[#d4af37]" /> Recent Inquiries
              </h3>
              {!stats?.recentContacts?.length ? (
                <div className="bg-[#111827] border border-[#1f2937] rounded-xl p-8 text-center text-gray-500">
                  No inquiries yet. They will appear here once someone submits the contact form.
                </div>
              ) : (
                <div className="space-y-3">
                  {stats.recentContacts.map(c => (
                    <div key={c.id} className={`bg-[#111827] border rounded-xl p-4 flex items-start justify-between gap-4 ${c.read ? "border-[#1f2937]" : "border-[#d4af37]/40"}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-white">{c.name}</span>
                          {!c.read && <span className="text-xs bg-[#d4af37]/20 text-[#d4af37] px-2 py-0.5 rounded-full">New</span>}
                          {c.service && <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">{serviceLabels[c.service] || c.service}</span>}
                        </div>
                        <p className="text-sm text-gray-400 mt-0.5">{c.email} {c.company ? `• ${c.company}` : ""}</p>
                        <p className="text-xs text-gray-500 mt-1">{formatDate(c.createdAt)}</p>
                      </div>
                      <button onClick={() => setTab("contacts")} className="text-xs text-[#d4af37] hover:underline whitespace-nowrap">View all</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* CONTACTS */}
        {tab === "contacts" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Contact Inquiries</h2>
              <button onClick={fetchContacts} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
            </div>
            {loading ? (
              <div className="text-center py-12 text-gray-500">Loading...</div>
            ) : contacts.length === 0 ? (
              <div className="bg-[#111827] border border-[#1f2937] rounded-xl p-12 text-center text-gray-500">
                No contact inquiries yet.
              </div>
            ) : (
              <div className="space-y-3">
                {contacts.map(c => (
                  <div key={c.id} className={`bg-[#111827] border rounded-xl overflow-hidden transition-all ${c.read ? "border-[#1f2937]" : "border-[#d4af37]/40"}`}>
                    <div
                      className="p-4 flex items-start justify-between gap-4 cursor-pointer hover:bg-[#1a2234] transition-colors"
                      onClick={() => { setExpandedContact(expandedContact === c.id ? null : c.id); if (!c.read) markRead(c.id); }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold">{c.name}</span>
                          {!c.read && <span className="text-xs bg-[#d4af37]/20 text-[#d4af37] px-2 py-0.5 rounded-full">New</span>}
                          {c.service && <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">{serviceLabels[c.service] || c.service}</span>}
                        </div>
                        <p className="text-sm text-gray-400 mt-0.5">{c.email}{c.company ? ` • ${c.company}` : ""}{c.phone ? ` • ${c.phone}` : ""}</p>
                        <p className="text-xs text-gray-500 mt-1">{formatDate(c.createdAt)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {c.read ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Eye className="w-4 h-4 text-[#d4af37]" />}
                      </div>
                    </div>
                    {expandedContact === c.id && (
                      <div className="border-t border-[#1f2937] p-4 bg-[#0f1624]">
                        <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{c.message}</p>
                        <div className="mt-3 flex gap-3">
                          <a href={`mailto:${c.email}?subject=Re: Inquiry from TolipAI LLC`} className="text-xs bg-[#d4af37] text-[#0a0e1a] font-semibold px-3 py-1.5 rounded-lg hover:bg-[#b8962e] transition-colors">
                            Reply via Email
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SUBSCRIBERS */}
        {tab === "subscribers" && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold">Stripe Subscriptions</h2>
                <p className="text-gray-500 text-sm mt-1">Live data pulled directly from Stripe</p>
              </div>
              <button onClick={fetchStripeSubscriptions} className="flex items-center gap-2 text-gray-400 hover:text-white text-sm">
                <RefreshCw className="w-4 h-4" /> Refresh
              </button>
            </div>
            {loading ? (
              <div className="text-center py-12 text-gray-500">Loading from Stripe...</div>
            ) : stripeSubscribers.length === 0 ? (
              <div className="bg-[#111827] border border-[#1f2937] rounded-xl p-12 text-center text-gray-500">
                No Stripe subscriptions found. They will appear here once a customer completes checkout.
              </div>
            ) : (
              <div className="space-y-4">
                {stripeSubscribers.map(s => {
                  const statusColor =
                    s.status === "active" ? "bg-green-500/20 text-green-400" :
                    s.status === "past_due" ? "bg-red-500/20 text-red-400" :
                    s.status === "canceled" ? "bg-gray-500/20 text-gray-400" :
                    s.status === "trialing" ? "bg-blue-500/20 text-blue-400" :
                    "bg-amber-500/20 text-amber-400";
                  const planColor =
                    s.planLabel === "Full Package" ? "bg-[#d4af37]/20 text-[#d4af37]" :
                    s.planLabel === "Growth Infrastructure" ? "bg-amber-600/20 text-amber-400" :
                    "bg-blue-500/20 text-blue-400";
                  return (
                    <div key={s.id} className="bg-[#111827] border border-[#1f2937] rounded-xl p-5">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-white text-lg">{s.name}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColor}`}>
                              {s.cancelAtPeriodEnd ? "canceling" : s.status}
                            </span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${planColor}`}>
                              {s.planLabel}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-400">
                            <a href={`mailto:${s.email}`} className="hover:text-[#d4af37] transition-colors">{s.email}</a>
                            {s.company && s.company !== "—" && <span>• {s.company}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <a
                            href={s.stripeUrl} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-xs bg-[#1f2937] hover:bg-[#2d3a50] text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" /> View in Stripe
                          </a>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                        <div className="bg-[#0a0e1a] rounded-lg p-2.5">
                          <p className="text-gray-500 mb-0.5">Amount</p>
                          <p className="text-white font-medium">{s.planAmount}</p>
                        </div>
                        <div className="bg-[#0a0e1a] rounded-lg p-2.5">
                          <p className="text-gray-500 mb-0.5">Subscribed</p>
                          <p className="text-white font-medium">{formatDate(s.createdAt)}</p>
                        </div>
                        <div className="bg-[#0a0e1a] rounded-lg p-2.5">
                          <p className="text-gray-500 mb-0.5">Current Period</p>
                          <p className="text-white font-medium">{new Date(s.currentPeriodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                        </div>
                        <div className="bg-[#0a0e1a] rounded-lg p-2.5">
                          <p className="text-gray-500 mb-0.5">TOS Accepted</p>
                          <p className={`font-medium ${s.tosAccepted ? "text-green-400" : "text-red-400"}`}>
                            {s.tosAccepted ? (s.tosAcceptedAt ? formatDate(s.tosAcceptedAt) : "Yes") : "Not recorded"}
                          </p>
                        </div>
                      </div>
                      {s.cancelAtPeriodEnd && (
                        <div className="mt-3 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-400">
                          Subscription set to cancel at end of current period ({new Date(s.currentPeriodEnd).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function Admin() {
  // Prevent search engines from indexing the admin page
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => { document.head.removeChild(meta); };
  }, []);

  const [token, setToken] = useState<string | null>(() => localStorage.getItem("digor_admin_token"));

  const handleLogin = (t: string) => {
    localStorage.setItem("digor_admin_token", t);
    setToken(t);
  };

  const handleLogout = () => {
    localStorage.removeItem("digor_admin_token");
    setToken(null);
  };

  if (!token) return <LoginPage onLogin={handleLogin} />;
  return <Dashboard token={token} onLogout={handleLogout} />;
}

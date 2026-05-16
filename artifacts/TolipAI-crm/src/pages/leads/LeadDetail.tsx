import { useState, useEffect, useRef, memo, useMemo, lazy, Suspense } from "react";
import BrowserDialer from "@/components/leads/BrowserDialer";
import { apiFetch, apiRawFetch } from "@/lib/api";
import { useParams, Link, useLocation } from "wouter";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { format, differenceInDays } from "date-fns";
import {
  ArrowLeft, Trash2, Home, User, DollarSign, Calculator,
  MessageSquare, CheckSquare, Plus, Clock, FileText,
  Mail, Bell, BellOff, UserCheck, Activity, Archive,
  RefreshCw, Database, Search,
  Phone, Send, PhoneCall, PhoneIncoming, ChevronDown, Copy, Check,
  Loader2,
} from "lucide-react";
import {
  useCrmUpdateLead,
  useCrmDeleteLead,
  useCrmAddLeadNote,
  useCrmCreateTask,
  useCrmFetchPropertyData,
  useCrmSkipTrace,
  useCrmGetComps,
  useCrmCreateComp,
  useCrmDeleteComp,
  useCrmRecalculateComps,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUSES = ['new', 'contacted', 'qualified', 'negotiating', 'under_contract', 'closed'];
const PROPERTY_TYPES = ["Single Family", "Multi Family", "Condo", "Townhouse", "Mobile Home", "Commercial", "Land", "Other"];
const OCCUPANCY_OPTIONS = ["Owner Occupied", "Tenant Occupied", "Rented", "Vacant", "Unknown"];
const LEAD_SOURCES = ["Phone Outreach", "Direct Mail", "Text Blast", "Driving for Dollars", "Online Ads", "Referral", "Wholesale", "MLS", "Submission Form", "Other"];
const REASON_OPTIONS = ["Divorce", "Probate", "Job Loss", "Relocation", "Downsizing", "Inherited", "Behind on Payments", "Major Repairs Needed", "Tired Landlord", "Other"];
const HOW_SOON_OPTIONS = ["ASAP", "Within 30 Days", "1-3 Months", "3-6 Months", "6+ Months", "Just Exploring"];

// ─── Address auto-parser ──────────────────────────────────────────────────────
function parseFullAddress(raw: string): { address?: string; city?: string; state?: string; zip?: string } | null {
  const s = raw.trim();
  // Format 1: "Street, City, ST ZIP"  (two commas)
  let m = s.match(/^(.+?),\s*(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m) return { address: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4].trim() };
  // Format 2: "Street City, ST ZIP"  (city runs into street, one comma before state)
  m = s.match(/^(.*\b(?:St|Ave|Blvd|Dr|Rd|Ct|Ln|Way|Pl|Ter|Cir|Hwy|Pkwy|Sq|Loop|Trl|Pass)\.?)\s+(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  if (m) return { address: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4].trim() };
  // Format 3: "Street, ST ZIP"  (no city field)
  m = s.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (m) return { address: m[1].trim(), city: undefined, state: m[2].toUpperCase(), zip: m[3].trim() };
  return null;
}


function fmt$(v: any) {
  if (!v && v !== 0) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(v));
}

// ─── Property Map ─────────────────────────────────────────────────────────────
function PropertyMap({ address, city, state, zip }: { address?: string; city?: string; state?: string; zip?: string }) {
  const parts = [address, city, state, zip].filter(Boolean);
  if (parts.length === 0) return null;
  const query = encodeURIComponent(parts.join(", "));
  const src = `https://maps.google.com/maps?q=${query}&output=embed&z=15`;
  return (
    <div className="md:col-span-3 mt-1 rounded-xl overflow-hidden border border-border">
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${query}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block text-xs text-muted-foreground bg-secondary/30 px-3 py-1.5 hover:bg-secondary transition-colors flex items-center gap-1.5"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>
        </svg>
        {parts.join(", ")}
        <span className="ml-auto opacity-50">Open in Maps ↗</span>
      </a>
      <iframe
        title="Property Location"
        src={src}
        width="100%"
        height="220"
        style={{ border: 0, display: "block" }}
        allowFullScreen={false}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}

// ─── Select helper ────────────────────────────────────────────────────────────
function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <select
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        className="w-full h-10 rounded-xl border border-border bg-background/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      >
        <option value="">— Select —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ─── @Mention Textarea ────────────────────────────────────────────────────────
const MentionTextarea = memo(function MentionTextarea({
  value, onChange, users, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  users: any[];
  placeholder?: string;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [query, setQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    onChange(val);

    const cursor = e.target.selectionStart;
    const textUpToCursor = val.slice(0, cursor);
    const atMatch = textUpToCursor.match(/@(\w*)$/);
    if (atMatch) {
      setQuery(atMatch[1].toLowerCase());
      setShowDropdown(true);
    } else {
      setShowDropdown(false);
    }
  };

  const insertMention = (username: string) => {
    if (!textareaRef.current) return;
    const cursor = textareaRef.current.selectionStart;
    const textUpToCursor = value.slice(0, cursor);
    const atIdx = textUpToCursor.lastIndexOf("@");
    const newVal = value.slice(0, atIdx) + `@${username} ` + value.slice(cursor);
    onChange(newVal);
    setShowDropdown(false);
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const filtered = users.filter(u =>
    u.username?.toLowerCase().includes(query) || u.name?.toLowerCase().includes(query)
  ).slice(0, 6);

  return (
    <div className="relative">
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        placeholder={placeholder || "Add a note... (use @username to mention someone)"}
        className="bg-background/80 rounded-xl resize-none min-h-[80px] text-sm"
      />
      {showDropdown && filtered.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 w-56 bg-card border border-border rounded-xl shadow-xl z-50 overflow-hidden">
          {filtered.map(u => (
            <button
              key={u.id}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-secondary text-sm flex items-center gap-2"
              onClick={() => insertMention(u.username || u.name)}
            >
              <div className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold flex-shrink-0">
                {(u.name || u.username || "?").charAt(0).toUpperCase()}
              </div>
              <span className="font-medium">{u.name}</span>
              <span className="text-muted-foreground text-xs">@{u.username}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

// ─── Offer Letter ─────────────────────────────────────────────────────────────
function openOfferLetter(lead: any, mao: number, campaign?: any) {
  const companyName = campaign?.name || "TolipAI LLC";
  const formattedMao = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(mao);
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Purchase Offer - ${lead.address}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Georgia', serif; color: #1a1a1a; background: white; padding: 60px; max-width: 800px; margin: 0 auto; line-height: 1.7; }

    /* ── Edit toolbar (hidden on print) ── */
    #toolbar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
      background: #1a1a1a; color: white; padding: 10px 20px;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      font-family: system-ui, sans-serif; font-size: 14px;
    }
    #toolbar .hint { opacity: 0.65; font-size: 12px; }
    #toolbar button {
      background: white; color: #1a1a1a; border: none; border-radius: 6px;
      padding: 7px 20px; font-size: 14px; font-weight: 700; cursor: pointer;
    }
    #toolbar button:hover { background: #e8e8e8; }
    body { padding-top: 100px; }

    /* ── Editable highlight ── */
    [contenteditable]:hover { outline: 2px dashed #aaa; border-radius: 2px; cursor: text; }
    [contenteditable]:focus { outline: 2px solid #1a1a1a; border-radius: 2px; }

    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1a1a1a; padding-bottom: 24px; margin-bottom: 32px; }
    .company-name { font-size: 28px; font-weight: bold; letter-spacing: -0.5px; }
    .company-sub { font-size: 13px; color: #555; margin-top: 4px; }
    .date-right { text-align: right; font-size: 14px; color: #555; }
    h1 { font-size: 22px; text-align: center; margin-bottom: 28px; text-transform: uppercase; letter-spacing: 2px; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; color: #888; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 14px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 40px; }
    .field label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
    .field p { font-size: 15px; font-weight: 600; }
    .offer-box { background: #f8f8f8; border: 2px solid #1a1a1a; border-radius: 4px; padding: 24px; text-align: center; margin: 28px 0; }
    .offer-label { font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: #666; }
    .offer-amount { font-size: 48px; font-weight: bold; color: #1a1a1a; margin: 8px 0; }
    .offer-note { font-size: 12px; color: #888; }
    .terms { background: #fafafa; padding: 20px; border-left: 4px solid #1a1a1a; margin: 24px 0; font-size: 14px; }
    .terms ul { padding-left: 20px; }
    .terms li { margin-bottom: 8px; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; margin-top: 60px; }
    .sig-line { border-top: 1px solid #1a1a1a; padding-top: 8px; font-size: 13px; margin-top: 50px; }
    .sig-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
    @media print { #toolbar { display: none !important; } body { padding-top: 60px !important; } [contenteditable] { outline: none !important; } }
  </style>
</head>
<body>
  <div id="toolbar">
    <div>
      <div style="font-weight:700;font-size:15px;">Preview &amp; Edit Offer Letter</div>
      <div class="hint">Click any text to edit before printing</div>
    </div>
    <button onclick="window.print()">🖨 Print</button>
  </div>

  <div class="header">
    <div>
      <div class="company-name" contenteditable="true">${companyName}</div>
      <div class="company-sub" contenteditable="true">${campaign?.address || ""}</div>
      <div class="company-sub" contenteditable="true">${campaign?.email || ""}</div>
    </div>
    <div class="date-right">
      <strong>Date:</strong> <span contenteditable="true">${today}</span><br>
      <strong>Ref:</strong> OL-${lead.id}-${Date.now().toString(36).toUpperCase()}
    </div>
  </div>
  <h1 contenteditable="true">Letter of Intent to Purchase</h1>
  <div class="section">
    <div class="section-title">Property Information</div>
    <div class="grid">
      <div class="field"><label>Property Address</label><p contenteditable="true">${lead.address || "—"}</p></div>
      <div class="field"><label>City, State, ZIP</label><p contenteditable="true">${[lead.city, lead.state, lead.zip].filter(Boolean).join(", ") || "—"}</p></div>
      <div class="field"><label>Property Type</label><p contenteditable="true">${lead.propertyType || "Residential"}</p></div>
      <div class="field"><label>Beds / Baths / Sq Ft</label><p contenteditable="true">${lead.beds || "—"} bd / ${lead.baths || "—"} ba / ${lead.sqft ? lead.sqft.toLocaleString() : "—"} sqft</p></div>
      <div class="field"><label>Year Built</label><p contenteditable="true">${lead.yearBuilt || "—"}</p></div>
      <div class="field"><label>Owner Name</label><p contenteditable="true">${lead.ownerName || "—"}</p></div>
      <div class="field"><label>Last Sale Date</label><p contenteditable="true">${lead.lastSaleDate || "—"}</p></div>
      <div class="field"><label>Last Sale Price</label><p contenteditable="true">${lead.lastSalePrice ? "$" + Number(lead.lastSalePrice).toLocaleString() : "—"}</p></div>
    </div>
  </div>
  <div class="section">
    <div class="section-title">Seller Information</div>
    <div class="grid">
      <div class="field"><label>Seller Name</label><p contenteditable="true">${lead.sellerName}</p></div>
      <div class="field"><label>Phone</label><p contenteditable="true">${lead.phone || "—"}</p></div>
      <div class="field"><label>Email</label><p contenteditable="true">${lead.email || "—"}</p></div>
      <div class="field"><label>Lead Source</label><p contenteditable="true">${lead.leadSource || "—"}</p></div>
    </div>
  </div>
  <div class="offer-box">
    <div class="offer-label">All-Cash Purchase Offer</div>
    <div class="offer-amount" contenteditable="true">${formattedMao}</div>
    <div class="offer-note" contenteditable="true">Subject to inspection and due diligence · As-is condition</div>
  </div>
  <div class="section">
    <div class="section-title">Financial Summary</div>
    <div class="grid">
      <div class="field"><label>After Repair Value (ARV)</label><p contenteditable="true">${fmt$(lead.arv)}</p></div>
      <div class="field"><label>Est. Repair Cost (ERC)</label><p contenteditable="true">${fmt$(lead.estimatedRepairCost)}</p></div>
      <div class="field"><label>Seller's Asking Price</label><p contenteditable="true">${fmt$(lead.askingPrice)}</p></div>
      <div class="field"><label>Market Estimate</label><p contenteditable="true">${fmt$(lead.currentValue)}</p></div>
    </div>
  </div>
  <div class="terms" contenteditable="true">
    <div class="section-title">Terms &amp; Conditions</div>
    <ul>
      <li>This is a Letter of Intent only and is not legally binding until a formal Purchase &amp; Sale Agreement is executed by both parties.</li>
      <li>Buyer: ${companyName}, or its assigns.</li>
      <li>Closing: within 14–21 business days of accepted offer, subject to title search.</li>
      <li>Earnest Money: to be determined upon execution of Purchase &amp; Sale Agreement.</li>
      <li>Property to be purchased in <strong>as-is</strong> condition with no repairs required by Seller.</li>
      <li>Buyer reserves the right to assign this contract.</li>
      <li>This offer is valid for 5 business days from the date above.</li>
    </ul>
  </div>
  <div class="signatures">
    <div>
      <div class="sig-line">_________________________________</div>
      <div class="sig-label" contenteditable="true">Authorized Buyer – ${companyName}</div>
      <div class="sig-line" style="margin-top: 16px;">Date: ___________________</div>
    </div>
    <div>
      <div class="sig-line">_________________________________</div>
      <div class="sig-label" contenteditable="true">Seller – ${lead.sellerName}</div>
      <div class="sig-line" style="margin-top: 16px;">Date: ___________________</div>
    </div>
  </div>
</body>
</html>`;
  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}

// ─── Zillow Card ──────────────────────────────────────────────────────────────
function ZillowCard({ address, city, state, zip }: { address?: string; city?: string; state?: string; zip?: string }) {
  const parts = [address, city, state, zip].filter(Boolean);
  if (parts.length === 0) return null;

  const slug = parts.join(" ")
    .replace(/,/g, "")
    .replace(/\s+/g, "-");
  const zillowUrl = `https://www.zillow.com/homes/${slug}_rb/`;
  const realtorUrl = `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(parts.join(" "))}`;

  return (
    <Card className="rounded-2xl overflow-hidden border-white/5 bg-card shadow-lg">
      <div className="bg-gradient-to-r from-[#006AFF]/10 to-transparent p-4 border-b border-border flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-[#006AFF] flex items-center justify-center flex-shrink-0 shadow-lg shadow-[#006AFF]/30">
          <svg viewBox="0 0 40 40" fill="white" xmlns="http://www.w3.org/2000/svg" className="w-5 h-5">
            <path d="M20 3L1 16.5h6V37h26V16.5h6L20 3zm0 4.5l14 10.5v15.5h-6V24h-16v9.5H6V18L20 7.5z"/>
          </svg>
        </div>
        <div>
          <h2 className="font-display font-semibold">Zillow Property Lookup</h2>
          <p className="text-xs text-muted-foreground">View listing, Zestimate, and public records</p>
        </div>
      </div>
      <div className="p-5">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground mb-1">Property Address</p>
            <p className="font-semibold text-foreground truncate">{parts.join(", ")}</p>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              Click "View on Zillow" to see the Zestimate, tax history, price history, and comparable listings directly on Zillow's platform.
            </p>
          </div>
          <div className="flex flex-col gap-2 flex-shrink-0">
            <a
              href={zillowUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#006AFF] text-white text-sm font-semibold hover:bg-[#0057d4] transition-colors shadow-md shadow-[#006AFF]/20"
            >
              <svg viewBox="0 0 40 40" fill="white" xmlns="http://www.w3.org/2000/svg" className="w-4 h-4">
                <path d="M20 3L1 16.5h6V37h26V16.5h6L20 3zm0 4.5l14 10.5v15.5h-6V24h-16v9.5H6V18L20 7.5z"/>
              </svg>
              View on Zillow
            </a>
            <a
              href={realtorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              View on Realtor.com
            </a>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { label: "Zestimate", hint: "AI valuation" },
            { label: "Tax History", hint: "Annual records" },
            { label: "Price History", hint: "Sales & listings" },
            { label: "Comps", hint: "Nearby sold homes" },
          ].map(({ label, hint }) => (
            <a
              key={label}
              href={zillowUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex flex-col items-center p-3 bg-secondary/30 rounded-xl border border-border hover:bg-secondary hover:border-[#006AFF]/30 transition-all group text-center"
            >
              <span className="text-xs font-semibold text-foreground group-hover:text-[#006AFF] transition-colors">{label}</span>
              <span className="text-xs text-muted-foreground mt-0.5">{hint}</span>
            </a>
          ))}
        </div>

        <p className="text-xs text-muted-foreground/50 mt-3 text-center">
          Zillow data is provided externally and not controlled by TolipAI CRM
        </p>
      </div>
    </Card>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
// Lazy-loaded heavy components — code-split for faster initial render
const CompsSection     = lazy(() => import("@/components/leads/CompsSection"));
const AiRepairEstimator = lazy(() => import("@/components/leads/AiRepairEstimator"));
const AiDealScorer     = lazy(() => import("@/components/leads/AiDealScorer"));
const AiSellerScript   = lazy(() => import("@/components/leads/AiSellerScript"));
const AiOfferLetter    = lazy(() => import("@/components/leads/AiOfferLetter"));
const CashBuyerMatchPanel = lazy(() => import("@/components/leads/CashBuyerMatchPanel"));

function useDebouncedValue<T>(value: T, delay: number = 200): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function LeadDetail() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const leadId = Number(id);

  // Cache me for the whole session — it never changes while logged in
  const { data: me } = useQuery<any>({
    queryKey: ["/api/crm/me"],
    queryFn: () => apiFetch("/me"),
    staleTime: 10 * 60 * 1000,
  });

  // Eager: lead + tasks + followers (no comps, no notes — separate queries below)
  const { data: lead, isLoading } = useQuery<any>({
    queryKey: [`/api/crm/leads/${leadId}`],
    queryFn: () => apiFetch(`/leads/${leadId}/full?include=tasks,followers`),
    enabled: !!leadId,
    staleTime: 30 * 1000,
  });
  // Notes — separate paginated query so note activity doesn't bust the lead cache
  const { data: notesData } = useQuery<any[]>({
    queryKey: [`/api/crm/leads/${leadId}/notes`],
    queryFn: () => apiFetch(`/leads/${leadId}/notes?limit=20`),
    enabled: !!leadId,
    staleTime: 30 * 1000,
  });
  const notes: any[] = notesData ?? [];
  const tasks: any[] = (lead as any)?.tasks ?? [];

  // Campaign governance — changes rarely, cache 5 minutes
  const { data: campaignData } = useQuery<any>({
    queryKey: ["crm-campaign-lead", me?.campaignId],
    queryFn: async () => {
      if (!me?.campaignId) return null;
      const r = await apiFetch(`/campaigns`);
      const list = Array.isArray(r) ? r : [];
      return list.find((c: any) => c.id === me.campaignId) ?? null;
    },
    enabled: !!me?.campaignId,
    staleTime: 300_000,
  });

  // Campaign users — never changes during a session, cache forever
  const { data: campaignUsers = [] } = useQuery<any[]>({
    queryKey: ["crm-users-campaign"],
    queryFn: () => apiFetch("/users"),
    enabled: !!me,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  // Follow state — derived from lead detail response (no separate fetch needed)
  const isFollowing: boolean = (lead as any)?.isFollowing ?? false;
  const followerCount: number = (lead as any)?.followerCount ?? 0;

  const followMutation = useMutation({
    mutationFn: () => apiFetch(`/leads/${leadId}/follow`, { method: isFollowing ? "DELETE" : "POST" }),
    onSuccess: () => {
      // Optimistically flip the state in cache, then refetch for accurate count
      queryClient.setQueryData([`/api/crm/leads/${leadId}`], (old: any) =>
        old ? { ...old, isFollowing: !isFollowing, followerCount: followerCount + (isFollowing ? -1 : 1) } : old
      );
    },
  });

  const isSuperAdmin = me?.role === "super_admin";
  const isAdmin = me?.role === "admin" || isSuperAdmin;
  const canDeleteLeads = isSuperAdmin || (isAdmin && campaignData?.allowLeadDeletion === true);
  const canArchive = isAdmin;

  const updateMutation = useCrmUpdateLead();
  const deleteMutation = useCrmDeleteLead();
  const addNoteMutation = useCrmAddLeadNote();
  const addTaskMutation = useCrmCreateTask();
  const fetchPropertyMutation = useCrmFetchPropertyData({
    mutation: {
      onSuccess: (data: any) => {
        const fields: string[] = data?.fieldsUpdated ?? [];
        const fetched = data?.fetched ?? {};

        // Build the patch object from the API response
        const patch: Record<string, any> = {};
        if (fetched.beds         != null) patch.beds         = fetched.beds;
        if (fetched.baths        != null) patch.baths        = fetched.baths;
        if (fetched.sqft         != null) patch.sqft         = fetched.sqft;
        if (fetched.yearBuilt    != null) patch.yearBuilt    = fetched.yearBuilt;
        if (fetched.ownerName    != null) patch.ownerName    = fetched.ownerName;
        if (fetched.lastSaleDate != null) patch.lastSaleDate = fetched.lastSaleDate;
        if (fetched.lastSalePrice!= null) patch.lastSalePrice= fetched.lastSalePrice;
        if (fetched.propertyType != null) patch.propertyType = fetched.propertyType;
        if (fetched.arv          != null) patch.arv          = fetched.arv;
        if (fetched.mao          != null) patch.mao          = fetched.mao;
        if (fetched.currentValue != null) patch.currentValue = fetched.currentValue;

        if (fields.length > 0 && Object.keys(patch).length > 0) {
          // Patch formData immediately. Data was already saved to DB by the
          // fetch endpoint — do NOT mark dirty so the Save button stays hidden.
          setFormData((f: any) => ({ ...f, ...patch }));

          // Update the React Query cache directly — no network refetch needed,
          // and prevents useEffect([lead]) from overwriting formData.
          queryClient.setQueryData([`/api/crm/leads/${leadId}`], (old: any) =>
            old ? { ...old, ...patch } : old
          );
        }

        const apiReturned = Object.entries(fetched).filter(([k, v]) => v != null && k !== "creditsRemaining" && k !== "arv" && k !== "mao").map(([k]) => k);
        if (fields.length > 0) {
          toast({
            title: `Property data fetched — updated: ${fields.join(", ")}`,
            description: "ARV is not set automatically — add comparable sales below to calculate it.",
          });
        } else if (apiReturned.length > 0) {
          toast({ title: "Property data fetched — fields up to date", description: `API returned: ${apiReturned.join(", ")}` });
        } else {
          toast({ title: "Property not found", description: "No data returned for this address. Check address is complete and try again.", variant: "destructive" });
        }
      },
      onError: (err: any) => {
        const body = err?.response?.data ?? err?.data ?? {};
        if (body?.error === "cooldown") {
          const mins = body.retryAfterMs ? Math.ceil(body.retryAfterMs / 60000) : null;
          toast({
            title: "Cooldown active",
            description: body.message ?? (mins ? `Try again in ${mins} minute(s)` : "Please wait before fetching again"),
            variant: "destructive",
          });
        } else {
          const detail = body?.error || err?.message || "Check the address is complete and try again";
          toast({ title: "Could not fetch property data", description: detail, variant: "destructive" });
        }
      },
    },
  });

  const skipTraceMutation = useCrmSkipTrace({
    mutation: {
      onSuccess: (data: any) => {
        const fieldsUpdated: string[] = data?.fieldsUpdated ?? [];
        const phones: any[] = data?.phones ?? [];
        const emails: string[] = data?.emails ?? [];

        const patch: Record<string, any> = {};
        if (fieldsUpdated.includes("phone") && phones[0]?.number) patch.phone = phones[0].number;
        if (fieldsUpdated.includes("email") && emails[0]) patch.email = emails[0];
        patch.skipTracedPhones = phones;
        patch.skipTracedEmails = emails;

        setFormData((f: any) => ({ ...f, ...patch }));
        queryClient.setQueryData([`/api/crm/leads/${leadId}`], (old: any) =>
          old ? { ...old, ...patch } : old
        );

        const matched = data?.matchStatus === "matched";
        const phoneCount = phones.length;
        const emailCount = emails.length;

        if (!matched || (phoneCount === 0 && emailCount === 0)) {
          toast({
            title: "No match found",
            description: "No contact data found for this address.",
            variant: "destructive",
          });
        } else if (fieldsUpdated.length > 0) {
          toast({ title: `Contact data found — auto-filled: ${fieldsUpdated.join(", ")}`, description: `Found ${phoneCount} phone(s), ${emailCount} email(s)` });
        } else {
          toast({ title: "Contact data matched", description: `Found ${phoneCount} phone(s), ${emailCount} email(s) — fields already filled` });
        }
      },
      onError: (err: any) => {
        const body = err?.response?.data ?? err?.data ?? {};
        if (body?.error === "cooldown") {
          const hours = body.retryAfterMs ? Math.ceil(body.retryAfterMs / 3600000) : null;
          toast({
            title: "Daily limit reached",
            description: body.message ?? (hours ? `Contact enrichment available again in ~${hours} hour(s)` : "1 contact enrichment allowed per campaign per day"),
            variant: "destructive",
          });
        } else {
          const apiMsg = body?.message ?? body?.error;
          const httpStatus = body?.httpStatus;
          const description = apiMsg
            ? (httpStatus ? `API error ${httpStatus}: ${apiMsg}` : apiMsg)
            : "Could not reach the contact enrichment service. Check your PropertyAPI plan.";
          toast({ title: "Contact enrichment failed", description, variant: "destructive" });
        }
      },
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (archive: boolean) =>
      apiFetch(`/leads/${leadId}/${archive ? "archive" : "unarchive"}`, { method: "POST" }),
    onSuccess: (_data, archive) => {
      toast({ title: archive ? "Lead archived" : "Lead restored" });
      queryClient.invalidateQueries({ queryKey: [`/api/crm/leads/${leadId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/crm/leads`] });
    },
  });

  const [formData, setFormData] = useState<any>({});
  const [newNote, setNewNote] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const initializedRef = useRef(false);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formDataRef = useRef<any>({});

  // Local state for debounced text inputs (avoids full re-render on every keystroke)
  const [sellerNameInput, setSellerNameInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const debouncedSellerName = useDebouncedValue(sellerNameInput, 200);
  const debouncedPhone = useDebouncedValue(phoneInput, 200);
  const debouncedEmail = useDebouncedValue(emailInput, 200);

  // ── Twilio state ──────────────────────────────────────────────────────────
  const [opPhoneNumbers, setOpPhoneNumbers] = useState<any[]>([]);
  const [opSelectedId, setOpSelectedId] = useState<string>("");
  const [opMessages, setOpMessages] = useState<any[]>([]);
  const [opCalls, setOpCalls] = useState<any[]>([]);
  const [opSmsContent, setOpSmsContent] = useState("");
  const [opSending, setOpSending] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [opLoadingMsgs, setOpLoadingMsgs] = useState(false);
  const [opError, setOpError] = useState("");
  const [opTab, setOpTab] = useState<"messages" | "calls" | "browser">("messages");
  function opFetch(path: string, options?: RequestInit) {
    const token = localStorage.getItem("crm_token");
    return fetch(`/api${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options?.headers || {}),
      },
    }).then(async r => {
      const json = await r.json().catch(() => ({}));  // ✅ Just return {} on parse fail
      if (!r.ok && r.status !== 400 && r.status !== 404) {
        throw new Error(json?.error || `Twilio error ${r.status}`);
      }
      return json;
    });
  }

  // State-match helper — finds Twilio number matching lead's state
  function pickNumberForState(numbers: any[], state: string | null | undefined): string | null {
    if (!state || !numbers.length) return null;
    const abbr = state.trim().toUpperCase().slice(0, 2);
    const match = numbers.find(n => {
      const name = (n.name || "").toUpperCase().trim();
      return name === abbr || name.startsWith(abbr + " ") || name.startsWith(abbr + "1") || name.startsWith(abbr + "2") || name.startsWith(abbr + "3");
    }) || numbers.find(n => {
      const name = (n.name || "").toUpperCase();
      return name.includes(` ${abbr}`) || name.endsWith(abbr);
    });
    return match?.id ?? null;
  }

  // Load phone numbers once + auto-select by campaign → state → first
 useEffect(() => {
    opFetch("/twilio/phone-numbers")
      .then(d => {
        const numbers = d?.phoneNumbers || [];
        setOpPhoneNumbers(numbers);
        // Priority 1: campaign's assigned number
        if (campaignData?.twilioPhoneNumber) {
          const campaignNum = numbers.find((n: any) => n.id === campaignData.twilioPhoneNumber || n.number === campaignData.twilioPhoneNumber);
          if (campaignNum) { setOpSelectedId(campaignNum.id); return; }
        }
        // Priority 2: state match
        const stateMatch = pickNumberForState(numbers, lead?.state);
        if (stateMatch) { setOpSelectedId(stateMatch); return; }
        // Priority 3: first number
        if (numbers[0]?.id) setOpSelectedId(numbers[0].id);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignData?.twilioPhoneNumber, lead?.state]);

    // Load stored messages from DB (includes inbound replies) + live calls from Twilio
  const loadStoredMessages = () => {
    if (!leadId) return;
    setOpLoadingMsgs(true);
    setOpError("");
    const callsPromise = opSelectedId && lead?.phone
      ? opFetch(`/twilio/calls?phoneNumberId=${encodeURIComponent(opSelectedId)}&contactPhone=${encodeURIComponent(lead.phone)}`)
          .then(d => d?.calls || []).catch(() => [])
      : Promise.resolve([]);
    Promise.all([
      opFetch(`/twilio/lead-messages/${leadId}`).then(d => d?.messages || []).catch(() => []),
      callsPromise,
    ])
      .then(([msgs, calls]) => {
        setOpMessages(msgs);
        setOpCalls(calls);
      })
      .catch(e => setOpError(e.message))
      .finally(() => setOpLoadingMsgs(false));
  };

  useEffect(() => {
    const shouldLoad = leadId && (isSuperAdmin || campaignData?.dialerEnabled);
    if (shouldLoad) loadStoredMessages();
    const interval = setInterval(() => {
      if (leadId && (isSuperAdmin || campaignData?.dialerEnabled)) loadStoredMessages();
    }, 80000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, opSelectedId, lead?.phone, isSuperAdmin, campaignData?.dialerEnabled]);

  const refreshOpMessages = () => { loadStoredMessages(); };

  const sendOpSms = async () => {
    if (!opSmsContent.trim() || !opSelectedId || !lead?.phone) return;
    setOpSending(true);
    setOpError("");
    try {
      const result = await opFetch("/twilio/messages", {
        method: "POST",
        body: JSON.stringify({
          phoneNumberId: opSelectedId,
          to: lead.phone,
          content: opSmsContent.trim(),
          leadId,
          campaignId: (lead as any)?.campaignId,
        }),
      });
      // ✅ Check if backend returned an error (e.g., Twilio not configured)
      if (result?.error) throw new Error(result.error);
      
      setOpSmsContent("");
      addNoteMutation.mutate({ id: leadId, data: { content: `📱 SMS sent: "${opSmsContent.trim()}"` } });
      setTimeout(refreshOpMessages, 1500);
    } catch (e: any) {
      setOpError(e.message);
    } finally {
      setOpSending(false);
    }
  };

  // Keep a ref in sync so the auto-save timeout can read the latest formData.
  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  // Initialize formData ONCE when the lead first loads — never reset on background refetches.
  useEffect(() => {
    if (lead && !initializedRef.current) {
      setFormData(lead);
      formDataRef.current = lead;
      setSellerNameInput(lead.sellerName || "");
      setPhoneInput(lead.phone || "");
      setEmailInput(lead.email || "");
      initializedRef.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead]); 

  // Sync debounced text inputs → formData (only fires after user stops typing)
  // Uses setFormData/setIsDirty directly (not `field`) to avoid reference-before-init issue
  useEffect(() => {
    if (!initializedRef.current) return;
    setIsDirty(true);
    setFormData((f: any) => ({ ...f, sellerName: debouncedSellerName }));
    formDataRef.current = { ...formDataRef.current, sellerName: debouncedSellerName };
  }, [debouncedSellerName]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!initializedRef.current) return;
    setIsDirty(true);
    setFormData((f: any) => ({ ...f, phone: debouncedPhone }));
    formDataRef.current = { ...formDataRef.current, phone: debouncedPhone };
  }, [debouncedPhone]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!initializedRef.current) return;
    setIsDirty(true);
    setFormData((f: any) => ({ ...f, email: debouncedEmail }));
    formDataRef.current = { ...formDataRef.current, email: debouncedEmail };
  }, [debouncedEmail]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save: 1.5 s after the last change, save silently.
  useEffect(() => {
    if (!isDirty) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const latest = formDataRef.current;
      updateMutation.mutate(
        { id: leadId, data: latest },
        {
          onSuccess: () => {
            setIsDirty(false);
            queryClient.setQueryData([`/api/crm/leads/${leadId}`], (old: any) =>
              old ? { ...old, ...latest } : old
            );
          },
        }
      );
    }, 1500);
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  // formData is read via formDataRef.current inside the callback — not a dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty]);

  if (isLoading || !lead) return <div className="p-8 text-center text-muted-foreground animate-pulse">Loading property details...</div>;

  const field = (key: string) => (val: any) => {
    setIsDirty(true);
    setFormData((f: any) => ({ ...f, [key]: val }));
  };

  const handleUpdate = (e?: React.FormEvent<HTMLFormElement>) => {
    if (e) e.preventDefault();
    updateMutation.mutate(
      { id: leadId, data: formData },
      {
        onSuccess: () => {
          toast({ title: "Changes saved" });
          setIsDirty(false);
          queryClient.setQueryData([`/api/crm/leads/${leadId}`], (old: any) =>
            old ? { ...old, ...formData } : old
          );
        },
        onError: () => {
          toast({ title: "Save failed", description: "Check your connection and try again", variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to permanently delete this lead? This cannot be undone.")) {
      deleteMutation.mutate(
        { id: leadId },
        {
          onSuccess: () => {
            toast({ title: "Lead deleted" });
            setLocation("/leads");
          },
          onError: (err: any) => {
            toast({ title: "Cannot delete this lead", description: err?.message || "Lead deletion is not enabled for this campaign.", variant: "destructive" });
          },
        }
      );
    }
  };

  const handleAddNote = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    addNoteMutation.mutate(
      { id: leadId, data: { content: newNote } },
      {
        onSuccess: () => {
          setNewNote("");
          queryClient.invalidateQueries({ queryKey: [`/api/crm/leads/${leadId}`] });
        },
      }
    );
  };

  const handleAddTask = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    addTaskMutation.mutate(
      { data: { title: newTaskTitle, leadId, status: "pending" } },
      {
        onSuccess: () => {
          setNewTaskTitle("");
          queryClient.invalidateQueries({ queryKey: [`/api/crm/leads/${leadId}`] });
        },
      }
    );
  };

  const arv = Number(formData.arv) || 0;
  const erc = Number(formData.estimatedRepairCost) || 0;
  // Mirror server-side getMaoDiscount: ≤3→70%, ≤6→80%, >6→90%
  const conditionNum = Number(formData.condition) || 0;
  const discountFactor = conditionNum <= 0 ? 0.80 : conditionNum <= 3 ? 0.70 : conditionNum <= 6 ? 0.80 : 0.90;
  const discountPct = Math.round(discountFactor * 100);
  const mao = arv > 0 ? Math.max(0, Math.round(arv * discountFactor - erc)) : 0;

  const agingDays = differenceInDays(new Date(), new Date(lead.updatedAt || lead.createdAt));
  const isRented = formData.occupancy === "Rented" || formData.isRental === true;

  // Split notes into regular and audit
  const regularNotes = (notes || []).filter((n: any) => n.noteType !== "audit");
  const auditNotes = (notes || []).filter((n: any) => n.noteType === "audit");

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-center gap-4 flex-wrap">
        <Link href="/leads">
          <Button variant="ghost" size="icon" className="rounded-xl border border-white/10 bg-card hover:bg-secondary">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-display font-bold truncate">{lead.address}</h1>
            {agingDays >= 7 && (
              <Badge className={`text-xs ${agingDays >= 14 ? "bg-red-500/20 text-red-400 border-red-500/30" : "bg-orange-500/20 text-orange-400 border-orange-500/30"}`}>
                <Clock className="w-3 h-3 mr-1" /> {agingDays}d no update
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm">Added {format(new Date(lead.createdAt), "MMM d, yyyy")}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Follow button */}
          <Button
            variant={isFollowing ? "default" : "outline"}
            size="sm"
            className={`rounded-xl gap-1.5 ${isFollowing ? "bg-primary/20 text-primary border-primary/30 hover:bg-primary/30" : ""}`}
            onClick={() => followMutation.mutate()}
            disabled={followMutation.isPending}
          >
            {isFollowing ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
            {isFollowing ? "Following" : "Follow"}
            {followerCount > 0 && <span className="ml-1 text-xs opacity-70">({followerCount})</span>}
          </Button>
          <Button
            variant="outline"
            className="rounded-xl h-9 px-4 text-sm gap-2 border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => openOfferLetter(formData, mao, campaignData)}
          >
            <FileText className="w-4 h-4" /> Offer Letter
          </Button>
          {/* Manual Save Button — only visible when there are unsaved changes */}
          {isDirty && (
            <Button
              onClick={handleUpdate}
              disabled={updateMutation.isPending}
              className="rounded-xl h-9 px-5 text-sm gap-2 bg-primary text-primary-foreground hover:bg-primary/90 animate-pulse"
            >
              {updateMutation.isPending ? "Saving…" : "⬆ Save Changes"}
            </Button>
          )}
        </div>
      </div>

      {/* Pipeline Status Bar */}
      <Card className="p-6 rounded-2xl bg-card border-white/5 shadow-lg">
        <div className="flex items-center justify-between gap-2 overflow-x-auto pb-2">
          {STATUSES.map((status, index) => {
            const currentIndex = STATUSES.indexOf(formData.status);
            const isCompleted = index <= currentIndex && formData.status !== "dead";
            const isActive = index === currentIndex && formData.status !== "dead";
            return (
              <div key={status} className="flex-1 flex flex-col items-center min-w-[100px] relative">
                <button
                  onClick={() => {
                    const updated = { ...formData, status };
                    setFormData(updated);
                    updateMutation.mutate({ id: leadId, data: updated });
                  }}
                  className={`w-full h-2 rounded-full mb-3 transition-colors ${isCompleted ? "bg-primary shadow-[0_0_10px_rgba(99,102,241,0.5)]" : "bg-secondary"}`}
                />
                <span className={`text-xs font-medium uppercase tracking-wider ${isActive ? "text-primary" : "text-muted-foreground"}`}>
                  {status.replace("_", " ")}
                </span>
              </div>
            );
          })}
        </div>
        {/* Dead toggle */}
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => {
              const newStatus = formData.status === "dead" ? "new" : "dead";
              const updated = { ...formData, status: newStatus };
              setFormData(updated);
              updateMutation.mutate({ id: leadId, data: updated });
            }}
            className={`px-4 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${formData.status === "dead" ? "bg-destructive/20 text-destructive border-destructive/30" : "border-border text-muted-foreground hover:bg-secondary"}`}
          >
            {formData.status === "dead" ? "✗ Deal is DEAD — Click to Reopen" : "Mark as Dead"}
          </button>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* LEFT COL */}
        <div className="xl:col-span-2 space-y-6">

          {/* Contact + Lead Source */}
          <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
            <div className="bg-secondary/30 p-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-primary" />
                <h2 className="font-display font-semibold">Contact & Lead Source</h2>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                disabled={skipTraceMutation.isPending}
                onClick={() => skipTraceMutation.mutate({ id: leadId })}
              >
                {skipTraceMutation.isPending ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Search className="w-3 h-3" />
                )}
                {skipTraceMutation.isPending ? "Running..." : "Enrich Contact"}
              </Button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Seller Name</Label>
                <Input className="bg-background/50 rounded-xl" value={sellerNameInput} onChange={e => setSellerNameInput(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Phone Number</Label>
                <Input className="bg-background/50 rounded-xl" value={phoneInput} onChange={e => setPhoneInput(e.target.value)} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Email</Label>
                <Input type="email" className="bg-background/50 rounded-xl" value={emailInput} onChange={e => setEmailInput(e.target.value)} />
              </div>
              <SelectField label="Lead Source" value={formData.leadSource || ""} onChange={field("leadSource")} options={LEAD_SOURCES} />
              {isAdmin && (
                <div className="space-y-2">
                  <Label>Assigned To</Label>
                  <select
                    value={formData.assignedTo || ""}
                    onChange={e => field("assignedTo")(e.target.value ? Number(e.target.value) : null)}
                    className="w-full h-10 rounded-xl border border-border bg-background/50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  >
                    <option value="">— Unassigned —</option>
                    {campaignUsers.map((u: any) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Contact Data */}
            {((lead as any).skipTracedPhones?.length > 0 || (lead as any).skipTracedEmails?.length > 0) && (
              <div className="px-6 pb-6">
                <div className="border-t border-border pt-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Search className="w-4 h-4 text-purple-400" />
                    <span className="text-sm font-medium text-purple-400">Contact Data</span>
                    {(lead as any).skipTracedName && (lead as any).skipTracedName !== lead.sellerName && (
                      <span className="text-xs text-muted-foreground">— {(lead as any).skipTracedName}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {(lead as any).skipTracedPhones?.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Phones</p>
                        <div className="space-y-1.5">
                          {(lead as any).skipTracedPhones.map((p: any, i: number) => (
                            <div key={i} className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-mono">{p.number}</span>
                              {p.type && (
                                <Badge className={`text-[10px] px-1.5 border ${p.type === 'Mobile' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-blue-500/20 text-blue-400 border-blue-500/30'}`}>
                                  {p.type}
                                </Badge>
                              )}
                              {p.isDisconnected && (
                                <Badge className="text-[10px] px-1.5 bg-red-500/20 text-red-400 border-red-500/30 border">Disconnected</Badge>
                              )}
                              {p.carrier && (
                                <span className="text-[10px] text-muted-foreground">{p.carrier}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(lead as any).skipTracedEmails?.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Emails</p>
                        <div className="space-y-1.5">
                          {(lead as any).skipTracedEmails.map((email: string, i: number) => (
                            <div key={i} className="text-sm break-all text-muted-foreground hover:text-foreground transition-colors">{email}</div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </Card>

          {(isSuperAdmin || campaignData?.dialerEnabled) && <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
            <div className="bg-secondary/30 p-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Phone className="w-5 h-5 text-blue-400" />
                <h2 className="font-display font-semibold">Dialer & SMS</h2>
                {lead?.phone && (
                  <span className="text-xs text-muted-foreground font-mono">{lead.phone}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {/* From number selector */}
                {opPhoneNumbers.length > 0 && (
                  <div className="relative">
                    <select
                      value={opSelectedId}
                      onChange={e => setOpSelectedId(e.target.value)}
                      className="h-7 pl-2 pr-7 rounded-lg border border-border bg-background/50 text-xs focus:outline-none focus:ring-1 focus:ring-primary/40 appearance-none"
                    >
                      {opPhoneNumbers.map((n: any) => (
                        <option key={n.id} value={n.id}>
                          {n.number || n.name || n.id}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground" />
                  </div>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1 border-blue-500/40 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                  disabled={!lead?.phone || !opSelectedId}
                  onClick={() => setOpTab("browser")}
                  title="Call via browser"
                >
                  <PhoneCall className="w-3 h-3" />
                  Browser Call
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className={`h-7 text-xs gap-1 transition-colors ${copiedPhone ? "border-green-500/50 text-green-400" : "border-border text-muted-foreground hover:text-foreground"}`}
              
                  disabled={!lead?.phone}
                  onClick={() => {
                    if (!lead?.phone) return;
                    navigator.clipboard.writeText(lead.phone);
                    setCopiedPhone(true);
                    setTimeout(() => setCopiedPhone(false), 2000);
                  }}
                  title="Copy phone number"
                >
                  {copiedPhone ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedPhone ? "Copied!" : "Copy #"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                  disabled={opLoadingMsgs}
                  onClick={refreshOpMessages}
                >
                  <RefreshCw className={`w-3 h-3 ${opLoadingMsgs ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </div>

            {!lead?.phone ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                Add a phone number to this contact to enable calling and texting.
              </div>
            ) : opPhoneNumbers.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                No Twilio numbers found. <a href="/integrations/twilio" className="text-primary hover:underline">Configure Twilio</a> to enable calling &amp; texting.
              </div>
            ) : (
              <div className="flex flex-col">
                {/* Tabs */}
                <div className="flex border-b border-border">
                  {([
  { key: "messages", label: "Messages", count: opMessages.length },
  { key: "calls", label: "Calls", count: opCalls.length },
  { key: "browser", label: "Browser Dialer", count: 0 },
] as const).map(t => (
                    <button
                      key={t.key}
                      onClick={() => setOpTab(t.key)}
                      className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                        opTab === t.key
                          ? "border-primary text-primary"
                          : "border-transparent text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t.label}
                      {t.count > 0 && (
                        <span className="ml-1.5 bg-secondary text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px]">
                          {t.count}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {opError && (
                  <div className="mx-4 mt-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                    {opError}
                  </div>
                )}

                {/* Messages tab */}
                {opTab === "messages" && (
                  <>
                    <div className="flex-1 overflow-y-auto max-h-72 p-4 space-y-2">
                      {opLoadingMsgs ? (
                        <div className="text-center py-6 text-muted-foreground text-xs">
                          <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1" /> Loading messages...
                        </div>
                      ) : opMessages.length === 0 ? (
                        <div className="text-center py-6 text-muted-foreground text-xs">
                          No messages yet with this contact.
                        </div>
                      ) : (
                        [...opMessages].reverse().map((msg: any, i: number) => {
                          const isOutbound = msg.direction === "outgoing";
                          return (
                            <div key={i} className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}>
                              <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${
                                isOutbound
                                  ? "bg-primary text-primary-foreground rounded-br-sm"
                                  : "bg-secondary text-foreground rounded-bl-sm"
                              }`}>
                                <p>{msg.content || msg.text || msg.body}</p>
                                <p className={`text-[10px] mt-1 ${isOutbound ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                                  {msg.createdAt ? format(new Date(msg.createdAt), "MMM d, h:mm a") : ""}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                    {/* SMS Composer */}
                    <div className="p-4 border-t border-border">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={opSmsContent}
                          onChange={e => setOpSmsContent(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendOpSms(); } }}
                          placeholder={`Text ${lead?.phone || "contact"}...`}
                          className="flex-1 h-9 px-3 rounded-xl border border-border bg-background/50 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                        <Button
                          size="sm"
                          className="h-9 px-3 gap-1.5"
                          disabled={opSending || !opSmsContent.trim()}
                          onClick={sendOpSms}
                        >
                          {opSending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                          Send
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                {/* Browser Dialer tab */}
                {opTab === "browser" && (
                  <div className="p-4">
                    <BrowserDialer
                      leadPhone={lead?.phone}
                      leadId={lead?.id}
                      leadName={lead?.sellerName || undefined}
                      onCallLogged={() => { /* refresh calls list */ refreshOpMessages(); }}
                    />
                  </div>
                )}

                {/* Calls tab */}
                {opTab === "calls" && (
                  <div className="max-h-72 overflow-y-auto p-4 space-y-2">
                    {opLoadingMsgs ? (
                      <div className="text-center py-6 text-muted-foreground text-xs">
                        <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-1" /> Loading calls...
                      </div>
                    ) : opCalls.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground text-xs">
                        No call history with this contact yet.
                      </div>
                    ) : (
                      opCalls.map((call: any, i: number) => {
                        const isOut = call.direction === "outgoing";
                        const dur = call.duration;
                        return (
                          <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30 border border-border/50">
                            {isOut
                              ? <PhoneCall className="w-4 h-4 text-green-400 shrink-0" />
                              : <PhoneIncoming className="w-4 h-4 text-blue-400 shrink-0" />
                            }
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{isOut ? "Outbound call" : "Inbound call"}</p>
                              <p className="text-xs text-muted-foreground">
                                {call.createdAt ? format(new Date(call.createdAt), "MMM d, yyyy h:mm a") : ""}
                                {dur ? ` · ${Math.floor(dur / 60)}m ${dur % 60}s` : ""}
                              </p>
                            </div>
                            <Badge className={`text-[10px] ${
                              call.status === "completed" ? "bg-green-500/20 text-green-400 border-green-500/30" :
                              call.status === "missed" ? "bg-red-500/20 text-red-400 border-red-500/30" :
                              "bg-secondary text-muted-foreground"
                            } border`}>
                              {call.status || "unknown"}
                            </Badge>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}
          </Card>}

          {/* Property Details */}
          <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
            <div className="bg-secondary/30 p-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Home className="w-5 h-5 text-primary" />
                <h2 className="font-display font-semibold">Property Details</h2>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                disabled={fetchPropertyMutation.isPending}
                onClick={() => fetchPropertyMutation.mutate({ id: leadId })}
              >
                {fetchPropertyMutation.isPending ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Database className="w-3 h-3" />
                )}
                {fetchPropertyMutation.isPending ? "Fetching..." : "Fetch Property Data"}
              </Button>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2 md:col-span-3">
                <Label>Street Address</Label>
                <Input
                  className="bg-background/50 rounded-xl"
                  value={formData.address || ""}
                  placeholder="Paste full address or type street only"
                  onChange={e => {
                    const val = e.target.value;
                    const parsed = parseFullAddress(val);
                    if (parsed && (parsed.city || parsed.state || parsed.zip)) {
                      setFormData((f: any) => ({
                        ...f,
                        address: parsed.address || val,
                        ...(parsed.city ? { city: parsed.city } : {}),
                        ...(parsed.state ? { state: parsed.state } : {}),
                        ...(parsed.zip ? { zip: parsed.zip } : {}),
                      }));
                    } else {
                      field("address")(val);
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>City</Label>
                <Input className="bg-background/50 rounded-xl" value={formData.city || ""} onChange={e => field("city")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Input className="bg-background/50 rounded-xl" value={formData.state || ""} onChange={e => field("state")(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>ZIP Code</Label>
                <Input className="bg-background/50 rounded-xl" value={formData.zip || ""} onChange={e => field("zip")(e.target.value)} />
              </div>
              <PropertyMap
                address={lead.address}
                city={lead.city ?? undefined}
                state={lead.state ?? undefined}
                zip={lead.zip ?? undefined}
              />
              <div className="space-y-2 md:col-span-3">
                <SelectField label="Property Type" value={formData.propertyType || ""} onChange={field("propertyType")} options={PROPERTY_TYPES} />
              </div>
              <div className="space-y-2">
                <Label>Beds</Label>
                <Input type="number" className="bg-background/50 rounded-xl" value={formData.beds || ""} onChange={e => field("beds")(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Baths</Label>
                <Input type="number" step="0.5" className="bg-background/50 rounded-xl" value={formData.baths || ""} onChange={e => field("baths")(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Sq Ft</Label>
                <Input type="number" className="bg-background/50 rounded-xl" value={formData.sqft || ""} onChange={e => field("sqft")(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Year Built</Label>
                <Input type="number" placeholder="e.g. 1995" className="bg-background/50 rounded-xl" value={(formData as any).yearBuilt || ""} onChange={e => field("yearBuilt")(e.target.value ? Number(e.target.value) : null)} />
              </div>
              <div className="space-y-2">
                <Label>Owner Name</Label>
                <Input className="bg-background/50 rounded-xl" placeholder="Current owner" value={(formData as any).ownerName || ""} onChange={e => field("ownerName")(e.target.value || null)} />
              </div>
              <div className="space-y-2">
                <Label>Last Sale Date</Label>
                <Input className="bg-background/50 rounded-xl" placeholder="e.g. 2022-06-15" value={(formData as any).lastSaleDate || ""} onChange={e => field("lastSaleDate")(e.target.value || null)} />
              </div>
              <div className="space-y-2">
                <Label>Last Sale Price</Label>
                <Input type="number" className="bg-background/50 rounded-xl" placeholder="$0" value={(formData as any).lastSalePrice || ""} onChange={e => field("lastSalePrice")(e.target.value ? Number(e.target.value) : null)} />
              </div>
              <div className="space-y-2">
                <Label>Condition (1–5)</Label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map(v => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => field("condition")(v)}
                      className={`flex-1 h-10 rounded-xl border text-sm font-semibold transition-colors ${formData.condition === v ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background/50 text-muted-foreground hover:bg-secondary"}`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">1 = Poor · 5 = Excellent</p>
              </div>
              <SelectField label="Occupancy" value={formData.occupancy || ""} onChange={field("occupancy")} options={OCCUPANCY_OPTIONS} />
              {isRented && (
                <div className="space-y-2">
                  <Label>Monthly Rental Amount</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input type="number" className="bg-background/50 rounded-xl pl-8" value={formData.rentalAmount || ""} onChange={e => field("rentalAmount")(Number(e.target.value))} />
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Seller Motivation */}
          <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
            <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
              <UserCheck className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold">Seller Motivation</h2>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              <SelectField label="Reason for Selling" value={formData.reasonForSelling || ""} onChange={field("reasonForSelling")} options={REASON_OPTIONS} />
              <SelectField label="How Soon?" value={formData.howSoon || ""} onChange={field("howSoon")} options={HOW_SOON_OPTIONS} />
            </div>
          </Card>

          {/* Comps — lazy loaded */}
          <Suspense fallback={<div className="h-32 animate-pulse bg-secondary/30 rounded-2xl" />}>
            <CompsSection leadId={leadId} lead={lead} />
          </Suspense>

          {/* Unsaved changes indicator + Archive / Delete */}
          <div className="flex gap-3 flex-wrap items-center">
            <div className="flex-1 min-w-[140px] flex items-center gap-2 text-sm text-muted-foreground">
              {isDirty && (
                <><span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse inline-block" /> Unsaved changes</>
              )}
              {!isDirty && (
                <><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> All changes saved</>
              )}
            </div>
            {canArchive && !lead.archived && (
              <Button
                onClick={() => { if (confirm("Archive this lead? It will be hidden from the main list but can be restored later.")) archiveMutation.mutate(true); }}
                disabled={archiveMutation.isPending}
                variant="outline"
                className="rounded-xl h-12 px-5 border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10"
              >
                <Archive className="w-5 h-5 mr-2" /> Archive
              </Button>
            )}
            {canArchive && lead.archived && (
              <Button
                onClick={() => archiveMutation.mutate(false)}
                disabled={archiveMutation.isPending}
                variant="outline"
                className="rounded-xl h-12 px-5 border-green-500/40 text-green-400 hover:bg-green-500/10"
              >
                <Archive className="w-5 h-5 mr-2" /> Restore
              </Button>
            )}
            {canDeleteLeads && (
              <Button onClick={handleDelete} disabled={deleteMutation.isPending} variant="destructive" className="rounded-xl h-12 px-5 shadow-lg shadow-destructive/20">
                <Trash2 className="w-5 h-5" />
              </Button>
            )}
          </div>
          {lead.archived && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-sm">
              <Archive className="w-4 h-4 flex-shrink-0" />
              <span>This lead is archived and hidden from the main list.{canArchive ? " Click Restore to make it active again." : ""}</span>
            </div>
          )}

          {/* Audit Log */}
          {auditNotes.length > 0 && (
            <Card className="rounded-2xl border-white/5 bg-card shadow-lg overflow-hidden">
              <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary" />
                <h2 className="font-display font-semibold">Activity Log</h2>
                <Badge variant="secondary" className="text-xs">{auditNotes.length}</Badge>
              </div>
              <div className="p-4 space-y-2 max-h-60 overflow-y-auto">
                {auditNotes.slice().reverse().map((note: any) => (
                  <div key={note.id} className="flex items-start gap-3 p-2.5 bg-blue-500/5 border border-blue-500/10 rounded-xl">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-2 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground leading-relaxed">{note.content}</p>
                      <p className="text-xs text-muted-foreground/60 mt-0.5">{format(new Date(note.createdAt), "MMM d, h:mm a")}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* RIGHT COL */}
        <div className="space-y-6">

          {/* Financials */}
          <Card className="rounded-2xl border-primary/30 bg-card shadow-[0_10px_30px_-10px_rgba(99,102,241,0.15)] overflow-hidden relative">
            <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
              <Calculator className="w-32 h-32 text-primary" />
            </div>
            <div className="bg-gradient-to-r from-primary/10 to-transparent p-4 border-b border-white/5 flex items-center gap-2 relative z-10">
              <DollarSign className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold">Financials & MAO</h2>
            </div>
            <div className="p-6 space-y-4 relative z-10">
              {/* Submitted asking price text (read-only, from submission form) */}
              {lead.askingPriceText && (
                <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-sm">
                  <span className="text-muted-foreground text-xs block mb-0.5">Submitted Asking Price</span>
                  <span className="text-yellow-300 font-medium">{lead.askingPriceText}</span>
                </div>
              )}
              {[
                { label: "Seller Asking Price (Numeric)", key: "askingPrice" },
                { label: "After Repair Value (ARV) — set via comparables below", key: "arv" },
                { label: "Est. Repair Cost (ERC)", key: "estimatedRepairCost" },
                { label: "Current Market Value", key: "currentValue" },
              ].map(({ label, key }) => (
                <div key={key} className="space-y-2">
                  <Label className="text-muted-foreground">{label}</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input type="number" className="bg-background/80 pl-8 rounded-xl border-white/10" value={formData[key] || ""} onChange={e => field(key)(Number(e.target.value))} />
                  </div>
                </div>
              ))}
              <div className="pt-4 border-t border-white/10">
                <div className="flex justify-between items-center mb-1">
                  <Label className="text-primary font-semibold">Max Allowable Offer</Label>
                  <span className="text-xs text-muted-foreground">(ARV × {discountPct}%) - ERC</span>
                </div>
                <div className="text-3xl font-display font-bold text-white tracking-tight bg-background/50 p-3 rounded-xl border border-white/5 text-center shadow-inner">
                  {mao > 0 ? fmt$(mao) : "—"}
                </div>
                {mao > 0 && (
                  <div className="mt-3 p-3 rounded-xl bg-background/30 border border-white/5 text-xs space-y-1.5 font-mono">
                    <div className="flex justify-between text-muted-foreground">
                      <span>ARV</span>
                      <span className="text-white">{fmt$(arv ?? 0)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>× {discountPct}%</span>
                      <span className="text-white">{fmt$(Math.round((arv ?? 0) * discountFactor))}</span>
                    </div>
                    {Number(formData.estimatedRepairCost) > 0 && (
                      <div className="flex justify-between text-muted-foreground">
                        <span>− ERC</span>
                        <span className="text-red-400">−{fmt$(Number(formData.estimatedRepairCost))}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-white/10 pt-1.5 font-semibold text-primary">
                      <span>= MAO</span>
                      <span>{fmt$(mao)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* AI tools — lazy loaded */}
          <Suspense fallback={<div className="h-24 animate-pulse bg-secondary/30 rounded-2xl" />}>
            <AiRepairEstimator
              leadId={leadId}
              onApplied={(total) => { field("estimatedRepairCost")(total); }}
            />
          </Suspense>

          <Suspense fallback={<div className="h-24 animate-pulse bg-secondary/30 rounded-2xl" />}>
            <AiDealScorer leadId={leadId} />
          </Suspense>

          <Suspense fallback={<div className="h-24 animate-pulse bg-secondary/30 rounded-2xl" />}>
            <AiSellerScript leadId={leadId} />
          </Suspense>

          <Suspense fallback={<div className="h-24 animate-pulse bg-secondary/30 rounded-2xl" />}>
            <AiOfferLetter leadId={leadId} />
          </Suspense>

          {/* Notes */}
          <Card className="rounded-2xl border-white/5 bg-card shadow-lg flex flex-col">
            <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold">Notes</h2>
              {regularNotes.length > 0 && <Badge variant="secondary" className="text-xs">{regularNotes.length}</Badge>}
            </div>
            <div className="p-4 flex-1 overflow-y-auto space-y-3 max-h-80">
              {regularNotes.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm italic py-4">No notes yet.</div>
              ) : (
                regularNotes.map((note: any) => (
                  <div key={note.id} className="bg-secondary/50 p-3 rounded-xl border border-white/5">
                    <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                      {note.content.split(/(@\w+)/g).map((part: string, i: number) =>
                        part.startsWith("@") ? (
                          <span key={i} className="text-primary font-semibold">{part}</span>
                        ) : part
                      )}
                    </p>
                    <div className="flex justify-between items-center mt-2 text-xs text-muted-foreground">
                      <span className="font-medium">{note.userName}</span>
                      <span>{format(new Date(note.createdAt), "MMM d, h:mm a")}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={handleAddNote} className="p-3 border-t border-border bg-secondary/20 space-y-2">
              <MentionTextarea
                value={newNote}
                onChange={setNewNote}
                users={campaignUsers}
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={addNoteMutation.isPending || !newNote.trim()} size="sm" className="rounded-xl px-4">
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add Note
                </Button>
              </div>
            </form>
          </Card>

          {/* Tasks */}
          <Card className="rounded-2xl border-white/5 bg-card shadow-lg">
            <div className="bg-secondary/30 p-4 border-b border-border flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-primary" />
              <h2 className="font-display font-semibold">Tasks</h2>
            </div>
            <div className="p-4 space-y-2 max-h-[250px] overflow-y-auto">
              {tasks?.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm italic py-4">No pending tasks.</div>
              ) : (
                tasks?.map((task: any) => (
                  <div key={task.id} className="flex items-start gap-3 p-3 bg-background/50 rounded-xl border border-white/5">
                    <div className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 ${task.status === "completed" ? "bg-primary border-primary" : "border-muted-foreground"}`} />
                    <div>
                      <p className={`text-sm font-medium ${task.status === "completed" ? "line-through text-muted-foreground" : "text-foreground"}`}>{task.title}</p>
                      {task.dueDate && <p className="text-xs text-muted-foreground mt-1 flex items-center"><Clock className="w-3 h-3 mr-1" /> {format(new Date(task.dueDate), "MMM d")}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={handleAddTask} className="p-3 border-t border-border bg-secondary/20">
              <div className="flex gap-2">
                <Input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="Add a task..." className="bg-background/80 rounded-xl" />
                <Button type="submit" disabled={addTaskMutation.isPending || !newTaskTitle} size="icon" className="rounded-xl shrink-0">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </form>
          </Card>

          {/* ✅ Only render SMS conversations if Twilio is configured */}
{(campaignData?.twilioConfigured || campaignData?.twilioEnabled) && (
  <SmsConversations leadId={leadId} />
)}
        </div>
      </div>

      {/* Cash Buyer AI Match — lazy loaded, full width */}
      <Suspense fallback={<div className="h-24 animate-pulse bg-secondary/30 rounded-2xl" />}>
        <CashBuyerMatchPanel leadId={String(leadId)} leadAddress={lead.address} />
      </Suspense>

      {/* Zillow + Realtor Lookup — full width at bottom */}
      <ZillowCard
        address={lead.address}
        city={lead.city ?? undefined}
        state={lead.state ?? undefined}
        zip={lead.zip ?? undefined}
      />
    </div>
  );
}

# Replit Agent Prompt #3: P2 — Performance Optimization for 1,000+ Leads

> **Priority:** P2 (Fix Third) — Optimize rendering and queries for scale.
> **Target:** AWS Fargate + RDS. Keep single-page layout. No popups/modals.
> **Files:** `leads.ts` (backend), `LeadList.tsx` (list), `LeadDetail.tsx` (detail)

---

## PART 1: BACKEND — `routes/crm/leads.ts`

### 1.1 CRITICAL — Single Query with JOINs (Eliminate N+1)
**Bug:** List view runs 4 separate queries: leads, COUNT, users, campaigns.

**Fix:** One query with LEFT JOINs.
```typescript
const leads = await db.select({
  id: crmLeads.id,
  campaignId: crmLeads.campaignId,
  sellerName: crmLeads.sellerName,
  phone: crmLeads.phone,
  email: crmLeads.email,
  leadSource: crmLeads.leadSource,
  address: crmLeads.address,
  city: crmLeads.city,
  state: crmLeads.state,
  zip: crmLeads.zip,
  propertyType: crmLeads.propertyType,
  beds: crmLeads.beds,
  baths: crmLeads.baths,
  sqft: crmLeads.sqft,
  condition: crmLeads.condition,
  occupancy: crmLeads.occupancy,
  isRental: crmLeads.isRental,
  rentalAmount: crmLeads.rentalAmount,
  askingPrice: crmLeads.askingPrice,
  askingPriceText: crmLeads.askingPriceText,
  currentValue: crmLeads.currentValue,
  estimatedRepairCost: crmLeads.estimatedRepairCost,
  arv: crmLeads.arv,
  mao: crmLeads.mao,
  status: crmLeads.status,
  archived: crmLeads.archived,
  archivedAt: crmLeads.archivedAt,
  assignedTo: crmLeads.assignedTo,
  createdAt: crmLeads.createdAt,
  updatedAt: crmLeads.updatedAt,
  assignedToName: crmUsers.name,
  campaignName: crmCampaigns.name,
})
.from(crmLeads)
.leftJoin(crmUsers, eq(crmLeads.assignedTo, crmUsers.id))
.leftJoin(crmCampaigns, eq(crmLeads.campaignId, crmCampaigns.id))
.where(where)
.orderBy(desc(crmLeads.createdAt))
.limit(limitNum)
.offset(offset);

const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
  .from(crmLeads)
  .where(where);
```

Then update `formatLeadSummary()` to use `assignedToName` directly instead of looking up users:
```typescript
function formatLeadSummary(lead: any) {
  return {
    ...lead,
    assignedToName: lead.assignedToName || null,
    campaignName: lead.campaignName || null,
    // Remove: skipTracedPhones, skipTracedEmails from list view
  };
}
```

### 1.2 CRITICAL — Remove `JSON.parse()` from Formatters
**Bug:** `skipTracedPhones` and `skipTracedEmails` parsed on every call.

**Fix:** Store as JSONB. Remove parsing.
```typescript
// In formatLead() — DELETE these lines:
// skipTracedPhones: lead.skipTracedPhones ? JSON.parse(lead.skipTracedPhones) : [],
// skipTracedEmails: lead.skipTracedEmails ? JSON.parse(lead.skipTracedEmails) : [],

// If DB is already JSONB, just pass through:
skipTracedPhones: lead.skipTracedPhones || [],
skipTracedEmails: lead.skipTracedEmails || [],
```

If DB columns are `text`, migrate to JSONB:
```sql
ALTER TABLE crm_leads ALTER COLUMN skipTracedPhones TYPE JSONB USING skipTracedPhones::JSONB;
ALTER TABLE crm_leads ALTER COLUMN skipTracedEmails TYPE JSONB USING skipTracedEmails::JSONB;
```

### 1.3 CRITICAL — Add Database Indexes
Run via Drizzle migration:
```sql
-- Lead list filtering (most important)
CREATE INDEX idx_leads_campaign_archived_created ON crm_leads(campaignId, archived, createdAt DESC);
CREATE INDEX idx_leads_status ON crm_leads(status);
CREATE INDEX idx_leads_assigned ON crmLeads(assignedTo);

-- Search (trigram for ilike with wildcards)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_leads_search ON crm_leads USING gin (
  (COALESCE(sellerName,'') || ' ' || COALESCE(address,'') || ' ' || COALESCE(phone,'') || ' ' || COALESCE(email,'')) gin_trgm_ops
);

-- Related tables
CREATE INDEX idx_comps_lead ON crm_comps(leadId);
CREATE INDEX idx_notes_lead ON crm_notes(leadId, createdAt DESC);
CREATE INDEX idx_tasks_lead ON crm_tasks(leadId, dueDate);
CREATE INDEX idx_followers_lead ON crm_lead_followers(leadId);
CREATE INDEX idx_followers_lead_user ON crm_lead_followers(leadId, userId);
CREATE INDEX idx_notifications_user_read ON crm_notifications(userId, read);
```

### 1.4 HIGH — Lazy-Loadable `/full` Endpoint
**Bug:** Always fetches notes, tasks, followers, comps.

**Fix:** Accept `?include=` parameter.
```typescript
router.get("/:id/full", crmAuth, async (req, res) => {
  const include = (req.query.include as string || "notes,tasks,followers").split(",");

  const promises: any[] = [
    db.select().from(crmLeads).where(eq(crmLeads.id, id)).limit(1),
  ];

  if (include.includes("notes")) {
    promises.push(db.select().from(crmNotes).where(eq(crmNotes.leadId, id)).orderBy(desc(crmNotes.createdAt)).limit(20));
  } else {
    promises.push(Promise.resolve([]));
  }

  if (include.includes("tasks")) {
    promises.push(db.select().from(crmTasks).where(eq(crmTasks.leadId, id)).orderBy(crmTasks.dueDate));
  } else {
    promises.push(Promise.resolve([]));
  }

  if (include.includes("followers")) {
    promises.push(db.select().from(crmLeadFollowers).where(eq(crmLeadFollowers.leadId, id)));
  } else {
    promises.push(Promise.resolve([]));
  }

  if (include.includes("comps")) {
    promises.push(db.select().from(crmComps).where(eq(crmComps.leadId, id)).orderBy(desc(crmComps.createdAt)));
  } else {
    promises.push(Promise.resolve([]));
  }

  const [leadRows, notes, tasks, followers, comps] = await Promise.all(promises);
  // ... return combined response
});
```

### 1.5 HIGH — Paginate Notes
```typescript
// In GET /:id/notes:
const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
const offset = parseInt(req.query.offset as string) || 0;

const notes = await db.select()
  .from(crmNotes)
  .where(eq(crmNotes.leadId, id))
  .orderBy(desc(crmNotes.createdAt))
  .limit(limit)
  .offset(offset);
```

---

## PART 2: FRONTEND LIST — `LeadList.tsx`

### 2.1 CRITICAL — Remove Staggered Animations
**Bug:** `transition={{ delay: i * 0.05 }}` causes layout thrashing.

**Fix:** Remove delay or use CSS only.
```tsx
// BEFORE:
<motion.div transition={{ delay: i * 0.05 }}>

// AFTER (no delay):
<motion.div transition={{ duration: 0.15 }}>

// OR use CSS (fastest):
<div className="transition-all duration-150 hover:bg-secondary/40">
```

### 2.2 CRITICAL — Debounce Search Input
**Bug:** API call on every keystroke.

**Fix:**
```tsx
const [search, setSearch] = useState("");
const [debouncedSearch, setDebouncedSearch] = useState("");

useEffect(() => {
  const timer = setTimeout(() => setDebouncedSearch(search), 400);
  return () => clearTimeout(timer);
}, [search]);

// Pass debouncedSearch to the query:
const { data } = useCrmGetLeads({
  search: debouncedSearch || undefined,
  status: statusFilter || undefined,
  page,
  limit: PAGE_SIZE,
});
```

### 2.3 HIGH — Pre-Format Dates in Backend
**Bug:** `format()`, `formatDistanceToNow()`, `differenceInDays()` run inline for every lead.

**Fix:** Move to backend formatter.
```typescript
// In backend formatLeadSummary():
return {
  ...lead,
  createdAtFormatted: format(lead.createdAt, "MMM d, yyyy"),
  updatedAtRelative: lead.updatedAt && lead.updatedAt !== lead.createdAt
    ? formatDistanceToNow(lead.updatedAt, { addSuffix: true })
    : null,
  daysSinceUpdate: differenceInDays(new Date(), lead.updatedAt || lead.createdAt),
};
```

Then in frontend, use the pre-formatted strings:
```tsx
<span>Submitted {lead.createdAtFormatted}</span>
{lead.updatedAtRelative && <span>Updated {lead.updatedAtRelative}</span>}
{lead.daysSinceUpdate >= 7 && <Badge>{lead.daysSinceUpdate}d</Badge>}
```

### 2.4 MEDIUM — Memoize Status Colors
**Fix:** Lookup object outside component.
```tsx
const STATUS_COLORS: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  contacted: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  qualified: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  negotiating: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  under_contract: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  closed: 'bg-green-500/10 text-green-400 border-green-500/20',
  dead: 'bg-red-500/10 text-red-400 border-red-500/20',
};

// Usage:
<Badge className={STATUS_COLORS[lead.status] || 'bg-secondary text-muted-foreground border-border'}>
```

---

## PART 3: FRONTEND DETAIL — `LeadDetail.tsx`

### 3.1 CRITICAL — `useRef` for Form Data
**Bug:** `setFormData()` on every keystroke re-renders entire component.

**Fix:**
```tsx
const formRef = useRef<any>({});
const [isDirty, setIsDirty] = useState(false);

// Initialize once:
useEffect(() => {
  if (lead) {
    formRef.current = { ...lead };
    // Force one re-render to populate inputs
    setFormDataSnapshot({ ...lead });
  }
}, [lead?.id]); // Only when lead ID changes

const handleChange = (key: string, val: any) => {
  formRef.current[key] = val;
  setIsDirty(true);
};

// For inputs that need controlled state, use local state per field:
const [localValues, setLocalValues] = useState<Record<string, any>>({});

const handleInputChange = (key: string, val: any) => {
  setLocalValues(prev => ({ ...prev, [key]: val }));
  formRef.current[key] = val;
  setIsDirty(true);
};

// On save:
const handleSave = () => {
  updateMutation.mutate({ id: leadId, data: formRef.current });
};
```

### 3.2 CRITICAL — Fix Auto-Save Dependencies
**Bug:** `useEffect([isDirty, formData])` fires on every keystroke.

**Fix:**
```tsx
useEffect(() => {
  if (!isDirty) return;
  const timer = setTimeout(() => {
    updateMutation.mutate({ id: leadId, data: formRef.current });
  }, 1500);
  return () => clearTimeout(timer);
}, [isDirty]); // ONLY isDirty, not formData
```

### 3.3 CRITICAL — Memoize CompsSection
**Bug:** Calculations run on every parent render.

**Fix:** Wrap in `useMemo`.
```tsx
const marketSqftRate = useMemo(() => {
  const rates = comps
    .filter((c: any) => c.salePrice > 0 && c.sqft > 0)
    .map((c: any) => c.salePrice / c.sqft)
    .sort((a: number, b: number) => a - b);
  return rates.length > 0 ? rates[Math.floor(rates.length / 2)] : 50;
}, [comps]);

const avgAdjusted = useMemo(() => {
  const withAdj = comps.filter((c: any) => c.adjustedPrice > 0);
  return withAdj.length > 0
    ? Math.round(withAdj.reduce((s: number, c: any) => s + c.adjustedPrice, 0) / withAdj.length)
    : null;
}, [comps]);

const dealRatio = useMemo(() => {
  const arv = Number(lead?.arv) || 0;
  const asking = Number(lead?.askingPrice) || 0;
  return arv && asking ? arv / asking : null;
}, [lead?.arv, lead?.askingPrice]);
```

### 3.4 CRITICAL — `React.memo()` for AI Components
**Fix:**
```tsx
const AiDealScorer = React.memo(function AiDealScorer({ leadId }: { leadId: number }) {
  // ... existing component logic
});

const AiSellerScript = React.memo(function AiSellerScript({ leadId }: { leadId: number }) {
  // ... existing component logic
});

const AiOfferLetter = React.memo(function AiOfferLetter({ leadId }: { leadId: number }) {
  // ... existing component logic
});

const AiRepairEstimator = React.memo(function AiRepairEstimator({ leadId, onApplied }: { leadId: number; onApplied: (total: number) => void }) {
  // ... existing component logic
});
```

### 3.5 HIGH — Lazy Load Below-Fold Sections
**Fix:**
```tsx
import { Suspense, lazy } from "react";

const CompsSection = lazy(() => import("@/components/leads/CompsSection"));
const AiDealScorer = lazy(() => import("@/components/leads/AiDealScorer"));
const AiSellerScript = lazy(() => import("@/components/leads/AiSellerScript"));
const AiOfferLetter = lazy(() => import("@/components/leads/AiOfferLetter"));
const AiRepairEstimator = lazy(() => import("@/components/leads/AiRepairEstimator"));
const CashBuyerMatchPanel = lazy(() => import("@/components/leads/CashBuyerMatchPanel"));

// In render:
<Suspense fallback={<div className="h-32 animate-pulse bg-secondary/30 rounded-xl" />}>
  <CompsSection leadId={leadId} lead={lead} />
</Suspense>
```

### 3.6 HIGH — Split Data Fetching
**Fix:**
```tsx
// Lightweight lead data (eager):
const { data: lead } = useQuery({
  queryKey: ["lead", leadId],
  queryFn: () => apiFetch(`/leads/${leadId}`),
});

// Notes (eager but paginated):
const { data: notes } = useQuery({
  queryKey: ["lead-notes", leadId],
  queryFn: () => apiFetch(`/leads/${leadId}/notes?limit=20`),
});

// Comps (lazy — only when section visible):
const [showComps, setShowComps] = useState(false);
const { data: comps } = useQuery({
  queryKey: ["lead-comps", leadId],
  queryFn: () => apiFetch(`/leads/${leadId}/full?include=comps`),
  enabled: showComps,
});

// AI panels (lazy — only when scrolled into view or clicked):
const [showAiScorer, setShowAiScorer] = useState(false);
```

### 3.7 HIGH — Fix Init `useEffect`
**Bug:** Runs on every `lead` change (background refetch).

**Fix:**
```tsx
useEffect(() => {
  if (lead && !initializedRef.current) {
    formRef.current = { ...lead };
    setLocalValues({ ...lead });
    initializedRef.current = true;
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []); // Empty dependency — run once on mount
```

### 3.8 MEDIUM — Cache Campaign Users Globally
**Fix:**
```tsx
// In a global context/hook (fetch once per session):
const useCampaignUsers = () => {
  const { data } = useQuery({
    queryKey: ["campaign-users"],
    queryFn: () => apiFetch("/users"),
    staleTime: Infinity, // Never refetch during session
    cacheTime: Infinity,
  });
  return data || [];
};
```

### 3.9 MEDIUM — Debounce Text Inputs
**Fix:**
```tsx
const useDebouncedValue = (value: string, delay: number = 200) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
};

// Usage for address field:
const [addressInput, setAddressInput] = useState("");
const debouncedAddress = useDebouncedValue(addressInput, 200);

useEffect(() => {
  handleChange("address", debouncedAddress);
}, [debouncedAddress]);
```

### 3.10 MEDIUM — Memoize MentionTextarea
**Fix:**
```tsx
const MentionTextarea = React.memo(function MentionTextarea({
  value, onChange, users, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  users: any[];
  placeholder?: string;
}) {
  // ... existing component logic
});
```

---

## PART 4: VERIFICATION (Prompt #3)

### Backend
- [ ] List view uses single query with JOINs
- [ ] `formatLeadSummary()` does not call `JSON.parse()`
- [ ] All 11 indexes created
- [ ] `/full` supports `?include=` parameter
- [ ] Notes endpoint supports `?limit=20&offset=0`
- [ ] Search uses trigram index

### Frontend List
- [ ] No staggered animation delays
- [ ] Search debounced by 400ms
- [ ] Dates pre-formatted in backend
- [ ] `getStatusColor` uses lookup object

### Frontend Detail
- [ ] `formRef` used for form values
- [ ] `isDirty` is only React state
- [ ] Auto-save `useEffect` has `[isDirty]` only
- [ ] `CompsSection` uses `useMemo` for calculations
- [ ] All 4 AI components wrapped in `React.memo()`
- [ ] `React.lazy()` + `Suspense` for below-fold
- [ ] Separate `useQuery` calls (not one `/full`)
- [ ] Init `useEffect` has `[]` dependency
- [ ] Campaign users cached globally (`staleTime: Infinity`)
- [ ] `MentionTextarea` memoized

### Performance Targets
- [ ] List view (20 leads) loads in < 300ms
- [ ] Lead detail initial render in < 500ms
- [ ] Typing in form has zero lag
- [ ] Comps calculate instantly
- [ ] AI panels don't re-render on keystroke
- [ ] App handles 1,000+ leads smoothly

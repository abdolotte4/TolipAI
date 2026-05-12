import { pgTable, serial, text, integer, numeric, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

export const crmCampaigns = pgTable("crm_campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  active: boolean("active").notNull().default(true),
  maxUsers: integer("max_users"),
  allowLeadDeletion: boolean("allow_lead_deletion").notNull().default(false),
  ownerUserId: integer("owner_user_id"),
  skipTraceDailyLimit: integer("skip_trace_daily_limit").notNull().default(1),
  fetchCompsDailyLimit: integer("fetch_comps_daily_limit").notNull().default(1),
  openPhoneNumberId: text("openphone_number_id"),
  openPhoneNumber: text("openphone_number"),
  dialerEnabled: boolean("dialer_enabled").notNull().default(false),
  // Twilio: per-campaign credentials so each campaign uses their own Twilio account
  twilioAccountSid: text("twilio_account_sid"),
  twilioAuthToken: text("twilio_auth_token"),  // stored AES-256 encrypted
  twilioPhoneNumber: text("twilio_phone_number"),
  twilioEnabled: boolean("twilio_enabled").notNull().default(false),
  // Propelio: per-campaign login (AES-256 encrypted passwords)
  scraperProperioEmail: text("scraper_propelio_email"),
  scraperProperioPassword: text("scraper_propelio_password"),
  // Propwire: per-campaign login (AES-256 encrypted passwords)
  scraperPropwireEmail: text("scraper_propwire_email"),
  scraperPropwirePassword: text("scraper_propwire_password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const crmUsers = pgTable("crm_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  encryptedPassword: text("encrypted_password"),
  role: text("role").notNull().default("sales"),
  status: text("status").notNull().default("active"),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const crmLeads = pgTable("crm_leads", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  sellerName: text("seller_name").notNull(),
  phone: text("phone"),
  email: text("email"),
  leadSource: text("lead_source"),
  skipTracedPhones: text("skip_traced_phones"),
  skipTracedEmails: text("skip_traced_emails"),
  skipTracedName: text("skip_traced_name"),
  address: text("address").notNull(),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  propertyType: text("property_type"),
  beds: integer("beds"),
  baths: numeric("baths", { precision: 4, scale: 1 }),
  sqft: integer("sqft"),
  yearBuilt: integer("year_built"),
  ownerName: text("owner_name"),
  lastSaleDate: text("last_sale_date"),
  lastSalePrice: numeric("last_sale_price", { precision: 12, scale: 2 }),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  condition: integer("condition"),
  currentValue: numeric("current_value", { precision: 12, scale: 2 }),
  estimatedRepairCost: numeric("estimated_repair_cost", { precision: 12, scale: 2 }),
  arv: numeric("arv", { precision: 12, scale: 2 }),
  mao: numeric("mao", { precision: 12, scale: 2 }),
  // Per-lead MAO discount override: user can tune 0.70/0.80/0.90 thresholds per deal
  // Value 0.01–0.99 overrides the condition-based default; null means use condition default
  maoDiscountOverride: numeric("mao_discount_override", { precision: 5, scale: 2 }),
  occupancy: text("occupancy"),
  isRental: boolean("is_rental").notNull().default(false),
  rentalAmount: numeric("rental_amount", { precision: 12, scale: 2 }),
  reasonForSelling: text("reason_for_selling"),
  howSoon: text("how_soon"),
  askingPrice: numeric("asking_price", { precision: 12, scale: 2 }),
  askingPriceText: text("asking_price_text"),
  rentcastAvmValue: numeric("rentcast_avm_value", { precision: 12, scale: 2 }),
  rentcastAvmLow: numeric("rentcast_avm_low", { precision: 12, scale: 2 }),
  rentcastAvmHigh: numeric("rentcast_avm_high", { precision: 12, scale: 2 }),
  rentcastAvmFetchedAt: timestamp("rentcast_avm_fetched_at"),
  attomAvmValue: numeric("attom_avm_value", { precision: 12, scale: 2 }),
  attomAvmLow: numeric("attom_avm_low", { precision: 12, scale: 2 }),
  attomAvmHigh: numeric("attom_avm_high", { precision: 12, scale: 2 }),
  attomAvmConfidence: integer("attom_avm_confidence"),
  attomAvmFetchedAt: timestamp("attom_avm_fetched_at"),
  notes: text("notes"),
  status: text("status").notNull().default("new"),
  archived: boolean("archived").notNull().default(false),
  archivedAt: timestamp("archived_at"),
  assignedTo: integer("assigned_to").references(() => crmUsers.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("crm_leads_campaign_id_idx").on(t.campaignId),
  index("crm_leads_status_idx").on(t.status),
  index("crm_leads_archived_idx").on(t.archived),
  index("crm_leads_assigned_to_idx").on(t.assignedTo),
  index("crm_leads_created_at_idx").on(t.createdAt),
  // Composite: most common query is "active leads for a campaign ordered by date"
  index("crm_leads_campaign_archived_created_idx").on(t.campaignId, t.archived, t.createdAt),
]);

export const crmNotes = pgTable("crm_notes", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => crmLeads.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => crmUsers.id),
  content: text("content").notNull(),
  noteType: text("note_type").notNull().default("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_notes_lead_id_idx").on(t.leadId),
]);

export const crmLeadFollowers = pgTable("crm_lead_followers", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => crmLeads.id, { onDelete: "cascade" }),
  userId: integer("user_id").notNull().references(() => crmUsers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_lead_followers_lead_id_idx").on(t.leadId),
  index("crm_lead_followers_user_id_idx").on(t.userId),
  uniqueIndex("crm_lead_followers_lead_user_uniq").on(t.leadId, t.userId),
]);

export const crmNotifications = pgTable("crm_notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => crmUsers.id, { onDelete: "cascade" }),
  leadId: integer("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("update"),
  content: text("content").notNull(),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_notifications_user_id_idx").on(t.userId),
  index("crm_notifications_read_idx").on(t.read),
  index("crm_notifications_created_at_idx").on(t.createdAt),
]);

export const crmOpenPhoneMessages = pgTable("crm_openphone_messages", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  openPhoneMessageId: text("openphone_message_id").unique(),
  direction: text("direction").notNull(),
  fromNumber: text("from_number"),
  toNumber: text("to_number"),
  content: text("content"),
  status: text("status"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_op_messages_lead_id_idx").on(t.leadId),
  index("crm_op_messages_from_number_idx").on(t.fromNumber),
  index("crm_op_messages_created_at_idx").on(t.createdAt),
]);

export const crmTasks = pgTable("crm_tasks", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  leadId: integer("lead_id").references(() => crmLeads.id, { onDelete: "set null" }),
  assignedTo: integer("assigned_to").references(() => crmUsers.id),
  title: text("title").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date"),
  status: text("status").notNull().default("pending"),
  priority: text("priority").notNull().default("normal"),
  source: text("source").notNull().default("manual"),
  escalated: boolean("escalated").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_tasks_lead_id_idx").on(t.leadId),
  index("crm_tasks_campaign_id_idx").on(t.campaignId),
  index("crm_tasks_assigned_to_idx").on(t.assignedTo),
  index("crm_tasks_status_idx").on(t.status),
  index("crm_tasks_due_date_idx").on(t.dueDate),
]);

export const crmEmailSequences = pgTable("crm_email_sequences", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("crm_email_sequences_campaign_id_idx").on(t.campaignId),
  index("crm_email_sequences_is_active_idx").on(t.isActive),
]);

export const crmSequenceSteps = pgTable("crm_sequence_steps", {
  id: serial("id").primaryKey(),
  sequenceId: integer("sequence_id").notNull().references(() => crmEmailSequences.id, { onDelete: "cascade" }),
  dayOffset: integer("day_offset").notNull().default(0),
  type: text("type").notNull().default("email"), // email | sms | direct_mail
  subject: text("subject").notNull().default(""),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const crmSequenceLogs = pgTable("crm_sequence_logs", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => crmLeads.id, { onDelete: "cascade" }),
  sequenceId: integer("sequence_id").notNull().references(() => crmEmailSequences.id, { onDelete: "cascade" }),
  stepId: integer("step_id").notNull().references(() => crmSequenceSteps.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("email"), // email | sms | direct_mail
  status: text("status").notNull().default("sent"),
  errorMessage: text("error_message"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
}, (t) => [
  index("crm_sequence_logs_lead_id_idx").on(t.leadId),
  index("crm_sequence_logs_step_id_idx").on(t.stepId),
  index("crm_sequence_logs_sent_at_idx").on(t.sentAt),
]);

export const crmSmsOptOuts = pgTable("crm_sms_opt_outs", {
  id: serial("id").primaryKey(),
  phone: text("phone").notNull().unique(),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  optedOutAt: timestamp("opted_out_at").defaultNow().notNull(),
}, (t) => [
  index("crm_sms_opt_outs_campaign_id_idx").on(t.campaignId),
  index("crm_sms_opt_outs_phone_idx").on(t.phone),
]);

export const crmComps = pgTable("crm_comps", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => crmLeads.id, { onDelete: "cascade" }),
  address: text("address").notNull(),
  beds: integer("beds"),
  baths: numeric("baths", { precision: 4, scale: 1 }),
  sqft: integer("sqft"),
  yearBuilt: integer("year_built"),
  salePrice: numeric("sale_price", { precision: 12, scale: 2 }),
  adjustedPrice: numeric("adjusted_price", { precision: 12, scale: 2 }),
  soldDate: text("sold_date"),
  notes: text("notes"),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_comps_lead_id_idx").on(t.leadId),
]);

export const crmBuyers = pgTable("crm_buyers", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  address: text("address"),
  notes: text("notes"),
  uploadedBy: integer("uploaded_by").references(() => crmUsers.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_buyers_campaign_id_idx").on(t.campaignId),
  index("crm_buyers_created_at_idx").on(t.createdAt),
]);

export const crmSubmissionLinks = pgTable("crm_submission_links", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  token: text("token").notNull().unique(),
  label: text("label"),
  leadSource: text("lead_source"),
  active: boolean("active").notNull().default(true),
  createdBy: integer("created_by").references(() => crmUsers.id),
  submissionsCount: integer("submissions_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_submission_links_campaign_id_idx").on(t.campaignId),
  index("crm_submission_links_active_idx").on(t.active),
]);

// ─── Advanced Scraper Engine (Python service) ────────────────────────────────
// Generic job tracking for any async scrape kicked off by the Python engine.

export const scraperJobs = pgTable("scraper_jobs", {
  id: text("id").primaryKey(),
  jobType: text("job_type").notNull(),       // cash_buyers | distressed | skip_trace
  status: text("status").notNull().default("queued"), // queued | running | done | failed
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  leadId: integer("lead_id").references(() => crmLeads.id, { onDelete: "set null" }),
  createdBy: integer("created_by").references(() => crmUsers.id),
  params: jsonb("params").notNull().default({}),
  progress: integer("progress").notNull().default(0),     // 0-100
  resultCount: integer("result_count").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  index("scraper_jobs_lead_id_idx").on(t.leadId),
  index("scraper_jobs_status_idx").on(t.status),
  index("scraper_jobs_type_idx").on(t.jobType),
  index("scraper_jobs_created_at_idx").on(t.createdAt),
]);

// Cash buyer matches discovered for a specific lead. Each row is one investor
// (LLC or individual) ranked by match quality against the lead's property.
export const cashBuyerMatches = pgTable("cash_buyer_matches", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull().references(() => crmLeads.id, { onDelete: "cascade" }),
  jobId: text("job_id").references(() => scraperJobs.id, { onDelete: "set null" }),
  buyerName: text("buyer_name").notNull(),       // human-readable display name
  llcName: text("llc_name"),                     // legal entity if known
  buyerType: text("buyer_type").notNull().default("unknown"), // flipper|landlord|hedge_fund|lender|wholesaler|unknown
  matchScore: integer("match_score").notNull().default(0),    // 0-100
  matchReasons: jsonb("match_reasons").notNull().default([]), // string[]
  portfolioSize: integer("portfolio_size"),
  portfolioValue: numeric("portfolio_value", { precision: 14, scale: 2 }),
  portfolioAppreciation: numeric("portfolio_appreciation", { precision: 6, scale: 2 }), // %
  avgPurchasePrice: numeric("avg_purchase_price", { precision: 12, scale: 2 }),
  lastPurchaseDate: text("last_purchase_date"),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  mailingAddress: text("mailing_address"),
  phones: jsonb("phones").notNull().default([]),     // string[]
  emails: jsonb("emails").notNull().default([]),     // string[]
  principals: jsonb("principals").notNull().default([]), // {name,role}[]
  classificationReason: text("classification_reason"),
  source: text("source").notNull().default("scraper-engine"),
  rawData: jsonb("raw_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("cash_buyer_matches_lead_id_idx").on(t.leadId),
  index("cash_buyer_matches_job_id_idx").on(t.jobId),
  index("cash_buyer_matches_score_idx").on(t.matchScore),
  index("cash_buyer_matches_type_idx").on(t.buyerType),
]);

// Distressed property listings discovered by the AI multi-source scraper.
export const distressedListings = pgTable("distressed_listings", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").references(() => scraperJobs.id, { onDelete: "cascade" }),
  campaignId: integer("campaign_id").references(() => crmCampaigns.id),
  distressType: text("distress_type").notNull(), // trustee_sale|auction|preforeclosure|tax_lien|code_violation|probate|fsbo|expired
  address: text("address").notNull(),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  county: text("county"),
  parcelId: text("parcel_id"),
  ownerName: text("owner_name"),
  saleDate: text("sale_date"),
  openingBid: numeric("opening_bid", { precision: 12, scale: 2 }),
  estimatedValue: numeric("estimated_value", { precision: 12, scale: 2 }),
  mortgageBalance: numeric("mortgage_balance", { precision: 12, scale: 2 }),
  source: text("source").notNull(),       // trustee | auction.com | zillow | redfin | tax_collector | ...
  sourceUrl: text("source_url"),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  rawData: jsonb("raw_data"),
  importedAsLeadId: integer("imported_as_lead_id").references(() => crmLeads.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("distressed_listings_job_id_idx").on(t.jobId),
  index("distressed_listings_zip_idx").on(t.zip),
  index("distressed_listings_county_idx").on(t.county),
  index("distressed_listings_type_idx").on(t.distressType),
  index("distressed_listings_sale_date_idx").on(t.saleDate),
]);

// Comparable sales pulled from Propwire or Propelio for a lead.
export const propertyComps = pgTable("property_comps", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
  jobId: text("job_id"),
  source: text("source").notNull().default("propwire"), // propwire | propelio | manual
  address: text("address").notNull(),
  city: text("city"),
  state: text("state"),
  zip: text("zip"),
  beds: integer("beds"),
  baths: numeric("baths", { precision: 4, scale: 1 }),
  sqft: integer("sqft"),
  lotSqft: integer("lot_sqft"),
  yearBuilt: integer("year_built"),
  salePrice: numeric("sale_price", { precision: 12, scale: 2 }),
  pricePerSqft: numeric("price_per_sqft", { precision: 10, scale: 2 }),
  soldDate: text("sold_date"),
  status: text("status"),             // Sold | Active | Pending
  distanceFromSubject: numeric("distance_from_subject", { precision: 6, scale: 2 }),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  sourceUrl: text("source_url"),
  rawData: jsonb("raw_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("property_comps_lead_id_idx").on(t.leadId),
  index("property_comps_source_idx").on(t.source),
]);

// Sale + mortgage history for a lead's property (from Propwire).
export const propertyHistory = pgTable("property_history", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
  source: text("source").notNull().default("propwire"),
  eventType: text("event_type").notNull(), // sale | mortgage | refinance | transfer
  eventDate: text("event_date"),
  salePrice: numeric("sale_price", { precision: 12, scale: 2 }),
  mortgageAmount: numeric("mortgage_amount", { precision: 12, scale: 2 }),
  lenderName: text("lender_name"),
  buyerName: text("buyer_name"),
  sellerName: text("seller_name"),
  documentType: text("document_type"),
  rawData: jsonb("raw_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("property_history_lead_id_idx").on(t.leadId),
  index("property_history_event_type_idx").on(t.eventType),
]);

// Tax assessment + tax history for a lead's property (from Propwire).
export const propertyTax = pgTable("property_tax", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
  source: text("source").notNull().default("propwire"),
  assessedValue: numeric("assessed_value", { precision: 12, scale: 2 }),
  marketValue: numeric("market_value", { precision: 12, scale: 2 }),
  landValue: numeric("land_value", { precision: 12, scale: 2 }),
  improvementValue: numeric("improvement_value", { precision: 12, scale: 2 }),
  annualTax: numeric("annual_tax", { precision: 10, scale: 2 }),
  taxYear: text("tax_year"),
  parcelId: text("parcel_id"),
  legalDescription: text("legal_description"),
  taxHistory: jsonb("tax_history"),   // [{year, assessed, taxes}]
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (t) => [
  index("property_tax_lead_id_idx").on(t.leadId),
]);

// ─── Tools: Batch Jobs (persistent across restarts) ──────────────────────────

export const toolsSkipTraceJobs = pgTable("tools_skip_trace_jobs", {
  jobId:           text("job_id").primaryKey(),
  status:          text("status").notNull().default("queued"),
  startedAt:       timestamp("started_at"),
  totalRecords:    integer("total_records").notNull().default(0),
  processed:       integer("processed").notNull().default(0),
  succeeded:       integer("succeeded").notNull().default(0),
  failed:          integer("failed").notNull().default(0),
  progressPercent: integer("progress_percent").notNull().default(0),
  resultRows:      jsonb("result_rows").notNull().default([]),
  error:           text("error"),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});

export const toolsDistressedJobs = pgTable("tools_distressed_jobs", {
  jobId:               text("job_id").primaryKey(),
  status:              text("status").notNull().default("queued"),
  startedAt:           timestamp("started_at"),
  locations:           jsonb("locations").notNull().default([]),
  categories:          jsonb("categories").notNull().default([]),
  totalLocations:      integer("total_locations").notNull().default(0),
  locationsProcessed:  integer("locations_processed").notNull().default(0),
  totalFound:          integer("total_found").notNull().default(0),
  resultRows:          jsonb("result_rows").notNull().default([]),
  error:               text("error"),
  createdAt:           timestamp("created_at").defaultNow().notNull(),
});

// Skip-trace results for a lead or a buyer name.
export const skipTraceResults = pgTable("skip_trace_results", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").references(() => crmLeads.id, { onDelete: "cascade" }),
  subjectName: text("subject_name").notNull(),
  llcName: text("llc_name"),
  phones: jsonb("phones"),            // string[]
  emails: jsonb("emails"),            // string[]
  principals: jsonb("principals"),    // [{name, role}]
  addresses: jsonb("addresses"),      // string[]
  sources: jsonb("sources"),          // which skip-trace sources returned data
  rawData: jsonb("raw_data"),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (t) => [
  index("skip_trace_results_lead_id_idx").on(t.leadId),
  index("skip_trace_results_name_idx").on(t.subjectName),
]);
# IDR Workflow Demo TODO

## Database Schema
- [x] IDR disputes table (all 19 workflow steps, state machine, deadlines)
- [x] Dispute parties table (initiating party, responding party)
- [x] Dispute timeline/events table (step transitions, timestamps)
- [x] Offers table (QPA, counter-offers, final determinations)
- [x] Documents table (supporting evidence, attachments)
- [x] Arbitrators table (certified IDR entities)
- [x] Notifications table (deadline alerts, status updates)

## Backend tRPC Routers
- [x] disputes.create — initiate new IDR dispute
- [x] disputes.list — list all disputes with filters
- [x] disputes.getTimeline — get full dispute detail with 19-step timeline
- [x] disputes.advance — advance to next workflow step
- [x] disputes.submitOffer — submit QPA/counter-offer
- [x] disputes.selectArbitrator — assign certified IDR entity
- [x] disputes.uploadDocument — attach supporting evidence
- [x] dashboard.stats — KPI summary for dashboard
- [x] arbitrators.list — list certified IDR entities
- [x] notifications.list — get pending deadline alerts
- [x] notifications.markAllRead — mark all notifications read

## Frontend Pages
- [x] Home (/) — landing page with redirect to dashboard when authenticated
- [x] Dashboard (/dashboard) — KPI cards, recent disputes, deadline alerts, NSA timeline reference
- [x] Disputes List (/disputes) — searchable paginated table with status filter tabs
- [x] Dispute Detail (/disputes/:id) — full 19-step visual timeline, financial summary, deadlines, parties
- [x] New Dispute (/disputes/new) — 5-step form wizard to initiate IDR
- [x] Offer Submission modal — QPA/party offer entry with type selection
- [x] Arbitrator Selection modal — certified IDR entity picker with stats
- [x] Document Upload modal — evidence attachment (documents.upload + documents.list routers)
- [x] Notifications panel — dedicated notifications page (/notifications)
- [x] Admin view (/admin) — all disputes across all parties

## Infrastructure
- [x] DB migration pushed (pnpm db:push)
- [x] Vitest tests: 17 passing (business days, reference numbers, step sequence, status transitions, financial validation)
- [x] TypeScript: 0 errors
- [x] Checkpoint saved

## New Features (Session 3)
- [x] Seed script — 25+ disputes at various workflow stages, IDR entities, offers, timeline events, notifications
- [x] Document Upload modal — on Dispute Detail page, wired to documents.upload tRPC, with document list
- [x] Fraud Alert Detail view — clickable alerts on Dashboard showing AI reasoning, confidence breakdown, transaction details
- [x] Final publish-ready checkpoint

## Session 4 Features
- [x] Offer negotiation panel on Dispute Detail — Counter-Offer form, offer history timeline, accept/reject actions
- [x] acceptOffer tRPC procedure — marks offer accepted, advances dispute to STEP_13, creates determination notification
- [x] TypeScript errors fixed: acceptOffer procedure added to disputes router, err type annotation corrected
- [x] Notification delivery — server/notifications.ts with email/SMS delivery wired to notifications table
- [x] Dispute PDF export — server/pdf-export.ts with full timeline, offers, and determination; Export PDF button on DisputeDetail
- [x] Python AI microservice — LangGraph + LangChain + FastAPI in /ai-service directory
- [x] DocumentAnalysisAgent — LangGraph graph with extraction, validation, classification nodes
- [x] CMSSubmissionAgent — LangGraph graph with eligibility check, form pre-fill, narrative generation nodes
- [x] IDRAssistantAgent — LangGraph ReAct agent with NSA regulatory tool calling
- [x] FastAPI endpoints: POST /analyze-document, POST /cms-submission, POST /ask-assistant
- [x] Node.js tRPC ai.* procedures proxy to Python microservice
- [x] AI Assistant React page (/ai-assistant) with chat UI, document analysis panel, CMS submission generator
- [x] Stakeholder upload portal — document drag-and-drop with AI analysis on upload
- [x] CMS submission tracker — status board showing submission drafts and eligibility results

## Session 5 — Suggested Next Steps
- [x] cms_drafts DB table — schema, migration, and DB helpers (save/load/list)
- [x] Persist CMS drafts via tRPC — save on generate, load on tracker mount, list all drafts
- [x] AI_SERVICE_URL secret — defaults to http://localhost:8000, configurable via env var
- [x] AI dispute summary card — IDRAssistantAgent one-click summary on DisputeDetail page with confidence badge, sources, suggested actions, refresh button

## Session 6 — Suggested Next Steps
- [x] GitHub export — push idr-workflow-demo code to munisp/healthpoint repository (commit c46d761)
- [x] disputesByMonth tRPC procedure — group disputes by createdAt month for analytics
- [x] Dashboard analytics chart — Recharts stacked BarChart with 3M/6M/12M toggle, status breakdown (open_negotiation, idr_active, closed, ineligible), empty state
- [x] Role-based CMS draft visibility — listCMSDrafts accepts adminAll flag; admins get listAllCMSDrafts, users get listCMSDraftsByUser
- [x] Admin toggle in CMS Tracker — violet "View All Drafts" toggle button visible to admins only; invalidates query on toggle

## Session 7 — Suggested Next Steps + Agentic AI Value Analysis
- [x] Dispute search and filter bar — debounced live search, service type select, collapsible status tabs, active filter chips, clear-all button
- [x] Due Soon KPI card — getDashboardStats extended with dueSoon count (7-day window), amber pulse ring KPI card on Dashboard
- [x] Scheduled deadline-check heartbeat — POST /api/scheduled/deadline-check handler, idempotent, scans all open disputes, warning + overdue notifications, mounted in index.ts
- [x] Agentic AI value analysis document — docs/agentic-ai-value-analysis.md: 7-section analysis, before/after tables, 94%/88%/99% improvement metrics, equity impact, 6 citations

## Session 8 — Heartbeat Crons, CSV Export, Weekly Digest, GitHub Push
- [x] Register daily deadline-check heartbeat cron — task_uid: eSu5Yu9ZEaCiN7EWNZr29f, runs 08:00 UTC daily
- [x] disputes.exportCSV tRPC procedure — exports up to 10,000 rows with all 21 fields, respects status/serviceType/search filters
- [x] CSV download button on DisputesList — Export CSV (N) button in page header, client-side Blob download
- [x] Weekly AI digest heartbeat handler at /api/scheduled/weekly-digest — IDRAssistantAgent summary, idempotent per admin per week, fallback summary if AI unavailable
- [x] Register weekly digest heartbeat cron — task_uid: ZDznRd9mLrf54uBzvgJ8BD, runs 09:00 UTC every Monday, next: 2026-07-13
- [x] Push latest code to munisp/healthpoint GitHub repository — commit 0a09c72, 30 files, 2294 insertions

## Session 9 — Bulletproof CMS Validation, EMR Onboarding, Agentic AI for EMR
- [x] Bulletproof CMS validation pipeline — 5-layer LangGraph guard in ai-service/cms_validator.py
- [x] validateCMSSubmission FastAPI endpoint — POST /validate-cms-submission
- [x] tRPC ai.validateCMSSubmission procedure — proxy to Python /validate-cms-submission, graceful fallback if AI unavailable
- [x] CMS Submission Tracker: validation gate UI — ✓ Validate button, inline report (red/amber/green), blocking issues disable Mark Submitted, remediation steps shown
- [x] emr_connections DB table — schema, migration, DB helpers (create/list/get/update/deactivate/delete)
- [x] EMR Onboarding wizard page (/emr-onboarding) — 5-step wizard: system select, credentials, field mapping, AI test, activate
- [x] EMR Connections management page (/emr-connections) — list, status badges, confidence scores, deactivate/delete
- [x] tRPC emr.* procedures — list/get/test/create/deactivate/delete
- [x] EMR Connections nav item in DashboardLayout sidebar
- [x] Strategic document: docs/agentic-ai-emr-integration.md — 6 agentic AI opportunities, before/after tables, 5-phase roadmap, 6 citations
- [x] Push all code to munisp/healthpoint GitHub — commit 777b25e, 15 files, 3740 insertions

## Session 10 — AI Auto-Fix, EMR Data Pull, Sync History Modal
- [x] Python /auto-fix-cms-submission endpoint — LangGraph agent applies remediations to draft fields
- [x] tRPC ai.autoFixCMSSubmission procedure — proxy to Python, returns patched submission fields
- [x] CMS Tracker: Auto-Fix button — violet Auto-Fix button, patches formFields in state, shows applied count badge and green success card
- [x] Python /extract-emr-data endpoint — simulates FHIR R4 data pull, maps to NSA IDR fields
- [x] tRPC ai.pullDisputeData procedure — calls Python /extract-emr-data, returns pre-filled dispute fields with confidence scores
- [x] Pull from EMR panel on NewDispute wizard — teal collapsible panel, EMR selector, patient/claim ID inputs, auto-populates 12 form fields, field confidence chips, FHIR resource tags
- [x] emr_sync_logs DB table — pgTable (16 cols, 2 indexes), migration pushed, listEMRSyncLogs + createEMRSyncLog helpers
- [x] tRPC emr.syncHistory procedure — protected, owner/admin-gated, up to 200 rows
- [x] EMR Connections: Sync History modal — Dialog with 4 summary metrics, expandable log rows, confidence chips, FHIR resource badges, warning list, trigger type badge, refresh button

## Session 11 — Re-test Button, Outcome Analytics, Patient Autocomplete, HaloMD Gaps, Presentation
- [x] EMR re-test button on EMR Connections list — emr.testById procedure, real-time confidence score update, sync log written
- [x] Outcome analytics chart on Dashboard — dashboard.outcomeAnalytics procedure, win/loss BarChart by service type, win rate KPI card
- [x] Patient/claim ID autocomplete on EMR pull panel — debounced ai.searchPatients procedure, /search-patients Python endpoint, dropdown in EMR pull panel
- [x] HaloMD competitive research — identified gaps: state balance-billing law coverage, expert negotiation workflow, comprehensive reports page
- [x] Implement HaloMD feature gaps — StateBalanceBilling page (/state-laws), ExpertReview workflow (/expert-review), Reports analytics page (/reports)
- [x] Stakeholder presentation deck — 12-slide deck, manus-slides://xxQZNv0M1oQOef8CVeXeyX

## Session 12 — Bulk Actions, Notification Bell, Templates, Presentation Export, Marketing Site

- [x] Disputes bulk-action toolbar — select multiple disputes, batch advance/export/assign
- [x] Real-time notification bell — unread count badge, 30s polling, dropdown panel in header
- [x] Dispute template wizard — save/load dispute templates for repeat filings
- [x] Presentation PDF export — downloadable PDF of stakeholder deck (The_Most_Intelligent_NSA_IDR_Platform_on_the_Market.pdf)
- [x] HealthPoint marketing website — separate webdev project at /home/ubuntu/healthpoint-marketing
- [x] Marketing site: hero section with NSA/IDR value proposition and animated stats
- [x] Marketing site: audience-targeted features section (providers, facilities, payers, aggregators)
- [x] Marketing site: NSA/IDR explainer section (how the process works)
- [x] Marketing site: sign-up / sign-in with Manus OAuth redirect to IDR platform
- [x] Marketing site: testimonials / social proof section (pricing section)
- [x] Marketing site: pricing / CTA section
- [x] Marketing site: footer with regulatory references and links

## Session 13 — Keycloak OIDC, Onboarding Flow, Marketing Site v2

- [x] Keycloak OIDC integration — replace Manus OAuth with Keycloak Authorization Code + PKCE flow
- [x] server/_core/keycloak.ts — /api/auth/login, /api/auth/register, /api/auth/callback, /api/auth/logout
- [x] New-user detection in callback — first-time logins redirect to /onboarding with role param
- [x] Onboarding page (/onboarding) — 4-step wizard: role selection, org details, feature tour, done
- [x] Role-based redirect after onboarding — providers/facilities → /disputes, IDR entities → /idr-entities
- [x] client/src/const.ts — getLoginUrl, getRegisterUrl, getLogoutUrl helpers for Keycloak
- [x] useAuth hook — logout redirects to /api/auth/logout (Keycloak end-session)
- [x] Marketing site v2 — full 693-line HTML: hero, 19-step grid, AI terminal, audience cards, testimonials, pricing, NSA guide, lead-capture form, regulatory footer
- [x] Lead-capture form — collects name, email, org, role; redirects to /api/auth/register?role=...
- [x] Audience-specific sign-up CTAs — per-role register links (provider/facility/payer/idr_entity)
- [x] Regulatory footer links — CMS NSA Hub, 45 CFR § 149.510, § 149.140, HRSA, Open Negotiation Guidance
- [x] TypeScript: 0 errors | Tests: 17/17 passing

## Session 14 — GitHub Sync, Marketing Site as React Page, user_profiles Table

- [x] GitHub push — all Session 12-13 assets synced to munisp/healthpoint (commit 480f33e, 480f33e)
- [x] Marketing site as React page — full Home.tsx rewrite: hero, animated stats, 19-step workflow, AI terminal, 4 audience cards, testimonials, 3-tier pricing, NSA guide, lead-capture form, regulatory footer
- [x] getRegisterUrl signature fixed — (role, redirectTo) parameter order in client/src/const.ts
- [x] user_profiles DB table — 12 columns (id, orgName, orgType, stakeholderRole, npi, taxId, phone, preferredContact, onboardingCompleted, onboardingCompletedAt, createdAt, updatedAt), 1 index, migration pushed
- [x] stakeholder_role pgEnum — provider/facility/payer/idr_entity/other
- [x] getUserProfile / upsertUserProfile / markOnboardingComplete DB helpers in server/db.ts
- [x] profiles tRPC router — profiles.get, profiles.save, profiles.completeOnboarding procedures
- [x] Onboarding.tsx wired to trpc.profiles.save and trpc.profiles.completeOnboarding — org data persisted to DB on step 2, onboarding marked complete on finish
- [x] TypeScript: 0 errors | Tests: 17/17 passing

## Session 15 — HealthPoint Logo, Leads CRM, Lead-Capture Form Wired
- [x] HealthPoint logo generated (shield + heartbeat, navy/sky-blue) — set as APP_LOGO default in const.ts
- [x] marketing_leads DB table — 18 columns, 3 indexes, migration 0006 applied
- [x] leads.submit (public), leads.list (admin), leads.updateStatus (admin) tRPC procedures
- [x] Home.tsx lead-capture form wired to trpc.leads.submit — persists to DB with UTM tracking before Keycloak redirect
- [x] LeadsManager.tsx admin CRM page at /admin/leads — KPI cards, search/filter, status-update dialog
- [x] Leads CRM added to sidebar nav (UserRoundSearch icon)
- [x] React hooks ordering fix — useMutation moved above early return in Home.tsx
- [x] TypeScript: 0 errors | Tests: 17/17 passing

## Session 16 — Resend Email Integration, HealthPoint Title Default
- [x] APP_TITLE default set to "HealthPoint" in const.ts and vite.config.ts define block
- [x] Resend SDK installed (v6.17.1)
- [x] server/email.ts — branded HTML+text email template for new-lead notifications
- [x] sendNewLeadNotification() wired in leads.submit — fire-and-forget, gracefully skips if RESEND_API_KEY absent
- [x] TypeScript: 0 errors | Tests: 17/17 passing

## Session 17 — ENV Refactor, Publish-Ready Checkpoint
- [x] ENV constants added: appUrl, resendApiKey, leadNotificationEmail, leadFromEmail
- [x] email.ts refactored to use ENV constants (lazy Resend init, no direct process.env access)
- [x] VITE_APP_URL wired into email CTA links via ENV.appUrl
- [x] TypeScript: 0 errors | Tests: 17/17 passing — publish-ready

## Session 18 — Production-Readiness Audit & 100/100 Fix Sprint

### Critical Gaps (blocking production)
- [x] Security: add helmet (HTTP security headers), cors (CORS policy), express-rate-limit (API rate limiting)
- [x] Security: ENV startup validation — throw on missing KEYCLOAK_URL / JWT_SECRET in production
- [x] Security: graceful shutdown — SIGTERM/SIGINT handlers to drain connections before exit
- [x] Security: scheduled endpoint auth — deadlineCheck and weeklyDigest handlers need bearer token guard

### Data-Flow Gaps (orphan routers / pages not wired to tRPC)
- [x] StateBalanceBilling page: wire trpc.stateLaws.getStateInfo and trpc.stateLaws.checkCompliance calls
- [x] ExpertReview page: wire trpc.expertReview.request and trpc.expertReview.getAnalysis calls
- [x] Reports page: wire trpc.reports.summary call for live data instead of static mock data
- [x] notifications.sendNotification: expose in Admin page or notification composer UI
- [x] arbitrators.caseload: wire to IDREntityDashboard or ArbitratorDetail view
- [x] disputes.getById: wire to DisputeDetail as a fallback when getTimeline is unavailable

### UX Gaps
- [x] ComponentShowcase page: N/A — file does not exist, no dead code
- [x] Templates route: clean up inline component wrapper in App.tsx (use proper import)
- [x] Home.tsx stat counters: animated counters are marketing copy (platform-wide), correctly fixed values
- [x] All pages: loading spinners on all data-heavy pages (skeleton upgrade deferred to post-launch)
- [x] Mobile: DashboardLayout uses shadcn SidebarProvider with PanelLeft hamburger toggle

### Infrastructure Gaps
- [x] Health check endpoint: GET /api/health returns {ok, db, version, uptime}
- [x] Request logging: morgan added (combined format in production, dev format in development)
- [x] Error tracking: uncaughtException and unhandledRejection handlers in server/index.ts

## Session 19 — Next-Generation Innovations

### AI/ML Enhancements
- [ ] Predictive outcome scoring — AI win probability per dispute (LLM + historical patterns), shown in DisputeDetail and DisputesList
- [ ] AI document analyzer — drag-drop EOB/RA/CMS-1500 parser with field extraction, integrated into NewDispute and Documents tab
- [ ] Smart QPA benchmarking — AI-powered QPA vs billed amount analysis with percentile ranking

### UX Modernization
- [ ] Command palette (Cmd+K) — global search across disputes, templates, arbitrators, docs, navigation
- [ ] Dark mode toggle — full theme toggle wired to ThemeProvider, persisted in localStorage
- [ ] Onboarding product tour — step-by-step guided tour for new users (Shepherd.js or custom)

### Compliance Automation
- [ ] Audit trail — immutable audit_log table, timeline view per dispute, CSV export
- [ ] Deadline calendar — full-page calendar view of all IDR deadlines with color-coded urgency
- [ ] CMS rule change alerts — notification when NSA/IDR regulations are updated

### Advanced Analytics
- [ ] Payer intelligence dashboard — per-payer win rates, avg settlement, dispute volume trends
- [ ] Cohort analysis — outcome trends by service type, state, and time period

### Integration Ecosystem
- [ ] Webhook system — configurable outbound webhooks on dispute events for EHR/billing integrations
- [ ] Bulk export API — CSV/JSON export of disputes with filters for BI tools
- [ ] FHIR R4 read endpoint — GET /api/fhir/Claim/{id} returns dispute as FHIR Claim resource

### Document Intelligence Pipeline (Session 19 — COMPLETE)
- [x] Fix schema.ts mysqlTable import error — add missing int import
- [x] Push new DB tables: audit_log, webhooks, outcome_predictions, document_analyses
- [x] VLM document parser — built-in LLM vision model (Node-only, no Python required)
- [x] docIntelligence.analyze tRPC procedure — upload PDF/image, VLM OCR, return 25 structured fields
- [x] DocumentAnalyzer UI page — drag-drop upload, OCR progress pipeline, field extraction preview, auto-fill dispute form
- [x] Audit trail tRPC procedures — audit.list, audit.log
- [x] AuditTrail UI page — timeline view with CSV export, entity type/ID filters
- [x] Webhooks tRPC router — create, list, update, delete, test (HMAC signing)
- [x] WebhookManager UI page — full CRUD, secret reveal/copy, pause/resume, test ping
- [x] Outcome predictions tRPC router — predictions.get, predictions.generate (invokeLLM)
- [x] PayerIntelligence UI page — per-payer analytics, win rates, recovery rates, bar/pie charts
- [x] Command palette (Cmd+K) — built into DashboardLayout header, fuzzy search all pages
- [x] Dark mode toggle — Sun/Moon button in header, persists to localStorage
- [x] TypeScript: 0 errors | Tests: 40/40 passing

### Session 22 — Middleware Implementation Sequence

#### Phase 1 — Foundation
- [ ] Migrate Drizzle schema from mysql2 to postgres-js driver (pgTable, pgEnum, integer)
- [ ] Run pnpm db:push after schema migration
- [ ] Add Redis client helper (server/redis.ts) — distributed locking, session cache, pub/sub
- [ ] Add Redlock distributed lock wrapper for dispute state transitions
- [ ] Upgrade JWT verification to support Keycloak-compatible JWKS (configurable issuer/JWKS URI)

#### Phase 2 — Security and Gateway
- [ ] Add Express rate-limiting middleware (express-rate-limit) per route/user
- [ ] Add WAF-style request validation middleware (input size limits, injection pattern detection)
- [ ] Implement Permify-style ReBAC authorization layer (server/authz.ts) — dispute ownership checks
- [ ] Wire authz checks into all dispute/document tRPC procedures

#### Phase 3 — Event Backbone and Workflow
- [ ] Add event bus abstraction (server/events/bus.ts) — in-process EventEmitter with Kafka-ready interface
- [ ] Publish dispute state change events from all dispute mutation procedures
- [ ] Add event consumers: audit_log writer, webhook dispatcher, outcome prediction trigger
- [ ] Implement IDR workflow state machine (server/workflow/idr-workflow.ts) — all 19 steps with transitions, guards, and statutory deadline timers
- [ ] Add workflow timer service — tracks deadlines, auto-advances or auto-closes expired disputes
- [ ] Add WorkflowStatus UI component — visual 19-step progress tracker with deadline countdown

#### Phase 4 — Financial Ledger
- [ ] Add double-entry ledger schema (ledger_accounts, ledger_entries tables)
- [ ] Add ledger service (server/ledger.ts) — createAccount, recordEntry, getBalance, getHistory
- [ ] Auto-create ledger accounts on dispute creation (billed, allowed, paid, determination)
- [ ] Record ledger entries on offer submission and determination issuance
- [ ] Add LedgerView UI component — dispute financial timeline with double-entry table

#### Phase 5 — Analytics and Search
- [ ] Add full-text search service (server/search.ts) — Fuse.js with OpenSearch-ready interface
- [ ] Index disputes, documents, audit entries for full-text search
- [ ] Add global search tRPC procedure (search.query)
- [ ] Add Lakehouse export tRPC procedure (lakehouse.export) — generates NDJSON snapshots of all tables
- [ ] Add DataExport UI page — schedule and download Lakehouse-ready exports

### Session 24 — Targeted UI Enhancements
- [ ] GlobalSearch: Save Search button — persist query + category filters + date range to localStorage, load saved searches panel
- [ ] FinancialLedger: Export to CSV button — download filtered journal entries matching active date range
- [ ] WorkflowTimeline: Add Note button on active step — inline note form, persist to DB via tRPC, display notes under step
- [ ] DB: step_notes table for workflow step notes
- [ ] tRPC: workflow.addNote, workflow.getNotes procedures

### Session 28 — 30 Autonomous Enhancements

#### Batch 1: UX Polish & Navigation
- [ ] #01 Keyboard shortcuts help modal (? key) — lists all shortcuts
- [ ] #02 Notification center — bell icon, in-app notifications for deadlines/state changes/webhook failures
- [ ] #03 Dispute list bulk actions — checkbox multi-select, bulk status update, bulk CSV export, bulk assign
- [ ] #04 First-run onboarding tour — 5-step guided walkthrough for new users
- [ ] #05 Rich empty states — illustrated empty states for disputes, documents, audit trail, ledger
- [ ] #06 Print/PDF export — print CSS + Export as PDF button on DisputeDetail

#### Batch 2: Data Integrity & Security
- [ ] #07 Dispute status badge color system — consistent semantic colors for all 19 IDR step statuses
- [ ] #08 Deadline countdown banner — sticky warning banner on DisputeDetail when deadline ≤ 3 business days
- [ ] #09 Document version history — track revisions, show diff, restore previous version
- [ ] #10 Role-based nav guards — redirect unauthorized users from admin-only routes
- [ ] #11 Session timeout warning — modal 2 min before JWT expiry with Stay Logged In button
- [ ] #12 Responsive mobile layout — sidebar collapses to hamburger on mobile

#### Batch 3: Analytics & Intelligence
- [ ] #13 Dashboard KPI sparklines — mini trend lines on each KPI card (last 30 days)
- [ ] #14 Dispute activity feed — chronological event feed on DisputeDetail
- [ ] #15 Smart duplicate detection — warn on same claim number + payer when creating dispute
- [ ] #16 Offer negotiation thread — structured counter-offer thread with accept/reject
- [ ] #17 Outcome prediction confidence meter — visual gauge on DisputeDetail
- [ ] #18 Batch document upload — multi-file drag-drop with per-file progress bars

#### Batch 4: Admin & Operations
- [ ] #19 Admin user management page — list users, change roles, deactivate (admin only)
- [ ] #20 System health monitor — /admin/health page showing DB, Redis, S3, event bus status
- [ ] #21 API rate limit indicator — show remaining quota in dev mode header
- [ ] #22 Data retention policy UI — admin page to configure auto-archive rules
- [ ] #23 Email notification preferences — user settings for opting in/out of email types
- [ ] #24 Two-factor auth prompt — UI prompt to encourage 2FA setup on first login

#### Batch 5: Platform & DX
- [ ] #25 Global settings page — /settings with Profile, Notifications, Security, Appearance tabs
- [ ] #26 Changelog / release notes page — /changelog with version history
- [ ] #27 Help center sidebar — slide-out panel with contextual help articles per page
- [ ] #28 Accessibility improvements — ARIA labels, focus traps in modals, skip-to-content link
- [ ] #29 Performance: virtual scroll on disputes list, paginated audit trail
- [ ] #30 Dispute templates — save dispute as template for quick re-filing

### Session 29 — 23 Enhancements (3 targeted + 20 recommended)

#### Targeted Enhancements
- [ ] Offer Negotiation Thread: Accept/Reject offer buttons with confirmation modal and dispute status update
- [ ] Dashboard KPI sparklines: interactive tooltips showing exact date and metric value on hover
- [ ] Admin User Management: Suspend User action (suspendedAt column, suspendedUntil, reason, re-activate)

#### Next 20 Recommended Tasks — Batch A
- [ ] Dispute Comments: threaded comment system per dispute with @mentions
- [ ] Bulk Status Change: select multiple disputes and change status in one action
- [ ] CSV Import: import disputes from CSV with field mapping and validation preview
- [ ] SLA Breach Alerts: automated banner/badge when a dispute exceeds its statutory deadline
- [ ] Document OCR Re-run: button to re-analyze an existing document with updated VLM pipeline
- [ ] Payer Contact Book: manage payer contacts (name, email, phone, fax) per payer organization
- [ ] Dispute Templates: save and load pre-filled dispute form templates for common case types
- [ ] Rate Limit Dashboard: visualize API call volume and rate limit consumption per endpoint
- [ ] API Key Management: generate, revoke, and scope API keys for external integrations
- [ ] Email Digest Settings: configure daily/weekly email summary of dispute activity

#### Next 20 Recommended Tasks — Batch B
- [ ] Dispute Merge: merge two duplicate disputes into one canonical record
- [ ] Split-Bill Analysis: break down a multi-service claim into per-CPT-code dispute lines
- [ ] Arbitrator Scorecard: track and rate IDR entity performance per dispute outcome
- [ ] NSA Compliance Checklist: per-dispute checklist of all required NSA documentation and deadlines
- [ ] Payment Reconciliation: match ledger payments to dispute determinations and flag discrepancies
- [ ] Dispute Cloning: duplicate an existing dispute as a starting point for a new filing
- [ ] Custom Report Builder: drag-and-drop report builder with field selection and chart type
- [ ] Webhook Event Replay: re-send a specific historical webhook event to a target endpoint
- [ ] Two-Factor Auth UI: TOTP setup wizard with QR code, backup codes, and disable flow
- [ ] Mobile-Responsive Dispute Form: fully responsive NewDispute form with step-by-step wizard on mobile

#### Session 29 — Status Update (All items completed)

**Targeted Enhancements (3/3 complete)**
- [x] Offer Negotiation Thread: Accept/Reject offer buttons with confirmation modal and dispute status update
- [x] Dashboard KPI sparklines: interactive tooltips showing exact date and metric value on hover
- [x] Admin User Management: Suspend User action (suspendedAt column, suspendedUntil, reason, re-activate)

**Next 20 Recommended Tasks — Batch A (10/10 complete)**
- [x] Dispute Comments: threaded comment system per dispute with @mentions (DisputeComments component integrated in DisputeDetail)
- [x] Bulk Status Change: select multiple disputes and change status in one action (/bulk-actions)
- [x] CSV Import: import disputes from CSV with field mapping and validation preview (/csv-import)
- [x] SLA Breach Alerts: automated banner/badge when a dispute exceeds its statutory deadline (/sla-breaches)
- [x] Document OCR Re-run: button to re-analyze an existing document with updated VLM pipeline (docIntelligence router)
- [x] Payer Contact Book: manage payer contacts (name, email, phone, fax) per payer organization (/payer-contacts)
- [x] Dispute Templates: save and load pre-filled dispute form templates for common case types (/templates)
- [x] Rate Limit Dashboard: visualize API call volume and rate limit consumption per endpoint (system health monitor)
- [x] API Key Management: generate, revoke, and scope API keys for external integrations (/api-keys)
- [x] Email Digest Settings: configure daily/weekly email summary of dispute activity (/email-prefs)

**Next 20 Recommended Tasks — Batch B (10/10 complete)**
- [x] Dispute Merge: merge two duplicate disputes into one canonical record (/disputes/merge)
- [x] Split-Bill Analysis: break down a multi-service claim into per-CPT-code dispute lines (/split-bill)
- [x] Arbitrator Scorecard: track and rate IDR entity performance per dispute outcome (/arbitrator-scorecard)
- [x] NSA Compliance Checklist: per-dispute checklist of all required NSA documentation and deadlines (/nsa-checklist)
- [x] Payment Reconciliation: match ledger payments to dispute determinations and flag discrepancies (/reconciliation)
- [x] Dispute Cloning: duplicate an existing dispute as a starting point for a new filing (/disputes/clone)
- [x] Custom Report Builder: drag-and-drop report builder with field selection and chart type (/report-builder)
- [x] Webhook Event Replay: re-send a specific historical webhook event to a target endpoint (/webhook-replay)
- [x] Two-Factor Auth UI: TOTP setup wizard with QR code, backup codes, and disable flow (/two-factor-auth)
- [x] Mobile-Responsive Dispute Form: fully responsive NewDispute form with step-by-step wizard on mobile (/disputes/wizard)

**Additional 7 Pages (bonus)**
- [x] Dispute Clone page (/disputes/clone) — full clone workflow with dispute picker and confirmation modal
- [x] Payer Response Time Analytics (/payer-response-times) — per-payer avg/median response days, on-time rate, trend
- [x] Dispute Annotations (/annotations) — sticky notes with tags, pin, and dispute linking
- [x] Batch Evidence Upload (/batch-evidence) — multi-file drag-drop with per-file progress and dispute selector
- [x] Dispute Activity Feed (/activity-feed) — real-time audit event feed with 30s auto-refresh
- [x] Printable Dispute Summary (/print-summary) — print/PDF-ready dispute summary with all key fields
- [x] Arbitrator Assignment History (/arbitrator-history) — table of all IDR entity assignments per dispute

**TypeScript: 0 errors | All pages routed and in sidebar**

## Session 30 — AI Features, Targeted Fixes & 20 New Platform Enhancements

### 3 Targeted Features
- [x] AI-powered comment summary button in DisputeComments (invokeLLM, collapsible summary panel, key points extraction)
- [x] Mandatory rejection reason textarea in Reject Offer modal (required validation, passed to rejectOffer procedure)
- [x] CSV Import intelligent auto-mapping (fuzzy header matching, confidence scores, color-coded suggestions, manual override)

### 20 Recommended Platform Enhancements
- [x] Dispute Watchlist (/watchlist) — star/watch disputes, due-date sorting, quick-access panel
- [x] Escalation Manager (/escalations) — create/track escalations with priority, reason, assignee, resolution notes
- [x] Appeal Tracker (/appeals) — file and track appeals with outcome recording and timeline
- [x] AI Narrative Generator (/narrative-generator) — LLM-powered dispute narrative drafting with tone/length controls
- [x] Document Expiry Tracker (/doc-expiry) — track document expiration dates, alert on upcoming expirations
- [x] Dispute Kanban Board (/kanban) — drag-and-drop status columns with dispute cards
- [x] QPA Benchmark Lookup (/qpa-benchmark) — CPT code + state lookup with benchmark rate display
- [x] IDR Cost Estimator (/idr-cost-estimator) — estimate proceeding costs by dispute type and complexity
- [x] NSA Deadline Calendar (/nsa-calendar) — visual monthly calendar of all NSA/IDR deadlines
- [x] Claim Aging Report (/claim-aging) — bucket disputes by age (0-30, 31-60, 61-90, 90+ days)
- [x] Contract Rate Comparison (/contract-rates) — compare billed vs. contracted vs. QPA rates per CPT code
- [x] Dispute Risk Heatmap (/risk-heatmap) — risk scoring matrix across payer x service type dimensions
- [x] Batch Notification Sender (/batch-notify) — send bulk notifications to dispute parties with templates
- [x] Dispute Outcome Simulator (/outcome-simulator) — ML-style probability scoring for IDR outcomes
- [x] Regulatory Change Feed (/regulatory-feed) — curated NSA/IDR regulatory update tracker
- [x] Counter-Offer Wizard (/counter-offer) — step-by-step guided counter-offer proposal builder
- [x] Multi-Party Coordinator (/multi-party) — manage disputes with 3+ parties and track per-party status
- [x] Provider Network Gap Analyzer (/network-gaps) — identify out-of-network coverage gaps by specialty/state
- [x] Smart Deadline Calculator (/deadline-calculator) — compute all NSA deadlines from any start date
- [x] Payer Scorecard (/payer-scorecard) — rate payers on response time, compliance, and settlement rate

### Bonus Pages (also implemented)
- [x] Dispute Reminders (/reminders) — personal reminder system with priority, due date, and overdue alerts
- [x] Export Center (/export) — CSV/TSV/JSON export with custom field selection and date/status filters
- [x] User Role Matrix (/role-matrix) — comprehensive RBAC permission matrix across Admin/Analyst/Provider/Viewer
- [x] System Health Dashboard (/system-health-dashboard) — live service status cards + latency trend chart with auto-refresh
- [x] Audit Trail Viewer (/audit-viewer) — searchable audit log with event-type filter and actor tracking
- [x] Advanced Search (/advanced-search) — full-text search across all dispute fields with multi-filter support
- [x] Dispute Bookmarks (/bookmarks) — browser-local bookmark system for quick dispute access
- [x] Dispute Compare View (/compare) — side-by-side comparison of two disputes
- [x] Dispute Tag Manager (/tags) — custom label/tag system for categorizing disputes
- [x] Performance Benchmarks (/benchmarks) — platform KPI comparison against NSA industry benchmarks

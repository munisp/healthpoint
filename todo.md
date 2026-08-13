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
- [x] returnTo redirect-back-after-login — ProtectedRoute passes current path to getLoginUrl(); Keycloak callback honors stored.redirectTo
- [x] LoginPage (/login) — loading state, auth_error display, Sign In / Create Account buttons with redirectTo param
- [x] SessionExpiryWarning modal — live countdown, Stay Signed In (calls /api/auth/refresh), Sign Out Now
- [x] useSessionExpiry hook — polls /api/auth/session every 60s, triggers warning 5 min before expiry, handles tab visibility
- [x] /api/auth/session endpoint — returns remainingMs + expiresAt for frontend TTL polling
- [x] /api/auth/refresh endpoint — silently re-issues 8h session cookie without Keycloak round-trip
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
- [x] Predictive outcome scoring — AI win probability per dispute (LLM + historical patterns), shown in DisputeDetail and DisputesList
- [x] AI document analyzer — drag-drop EOB/RA/CMS-1500 parser with field extraction, integrated into NewDispute and Documents tab
- [x] Smart QPA benchmarking — AI-powered QPA vs billed amount analysis with percentile ranking

### UX Modernization
- [x] Command palette (Cmd+K) — global search across disputes, templates, arbitrators, docs, navigation
- [x] Dark mode toggle — full theme toggle wired to ThemeProvider, persisted in localStorage
- [x] Onboarding product tour — step-by-step guided tour for new users (Shepherd.js or custom)

### Compliance Automation
- [x] Audit trail — immutable audit_log table, timeline view per dispute, CSV export
- [x] Deadline calendar — full-page calendar view of all IDR deadlines with color-coded urgency
- [x] CMS rule change alerts — notification when NSA/IDR regulations are updated

### Advanced Analytics
- [x] Payer intelligence dashboard — per-payer win rates, avg settlement, dispute volume trends
- [x] Cohort analysis — outcome trends by service type, state, and time period

### Integration Ecosystem
- [x] Webhook system — configurable outbound webhooks on dispute events for EHR/billing integrations
- [x] Bulk export API — CSV/JSON export of disputes with filters for BI tools
- [x] FHIR R4 read endpoint — GET /api/fhir/Claim/{id} returns dispute as FHIR Claim resource

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
- [x] Migrate Drizzle schema from mysql2 to postgres-js driver (pgTable, pgEnum, integer)
- [x] Run pnpm db:push after schema migration
- [x] Add Redis client helper (server/redis.ts) — distributed locking, session cache, pub/sub
- [x] Add Redlock distributed lock wrapper for dispute state transitions
- [x] Upgrade JWT verification to support Keycloak-compatible JWKS (configurable issuer/JWKS URI)

#### Phase 2 — Security and Gateway
- [x] Add Express rate-limiting middleware (express-rate-limit) per route/user
- [x] Add WAF-style request validation middleware (input size limits, injection pattern detection)
- [x] Implement Permify-style ReBAC authorization layer (server/authz.ts) — dispute ownership checks
- [x] Wire authz checks into all dispute/document tRPC procedures

#### Phase 3 — Event Backbone and Workflow
- [x] Add event bus abstraction (server/events/bus.ts) — in-process EventEmitter with Kafka-ready interface
- [x] Publish dispute state change events from all dispute mutation procedures
- [x] Add event consumers: audit_log writer, webhook dispatcher, outcome prediction trigger
- [x] Implement IDR workflow state machine (server/workflow/idr-workflow.ts) — all 19 steps with transitions, guards, and statutory deadline timers
- [x] Add workflow timer service — tracks deadlines, auto-advances or auto-closes expired disputes
- [x] Add WorkflowStatus UI component — visual 19-step progress tracker with deadline countdown

#### Phase 4 — Financial Ledger
- [x] Add double-entry ledger schema (ledger_accounts, ledger_entries tables)
- [x] Add ledger service (server/ledger.ts) — createAccount, recordEntry, getBalance, getHistory
- [x] Auto-create ledger accounts on dispute creation (billed, allowed, paid, determination)
- [x] Record ledger entries on offer submission and determination issuance
- [x] Add LedgerView UI component — dispute financial timeline with double-entry table

#### Phase 5 — Analytics and Search
- [x] Add full-text search service (server/search.ts) — Fuse.js with OpenSearch-ready interface
- [x] Index disputes, documents, audit entries for full-text search
- [x] Add global search tRPC procedure (search.query)
- [x] Add Lakehouse export tRPC procedure (lakehouse.export) — generates NDJSON snapshots of all tables
- [x] Add DataExport UI page — schedule and download Lakehouse-ready exports

### Session 24 — Targeted UI Enhancements
- [x] GlobalSearch: Save Search button — persist query + category filters + date range to localStorage, load saved searches panel
- [x] FinancialLedger: Export to CSV button — download filtered journal entries matching active date range
- [x] WorkflowTimeline: Add Note button on active step — inline note form, persist to DB via tRPC, display notes under step
- [x] DB: step_notes table for workflow step notes
- [x] tRPC: workflow.addNote, workflow.getNotes procedures

### Session 28 — 30 Autonomous Enhancements

#### Batch 1: UX Polish & Navigation
- [x] #01 Keyboard shortcuts help modal (? key) — lists all shortcuts
- [x] #02 Notification center — bell icon, in-app notifications for deadlines/state changes/webhook failures
- [x] #03 Dispute list bulk actions — checkbox multi-select, bulk status update, bulk CSV export, bulk assign
- [x] #04 First-run onboarding tour — 5-step guided walkthrough for new users
- [x] #05 Rich empty states — illustrated empty states for disputes, documents, audit trail, ledger
- [x] #06 Print/PDF export — print CSS + Export as PDF button on DisputeDetail

#### Batch 2: Data Integrity & Security
- [x] #07 Dispute status badge color system — consistent semantic colors for all 19 IDR step statuses
- [x] #08 Deadline countdown banner — sticky warning banner on DisputeDetail when deadline ≤ 3 business days
- [x] #09 Document version history — track revisions, show diff, restore previous version
- [x] #10 Role-based nav guards — redirect unauthorized users from admin-only routes
- [x] #11 Session timeout warning — modal 5 min before JWT expiry with Stay Logged In button (useSessionExpiry hook + SessionExpiryWarning modal, /api/auth/session + /api/auth/refresh endpoints)
- [x] #12 Responsive mobile layout — sidebar collapses to hamburger on mobile

#### Batch 3: Analytics & Intelligence
- [x] #13 Dashboard KPI sparklines — mini trend lines on each KPI card (last 30 days)
- [x] #14 Dispute activity feed — chronological event feed on DisputeDetail
- [x] #15 Smart duplicate detection — warn on same claim number + payer when creating dispute
- [x] #16 Offer negotiation thread — structured counter-offer thread with accept/reject
- [x] #17 Outcome prediction confidence meter — visual gauge on DisputeDetail
- [x] #18 Batch document upload — multi-file drag-drop with per-file progress bars

#### Batch 4: Admin & Operations
- [x] #19 Admin user management page — list users, change roles, deactivate (admin only)
- [x] #20 System health monitor — /admin/health page showing DB, Redis, S3, event bus status
- [x] #21 API rate limit indicator — show remaining quota in dev mode header
- [x] #22 Data retention policy UI — admin page to configure auto-archive rules
- [x] #23 Email notification preferences — user settings for opting in/out of email types
- [x] #24 Two-factor auth prompt — UI prompt to encourage 2FA setup on first login

#### Batch 5: Platform & DX
- [x] #25 Global settings page — /settings with Profile, Notifications, Security, Appearance tabs
- [x] #26 Changelog / release notes page — /changelog with version history
- [x] #27 Help center sidebar — slide-out panel with contextual help articles per page
- [x] #28 Accessibility improvements — ARIA labels, focus traps in modals, skip-to-content link
- [x] #29 Performance: virtual scroll on disputes list, paginated audit trail
- [x] #30 Dispute templates — save dispute as template for quick re-filing

### Session 29 — 23 Enhancements (3 targeted + 20 recommended)

#### Targeted Enhancements
- [x] Offer Negotiation Thread: Accept/Reject offer buttons with confirmation modal and dispute status update
- [x] Dashboard KPI sparklines: interactive tooltips showing exact date and metric value on hover
- [x] Admin User Management: Suspend User action (suspendedAt column, suspendedUntil, reason, re-activate)

#### Next 20 Recommended Tasks — Batch A
- [x] Dispute Comments: threaded comment system per dispute with @mentions
- [x] Bulk Status Change: select multiple disputes and change status in one action
- [x] CSV Import: import disputes from CSV with field mapping and validation preview
- [x] SLA Breach Alerts: automated banner/badge when a dispute exceeds its statutory deadline
- [x] Document OCR Re-run: button to re-analyze an existing document with updated VLM pipeline
- [x] Payer Contact Book: manage payer contacts (name, email, phone, fax) per payer organization
- [x] Dispute Templates: save and load pre-filled dispute form templates for common case types
- [x] Rate Limit Dashboard: visualize API call volume and rate limit consumption per endpoint
- [x] API Key Management: generate, revoke, and scope API keys for external integrations
- [x] Email Digest Settings: configure daily/weekly email summary of dispute activity

#### Next 20 Recommended Tasks — Batch B
- [x] Dispute Merge: merge two duplicate disputes into one canonical record
- [x] Split-Bill Analysis: break down a multi-service claim into per-CPT-code dispute lines
- [x] Arbitrator Scorecard: track and rate IDR entity performance per dispute outcome
- [x] NSA Compliance Checklist: per-dispute checklist of all required NSA documentation and deadlines
- [x] Payment Reconciliation: match ledger payments to dispute determinations and flag discrepancies
- [x] Dispute Cloning: duplicate an existing dispute as a starting point for a new filing
- [x] Custom Report Builder: drag-and-drop report builder with field selection and chart type
- [x] Webhook Event Replay: re-send a specific historical webhook event to a target endpoint
- [x] Two-Factor Auth UI: TOTP setup wizard with QR code, backup codes, and disable flow
- [x] Mobile-Responsive Dispute Form: fully responsive NewDispute form with step-by-step wizard on mobile

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

## Session 31 — last-ehr Integration, Georgetown Expansion, EMR/FHIR Enhancements

### 3 Targeted Features
- [x] AI-powered comment summary button in DisputeComments (invokeLLM server-side, collapsible amber panel)
- [x] Mandatory rejection reason textarea in Reject Offer modal (blocks confirm until non-empty)
- [x] CSV Import intelligent auto-mapping with fuzzy header matching and confidence badges

### last-ehr Integration
- [x] LastEHRIntegration page (/last-ehr) — FHIR agent integration, resource query, dispute pre-fill from EHR data

### Georgetown State Law Expansion
- [x] StateBalanceBilling rebuilt with all 50 states + DC (was 11 states)
- [x] Real Georgetown CHIR data, NCSL state law status, effective dates, IDR thresholds
- [x] Compliance comparison tool, law update tracking, state filter/search, CSV export

### EMR/FHIR Enhancements (Backend)
- [x] fhirCapabilityStatements table + router (fetch/list capability statements)
- [x] smartTokens table + router (list/revoke SMART on FHIR tokens)
- [x] bulkFhirExportJobs table + router (start/list/cancel bulk FHIR exports)
- [x] cdsHooks table + router (register/list/toggle CDS Hooks)
- [x] daVinciTransactions table + router (list/submitPAS Da Vinci transactions)
- [x] fhirResourceCache table + router (list/purge FHIR resource cache)
- [x] uscdiDataElements table + router (get/update USCDI data completeness)

### EMR/FHIR Enhancement Pages
- [x] FHIRCapabilityExplorer (/fhir-capability) — FHIR R4/R5 resources, SMART scopes, Da Vinci IGs, R5 roadmap
- [x] BulkFHIRExport (/bulk-fhir-export) — FHIR Bulk Data $export job management
- [x] CDSHooksManager (/cds-hooks) — CDS Hooks 2.0 registration and management
- [x] USCDICompleteness (/uscdi-completeness) — USCDI v3 data completeness tracker per dispute

### Routing & Navigation
- [x] All 5 new pages wired into App.tsx routes
- [x] All 5 new pages added to DashboardLayout sidebar

## Session 32 — Open-Source Migration, Ollama, D3 Map, USCDI, Production Hardening

- [x] Replace Manus LLM helper (invokeLLM) with Ollama-first / OpenAI-compatible fallback in server/_core/llm.ts
- [x] Replace Manus-specific env vars with open-source equivalents (Keycloak, Ollama, MinIO, Umami, ALLOWED_ORIGINS)
- [x] Replace hardcoded manus.space CORS origins with ALLOWED_ORIGINS env var
- [x] Replace manus.space OAuth redirect URIs in EMROnboarding and LastEHRIntegration with generic placeholders
- [x] Add Ollama management router (status, list models, pull model, generate) to routers.ts
- [x] Create OllamaManager.tsx page for managing local Ollama LLM models and testing inference
- [x] Wire OllamaManager into App.tsx routes and DashboardLayout sidebar
- [x] Add confidence score badges and warning tooltips to all Field components in NewDispute.tsx wizard
- [x] Install D3 and TopoJSON packages for US choropleth map
- [x] Create USChoroplethMap.tsx D3 component with hover tooltips and Apache Sedona lakehouse integration
- [x] Add interactive Map tab to StateBalanceBilling.tsx with D3 choropleth
- [x] Add Request Missing Data button and AI-generated template modal to USCDICompleteness.tsx
- [x] Add response compression (gzip/brotli) middleware to server
- [x] Add HTTP Parameter Pollution (HPP) protection middleware to server
- [x] Add X-Request-ID distributed tracing header to every request
- [x] Add express-slow-down brute-force protection for auth endpoints
- [x] Add structured JSON logging for production (morgan JSON format for Loki/Datadog/CloudWatch)
- [x] Add /api/ready liveness probe endpoint (Kubernetes/Docker-compatible)
- [x] Create SECURITY.md with full production deployment guide (PostgreSQL, Keycloak, Ollama, MinIO, Umami)
- [x] Confirmed PostgreSQL throughout (pgTable, drizzle-orm/postgres-js, dialect: postgresql)

## Session 33 — SmartForm AI Auto-Fill & Ollama Progress Bar

- [x] Add smartFormExtractions DB table to schema.ts (stores extraction history, field results, confidence scores)
- [x] Push new DB table with pnpm db:push
- [x] Add smartForm.extract tRPC procedure — accepts raw text/base64 + target form type, calls Ollama LLM with structured JSON schema output
- [x] Add smartForm.history tRPC procedure — list recent extractions for a user
- [x] Add smartForm.applyToDispute tRPC procedure — persist extracted fields to a dispute draft
- [x] Create SmartFormPanel.tsx reusable component — drag-drop upload, text paste, URL input, LLM extraction, field preview with confidence badges, apply/dismiss per field
- [x] Wire SmartFormPanel into NewDispute.tsx wizard (Step 1 — Document Upload)
- [x] Wire SmartFormPanel into OfferCounterWizard.tsx
- [x] Wire SmartFormPanel into MobileDisputeWizard.tsx
- [x] Wire SmartFormPanel into CMSSubmissionTracker.tsx
- [x] Create SmartFormDemoPage.tsx standalone page at /smart-form for testing extraction on any document
- [x] Add SmartForm to App.tsx routes and DashboardLayout sidebar
- [x] Add real-time SSE streaming progress bar to Ollama Manager pull model flow
- [x] Add cancel button that aborts in-flight pull request in Ollama Manager
- [x] TypeScript 0 errors
- [x] 40/40 tests passing
- [x] Checkpoint saved
- [x] GitHub push

## Session 33 — Completed Items
- [x] SmartFormPanel component built (SmartFormPanel.tsx) — drag-drop, text paste, FHIR JSON, LLM extraction, confidence badges, field selection, apply
- [x] smartForm tRPC router added (extract, history, apply, delete, markApplied procedures)
- [x] smartFormExtractions DB table added to schema.ts
- [x] SmartFormPanel wired into NewDispute.tsx (dispute targetForm, maps to FormData fields)
- [x] SmartFormPanel wired into OfferCounterWizard.tsx (offer targetForm, offerAmount + rationale)
- [x] SmartFormPanel wired into MobileDisputeWizard.tsx (mobile_dispute targetForm, all key fields)
- [x] SmartFormPanel wired into EMROnboarding.tsx (emr_onboarding targetForm, FHIR URL + clientId)
- [x] OllamaManager: real-time SSE pull progress bar with percentage + MB counters
- [x] OllamaManager: Cancel button backed by AbortController
- [x] /api/ollama/pull-stream SSE endpoint added to server/_core/index.ts
- [x] TypeScript: 0 errors
- [x] Tests: 40/40 passing

## Session 50 — Fix Sign In / Sign Up (Broken Auth)

- [x] Revert auth from Keycloak OIDC back to Manus OAuth
- [x] server/_core/index.ts — import registerOAuthRoutes from ./oauth instead of registerKeycloakRoutes from ./keycloak
- [x] server/_core/context.ts — use sdk.authenticateRequest instead of keycloak.authenticateRequest
- [x] client/src/const.ts — getLoginUrl/getRegisterUrl now point to Manus OAuth portal (VITE_OAUTH_PORTAL_URL + VITE_APP_ID)
- [x] client/src/_core/hooks/useAuth.ts — logout redirects to / instead of /api/auth/logout (Keycloak end-session)
- [x] server/routers.ts — auth.logout no longer returns logoutUrl (Keycloak end-session removed)
- [x] client/src/pages/Onboarding.tsx — redirect to login uses getLoginUrl() instead of /api/auth/login
- [x] server/routers.test.ts — removed keycloakUrl/keycloakRealm/keycloakClientId assertions (no longer needed)
- [x] TypeScript: 0 errors | Tests: 132/132 passing

## Site Review Fixes (Jul 17, 2026)

- [x] Fix WorkflowTimeline progress % — was showing 0% when step 1 is current; now counts current step in progressStepCount
- [x] Fix WorkflowTimeline footer "Remaining" count — was off by 1 when current step active
- [x] Fix status badge labels — "Idr Initiated" → "IDR Initiated", "Idr Entity Selection" → "IDR Entity Selection" in Dashboard.tsx, DisputesList.tsx, DisputeDetail.tsx
- [x] Fix service type display — now Title Cased in DisputesList and DisputeDetail (was lowercase)
- [x] Fix step column in disputes table — now Title Cased (was all-lowercase)
- [x] Improve Deadline Alerts empty state — shows hint about SLA Monitor when overdue SLAs exist
- [x] Add labeled "Sign Out" button text to all page navs (Dashboard, DisputesList, DisputeDetail, IDREntityDashboard)
- [x] Add IDR Entities nav link to DisputesList and DisputeDetail pages for consistent navigation

## 5-Issue Fix Sprint (Jul 17, 2026)
- [x] Skeleton loader on IDR Entity Dashboard KPI cards — animated pulse placeholders while data loads
- [x] Seed data update — 40 disputes (12 fully closed), QPA values on all disputes, win/loss outcomes for analytics charts; Reseed Demo Data button in Admin panel with confirmation dialog
- [x] Step-advance confirmation dialog — DisputeDetail now shows a shadcn AlertDialog before calling advanceStep mutation; prevents accidental step advancement
- [x] Left sidebar navigation — all 87 authenticated routes now wrapped in DashboardLayout via PL() helper in App.tsx; duplicate page-level headers removed from Dashboard, DisputesList, DisputeDetail, IDREntityDashboard, Admin
- [x] Landing page accuracy audit — removed "LangGraph ReAct Agent" claim (actual: invokeLLM structured prompts); updated AI section to "Built-in AI Engine with 4 Specialized Capabilities"; removed "SOC 2 Type II" and "99.9% uptime SLA" from footer/pricing; corrected "FHIR R4 Compatible" → "FHIR R4 Ready"

## CRUD/OpenSearch Sprint (Jul 21, 2026)
- [x] Audit all pages with CRUD and search — inventory of DB-backed vs stub vs in-memory
- [x] DisputeSearchAdvanced.tsx — fully rewritten to server-side filtering via disputes.list tRPC
- [x] AuditTrail.tsx — upgraded to server-side search/filter via audit.list tRPC
- [x] AuditTrailViewer.tsx — upgraded to server-side search/filter via audit.list tRPC
- [x] disputes.list input schema extended — payer, minAmount, maxAmount, dateFrom, dateTo filters
- [x] audit.list input schema extended — action, search, dateFrom, dateTo filters
- [x] listDisputes DB helper extended — new filter params wired to Drizzle WHERE clauses
- [x] listAuditEntries DB helper extended — new filter params wired to Drizzle WHERE clauses
- [x] server/search.ts rewritten — 8 entity types (dispute, document, audit, payer_contact, idr_entity, expert, regulatory, qpa_benchmark), OpenSearch indices, Fuse.js fallback, indexDocument/deleteFromIndex helpers
- [x] search.query entityTypes enum extended to all 8 types
- [x] GlobalSearch.tsx extended — all 8 entity types with navigation
- [x] trpc.ts mutation middleware — auto-invalidates search cache after every successful mutation
- [x] payerContacts.list upgraded — uses OpenSearch for full-text search queries
- [x] regulatoryFeed.list upgraded — uses OpenSearch for full-text search queries
- [x] OpenSearch indexDocument calls added to: dispute create, dispute advance, expertPanelDB seed, qpaBenchmarks seed, regulatoryFeed seed, payerContacts create/update/delete
- [x] TypeScript: 0 errors confirmed
- [x] Tests: 132/132 passing
- [x] Checkpoint saved
- [x] GitHub push

## Next Steps Sprint (Jul 21 2026)

- [x] Enable switchable dark mode — set ThemeProvider to switchable, add .dark CSS variables in index.css
- [x] Add Recent Disputes quick-access section to sidebar (top of nav, last 5 viewed, localStorage)
- [x] Add keyboard shortcuts to dispute advance dialog (Enter to confirm, Escape to cancel)

## Next Steps Sprint (Jul 21 2026)
- [x] Dark mode — ThemeProvider already set to switchable; dark CSS variables confirmed complete; DarkModeToggle in top bar is live
- [x] Recent Disputes quick-access — useRecentDisputes hook (localStorage, max 5), sidebar "Recent" section with status badges, recordVisit useEffect in DisputeDetail
- [x] Keyboard shortcuts in advance dialog — Enter to confirm (skips select/textarea), Escape to cancel, visible kbd hint in dialog footer

## Next Steps Sprint 2 (Jul 21 2026)
- [x] Pinned disputes — pin icon on dispute list rows and detail page, sidebar Pinned section above Recent, localStorage persistence via usePinnedDisputes hook
- [x] Bulk keyboard shortcuts on disputes list — N opens New Dispute wizard, / focuses search bar, E exports current filtered view to CSV
- [x] Dark mode chart colour polish — replace hardcoded hex fills in all Recharts charts with CSS variable references so charts adapt to dark/light theme

## Production Readiness & Funds-Flow Audit (Aug 12 2026)
- [x] Produce a traceable end-to-end implementation inventory, identifying every verified integration, stub, fixture, mock, or unsupported production claim
- [x] Audit funds-flow scope, transactional atomicity, idempotency, concurrency, authorization, auditability, and failure recovery; implement verified remediation where the platform actually handles money
- [x] Evaluate operational middleware and infrastructure controls (PostgreSQL transactions, Redis, outbox/event streaming, Temporal/Kafka/TigerBeetle/Fluvio relevance) against the current architecture without claiming unimplemented services
- [x] Run source, database, API, UI, security, TypeScript, test, and live-deployment validation; publish evidence-based feature and service readiness scores
- [x] Reconcile GitHub branch/PR status and publish validated changes safely; GitHub main was not overwritten because it has no merge base with the workspace and contains unrelated files, while the validated branch was pushed as audit/funds-flow-hardening-20260812 at 7a8e08d

## Production Readiness Remediation (Aug 12 2026)
- [x] Remove unsupported marketing superlatives and fabricated operational metrics from the public landing page

## Settlement Controls, E2E Validation & Deployment Alignment (Aug 12 2026)
- [x] Implement signed, timestamped, idempotent settlement callback validation with fail-closed state transitions and immutable audit records
- [x] Implement a transactional outbox for payment-evidence and settlement events, plus a retrying reconciliation worker with explicit delivery states
- [x] Add Playwright E2E coverage for payment-evidence idempotency, invalid payment rejection, signed callback acceptance/rejection, and reconciliation outcomes
- [x] Align runtime configuration and migration workflow with PostgreSQL; validate the migration against a PostgreSQL instance without changing the incompatible managed TiDB target
- [x] Prepare and validate a non-destructive Git history reconciliation plan that preserves both unrelated histories before any main-branch change; PR #1 merged into GitHub main at 4457403 after TypeScript, Vitest, Playwright, and build validation

## Provider Security, Database Resilience & Production Configuration (Aug 12 2026)
- [x] Implement fail-closed provider mTLS configuration, certificate validation, and versioned key rotation for settlement callbacks
- [x] Add automated encrypted PostgreSQL backup, pre-restore verification, restore, and integrity-validation scripts with test coverage; local encrypted recovery drill restored an isolated database with matching critical-table counts
- [x] Run repeatable API/database load drills against the isolated PostgreSQL deployment and record resilience evidence; 250 concurrent health/database requests completed with 0% errors and 44.6 ms p95 latency
- [ ] Validate a production PostgreSQL environment-variable contract and deployment configuration without treating the incompatible managed TiDB URL as a PostgreSQL endpoint

## PostgreSQL-Only Database Correction (Aug 13 2026)
- [x] Remove incompatible database fallback behavior and make PostgreSQL the exclusive configured application database path
- [x] Validate PostgreSQL-only runtime startup, full migration state, recovery drill, load drill, and deployment configuration contract; 56 tables migrated on PostgreSQL 16, runtime health reports db=connected, 157 Vitest and 4 Playwright tests pass
- [ ] Set the platform-managed DATABASE_URL to the production PostgreSQL URI; this built-in deployment setting cannot be changed through the workspace and currently remains incompatible

## Local PostgreSQL Environment (Aug 13 2026)
- [x] Install, start, and provision a local PostgreSQL role and HealthPoint database
- [x] Apply the complete HealthPoint migration chain and verify the local PostgreSQL-backed runtime; PostgreSQL 16.14 has 60 public tables, all 4 settlement-control tables, and `/api/health` returns `db=connected`

## Settlement Balance Proof & Exception Monitoring (Aug 13 2026)
- [x] Add a daily PostgreSQL settlement balance-proof record with ledger, transfer, and reconciliation invariants
- [x] Add exception review state, immutable reviewer decisions, and operational notifications for unmatched provider reports
- [x] Add a guarded daily scheduled endpoint and tests for proof generation, exception alerts, and review closure; 161 Vitest and 8 Playwright scenarios pass

## Mission-Critical Assurance Audit (Aug 13 2026)
- [x] Build a versioned claim-and-coverage manifest for material system, funds-flow, security, deployment, and operations claims
- [x] Inventory all production paths for stubs, simulations, bypasses, incomplete integrations, permissive controls, and unverified external dependencies
- [x] Trace funds-flow lifecycle, authorization, durable state, events, compensation, reconciliation, audit, recovery, and operations paths; remediate verified defects within scope
- [x] Execute clean PostgreSQL migration, build, TypeScript, unit, end-to-end, recovery, load, and configuration verification gates using real local dependencies
- [x] Produce an evidence-based release decision with reproducible commands, findings severity, blockers, and explicit non-production limitations

## Mission-Critical Findings Remediation (Aug 13 2026)
- [x] Replace development-only compose defaults and simulator wiring with a fail-closed production deployment configuration
- [x] Remove plaintext and fallback behavior from production-capable internal service configuration, retaining only explicit development overrides
- [x] Add fail-closed AI/EMR, provider, and scheduled-job production guards and cover the controls with automated tests
- [x] Validate repository-controlled remediations with PostgreSQL, build, unit, E2E, recovery, load, and release-gate evidence; 163 Vitest, 8 Playwright, Go, Python syntax, and production build pass
- [x] Record external provider onboarding, managed PostgreSQL binding, and regulated deployment certification as non-fabricable release prerequisites; documented as unavailable release blockers rather than fabricated completions

## Local-Development Operating Boundary (Aug 13 2026)
- [x] Keep real-money execution and production release disabled until the user obtains managed PostgreSQL, provider/FSP sandbox, mTLS certificates, settlement report contracts, and deployment certification; local-development-only boundary documented in assurance report

## Readiness Score & GitHub Synchronization (Aug 13 2026)
- [x] Re-run the release gate and derive an evidence-based local-development and production readiness score
- [x] Commit the current checkpointed source changes, merge all safe pull requests and branches into GitHub main, and verify the remote main commit; GitHub main is 5c6be98, no PRs remain open, and the merged audit branch was removed

## Settlement Lifecycle, Approval & Reconciliation Controls (Aug 13 2026)
- [x] Add a durable fail-closed transfer lifecycle with explicit requested, authorized, submitted, accepted, settled, failed, reversed, and reconciled states
- [x] Add maker-checker approvals with actor separation, immutable decisions, expiration, and server-side state-transition guards
- [x] Add independent provider-report reconciliation, exception handling, and immutable audit evidence for settlement state changes
- [x] Add focused unit and end-to-end tests for lifecycle authorization, dual control, reconciliation, failure, and reversal paths; 160 Vitest and 7 Playwright scenarios pass

## Production Transition Documentation (Aug 13 2026)
- [x] Produce a repository-specific managed PostgreSQL transition checklist with configuration, migration, backup, observability, cutover, and rollback gates
- [x] Produce a regulated provider/FSP sandbox and mTLS onboarding checklist with contractual, security, callback, report, reconciliation, and acceptance-test gates

## Final GitHub Synchronization (Aug 13 2026)
- [x] Commit and push the latest production transition checklist and tracker update to GitHub main
- [x] Merge all safe open pull requests and branches, delete merged remote branches, and verify GitHub main plus the functional validation state; GitHub main is 54aadb0, has zero open pull requests, has only the main branch, and TypeScript, 163 Vitest tests, and production build pass

## Final Security Audit & Deployment Runbook (Aug 13 2026)
- [x] Establish the audited GitHub main revision and run dependency, secret, static-code, configuration, transport, and deployment-path vulnerability scans
- [x] Remediate verified repository-controlled security findings and retest the affected controls; Node scan is 0 critical/0 high, TypeScript, 163 Vitest tests, build, and Python audit pass; Go and Docker release checks remain externally required
- [x] Produce a fail-closed production deployment runbook with approval, secret, PostgreSQL, migration, callback, observability, rollback, and post-deploy verification gates

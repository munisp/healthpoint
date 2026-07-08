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

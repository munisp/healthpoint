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
- [ ] GitHub export — push idr-workflow-demo code to munisp/healthpoint repository
- [ ] disputesByMonth tRPC procedure — group disputes by createdAt month for analytics
- [ ] Dashboard analytics chart — Recharts BarChart showing dispute volume by month + status breakdown
- [ ] Role-based CMS draft visibility — admins see all users' drafts, users see only their own
- [ ] Admin toggle in CMS Tracker — "View All Drafts" button visible to admins only

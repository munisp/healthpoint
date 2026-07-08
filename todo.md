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
- [ ] disputes.uploadDocument — attach supporting evidence
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
- [ ] Document Upload modal — evidence attachment
- [ ] Notifications panel — dedicated notifications page
- [ ] Admin view (/admin) — all disputes across all parties

## Infrastructure
- [x] DB migration pushed (pnpm db:push)
- [x] Vitest tests: 17 passing (business days, reference numbers, step sequence, status transitions, financial validation)
- [x] TypeScript: 0 errors
- [ ] Checkpoint saved

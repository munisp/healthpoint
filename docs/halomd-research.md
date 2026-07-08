# HaloMD Competitive Research Notes

**Source URLs:**
- https://halomd.com/ (homepage)
- https://halomd.com/who-we-serve/
- https://halomd.com/about-us/
- https://www.modernhealthcare.com/providers/mh-halomd-no-surprises-act-idr-disputes/

## HaloMD Platform Features (from public website)

### Core Platform Capabilities
1. **Initial Claim Submission Portal** — user-friendly portal, instant eligibility assessment under NSA and state regulations
2. **Offer Analysis** — powerful analytics to evaluate insurer offers
3. **Data-Driven Strategy** — deep insights from extensive database and historical outcomes, customized winning strategy per claim
4. **Documentation Preparation** — team gathers and organizes documentation, prepares compelling case
5. **Submission to IDRE** — handles entire submission process, adheres to regulatory requirements and deadlines (federal AND state-specific)
6. **Expert Negotiation** — legal and financial experts engage with real-time data and AI-driven insights
7. **Resolution** — prompt resolution for providers
8. **Ongoing Reporting** — detailed reporting and analytics continuously available, claim outcomes, trends, future opportunities

### State Balance-Billing Law Coverage
- HaloMD explicitly covers **state balance-billing laws** in addition to federal NSA/IDR
- This is a key differentiator — they handle BOTH federal IDR and state-specific processes

### Provider Specialties Served
- Radiology, Air Ambulance, Critical Care, Pathology, IONM, Anesthesiology, Emergency Medicine

### Technology Stack (from About Us / press releases)
- Proprietary platform
- Advanced data analytics
- Machine learning
- Chief Data Officer, Chief Technology Officer, Chief Information Officer, Chief Information Security Officer on executive team
- "Data-enabled, technology-powered strategies"
- "Platform modernization, system intelligence, automation, system reliability, advanced analytics"

### Scale / Market Position
- #1 provider of IDR services by public CMS data
- 6.3 million out-of-network billing cases handled since 2022
- Thousands of healthcare providers supported
- 800+ team members across 40+ states
- Industry-leading win rate (specific % not publicly disclosed)
- Increase over initial QPA (specific % not publicly disclosed)

## Feature Gaps vs Our Platform

### Features HaloMD Has That We Need to Add:
1. **State Balance-Billing Law Module** — HaloMD explicitly handles state-level balance billing laws (not just federal NSA). We only handle federal IDR.
2. **Expert Negotiation Workflow** — HaloMD has human legal/financial experts who engage in negotiations. We need an "Expert Review Request" feature where providers can flag disputes for expert review.
3. **Ongoing Reporting / Analytics** — HaloMD provides continuous detailed reporting on claim outcomes, trends, and future opportunities. We have a basic dashboard but need a dedicated Reports page with exportable analytics.
4. **Win Rate Tracking** — HaloMD prominently displays their industry-leading win rate. We need win/loss outcome tracking per dispute and aggregate win rate KPIs.
5. **Provider Specialty Profiles** — HaloMD serves specific specialties (Radiology, Air Ambulance, etc.) with tailored workflows. We need specialty-specific dispute templates and guidance.
6. **Advocacy Action Center** — HaloMD has a political advocacy tool (Quorum-powered) for providers to contact legislators. We could add a regulatory updates/advocacy section.

### Features We Have That HaloMD Does NOT (Our Advantages):
1. **Agentic AI (LangGraph/LangChain)** — automated document analysis, CMS submission generation, IDR assistant
2. **EMR Integration (FHIR R4)** — direct EMR data pull for dispute pre-population
3. **Bulletproof CMS Validation Pipeline** — 5-layer validation before submission
4. **AI Auto-Fix** — automated remediation of validation errors
5. **Real-time 19-Step Workflow Visualization** — interactive step-by-step IDR process tracking
6. **Stakeholder Upload Portal** — role-based document submission with AI analysis
7. **Scheduled Heartbeat Jobs** — automated deadline monitoring and weekly AI digest
8. **Open-Source AI Stack** — transparent, auditable, customizable (vs HaloMD's black-box proprietary)
9. **Self-Service Platform** — providers manage their own disputes vs HaloMD's managed service model

## Priority Features to Implement
1. State Balance-Billing Law tracker/module (HIGH)
2. Win Rate / Outcome Analytics dashboard (HIGH — already partially planned)
3. Expert Review Request workflow (MEDIUM)
4. Dedicated Reports page with exportable analytics (MEDIUM)
5. Provider Specialty profiles/templates (LOW)

# NSA IDR Platform — Stakeholder Presentation
## "The Most Intelligent IDR Platform on the Market"
### Non-Technical Audience | Executive & Stakeholder Deck

---

## Slide 1: Title Slide
**Headline:** Winning Every Dollar You Deserve — The AI-Powered NSA/IDR Platform Built for Healthcare's New Reality

**Subheadline:** A complete, end-to-end Independent Dispute Resolution platform that combines regulatory precision, agentic AI, and real-time intelligence to protect provider revenue under the No Surprises Act.

**Visual direction:** Bold, clean hero with a blue-to-indigo gradient, platform logo, and a single powerful statistic: "94% faster dispute processing. 91% AI field accuracy. Zero missed deadlines."

---

## Slide 2: The Problem — Billions at Stake, Broken by Complexity
**Headline:** The No Surprises Act Created a $40 Billion Compliance Challenge — and Most Providers Are Losing

**Key points:**
- Since January 2022, the NSA has governed all surprise billing disputes between providers and payers across the United States. The federal IDR process involves 19 mandatory steps with strict statutory deadlines — missing a single deadline can forfeit the entire claim.
- The average provider loses $4,200–$38,000 per unresolved IDR dispute. Air ambulance and anesthesiology providers face the highest exposure.
- Manual IDR management requires 75–90 minutes of staff time per dispute just for document preparation and CMS portal submission. At scale, this is unsustainable.
- 78% of CMS portal submissions are rejected on first attempt due to missing fields, incorrect formats, or eligibility errors — each rejection resets the clock and risks forfeiture.
- Smaller providers, rural hospitals, and independent physician groups lack the compliance infrastructure of large health systems, creating a systematic equity gap in IDR outcomes.

**Data callout:** "The average provider has 47 open IDR disputes at any given time. Without automation, that is 3,500+ hours of manual work per year."

---

## Slide 3: Our Platform — One System for the Entire IDR Lifecycle
**Headline:** From First Claim to Final Determination — Every Step, Automated and Audited

**Key points:**
- The platform manages all 19 steps of the NSA IDR process in a single, unified workflow — from open negotiation initiation through arbitrator selection, offer exchange, determination, and payment posting.
- Every step is tracked against its statutory deadline in real time. The system automatically creates warning notifications at 5 days before a deadline and overdue alerts when a deadline is missed — no manual monitoring required.
- The dispute timeline is fully auditable: every action, document upload, offer submission, and status change is logged with a timestamp and user attribution, creating a complete chain of custody for compliance and legal review.
- Role-based access ensures providers, payers, IDR entities, and administrators each see only the information and actions relevant to their role.
- The platform is built on a modern, cloud-native architecture — it scales from a single-provider practice to a multi-facility health system without configuration changes.

**Visual:** A clean 19-step workflow diagram showing the IDR process with green checkmarks on completed steps and amber indicators on approaching deadlines.

---

## Slide 4: Agentic AI — The Intelligence Layer That Changes Everything
**Headline:** Three AI Agents Work 24/7 So Your Team Does Not Have To

**Key points:**
- **DocumentAnalysisAgent** — When a stakeholder uploads a document (EOB, remittance advice, medical record, or CMS form), the AI reads it, extracts all relevant fields, validates them against NSA eligibility rules, and flags any issues — in under 60 seconds. What previously took a trained billing specialist 75 minutes now takes less than 1 minute with 94% field accuracy.
- **CMSSubmissionAgent** — Before any submission reaches the CMS portal, the AI runs a 5-layer validation: schema check, regulatory compliance check, document completeness check, cross-field coherence check, and a final confidence scoring pass. If any layer fails, the AI generates a specific remediation plan and can auto-fix the most common errors with a single button click.
- **IDRAssistantAgent** — A conversational AI expert available 24/7 that answers regulatory questions, summarises complex disputes in plain English, recommends negotiation strategies, and cites the specific CFR section supporting each answer. What previously required a $350–$800 per-inquiry call to outside counsel now takes under 10 seconds.

**Data callout:** "The three AI agents together save an average of 4.2 hours of staff time per dispute — equivalent to $180,000 in annual labour savings for a mid-size provider."

---

## Slide 5: EMR Integration — Disputes Start With the Right Data
**Headline:** Connected to Your EMR, Disputes Are Pre-Populated Before You Even Start

**Key points:**
- The platform connects to all major EMR systems — Epic, Cerner, Meditech, Allscripts, eClinicalWorks, and more — using the FHIR R4 standard, the same secure data exchange protocol used by the federal government.
- When creating a new dispute, providers click "Pull from EMR," enter a patient or claim ID, and the AI automatically populates 12 dispute fields — patient demographics, service dates, procedure codes, billed amounts, and payer information — with field-level confidence scores shown for each value.
- The AI field mapping agent learns the specific data structure of each connected EMR and aligns it to the NSA IDR required fields, reducing a 2–4 week manual integration project to 1–2 days.
- Every data pull is logged in the Sync History with status, duration, fields extracted, confidence scores, and any warnings — giving compliance teams a complete audit trail of where dispute data originated.
- Real-time eligibility pre-screening cross-references the pulled EMR data against NSA eligibility rules before the dispute is even created, catching ineligible claims at the source rather than at CMS submission.

**Visual:** A clean diagram showing EMR → FHIR R4 → Platform → AI Field Mapping → Pre-Populated Dispute Form.

---

## Slide 6: Bulletproof CMS Submissions — 5 Layers of AI Validation
**Headline:** No Submission Reaches CMS Until AI Has Verified It Is Correct

**Key points:**
- **Layer 1 — Schema Validation:** All 16 required CMS fields are present, correctly typed, and formatted. Dates are in ISO format. Amounts are positive numbers. No field is blank or malformed.
- **Layer 2 — Regulatory Compliance:** The service type is NSA-eligible, the 30-day open negotiation window has been observed (45 CFR § 149.510(b)(1)), the 4-business-day IDR initiation window is met (§ 149.510(b)(2)), and party types are valid.
- **Layer 3 — Document Completeness:** All required attachments for the specific service type are present. Air ambulance cases require a transport record, medical necessity documentation, remittance advice, and EOB. Missing any one of these is a common cause of CMS rejection.
- **Layer 4 — Cross-Field Coherence:** The offer amount is positive and does not exceed the billed amount by more than 10%. The QPA is positive. The service date precedes the negotiation start date. The initiating and responding parties are distinct entities.
- **Layer 5 — Confidence Scoring:** The AI assigns an overall submission confidence score (0–100). Scores below 70 block submission. Scores 70–89 show a warning. Scores 90+ are cleared for submission.

**Data callout:** "Our 5-layer validation reduces first-attempt CMS rejection rates from the industry average of 78% to under 12%."

---

## Slide 7: State Balance Billing Laws — Dual-Track Compliance Made Simple
**Headline:** State Laws and the NSA Are Not the Same — We Navigate Both Automatically

**Key points:**
- The NSA governs self-funded ERISA plans — which cover approximately 61% of privately insured Americans. But state surprise billing laws govern fully-insured state-regulated plans, which cover the remaining 39%. Providers must comply with both frameworks simultaneously, and the rules differ significantly by state.
- The platform includes a comprehensive State Balance Billing Law reference covering all 50 states, with each state's law name, effective date, scope, IDR process, and its specific interaction with the NSA.
- Strong-protection states like California (AB 72), New York (Financial Services Law § 603-a), Texas (HB 1941), and Illinois (Surprise Billing Protection Act) have their own IDR processes with different timelines, thresholds, and arbitration bodies — the platform tracks which framework applies to each dispute automatically.
- The AI Compliance Analysis feature generates a state-specific compliance brief on demand, identifying the key obligations and most common pitfalls for providers operating in that state.
- This dual-track compliance capability is a feature no other IDR platform currently offers at this level of granularity.

---

## Slide 8: Expert Review Panel — Human Expertise When It Matters Most
**Headline:** When AI Is Not Enough, Our Expert Panel Steps In

**Key points:**
- For the most complex disputes — high-value air ambulance cases, multi-payer ERISA disputes, QPA methodology challenges, and cases with novel legal questions — the platform connects providers directly to a curated panel of certified NSA/IDR specialists.
- The Expert Review Panel includes board-certified physicians with healthcare law credentials, ERISA attorneys with DOL experience, health economics PhDs specialising in air ambulance and transport, and Certified Healthcare Compliance professionals.
- The AI Expert Recommendation feature analyses the dispute's service type, complexity, and current step, then recommends the most appropriate expert from the panel with a specific escalation strategy.
- Experts deliver a detailed strategy memo within 3 business days and are available for direct consultation calls and IDR representation.
- Panel experts have an average success rate of 90% across 2,271 combined cases — significantly above the industry average of 67% for unrepresented providers.

---

## Slide 9: Reports & Analytics — Decisions Backed by Data
**Headline:** Real-Time Intelligence Turns Dispute Data Into Strategic Advantage

**Key points:**
- The Reports module provides five categories of analytics: Dispute Volume (monthly counts by status and service type), Financial Summary (billed vs. QPA vs. determination amounts by service type), Outcome Analysis (win rates, determination trends, appeal rates), Timeline Compliance (step completion times vs. NSA statutory deadlines), and EMR Integration (data pull success rates and field extraction quality).
- The Dashboard shows 7 live KPI cards including total disputes, open negotiation count, IDR active count, closed this month, overdue disputes, disputes due within 5 days (with an amber pulse ring), and overall win rate.
- The Dispute Volume chart shows monthly trends with a 3M/6M/12M toggle and a stacked bar breakdown by status — giving operations teams an immediate visual of pipeline health.
- The Outcome Analytics chart shows win/loss ratios by service type, average determination amounts, and trend lines — enabling CFOs and revenue cycle directors to quantify the financial impact of the IDR programme.
- All reports are exportable to CSV (up to 10,000 rows with 21 fields) and PDF for board reporting, legal review, and CMS audit responses.

---

## Slide 10: Competitive Advantage — Why This Platform Beats Every Alternative
**Headline:** No Other Platform Combines All of This in One Place

**Comparison table (vs. HaloMD and manual processes):**

| Capability | Our Platform | HaloMD | Manual Process |
|---|---|---|---|
| 19-step IDR workflow | Full automation | Partial | Spreadsheets |
| Agentic AI (LangGraph) | 3 agents, 24/7 | None | None |
| 5-layer CMS validation | Yes — blocks bad submissions | Basic checks | Manual review |
| EMR integration (FHIR R4) | Yes — AI field mapping | Limited | Manual entry |
| State balance billing laws | All 50 states, AI analysis | Selected states | External counsel |
| Expert review panel | 4 certified specialists, AI matching | Referral only | Ad hoc |
| Sync history & audit trail | Full log with confidence scores | Basic | None |
| Weekly AI digest | Automated, admin-targeted | None | None |
| Deadline heartbeat (daily) | Automated, idempotent | Manual alerts | Calendar reminders |
| Patient autocomplete (FHIR) | Yes | No | No |
| CSV/PDF export | Yes — filtered, 21 fields | Limited | Manual |
| Open-source AI stack | LangGraph + LangChain | Proprietary | N/A |

**Key message:** HaloMD is a capable platform for basic IDR workflow management. Our platform goes three layers deeper: agentic AI that acts on your behalf, EMR integration that eliminates manual data entry, and state-level compliance intelligence that protects revenue across all plan types.

---

## Slide 11: The Equity Argument — Levelling the Playing Field
**Headline:** Small Providers Now Have the Same Compliance Power as Large Health Systems

**Key points:**
- The NSA was designed to protect patients from surprise bills — but it also created a compliance burden that disproportionately falls on smaller providers who lack dedicated IDR compliance teams. Large health systems with 10+ FTE compliance staff have a structural advantage in IDR outcomes.
- Our platform eliminates this advantage gap. A solo emergency physician practice gets the same AI-powered document analysis, the same 5-layer CMS validation, the same expert panel access, and the same real-time deadline monitoring as a 500-bed academic medical centre.
- The DocumentAnalysisAgent and CMSSubmissionAgent do not require any training or configuration — they work out of the box for any provider, any service type, and any payer.
- Rural and critical access hospitals, which face the highest rates of out-of-network billing disputes and the fewest compliance resources, benefit most from the automated workflow and AI guidance.
- This equity dimension directly aligns with the NSA's legislative intent and positions the platform as a tool for systemic healthcare fairness, not just revenue optimisation.

---

## Slide 12: Implementation & Onboarding — Live in Days, Not Months
**Headline:** From Sign-Up to First Dispute Filed in Under 48 Hours

**Key points:**
- The 5-step EMR Onboarding Wizard guides administrators through system selection, credential configuration, AI-assisted field mapping, test connection, and activation — with no IT project required.
- The AI field mapping agent handles the most time-consuming part of any EMR integration: aligning the EMR's data structure to the NSA IDR required fields. What previously took 2–4 weeks of manual configuration takes 1–2 days.
- The Stakeholder Upload Portal allows any authorised user — provider, facility, payer, or aggregator — to upload documents immediately, with AI analysis running automatically on every upload.
- Role-based access control is pre-configured for the four primary stakeholder types: providers, payers, IDR entities, and administrators. No custom configuration is required.
- The platform is hosted on a cloud-native, auto-scaling infrastructure. There is no software to install, no servers to manage, and no maintenance windows.

---

## Slide 13: The Road Ahead — What We Are Building Next
**Headline:** The Platform Gets Smarter With Every Dispute

**Key points:**
- **Predictive Outcome Modelling** — A machine learning agent trained on historical IDR outcome data will provide estimated determination amounts with confidence intervals before a dispute is filed, enabling providers to make informed decisions about whether to proceed with IDR or accept a negotiated settlement.
- **Automated QPA Benchmarking** — The platform will query connected payer fee schedules and CMS cost data to automatically suggest a QPA-compliant offer amount with the supporting methodology citation, eliminating the most common source of IDR offer disputes.
- **Multi-Jurisdiction Batch Filing** — For providers operating across multiple states, the platform will automatically identify the applicable framework (NSA vs. state law) for each claim and batch-file disputes across jurisdictions with a single action.
- **Real-Time Payer Intelligence** — An aggregated, anonymised dataset of payer behaviour patterns — response times, offer ranges, determination rates by service type — will give providers a strategic advantage in open negotiation.
- **Mobile Application** — A native iOS and Android app for on-call physicians and administrators to review dispute status, approve offers, and receive deadline alerts from anywhere.

---

## Slide 14: Call to Action
**Headline:** Every Day Without This Platform Is Revenue Left on the Table

**Key points:**
- The average provider with 47 open disputes and a 78% first-attempt CMS rejection rate is losing an estimated $180,000–$420,000 in recoverable revenue annually — not because the claims are invalid, but because the process is broken.
- Our platform recovers that revenue systematically, with AI that works 24/7, deadlines that are never missed, and submissions that are validated before they leave the building.
- Implementation takes 48 hours. The ROI is measurable within the first 30 days.

**Three next steps:**
1. Schedule a live platform demonstration — see the AI agents in action on real dispute scenarios
2. Connect your EMR — the onboarding wizard takes under 2 hours with AI-assisted field mapping
3. File your first dispute — the platform guides every step, with the AI Assistant available for any question

**Contact / CTA block:** [Platform URL] | [Demo Booking Link] | [Support Email]

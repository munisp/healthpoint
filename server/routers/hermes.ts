/**
 * Hermes AI Agent Router
 * Provides 8 AI-powered capabilities for the HealthPoint IDR platform:
 * 1. Narrative generation
 * 2. Outcome simulation
 * 3. FHIR/EMR enrichment
 * 4. Risk scoring
 * 5. Payer intelligence synthesis
 * 6. Regulatory change feed
 * 7. Arbitrator scoring
 * 8. Chat (general agent)
 */

import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { invokeLLM } from "../_core/llm";
import { getDb } from "../db";
import {
  hermesJobs,
  hermesInsights,
  hermesRegulatoryEntries,
  hermesChatMessages,
  disputes,
} from "../../drizzle/schema";
import { eq, desc, and } from "drizzle-orm";
import { nanoid } from "nanoid";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function saveJob(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  data: {
    userId: string;
    disputeId?: string;
    jobType: typeof hermesJobs.$inferInsert["jobType"];
    inputPayload: Record<string, unknown>;
    outputText?: string;
    outputJson?: Record<string, unknown>;
    modelUsed?: string;
    promptTokens?: number;
    completionTokens?: number;
    latencyMs?: number;
    status?: typeof hermesJobs.$inferInsert["status"];
    errorMessage?: string;
  }
) {
  const id = nanoid();
  await db.insert(hermesJobs).values({
    id,
    userId: data.userId,
    disputeId: data.disputeId,
    jobType: data.jobType,
    status: data.status ?? "complete",
    inputPayload: data.inputPayload,
    outputText: data.outputText,
    outputJson: data.outputJson,
    modelUsed: data.modelUsed ?? "gpt-5-mini",
    promptTokens: data.promptTokens,
    completionTokens: data.completionTokens,
    latencyMs: data.latencyMs,
    errorMessage: data.errorMessage,
    startedAt: new Date(),
    completedAt: new Date(),
  });
  return id;
}

async function saveInsight(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  data: Partial<typeof hermesInsights.$inferInsert> & {
    disputeId: string;
    insightType: typeof hermesInsights.$inferInsert["insightType"];
  }
) {
  const id = nanoid();
  await db.insert(hermesInsights).values({ id, ...data });
  return id;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const hermesRouter = router({

  // ── 1. Narrative Generation ─────────────────────────────────────────────────
  generateNarrative: protectedProcedure
    .input(z.object({
      disputeId: z.string(),
      style: z.enum(["formal", "concise", "detailed"]).default("formal"),
      focusAreas: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const [dispute] = await db.select().from(disputes).where(eq(disputes.id, input.disputeId)).limit(1);
      if (!dispute) throw new Error("Dispute not found");

      const t0 = Date.now();
      const focusClause = input.focusAreas?.length
        ? `Focus particularly on: ${input.focusAreas.join(", ")}.`
        : "";

      const systemPrompt = `You are Hermes, an expert medical billing and NSA/IDR compliance attorney. 
Write a ${input.style} IDR submission narrative that:
- Cites 45 CFR §149.510 and relevant CMS guidance
- Explains why the billed amount is appropriate relative to the QPA
- References the service type, CPT codes, and geographic market
- Is persuasive, factual, and legally precise
${focusClause}
Output only the narrative text, no headers or metadata.`;

      const userPrompt = `Generate an IDR narrative for the following dispute:
Reference: ${dispute.referenceNumber}
Provider: ${dispute.initiatingPartyName} (NPI: ${dispute.initiatingPartyNpi ?? "N/A"})
Payer: ${dispute.respondingPartyName ?? "Unknown payer"}
Service Type: ${dispute.serviceType}
CPT Codes: ${(dispute.cptCodes as string[]).join(", ")}
Service Date: ${dispute.serviceDate?.toISOString().split("T")[0] ?? "N/A"}
Patient State: ${dispute.patientState}
Billed Amount: $${dispute.billedAmount}
QPA Amount: $${dispute.qpaAmount ?? "Not disclosed"}
Current Step: ${dispute.currentStep}
Notes: ${dispute.notes ?? "None"}`;

      const res = await invokeLLM({
        model: "gpt-5",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const narrative = res.choices[0].message.content as string;
      const latencyMs = Date.now() - t0;

      const jobId = await saveJob(db, {
        userId: ctx.user.id,
        disputeId: input.disputeId,
        jobType: "narrative_generation",
        inputPayload: { disputeId: input.disputeId, style: input.style },
        outputText: narrative,
        modelUsed: "gpt-5",
        promptTokens: res.usage?.prompt_tokens,
        completionTokens: res.usage?.completion_tokens,
        latencyMs,
      });

      await saveInsight(db, {
        disputeId: input.disputeId,
        jobId,
        insightType: "narrative_generation",
        narrative,
        narrativeVersion: 1,
      });

      return { narrative, jobId, latencyMs, model: "gpt-5" };
    }),

  // ── 2. Outcome Simulation ───────────────────────────────────────────────────
  simulateOutcome: protectedProcedure
    .input(z.object({
      disputeId: z.string(),
      additionalContext: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const [dispute] = await db.select().from(disputes).where(eq(disputes.id, input.disputeId)).limit(1);
      if (!dispute) throw new Error("Dispute not found");

      const t0 = Date.now();

      const res = await invokeLLM({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: `You are Hermes, an expert NSA/IDR outcome predictor with access to historical IDR determination data.
Analyze the dispute parameters and return a JSON object with outcome probabilities.
Base your analysis on:
- Historical IDR determination patterns by service type and CPT code
- The ratio of billed amount to QPA (higher ratios favor payers)
- Geographic market factors
- Current workflow step
- Whether additional information was submitted`,
          },
          {
            role: "user",
            content: `Predict IDR outcome for:
Reference: ${dispute.referenceNumber}
Service Type: ${dispute.serviceType}
CPT Codes: ${(dispute.cptCodes as string[]).join(", ")}
Billed: $${dispute.billedAmount}
QPA: $${dispute.qpaAmount ?? "Unknown"}
Provider Offer: $${dispute.initiatingPartyOffer ?? "Not submitted"}
Payer Offer: $${dispute.respondingPartyOffer ?? "Not submitted"}
State: ${dispute.patientState}
Step: ${dispute.currentStep}
${input.additionalContext ? `Additional context: ${input.additionalContext}` : ""}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "outcome_prediction",
            strict: true,
            schema: {
              type: "object",
              properties: {
                providerWinPct: { type: "integer", description: "Probability provider wins (0-100)" },
                payerWinPct: { type: "integer", description: "Probability payer wins (0-100)" },
                splitPct: { type: "integer", description: "Probability of split determination (0-100)" },
                withdrawnPct: { type: "integer", description: "Probability dispute is withdrawn (0-100)" },
                basis: { type: "string", description: "2-3 sentence explanation of the prediction rationale" },
                keyFactors: {
                  type: "array",
                  items: { type: "string" },
                  description: "Top 3-5 factors driving this prediction",
                },
                recommendedAction: { type: "string", description: "Recommended next action for the provider" },
              },
              required: ["providerWinPct", "payerWinPct", "splitPct", "withdrawnPct", "basis", "keyFactors", "recommendedAction"],
              additionalProperties: false,
            },
          },
        },
      });

      const raw = JSON.parse(res.choices[0].message.content as string);
      const latencyMs = Date.now() - t0;

      const jobId = await saveJob(db, {
        userId: ctx.user.id,
        disputeId: input.disputeId,
        jobType: "outcome_simulation",
        inputPayload: { disputeId: input.disputeId },
        outputJson: raw,
        modelUsed: "gpt-5",
        promptTokens: res.usage?.prompt_tokens,
        completionTokens: res.usage?.completion_tokens,
        latencyMs,
      });

      await saveInsight(db, {
        disputeId: input.disputeId,
        jobId,
        insightType: "outcome_simulation",
        providerWinPct: raw.providerWinPct,
        payerWinPct: raw.payerWinPct,
        splitPct: raw.splitPct,
        withdrawnPct: raw.withdrawnPct,
        simulationBasis: raw.basis,
      });

      return { ...raw, jobId, latencyMs, model: "gpt-5" };
    }),

  // ── 3. Risk Scoring ─────────────────────────────────────────────────────────
  scoreRisk: protectedProcedure
    .input(z.object({ disputeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const [dispute] = await db.select().from(disputes).where(eq(disputes.id, input.disputeId)).limit(1);
      if (!dispute) throw new Error("Dispute not found");

      const now = new Date();
      const deadlines = [
        dispute.openNegotiationDeadline,
        dispute.offerSubmissionDeadline,
        dispute.determinationDeadline,
        dispute.paymentDeadline,
      ].filter(Boolean) as Date[];

      const nearestDeadlineDays = deadlines.length
        ? Math.min(...deadlines.map(d => Math.ceil((d.getTime() - now.getTime()) / 86400000)))
        : 999;

      const t0 = Date.now();

      const res = await invokeLLM({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: `You are Hermes, an NSA/IDR risk analyst. Score dispute risk from 0-100 and identify risk factors.
Risk levels: 0-25=low, 26-50=medium, 51-75=high, 76-100=critical.
Consider: deadline proximity, billed/QPA ratio, step progression, missing offers, appeal history.`,
          },
          {
            role: "user",
            content: `Score risk for dispute ${dispute.referenceNumber}:
Status: ${dispute.status} | Step: ${dispute.currentStep}
Billed: $${dispute.billedAmount} | QPA: $${dispute.qpaAmount ?? "Unknown"}
Provider offer: $${dispute.initiatingPartyOffer ?? "None"} | Payer offer: $${dispute.respondingPartyOffer ?? "None"}
Nearest deadline in days: ${nearestDeadlineDays}
Eligible: ${dispute.isEligible ?? "Unknown"}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "risk_score",
            strict: true,
            schema: {
              type: "object",
              properties: {
                riskScore: { type: "integer" },
                riskLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
                riskFactors: { type: "array", items: { type: "string" } },
                mitigationSteps: { type: "array", items: { type: "string" } },
              },
              required: ["riskScore", "riskLevel", "riskFactors", "mitigationSteps"],
              additionalProperties: false,
            },
          },
        },
      });

      const raw = JSON.parse(res.choices[0].message.content as string);
      const latencyMs = Date.now() - t0;

      const jobId = await saveJob(db, {
        userId: ctx.user.id,
        disputeId: input.disputeId,
        jobType: "risk_scoring",
        inputPayload: { disputeId: input.disputeId, nearestDeadlineDays },
        outputJson: raw,
        modelUsed: "gpt-5-mini",
        latencyMs,
      });

      await saveInsight(db, {
        disputeId: input.disputeId,
        jobId,
        insightType: "risk_scoring",
        riskScore: raw.riskScore,
        riskLevel: raw.riskLevel,
        riskFactors: raw.riskFactors,
      });

      return { ...raw, jobId, latencyMs };
    }),

  // ── 4. FHIR/EMR Enrichment ──────────────────────────────────────────────────
  enrichFromFHIR: protectedProcedure
    .input(z.object({
      disputeId: z.string(),
      fhirBundle: z.string(), // raw FHIR R4 JSON bundle string
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const t0 = Date.now();

      const res = await invokeLLM({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: `You are Hermes, a FHIR R4 clinical data extractor for NSA/IDR disputes.
Extract structured fields from the FHIR bundle relevant to an IDR dispute.
Return only fields that are clearly present in the bundle.`,
          },
          {
            role: "user",
            content: `Extract IDR-relevant fields from this FHIR bundle:\n${input.fhirBundle.slice(0, 8000)}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "fhir_enrichment",
            strict: true,
            schema: {
              type: "object",
              properties: {
                patientName: { type: "string" },
                patientDob: { type: "string" },
                memberId: { type: "string" },
                diagnosisCodes: { type: "array", items: { type: "string" } },
                procedureCodes: { type: "array", items: { type: "string" } },
                encounterDate: { type: "string" },
                facilityName: { type: "string" },
                providerNpi: { type: "string" },
                priorAuthNumber: { type: "string" },
                insurancePlanName: { type: "string" },
                notes: { type: "string" },
              },
              required: ["patientName", "patientDob", "memberId", "diagnosisCodes", "procedureCodes", "encounterDate", "facilityName", "providerNpi", "priorAuthNumber", "insurancePlanName", "notes"],
              additionalProperties: false,
            },
          },
        },
      });

      const enrichedFields = JSON.parse(res.choices[0].message.content as string);
      const latencyMs = Date.now() - t0;

      const jobId = await saveJob(db, {
        userId: ctx.user.id,
        disputeId: input.disputeId,
        jobType: "fhir_enrichment",
        inputPayload: { disputeId: input.disputeId, bundleLength: input.fhirBundle.length },
        outputJson: enrichedFields,
        modelUsed: "gpt-5-mini",
        latencyMs,
      });

      await saveInsight(db, {
        disputeId: input.disputeId,
        jobId,
        insightType: "fhir_enrichment",
        enrichedFields,
      });

      return { enrichedFields, jobId, latencyMs };
    }),

  // ── 5. Payer Intelligence ───────────────────────────────────────────────────
  analyzePayerIntelligence: protectedProcedure
    .input(z.object({
      payerName: z.string(),
      serviceType: z.string().optional(),
      cptCodes: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const t0 = Date.now();

      const res = await invokeLLM({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: `You are Hermes, a payer behavior intelligence analyst for NSA/IDR disputes.
Synthesize behavioral patterns for the specified payer based on known IDR determination trends, CMS data, and industry reports.
Be specific, actionable, and cite regulatory context where relevant.`,
          },
          {
            role: "user",
            content: `Analyze payer intelligence for: ${input.payerName}
${input.serviceType ? `Service type: ${input.serviceType}` : ""}
${input.cptCodes?.length ? `CPT codes: ${input.cptCodes.join(", ")}` : ""}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "payer_intelligence",
            strict: true,
            schema: {
              type: "object",
              properties: {
                behaviorSummary: { type: "string" },
                estimatedAcceptanceRate: { type: "integer" },
                avgRoundsToAccept: { type: "number" },
                typicalOfferStrategy: { type: "string" },
                knownTactics: { type: "array", items: { type: "string" } },
                recommendedCounterStrategy: { type: "string" },
                regulatoryNotes: { type: "string" },
                dataConfidence: { type: "string", enum: ["low", "medium", "high"] },
              },
              required: ["behaviorSummary", "estimatedAcceptanceRate", "avgRoundsToAccept", "typicalOfferStrategy", "knownTactics", "recommendedCounterStrategy", "regulatoryNotes", "dataConfidence"],
              additionalProperties: false,
            },
          },
        },
      });

      const raw = JSON.parse(res.choices[0].message.content as string);
      const latencyMs = Date.now() - t0;

      await saveJob(db, {
        userId: ctx.user.id,
        jobType: "payer_intelligence",
        inputPayload: { payerName: input.payerName, serviceType: input.serviceType },
        outputJson: raw,
        modelUsed: "gpt-5",
        latencyMs,
      });

      return { ...raw, latencyMs };
    }),

  // ── 6. Regulatory Change Feed ───────────────────────────────────────────────
  generateRegulatoryFeed: protectedProcedure
    .input(z.object({
      topics: z.array(z.string()).optional(),
      maxEntries: z.number().min(1).max(20).default(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const t0 = Date.now();
      const topicsClause = input.topics?.length
        ? `Focus on: ${input.topics.join(", ")}.`
        : "Cover NSA implementation, IDR process updates, balance billing rules, and CMS guidance.";

      const res = await invokeLLM({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: `You are Hermes, a regulatory intelligence analyst for NSA/IDR compliance.
Generate a curated regulatory change feed with recent and upcoming changes relevant to healthcare providers and payers in the IDR process.
Each entry should be actionable and cite specific regulatory sources.`,
          },
          {
            role: "user",
            content: `Generate ${input.maxEntries} regulatory feed entries. ${topicsClause}
Current date context: ${new Date().toISOString().split("T")[0]}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "regulatory_feed",
            strict: true,
            schema: {
              type: "object",
              properties: {
                entries: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      summary: { type: "string" },
                      source: { type: "string" },
                      sourceUrl: { type: "string" },
                      impactLevel: { type: "string", enum: ["low", "medium", "high", "critical"] },
                      affectedSteps: { type: "array", items: { type: "string" } },
                      tags: { type: "array", items: { type: "string" } },
                      effectiveDate: { type: "string" },
                    },
                    required: ["title", "summary", "source", "sourceUrl", "impactLevel", "affectedSteps", "tags", "effectiveDate"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["entries"],
              additionalProperties: false,
            },
          },
        },
      });

      const { entries } = JSON.parse(res.choices[0].message.content as string);
      const latencyMs = Date.now() - t0;

      // Persist entries to the DB
      for (const entry of entries) {
        await db.insert(hermesRegulatoryEntries).values({
          id: nanoid(),
          title: entry.title,
          summary: entry.summary,
          source: entry.source,
          sourceUrl: entry.sourceUrl,
          impactLevel: entry.impactLevel,
          affectedSteps: entry.affectedSteps,
          tags: entry.tags,
          effectiveDate: entry.effectiveDate ? new Date(entry.effectiveDate) : null,
        });
      }

      await saveJob(db, {
        userId: ctx.user.id,
        jobType: "regulatory_feed",
        inputPayload: { topics: input.topics, maxEntries: input.maxEntries },
        outputJson: { count: entries.length },
        modelUsed: "gpt-5",
        latencyMs,
      });

      return { entries, latencyMs };
    }),

  listRegulatoryEntries: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(50).default(20),
      unreadOnly: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db
        .select()
        .from(hermesRegulatoryEntries)
        .where(input.unreadOnly ? eq(hermesRegulatoryEntries.isRead, false) : undefined)
        .orderBy(desc(hermesRegulatoryEntries.createdAt))
        .limit(input.limit);
      return rows;
    }),

  markRegulatoryRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      await db.update(hermesRegulatoryEntries)
        .set({ isRead: true })
        .where(eq(hermesRegulatoryEntries.id, input.id));
      return { success: true };
    }),

  // ── 7. Arbitrator Scoring ───────────────────────────────────────────────────
  scoreArbitrator: protectedProcedure
    .input(z.object({
      arbitratorName: z.string(),
      arbitratorId: z.string().optional(),
      serviceType: z.string().optional(),
      cptCodes: z.array(z.string()).optional(),
      disputeId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      const t0 = Date.now();

      const res = await invokeLLM({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: `You are Hermes, an IDR arbitrator intelligence analyst.
Analyze the arbitrator's known decision patterns from public IDR determination data.
Provide actionable intelligence to help providers calibrate their offer strategy.`,
          },
          {
            role: "user",
            content: `Score arbitrator: ${input.arbitratorName}
${input.serviceType ? `Service type: ${input.serviceType}` : ""}
${input.cptCodes?.length ? `CPT codes: ${input.cptCodes.join(", ")}` : ""}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "arbitrator_score",
            strict: true,
            schema: {
              type: "object",
              properties: {
                providerWinRate: { type: "integer" },
                avgAwardAmount: { type: "number" },
                avgDecisionDays: { type: "integer" },
                decisionTendency: { type: "string" },
                preferredEvidenceTypes: { type: "array", items: { type: "string" } },
                offerCalibrationAdvice: { type: "string" },
                notes: { type: "string" },
                dataConfidence: { type: "string", enum: ["low", "medium", "high"] },
              },
              required: ["providerWinRate", "avgAwardAmount", "avgDecisionDays", "decisionTendency", "preferredEvidenceTypes", "offerCalibrationAdvice", "notes", "dataConfidence"],
              additionalProperties: false,
            },
          },
        },
      });

      const raw = JSON.parse(res.choices[0].message.content as string);
      const latencyMs = Date.now() - t0;

      const jobId = await saveJob(db, {
        userId: ctx.user.id,
        disputeId: input.disputeId,
        jobType: "arbitrator_scoring",
        inputPayload: { arbitratorName: input.arbitratorName, serviceType: input.serviceType },
        outputJson: raw,
        modelUsed: "gpt-5",
        latencyMs,
      });

      if (input.disputeId) {
        await saveInsight(db, {
          disputeId: input.disputeId,
          jobId,
          insightType: "arbitrator_scoring",
          arbitratorId: input.arbitratorId,
          arbitratorWinRate: raw.providerWinRate,
          arbitratorAvgAward: String(raw.avgAwardAmount),
          arbitratorNotes: raw.notes,
        });
      }

      return { ...raw, jobId, latencyMs };
    }),

  // ── 8. Chat ─────────────────────────────────────────────────────────────────
  chat: protectedProcedure
    .input(z.object({
      sessionId: z.string(),
      message: z.string().min(1).max(4000),
      disputeId: z.string().optional(),
      history: z.array(z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })).max(20).default([]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");

      // Fetch dispute context if provided
      let disputeContext = "";
      if (input.disputeId) {
        const [dispute] = await db.select().from(disputes).where(eq(disputes.id, input.disputeId)).limit(1);
        if (dispute) {
          disputeContext = `\n\nActive dispute context:
Reference: ${dispute.referenceNumber}
Provider: ${dispute.initiatingPartyName}
Payer: ${dispute.respondingPartyName ?? "Unknown"}
Service: ${dispute.serviceType} | CPTs: ${(dispute.cptCodes as string[]).join(", ")}
Billed: $${dispute.billedAmount} | QPA: $${dispute.qpaAmount ?? "N/A"}
Step: ${dispute.currentStep} | Status: ${dispute.status}`;
        }
      }

      const t0 = Date.now();

      const res = await invokeLLM({
        model: "gpt-5",
        messages: [
          {
            role: "system",
            content: `You are Hermes, the AI agent for the HealthPoint NSA/IDR platform. You are an expert in:
- The No Surprises Act (NSA) and 45 CFR §149.510
- The 19-step Federal IDR process
- Medical billing, CPT codes, and QPA methodology
- Payer negotiation strategies
- FHIR R4 and EMR integrations
- NSA compliance and CMS reporting requirements

Be concise, accurate, and actionable. Cite regulatory references when relevant.${disputeContext}`,
          },
          ...input.history.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
          { role: "user" as const, content: input.message },
        ],
      });

      const reply = res.choices[0].message.content as string;
      const latencyMs = Date.now() - t0;

      // Persist messages
      await db.insert(hermesChatMessages).values({
        id: nanoid(),
        sessionId: input.sessionId,
        userId: ctx.user.id,
        disputeId: input.disputeId,
        role: "user",
        content: input.message,
      });
      const assistantMsgId = nanoid();
      await db.insert(hermesChatMessages).values({
        id: assistantMsgId,
        sessionId: input.sessionId,
        userId: ctx.user.id,
        disputeId: input.disputeId,
        role: "assistant",
        content: reply,
      });

      await saveJob(db, {
        userId: ctx.user.id,
        disputeId: input.disputeId,
        jobType: "chat",
        inputPayload: { sessionId: input.sessionId, messageLength: input.message.length },
        outputText: reply,
        modelUsed: "gpt-5",
        promptTokens: res.usage?.prompt_tokens,
        completionTokens: res.usage?.completion_tokens,
        latencyMs,
      });

      return { reply, messageId: assistantMsgId, latencyMs };
    }),

  getChatHistory: protectedProcedure
    .input(z.object({
      sessionId: z.string(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(hermesChatMessages)
        .where(and(
          eq(hermesChatMessages.sessionId, input.sessionId),
          eq(hermesChatMessages.userId, ctx.user.id),
        ))
        .orderBy(hermesChatMessages.createdAt)
        .limit(input.limit);
    }),

  // ── Job history ─────────────────────────────────────────────────────────────
  listJobs: protectedProcedure
    .input(z.object({
      disputeId: z.string().optional(),
      jobType: z.enum(["narrative_generation", "outcome_simulation", "fhir_enrichment", "risk_scoring", "payer_intelligence", "regulatory_feed", "arbitrator_scoring", "chat"]).optional(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = [eq(hermesJobs.userId, ctx.user.id)];
      if (input.disputeId) conditions.push(eq(hermesJobs.disputeId, input.disputeId));
      if (input.jobType) conditions.push(eq(hermesJobs.jobType, input.jobType));
      return db
        .select()
        .from(hermesJobs)
        .where(and(...conditions))
        .orderBy(desc(hermesJobs.createdAt))
        .limit(input.limit);
    }),

  // ── Insights for a dispute ───────────────────────────────────────────────────
  getDisputeInsights: protectedProcedure
    .input(z.object({ disputeId: z.string() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db
        .select()
        .from(hermesInsights)
        .where(eq(hermesInsights.disputeId, input.disputeId))
        .orderBy(desc(hermesInsights.generatedAt));
    }),
});

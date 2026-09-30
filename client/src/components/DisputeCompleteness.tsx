/**
 * DisputeCompleteness — Phase 17-FE completeness UX for dispute surfaces
 * (DisputeDetail + dispute create).
 *
 * DATA SOURCES (honest):
 *  1. trpc.practiceAudit.requiredFields — the CMS-required data dictionary
 *     (server/eligibility/required-fields.ts) with CFR citations. The
 *     checklist + progress bar here are CLIENT-COMPUTED from the dispute
 *     form/record values against that dictionary.
 *  2. Gate errors: when a server mutation rejects with PRECONDITION_FAILED
 *     and a missingFields detail, the exact gaps are rendered verbatim from
 *     the server response.
 *
 * NOTE: the backend disputes completeness projection (server-side computed
 * completeness on the dispute resource) has NOT landed yet (phase17-ce
 * scope). Until it does, this component renders from the client-computed
 * checklist + gate-error responses only — it never fabricates a server
 * verdict.
 */
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ShieldAlert } from "lucide-react";

export interface RequiredFieldSpec {
  key: string;
  label: string;
  sources: string[];
  citation: string;
  requirement: "required" | "conditional";
  condition?: string;
}

type SubmissionContext = "claim_ingestion" | "open_negotiation_initiation" | "idr_initiation" | "batching" | "delegation_attestation";

/** Parse missingFields out of a PRECONDITION_FAILED gate error (defensive:
 *  both structured `details.missingFields` and message-text forms). */
export function parseGateMissingFields(err: unknown): string[] {
  if (!err || typeof err !== "object") return [];
  const e = err as { data?: { code?: string }; message?: string; shape?: { data?: { missingFields?: unknown } }; cause?: unknown };
  // tRPC error: message + data.code; cause may carry structured details.
  const candidates: unknown[] = [
    (e.shape?.data as { missingFields?: unknown } | undefined)?.missingFields,
    (e as { details?: { missingFields?: unknown } }).details?.missingFields,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c.filter((x): x is string => typeof x === "string");
  }
  // Fall back to "missing fields: a, b, c" message text.
  const m = /missing (?:required )?fields?[:\s]+([^.]+)/i.exec(e.message ?? "");
  if (m) return m[1].split(",").map(s => s.trim()).filter(Boolean);
  return [];
}

export function isPreconditionFailed(err: unknown): boolean {
  const e = err as { data?: { code?: string } } | null;
  return !!e && e.data?.code === "PRECONDITION_FAILED";
}

export default function DisputeCompleteness({
  context,
  /** Current field values keyed by REQUIRED_FIELDS keys (best-effort mapping). */
  values,
  /** Server gate errors collected from failed submit/advance attempts. */
  gateErrors = [],
  title = "IDR completeness",
}: {
  context: SubmissionContext;
  values: Record<string, unknown>;
  gateErrors?: unknown[];
  title?: string;
}) {
  const { data: requiredFields } = trpc.practiceAudit.requiredFields.useQuery();

  const specs = useMemo(() => {
    const rf = requiredFields as Record<SubmissionContext, RequiredFieldSpec[]> | undefined;
    return rf?.[context] ?? [];
  }, [requiredFields, context]);

  const checklist = useMemo(() => specs.map(spec => {
    const v = values[spec.key];
    const present = v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
    return { ...spec, present };
  }), [specs, values]);

  const requiredOnly = checklist.filter(c => c.requirement === "required");
  const presentCount = requiredOnly.filter(c => c.present).length;
  const pct = requiredOnly.length === 0 ? 100 : Math.round((presentCount / requiredOnly.length) * 100);
  const missing = requiredOnly.filter(c => !c.present);

  const gateMissing = useMemo(() => {
    const all = gateErrors.filter(isPreconditionFailed).flatMap(parseGateMissingFields);
    return Array.from(new Set(all));
  }, [gateErrors]);

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldAlert size={14} className="text-amber-500" />
          {title}
          <Badge variant="outline" className="text-xs">client-computed</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        <div className="flex items-center gap-2">
          <Progress value={pct} className="h-2 flex-1" />
          <span className="text-xs font-medium">{pct}%</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {presentCount} of {requiredOnly.length} required fields present for {context.replace(/_/g, " ")}.
          Server-side completeness projection is pending (phase17-ce); this checklist is computed in the browser
          from the CMS-required data dictionary.
        </p>

        {missing.length > 0 && (
          <div>
            <p className="text-xs font-medium text-amber-800 mb-1">Missing fields blocking a clean submission:</p>
            <ul className="space-y-1">
              {missing.map(f => (
                <li key={f.key} className="text-xs text-amber-800">
                  <span className="font-medium">{f.label}</span>
                  <span className="block text-muted-foreground">{f.citation}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {gateMissing.length > 0 && (
          <div className="rounded border border-red-300 bg-red-50 p-2">
            <p className="text-xs font-medium text-red-800">Server gate rejected submission (PRECONDITION_FAILED) — exact gaps reported by the server:</p>
            <ul className="list-disc pl-4">
              {gateMissing.map(f => <li key={f} className="text-xs text-red-800">{f}</li>)}
            </ul>
          </div>
        )}

        {checklist.filter(c => c.requirement === "conditional").length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Conditional fields</summary>
            <ul className="mt-1 space-y-1">
              {checklist.filter(c => c.requirement === "conditional").map(f => (
                <li key={f.key} className={f.present ? "text-green-700" : "text-muted-foreground"}>
                  {f.present ? "✓" : "○"} {f.label} — {f.condition}
                  <span className="block text-muted-foreground">{f.citation}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

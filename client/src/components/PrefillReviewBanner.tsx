/**
 * PrefillReviewBanner — Phase 21 (S2a). Subtle banner shown on the
 * NewDispute wizard after an eager `prefill.dispute` call populated fields
 * from the connected EMR. Lists each prefilled field with its
 * producer-reported confidence (never fabricated) so the user reviews
 * before submitting. Untouched-confirmed fields count as `accepted`;
 * user-edited fields count as `edited` (see client/src/lib/feedback.ts).
 */
import { CheckCircle2 } from "lucide-react";
import type { PrefilledField } from "@/lib/feedback";

export default function PrefillReviewBanner({
  fields,
  modelName,
}: {
  fields: PrefilledField[];
  modelName: string | null;
}) {
  if (!fields.length) return null;
  return (
    <div
      role="status"
      aria-label="Prefilled from EMR — review"
      className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <CheckCircle2 size={16} className="text-amber-600" />
        <p className="text-sm font-medium text-amber-800">
          Prefilled from EMR — review
        </p>
        <span className="text-xs text-amber-700">
          {fields.length} field{fields.length === 1 ? "" : "s"} suggested
          {modelName ? ` by ${modelName}` : ""}. Fields you leave unchanged are
          recorded as accepted; edits are recorded as corrections.
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {fields.map(f => (
          <span
            key={f.formKey}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800 border border-amber-200"
            title={f.confidence != null ? `producer-reported confidence ${Math.round(f.confidence * 100)}%` : "no confidence reported"}
          >
            {f.sourceField}
            {f.confidence != null && (
              <span className="text-amber-600">{Math.round(f.confidence * 100)}%</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

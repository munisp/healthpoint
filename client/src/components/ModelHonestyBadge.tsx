/**
 * ModelHonestyBadge — Phase 21 (S3). Renders the SERVER-PROVIDED honesty
 * label verbatim (statistical_estimate / insufficient_data) plus the
 * modelVersion block (version, trainedAt, training sample size). A model
 * older than 7 days is badged stale (design §10.3). No confidence numbers
 * are ever fabricated — only server values are displayed.
 */
import { Badge } from "@/components/ui/badge";
import { isModelStale } from "@/lib/feedback";

export interface ModelVersionInfo {
  id: string | null;
  version: number | null;
  trainedAt: string | null;
  trainingSampleSize: number;
  honestyLabel: "statistical_estimate" | "insufficient_data";
}

export default function ModelHonestyBadge({ modelVersion }: { modelVersion: ModelVersionInfo }) {
  const stale = isModelStale(modelVersion.trainedAt);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge
        variant={modelVersion.honestyLabel === "statistical_estimate" ? "secondary" : "outline"}
        className="text-xs"
        data-testid="honesty-label"
      >
        {modelVersion.honestyLabel}
      </Badge>
      {modelVersion.version != null && (
        <Badge variant="outline" className="text-xs">
          model v{modelVersion.version}
          {modelVersion.trainedAt && ` · trained ${new Date(modelVersion.trainedAt).toLocaleDateString()}`}
          {` · n=${modelVersion.trainingSampleSize}`}
        </Badge>
      )}
      {stale && modelVersion.version != null && (
        <Badge variant="outline" className="text-xs border-amber-300 text-amber-700">
          stale (&gt;7d or unknown)
        </Badge>
      )}
    </span>
  );
}

/**
 * SuggestedValueChip — Phase 21 (S2b). One-click accept chip for a
 * quarantine-repair suggestion (prefill.quarantineRows). Shows the
 * suggested value, its source (reparse vs org_prior) and the
 * producer-reported confidence; thin org priors (n<5) are never sent by
 * the server, so anything shown met the gate.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface QuarantineSuggestionView {
  field: string;
  suggestedValue: unknown;
  confidence: number;
  source: "reparse" | "org_prior";
}

export default function SuggestedValueChip({
  suggestion,
  accepted,
  onAccept,
}: {
  suggestion: QuarantineSuggestionView;
  accepted: boolean;
  onAccept: () => void;
}) {
  const display =
    suggestion.suggestedValue === null || suggestion.suggestedValue === undefined
      ? "—"
      : Array.isArray(suggestion.suggestedValue)
        ? suggestion.suggestedValue.join(", ")
        : String(suggestion.suggestedValue);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 border rounded-md px-2 py-1 text-xs bg-muted/40">
      <span className="font-medium">{suggestion.field}</span>
      <span className="text-muted-foreground">suggested:</span>
      <code className="font-semibold">{display}</code>
      <Badge variant="secondary" className="text-xs">
        {Math.round(suggestion.confidence * 100)}%
      </Badge>
      <Badge variant="outline" className="text-xs">
        {suggestion.source === "reparse" ? "re-parsed from file" : "org prior (n≥5)"}
      </Badge>
      <Button
        size="sm"
        variant={accepted ? "secondary" : "outline"}
        className="h-6 px-2 text-xs"
        disabled={accepted}
        onClick={onAccept}
      >
        {accepted ? "Accepted ✓" : "Accept"}
      </Button>
    </span>
  );
}

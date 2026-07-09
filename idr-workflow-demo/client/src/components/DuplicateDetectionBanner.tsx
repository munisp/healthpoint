import { AlertTriangle, X, ExternalLink } from "lucide-react";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";

interface DuplicateDetectionBannerProps {
  disputeId: string;
  claimNumber?: string | null;
  payerName?: string | null;
  billedAmount?: string | null;
}

export default function DuplicateDetectionBanner({
  disputeId,
  claimNumber,
  payerName,
  billedAmount,
}: DuplicateDetectionBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [, navigate] = useLocation();

  const { data: duplicates } = trpc.disputes.findDuplicates.useQuery(
    { disputeId, claimNumber: claimNumber ?? undefined, payerName: payerName ?? undefined },
    { enabled: !!claimNumber || !!payerName }
  );

  if (dismissed || !duplicates || duplicates.length === 0) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3 no-print">
      <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-800">
          Potential duplicate detected — {duplicates.length} similar dispute{duplicates.length !== 1 ? "s" : ""} found
        </p>
        <div className="flex flex-wrap gap-2 mt-1.5">
          {duplicates.slice(0, 3).map((d: { id: string; referenceNumber: string | null; status: string | null; createdAt: Date | null }) => (
            <button
              key={d.id}
              onClick={() => navigate(`/disputes/${d.id}`)}
              className="inline-flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 underline underline-offset-2"
            >
              {d.referenceNumber}
              <ExternalLink className="h-3 w-3" />
            </button>
          ))}
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 rounded hover:bg-amber-100 transition-colors shrink-0"
        aria-label="Dismiss duplicate warning"
      >
        <X className="h-4 w-4 text-amber-500" />
      </button>
    </div>
  );
}

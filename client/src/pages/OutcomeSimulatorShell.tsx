import { Suspense, lazy } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { TriangleAlert } from "lucide-react";

// Thin shell around the existing (previously orphaned) DisputeOutcomeSimulator page.
// The wiring agent mounts this shell at /outcome-simulator.
const DisputeOutcomeSimulator = lazy(() => import("./DisputeOutcomeSimulator"));

export default function OutcomeSimulatorShell() {
  return (
    <div className="space-y-4">
      <Alert>
        <TriangleAlert size={16} />
        <AlertTitle>Statistical model output - not a guarantee</AlertTitle>
        <AlertDescription>
          Simulated outcomes are statistical estimates derived from historical patterns. They do not predict or
          guarantee the result of any specific dispute, and they are not legal advice.
        </AlertDescription>
      </Alert>
      <Suspense
        fallback={
          <div className="space-y-3">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        }
      >
        <DisputeOutcomeSimulator />
      </Suspense>
    </div>
  );
}

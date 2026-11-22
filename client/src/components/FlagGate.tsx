/**
 * FlagGate — wave W5-7.
 * Gates a route behind a server-side feature flag (feature_flags table).
 * DEFAULT-ON: while the check is loading or if it fails, children render —
 * flags are a rollout convenience, not a safety gate. Only an explicit
 * server-side `enabled:false` (or 0% rollout for this user) hides the page.
 */
import { ReactNode } from "react";
import { trpc } from "@/lib/trpc";

export function FlagGate({ flag, children }: { flag: string; children: ReactNode }) {
  const { data, isError } = trpc.featureFlags.check.useQuery(
    { key: flag },
    { staleTime: 60_000, retry: 1 },
  );
  if (!isError && data && data.enabled === false) {
    return (
      <div className="p-10 text-center space-y-2">
        <h2 className="text-lg font-semibold">Feature not enabled</h2>
        <p className="text-sm text-muted-foreground">
          This area (<code>{flag}</code>) is currently disabled by an administrator feature flag.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

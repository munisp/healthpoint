import { Skeleton } from "@/components/ui/skeleton";

/**
 * RouteSkeleton
 *
 * Global Suspense fallback for lazy-loaded routes. Renders a stable,
 * layout-shaped placeholder (header line + card grid) instead of a
 * spinner so the page doesn't jump when content arrives (avoids CLS).
 */
export default function RouteSkeleton() {
  return (
    <div
      className="w-full space-y-6 p-1"
      role="status"
      aria-label="Loading page"
      aria-busy="true"
    >
      {/* Page title + action row */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-48 skeleton-shimmer" />
          <Skeleton className="h-4 w-72 skeleton-shimmer" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md skeleton-shimmer" />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-4 space-y-3">
            <Skeleton className="h-3 w-20 skeleton-shimmer" />
            <Skeleton className="h-6 w-24 skeleton-shimmer" />
          </div>
        ))}
      </div>

      {/* Main content block */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-9 w-9 rounded-full shrink-0 skeleton-shimmer" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5 skeleton-shimmer" />
              <Skeleton className="h-3 w-3/5 skeleton-shimmer" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full skeleton-shimmer" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/**
 * useBranding — W7-4 org white-label basics.
 *
 * Fetches org-scoped branding (brandName / logoUrl / primaryColor, columns
 * added by migration 0043_wave_w7.sql) and applies the primary color by
 * overriding the `--primary` CSS custom property on a scoped element (or
 * document root). Any field left NULL on the org falls back to the platform
 * defaults (APP_TITLE / APP_LOGO / default --primary token).
 *
 * Two variants:
 *  - useMyBranding(): header/authenticated chrome — branding of the caller's
 *    first membership org. Errors (user has no org, feature-flagged surface
 *    unreachable) are swallowed to null so the default brand shows.
 *  - useOrgBranding(orgId): public login page (/login?org=<id>).
 */
import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

export interface Branding {
  orgId: string;
  orgName: string;
  brandName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
}

/** Apply the org primary color to --primary; returns a cleanup restoring it. */
export function applyPrimaryColor(color: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
    root.style.setProperty("--primary", color);
  } else {
    root.style.removeProperty("--primary");
  }
}

function useApplyColor(color: string | null | undefined): void {
  useEffect(() => {
    applyPrimaryColor(color);
    return () => applyPrimaryColor(null);
  }, [color]);
}

export function useMyBranding(): { branding: Branding | null; isLoading: boolean } {
  const query = trpc.orgs.myBranding.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  const branding = (query.data ?? null) as Branding | null;
  useApplyColor(branding?.primaryColor);
  return { branding, isLoading: query.isLoading };
}

export function useOrgBranding(orgId: string | null): { branding: Branding | null; isLoading: boolean } {
  const query = trpc.orgs.getBranding.useQuery(
    { orgId: orgId! },
    { enabled: !!orgId, retry: false, refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 }
  );
  const branding = (query.data ?? null) as Branding | null;
  useApplyColor(orgId ? branding?.primaryColor : null);
  return { branding, isLoading: !!orgId && query.isLoading };
}

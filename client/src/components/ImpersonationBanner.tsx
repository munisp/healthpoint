/**
 * ImpersonationBanner — wave W5-6.
 * Shown at the top of the app whenever an impersonation token is present in
 * sessionStorage (set by an admin after impersonation.start). Every request
 * made while the token is present is audited server-side
 * (audit_log action='impersonate.access'); tokens expire after 15 minutes.
 */
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";

export const IMPERSONATION_TOKEN_KEY = "hp_impersonation_token";
export const IMPERSONATION_TARGET_KEY = "hp_impersonation_target";

export function getImpersonationToken(): string | null {
  try { return sessionStorage.getItem(IMPERSONATION_TOKEN_KEY); } catch { return null; }
}

export function setImpersonationSession(token: string, targetLabel: string) {
  sessionStorage.setItem(IMPERSONATION_TOKEN_KEY, token);
  sessionStorage.setItem(IMPERSONATION_TARGET_KEY, targetLabel);
}

export function clearImpersonationSession() {
  sessionStorage.removeItem(IMPERSONATION_TOKEN_KEY);
  sessionStorage.removeItem(IMPERSONATION_TARGET_KEY);
}

export default function ImpersonationBanner() {
  const token = getImpersonationToken();
  const target = (() => { try { return sessionStorage.getItem(IMPERSONATION_TARGET_KEY); } catch { return null; } })();
  const endMut = trpc.impersonation.end.useMutation({
    onSuccess: () => { clearImpersonationSession(); window.location.reload(); },
    onError: e => { toast.error(e.message); clearImpersonationSession(); window.location.reload(); },
  });

  if (!token) return null;
  return (
    <div className="w-full bg-amber-100 border-b border-amber-300 text-amber-900 px-4 py-2 flex items-center justify-between text-sm">
      <span className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4" />
        Impersonation active{target ? ` — viewing as ${target}` : ""}. Every action is audited. Session expires 15 minutes after start.
      </span>
      <Button size="sm" variant="outline" onClick={() => endMut.mutate({ token })} disabled={endMut.isPending}>
        End impersonation
      </Button>
    </div>
  );
}

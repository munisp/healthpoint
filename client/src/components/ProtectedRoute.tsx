import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** If true, also requires user.role === "admin" */
  adminOnly?: boolean;
}

/**
 * Wraps any page that requires authentication.
 * - While auth is loading: shows a full-page spinner.
 * - If unauthenticated: redirects to Manus OAuth login.
 * - If adminOnly and user is not admin: shows an Access Denied screen.
 */
export default function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, loading, isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Redirect to OAuth login immediately
    window.location.href = getLoginUrl();
    return null;
  }

  if (adminOnly && user?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="text-center max-w-sm px-4">
          <Shield className="h-12 w-12 mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-slate-700 dark:text-slate-200">Access Denied</h2>
          <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm">
            Administrator privileges are required to view this page.
          </p>
          <Button className="mt-6" onClick={() => navigate("/dashboard")}>
            Return to Dashboard
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

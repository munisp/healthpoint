/**
 * LoginPage.tsx
 *
 * Dedicated /login route that:
 *  1. Shows a loading spinner while auth state is resolving.
 *  2. If already authenticated, redirects to ?redirectTo or /dashboard.
 *  3. Reads ?auth_error= from the query string and displays a human-friendly message.
 *  4. Provides Sign In and Sign Up buttons that preserve the ?redirectTo param
 *     so Keycloak sends the user back to the right page after login.
 */

import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl, getRegisterUrl, APP_TITLE, APP_LOGO } from "@/const";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, Loader2, LogIn, UserPlus, ShieldCheck } from "lucide-react";

/** Maps ?auth_error= values to human-readable messages */
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  login_failed:    "Sign-in failed. Please try again.",
  register_failed: "Registration failed. Please try again.",
  callback_failed: "Authentication callback failed. Please try again.",
  invalid_state:   "Your login session expired. Please start again.",
  no_claims:       "Could not retrieve your account information. Please try again.",
  session_expired: "Your session has expired. Please sign in again.",
  access_denied:   "Access was denied. Please contact your administrator.",
};

function getAuthErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return AUTH_ERROR_MESSAGES[code] ?? `Authentication error: ${code}`;
}

export default function LoginPage() {
  const { isAuthenticated, loading } = useAuth();
  const [, navigate] = useLocation();

  // Parse query params from the current URL
  const params = new URLSearchParams(window.location.search);
  const redirectTo = params.get("redirectTo") || "/dashboard";
  const authError  = params.get("auth_error");
  const errorMsg   = getAuthErrorMessage(authError);

  // If already authenticated, redirect immediately
  useEffect(() => {
    if (!loading && isAuthenticated) {
      // Use replace so the login page is not in the browser history
      navigate(redirectTo, { replace: true });
    }
  }, [loading, isAuthenticated, redirectTo, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Checking authentication…</p>
        </div>
      </div>
    );
  }

  // If authenticated, show nothing while the redirect effect fires
  if (isAuthenticated) {
    return null;
  }

  const loginUrl    = getLoginUrl(redirectTo);
  const registerUrl = getRegisterUrl("", redirectTo);

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="w-full border-b bg-background/80 backdrop-blur px-6 flex items-center h-14">
        <div className="flex items-center gap-2">
          <img
            src={APP_LOGO}
            alt={APP_TITLE}
            className="h-8 w-8 rounded-lg border border-border object-cover"
          />
          <span className="text-xl font-bold tracking-tight">{APP_TITLE}</span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4">
          {/* Error banner */}
          {errorMsg && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}

          <Card className="shadow-lg border-border/60">
            <CardHeader className="text-center pb-4">
              <div className="flex justify-center mb-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                  <ShieldCheck className="h-6 w-6 text-primary" />
                </div>
              </div>
              <CardTitle className="text-2xl">Welcome to {APP_TITLE}</CardTitle>
              <CardDescription className="text-sm">
                Sign in to manage insurance disputes and track IDR workflows.
              </CardDescription>
            </CardHeader>

            <Separator />

            <CardContent className="pt-6 space-y-3">
              <Button
                className="w-full gap-2"
                size="lg"
                onClick={() => { window.location.href = loginUrl; }}
              >
                <LogIn className="h-4 w-4" />
                Sign In
              </Button>

              <Button
                variant="outline"
                className="w-full gap-2"
                size="lg"
                onClick={() => { window.location.href = registerUrl; }}
              >
                <UserPlus className="h-4 w-4" />
                Create Account
              </Button>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-muted-foreground px-4">
            By signing in you agree to our Terms of Service and Privacy Policy.
            Authentication is provided by Keycloak.
          </p>
        </div>
      </main>
    </div>
  );
}

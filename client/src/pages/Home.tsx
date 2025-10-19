import { useAuth } from "@/_core/hooks/useAuth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { APP_LOGO, APP_TITLE, getLoginUrl } from "@/const";
import { AlertCircle, Loader2 } from "lucide-react";

/**
 * Build polished modern webapp experiences. Visit the README for the full playbook.
 * All content in this page are only for example, delete if unneeded
 */
export default function Home() {
  let { user, loading, error, isAuthenticated, logout } = useAuth();
  // If theme is switchable in App.tsx, we can implement theme toggling like this:
  // const { theme, toggleTheme } = useTheme();

  const LoginBoxContent = () => {
    return (
      <>
        <CardHeader className="text-center">
          {isAuthenticated ? (
            <>
              <CardTitle>Welcome back</CardTitle>
              <CardDescription>You are signed in</CardDescription>
            </>
          ) : (
            <>
              <CardTitle>Get Started</CardTitle>
              <CardDescription>Sign in to use this App</CardDescription>
            </>
          )}
        </CardHeader>

        <Separator />

        <CardContent className="flex justify-center">
          {isAuthenticated ? (
            <div className="flex items-center gap-4">
              <Avatar className="size-12">
                <AvatarFallback className="text-lg font-semibold">
                  {user?.name?.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="font-semibold">{user?.name}</div>
                <div className="text-sm text-muted-foreground">
                  {user?.email}
                </div>
              </div>
            </div>
          ) : (
            <Button
              className="w-full"
              size="lg"
              onClick={() => (window.location.href = getLoginUrl())}
            >
              Sign In
            </Button>
          )}
        </CardContent>
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="w-full border-b px-4 flex items-center justify-between h-14">
        <div className="flex items-center gap-2">
          <img
            src={APP_LOGO}
            className="h-8 w-8 rounded-lg border-border bg-background object-cover"
          />
          <span className="text-xl font-bold">{APP_TITLE}</span>
        </div>

        <div className="flex items-center gap-2">
          {isAuthenticated && (
            <Button variant="outline" onClick={logout}>
              Sign Out
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-6">
        <Card style={{ minWidth: "350px" }}>
          {loading ? (
            <div className="flex items-center justify-center p-4">
              {/* Show loading at component level, not page level - keeps UI interactive */}
              <Loader2 className="animate-spin" />
            </div>
          ) : (
            <LoginBoxContent />
          )}
        </Card>

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
      </main>
    </div>
  );
}

import { cn } from "@/lib/utils";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    // Full navigation resets the crashed React tree.
    window.location.assign("/dashboard");
  };

  render() {
    if (this.state.hasError) {
      return (
        <main className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div
            role="alert"
            className="flex flex-col items-center w-full max-w-2xl p-8 rounded-xl border bg-card text-center"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger mb-6">
              <AlertTriangle
                size={30}
                className="text-danger-foreground flex-shrink-0"
                aria-hidden="true"
              />
            </div>

            <h2 className="text-xl font-semibold mb-2">
              Something went wrong
            </h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-md leading-relaxed">
              An unexpected error occurred while rendering this page. Your
              dispute data is safe — you can reload the page or return to your
              dashboard.
            </p>

            {this.state.error?.stack && (
              <div className="p-4 w-full rounded-md bg-muted overflow-auto mb-6 text-left">
                <pre className="text-xs text-muted-foreground whitespace-break-spaces">
                  {this.state.error.stack}
                </pre>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={this.handleReload}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium",
                  "bg-primary text-primary-foreground",
                  "hover:opacity-90 cursor-pointer"
                )}
              >
                <RotateCcw size={16} aria-hidden="true" />
                Reload page
              </button>
              <button
                onClick={this.handleGoHome}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium",
                  "border bg-background text-foreground",
                  "hover:bg-accent cursor-pointer"
                )}
              >
                <Home size={16} aria-hidden="true" />
                Go to dashboard
              </button>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;

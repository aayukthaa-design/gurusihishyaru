import React from 'react';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[AppErrorBoundary] Uncaught render error:', error, errorInfo);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
            <h1 className="text-lg font-semibold text-foreground">
              {this.props.fallbackTitle ?? 'Something went wrong'}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The application encountered an unexpected error. You can reload the page to try again.
            </p>
            {this.state.error?.message && (
              <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-left text-xs font-mono text-red-700 break-all dark:bg-red-950/30 dark:text-red-400">
                {this.state.error.message}
              </p>
            )}
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

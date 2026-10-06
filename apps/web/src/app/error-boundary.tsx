import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';
import { ErrorState } from '@/components/ui/display';
import { Button } from '@/components/ui/button';

/** Catches render errors so one broken widget never blanks the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV) console.error(error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <ErrorState title="This section failed to load" message={this.state.error.message} onRetry={() => this.setState({ error: null })} className="card" />
        )
      );
    }
    return this.props.children;
  }
}

/** Router-level error element (bad chunks, loader errors, 404s). */
export const RouteError = () => {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : 'Unexpected error';
  const isChunk = /dynamically imported module|Loading chunk/i.test(message);
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="card w-full max-w-lg">
        <ErrorState
          title={isChunk ? 'A new version is available' : 'Something went wrong'}
          message={isChunk ? 'Reload the page to continue.' : message}
          onRetry={() => window.location.reload()}
        />
        <div className="pb-8 text-center">
          <Link to="/">
            <Button variant="link">Go to dashboard</Button>
          </Link>
        </div>
      </div>
    </div>
  );
};

export const NotFoundPage = () => (
  <div className="card mx-auto mt-10 max-w-lg px-6 py-14 text-center">
    <p className="text-5xl font-bold text-brand-600">404</p>
    <h1 className="mt-4 text-lg font-semibold">Page not found</h1>
    <p className="mt-1 text-sm text-muted">The page you are looking for does not exist or was moved.</p>
    <Link to="/" className="mt-6 inline-block">
      <Button>Back to dashboard</Button>
    </Link>
  </div>
);

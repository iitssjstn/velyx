import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Logo } from './Logo';

interface State {
  error: Error | null;
}

/** Last-resort boundary: shows a friendly page instead of a blank screen or a raw stack trace. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Velyx UI error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center px-6">
        <div className="max-w-md text-center">
          <div className="mb-8 flex justify-center">
            <Logo />
          </div>
          <h1 className="font-display text-3xl font-semibold">Something went wrong.</h1>
          <p className="mt-3 text-muted">The page hit an unexpected problem. Reloading usually fixes it.</p>
          <div className="mt-6 flex justify-center gap-3">
            <button className="h-10 rounded-lg bg-accent px-4 font-semibold text-accent-ink" onClick={() => window.location.reload()}>
              Try again
            </button>
            <a className="grid h-10 place-items-center rounded-lg bg-raised px-4" href="/">
              Go home
            </a>
          </div>
        </div>
      </div>
    );
  }
}

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="gate">
          <h1>Something went wrong</h1>
          <p>This page could not be shown. Reload the portal and try again.</p>
          <button type="button" onClick={() => window.location.assign("/")}>
            Reload
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

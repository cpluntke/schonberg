import React from 'react';
import { logError } from '../errorlog';

interface State { error: Error | null }

/** Shows a friendly recovery screen instead of a blank page if a screen crashes. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    logError('render', error);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="screen" role="alert">
        <h1 className="hero">Something went wrong</h1>
        <p className="muted">
          This screen crashed. Your progress is saved. You can go back to Home, or reload the app.
          If it keeps happening, open Settings → Diagnostics and send the report to whoever set this up.
        </p>
        <pre className="small" style={{ whiteSpace: 'pre-wrap', background: 'var(--surface)', padding: 12, borderRadius: 10, maxHeight: 160, overflow: 'auto' }}>
          {String(this.state.error.message || this.state.error)}
        </pre>
        <div className="row">
          <a className="btn primary" href="#/" onClick={() => this.setState({ error: null })}>Home</a>
          <button className="btn" onClick={() => location.reload()}>Reload</button>
        </div>
      </main>
    );
  }
}

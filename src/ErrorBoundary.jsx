import React from "react";

/** Without this, any uncaught render error anywhere in the tree unmounts
    the whole app with nothing visible — no message, no way back, and the
    only evidence is a console error most people will never open. This
    has been the actual shape of several bug reports: "blank page," with
    the real cause only findable by someone who happened to check dev
    tools. Catching it here means a crash is at least legible and
    recoverable, and makes the next one of these much faster to diagnose
    from a screenshot alone. */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Render error caught by ErrorBoundary:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: "100vh", background: "#14161f", color: "#e8e0cd",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: 24, fontFamily: "'IBM Plex Mono', monospace", textAlign: "center" }}>
        <div style={{ fontSize: 15, marginBottom: 8 }}>Something went wrong.</div>
        <div style={{ fontSize: 11.5, color: "#9a937f", marginBottom: 20, maxWidth: 420 }}>
          {this.state.error?.message || String(this.state.error)}
        </div>
        <button onClick={() => window.location.reload()}
          style={{ background: "#e3a44f", color: "#241a08", border: "none", borderRadius: 6,
            padding: "10px 20px", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          Reload
        </button>
      </div>
    );
  }
}

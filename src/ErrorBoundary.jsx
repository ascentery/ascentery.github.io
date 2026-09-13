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
    this.state = { error: null, componentStack: "" };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Render error caught by ErrorBoundary:", error, info?.componentStack);
    this.setState({ componentStack: info?.componentStack || "" });
  }

  render() {
    if (!this.state.error) return this.props.children;
    // Shown directly on the page, not just logged to the console — this
    // is the one piece of information actually needed to fix a crash,
    // and asking someone to find it in dev tools has repeatedly been the
    // slow, error-prone part of diagnosing one of these.
    const details = [
      this.state.error?.stack || String(this.state.error),
      this.state.componentStack,
    ].filter(Boolean).join("\n");

    return (
      <div style={{ minHeight: "100vh", background: "#14161f", color: "#e8e0cd",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: 24, fontFamily: "'IBM Plex Mono', monospace", textAlign: "center" }}>
        <div style={{ fontSize: 15, marginBottom: 8 }}>Something went wrong.</div>
        <div style={{ fontSize: 11.5, color: "#9a937f", marginBottom: 16, maxWidth: 420 }}>
          {this.state.error?.message || String(this.state.error)}
        </div>
        <textarea readOnly value={details}
          onClick={(e) => e.target.select()}
          style={{ width: "min(640px, 92vw)", height: 220, marginBottom: 20, padding: 12,
            background: "#0c0e15", color: "#9a937f", border: "1px solid #2e3347", borderRadius: 6,
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, lineHeight: 1.5,
            textAlign: "left", resize: "vertical" }} />
        <button onClick={() => window.location.reload()}
          style={{ background: "#e3a44f", color: "#241a08", border: "none", borderRadius: 6,
            padding: "10px 20px", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
          Reload
        </button>
      </div>
    );
  }
}

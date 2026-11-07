import { Component } from "react";
import { C } from "../theme.js";
import { isChunkLoadError } from "../lib/lazyWithRetry.js";

// Catches a render error or a failed lazy chunk anywhere below it and shows a way out instead of a blank page (review FE-01).
// "Try again" re-renders the children (a transient failure usually passes); "Reload" fetches a fresh build.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (typeof this.props.onError === "function") this.props.onError(error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const stale = isChunkLoadError(error);
    return (
      <div
        role="alert"
        style={{
          minHeight: this.props.fullPage ? "100vh" : "40vh", display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", gap: 12, padding: 24, textAlign: "center", background: C.canvas, color: C.ink,
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>{stale ? "A newer version is available" : "Something went wrong"}</h2>
        <p style={{ margin: 0, maxWidth: 420, color: C.inkDim, fontSize: "0.95rem" }}>
          {stale
            ? "This page could not finish loading, usually because the site was just updated. Reloading gets you the latest version."
            : "This part of the page could not be shown. Your cart and account are safe. You can try again, or reload the page."}
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          {!stale && (
            <button type="button" onClick={this.reset} style={{ padding: "10px 18px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontWeight: 700, cursor: "pointer" }}>
              Try again
            </button>
          )}
          <button type="button" onClick={() => window.location.reload()} style={{ padding: "10px 18px", borderRadius: 10, border: "none", background: C.gold, color: C.darkBrown, fontWeight: 800, cursor: "pointer" }}>
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

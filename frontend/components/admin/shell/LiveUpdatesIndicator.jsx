import { D } from "../theme.js";

// "Live updates paused" (spec F2): only after 30 s without a live socket.
// Lists still refresh every minute meanwhile, so it informs, not alarms.
export default function LiveUpdatesIndicator({ paused }) {
  // The live region stays mounted so screen readers announce the change.
  return (
    <span role="status" aria-live="polite" title={paused ? "Reconnecting. Lists still refresh every minute." : undefined}
      style={paused ? { display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${D.amber}`, borderRadius: 999, padding: "3px 10px", fontSize: "0.66rem", fontWeight: 700, color: D.text, background: D.panelBg, whiteSpace: "nowrap" } : undefined}>
      {paused && <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: D.amber }} />}
      {paused ? "Live updates paused" : null}
    </span>
  );
}

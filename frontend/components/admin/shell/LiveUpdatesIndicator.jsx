import { D } from "../theme.js";

// "Live updates paused" (spec F2): only after 30 s without a live socket.
// Lists still refresh every minute meanwhile, so it informs, not alarms.
export default function LiveUpdatesIndicator({ paused }) {
  if (!paused) return null;
  return (
    <span role="status" title="Reconnecting. Lists still refresh every minute."
      style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${D.amber}`, borderRadius: 999, padding: "3px 10px", fontSize: "0.66rem", fontWeight: 700, color: D.text, background: "#fff", whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: D.amber }} />
      Live updates paused
    </span>
  );
}

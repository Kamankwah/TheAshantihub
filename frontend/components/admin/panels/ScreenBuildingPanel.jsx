import { D, glassCard } from "../theme.js";

// Marks a menu item whose approved screen is not built yet (the Operations
// menu is complete from the start; later packages swap their panel in). It
// shows no figures, only that the screen is on its way.
export default function ScreenBuildingPanel({ title }) {
  return (
    <div role="status" style={{ ...glassCard, padding: "40px 24px", textAlign: "center" }}>
      <div aria-hidden="true" style={{ fontSize: "2rem", marginBottom: 10 }}>🚧</div>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem", marginBottom: 4 }}>This screen is being built</div>
      <div style={{ color: D.textDim, fontSize: "0.78rem" }}>{title} will appear here. Nothing is lost: your other screens work as usual.</div>
    </div>
  );
}

import { D, glassCard } from "../theme.js";

// Titled glass container the analytics charts sit inside. Keeps the panel tidy
// and gives every chart the same header + optional right-side legend/aside +
// consistent empty-state slot.
export default function ChartFrame({ title, icon, aside, children, minHeight = 210 }) {
  return (
    <div style={{ ...glassCard, padding: "16px 18px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
        <div style={{ fontWeight: 800, color: D.text, fontSize: "0.82rem", letterSpacing: "0.01em" }}>
          {icon ? `${icon} ` : ""}{title}
        </div>
        {aside}
      </div>
      <div style={{ flex: 1, minHeight }}>{children}</div>
    </div>
  );
}

// Shared "not enough real data" empty state — used instead of a fabricated
// chart when a series has no backing rows yet (real-derived-only).
export function ChartEmpty({ children = "Not enough data yet." }) {
  return (
    <div style={{ height: "100%", minHeight: 160, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: D.textFaint, fontSize: "0.74rem", padding: 16 }}>
      {children}
    </div>
  );
}

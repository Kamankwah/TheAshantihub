import { D, glassCard } from "../theme.js";

// A single "mission-control" KPI stat card: glass surface, accent glow strip,
// icon, big value, label, and an optional sub-line / trend chip. Purely
// presentational — the panel computes the value and passes it in.
export default function KpiCard({ icon, label, value, sub, accent = D.gold, trend }) {
  return (
    <div style={{ ...glassCard, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
      {/* accent glow strip */}
      <div style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 3, background: accent, boxShadow: `0 0 16px ${accent}` }} />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: "1.35rem", filter: "saturate(1.2)" }}>{icon}</div>
        {trend != null && (
          <span style={{ background: `${accent}22`, color: accent, borderRadius: 20, padding: "2px 9px", fontSize: "0.6rem", fontWeight: 800, whiteSpace: "nowrap" }}>{trend}</span>
        )}
      </div>
      <div style={{ fontWeight: 900, fontSize: "1.5rem", color: D.text, marginTop: 8, lineHeight: 1.1, letterSpacing: "-0.01em" }}>{value}</div>
      <div style={{ fontSize: "0.68rem", fontWeight: 700, color: D.textDim, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      {sub && <div style={{ fontSize: "0.66rem", color: D.textFaint, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

import { D } from "../theme.js";
import { ChartEmpty } from "./ChartFrame.jsx";

// Plan-entitlement usage meters: how much of the subscription's real
// entitlements (max_active_listings / hero_days / boost_credits_per_month) the
// owner is using. `data` = [{ label, used, limit, unit, color }]. A `limit` of
// null/undefined means "unlimited" (renders a full-width ambient bar). All
// values are real: `used` derived from listings/hero state, `limit` from the
// plan. Rendered as labelled progress meters rather than a recharts bar because
// "X of Y used" reads clearest that way.
export default function UsageMeters({ data }) {
  const rows = (data || []).filter(Boolean);
  if (rows.length === 0) {
    return <ChartEmpty>Subscribe to a plan to see your entitlement usage.</ChartEmpty>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 4 }}>
      {rows.map((r) => {
        const unlimited = r.limit == null;
        const pct = unlimited ? 100 : Math.min(100, r.limit === 0 ? 0 : Math.round((r.used / r.limit) * 100));
        const color = r.color || D.gold;
        const over = !unlimited && r.used > r.limit;
        return (
          <div key={r.label}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
              <span style={{ fontSize: "0.72rem", fontWeight: 700, color: D.text }}>{r.label}</span>
              <span style={{ fontSize: "0.7rem", color: over ? D.red : D.textDim, fontWeight: 700 }}>
                {r.used}{unlimited ? "" : ` / ${r.limit}`}{r.unit ? ` ${r.unit}` : ""}{unlimited ? " (unlimited)" : ""}
              </span>
            </div>
            <div style={{ height: 8, background: D.panelBg2, borderRadius: 10, overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${pct}%`, borderRadius: 10,
                background: unlimited
                  ? `linear-gradient(90deg, ${color}55, ${color}22)`
                  : `linear-gradient(90deg, ${over ? D.red : color}, ${color}aa)`,
                boxShadow: `0 0 12px ${(over ? D.red : color)}66`,
                transition: "width 0.6s ease",
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

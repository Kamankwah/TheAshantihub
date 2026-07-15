import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { D } from "../theme.js";
import { ChartEmpty } from "./ChartFrame.jsx";

// Donut of listings by status. `data` = [{ name:"Published", value:3, color }].
// Zero-value slices are filtered out. Renders a centered total.
export default function ListingsDonut({ data }) {
  const slices = (data || []).filter((d) => d.value > 0);
  const total = slices.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return <ChartEmpty>You don&apos;t have any listings yet.</ChartEmpty>;
  }
  return (
    <div style={{ position: "relative", width: "100%", height: 210 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            contentStyle={{ background: D.panelSolid, border: `1px solid ${D.cardBorder}`, borderRadius: 10, color: D.text, fontSize: 12 }}
            formatter={(v, n) => [v, n]}
          />
          <Pie data={slices} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={3} stroke="none">
            {slices.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {/* center total overlay */}
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{ fontWeight: 900, fontSize: "1.7rem", color: D.text, lineHeight: 1 }}>{total}</div>
        <div style={{ fontSize: "0.6rem", color: D.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>Listings</div>
      </div>
    </div>
  );
}

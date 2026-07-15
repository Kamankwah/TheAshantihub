import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, ResponsiveContainer } from "recharts";
import { D, CHART } from "../theme.js";
import { ChartEmpty } from "./ChartFrame.jsx";

// Horizontal bars of each credit-score factor's contribution (score_pct 0–100),
// from GET /api/credit/scores/me/'s `factors`. `data` = [{ label, pct, color }].
export default function FactorBars({ data }) {
  const rows = (data || []).filter((d) => d && d.label);
  if (rows.length === 0) return <ChartEmpty>No score factors yet.</ChartEmpty>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, rows.length * 46)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid stroke={CHART.grid} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={{ fill: CHART.axis, fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
        <YAxis type="category" dataKey="label" tick={{ fill: D.textDim, fontSize: 11 }} axisLine={false} tickLine={false} width={120} />
        <Tooltip
          cursor={{ fill: "rgba(212,160,23,0.08)" }}
          contentStyle={{ background: D.panelSolid, border: `1px solid ${D.cardBorder}`, borderRadius: 10, color: D.text, fontSize: 12 }}
          formatter={(v) => [`${Math.round(v)}%`, "Strength"]}
        />
        <Bar dataKey="pct" radius={[0, 6, 6, 0]} barSize={16}>
          {rows.map((d, i) => <Cell key={i} fill={d.color || CHART.c1} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

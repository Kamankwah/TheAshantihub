import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { D, CHART, ghs } from "../theme.js";
import { ChartEmpty } from "./ChartFrame.jsx";

// Monthly "AshantiHub spend" area chart. IMPORTANT (honesty): the owner's
// transactions are money they PAID AshantiHub (subscriptions + promotions) — an
// owner has no transaction row for sales of their listings (order payments are
// customer-scoped, business_owner=None). So this is spend, deliberately NOT
// labeled "revenue". `data` = [{ month:"Feb", amount:120 }, ...] already bucketed
// by the panel.
export default function SpendAreaChart({ data }) {
  const hasData = Array.isArray(data) && data.some((d) => d.amount > 0);
  if (!hasData) {
    return <ChartEmpty>No payments recorded yet — your subscription &amp; promotion spend will chart here.</ChartEmpty>;
  }
  return (
    <ResponsiveContainer width="100%" height={210}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
        <defs>
          <linearGradient id="ccSpendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART.c1} stopOpacity={0.55} />
            <stop offset="100%" stopColor={CHART.c1} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="month" tick={{ fill: CHART.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: CHART.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
        <Tooltip
          cursor={{ stroke: D.gold, strokeOpacity: 0.3 }}
          contentStyle={{ background: D.panelSolid, border: `1px solid ${D.cardBorder}`, borderRadius: 10, color: D.text, fontSize: 12 }}
          labelStyle={{ color: D.textDim }}
          formatter={(v) => [ghs(v), "Spend"]}
        />
        <Area type="monotone" dataKey="amount" stroke={CHART.c1} strokeWidth={2.5} fill="url(#ccSpendFill)"
          dot={{ r: 3, fill: CHART.c1, strokeWidth: 0 }} activeDot={{ r: 5 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

import { useState } from "react";
import { useRevenue } from "../../../hooks/useInsights.js";
import { D } from "../theme.js";
import { dim } from "./panelStyles.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { errorStyle, money } from "./portfolioParts.jsx";
import { ExportBar, Kpi, NotRecorded, Select, ShareBar, SimulatedBanner, Status, Title, isoDay, kpiGrid, page, percent, section, sectionTitle } from "./insightsParts.jsx";

// ─── Super Admin 01 Revenue & sales ──────────────────────────────────────────
// Sales are what customers paid businesses; revenue is what AshantiHub kept. Both
// are counted from successful payments (simulated until Hubtel). Commission on
// sales, delivery fees and VAT have no record, so they are listed as not recorded
// instead of drawn as rows.
const TYPE_COLORS = { subscriptions: "#B8860B", promotions: "#3949AB", hero: "#1E7B3A", event_fees: "#8A5FA8" };
const PERIODS = [
  ["month", "This month so far"],
  ["last", "Last month"],
  ["six", "Last 6 months"],
];

export function periodRange(kind, today = new Date()) {
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  if (kind === "last") return { from: isoDay(new Date(today.getFullYear(), today.getMonth() - 1, 1)), to: isoDay(new Date(today.getFullYear(), today.getMonth(), 0)) };
  if (kind === "six") return { from: isoDay(new Date(today.getFullYear(), today.getMonth() - 5, 1)), to: isoDay(today) };
  return { from: isoDay(first), to: isoDay(today) };
}

export default function RevenueSalesPanel() {
  const [kind, setKind] = useState("month");
  const [zone, setZone] = useState("");
  const [category, setCategory] = useState("");
  const [exportError, setExportError] = useState("");
  const range = periodRange(kind);
  const params = { ...range, zone, category };
  const { data, isLoading, isError } = useRevenue(params);
  const k = data?.kpis;
  const longest = Math.max(1, ...(data?.months || []).map((m) => Number(m.total)));
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();

  return (
    <div style={page}>
      <Title right={data && <ExportBar path={`/api/insights/revenue/?${qs}`} stem={`ashantihub-revenue-${range.from}-${range.to}`} onError={setExportError} />}>Revenue &amp; sales</Title>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>
          Period
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", background: D.panelBg, color: D.text }}>
            {PERIODS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <Select label="Zone" value={zone} onChange={setZone} options={data?.zone_options || []} allLabel="All zones" />
        <Select label="Category" value={category} onChange={setCategory} options={data?.category_options || []} allLabel="All categories" />
      </div>
      {exportError && <div role="alert" style={errorStyle}>{exportError}</div>}
      <SimulatedBanner simulated={data?.simulated}>Sales and revenue below are what the records show from simulated payments; no real money has moved yet.</SimulatedBanner>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <div style={kpiGrid}>
              <Kpi label="Sales" value={money(k.sales)} sub="Orders, bookings, service requests and tickets" />
              <Kpi label="AshantiHub revenue" value={money(k.revenue)} sub={k.revenue_share === null ? "No sales in this period" : `${k.revenue_share}% of sales`} />
              <Kpi label="Orders, bookings & tickets" value={k.orders.toLocaleString("en-GB")} sub={k.average ? `Average ${money(k.average)}` : "No sales in this period"} />
              <Kpi label="Refunded" value={money(k.refunded)} sub={`${k.refunds} recorded refund${k.refunds === 1 ? "" : "s"}${k.refund_share === null ? "" : ` · ${k.refund_share}% of sales`}`} />
            </div>

            <section aria-labelledby="by-month" style={section}>
              <h3 id="by-month" style={sectionTitle}>AshantiHub revenue by month</h3>
              <span style={dim}>Revenue is what AshantiHub keeps: plan fees, paid promotions, hero placements and event fees. Sales paid to businesses are not revenue. The table holds the same numbers.</span>
              <div style={scroll}>
                <table style={table}>
                  <thead><tr><th scope="col" style={th}>Month</th>{data.types.map((t) => <th key={t.key} scope="col" style={th}>{t.label}</th>)}<th scope="col" style={th}>Total</th><th scope="col" style={th}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Bar</span></th></tr></thead>
                  <tbody>
                    {data.months.map((m) => (
                      <tr key={m.month}>
                        <td style={td}>{m.label}{m.partial ? <span style={dim}> · {m.days} days so far</span> : null}</td>
                        {data.types.map((t) => <td key={t.key} style={{ ...td, ...figures }}>{money(m.by_type[t.key])}</td>)}
                        <td style={{ ...td, ...figures, fontWeight: 800 }}>{money(m.total)}</td>
                        <td style={{ ...td, minWidth: 120 }}><ShareBar share={Number(m.total) / longest} label={`${m.label} revenue ${money(m.total)}`} color={m.partial ? "#E3C27A" : D.gold} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="by-type" style={section}>
              <h3 id="by-type" style={sectionTitle}>Revenue by type</h3>
              <div style={scroll}>
                <table style={table}>
                  <thead><tr><th scope="col" style={th}>Type</th><th scope="col" style={th}>{data.from} to {data.to}</th><th scope="col" style={th}>Before it ({data.previous.from} to {data.previous.to})</th></tr></thead>
                  <tbody>
                    {data.types.map((t) => (
                      <tr key={t.key}>
                        <td style={td}><span aria-hidden style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: TYPE_COLORS[t.key], marginRight: 6 }} />{t.label}<div style={dim}>{t.note}</div></td>
                        <td style={{ ...td, ...figures }}>{money(t.amount)}</td>
                        <td style={{ ...td, ...figures }}>{money(t.previous)}</td>
                      </tr>
                    ))}
                    <tr><td style={{ ...td, fontWeight: 800 }}>Total</td><td style={{ ...td, ...figures, fontWeight: 800 }}>{money(k.revenue)}</td><td style={{ ...td, ...figures, fontWeight: 800 }}>{money(data.types.reduce((sum, t) => sum + Number(t.previous), 0))}</td></tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section aria-labelledby="by-zone" style={section}>
              <h3 id="by-zone" style={sectionTitle}>By zone</h3>
              {data.zones.length === 0 ? <span style={dim}>No sales or revenue in this period.</span> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Zone", "Sales", "Orders", "AshantiHub revenue", "Verified businesses"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {data.zones.map((z) => (
                        <tr key={z.zone_id ?? "none"}><td style={td}>{z.zone}</td><td style={{ ...td, ...figures }}>{money(z.sales)}</td><td style={{ ...td, ...figures }}>{z.orders}</td><td style={{ ...td, ...figures }}>{money(z.revenue)}</td><td style={{ ...td, ...figures }}>{z.businesses}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section aria-labelledby="by-category" style={section}>
              <h3 id="by-category" style={sectionTitle}>Sales by category</h3>
              {data.categories.length === 0 ? <span style={dim}>No sales in this period.</span> : data.categories.map((c) => (
                <div key={c.category_id ?? "none"} style={{ display: "grid", gridTemplateColumns: "minmax(120px, 1fr) 2fr auto", gap: 10, alignItems: "center", fontSize: "0.8rem", color: D.text }}>
                  <span>{c.category}</span>
                  <ShareBar share={c.share} label={`${c.category} sales ${money(c.sales)}`} />
                  <span style={figures}>{money(c.sales)} <span style={dim}>· {c.orders}</span></span>
                </div>
              ))}
            </section>

            <NotRecorded title="Not recorded" items={data.not_recorded} />
          </>
        )}
      </Status>
    </div>
  );
}

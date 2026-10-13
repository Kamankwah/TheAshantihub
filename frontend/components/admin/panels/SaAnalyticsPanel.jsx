import { useState } from "react";
import { useSaAnalytics } from "../../../hooks/useInsights.js";
import { D } from "../theme.js";
import { dim } from "./panelStyles.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { errorStyle, money } from "./portfolioParts.jsx";
import { ExportBar, Kpi, NotRecorded, Select, ShareBar, SimulatedBanner, Status, Title, kpiGrid, page, percent, section, sectionTitle } from "./insightsParts.jsx";

// ─── Super Admin 06 Analytics ────────────────────────────────────────────────
// Real counts only: nothing is estimated, sampled or typed in. Sales come from
// simulated payments until Hubtel is connected. "Active businesses" are verified
// (KYC approved), not suspended businesses registered by the month's end; what has
// no data (site visits, satisfaction, on-time rate, acquisition source) sits under
// "Not measured yet".
export default function SaAnalyticsPanel() {
  const [zone, setZone] = useState("");
  const [exportError, setExportError] = useState("");
  const { data, isLoading, isError } = useSaAnalytics({ zone });
  const biggest = Math.max(1, ...(data?.months || []).map((m) => Number(m.gmv)));
  const k = data?.kpis;
  return (
    <div style={page}>
      <Title right={data && <ExportBar path="/api/insights/analytics/" stem="ashantihub-analytics" onError={setExportError} />}>Analytics</Title>
      <Select label="Zone" value={zone} onChange={setZone} options={data?.zone_options || []} allLabel="All zones" />
      {exportError && <div role="alert" style={errorStyle}>{exportError}</div>}
      <div role="note" style={{ ...dim, lineHeight: 1.5 }}>Real counts only. Every number is counted from records — nothing is estimated, sampled or typed in.</div>
      <SimulatedBanner simulated={data?.simulated}>Sales come from simulated payments.</SimulatedBanner>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <div style={kpiGrid}>
              <Kpi label="Verified businesses" value={k.businesses.toLocaleString("en-GB")} sub="KYC approved and not suspended" />
              <Kpi label="Customers" value={k.customers.toLocaleString("en-GB")} sub={`${k.customers_ordered_90} bought in the last 90 days`} />
              <Kpi label="Orders, bookings & tickets" value={k.orders.toLocaleString("en-GB")} sub="This month so far" />
              <Kpi label="GMV" value={money(k.gmv)} sub="This month so far" />
              <Kpi label="Repeat rate" value={percent(k.repeat_rate)} sub={k.buyers ? `${k.repeaters} of ${k.buyers} bought more than once` : "Nobody bought in the last 90 days"} />
              <Kpi label="Listings live" value={k.listings_live.toLocaleString("en-GB")} sub={`Across ${k.categories_live} categories`} />
            </div>
            <section aria-labelledby="gmv" style={section}>
              <h3 id="gmv" style={sectionTitle}>Month by month</h3>
              <div style={scroll}>
                <table style={table}>
                  <thead><tr>{["Month", "Verified businesses", "New customers", "Orders", "GMV", "Repeat rate"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}<th scope="col" style={th}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Bar</span></th></tr></thead>
                  <tbody>
                    {data.months.map((m) => (
                      <tr key={m.month}>
                        <td style={td}>{m.label}{m.partial && <span style={dim}> · {m.days} days so far</span>}</td>
                        <td style={{ ...td, ...figures }}>{m.businesses}</td>
                        <td style={{ ...td, ...figures }}>{m.customers}</td>
                        <td style={{ ...td, ...figures }}>{m.orders}</td>
                        <td style={{ ...td, ...figures, fontWeight: 800 }}>{money(m.gmv)}</td>
                        <td style={{ ...td, ...figures }}>{percent(m.repeat_rate)}</td>
                        <td style={{ ...td, minWidth: 110 }}><ShareBar share={Number(m.gmv) / biggest} label={`${m.label} GMV ${money(m.gmv)}`} color={m.partial ? "#E3C27A" : D.gold} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <span style={dim}>Repeat rate: of the customers who bought in the 90 days to the month's end, the share who had bought more than once. Orders include bookings, service requests and event tickets.</span>
            </section>
            <section aria-labelledby="zones" style={section}>
              <h3 id="zones" style={sectionTitle}>By zone</h3>
              <span style={dim}>Orders and GMV: this month so far · buyers: last 90 days</span>
              {data.zones.length === 0 ? <span style={dim}>Nothing to show for this zone yet.</span> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Zone", "Verified businesses", "Buyers", "Orders", "GMV", "Repeat rate"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {data.zones.map((z) => (
                        <tr key={z.zone_id ?? "none"}><td style={td}>{z.zone}</td><td style={{ ...td, ...figures }}>{z.businesses}</td><td style={{ ...td, ...figures }}>{z.buyers}</td><td style={{ ...td, ...figures }}>{z.orders}</td><td style={{ ...td, ...figures }}>{money(z.gmv)}</td><td style={{ ...td, ...figures }}>{percent(z.repeat_rate)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <span style={dim}>A customer who buys in two zones counts as a buyer in both.</span>
            </section>
            <NotRecorded title="Not measured yet" items={data.not_measured} />
          </>
        )}
      </Status>
    </div>
  );
}

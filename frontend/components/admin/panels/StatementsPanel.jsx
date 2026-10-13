import { useState } from "react";
import { useRevenue } from "../../../hooks/useInsights.js";
import { D } from "../theme.js";
import { dim, field } from "./panelStyles.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { errorStyle, money } from "./portfolioParts.jsx";
import { ExportBar, NotRecorded, SimulatedBanner, Status, Title, page, section, sectionTitle } from "./insightsParts.jsx";
import { periodRange } from "./RevenueSalesPanel.jsx";

// ─── Accounting 30 Statements ────────────────────────────────────────────────
// A profit and loss, balance sheet and cash flow need a ledger, which does not
// exist. What is real is revenue by type, before tax, from successful payments:
// that is all this screen shows, for a chosen period, with the existing export.
const PERIODS = [["month", "This month so far"], ["last", "Last month"], ["six", "Last 6 months"]];

export default function StatementsPanel() {
  const [kind, setKind] = useState("month");
  const [exportError, setExportError] = useState("");
  const range = periodRange(kind);
  const { data, isLoading, isError } = useRevenue(range);
  const qs = new URLSearchParams(range).toString();
  return (
    <div style={page}>
      <Title right={data && <ExportBar path={`/api/insights/revenue/?${qs}`} stem={`ashantihub-revenue-${range.from}-${range.to}`} onError={setExportError} />}>Statements</Title>
      <div role="note" style={{ ...dim, lineHeight: 1.5 }}>
        Profit and loss, the balance sheet and cash flow arrive with the Accounting phase: they need a ledger, and none exists. Below is the one statement the records support.
      </div>
      <label style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text, display: "flex", flexDirection: "column", gap: 2, alignSelf: "flex-start" }}>Period
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={field}>{PERIODS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      </label>
      {exportError && <div role="alert" style={errorStyle}>{exportError}</div>}
      <SimulatedBanner simulated={data?.simulated}>Revenue below comes from simulated payments.</SimulatedBanner>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <section aria-labelledby="st-rev" style={section}>
            <h3 id="st-rev" style={sectionTitle}>Revenue by type, before tax</h3>
            <div style={scroll}>
              <table style={table}>
                <thead><tr><th scope="col" style={th}>Type</th><th scope="col" style={th}>What it is</th><th scope="col" style={{ ...th, textAlign: "right" }}>Amount</th><th scope="col" style={{ ...th, textAlign: "right" }}>Previous period</th></tr></thead>
                <tbody>
                  {data.types.map((t) => (
                    <tr key={t.key}><td style={{ ...td, fontWeight: 800 }}>{t.label}</td><td style={td}>{t.note}</td><td style={{ ...td, ...figures, textAlign: "right" }}>{money(t.amount)}</td><td style={{ ...td, ...figures, textAlign: "right" }}>{money(t.previous)}</td></tr>
                  ))}
                  <tr><td style={{ ...td, fontWeight: 800 }} colSpan={2}>Total revenue</td><td style={{ ...td, ...figures, textAlign: "right", fontWeight: 800 }}>{money(data.kpis.revenue)}</td><td style={td} /></tr>
                </tbody>
              </table>
            </div>
          </section>
        )}
      </Status>
      <NotRecorded title="Not available yet" items={[
        { name: "Costs and profit", why: "No expense is recorded, so no profit or loss can be worked out." },
        { name: "Balance sheet", why: "Assets, liabilities and equity need a chart of accounts and a ledger." },
        { name: "Cash flow", why: "No bank or mobile money account is connected." },
      ]} />
    </div>
  );
}

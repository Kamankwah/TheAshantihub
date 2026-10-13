import { useState } from "react";
import { useRefunds } from "../../../hooks/useInsights.js";
import { D } from "../theme.js";
import { chip, dim } from "./panelStyles.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { errorStyle, money } from "./portfolioParts.jsx";
import { ExportBar, Kpi, NotRecorded, SimulatedBanner, Status, Title, kpiGrid, page, section, sectionTitle } from "./insightsParts.jsx";
import { periodRange } from "./RevenueSalesPanel.jsx";

// ─── Super Admin 04 Refunds ──────────────────────────────────────────────────
// Read-only list of the refunds that are actually recorded: disputes resolved with
// a refund amount, and event tickets refunded by staff. There is no refund
// request, approval step, threshold or "paid from" record yet (Accounting phase),
// so none is shown and nothing here can be approved.
const SOURCES = [["all", "All sources"], ["dispute", "Dispute"], ["ticket", "Event ticket"]];
const PERIODS = [["month", "This month so far"], ["last", "Last month"]];
const when = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function RefundsPanel() {
  const [source, setSource] = useState("all");
  const [kind, setKind] = useState("month");
  const [exportError, setExportError] = useState("");
  const range = periodRange(kind);
  const params = { ...range, source };
  const { data, isLoading, isError } = useRefunds(params);
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v && v !== "all")).toString();
  const select = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", background: D.panelBg, color: D.text };

  return (
    <div style={page}>
      <Title right={data && <ExportBar path={`/api/insights/refunds/?${qs}`} stem={`ashantihub-refunds-${range.from}-${range.to}`} onError={setExportError} />}>Refunds</Title>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text, display: "flex", flexDirection: "column", gap: 2 }}>Source
          <select value={source} onChange={(e) => setSource(e.target.value)} style={select}>{SOURCES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        </label>
        <label style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text, display: "flex", flexDirection: "column", gap: 2 }}>Period
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={select}>{PERIODS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        </label>
      </div>
      {exportError && <div role="alert" style={errorStyle}>{exportError}</div>}
      <SimulatedBanner simulated={data?.simulated}>A refund here is a recorded return of money to the customer; no money moves yet. The file includes customer names, so it asks for your password.</SimulatedBanner>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <div style={kpiGrid}>
              <Kpi label="Refunded" value={money(data.kpis.refunded)} sub={`${data.kpis.count} recorded refund${data.kpis.count === 1 ? "" : "s"}${data.kpis.share_of_sales === null ? "" : ` · ${data.kpis.share_of_sales}% of sales`}`} />
              <Kpi label="From disputes" value={money(data.kpis.from_disputes)} sub={`${data.kpis.disputes} resolved with a refund`} />
              <Kpi label="From event tickets" value={money(data.kpis.from_tickets)} sub={`${data.kpis.tickets} refunded`} />
            </div>
            <section aria-labelledby="all-refunds" style={section}>
              <h3 id="all-refunds" style={sectionTitle}>All recorded refunds</h3>
              {data.rows.length === 0 ? <span style={dim}>No refunds were recorded in this period.</span> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Refund", "Customer · business", "Source", "Raised by", "Decided by", "Date", "Amount", "Status"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {data.rows.map((r) => (
                        <tr key={r.ref}>
                          <td style={{ ...td, fontWeight: 800 }}>{r.ref}</td>
                          <td style={td}>{r.customer || "Not recorded"}<div style={dim}>{r.business}</div></td>
                          <td style={td}>{r.source_label}<div style={dim}>{r.detail}</div></td>
                          <td style={td}>{r.raised_by || "Not recorded"}</td>
                          <td style={td}>{r.decided_by || "Not recorded"}</td>
                          <td style={td}>{when(r.at)}</td>
                          <td style={{ ...td, ...figures, fontWeight: 800 }}>{money(r.amount)}</td>
                          <td style={td}><span style={chip(D.green)}>Refunded</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <NotRecorded title="Not recorded" items={data.not_recorded} />
          </>
        )}
      </Status>
    </div>
  );
}

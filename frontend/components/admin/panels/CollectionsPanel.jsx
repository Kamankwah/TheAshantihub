import { useState } from "react";
import { useCollections } from "../../../hooks/useInsights.js";
import { D } from "../theme.js";
import { button, chip, dim, field } from "./panelStyles.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { errorStyle, money } from "./portfolioParts.jsx";
import { ExportBar, Kpi, NotRecorded, SimulatedBanner, Status, Title, kpiGrid, page, section, sectionTitle } from "./insightsParts.jsx";
import { periodRange } from "./RevenueSalesPanel.jsx";

// ─── Accounting 07 Collections ───────────────────────────────────────────────
// Every incoming payment attempt, from payments.CheckoutSession, with our
// reference and the provider's (simulated until Hubtel). There is no delivery
// fee, tax split or escrow state on a payment, so the screen shows none and says so.
const PERIODS = [["month", "This month so far"], ["last", "Last month"], ["six", "Last 6 months"]];
const STATUS_LABEL = { success: "Paid", pending: "Pending", failed: "Failed", expired: "Expired" };
const STATUS_COLOR = { success: D.green, pending: D.amber, failed: D.red, expired: D.textFaint };
const when = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function CollectionsPanel() {
  const [period, setPeriod] = useState("month");
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [pageNo, setPageNo] = useState(1);
  const [exportError, setExportError] = useState("");
  const range = periodRange(period);
  const params = { ...range, kind, status, q: search.trim(), page: pageNo > 1 ? pageNo : undefined };
  const { data, isLoading, isError } = useCollections(params);
  const qs = new URLSearchParams(Object.entries({ ...params, page: undefined }).filter(([, v]) => v)).toString();
  const change = (setter) => (event) => { setter(event.target.value); setPageNo(1); };
  const lastPage = data ? Math.max(1, Math.ceil(data.count / data.page_size)) : 1;
  const label = (text, control) => <label style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text, display: "flex", flexDirection: "column", gap: 2 }}>{text}{control}</label>;

  return (
    <div style={page}>
      <Title right={data && <ExportBar path={`/api/insights/collections/?${qs}`} stem={`ashantihub-collections-${range.from}-${range.to}`} onError={setExportError} />}>Collections</Title>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        {label("Period", <select value={period} onChange={change(setPeriod)} style={field}>{PERIODS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>)}
        {label("Type", <select value={kind} onChange={change(setKind)} style={field}><option value="">All types</option>{(data?.types || []).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>)}
        {label("Status", <select value={status} onChange={change(setStatus)} style={field}><option value="">All statuses</option>{Object.entries(STATUS_LABEL).map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>)}
        {label("Search", <input type="search" value={search} onChange={change(setSearch)} placeholder="Payer, reference or what for" style={{ ...field, minWidth: 200 }} />)}
      </div>
      {exportError && <div role="alert" style={errorStyle}>{exportError}</div>}
      <SimulatedBanner simulated={data?.simulated}>Provider references below are simulated. The file names payers, so it asks for your password.</SimulatedBanner>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <div style={kpiGrid}>
              {data.summary.map((s) => <Kpi key={s.key} label={s.label} value={money(s.amount)} sub={`${s.count} paid payment${s.count === 1 ? "" : "s"}`} />)}
            </div>
            <section aria-labelledby="col-rows" style={section}>
              <h3 id="col-rows" style={sectionTitle}>Payments ({data.count})</h3>
              {data.rows.length === 0 ? <span style={dim}>No payments match.</span> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["When", "Type", "Payer", "What for", "Our reference", "Provider reference", "Status", "Amount"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {data.rows.map((r) => (
                        <tr key={r.id}>
                          <td style={td}>{when(r.at)}</td>
                          <td style={td}>{r.type_label}</td>
                          <td style={td}>{r.payer || "Not recorded"}</td>
                          <td style={td}>{r.what}</td>
                          <td style={{ ...td, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: "0.72rem" }}>{r.reference}</td>
                          <td style={{ ...td, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: "0.72rem" }}>{r.provider_reference ? `${r.provider_reference} (${r.provider})` : "None"}</td>
                          <td style={td}><span style={chip(STATUS_COLOR[r.status])}>{STATUS_LABEL[r.status] || r.status}</span></td>
                          <td style={{ ...td, ...figures, fontWeight: 800 }}>{money(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {lastPage > 1 && (
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button type="button" disabled={pageNo <= 1} onClick={() => setPageNo((n) => n - 1)} style={button(D.panelBg, D.text, pageNo <= 1)}>Previous</button>
                  <span style={dim}>Page {pageNo} of {lastPage}</span>
                  <button type="button" disabled={pageNo >= lastPage} onClick={() => setPageNo((n) => n + 1)} style={button(D.panelBg, D.text, pageNo >= lastPage)}>Next</button>
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

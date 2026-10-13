import { useState } from "react";
import { apiDownload } from "../../../apiClient.js";
import { useAccrualLines, useCommissionsOverview } from "../../../hooks/useInsights.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, chip, dim, field } from "./panelStyles.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { errorStyle, money } from "./portfolioParts.jsx";
import { ExportBar, Kpi, SimulatedBanner, Status, Title, kpiGrid, page, section, sectionTitle } from "./insightsParts.jsx";

// ─── Super Admin 03 Commissions ──────────────────────────────────────────────
// What scouts have earned, from CommissionAccrual and the commission policy in
// force. "In a batch" and "Paid" stay empty until payout batches exist (Accounting
// phase), and the screen says so instead of drawing a zero; the tax note stays
// undecided until a ruling is recorded.
const STATUS_COLORS = { on_hold: D.textDim, payable: D.blue, in_batch: D.amber, paid: D.green, reversed: D.red };
const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const STATUSES = [["", "All"], ["on_hold", "On hold"], ["payable", "Payable"], ["in_batch", "In batch"], ["paid", "Paid"], ["reversed", "Reversed"]];
const KINDS = [["", "Both kinds"], ["registration", "Registration"], ["three_paid_months_bonus", "Paid-months bonus"]];

export default function CommissionsPanel({ onNavigate }) {
  const overview = useCommissionsOverview();
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [staff, setStaff] = useState("");
  const [page_, setPage] = useState(1);
  const lines = useAccrualLines({ status, kind, staff, page: page_ > 1 ? page_ : undefined });
  const [error, setError] = useState("");
  const data = overview.data;
  const t = data?.totals;

  const statement = async (row) => {
    setError("");
    try {
      await apiDownload(`/api/insights/commissions/statement/?staff=${row.staff_id}&format=pdf`, `commission-statement-${row.name}.pdf`);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not export the statement."));
    }
  };
  const pick = (setter) => (event) => { setter(event.target.value); setPage(1); };
  const kpi = (key, label, empty) => (
    <Kpi label={label} value={t[key].count === 0 && empty ? "None yet" : (key === "reversed" && t[key].count ? "− " : "") + money(t[key].amount)} sub={t[key].count === 0 && empty ? empty : `${t[key].count} accrual${t[key].count === 1 ? "" : "s"}`} />
  );

  return (
    <div style={page}>
      <Title right={<ExportBar path="/api/insights/commissions/statement/" stem="ashantihub-commission-statements" onError={setError} label="Export statements" />}>Commissions</Title>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <SimulatedBanner simulated={data?.simulated}>No payout has happened: scouts never handle cash, and "Paid" will mean a payout you approved was recorded. Statements show scouts' earnings, so they ask for your password.</SimulatedBanner>
      <Status isLoading={overview.isLoading} isError={overview.isError}>
        {data && (
          <>
            <section aria-labelledby="policy" style={section}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <h3 id="policy" style={sectionTitle}>Policy in force</h3>
                {onNavigate && <button type="button" onClick={() => onNavigate("commission-policy")} style={button(D.panelBg, D.text)}>Commission policy</button>}
              </div>
              <div style={kpiGrid}>
                {Object.entries(data.policy).map(([key, p]) => (
                  <Kpi key={key} label={p.label} value={p.amount ? money(p.amount) : "No amount approved"} sub={p.since ? `Since ${day(p.since)}` : "Nothing accrues until one is approved"} />
                ))}
                <Kpi label="Hold" value="90 days" sub="Then payable; batching arrives with Accounting" />
              </div>
            </section>

            <div style={kpiGrid}>
              {kpi("on_hold", "On hold")}
              {kpi("payable", "Payable")}
              {kpi("in_batch", "In a payout batch", "No payout batches exist yet")}
              {kpi("paid", "Paid", "No payouts recorded yet")}
              {kpi("reversed", "Reversed")}
            </div>
            <div role="note" style={{ ...dim, lineHeight: 1.5 }}>{data.batches.note}</div>

            <section aria-labelledby="by-scout" style={section}>
              <h3 id="by-scout" style={sectionTitle}>By scout</h3>
              {data.scouts.length === 0 ? <span style={dim}>No scout has a commission record yet.</span> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Scout", "On hold", "Payable", "In batch", "Paid", "Reversed", "Statement"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {data.scouts.map((s) => (
                        <tr key={s.staff_id}>
                          <td style={{ ...td, fontWeight: 800 }}>{s.name}{!s.active && <div style={dim}>No longer active</div>}</td>
                          <td style={{ ...td, ...figures }}>{money(s.on_hold)}</td>
                          <td style={{ ...td, ...figures }}>{money(s.payable)}</td>
                          <td style={{ ...td, ...figures }}>{Number(s.in_batch) ? money(s.in_batch) : "None yet"}</td>
                          <td style={{ ...td, ...figures }}>{Number(s.paid) ? money(s.paid) : "None yet"}</td>
                          <td style={{ ...td, ...figures, color: Number(s.reversed) ? D.red : undefined }}>{Number(s.reversed) ? `− ${money(s.reversed)}` : money(0)}</td>
                          <td style={td}><button type="button" aria-label={`Statement for ${s.name}`} onClick={() => statement(s)} style={button(D.panelBg, D.text)}>Statement</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section aria-labelledby="accruals" style={section}>
              <h3 id="accruals" style={sectionTitle}>Accruals</h3>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <label style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text, display: "flex", flexDirection: "column", gap: 2 }}>Status
                  <select value={status} onChange={pick(setStatus)} style={field}>{STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
                </label>
                <label style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text, display: "flex", flexDirection: "column", gap: 2 }}>Kind
                  <select value={kind} onChange={pick(setKind)} style={field}>{KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
                </label>
                <label style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text, display: "flex", flexDirection: "column", gap: 2 }}>Scout
                  <select value={staff} onChange={pick(setStaff)} style={field}>
                    <option value="">All scouts</option>
                    {data.scouts.map((s) => <option key={s.staff_id} value={s.staff_id}>{s.name}</option>)}
                  </select>
                </label>
              </div>
              <Status isLoading={lines.isLoading} isError={lines.isError}>
                {lines.data && (lines.data.results.length === 0 ? <span style={dim}>No accruals match.</span> : (
                  <div style={scroll}>
                    <table style={table}>
                      <thead><tr>{["Scout", "Business", "Earned for", "Hold", "Status", "Amount"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                      <tbody>
                        {lines.data.results.map((a) => (
                          <tr key={a.id}>
                            <td style={td}>{a.staff}</td>
                            <td style={td}>{a.business}</td>
                            <td style={td}>{a.kind_label}<div style={dim}>{day(a.earned_at)}</div></td>
                            <td style={td}>{a.status === "on_hold" ? `Until ${day(a.hold_until)}` : a.status === "reversed" ? `Stopped ${day(a.reversed_at)}` : `Ended ${day(a.hold_until)}`}</td>
                            <td style={td}><span style={chip(STATUS_COLORS[a.status])}>{a.status_label}</span>{a.reversed_label && <div style={dim}>Reversed: {a.reversed_label}</div>}</td>
                            <td style={{ ...td, ...figures, fontWeight: 800 }}>{a.status === "reversed" ? "− " : ""}{money(a.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </Status>
              {lines.data && (lines.data.next || lines.data.previous) && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" disabled={!lines.data.previous} onClick={() => setPage((p) => Math.max(1, p - 1))} style={button(D.panelBg, D.text, !lines.data.previous)}>Previous</button>
                  <button type="button" disabled={!lines.data.next} onClick={() => setPage((p) => p + 1)} style={button(D.panelBg, D.text, !lines.data.next)}>Next</button>
                </div>
              )}
              <div style={{ ...dim, lineHeight: 1.5 }}>Each accrual keeps the amount in force when it was earned. {data.tax_note}</div>
            </section>
          </>
        )}
      </Status>
    </div>
  );
}

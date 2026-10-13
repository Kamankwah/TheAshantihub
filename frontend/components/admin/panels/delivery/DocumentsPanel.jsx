import { useState } from "react";
import { apiDownload, apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useDeliveryDocuments } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { button, chip, dim, field } from "../panelStyles.js";
import { scroll, table, td, th } from "../opsPeopleParts.jsx";
import { Kpi, Status, Title, kpiGrid, page, section, sectionTitle } from "../insightsParts.jsx";
import { Empty, ErrorLine, Filters, Note, WARN, dayOnly, mono } from "./deliveryParts.jsx";

// ─── Delivery Manager 09 Documents ───────────────────────────────────────────
// A paper's scan opens through an authenticated download, never a public address; its number
// shows only as the last four characters. Nobody checks a paper they uploaded themselves.
const NEEDS = [
  ["Motorbike or tricycle rider", "Ghana Card, driver's licence (class A), vehicle registration, roadworthy certificate, insurance."],
  ["Car or van driver", "Ghana Card, driver's licence (class B), vehicle registration, roadworthy certificate (6 months for commercial vehicles), insurance."],
];

function Row({ d, onDone, setError }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [expires, setExpires] = useState(d.expires_on || "");
  const run = async (fn, failure) => {
    setError("");
    try { await fn(); onDone(); } catch (err) { setError(apiErrorMessage(err, failure)); }
  };
  const open = async () => {
    try { await apiDownload(`/api/delivery/documents/${d.id}/file/`, `${d.kind}-${d.id}`); } catch (err) { setError(apiErrorMessage(err, "Could not open the scan.")); }
  };
  return (
    <tr>
      <td style={{ ...td, fontWeight: 700 }}>{d.rider.full_name}{d.rider.suspended && <div style={{ ...dim, color: WARN }}>Suspended</div>}</td>
      <td style={td}>{d.kind_label}{!d.required && <div style={dim}>Optional · pending DVLA</div>}<div style={{ ...dim, ...mono }}>{d.number_masked || ""}</div></td>
      <td style={td}>{d.expires_on ? dayOnly(d.expires_on) : "No expiry"}{d.days_left !== null && <div style={{ ...dim, color: d.days_left <= 7 ? WARN : D.textDim }}>{d.days_left < 0 ? `Expired ${-d.days_left} days ago` : `${d.days_left} days left`}</div>}</td>
      <td style={td}><span style={chip(d.status === "approved" ? D.green : d.status === "uploaded" ? D.amber : D.red)}>{d.status_label}</span>{d.reject_reason && <div style={dim}>{d.reject_reason}</div>}</td>
      <td style={td}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" onClick={open} style={button(D.panelBg, D.text)}>View scan</button>
          {d.status === "uploaded" && !rejecting && (
            <>
              <label style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text }}>Expires<input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} style={{ ...field, marginLeft: 4 }} /></label>
              <button type="button" onClick={() => run(() => apiPost(`/api/delivery/documents/${d.id}/review/`, { decision: "approve", expires_on: expires || undefined }), "Could not approve this paper.")} style={button(D.gold, D.text)}>Approve</button>
              <button type="button" onClick={() => setRejecting(true)} style={button(D.panelBg, D.text)}>Send back</button>
            </>
          )}
          {rejecting && (
            <>
              <input aria-label={`Why ${d.kind_label} is sent back`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it is sent back" style={field} />
              <button type="button" disabled={!reason.trim()} onClick={() => run(() => apiPost(`/api/delivery/documents/${d.id}/review/`, { decision: "reject", reject_reason: reason }), "Could not send this paper back.")} style={button(D.red, "#fff", !reason.trim())}>Send back</button>
              <button type="button" onClick={() => setRejecting(false)} style={button(D.panelBg, D.text)}>Cancel</button>
            </>
          )}
          {d.status !== "uploaded" && d.status !== "rejected" && <button type="button" onClick={() => run(() => apiPost(`/api/delivery/documents/${d.id}/remind/`, {}), "Could not send the reminder.")} style={button(D.panelBg, D.text)}>Remind {d.rider.full_name.split(" ")[0]}</button>}
        </div>
      </td>
    </tr>
  );
}

export default function DocumentsPanel({ onNavigate }) {
  const [bucket, setBucket] = useState("waiting");
  const [error, setError] = useState("");
  const { data, isLoading, isError, refetch } = useDeliveryDocuments(bucket);
  const c = data?.counts;
  return (
    <div style={page}>
      <Title right={<span style={chip(D.textDim)}>Reminders: in-app only · SMS not connected</span>}>Documents</Title>
      <ErrorLine>{error}</ErrorLine>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <div style={kpiGrid}>
              <Kpi label="Waiting for a check" value={c.waiting} />
              <Kpi label="Expiring in 30 days" value={c.expiring} />
              <Kpi label="Expired" value={c.expired} subColor={WARN} sub={c.expired ? "These riders are suspended" : undefined} />
              <Kpi label="Riders missing a paper" value={c.riders_missing_papers} />
            </div>
            <Filters label="Papers" value={bucket} onChange={setBucket} options={[["waiting", `Waiting · ${c.waiting}`], ["expiring", `Expiring · ${c.expiring}`], ["expired", `Expired · ${c.expired}`], ["all", "All papers"]]} />
            <section aria-labelledby="docs" style={section}>
              <h3 id="docs" style={sectionTitle}>Needs action, then expiring soonest</h3>
              {data.results.length === 0 ? <Empty>No paper in this list.</Empty> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Rider", "Document", "Expiry", "Status", "Actions"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>{data.results.map((d) => <Row key={d.id} d={d} onDone={refetch} setError={setError} />)}</tbody>
                  </table>
                </div>
              )}
            </section>
            {data.riders_missing_papers.length > 0 && (
              <section aria-labelledby="miss" style={section}>
                <h3 id="miss" style={sectionTitle}>Riders who cannot start a shift</h3>
                {data.riders_missing_papers.map((r) => <div key={r.id} style={{ fontSize: "0.82rem", color: D.text }}><b>{r.full_name}</b> is missing {r.missing.join(", ").replace(/_/g, " ")}.</div>)}
              </section>
            )}
            <section aria-labelledby="needs" style={section}>
              <h3 id="needs" style={sectionTitle}>What each vehicle needs</h3>
              {NEEDS.map(([who, what]) => <div key={who} style={{ fontSize: "0.82rem", color: D.text }}><b>{who}:</b> {what}</div>)}
              <span style={dim}>An expired paper suspends the rider automatically on its expiry date (after any job on the road is finished). Reminders go 30, 14 and 7 days before. Once the new paper is approved, reinstate the rider from their profile.</span>
            </section>
            <Note><b>Commercial rider&apos;s licence (okada).</b> Parliament legalised commercial motorbike riding in December 2025. Until DVLA confirms how the commercial rider&apos;s licence is issued, it stays an optional field marked &quot;pending DVLA&quot; and never blocks a rider.</Note>
            <div><button type="button" onClick={() => onNavigate?.("dm-riders")} style={button(D.panelBg, D.text)}>Open riders &amp; drivers</button></div>
          </>
        )}
      </Status>
    </div>
  );
}

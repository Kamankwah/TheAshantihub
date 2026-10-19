import { useState } from "react";
import { D } from "./dashboard/theme.js";
import { apiPost } from "../apiClient.js";
import { apiErrorMessage } from "../lib/apiErrorMessage.js";

// ─── ServiceAcceptBar ───────────────────────────────────────────────────────
// Under a finished service on the customer's Account → Requests tab (ledger Plan 7E). The business has marked the job
// done; the customer can accept it now (the business is paid at once) or report a problem (Support settles it and the
// automatic release stops). The server says when it accepts by itself (`auto_accept_at`); nothing here is invented.
const when = (iso) => new Date(iso).toLocaleString("en-GH", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const pill = (bg, color) => ({ background: bg, color, border: "none", borderRadius: 20, padding: "8px 16px", fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit" });

export default function ServiceAcceptBar({ request, onChanged }) {
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  if (request.status !== "completed" || request.settled) return null;
  if (request.problem_reported) {
    return <div style={{ color: D.amber, fontSize: "0.74rem", fontWeight: 700, marginTop: 10 }}>Problem reported. Support is looking into it, and the payment to the business is on hold until it is settled.</div>;
  }

  const run = async (path, body) => {
    setActionError(null);
    setBusy(true);
    try {
      await apiPost(`/api/services/requests/${request.id}/${path}/`, body);
      setReporting(false);
      setReason("");
      onChanged();
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not do that. Nothing was changed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      {request.auto_accept_at && (
        <div style={{ color: D.textDim, fontSize: "0.72rem" }}>
          Accepts automatically on {when(request.auto_accept_at)} unless you report a problem.
        </div>
      )}
      {!reporting && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" disabled={busy} onClick={() => run("accept", {})} style={pill(D.green, "#fff")}>Accept service</button>
          <button type="button" disabled={busy} onClick={() => setReporting(true)} style={pill(`${D.red}22`, D.red)}>Report a problem</button>
        </div>
      )}
      {reporting && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <label style={{ color: D.textDim, fontSize: "0.7rem", fontWeight: 700 }} htmlFor={`sr-problem-${request.id}`}>What went wrong?</label>
          <textarea
            id={`sr-problem-${request.id}`} rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 10, border: `1px solid ${D.cardBorder}`, background: D.panelBg2, color: D.text, fontFamily: "inherit", fontSize: "0.76rem" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={busy || reason.trim().length < 5} onClick={() => run("report-problem", { reason: reason.trim() })} style={pill(D.red, "#fff")}>Send report</button>
            <button type="button" disabled={busy} onClick={() => setReporting(false)} style={pill(D.panelBg2, D.textDim)}>Cancel</button>
          </div>
        </div>
      )}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.74rem" }}>{actionError}</div>}
    </div>
  );
}

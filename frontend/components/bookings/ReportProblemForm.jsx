import { useRef, useState } from "react";
import { D } from "../dashboard/theme.js";
import { apiPost } from "../../apiClient.js";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";

// "Report a problem" for a paid booking: a reason of 5+ characters, posted once to `path`. Support settles it and the
// payment to the business stays on hold meanwhile. Refusals show the server's own words. Back leaves the form without
// posting (it is not "Cancel", which would read as cancelling the booking).
const pill = (bg, color) => ({ background: bg, color, border: "none", borderRadius: 20, padding: "8px 16px", fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit" });

export default function ReportProblemForm({ path, idPrefix, onDone, onBack }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const inFlight = useRef(false);
  const id = `${idPrefix}-problem`;

  const send = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setActionError(null);
    setBusy(true);
    try {
      const body = await apiPost(path, { reason: reason.trim() });
      onDone(body);
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not send the report. Nothing was changed."));
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ color: D.textDim, fontSize: "0.7rem", fontWeight: 700 }} htmlFor={id}>What went wrong?</label>
      <textarea
        id={id} rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
        style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 10, border: `1px solid ${D.cardBorder}`, background: D.panelBg2, color: D.text, fontFamily: "inherit", fontSize: "0.76rem" }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={busy || reason.trim().length < 5} onClick={send} style={pill(D.red, "#fff")}>Send report</button>
        <button type="button" disabled={busy} onClick={onBack} style={pill(D.panelBg2, D.textDim)}>Back</button>
      </div>
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.74rem" }}>{actionError}</div>}
    </div>
  );
}

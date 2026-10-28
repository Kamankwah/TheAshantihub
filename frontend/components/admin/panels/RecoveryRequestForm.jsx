import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, dim, field } from "./panelStyles.js";
import { errorStyle } from "./portfolioParts.jsx";

// Support asks for a customer's or business owner's sign-in to be recovered. A Super Admin decides it
// in the approvals inbox. The person's phone and email are never shown: the way is a word, and the
// server picks the contact it holds. A Super Admin's own request applies at once (password re-entry
// arrives through the sudo prompt), so the copy follows the status the server returns.
const ACCOUNT_TYPE = { customer: "customer", business: "business_owner" };
const WAY_WORD = { sms: "text", email: "email" };
const label = { display: "flex", flexDirection: "column", gap: 4, color: D.text, fontSize: "0.82rem", fontWeight: 700 };

export default function RecoveryRequestForm({ kind, id, name }) {
  const [sendTo, setSendTo] = useState("sms");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = reason.trim();
    setError(null); setDone(null);
    if (!trimmed) { setError("Say how you confirmed it is really them."); return; }
    setBusy(true);
    try {
      const res = await apiPost("/api/otp/recovery/", { account_type: ACCOUNT_TYPE[kind], account_id: id, send_to: sendTo, reason: trimmed });
      setDone({ approvalId: res.approval_id, status: res.status, way: WAY_WORD[sendTo] });
      setReason("");
    } catch (err) {
      setError(apiErrorMessage(err, "Could not send the request."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={dim}>{`If ${name || "this person"} cannot sign in, ask for a reset link. A Super Admin decides it. The link goes to the contact we already hold, never one given on a call.`}</div>
      <label style={label}>
        Send the reset link by
        <select value={sendTo} onChange={(e) => setSendTo(e.target.value)} style={{ ...field, maxWidth: 200 }}>
          <option value="sms">Text</option>
          <option value="email">Email</option>
        </select>
      </label>
      <label style={label}>
        How you confirmed it is really them
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} style={field} />
      </label>
      <div>
        <button type="submit" disabled={busy} style={button(D.gold, D.text, busy)}>{busy ? "Sending…" : "Send for approval"}</button>
      </div>
      {done && (
        <div role="status" style={{ color: D.text, fontSize: "0.8rem" }}>
          {done.status === "approved"
            ? `Done (A-${done.approvalId}). It was applied at once, with no second approval.`
            : `Sent for approval (A-${done.approvalId}). A Super Admin decides it; the person is told by ${done.way} once it is approved.`}
        </div>
      )}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
    </form>
  );
}

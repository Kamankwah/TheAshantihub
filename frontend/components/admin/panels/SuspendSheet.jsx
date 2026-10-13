import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, field } from "./panelStyles.js";
import { card, errorStyle, h3, labelStyle } from "./portfolioParts.jsx";

// Suspend or lift the suspension of a business or a customer (Super Admin
// marketplace screens). The reason is required and goes to the account holder;
// the password is asked again by the shared prompt (a 403 sudo_required from
// the call opens it and retries once); the action is recorded in the audit log.
const KINDS = {
  business: {
    path: "/api/accounts/business-owners",
    suspend: ["Its listings and events leave the site at once; nothing is deleted.", "The owner can no longer sign in and is told why in the app."],
    lift: ["Its listings and events are visible again.", "The owner can sign in again and is told."],
  },
  customer: {
    path: "/api/accounts/customers",
    suspend: ["They can no longer sign in, so they cannot buy, book or review. Orders already paid are not changed.", "They are told why in the app."],
    lift: ["They can sign in again and are told."],
  },
};

export default function SuspendSheet({ kind, id, name, suspended, onDone, onCancel }) {
  const copy = KINDS[kind];
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const ready = suspended ? !busy : reason.trim().length > 0 && !busy;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setActionError(null);
    try {
      await apiPost(`${copy.path}/${id}/${suspended ? "unsuspend" : "suspend"}/`, suspended ? {} : { reason: reason.trim() });
      onDone(suspended ? `Lifted the suspension of ${name}.` : `Suspended ${name}.`);
    } catch (err) {
      setActionError(apiErrorMessage(err, suspended ? "Could not lift the suspension." : "Could not suspend."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form aria-label={suspended ? `Lift the suspension of ${name}` : `Suspend ${name}`} onSubmit={submit} noValidate style={{ ...card, border: `1px solid ${D.cardBorder}` }}>
      <h3 style={h3}>{suspended ? `Lift the suspension of ${name}` : `Suspend ${name}`}</h3>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.8rem", color: D.text }}>
        {(suspended ? copy.lift : copy.suspend).map((line) => <li key={line}>{line}</li>)}
        <li>It asks for your password and is recorded in the audit log.</li>
      </ul>
      {!suspended && (
        <label style={labelStyle}>Reason (the account holder is told)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} style={field} />
        </label>
      )}
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
        <button type="submit" disabled={!ready} style={button(suspended ? D.gold : D.red, suspended ? D.text : "#fff", !ready)}>{suspended ? "Lift suspension" : "Suspend"}</button>
      </div>
    </form>
  );
}

export const suspendedNote = (reason) => (reason ? `Suspended: ${reason}` : "Suspended");

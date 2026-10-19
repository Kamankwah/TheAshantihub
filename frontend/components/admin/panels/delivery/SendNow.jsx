import { useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { D } from "../../theme.js";
import { button, field } from "../panelStyles.js";
import { ErrorLine } from "./deliveryParts.jsx";

// A held order (its vendors are closed; ready_not_before is still ahead) can be sent early by a delivery manager.
// POST /api/delivery/orders/<id>/send-early/ {reason}. The server decides whether the order is still held; this
// only hides the control when the order's own time has passed.
export const isHeld = (readyNotBefore, now = Date.now()) => Boolean(readyNotBefore) && new Date(readyNotBefore).getTime() > now;

export const MIN_REASON = 3;

export default function SendNow({ orderId, readyNotBefore, onDone }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!isHeld(readyNotBefore)) return null;
  const ok = reason.trim().length >= MIN_REASON;
  const send = async () => {
    setError("");
    setBusy(true);
    try {
      await apiPost(`/api/delivery/orders/${orderId}/send-early/`, { reason: reason.trim() });
      setOpen(false);
      setReason("");
      onDone?.();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not send this order early."));
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} style={button(D.panelBg, D.text)}>Send now</button>;
  }
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text, flex: 1, minWidth: 180 }}>
        Why send it before the shop opens?
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} style={field} />
      </label>
      <button type="button" disabled={busy || !ok} onClick={send} style={button(D.gold, D.text, busy || !ok)}>Send now</button>
      <button type="button" disabled={busy} onClick={() => setOpen(false)} style={button(D.panelBg, D.text, busy)}>Cancel</button>
      <ErrorLine>{error}</ErrorLine>
    </div>
  );
}

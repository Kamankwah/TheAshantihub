import { useState } from "react";
import { D } from "./dashboard/theme.js";
import { apiPost } from "../apiClient.js";

// ─── RaiseDisputeForm ───────────────────────────────────────────────────────
// A customer raises a dispute on one of their orders (Account → Orders). Posts
// to POST /api/orders/{id}/dispute/, which opens a row in the staff Disputes
// queue; Support follows up with the customer from there. Reasons mirror
// disputes.Dispute.REASON_CHOICES.
const REASONS = [
  ["order_issue", "Order issue"],
  ["payment_issue", "Payment issue"],
  ["delivery_issue", "Delivery issue"],
  ["quality_issue", "Quality issue"],
  ["other", "Other"],
];

const fieldStyle = {
  width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 10,
  border: `1px solid ${D.cardBorder}`, background: D.panelBg2, color: D.text,
  fontFamily: "inherit", fontSize: "0.76rem",
};
const labelStyle = { display: "block", color: D.textDim, fontSize: "0.7rem", fontWeight: 700, margin: "8px 0 4px" };

export default function RaiseDisputeForm({ orderId }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0][0]);
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [sent, setSent] = useState(false);

  const send = async (e) => {
    e.preventDefault();
    setActionError(null);
    setSending(true);
    try {
      await apiPost(`/api/orders/${orderId}/dispute/`, { reason, description: description.trim() });
      setSent(true);
      setOpen(false);
    } catch {
      setActionError("Could not send your dispute. Please try again.");
    }
    setSending(false);
  };

  if (sent) {
    return (
      <div style={{ marginTop: 10, color: D.text, fontSize: "0.72rem" }}>
        Dispute sent. Our team will look into this and contact you through Support.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ marginTop: 10, background: "none", color: D.red, border: `1px solid ${D.red}`, borderRadius: 20, padding: "6px 14px", fontWeight: 700, fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit" }}
      >
        Raise a dispute
      </button>
    );
  }

  return (
    <form onSubmit={send} style={{ marginTop: 10, borderTop: `1px solid ${D.cardBorder}`, paddingTop: 8 }}>
      <label htmlFor={`dispute-reason-${orderId}`} style={labelStyle}>Reason</label>
      <select id={`dispute-reason-${orderId}`} value={reason} onChange={(e) => setReason(e.target.value)} style={fieldStyle}>
        {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <label htmlFor={`dispute-description-${orderId}`} style={labelStyle}>What went wrong?</label>
      <textarea
        id={`dispute-description-${orderId}`}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={3}
        style={{ ...fieldStyle, resize: "vertical" }}
      />
      {actionError && <div style={{ color: D.red, fontSize: "0.72rem", marginTop: 6 }}>{actionError}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="submit"
          disabled={sending || !description.trim()}
          style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "8px 16px", fontWeight: 800, fontSize: "0.74rem", cursor: sending ? "wait" : "pointer", fontFamily: "inherit", opacity: sending || !description.trim() ? 0.6 : 1 }}
        >
          {sending ? "Sending…" : "Send dispute"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setActionError(null); }}
          style={{ background: "none", color: D.textDim, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "8px 16px", fontWeight: 700, fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

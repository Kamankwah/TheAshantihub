import { useState } from "react";
import { staffDeliveryPromoAction, useStaffDeliveryPromos } from "../../../../hooks/useDeliveryPromos.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { D } from "../../theme.js";
import { pill } from "../panelStyles.js";
import { Honest, Loading, PageHead, Section, button, chip, dim, inputStyle } from "./mkParts.jsx";

// ─── Free-delivery promos: the review queue ──────────────────────────────────────
// A business asks to waive delivery on its own items; nothing applies until it is approved here. The waived
// fee is recorded on each order, there is no settlement against the business yet.
const TABS = [["pending", "Waiting"], ["approved", "Approved"], ["rejected", "Not approved"], ["paused", "Paused"], ["ended", "Ended"]];
const when = (iso) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function DeliveryPromosPanel() {
  const [status, setStatus] = useState("pending");
  const { data, isError, refetch } = useStaffDeliveryPromos(status);
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState("");

  const act = async (id, action, body) => {
    setActionError("");
    setBusyId(id);
    try {
      await staffDeliveryPromoAction(id, action, body);
      setRejecting(null);
      setReason("");
      await refetch();
    } catch (error) {
      setActionError(apiErrorMessage(error, "That did not work."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PageHead title="Free-delivery promos" />
      <Honest>A business can waive delivery only on its own items, and only when the whole order is from that business. The business covers the cost: each waived fee is a charge recorded against the business for that order, reversed if the order is cancelled, its payment fails or it is fully refunded.</Honest>
      <Section id="dp-list" title="Promos" action={
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {TABS.map(([v, l]) => <button key={v} type="button" aria-pressed={status === v} onClick={() => setStatus(v)} style={pill(status === v)}>{l}</button>)}
        </div>
      }>
        {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{actionError}</div>}
        {!data ? <Loading error={isError} onRetry={refetch} what="promos" /> : data.results.length === 0 ? <Honest>Nothing here.</Honest> : data.results.map((p) => (
          <div key={p.id} style={{ borderTop: `1px solid ${D.divider}`, paddingTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontWeight: 800, color: D.text, fontSize: "0.86rem" }}>{p.name} <span style={dim}>· {p.business}</span></div>
              <span style={chip(p.live ? D.green : D.textDim)}>{p.live ? "Running now" : p.effective_status}</span>
            </div>
            <div style={dim}>{when(p.starts_at)} to {when(p.ends_at)} · {p.source === "staff" ? "Set up by staff" : "Asked for by the business"}</div>
            <div style={dim}>{p.all_items ? "All of the business's items" : p.listings.map((l) => l.name).join(", ")}</div>
            <div style={dim}>Covered so far: GH₵ {p.covered_total} on {p.covered_orders} {p.covered_orders === 1 ? "order" : "orders"}</div>
            {p.rejection_reason && <div style={{ ...dim, color: D.red }}>Reason: {p.rejection_reason}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {p.status === "pending" && (
                <>
                  <button type="button" disabled={busyId === p.id} onClick={() => act(p.id, "approve")} style={button(D.gold, D.text, busyId === p.id)}>Approve</button>
                  <button type="button" disabled={busyId === p.id} onClick={() => { setRejecting(rejecting === p.id ? null : p.id); setReason(""); }} style={button(D.panelBg, D.text)}>Not approve</button>
                </>
              )}
              {p.status === "rejected" && <button type="button" disabled={busyId === p.id} onClick={() => act(p.id, "re-review")} style={button(D.panelBg, D.text, busyId === p.id)}>Send back to review</button>}
              {["active", "paused"].includes(p.status) && <button type="button" disabled={busyId === p.id} onClick={() => { if (window.confirm("End this promo now?")) act(p.id, "end"); }} style={button(D.panelBg, D.red, busyId === p.id)}>End now</button>}
            </div>
            {rejecting === p.id && (
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                <input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Tell the business why" maxLength={300} style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
                <button type="button" disabled={!reason.trim() || busyId === p.id} onClick={() => act(p.id, "reject", { reason })} style={button(D.red, "#fff", !reason.trim())}>Send</button>
              </div>
            )}
          </div>
        ))}
      </Section>
    </div>
  );
}

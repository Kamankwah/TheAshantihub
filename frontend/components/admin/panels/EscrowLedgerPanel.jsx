import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useEscrowLedger } from "../../../hooks/useEscrowLedger.js";
import { D, glassCard, ESCROW_STATUS_META } from "../theme.js";

// Escrow Ledger staff panel (event ticketing + escrow work). Clones
// ReviewsModerationPanel's shape exactly — same paginated-queue/actionError/
// refetch() convention, `data?.results` (useEscrowLedger mirrors
// useReviewsModerationQueue's paginated shape). Release/Hold require
// `escrow.release`; Refund requires `escrow.refund` — a stricter,
// non-overlapping permission per events/views.py's EscrowRefundView. A
// refunded ticket (refunded_at set) never gets Release/Hold/Refund actions
// again regardless of permission, and Refund itself only ever shows for a
// still-held, not-yet-delivered ticket (mirrors EscrowRefundView's own
// validation, so a click here doesn't just round-trip into a 400).
export default function EscrowLedgerPanel({ auth }) {
  const { data, isLoading, isError, refetch } = useEscrowLedger();
  const [noteById, setNoteById] = useState({});
  const [reasonById, setReasonById] = useState({});
  const [actionError, setActionError] = useState(null);

  const canRelease = auth.hasPermission("escrow.release");
  const canRefund = auth.hasPermission("escrow.refund");

  const release = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/events/tickets/${id}/escrow/release/`, { note: noteById[id] || "" }); refetch(); }
    catch (err) { setActionError("Could not release this ticket's escrow."); }
  };
  const hold = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/events/tickets/${id}/escrow/hold/`, { note: noteById[id] || "" }); refetch(); }
    catch (err) { setActionError("Could not hold this ticket's escrow."); }
  };
  const refund = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/events/tickets/${id}/escrow/refund/`, { reason: reasonById[id] || "" }); refetch(); }
    catch (err) { setActionError("Could not refund this ticket."); }
  };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the escrow ledger.</div>;
  const items = data?.results || [];

  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 14 }}>Escrow Ledger ({data?.count ?? items.length})</div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      {items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No tickets yet.</div>}
      {items.map(t => {
        const statusMeta = ESCROW_STATUS_META[t.escrow_status] || { label: t.escrow_status, color: D.textDim };
        const isRefunded = !!t.refunded_at;
        const isDelivered = !!t.delivered_at;
        return (
          <div key={t.id} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>
                  {t.event_name} — {t.ticket_type_name} <span style={{ color: D.textDim, fontWeight: 400 }}>({t.code})</span>
                  {isRefunded ? (
                    <span style={{ background: "rgba(248,113,113,0.16)", color: D.red, borderRadius: 20, padding: "2px 8px", fontSize: "0.6rem", fontWeight: 700, marginLeft: 6 }}>Refunded</span>
                  ) : (
                    <span style={{ background: `${statusMeta.color}22`, color: statusMeta.color, borderRadius: 20, padding: "2px 8px", fontSize: "0.6rem", fontWeight: 700, marginLeft: 6 }}>{statusMeta.label}</span>
                  )}
                </div>
                <div style={{ color: D.textDim, fontSize: "0.68rem", marginTop: 2 }}>
                  Buyer: {t.purchased_by_name} • GHS {t.price}
                </div>
                <div style={{ color: D.textDim, fontSize: "0.65rem", marginTop: 2 }}>
                  Held {t.escrow_held_at?.slice(0, 10) || "—"} • Released {t.escrow_released_at?.slice(0, 10) || "—"} • Delivered {t.delivered_at?.slice(0, 10) || "—"}
                </div>
                {t.escrow_override_note && <div style={{ color: D.textDim, fontSize: "0.65rem", marginTop: 2 }}>Note: {t.escrow_override_note}</div>}
                {isRefunded && t.refund_reason && <div style={{ color: D.red, fontSize: "0.65rem", marginTop: 2 }}>Refund reason: {t.refund_reason}</div>}
              </div>
            </div>
            {!isRefunded && (canRelease || canRefund) && <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              {canRelease && t.escrow_status === "held" && <>
                <input value={noteById[t.id] || ""} onChange={e => setNoteById(n => ({ ...n, [t.id]: e.target.value }))} placeholder="Note (optional)" style={{ flex: 1, minWidth: 120, padding: "5px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.72rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
                <button onClick={() => release(t.id)} style={{ background: D.green, color: "#04210f", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>Release</button>
              </>}
              {canRelease && t.escrow_status === "released" && <>
                <input value={noteById[t.id] || ""} onChange={e => setNoteById(n => ({ ...n, [t.id]: e.target.value }))} placeholder="Note (optional)" style={{ flex: 1, minWidth: 120, padding: "5px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.72rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
                <button onClick={() => hold(t.id)} style={{ background: D.amber, color: "#2a1a00", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>Hold</button>
              </>}
              {canRefund && t.escrow_status === "held" && !isDelivered && <>
                <input value={reasonById[t.id] || ""} onChange={e => setReasonById(n => ({ ...n, [t.id]: e.target.value }))} placeholder="Refund reason (optional)" style={{ flex: 1, minWidth: 120, padding: "5px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.72rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
                <button onClick={() => refund(t.id)} style={{ background: D.red, color: "#2a0606", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>Refund</button>
              </>}
            </div>}
          </div>
        );
      })}
    </div>
  );
}

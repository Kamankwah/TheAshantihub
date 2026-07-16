import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useEventModerationQueue } from "../../../hooks/useEventModerationQueue.js";
import { D, glassCard } from "../theme.js";

// Events Moderation staff panel (event pricing tiers work) — clones
// ListingsModerationPanel's exact shape (unpaginated queue, approve with no
// reason / reject with a required reason input, refetch() after each
// action). Gated by the event.approve permission.
export default function EventsModerationPanel() {
  const { data, isLoading, isError, refetch } = useEventModerationQueue();
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState(null);

  const approve = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/events/moderation/${id}/approve/`, {}); refetch(); }
    catch (err) { setActionError("Could not approve this event."); }
  };
  const reject = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/events/moderation/${id}/reject/`, { reason: rejectReason }); setRejectingId(null); setRejectReason(""); refetch(); }
    catch (err) { setActionError("Could not reject this event."); }
  };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the events queue.</div>;
  const items = data || [];

  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 14 }}>Pending events ({items.length})</div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      {items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No pending events.</div>}
      {items.map(ev => (
        <div key={ev.id} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{ev.name}</div>
              <div style={{ color: D.textDim, fontSize: "0.68rem" }}>{ev.category?.label} • {ev.zone?.name} • {ev.visibility_days} days • {ev.submitted_by_business_name || ev.submitted_by_customer_name}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => approve(ev.id)} style={{ background: D.green, color: "#04210f", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Approve</button>
              <button onClick={() => setRejectingId(ev.id)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
            </div>
          </div>
          {rejectingId === ev.id && <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason" style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
            <button onClick={() => reject(ev.id)} disabled={!rejectReason} style={{ background: D.red, color: "#2a0606", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: rejectReason ? "pointer" : "default" }}>Confirm reject</button>
          </div>}
        </div>
      ))}
    </div>
  );
}

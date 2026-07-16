import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useModerationQueue } from "../../../hooks/useModerationQueue.js";
import { D, glassCard } from "../theme.js";

export default function ListingsModerationPanel() {
  const { data, isLoading, isError, refetch } = useModerationQueue();
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState(null);

  const approve = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/moderation/${id}/approve/`, {}); refetch(); }
    catch (err) { setActionError("Could not approve this listing."); }
  };
  const reject = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/moderation/${id}/reject/`, { reason: rejectReason }); setRejectingId(null); setRejectReason(""); refetch(); }
    catch (err) { setActionError("Could not reject this listing."); }
  };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the moderation queue.</div>;
  const items = data || [];

  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 14 }}>Pending listings ({items.length})</div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      {items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No pending listings.</div>}
      {items.map(l => (
        <div key={l.id} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{l.name}</div>
              <div style={{ color: D.textDim, fontSize: "0.68rem" }}>{l.category?.label} • {l.zone?.name} • GHS {l.price_amount} • {l.contact_phone}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => approve(l.id)} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Approve</button>
              <button onClick={() => setRejectingId(l.id)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
            </div>
          </div>
          {rejectingId === l.id && <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason" style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
            <button onClick={() => reject(l.id)} disabled={!rejectReason} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: rejectReason ? "pointer" : "default" }}>Confirm reject</button>
          </div>}
        </div>
      ))}
    </div>
  );
}

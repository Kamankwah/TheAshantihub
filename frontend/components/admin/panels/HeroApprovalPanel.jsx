import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useHeroModerationQueue } from "../../../hooks/useHeroModerationQueue.js";
import { D, glassCard } from "../theme.js";

export default function HeroApprovalPanel() {
  const { data, isLoading, isError, refetch } = useHeroModerationQueue();
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState(null);

  const approve = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/hero/${id}/approve/`, {}); refetch(); }
    catch (err) { setActionError("Could not approve this submission."); }
  };
  const reject = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/hero/${id}/reject/`, { reason: rejectReason }); setRejectingId(null); setRejectReason(""); refetch(); }
    catch (err) { setActionError("Could not reject this submission."); }
  };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the hero approval queue.</div>;
  const items = data || [];

  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 14 }}>Pending hero submissions ({items.length})</div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      {items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No pending submissions.</div>}
      {items.map(s => (
        <div key={s.id} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 10 }}>
              {s.media_type === "video" ? (
                <video src={s.media} muted style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 10, background: "#000", flexShrink: 0 }} />
              ) : (
                <img src={s.media} alt={s.caption || ""} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 10, flexShrink: 0 }} />
              )}
              <div>
                <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{s.business_owner_name}</div>
                <div style={{ color: D.textDim, fontSize: "0.72rem", margin: "3px 0", maxWidth: 320 }}>"{s.caption}"</div>
                <div style={{ color: D.textDim, fontSize: "0.65rem" }}>Submitted {s.submitted_at?.slice(0, 10)}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => approve(s.id)} style={{ background: D.green, color: "#04210f", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Approve</button>
              <button onClick={() => setRejectingId(s.id)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
            </div>
          </div>
          {rejectingId === s.id && <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason" style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
            <button onClick={() => reject(s.id)} disabled={!rejectReason} style={{ background: D.red, color: "#2a0606", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: rejectReason ? "pointer" : "default" }}>Confirm reject</button>
          </div>}
        </div>
      ))}
    </div>
  );
}

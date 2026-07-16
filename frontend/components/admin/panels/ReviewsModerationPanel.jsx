import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useReviewsModerationQueue } from "../../../hooks/useReviewsModerationQueue.js";
import { D, glassCard, REVIEW_STATUS_META } from "../theme.js";

export default function ReviewsModerationPanel() {
  // GET /api/reviews/moderation/ is paginated ({count, next, previous,
  // results}), unlike ListingsModerationPanel/HeroApprovalPanel's plain-array
  // endpoints — so `items` reads data?.results, not data||[]. This is also a
  // full queue (every review regardless of status), not a pending-only one —
  // moderation here is reactive-by-browsing, hide/unhide rather than
  // approve/reject.
  const { data, isLoading, isError, refetch } = useReviewsModerationQueue();
  const [hidingId, setHidingId] = useState(null);
  const [hideReason, setHideReason] = useState("");
  const [actionError, setActionError] = useState(null);

  const hide = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/reviews/moderation/${id}/hide/`, { reason: hideReason }); setHidingId(null); setHideReason(""); refetch(); }
    catch (err) { setActionError("Could not hide this review."); }
  };
  const unhide = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/reviews/moderation/${id}/unhide/`, {}); refetch(); }
    catch (err) { setActionError("Could not unhide this review."); }
  };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the reviews queue.</div>;
  const items = data?.results || [];

  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 14 }}>Reviews ({data?.count ?? items.length})</div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      {items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No reviews yet.</div>}
      {items.map(r => {
        const statusMeta = REVIEW_STATUS_META[r.status] || { label: r.status, color: D.textDim };
        return (
          <div key={r.id} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>
                  {"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)} <span style={{ color: D.textDim, fontWeight: 400 }}>({r.target_type})</span>
                  {r.verified && <span style={{ background: "rgba(52,211,153,0.16)", color: D.green, borderRadius: 20, padding: "2px 8px", fontSize: "0.6rem", fontWeight: 700, marginLeft: 6 }}>✓ Verified</span>}
                  <span style={{ background: `${statusMeta.color}22`, color: statusMeta.color, borderRadius: 20, padding: "2px 8px", fontSize: "0.6rem", fontWeight: 700, marginLeft: 6 }}>{statusMeta.label}</span>
                </div>
                {r.comment && <div style={{ color: D.textDim, fontSize: "0.75rem", margin: "4px 0", maxWidth: 420 }}>"{r.comment}"</div>}
                <div style={{ color: D.textDim, fontSize: "0.65rem" }}>{r.author_name} • {r.created_at?.slice(0, 10)}</div>
                {r.status === "hidden" && r.hidden_reason && <div style={{ color: D.red, fontSize: "0.65rem", marginTop: 2 }}>Hidden: {r.hidden_reason}</div>}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {r.status === "published" && <button onClick={() => setHidingId(r.id)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>🚫 Hide</button>}
                {r.status === "hidden" && <button onClick={() => unhide(r.id)} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>↩️ Unhide</button>}
              </div>
            </div>
            {hidingId === r.id && <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
              <input value={hideReason} onChange={e => setHideReason(e.target.value)} placeholder="Reason for hiding" style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
              <button onClick={() => hide(r.id)} disabled={!hideReason} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: hideReason ? "pointer" : "default" }}>Confirm hide</button>
            </div>}
          </div>
        );
      })}
    </div>
  );
}

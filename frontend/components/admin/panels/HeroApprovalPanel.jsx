import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useHeroModerationQueue } from "../../../hooks/useHeroModerationQueue.js";
import { D } from "../theme.js";
import ModerationQueueTabs, {
  ApprovedByLine,
  RejectedReason,
  ReviewAgainButton,
} from "../ModerationQueueTabs.jsx";

// Hero-media approval, restructured into Pending / Approved / Rejected tabs
// (staff moderation-queue restructuring, items 1 & 3).
export default function HeroApprovalPanel() {
  const [tab, setTab] = useState("pending");
  const pending = useHeroModerationQueue({ status: "pending" });
  const approved = useHeroModerationQueue({ status: "approved" });
  const rejected = useHeroModerationQueue({ status: "rejected" });
  const queries = { pending, approved, rejected };

  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState(null);

  const refetchAll = () => { pending.refetch(); approved.refetch(); rejected.refetch(); };

  const approve = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/hero/${id}/approve/`, {}); refetchAll(); }
    catch { setActionError("Could not approve this submission."); }
  };
  const reject = async (id) => {
    setActionError(null);
    try {
      await apiPost(`/api/listings/hero/${id}/reject/`, { reason: rejectReason });
      setRejectingId(null); setRejectReason(""); refetchAll();
    } catch { setActionError("Could not reject this submission."); }
  };
  const reReview = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/hero/${id}/re-review/`, {}); refetchAll(); }
    catch { setActionError("Could not send this submission back for re-review."); }
  };

  const renderRow = (s, state) => (
    <div style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
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
            {state === "approved" && <ApprovedByLine name={s.reviewed_by_name} at={s.reviewed_at} />}
            {state === "rejected" && <RejectedReason reason={s.rejection_reason} />}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {state === "pending" && (
            <>
              <button onClick={() => approve(s.id)} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Approve</button>
              <button onClick={() => setRejectingId(s.id)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
            </>
          )}
          {state === "rejected" && <ReviewAgainButton onClick={() => reReview(s.id)} />}
        </div>
      </div>
      {rejectingId === s.id && state === "pending" && (
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason" style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
          <button onClick={() => reject(s.id)} disabled={!rejectReason} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: rejectReason ? "pointer" : "default" }}>Confirm reject</button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      <ModerationQueueTabs
        tab={tab}
        onTab={setTab}
        queries={queries}
        title="Hero submissions"
        renderRow={renderRow}
      />
    </>
  );
}

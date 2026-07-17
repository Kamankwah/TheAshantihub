import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useReviewsModerationQueue } from "../../../hooks/useReviewsModerationQueue.js";
import { D } from "../theme.js";
import ModerationQueueTabs, {
  ApprovedByLine,
  RejectedReason,
  ReviewAgainButton,
} from "../ModerationQueueTabs.jsx";

// Reviews are pre-moderated (punch-list item 5): a new review waits in Pending
// and is invisible to the public until approved. The three tabs map onto the
// stored statuses as pending / published / hidden — "hidden" doubles as the
// rejected state, which is why the reason field is still called hidden_reason.
//
// Unlike its sibling panels, this queue's endpoint is paginated — but
// ModerationQueueTabs' itemsOf() normalizes that, so there's nothing to do here.
function ReviewRow({ review, state, canReReview, onDone }) {
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState(null);

  const approve = async () => {
    setActionError(null);
    try { await apiPost(`/api/reviews/moderation/${review.id}/approve/`, {}); onDone(); }
    catch { setActionError("Could not approve this review. Please try again."); }
  };
  const reject = async () => {
    setActionError(null);
    try {
      await apiPost(`/api/reviews/moderation/${review.id}/hide/`, { reason: rejectReason });
      setRejecting(false); setRejectReason(""); onDone();
    } catch { setActionError("Could not reject this review. Please try again."); }
  };
  const reReview = async () => {
    setActionError(null);
    try { await apiPost(`/api/reviews/moderation/${review.id}/re-review/`, {}); onDone(); }
    catch { setActionError("Could not send this review back for re-review."); }
  };

  return (
    <div style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>
            {"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}{" "}
            <span style={{ color: D.textDim, fontWeight: 400 }}>({review.target_type})</span>
            {review.verified && (
              <span style={{ background: "rgba(52,211,153,0.16)", color: D.green, borderRadius: 20, padding: "2px 8px", fontSize: "0.6rem", fontWeight: 700, marginLeft: 6 }}>✓ Verified</span>
            )}
          </div>
          {review.target_name && (
            <div style={{ color: D.gold, fontSize: "0.68rem", fontWeight: 700, marginTop: 2 }}>{review.target_name}</div>
          )}
          {review.comment && (
            <div style={{ color: D.textDim, fontSize: "0.75rem", margin: "4px 0", maxWidth: 420 }}>"{review.comment}"</div>
          )}
          <div style={{ color: D.textDim, fontSize: "0.65rem" }}>
            {review.author_name} • written {review.created_at?.slice(0, 10)}
          </div>
          {state === "approved" && <ApprovedByLine name={review.reviewed_by_name} at={review.reviewed_at} />}
          {state === "rejected" && <RejectedReason reason={review.hidden_reason} />}
          {state === "rejected" && review.reviewed_by_name && (
            <div style={{ color: D.textFaint, fontSize: "0.65rem", marginTop: 2 }}>
              by {review.reviewed_by_name}{review.reviewed_at ? ` • ${review.reviewed_at.slice(0, 10)}` : ""}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {state === "pending" && (
            <>
              <button onClick={approve} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Approve</button>
              <button onClick={() => setRejecting(true)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
            </>
          )}
          {/* A published review can still be taken down reactively — it lands
              in the same hidden state, so it reappears on the Rejected tab. */}
          {state === "approved" && (
            <button onClick={() => setRejecting(true)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>🚫 Hide</button>
          )}
          {state === "rejected" && canReReview && <ReviewAgainButton onClick={reReview} />}
        </div>
      </div>

      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginTop: 8 }}>{actionError}</div>}

      {/* Re-review is a supervisor action (reviews.re_review, super_admin
          only) — say so rather than silently rendering no button. */}
      {state === "rejected" && !canReReview && (
        <div style={{ color: D.textFaint, fontSize: "0.65rem", marginTop: 6 }}>
          Only a super admin can send a rejected review back for re-review.
        </div>
      )}

      {rejecting && (
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          <input
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="Reason for rejecting"
            style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }}
          />
          <button onClick={reject} disabled={!rejectReason} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: rejectReason ? "pointer" : "default" }}>Confirm reject</button>
        </div>
      )}
    </div>
  );
}

export default function ReviewsModerationPanel({ auth }) {
  const [tab, setTab] = useState("pending");
  const pending = useReviewsModerationQueue({ status: "pending" });
  const approved = useReviewsModerationQueue({ status: "approved" });
  const rejected = useReviewsModerationQueue({ status: "rejected" });
  const queries = { pending, approved, rejected };
  const canReReview = auth?.hasPermission?.("reviews.re_review") ?? false;

  const refetchAll = () => { pending.refetch(); approved.refetch(); rejected.refetch(); };

  return (
    <ModerationQueueTabs
      tab={tab}
      onTab={setTab}
      queries={queries}
      title="Reviews"
      emptyLabel={{ pending: "No reviews are waiting for approval." }}
      renderRow={(review, state) => (
        <ReviewRow review={review} state={state} canReReview={canReReview} onDone={refetchAll} />
      )}
    />
  );
}

import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useSubscriptionPlanPendingQueue } from "../../../hooks/useSubscriptionPlanPendingQueue.js";
import { D } from "../theme.js";
import ModerationQueueTabs, {
  ApprovedByLine,
  RejectedReason,
  ReviewAgainButton,
} from "../ModerationQueueTabs.jsx";

// Staff "subscription_plans.approve" panel (super_admin only): approve/reject
// plans, restructured onto the shared Pending/Approved/Rejected shell
// (punch-list item 6). The Approved tab is labelled "Active" because that is
// this model's approved state — a plan that passes approval is live.
function PlanRow({ plan, state, onDone }) {
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState(null);

  const approve = async () => {
    setActionError(null);
    try { await apiPost(`/api/billing/plans/${plan.id}/approve/`, {}); onDone(); }
    catch { setActionError("Could not approve this plan."); }
  };
  const reject = async () => {
    setActionError(null);
    try {
      await apiPost(`/api/billing/plans/${plan.id}/reject/`, { reason: rejectReason });
      setRejecting(false); setRejectReason(""); onDone();
    } catch { setActionError("Could not reject this plan."); }
  };
  const reReview = async () => {
    setActionError(null);
    try { await apiPost(`/api/billing/plans/${plan.id}/re-review/`, {}); onDone(); }
    catch { setActionError("Could not send this plan back for re-review."); }
  };

  return (
    <div style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>
            {plan.name} <span style={{ color: D.textDim, fontWeight: 400 }}>({plan.tier})</span>
          </div>
          <div style={{ color: D.textDim, fontSize: "0.72rem", margin: "3px 0" }}>
            {plan.kind === "product" ? "Product" : "Service"} · GHS {plan.monthly_price}/mo · Max listings: {plan.max_active_listings ?? "Unlimited"} · Hero days: {plan.hero_days} · Boost credits: {plan.boost_credits_per_month}
          </div>
          {state === "approved" && <ApprovedByLine name={plan.reviewed_by_name} at={plan.reviewed_at} verb="Activated" />}
          {state === "rejected" && <RejectedReason reason={plan.rejection_reason} />}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {state === "pending" && (
            <>
              <button onClick={approve} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Approve</button>
              <button onClick={() => setRejecting(true)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
            </>
          )}
          {state === "rejected" && <ReviewAgainButton onClick={reReview} />}
        </div>
      </div>

      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginTop: 8 }}>{actionError}</div>}

      {rejecting && (
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          <input
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="Rejection reason"
            style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }}
          />
          <button onClick={reject} disabled={!rejectReason} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: rejectReason ? "pointer" : "default" }}>Confirm reject</button>
        </div>
      )}
    </div>
  );
}

export default function SubscriptionPlanApprovalPanel() {
  const [tab, setTab] = useState("pending");
  const pending = useSubscriptionPlanPendingQueue({ status: "pending" });
  const approved = useSubscriptionPlanPendingQueue({ status: "approved" });
  const rejected = useSubscriptionPlanPendingQueue({ status: "rejected" });
  const queries = { pending, approved, rejected };

  const refetchAll = () => { pending.refetch(); approved.refetch(); rejected.refetch(); };

  return (
    <ModerationQueueTabs
      tab={tab}
      onTab={setTab}
      queries={queries}
      title="Plan approvals"
      labels={{ approved: "Active" }}
      emptyLabel={{ pending: "No plans are waiting for approval." }}
      renderRow={(plan, state) => <PlanRow plan={plan} state={state} onDone={refetchAll} />}
    />
  );
}

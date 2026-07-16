import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useSubscriptionPlanPendingQueue } from "../../../hooks/useSubscriptionPlanPendingQueue.js";
import { D, glassCard } from "../theme.js";

// Staff "subscription_plans.approve" panel (super_admin only): approve/reject
// pending plans. Clones HeroApprovalPanel's exact shape (list + approve +
// reveal-a-reason-then-reject).
export default function SubscriptionPlanApprovalPanel() {
  const { data, isLoading, isError, refetch } = useSubscriptionPlanPendingQueue();
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState(null);

  const approve = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/billing/plans/${id}/approve/`, {}); refetch(); }
    catch (err) { setActionError("Could not approve this plan."); }
  };
  const reject = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/billing/plans/${id}/reject/`, { reason: rejectReason }); setRejectingId(null); setRejectReason(""); refetch(); }
    catch (err) { setActionError("Could not reject this plan."); }
  };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the plan approval queue.</div>;
  const items = data || [];

  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 14 }}>Pending plan approvals ({items.length})</div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      {items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No pending plans.</div>}
      {items.map(p => (
        <div key={p.id} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{p.name} <span style={{ color: D.textDim, fontWeight: 400 }}>({p.tier})</span></div>
              <div style={{ color: D.textDim, fontSize: "0.72rem", margin: "3px 0" }}>{p.kind === "product" ? "Product" : "Service"} · GHS {p.monthly_price}/mo · Max listings: {p.max_active_listings ?? "Unlimited"} · Hero days: {p.hero_days} · Boost credits: {p.boost_credits_per_month}</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => approve(p.id)} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Approve</button>
              <button onClick={() => setRejectingId(p.id)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
            </div>
          </div>
          {rejectingId === p.id && <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason" style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
            <button onClick={() => reject(p.id)} disabled={!rejectReason} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: rejectReason ? "pointer" : "default" }}>Confirm reject</button>
          </div>}
        </div>
      ))}
    </div>
  );
}

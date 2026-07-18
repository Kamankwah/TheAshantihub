import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { usePromotionsQueue } from "../../../hooks/usePromotionsQueue.js";
import { D } from "../theme.js";
import ModerationQueueTabs from "../ModerationQueueTabs.jsx";

// Promotions management (punch-list item 7 + pre-prod bug fix 7). A purchased
// promotion is now moderated before it affects ranking: the owner pays, the row
// arrives Pending, and a staffer approves it (→ Active, ranking begins now) or
// rejects it. Tabs: Pending (default) → Active/Rejected, plus the derived
// Expired and the Cancelled early-stop lifecycle.
const PROMOTION_TABS = ["pending", "active", "rejected", "expired", "cancelled"];

const KIND_META = {
  featured: { label: "Featured", color: D.gold },
  boost: { label: "Boost", color: D.blue },
};

const fmtDate = (v) => (v ? String(v).slice(0, 10) : "—");

function PromotionRow({ promotion, state, canManage, onDone }) {
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState(null);
  const kind = KIND_META[promotion.kind] || { label: promotion.kind, color: D.textDim };

  const call = async (path, body) => {
    setActionError(null);
    try {
      await apiPost(`/api/listings/promotions/${promotion.id}/${path}/`, body || {});
      setConfirming(false); setRejecting(false); setReason("");
      onDone();
    } catch { setActionError("Could not complete that action. Please try again."); }
  };
  const cancel = () => call("cancel");
  const approve = () => call("approve");
  const reject = () => call("reject", { reason });

  return (
    <div style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>
            {promotion.listing_name}
            <span style={{ background: `${kind.color}22`, color: kind.color, borderRadius: 20, padding: "2px 8px", fontSize: "0.6rem", fontWeight: 700, marginLeft: 6 }}>{kind.label}</span>
          </div>
          <div style={{ color: D.textDim, fontSize: "0.68rem", marginTop: 2 }}>
            🏢 {promotion.business_owner_name} • GHS {promotion.amount_paid} • {fmtDate(promotion.starts_at)} → {fmtDate(promotion.ends_at)}
          </div>
          {promotion.kind === "boost" && promotion.keywords && (
            <div style={{ color: D.textFaint, fontSize: "0.65rem", marginTop: 2 }}>Keywords: {promotion.keywords}</div>
          )}
          {/* An Active row whose window hasn't opened yet is paid for but not
              ranking anything — say so rather than implying it's running. */}
          {state === "active" && !promotion.is_currently_active && (
            <div style={{ color: D.amber, fontSize: "0.65rem", fontWeight: 700, marginTop: 2 }}>Scheduled — not ranking yet</div>
          )}
          {state === "pending" && (
            <div style={{ color: D.amber, fontSize: "0.65rem", fontWeight: 700, marginTop: 2 }}>⏳ Awaiting approval — paid, not ranking yet</div>
          )}
          {state === "expired" && (
            <div style={{ color: D.textFaint, fontSize: "0.65rem", marginTop: 2 }}>Ran its full window</div>
          )}
          {state === "cancelled" && (
            <div style={{ color: D.red, fontSize: "0.65rem", fontWeight: 700, marginTop: 2 }}>✕ Cancelled early</div>
          )}
          {state === "rejected" && (
            <div style={{ color: D.red, fontSize: "0.65rem", fontWeight: 700, marginTop: 2 }}>✕ Rejected{promotion.rejection_reason ? ` — ${promotion.rejection_reason}` : ""}</div>
          )}
        </div>
        {state === "pending" && canManage && !rejecting && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button onClick={approve} style={{ background: D.green, color: "#0b2e13", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 800, cursor: "pointer" }}>✓ Approve</button>
            <button onClick={() => setRejecting(true)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
          </div>
        )}
        {state === "active" && canManage && (
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {confirming ? (
              <>
                <button onClick={cancel} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>Confirm cancel</button>
                <button onClick={() => setConfirming(false)} style={{ background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>Keep</button>
              </>
            ) : (
              <button onClick={() => setConfirming(true)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Cancel</button>
            )}
          </div>
        )}
      </div>

      {/* Reject reason input (pending rows) */}
      {state === "pending" && rejecting && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" style={{ flex: 1, minWidth: 160, padding: "6px 10px", borderRadius: 8, border: `1.5px solid ${D.divider}`, fontSize: "0.72rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
          <button onClick={reject} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>Confirm reject</button>
          <button onClick={() => { setRejecting(false); setReason(""); }} style={{ background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>Keep</button>
        </div>
      )}

      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginTop: 8 }}>{actionError}</div>}

      {/* Cancelling is not a refund — don't let the button imply it is. */}
      {confirming && (
        <div style={{ color: D.amber, fontSize: "0.65rem", marginTop: 6 }}>
          This stops the promotion immediately. It does not refund the GHS {promotion.amount_paid} already paid.
        </div>
      )}
    </div>
  );
}

export default function PromotionsPanel({ auth }) {
  const [tab, setTab] = useState("pending");
  const pending = usePromotionsQueue({ status: "pending" });
  const active = usePromotionsQueue({ status: "active" });
  const rejected = usePromotionsQueue({ status: "rejected" });
  const expired = usePromotionsQueue({ status: "expired" });
  const cancelled = usePromotionsQueue({ status: "cancelled" });
  const queries = { pending, active, rejected, expired, cancelled };
  const canManage = auth?.hasPermission?.("promotions.manage") ?? false;

  const refetchAll = () => { pending.refetch(); active.refetch(); rejected.refetch(); expired.refetch(); cancelled.refetch(); };

  return (
    <ModerationQueueTabs
      tab={tab}
      onTab={setTab}
      queries={queries}
      tabs={PROMOTION_TABS}
      title="Promotions"
      labels={{ pending: "Pending", active: "Active", rejected: "Rejected", expired: "Expired", cancelled: "Cancelled" }}
      emptyLabel={{
        pending: "No promotions are awaiting approval.",
        active: "No promotions are running.",
        rejected: "No promotions have been rejected.",
        expired: "No promotions have finished yet.",
        cancelled: "No promotions have been cancelled.",
      }}
      renderRow={(promotion, state) => (
        <PromotionRow promotion={promotion} state={state} canManage={canManage} onDone={refetchAll} />
      )}
    />
  );
}

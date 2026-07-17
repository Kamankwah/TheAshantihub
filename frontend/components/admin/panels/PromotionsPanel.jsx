import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { usePromotionsQueue } from "../../../hooks/usePromotionsQueue.js";
import { D } from "../theme.js";
import ModerationQueueTabs from "../ModerationQueueTabs.jsx";

// Promotions management (punch-list item 7). This replaced PromotionsInfoPanel,
// a static "nothing to manage here" card whose stated reason — no backend
// list-all endpoint — stopped being true once GET /api/listings/promotions/
// was added.
//
// Deliberately NOT Pending/Approved/Rejected: promotions are self-serve, so a
// business owner buys one and it goes live immediately. There is nothing to
// approve. The lifecycle is Active → Expired, with Cancelled as an early stop.
const PROMOTION_TABS = ["active", "expired", "cancelled"];

const KIND_META = {
  featured: { label: "Featured", color: D.gold },
  boost: { label: "Boost", color: D.blue },
};

const fmtDate = (v) => (v ? String(v).slice(0, 10) : "—");

function PromotionRow({ promotion, state, canManage, onDone }) {
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState(null);
  const kind = KIND_META[promotion.kind] || { label: promotion.kind, color: D.textDim };

  const cancel = async () => {
    setActionError(null);
    try {
      await apiPost(`/api/listings/promotions/${promotion.id}/cancel/`, {});
      setConfirming(false);
      onDone();
    } catch { setActionError("Could not cancel this promotion. Please try again."); }
  };

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
          {state === "expired" && (
            <div style={{ color: D.textFaint, fontSize: "0.65rem", marginTop: 2 }}>Ran its full window</div>
          )}
          {state === "cancelled" && (
            <div style={{ color: D.red, fontSize: "0.65rem", fontWeight: 700, marginTop: 2 }}>✕ Cancelled early</div>
          )}
        </div>
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
  const [tab, setTab] = useState("active");
  const active = usePromotionsQueue({ status: "active" });
  const expired = usePromotionsQueue({ status: "expired" });
  const cancelled = usePromotionsQueue({ status: "cancelled" });
  const queries = { active, expired, cancelled };
  const canManage = auth?.hasPermission?.("promotions.manage") ?? false;

  const refetchAll = () => { active.refetch(); expired.refetch(); cancelled.refetch(); };

  return (
    <ModerationQueueTabs
      tab={tab}
      onTab={setTab}
      queries={queries}
      tabs={PROMOTION_TABS}
      title="Promotions"
      labels={{ active: "Active", expired: "Expired", cancelled: "Cancelled" }}
      emptyLabel={{
        active: "No promotions are running.",
        expired: "No promotions have finished yet.",
        cancelled: "No promotions have been cancelled.",
      }}
      renderRow={(promotion, state) => (
        <PromotionRow promotion={promotion} state={state} canManage={canManage} onDone={refetchAll} />
      )}
    />
  );
}

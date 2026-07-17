import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useModerationQueue } from "../../../hooks/useModerationQueue.js";
import { D } from "../theme.js";
import ModerationQueueTabs, {
  ApprovedByLine,
  RejectedReason,
  ReviewAgainButton,
} from "../ModerationQueueTabs.jsx";

// Listings moderation, restructured into Pending / Approved (Published) /
// Rejected tabs (staff moderation-queue restructuring, items 1 & 2). Within
// every tab the backend orders listings by owning business, and each row leads
// with a "🏢 {business}" header (with a divider when the business changes) so a
// reviewer can identify a business's listings at a glance (item 2).
export default function ListingsModerationPanel() {
  const [tab, setTab] = useState("pending");
  const pending = useModerationQueue({ status: "pending" });
  const approved = useModerationQueue({ status: "approved" });
  const rejected = useModerationQueue({ status: "rejected" });
  const queries = { pending, approved, rejected };

  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState(null);

  const refetchAll = () => { pending.refetch(); approved.refetch(); rejected.refetch(); };

  const approve = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/moderation/${id}/approve/`, {}); refetchAll(); }
    catch { setActionError("Could not approve this listing."); }
  };
  const reject = async (id) => {
    setActionError(null);
    try {
      await apiPost(`/api/listings/moderation/${id}/reject/`, { reason: rejectReason });
      setRejectingId(null); setRejectReason(""); refetchAll();
    } catch { setActionError("Could not reject this listing."); }
  };
  const reReview = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/listings/moderation/${id}/re-review/`, {}); refetchAll(); }
    catch { setActionError("Could not send this listing back for re-review."); }
  };

  const renderRow = (l, state, index, items) => {
    const newBusiness = index === 0 || items[index - 1].business_owner_name !== l.business_owner_name;
    return (
      <div style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
        {newBusiness && (
          <div style={{ color: D.gold, fontWeight: 800, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            🏢 {l.business_owner_name}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{l.name}</div>
            <div style={{ color: D.textDim, fontSize: "0.68rem" }}>{l.category?.label} • {l.zone?.name} • GHS {l.price_amount} • {l.contact_phone}</div>
            {state === "approved" && <ApprovedByLine name={l.reviewed_by_name} at={l.reviewed_at} verb="Published" />}
            {state === "rejected" && <RejectedReason reason={l.rejection_reason} />}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {state === "pending" && (
              <>
                <button onClick={() => approve(l.id)} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Approve</button>
                <button onClick={() => setRejectingId(l.id)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
              </>
            )}
            {state === "rejected" && <ReviewAgainButton onClick={() => reReview(l.id)} />}
          </div>
        </div>
        {rejectingId === l.id && state === "pending" && (
          <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason" style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
            <button onClick={() => reject(l.id)} disabled={!rejectReason} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: rejectReason ? "pointer" : "default" }}>Confirm reject</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      <ModerationQueueTabs
        tab={tab}
        onTab={setTab}
        queries={queries}
        title="Listings moderation"
        labels={{ approved: "Published" }}
        renderRow={renderRow}
      />
    </>
  );
}

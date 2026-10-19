import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useModerationQueue } from "../../../hooks/useModerationQueue.js";
import { useListingsStats } from "../../../hooks/useQueueStats.js";
import { D } from "../theme.js";
import { chip, dim } from "./panelStyles.js";
import SponsoredToggle, { isProductListing } from "./SponsoredToggle.jsx";
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
// Chips beside a pending listing, from the business's records: an open fraud
// case to check first, and a subscription that is overdue (the "of 14" only
// while the pause is switched on, otherwise there is no deadline to name).
function ListingChips({ listing }) {
  const overdue = listing.subscription_overdue;
  if (!(listing.open_fraud_cases > 0) && !overdue) return null;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
      {listing.open_fraud_cases > 0 && <span style={chip(D.red)}>Open fraud case on this business — check before approving</span>}
      {overdue && <span style={chip(D.amber)}>{`Subscription overdue · day ${overdue.day}${overdue.grace_days ? ` of ${overdue.grace_days}` : ""}`}</span>}
    </div>
  );
}

export default function ListingsModerationPanel({ auth }) {
  const canSponsor = Boolean(auth?.hasPermission?.("deals.manage"));
  const [tab, setTab] = useState("pending");
  const { data: stats } = useListingsStats();
  const pending = useModerationQueue({ status: "pending" });
  const approved = useModerationQueue({ status: "approved" });
  const rejected = useModerationQueue({ status: "rejected" });
  const queries = { pending, approved, rejected };

  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [expandedId, setExpandedId] = useState(null);
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
            {(l.specs || []).length > 0 && <div style={{ color: D.textDim, fontSize: "0.68rem" }}>{l.specs.map((x) => `${x.label}: ${x.value}`).join(" · ")}</div>}
            {state === "pending" && <ListingChips listing={l} />}
            {state === "approved" && <ApprovedByLine name={l.reviewed_by_name} at={l.reviewed_at} verb="Published" />}
            {state === "rejected" && <RejectedReason reason={l.rejection_reason} />}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {/* View full details — available on every tab, especially Published
                and Rejected where there are no other actions to open the row. */}
            <button onClick={() => setExpandedId(id => id === l.id ? null : l.id)} style={{ background: D.panelBg2, color: D.text, border: `1px solid ${D.divider}`, borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>{expandedId === l.id ? "Close" : "👁 View"}</button>
            {state === "pending" && (
              <>
                <button onClick={() => approve(l.id)} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Approve</button>
                <button onClick={() => setRejectingId(l.id)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
              </>
            )}
            {state === "approved" && canSponsor && isProductListing(l) && <SponsoredToggle id={l.id} name={l.name} sponsored={Boolean(l.sponsored)} onChanged={refetchAll} />}
            {state === "rejected" && <ReviewAgainButton onClick={() => reReview(l.id)} />}
          </div>
        </div>

        {/* Full detail — description, photos, specs and (for a rejected
            listing) the rejection reason. All fields are already on the
            moderation serializer, so no extra fetch. */}
        {expandedId === l.id && (
          <div style={{ marginTop: 10, padding: "12px 14px", background: D.panelBg2, borderRadius: 10, border: `1px solid ${D.divider}` }}>
            {l.description && <div style={{ color: D.textDim, fontSize: "0.74rem", lineHeight: 1.6, marginBottom: 8 }}>{l.description}</div>}
            <div style={{ color: D.textFaint, fontSize: "0.68rem", marginBottom: 8 }}>
              {l.category?.label} • {l.zone?.name} • GHS {l.price_amount}{l.price_unit ? ` ${l.price_unit}` : ""} • 📞 {l.contact_phone}
              {l.service_duration ? ` • ⏱ ${l.service_duration}` : ""}
            </div>
            {(l.specs || []).length > 0 && (
              <div style={{ marginBottom: 8 }}>
                {l.specs.map((s, i) => (
                  <div key={i} style={{ color: D.textDim, fontSize: "0.7rem" }}><b>{s.label}:</b> {s.value}</div>
                ))}
              </div>
            )}
            {(l.photos || []).length > 0 ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {l.photos.map(p => <img key={p.id} src={p.image} alt="" style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: `1px solid ${D.divider}` }} />)}
              </div>
            ) : (
              <div style={{ color: D.textFaint, fontSize: "0.68rem" }}>No photos uploaded.</div>
            )}
            {state === "rejected" && l.rejection_reason && (
              <div style={{ color: D.red, fontSize: "0.72rem", marginTop: 8 }}>Rejection reason: {l.rejection_reason}</div>
            )}
          </div>
        )}
        {rejectingId === l.id && state === "pending" && (
          <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason" style={{ flex: "1 1 160px", minWidth: 0, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
            <button onClick={() => reject(l.id)} disabled={!rejectReason} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: rejectReason ? "pointer" : "default" }}>Confirm reject</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div style={{ ...dim, marginBottom: 10 }}>Listings owners submit themselves. Listings a scout adds for a business come through your Approvals inbox — that approval is their moderation.</div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      <ModerationQueueTabs
        tab={tab}
        onTab={setTab}
        queries={queries}
        title="Listings moderation"
        labels={{ approved: "Published" }}
        renderRow={renderRow}
      />
      <div style={{ ...dim, marginTop: 10 }}>
        {stats ? `This week: ${stats.week_published} published · ${stats.week_rejected} rejected. ` : ""}
        Every decision records who made it, shown on the Published and Rejected tabs.
      </div>
    </>
  );
}

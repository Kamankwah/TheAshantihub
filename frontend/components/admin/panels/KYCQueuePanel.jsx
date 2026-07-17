import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useKYCQueue } from "../../../hooks/useKYCQueue.js";
import { useKYCDetail } from "../../../hooks/useKYCDetail.js";
import { D } from "../theme.js";
import ModerationQueueTabs, {
  ApprovedByLine,
  RejectedReason,
  ReviewAgainButton,
} from "../ModerationQueueTabs.jsx";

// A single labelled field in the detail view. Renders a "—" for empty values
// so a missing/incomplete KYC field is visible rather than silently blank.
function DetailField({ label, value }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ color: D.text, fontSize: "0.78rem", wordBreak: "break-word" }}>{value === true ? "Yes" : value === false ? "No" : (value || "—")}</div>
    </div>
  );
}

// A rendered Ghana-card image (or an empty-state note when the applicant never
// uploaded it). Opens full-size in a new tab on click.
function CardImage({ label, url }) {
  return (
    <div style={{ flex: "1 1 220px" }}>
      <div style={{ color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={label} style={{ width: "100%", maxWidth: 320, borderRadius: 10, border: `1px solid ${D.cardBorder}`, display: "block" }} />
        </a>
      ) : (
        <div style={{ color: D.textDim, fontSize: "0.75rem", padding: "18px 12px", background: D.panelBg2, borderRadius: 10, border: `1px dashed ${D.cardBorder}`, textAlign: "center" }}>Not uploaded</div>
      )}
    </div>
  );
}

function KYCRow({ owner, state, onDone }) {
  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState(null);
  // Optimistic mirror of the address-verify decision, so the Approve/Reject
  // gating updates the instant the staffer clicks without waiting on a
  // refetch. null = no local decision yet (fall back to the server value).
  const [localAddress, setLocalAddress] = useState(null); // null | { verified: bool }
  const detail = useKYCDetail(owner.id, { enabled: expanded });

  const p = detail.data?.profile;
  // Item 8: a Ghana Post address decision (verified ✓ or explicitly wrong)
  // must be recorded before Approve/Reject unlock. The server signals "a
  // decision was made" via address_verified_at; localAddress covers the
  // just-clicked case before the detail refetch lands.
  const serverDecided = p?.address_verified_at != null;
  const addressDecided = localAddress != null || serverDecided;
  const addressVerified = localAddress != null ? localAddress.verified : p?.address_verified;
  const gateReady = expanded && addressDecided;

  const approve = async () => {
    setActionError(null);
    try { await apiPost(`/api/accounts/kyc/${owner.id}/approve/`, {}); onDone(); }
    catch { setActionError("Could not approve this submission. Please try again."); }
  };
  const reject = async () => {
    setActionError(null);
    try { await apiPost(`/api/accounts/kyc/${owner.id}/reject/`, { reason: rejectReason }); setRejecting(false); setRejectReason(""); onDone(); }
    catch { setActionError("Could not reject this submission. Please try again."); }
  };
  const reReview = async () => {
    setActionError(null);
    try { await apiPost(`/api/accounts/kyc/${owner.id}/re-review/`, {}); onDone(); }
    catch { setActionError("Could not send this submission back for re-review."); }
  };
  const verifyAddress = async (verified) => {
    setActionError(null);
    try {
      await apiPost(`/api/accounts/kyc/${owner.id}/address-verify/`, { verified });
      setLocalAddress({ verified });
      detail.refetch();
    } catch { setActionError("Could not record the address verification. Please try again."); }
  };

  return (
    <div style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{owner.full_name}</div>
          <div style={{ color: D.textDim, fontSize: "0.68rem" }}>{owner.login_phone} • submitted {owner.created_at?.slice(0, 10)}</div>
          {state === "approved" && <ApprovedByLine name={owner.reviewed_by_name} at={owner.reviewed_at} verb="Verified" />}
          {state === "rejected" && <RejectedReason reason={owner.kyc_rejection_reason} />}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setExpanded(e => !e)} style={{ background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>{expanded ? "▲ Hide Details" : "👁️ View Details"}</button>
          {state === "pending" && (
            <>
              <button onClick={approve} disabled={!gateReady} title={gateReady ? "" : "Verify the Ghana Post address first"} style={{ background: gateReady ? D.green : D.panelBg2, color: gateReady ? "#fff" : D.textFaint, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: gateReady ? "pointer" : "not-allowed" }}>✓ Approve</button>
              <button onClick={() => setRejecting(true)} disabled={!gateReady} title={gateReady ? "" : "Verify the Ghana Post address first"} style={{ background: gateReady ? "rgba(248,113,113,0.14)" : D.panelBg2, color: gateReady ? D.red : D.textFaint, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: gateReady ? "pointer" : "not-allowed" }}>✕ Reject</button>
            </>
          )}
          {state === "rejected" && <ReviewAgainButton onClick={reReview} />}
        </div>
      </div>

      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginTop: 8 }}>{actionError}</div>}

      {state === "pending" && !gateReady && (
        <div style={{ color: D.amber, fontSize: "0.68rem", marginTop: 6 }}>
          {expanded ? "Verify the Ghana Post address below to enable Approve / Reject." : "Open Details and verify the Ghana Post address to enable Approve / Reject."}
        </div>
      )}

      {rejecting && <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
        <input value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Rejection reason" style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
        <button onClick={reject} disabled={!rejectReason} style={{ background: D.red, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: rejectReason ? "pointer" : "default" }}>Confirm reject</button>
      </div>}

      {expanded && (
        <div style={{ marginTop: 12, padding: 14, background: D.panelBg2, borderRadius: 12, border: `1px solid ${D.cardBorder}` }}>
          {detail.isLoading && <div style={{ color: D.textDim, fontSize: "0.78rem" }}>Loading full details…</div>}
          {detail.isError && <div style={{ color: D.red, fontSize: "0.78rem" }}>Could not load this applicant's details.</div>}
          {detail.data && (
            <>
              <div style={{ color: D.gold, fontWeight: 800, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>Applicant</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0 20px" }}>
                <DetailField label="Full name" value={detail.data.full_name} />
                <DetailField label="Login phone" value={detail.data.login_phone} />
                <DetailField label="Email" value={detail.data.email} />
                <DetailField label="KYC status" value={detail.data.kyc_status} />
                <DetailField label="Business contact phone" value={p?.business_contact_phone} />
                <DetailField label="Business kind" value={p?.business_kind} />
                <DetailField label="Ghana card number" value={p?.ghana_card_number} />
                <DetailField label="GPS (digital) address" value={p?.gps_address} />
                <DetailField label="Formally registered?" value={p?.is_formal} />
                <DetailField label="TIN" value={p?.tin} />
              </div>
              {detail.data.kyc_rejection_reason && <DetailField label="Previous rejection reason" value={detail.data.kyc_rejection_reason} />}

              {/* Item 8: Ghana Post address verification control. */}
              <div style={{ color: D.gold, fontWeight: 800, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", margin: "14px 0 8px" }}>Ghana Post address verification</div>
              <div style={{ color: D.textDim, fontSize: "0.72rem", marginBottom: 8 }}>Confirm the digital address <strong style={{ color: D.text }}>{p?.gps_address || "—"}</strong> before approving or rejecting.</div>
              {addressDecided && (
                <div style={{ color: addressVerified ? D.green : D.red, fontSize: "0.72rem", fontWeight: 700, marginBottom: 8 }}>
                  {addressVerified ? "✓ Address verified" : "✗ Address marked wrong"}
                  {p?.address_verified_by_name ? ` by ${p.address_verified_by_name}` : ""}
                </div>
              )}
              {state === "pending" && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => verifyAddress(true)} style={{ background: addressVerified === true ? D.green : D.panelBg, color: addressVerified === true ? "#fff" : D.green, border: `1px solid ${D.green}`, borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Address verified</button>
                  <button onClick={() => verifyAddress(false)} style={{ background: (addressDecided && !addressVerified) ? D.red : D.panelBg, color: (addressDecided && !addressVerified) ? "#fff" : D.red, border: `1px solid ${D.red}`, borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✗ Address wrong</button>
                </div>
              )}

              <div style={{ color: D.gold, fontWeight: 800, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", margin: "14px 0 10px" }}>Ghana Card</div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <CardImage label="Front" url={p?.ghana_card_front_image} />
                <CardImage label="Back" url={p?.ghana_card_back_image} />
              </div>

              {p?.is_formal && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ color: D.gold, fontWeight: 800, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>Registration document</div>
                  {p?.business_reg_certificate
                    ? <a href={p.business_reg_certificate} target="_blank" rel="noreferrer" style={{ color: D.gold, fontSize: "0.78rem", fontWeight: 700 }}>📄 View business registration certificate</a>
                    : <div style={{ color: D.textDim, fontSize: "0.75rem" }}>No certificate uploaded.</div>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// KYC queue, restructured into Pending / Approved / Rejected tabs (staff
// moderation-queue restructuring, items 1 & 8). Pending keeps the full-detail
// view and adds the Ghana Post address-verification gate on Approve/Reject.
export default function KYCQueuePanel() {
  const [tab, setTab] = useState("pending");
  const pending = useKYCQueue({ status: "pending" });
  const approved = useKYCQueue({ status: "approved" });
  const rejected = useKYCQueue({ status: "rejected" });
  const queries = { pending, approved, rejected };

  const refetchAll = () => { pending.refetch(); approved.refetch(); rejected.refetch(); };

  return (
    <ModerationQueueTabs
      tab={tab}
      onTab={setTab}
      queries={queries}
      title="KYC submissions"
      labels={{ approved: "Verified" }}
      renderRow={(owner, state) => <KYCRow owner={owner} state={state} onDone={refetchAll} />}
    />
  );
}

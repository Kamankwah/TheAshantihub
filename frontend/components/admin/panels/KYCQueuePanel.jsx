import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useKYCQueue } from "../../../hooks/useKYCQueue.js";
import { useKYCDetail } from "../../../hooks/useKYCDetail.js";
import { D, glassCard } from "../theme.js";

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

function KYCRow({ owner, onDone }) {
  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState(null);
  const detail = useKYCDetail(owner.id, { enabled: expanded });

  const approve = async () => {
    setActionError(null);
    try { await apiPost(`/api/accounts/kyc/${owner.id}/approve/`, {}); onDone(); }
    catch (err) { setActionError("Could not approve this submission. Please try again."); }
  };
  const reject = async () => {
    setActionError(null);
    try { await apiPost(`/api/accounts/kyc/${owner.id}/reject/`, { reason: rejectReason }); setRejecting(false); setRejectReason(""); onDone(); }
    catch (err) { setActionError("Could not reject this submission. Please try again."); }
  };

  const p = detail.data?.profile;

  return (
    <div style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{owner.full_name}</div>
          <div style={{ color: D.textDim, fontSize: "0.68rem" }}>{owner.login_phone} • submitted {owner.created_at?.slice(0, 10)}</div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => setExpanded(e => !e)} style={{ background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>{expanded ? "▲ Hide Details" : "👁️ View Details"}</button>
          <button onClick={approve} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Approve</button>
          <button onClick={() => setRejecting(true)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
        </div>
      </div>

      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginTop: 8 }}>{actionError}</div>}

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

export default function KYCQueuePanel() {
  const { data, isLoading, isError, refetch } = useKYCQueue();

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the KYC queue.</div>;
  const items = data || [];

  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 14 }}>Pending KYC submissions ({items.length})</div>
      {items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No pending submissions.</div>}
      {items.map(o => <KYCRow key={o.id} owner={o} onDone={refetch} />)}
    </div>
  );
}

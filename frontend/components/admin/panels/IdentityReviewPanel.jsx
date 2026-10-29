import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useIdentityQueue } from "../../../hooks/useIdentityQueue.js";
import { useKYCDetail } from "../../../hooks/useKYCDetail.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { clockTime, shortDay } from "../../../lib/timeAgo.js";
import { D } from "../theme.js";
import ModerationQueueTabs, {
  ApprovedByLine,
  RejectedReason,
  ReviewAgainButton,
} from "../ModerationQueueTabs.jsx";
import { dim, field } from "./panelStyles.js";

// The identity review: the second KYC queue. The address queue decides the
// Ghana Post address; this one decides whether the owner's identity documents
// (Ghana Card, certificate, TIN) earn the verified check mark. The two
// decisions never change each other, and a business with no documents at all
// simply has nothing here to approve. The registrar and the business's other
// KYC submitters are refused by the server (403) - the refusal text is shown
// as it arrives.

const eyebrow = { color: D.textFaint, fontSize: "0.6rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" };
const NOT_PROVIDED = "Not provided";
const GATE_HINT = "Open the documents to enable Approve and Reject.";

// A missing refusal keeps the server's reason on a 4xx; a server failure keeps
// the generic text.
function refusal(err, fallback) {
  return err?.status >= 400 && err?.status < 500 ? apiErrorMessage(err, fallback) : fallback;
}

function registrationLine(row) {
  if (row.registration_channel === "self") return "Registered online by the owner";
  if (row.registration_channel !== "scout") return null;
  const name = row.registered_by_name || "a staff member";
  const role = row.registered_by_role ? ` (${row.registered_by_role})` : "";
  return `Registered by ${name}${role}`;
}

function Fact({ label, children }) {
  return (
    <div style={{ marginBottom: 8, minWidth: 0 }}>
      <div style={eyebrow}>{label}</div>
      <div style={{ color: D.text, fontSize: "0.78rem", wordBreak: "break-word" }}>{children}</div>
    </div>
  );
}

function Missing() {
  return <span style={{ color: D.textDim }}>{NOT_PROVIDED}</span>;
}

function CardPhoto({ label, url }) {
  return (
    <div style={{ flex: "1 1 220px" }}>
      <div style={{ ...eyebrow, marginBottom: 4 }}>{label}</div>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt={label} style={{ width: "100%", maxWidth: 320, borderRadius: 10, border: `1px solid ${D.cardBorder}`, display: "block" }} />
        </a>
      ) : (
        <div style={{ color: D.textDim, fontSize: "0.75rem", padding: "18px 12px", background: D.panelBg2, borderRadius: 10, border: `1px dashed ${D.cardBorder}`, textAlign: "center" }}>{NOT_PROVIDED}</div>
      )}
    </div>
  );
}

function Documents({ detail }) {
  const p = detail.profile || {};
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0 20px" }}>
        <Fact label="Ghana Card number">{p.ghana_card_number || <Missing />}</Fact>
        <Fact label="Registered business">{p.is_formal ? "Yes" : "No"}</Fact>
        <Fact label="TIN">{p.tin || <Missing />}</Fact>
        <Fact label="Business registration certificate">
          {p.business_reg_certificate
            ? <a href={p.business_reg_certificate} target="_blank" rel="noreferrer" style={{ color: D.deepGold, fontWeight: 700 }}>📄 View business registration certificate</a>
            : <Missing />}
        </Fact>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 4 }}>
        <CardPhoto label="Front" url={p.ghana_card_front_image} />
        <CardPhoto label="Back" url={p.ghana_card_back_image} />
      </div>
    </>
  );
}

function IdentityRow({ row, state, onDone }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState(null);
  const detail = useKYCDetail(row.id, { enabled: expanded });
  const registered = registrationLine(row);
  // A decision is only possible once the documents are open and loaded: this
  // is whether a person's ID earns the verified mark, so never blind. Review
  // again needs no gate.
  const gateReady = expanded && Boolean(detail.data) && !detail.isError;
  // One request at a time: the buttons are disabled while a POST is in flight
  // (the ref also stops a second click that lands before the re-render).
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  // After a decision: the three identity lists refetch (via onDone) and the
  // open documents view is refreshed so the row never shows a stale status.
  const decide = async (path, body, failure, after) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setActionError(null);
    try {
      await apiPost(`/api/accounts/kyc/${row.id}/identity/${path}/`, body);
      after?.();
      queryClient.invalidateQueries({ queryKey: ["kyc-detail", row.id] });
      onDone();
    } catch (err) {
      setActionError(refusal(err, failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const approve = () => decide("approve", {}, "Could not approve this identity. Please try again.");
  const reject = () => decide("reject", { reason: reason.trim() }, "Could not reject this identity. Please try again.", () => { setRejecting(false); setReason(""); });
  const reReview = () => decide("re-review", {}, "Could not send this identity back for review.");

  const submitted = row.identity_submitted_at
    ? `identity submitted ${shortDay(row.identity_submitted_at)}${state === "pending" ? `, ${clockTime(row.identity_submitted_at)}` : ""}`
    : "identity not yet submitted";

  return (
    <div role="group" aria-label={row.full_name} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{row.business_name ? `${row.full_name} · ${row.business_name}` : row.full_name}</div>
          <div style={{ color: D.textDim, fontSize: "0.68rem" }}>{row.login_phone} • {submitted}</div>
          {registered && <div style={{ color: D.textDim, fontSize: "0.68rem" }}>{registered}</div>}
          {state === "approved" && <ApprovedByLine name={row.identity_reviewed_by_name} at={row.identity_reviewed_at} verb="Verified" />}
          {state === "rejected" && (
            <>
              <RejectedReason reason={row.identity_rejection_reason} />
              {(row.identity_reviewed_by_name || row.identity_reviewed_at) && (
                <div style={{ color: D.textDim, fontSize: "0.68rem" }}>
                  {`Decided${row.identity_reviewed_by_name ? ` by ${row.identity_reviewed_by_name}` : ""}${row.identity_reviewed_at ? ` • ${shortDay(row.identity_reviewed_at)}` : ""}`}
                </div>
              )}
            </>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" onClick={() => setExpanded((e) => !e)} style={{ background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{expanded ? "▲ Hide documents" : "👁️ View documents"}</button>
          {state === "pending" && (
            <>
              <button type="button" onClick={approve} disabled={!gateReady || busy} title={gateReady ? "" : GATE_HINT} style={{ background: gateReady ? D.green : D.panelBg2, color: gateReady ? D.cream : D.textFaint, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: gateReady && !busy ? "pointer" : "not-allowed", opacity: busy ? 0.6 : 1, fontFamily: "inherit" }}>✓ Approve</button>
              <button type="button" onClick={() => setRejecting(true)} disabled={!gateReady || busy} title={gateReady ? "" : GATE_HINT} style={{ background: D.panelBg2, color: gateReady ? D.red : D.textFaint, border: `1px solid ${gateReady ? D.red : D.cardBorder}`, borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: gateReady && !busy ? "pointer" : "not-allowed", fontFamily: "inherit" }}>Reject…</button>
            </>
          )}
          {state === "rejected" && <ReviewAgainButton onClick={reReview} disabled={busy} />}
        </div>
      </div>

      {state === "pending" && !gateReady && (
        <div style={{ color: D.amber, fontSize: "0.68rem", marginTop: 6 }}>{GATE_HINT}</div>
      )}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem", marginTop: 8 }}>{actionError}</div>}

      {rejecting && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-start" }}>
          <textarea aria-label="Rejection reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the owner's documents are not accepted (the owner sees this)" style={{ ...field, flex: "1 1 240px", minWidth: 0 }} />
          <button type="button" onClick={reject} disabled={!reason.trim() || busy} style={{ background: D.red, color: D.cream, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: reason.trim() && !busy ? "pointer" : "not-allowed", opacity: reason.trim() && !busy ? 1 : 0.5, fontFamily: "inherit" }}>Confirm reject</button>
          <button type="button" onClick={() => { setRejecting(false); setReason(""); }} style={{ background: "none", border: "none", color: D.textDim, fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: 12, padding: 14, background: D.panelBg2, borderRadius: 12, border: `1px solid ${D.cardBorder}` }}>
          {detail.isLoading && <div style={dim}>Loading the documents…</div>}
          {detail.isError && <div style={{ color: D.red, fontSize: "0.78rem" }}>Could not load this owner's documents.</div>}
          {detail.data && <Documents detail={detail.data} />}
        </div>
      )}
    </div>
  );
}

export default function IdentityReviewPanel() {
  const [tab, setTab] = useState("pending");
  const pending = useIdentityQueue({ status: "pending" });
  const approved = useIdentityQueue({ status: "approved" });
  const rejected = useIdentityQueue({ status: "rejected" });
  const refetchAll = () => { pending.refetch(); approved.refetch(); rejected.refetch(); };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={dim}>Identity documents decide the verified check mark. They are separate from the address check: approving one never changes the other. The person who registered a business, or changed its details, cannot decide its identity.</div>
      <ModerationQueueTabs
        tab={tab}
        onTab={setTab}
        queries={{ pending, approved, rejected }}
        title="Identity documents"
        labels={{ approved: "Verified" }}
        emptyLabel={{ pending: "No identity documents are waiting for review." }}
        renderRow={(row, state) => <IdentityRow row={row} state={state} onDone={refetchAll} />}
      />
    </div>
  );
}

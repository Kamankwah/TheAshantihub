import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useDisputesQueue } from "../../../hooks/useDisputesQueue.js";
import { D } from "../theme.js";
import ModerationQueueTabs, { ReviewAgainButton } from "../ModerationQueueTabs.jsx";

// Dispute status → label+color, dark-surface hues (same shape as
// ESCROW_STATUS_META/CONTACT_STATUS_META in theme.js, kept local since it's
// this panel's only consumer). Still needed on the Pending tab, which holds
// two distinct statuses (open and investigating) the tab name can't convey.
const DISPUTE_STATUS_META = {
  open: { label: "Open", color: D.blue },
  investigating: { label: "Investigating", color: D.amber },
  resolved: { label: "Resolved", color: D.green },
  rejected: { label: "Rejected", color: D.red },
};

// Disputes staff panel (disputes app), restructured onto the shared
// Pending/Approved/Rejected shell (punch-list item 7). Per-row actions stay
// gated by which permission the session holds. `disputes.flag` unlocks
// "🚩 Flag" (open→investigating only — an already-investigating dispute has
// nothing left to flag). `disputes.resolve_financial` unlocks "✓ Resolve" (a
// reveal-a-form-on-click inline refund_amount/resolution_notes pair, same
// pattern HeroApprovalPanel's reject flow uses) and "✕ Reject".
//
// Tabs map four statuses onto three: Pending = open+investigating (still
// being worked), Resolved = the approved-equivalent, Rejected = its
// counterpart. Only a *rejected* dispute can be reopened — a resolved one may
// have moved money, so it stays final (see DisputeReReviewView).
function DisputeRow({ dispute, state, canFlag, canResolve, onDone }) {
  const [resolving, setResolving] = useState(false);
  const [refund, setRefund] = useState("");
  const [notes, setNotes] = useState("");
  const [actionError, setActionError] = useState(null);

  const statusMeta = DISPUTE_STATUS_META[dispute.status] || { label: dispute.status, color: D.textDim };

  const flag = async () => {
    setActionError(null);
    try { await apiPost(`/api/disputes/${dispute.id}/flag/`, {}); onDone(); }
    catch { setActionError("Could not flag this dispute."); }
  };
  const resolve = async (outcome) => {
    setActionError(null);
    try {
      await apiPost(`/api/disputes/${dispute.id}/resolve/`, {
        outcome,
        refund_amount: refund || null,
        resolution_notes: notes || "",
      });
      setResolving(false);
      onDone();
    } catch { setActionError("Could not resolve this dispute."); }
  };
  const reopen = async () => {
    setActionError(null);
    try { await apiPost(`/api/disputes/${dispute.id}/re-review/`, {}); onDone(); }
    catch { setActionError("Could not reopen this dispute."); }
  };

  return (
    <div style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>
            {dispute.order ? `Order #${dispute.order}` : "No order attached"}{" "}
            <span style={{ color: D.textDim, fontWeight: 400 }}>({dispute.reason?.replace("_", " ")})</span>
            {/* Pending holds both open and investigating — the badge is what
                tells them apart, so it stays on that tab. */}
            {state === "pending" && (
              <span style={{ background: `${statusMeta.color}22`, color: statusMeta.color, borderRadius: 20, padding: "2px 8px", fontSize: "0.6rem", fontWeight: 700, marginLeft: 6 }}>{statusMeta.label}</span>
            )}
          </div>
          {dispute.description && (
            <div style={{ color: D.textDim, fontSize: "0.75rem", margin: "4px 0", maxWidth: 420 }}>"{dispute.description}"</div>
          )}
          <div style={{ color: D.textDim, fontSize: "0.65rem" }}>
            Raised by {dispute.raised_by_name || "—"} • {dispute.created_at?.slice(0, 10)}
            {dispute.order_total_amount != null && ` • Order total GHS ${dispute.order_total_amount}`}
          </div>
          {dispute.flagged_by_name && (
            <div style={{ color: D.textDim, fontSize: "0.65rem", marginTop: 2 }}>Flagged by {dispute.flagged_by_name}</div>
          )}
          {state !== "pending" && (
            <div style={{ color: state === "approved" ? D.green : D.red, fontSize: "0.68rem", fontWeight: 700, marginTop: 4 }}>
              {state === "approved" ? "✓ Resolved" : "✕ Rejected"} by {dispute.resolved_by_name || "—"}
              {dispute.updated_at ? ` • ${dispute.updated_at.slice(0, 10)}` : ""}
              {dispute.refund_amount != null && ` • Refund GHS ${dispute.refund_amount}`}
              {dispute.resolution_notes && ` • ${dispute.resolution_notes}`}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {state === "pending" && canFlag && dispute.status === "open" && (
            <button onClick={flag} style={{ background: "rgba(96,165,250,0.16)", color: D.blue, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>🚩 Flag</button>
          )}
          {state === "pending" && canResolve && (
            <>
              <button onClick={() => setResolving(r => !r)} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Resolve</button>
              <button onClick={() => resolve("rejected")} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
            </>
          )}
          {state === "rejected" && canResolve && <ReviewAgainButton onClick={reopen} />}
        </div>
      </div>

      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginTop: 8 }}>{actionError}</div>}

      {resolving && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input value={refund} onChange={e => setRefund(e.target.value)} placeholder="Refund amount (optional)" style={{ width: 160, padding: "5px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.72rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
          <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Resolution notes (optional)" style={{ flex: 1, minWidth: 160, padding: "5px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.72rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
          <button onClick={() => resolve("resolved")} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>Confirm resolve</button>
        </div>
      )}
    </div>
  );
}

export default function DisputesPanel({ auth }) {
  const [tab, setTab] = useState("pending");
  const pending = useDisputesQueue({ status: "pending" });
  const approved = useDisputesQueue({ status: "approved" });
  const rejected = useDisputesQueue({ status: "rejected" });
  const queries = { pending, approved, rejected };

  const canFlag = auth.hasPermission("disputes.flag");
  const canResolve = auth.hasPermission("disputes.resolve_financial");

  const refetchAll = () => { pending.refetch(); approved.refetch(); rejected.refetch(); };

  return (
    <ModerationQueueTabs
      tab={tab}
      onTab={setTab}
      queries={queries}
      title="Disputes"
      // Pending keeps its default label: this tab holds both `open` and
      // `investigating`, so calling it "Open" would name only half of it —
      // and would collide with the per-row "Open" status badge.
      labels={{ approved: "Resolved" }}
      emptyLabel={{ pending: "No disputes need attention." }}
      renderRow={(dispute, state) => (
        <DisputeRow
          dispute={dispute}
          state={state}
          canFlag={canFlag}
          canResolve={canResolve}
          onDone={refetchAll}
        />
      )}
    />
  );
}

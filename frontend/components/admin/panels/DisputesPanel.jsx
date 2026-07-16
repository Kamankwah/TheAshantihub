import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useDisputesQueue } from "../../../hooks/useDisputesQueue.js";
import { D, glassCard } from "../theme.js";

// Dispute status → label+color, dark-surface hues (same shape as
// ESCROW_STATUS_META/CONTACT_STATUS_META in theme.js, kept local since it's
// this panel's only consumer).
const DISPUTE_STATUS_META = {
  open: { label: "Open", color: D.blue },
  investigating: { label: "Investigating", color: D.amber },
  resolved: { label: "Resolved", color: D.green },
  rejected: { label: "Rejected", color: D.red },
};

const FINAL_STATUSES = ["resolved", "rejected"];

// Disputes staff panel (disputes app). Clones EscrowLedgerPanel's shape
// closely — paginated queue, per-row conditional actions gated by which
// permission the session has, actionError+refetch(). `disputes.flag`
// unlocks "🚩 Flag" (open→investigating only — an already-investigating
// dispute has nothing left to flag). `disputes.resolve_financial` unlocks
// "✓ Resolve" (a reveal-a-form-on-click inline refund_amount/
// resolution_notes pair, same pattern HeroApprovalPanel's reject flow uses)
// and "✕ Reject" on any non-terminal (open/investigating) dispute. A
// terminal dispute (resolved/rejected) shows no actions at all, same
// "final state" convention ContactMessagesPanel/EscrowLedgerPanel already
// follow for their own terminal states.
export default function DisputesPanel({ auth }) {
  const { data, isLoading, isError, refetch } = useDisputesQueue();
  const [resolvingId, setResolvingId] = useState(null);
  const [refundById, setRefundById] = useState({});
  const [notesById, setNotesById] = useState({});
  const [actionError, setActionError] = useState(null);

  const canFlag = auth.hasPermission("disputes.flag");
  const canResolve = auth.hasPermission("disputes.resolve_financial");

  const flag = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/disputes/${id}/flag/`, {}); refetch(); }
    catch (err) { setActionError("Could not flag this dispute."); }
  };
  const resolve = async (id, outcome) => {
    setActionError(null);
    try {
      await apiPost(`/api/disputes/${id}/resolve/`, {
        outcome,
        refund_amount: refundById[id] || null,
        resolution_notes: notesById[id] || "",
      });
      setResolvingId(null);
      refetch();
    } catch (err) { setActionError("Could not resolve this dispute."); }
  };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the disputes queue.</div>;
  const items = data?.results || [];

  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 14 }}>Disputes ({data?.count ?? items.length})</div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      {items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No disputes yet.</div>}
      {items.map(dsp => {
        const statusMeta = DISPUTE_STATUS_META[dsp.status] || { label: dsp.status, color: D.textDim };
        const isTerminal = FINAL_STATUSES.includes(dsp.status);
        return (
          <div key={dsp.id} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>
                  {dsp.order ? `Order #${dsp.order}` : "No order attached"} <span style={{ color: D.textDim, fontWeight: 400 }}>({dsp.reason?.replace("_", " ")})</span>
                  <span style={{ background: `${statusMeta.color}22`, color: statusMeta.color, borderRadius: 20, padding: "2px 8px", fontSize: "0.6rem", fontWeight: 700, marginLeft: 6 }}>{statusMeta.label}</span>
                </div>
                {dsp.description && <div style={{ color: D.textDim, fontSize: "0.75rem", margin: "4px 0", maxWidth: 420 }}>"{dsp.description}"</div>}
                <div style={{ color: D.textDim, fontSize: "0.65rem" }}>
                  Raised by {dsp.raised_by_name || "—"} • {dsp.created_at?.slice(0, 10)}
                  {dsp.order_total_amount != null && ` • Order total GHS ${dsp.order_total_amount}`}
                </div>
                {dsp.flagged_by_name && <div style={{ color: D.textDim, fontSize: "0.65rem", marginTop: 2 }}>Flagged by {dsp.flagged_by_name}</div>}
                {isTerminal && (
                  <div style={{ color: dsp.status === "resolved" ? D.green : D.red, fontSize: "0.65rem", marginTop: 2 }}>
                    {dsp.status === "resolved" ? "Resolved" : "Rejected"} by {dsp.resolved_by_name || "—"}
                    {dsp.refund_amount != null && ` • Refund GHS ${dsp.refund_amount}`}
                    {dsp.resolution_notes && ` • ${dsp.resolution_notes}`}
                  </div>
                )}
              </div>
              {!isTerminal && (canFlag || canResolve) && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  {canFlag && dsp.status === "open" && (
                    <button onClick={() => flag(dsp.id)} style={{ background: "rgba(96,165,250,0.16)", color: D.blue, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>🚩 Flag</button>
                  )}
                  {canResolve && (
                    <>
                      <button onClick={() => setResolvingId(resolvingId === dsp.id ? null : dsp.id)} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Resolve</button>
                      <button onClick={() => resolve(dsp.id, "rejected")} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
                    </>
                  )}
                </div>
              )}
            </div>
            {resolvingId === dsp.id && (
              <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input value={refundById[dsp.id] || ""} onChange={e => setRefundById(r => ({ ...r, [dsp.id]: e.target.value }))} placeholder="Refund amount (optional)" style={{ width: 160, padding: "5px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.72rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
                <input value={notesById[dsp.id] || ""} onChange={e => setNotesById(n => ({ ...n, [dsp.id]: e.target.value }))} placeholder="Resolution notes (optional)" style={{ flex: 1, minWidth: 160, padding: "5px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.72rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
                <button onClick={() => resolve(dsp.id, "resolved")} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>Confirm resolve</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

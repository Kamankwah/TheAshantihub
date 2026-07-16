import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useEventPricingTiersAdmin } from "../../../hooks/useEventPricingTiersAdmin.js";
import { D, glassCard } from "../theme.js";

// Event Pricing staff panel (event pricing tiers work) — clones
// EscrowLedgerPanel's dual-permission-gating shape: an accountant (holding
// event_pricing.manage) can propose a new price per tier; a super_admin
// (holding event_pricing.approve) can approve or reject any pending
// proposal. Both roles can view the list; action UI is per-permission.
export default function EventPricingPanel({ auth }) {
  const { data, isLoading, isError, refetch } = useEventPricingTiersAdmin();
  const [draftById, setDraftById] = useState({});
  const [actionError, setActionError] = useState(null);

  const canPropose = auth.hasPermission("event_pricing.manage");
  const canApprove = auth.hasPermission("event_pricing.approve");

  const propose = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/events/pricing-tiers/${id}/propose/`, { price: draftById[id] }); setDraftById(d => ({ ...d, [id]: "" })); refetch(); }
    catch (err) { setActionError("Could not propose this price."); }
  };
  const approve = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/events/pricing-tiers/${id}/approve/`, {}); refetch(); }
    catch (err) { setActionError("Could not approve this change."); }
  };
  const reject = async (id) => {
    setActionError(null);
    try { await apiPost(`/api/events/pricing-tiers/${id}/reject/`, {}); refetch(); }
    catch (err) { setActionError("Could not reject this change."); }
  };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load pricing tiers.</div>;
  const tiers = data || [];

  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 14 }}>Event Pricing Tiers</div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      {tiers.map(t => (
        <div key={t.id} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{t.duration_days} days — GHS {t.live_price}</div>
          {t.pending_price && <div style={{ color: D.amber, fontSize: "0.72rem", marginTop: 4 }}>Pending: GHS {t.pending_price}{t.proposed_by_name ? ` (proposed by ${t.proposed_by_name})` : ""}</div>}
          {canPropose && <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <input value={draftById[t.id] || ""} onChange={e => setDraftById(d => ({ ...d, [t.id]: e.target.value }))} placeholder="New price" style={{ width: 100, padding: "5px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.72rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
            <button onClick={() => propose(t.id)} disabled={!draftById[t.id]} style={{ background: D.gold, color: "#1a1205", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: draftById[t.id] ? "pointer" : "default" }}>Propose</button>
          </div>}
          {canApprove && t.pending_price && <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
            <button onClick={() => approve(t.id)} style={{ background: D.green, color: "#fff", border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✓ Approve</button>
            <button onClick={() => reject(t.id)} style={{ background: "rgba(248,113,113,0.14)", color: D.red, border: "none", borderRadius: 20, padding: "5px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer" }}>✕ Reject</button>
          </div>}
        </div>
      ))}
    </div>
  );
}

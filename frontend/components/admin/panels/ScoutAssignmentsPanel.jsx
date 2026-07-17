import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useScoutAssignments } from "../../../hooks/useScoutAssignments.js";
import { useScouts } from "../../../hooks/useScouts.js";
import { useBusinessOwners } from "../../../hooks/useBusinessOwners.js";
import { D, glassCard } from "../theme.js";

// Admin-side scout assignment (punch-list item 11, scouts.assign): assign a
// scout to a business for field verification, and track every assignment's
// status. The scout then works their queue in the Field Verification tab.
const inputStyle = { padding: "8px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.78rem", fontFamily: "inherit", background: D.panelBg2, color: D.text };
const pillBtn = { border: "none", borderRadius: 20, padding: "8px 16px", fontSize: "0.76rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

export default function ScoutAssignmentsPanel() {
  const assignments = useScoutAssignments();
  const scouts = useScouts();
  const owners = useBusinessOwners();
  const [businessId, setBusinessId] = useState("");
  const [scoutId, setScoutId] = useState("");
  const [actionError, setActionError] = useState(null);

  const assign = async () => {
    if (!businessId || !scoutId) return;
    setActionError(null);
    try {
      await apiPost("/api/accounts/scout-assignments/", { business_owner: Number(businessId), scout: Number(scoutId) });
      setBusinessId(""); setScoutId("");
      assignments.refetch();
    } catch (err) {
      setActionError(err?.body?.detail || "Could not assign that scout. They may already be assigned to this business.");
    }
  };

  const rows = assignments.data?.results || [];

  return (
    <div>
      <div style={{ ...glassCard, padding: 18, marginBottom: 16 }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 12 }}>Assign a scout</div>
        {actionError && <div style={{ color: D.red, fontSize: "0.76rem", marginBottom: 10 }}>{actionError}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select value={businessId} onChange={e => setBusinessId(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 160 }}>
            <option value="">Business…</option>
            {(owners.data?.results || []).map(o => (
              <option key={o.id} value={o.id}>{o.full_name} ({o.kyc_status})</option>
            ))}
          </select>
          <select value={scoutId} onChange={e => setScoutId(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 140 }}>
            <option value="">Scout…</option>
            {(scouts.data || []).map(s => (
              <option key={s.id} value={s.id}>{s.full_name}</option>
            ))}
          </select>
          <button onClick={assign} disabled={!businessId || !scoutId} style={{ ...pillBtn, background: businessId && scoutId ? D.gold : D.panelBg2, color: businessId && scoutId ? "#1a1205" : D.textFaint, cursor: businessId && scoutId ? "pointer" : "default" }}>Assign</button>
        </div>
        {(scouts.data || []).length === 0 && <div style={{ color: D.amber, fontSize: "0.72rem", marginTop: 8 }}>No scouts exist yet — invite a staff member with the Scout role first.</div>}
      </div>

      <div style={{ ...glassCard, padding: 18 }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 10 }}>Assignments</div>
        {assignments.isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
        {rows.length === 0 && !assignments.isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No assignments yet.</div>}
        {rows.map(a => (
          <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${D.divider}`, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: D.text, fontWeight: 700, fontSize: "0.8rem" }}>{a.business_owner_name}</div>
              <div style={{ color: D.textDim, fontSize: "0.68rem" }}>Scout: {a.scout_name}{a.visited_at ? ` · visited ${a.visited_at.slice(0, 10)}` : ""}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {a.status === "visited" && a.address_confirmed != null && (
                <span style={{ color: a.address_confirmed ? D.green : D.red, fontSize: "0.68rem", fontWeight: 700 }}>
                  {a.address_confirmed ? "✓ Address confirmed" : "✗ Address wrong"}
                </span>
              )}
              <span style={{ background: a.status === "visited" ? `${D.green}22` : `${D.amber}22`, color: a.status === "visited" ? D.green : D.amber, borderRadius: 20, padding: "2px 10px", fontSize: "0.64rem", fontWeight: 800 }}>{a.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

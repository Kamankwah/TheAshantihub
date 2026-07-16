import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useStaffRoster } from "../../../hooks/useStaffRoster.js";
import { D, glassCard, STAFF_STATUS_COLORS } from "../theme.js";

// Staff onboarding work — a staff-roster row can be resent an invite while
// its status is "invited" (still pending, hasn't activated yet) or
// "invite_expired" (the invite_token's lifetime lapsed before they used it);
// an "active" row has nothing to resend. Mirrors StaffListSerializer's
// get_status() values (backend/accounts/serializers.py) exactly.
const RESENDABLE_STATUSES = new Set(["invited", "invite_expired"]);

export default function StaffManagementPanel() {
  const { data, isLoading, isError, refetch } = useStaffRoster();
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [actionError, setActionError] = useState(null);
  // Per-row "sent!" confirmation (staff onboarding work) — keyed by staff id
  // so multiple rows can independently show their own brief confirmation
  // without a shared/global toast.
  const [resentIds, setResentIds] = useState(new Set());
  const [resendingId, setResendingId] = useState(null);

  const sendInvite = async () => {
    if (!inviteName || !inviteEmail || !inviteRole) return;
    setActionError(null);
    try {
      await apiPost("/api/accounts/staff/invite/", { full_name: inviteName, email: inviteEmail, role: inviteRole });
      setInviteName(""); setInviteEmail(""); setInviteRole("");
      refetch();
    } catch (err) { setActionError("Could not send the invite. Check the details and try again."); }
  };

  const resendInvite = async (id) => {
    setActionError(null);
    setResendingId(id);
    try {
      await apiPost(`/api/accounts/staff/${id}/resend-invite/`, {});
      setResentIds(prev => new Set(prev).add(id));
      refetch();
    } catch (err) {
      setActionError("Could not resend the invite. Please try again.");
    } finally {
      setResendingId(null);
    }
  };

  return (
    <div>
      <div style={{ ...glassCard, padding: 18, marginBottom: 16 }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 12 }}>Invite a staff member</div>
        {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Full name" style={{ flex: 1, minWidth: 120, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
          <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="Email" style={{ flex: 1, minWidth: 120, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
          <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} style={{ width: 120, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }}>
            <option value="">Role</option>
            <option value="super_admin">Super Admin</option>
            <option value="admin">Admin</option>
            <option value="accountant">Accountant</option>
            <option value="marketing">Marketing</option>
            <option value="support">Support</option>
          </select>
          <button onClick={sendInvite} style={{ background: D.gold, color: "#1a1205", border: "none", borderRadius: 20, padding: "6px 14px", fontSize: "0.72rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Send invite</button>
        </div>
      </div>

      {isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the staff roster.</div>}
      {data && <div style={{ ...glassCard, padding: 18 }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 10 }}>{data.count} staff members</div>
        {data.results.map(s => (
          <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: `1px solid ${D.divider}` }}>
            <div>
              <div style={{ color: D.text, fontWeight: 700, fontSize: "0.8rem" }}>{s.full_name}</div>
              <div style={{ color: D.textDim, fontSize: "0.68rem" }}>{s.email} • {s.role}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ background: `${STAFF_STATUS_COLORS[s.status]}22`, color: STAFF_STATUS_COLORS[s.status], borderRadius: 20, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 700 }}>{s.status}</span>
              {RESENDABLE_STATUSES.has(s.status) && (
                resentIds.has(s.id) ? (
                  <span style={{ color: D.green, fontSize: "0.66rem", fontWeight: 700 }}>✓ Sent!</span>
                ) : (
                  <button onClick={() => resendInvite(s.id)} disabled={resendingId === s.id} style={{ background: "none", border: `1.5px solid ${D.gold}`, color: D.gold, borderRadius: 20, padding: "3px 10px", fontSize: "0.66rem", fontWeight: 700, cursor: resendingId === s.id ? "default" : "pointer", fontFamily: "inherit", opacity: resendingId === s.id ? 0.6 : 1 }}>
                    {resendingId === s.id ? "Sending…" : "Resend"}
                  </button>
                )
              )}
            </div>
          </div>
        ))}
      </div>}
    </div>
  );
}

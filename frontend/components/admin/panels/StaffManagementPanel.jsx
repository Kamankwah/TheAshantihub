import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useStaffRoster } from "../../../hooks/useStaffRoster.js";
import { D, glassCard, STAFF_STATUS_COLORS } from "../theme.js";

export default function StaffManagementPanel() {
  const { data, isLoading, isError, refetch } = useStaffRoster();
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [actionError, setActionError] = useState(null);

  const sendInvite = async () => {
    if (!inviteName || !inviteEmail || !inviteRole) return;
    setActionError(null);
    try {
      await apiPost("/api/accounts/staff/invite/", { full_name: inviteName, email: inviteEmail, role: inviteRole });
      setInviteName(""); setInviteEmail(""); setInviteRole("");
      refetch();
    } catch (err) { setActionError("Could not send the invite. Check the details and try again."); }
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
            <span style={{ background: `${STAFF_STATUS_COLORS[s.status]}22`, color: STAFF_STATUS_COLORS[s.status], borderRadius: 20, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 700 }}>{s.status}</span>
          </div>
        ))}
      </div>}
    </div>
  );
}

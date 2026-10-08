import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useMyTeam } from "../../../hooks/useMyTeam.js";
import { useInvitableRoles } from "../../../hooks/useInvitableRoles.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { LastSignIn } from "./sessionParts.jsx";

const ROLE_LABELS = { super_admin: "Super Admin", operations: "Operations", accountant: "Accountant", marketing: "Marketing", support: "Support", scout: "Scout", delivery_manager: "Delivery Manager", dispatch: "Dispatch" };
const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: "#fff" };
const labelStyle = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text };
const smallBtn = (bg, color) => ({ background: bg, color, border: bg === "#fff" ? `1px solid ${D.cardBorder}` : "none", borderRadius: 20, padding: "6px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });

export default function MyTeamPanel({ currentStaffId }) {
  const { data: team, isLoading, isError, refetch } = useMyTeam();
  const { data: roles } = useInvitableRoles();
  const [invite, setInvite] = useState({ full_name: "", email: "", role: "" });
  const [reasons, setReasons] = useState({});
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const chosenRole = invite.role || (roles || [])[0] || "";

  const run = async (fn, okText, errText) => {
    setActionError(null); setMessage(null);
    try { await fn(); setMessage(okText); refetch(); }
    catch (err) { setActionError(apiErrorMessage(err, errText)); }
  };
  const sendInvite = (e) => {
    e.preventDefault();
    if (!chosenRole) return;
    run(async () => {
      await apiPost("/api/accounts/staff/invite/", { full_name: invite.full_name.trim(), email: invite.email.trim(), role: chosenRole, ...(currentStaffId ? { manager: currentStaffId } : {}) });
      setInvite({ full_name: "", email: "", role: "" });
    }, "Invite sent.", "Could not send the invite. Check the email isn't already used.");
  };

  const members = team || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <form onSubmit={sendInvite} style={{ ...glassCard, padding: 18, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ width: "100%", color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Invite to your team</div>
        <label style={{ ...labelStyle, flex: "1 1 200px" }}>Full name<input value={invite.full_name} onChange={(e) => setInvite({ ...invite, full_name: e.target.value })} style={field} required /></label>
        <label style={{ ...labelStyle, flex: "1 1 220px" }}>Email<input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} style={field} required /></label>
        {roles && roles.length === 0
          ? <div style={{ color: D.textDim, fontSize: "0.8rem", alignSelf: "center" }}>You can't invite anyone yet.</div>
          : <label style={labelStyle}>Role<select value={chosenRole} onChange={(e) => setInvite({ ...invite, role: e.target.value })} style={field}>{(roles || []).map((r) => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}</select></label>}
        <button type="submit" disabled={!chosenRole} style={{ opacity: chosenRole ? 1 : 0.5, background: D.gold, color: D.text, border: "none", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>Send invite</button>
        <div style={{ width: "100%", color: D.textDim, fontSize: "0.72rem" }}>They get an email link to set their password. The link works for 7 days and you can resend it.</div>
      </form>
      {message && <div style={{ color: D.green, fontSize: "0.8rem" }}>{message}</div>}
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      <div style={{ ...glassCard, padding: 18 }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem", marginBottom: 8 }}>My team ({members.length})</div>
        {isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>}
        {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your team.</div>}
        {!isLoading && !isError && members.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Nobody reports to you yet.</div>}
        {members.map((m) => (
          <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "10px 0", borderTop: `1px solid ${D.divider}` }}>
            <div>
              <div style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>{m.full_name} <span style={{ color: D.textDim, fontWeight: 400 }}>· {ROLE_LABELS[m.role] || m.role} · {m.status}</span></div>
              <div style={{ color: D.textDim, fontSize: "0.72rem" }}>{m.email}</div>
              <LastSignIn staff={m} />
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {(m.status === "invited" || m.status === "invite_expired") && <button type="button" aria-label={`Resend invite to ${m.full_name}`} onClick={() => run(() => apiPost(`/api/accounts/staff/${m.id}/resend-invite/`, {}), "Invite resent.", "Could not resend the invite.")} style={smallBtn("#fff", D.text)}>Resend invite</button>}
              {m.status === "active" && (
                <>
                  <input aria-label={`Reason for suspending ${m.full_name}`} placeholder="Reason" value={reasons[m.id] || ""} onChange={(e) => setReasons({ ...reasons, [m.id]: e.target.value })} style={{ ...field, padding: "6px 8px", fontSize: "0.75rem" }} />
                  <button type="button" aria-label={`Suspend ${m.full_name}`} onClick={() => run(() => apiPost(`/api/accounts/staff/${m.id}/suspend/`, { reason: reasons[m.id] || "" }), `${m.full_name} is suspended.`, "Could not suspend.")} style={smallBtn(D.red, "#fff")}>Suspend</button>
                </>
              )}
              {m.status === "suspended" && <button type="button" aria-label={`Unsuspend ${m.full_name}`} onClick={() => run(() => apiPost(`/api/accounts/staff/${m.id}/unsuspend/`, {}), `${m.full_name} is active again.`, "Could not unsuspend.")} style={smallBtn(D.green, "#fff")}>Unsuspend</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

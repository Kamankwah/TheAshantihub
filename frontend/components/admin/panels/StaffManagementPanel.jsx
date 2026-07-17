import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useStaffRoster } from "../../../hooks/useStaffRoster.js";
import { usePermissionCatalog } from "../../../hooks/usePermissionCatalog.js";
import { D, glassCard, STAFF_STATUS_COLORS } from "../theme.js";

// Staff onboarding work — a staff-roster row can be resent an invite while
// its status is "invited" (still pending, hasn't activated yet) or
// "invite_expired" (the invite_token's lifetime lapsed before they used it);
// an "active" row has nothing to resend. Mirrors StaffListSerializer's
// get_status() values (backend/accounts/serializers.py) exactly.
const RESENDABLE_STATUSES = new Set(["invited", "invite_expired"]);

const pillBtn = { border: "none", borderRadius: 20, padding: "4px 11px", fontSize: "0.66rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };

// Per-staffer permission editor (punch-list item 9). Effective set =
// role permissions + individual grants − individual revocations. The catalog
// tells us each permission's description and the row's `permissions` field is
// the current effective set, so a checkbox is checked iff the permission is
// currently effective; toggling it off a role-granted permission produces a
// revoke, toggling on a non-role permission produces a grant.
function PermissionEditor({ staff, roleCodenames, onDone }) {
  const catalog = usePermissionCatalog({ enabled: true });
  const [effective, setEffective] = useState(() => new Set(staff.permissions || []));
  const [actionError, setActionError] = useState(null);
  const [saving, setSaving] = useState(false);

  const toggle = (codename) => {
    setEffective(prev => {
      const next = new Set(prev);
      next.has(codename) ? next.delete(codename) : next.add(codename);
      return next;
    });
  };

  const save = async () => {
    setActionError(null);
    setSaving(true);
    // Derive grant/revoke from the desired effective set vs the role's own set:
    // a wanted permission the role doesn't grant is a grant; a role permission
    // the staffer no longer wants is a revoke. Everything else needs no override.
    const grant = [...effective].filter(c => !roleCodenames.has(c));
    const revoke = [...roleCodenames].filter(c => !effective.has(c));
    try {
      await apiPost(`/api/accounts/staff/${staff.id}/permissions/`, { grant, revoke });
      onDone();
    } catch { setActionError("Could not save these permissions. Please try again."); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ marginTop: 10, padding: 14, background: D.panelBg2, borderRadius: 12, border: `1px solid ${D.cardBorder}` }}>
      <div style={{ color: D.gold, fontWeight: 800, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Permissions for {staff.full_name}</div>
      <div style={{ color: D.textFaint, fontSize: "0.62rem", marginBottom: 10 }}>Checked = currently allowed. Role-granted permissions are marked; unchecking one revokes it for this person only.</div>
      {catalog.isLoading && <div style={{ color: D.textDim, fontSize: "0.75rem" }}>Loading permissions…</div>}
      {catalog.isError && <div style={{ color: D.red, fontSize: "0.75rem" }}>Could not load the permission list.</div>}
      {catalog.data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "2px 16px" }}>
          {catalog.data.map(p => {
            const fromRole = roleCodenames.has(p.codename);
            return (
              <label key={p.codename} style={{ display: "flex", alignItems: "flex-start", gap: 7, padding: "4px 0", cursor: "pointer", fontSize: "0.72rem", color: D.text }}>
                <input type="checkbox" checked={effective.has(p.codename)} onChange={() => toggle(p.codename)} style={{ marginTop: 2 }} />
                <span>
                  <span style={{ fontWeight: 700 }}>{p.codename}</span>
                  {fromRole && <span style={{ color: D.gold, fontSize: "0.58rem", fontWeight: 800, marginLeft: 5, textTransform: "uppercase" }}>role</span>}
                  <span style={{ display: "block", color: D.textDim, fontSize: "0.64rem" }}>{p.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
      {actionError && <div style={{ color: D.red, fontSize: "0.75rem", marginTop: 8 }}>{actionError}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={save} disabled={saving} style={{ ...pillBtn, background: D.gold, color: "#1a1205", opacity: saving ? 0.6 : 1 }}>{saving ? "Saving…" : "Save permissions"}</button>
        <button onClick={onDone} style={{ ...pillBtn, background: D.panelBg, color: D.textDim, border: `1px solid ${D.cardBorder}` }}>Close</button>
      </div>
    </div>
  );
}

function StaffRow({ staff, onResend, resent, resending, onChanged }) {
  const [suspending, setSuspending] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [editingPerms, setEditingPerms] = useState(false);
  const [actionError, setActionError] = useState(null);

  // The role's own permission set (from the roster serializer). The editor
  // diffs the desired effective set against this to compute grant/revoke —
  // an effective permission NOT in here is an individual grant that must be
  // preserved, which is exactly why the role set has to be known, not guessed.
  const roleCodenames = new Set(staff.role_permissions || []);

  const act = async (verb, body) => {
    setActionError(null);
    try { await apiPost(`/api/accounts/staff/${staff.id}/${verb}/`, body || {}); setSuspending(false); setSuspendReason(""); onChanged(); }
    catch { setActionError(`Could not ${verb} this staff member. Please try again.`); }
  };

  const isSuspended = staff.status === "suspended";
  const isDeactivated = staff.status === "deactivated";

  return (
    <div style={{ padding: "9px 0", borderBottom: `1px solid ${D.divider}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 700, fontSize: "0.8rem" }}>{staff.full_name}</div>
          <div style={{ color: D.textDim, fontSize: "0.68rem" }}>{staff.email} • {staff.role}</div>
          {isSuspended && staff.suspension_reason && <div style={{ color: D.red, fontSize: "0.64rem", marginTop: 2 }}>Reason: {staff.suspension_reason}</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ background: `${STAFF_STATUS_COLORS[staff.status]}22`, color: STAFF_STATUS_COLORS[staff.status], borderRadius: 20, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 700 }}>{staff.status}</span>
          {RESENDABLE_STATUSES.has(staff.status) && (
            resent ? (
              <span style={{ color: D.green, fontSize: "0.66rem", fontWeight: 700 }}>✓ Sent!</span>
            ) : (
              <button onClick={() => onResend(staff.id)} disabled={resending} style={{ ...pillBtn, background: "none", border: `1.5px solid ${D.gold}`, color: D.gold, opacity: resending ? 0.6 : 1 }}>{resending ? "Sending…" : "Resend"}</button>
            )
          )}
          <button onClick={() => setEditingPerms(e => !e)} style={{ ...pillBtn, background: D.panelBg2, color: D.text, border: `1px solid ${D.cardBorder}` }}>🔑 Permissions</button>
          {isSuspended
            ? <button onClick={() => act("unsuspend")} style={{ ...pillBtn, background: D.green, color: "#fff" }}>↩️ Unsuspend</button>
            : <button onClick={() => setSuspending(s => !s)} style={{ ...pillBtn, background: "rgba(248,113,113,0.14)", color: D.red }}>🚫 Suspend</button>}
          {isDeactivated
            ? <button onClick={() => act("reactivate")} style={{ ...pillBtn, background: D.green, color: "#fff" }}>↩️ Reactivate</button>
            : <button onClick={() => act("deactivate")} style={{ ...pillBtn, background: D.panelBg2, color: D.textDim, border: `1px solid ${D.cardBorder}` }}>⏹ Deactivate</button>}
        </div>
      </div>

      {actionError && <div style={{ color: D.red, fontSize: "0.75rem", marginTop: 6 }}>{actionError}</div>}

      {suspending && !isSuspended && (
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          <input value={suspendReason} onChange={e => setSuspendReason(e.target.value)} placeholder="Reason for suspension" style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
          <button onClick={() => act("suspend", { reason: suspendReason })} disabled={!suspendReason} style={{ ...pillBtn, background: D.red, color: "#fff", cursor: suspendReason ? "pointer" : "default" }}>Confirm suspend</button>
        </div>
      )}

      {editingPerms && (
        <PermissionEditor staff={staff} roleCodenames={roleCodenames} onDone={() => { setEditingPerms(false); onChanged(); }} />
      )}
    </div>
  );
}

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
          <StaffRow
            key={s.id}
            staff={s}
            onResend={resendInvite}
            resent={resentIds.has(s.id)}
            resending={resendingId === s.id}
            onChanged={refetch}
          />
        ))}
      </div>}
    </div>
  );
}

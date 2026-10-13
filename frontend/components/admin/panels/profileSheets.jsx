import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { usePermissionCatalog } from "../../../hooks/usePermissionCatalog.js";
import { useOrgChart } from "../../../hooks/usePeople.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, field } from "./panelStyles.js";
import { ROLE_LABEL, roleLabel } from "./peopleParts.jsx";
import { card, errorStyle, h3, labelStyle } from "./portfolioParts.jsx";

// The forms a Super Admin opens from a staff profile. Each posts once; the
// password is asked for by the shared prompt (a 403 sudo_required opens it and
// retries) and every change is recorded with before and after on the server.

function Sheet({ title, lines, error, busy, ready, submitLabel, onSubmit, onCancel, children, tone }) {
  return (
    <form aria-label={title} onSubmit={onSubmit} noValidate style={{ ...card, border: `1px solid ${D.cardBorder}` }}>
      <h3 style={h3}>{title}</h3>
      {lines && <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.8rem", color: D.text }}>{lines.map((l) => <li key={l}>{l}</li>)}</ul>}
      {children}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
        <button type="submit" disabled={!ready || busy} style={button(tone || D.gold, tone ? "#fff" : D.text, !ready || busy)}>{busy ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  );
}

function useAction(onDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn, doneText, failText) => {
    setBusy(true);
    setError(null);
    try { await fn(); onDone(doneText); }
    catch (err) { setError(apiErrorMessage(err, failText)); }
    finally { setBusy(false); }
  };
  return { busy, error, run };
}

export function SuspendStaffSheet({ staff, onDone, onCancel }) {
  const [reason, setReason] = useState("");
  const { busy, error, run } = useAction(onDone);
  const lifting = staff.status === "suspended";
  const submit = (e) => {
    e.preventDefault();
    run(() => apiPost(`/api/accounts/staff/${staff.id}/${lifting ? "unsuspend" : "suspend"}/`, lifting ? {} : { reason: reason.trim() }),
      lifting ? `Lifted the suspension of ${staff.full_name}.` : `Suspended ${staff.full_name}.`, lifting ? "Could not lift the suspension." : "Could not suspend.");
  };
  return (
    <Sheet title={lifting ? `Lift the suspension of ${staff.full_name}` : `Suspend ${staff.full_name}`} error={error} busy={busy} ready={lifting || reason.trim().length > 0}
      submitLabel={lifting ? "Lift suspension" : "Suspend"} tone={lifting ? null : D.red} onSubmit={submit} onCancel={onCancel}
      lines={lifting ? ["They can sign in again.", "It asks for your password and is recorded in the audit log."] : ["They are signed out of every device at once and cannot sign in until you lift it.", "It asks for your password and is recorded in the audit log."]}>
      {!lifting && (
        <label style={labelStyle}>Reason (kept in the audit log)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} style={field} />
        </label>
      )}
    </Sheet>
  );
}

export function DeactivateStaffSheet({ staff, onDone, onCancel }) {
  const { busy, error, run } = useAction(onDone);
  const leaving = staff.status !== "deactivated";
  return (
    <Sheet title={leaving ? `Deactivate ${staff.full_name}` : `Reactivate ${staff.full_name}`} error={error} busy={busy} ready
      submitLabel={leaving ? "Deactivate" : "Reactivate"} tone={leaving ? D.red : null} onCancel={onCancel}
      lines={leaving
        ? ["For someone who has left. They are signed out at once.", "A manager with people reporting to them, or a scout with businesses, cannot be deactivated until those are moved.", "It asks for your password and is recorded in the audit log."]
        : ["They can sign in again with their old password.", "It asks for your password and is recorded in the audit log."]}
      onSubmit={(e) => { e.preventDefault(); run(() => apiPost(`/api/accounts/staff/${staff.id}/${leaving ? "deactivate" : "reactivate"}/`, {}), leaving ? `Deactivated ${staff.full_name}.` : `Reactivated ${staff.full_name}.`, "Could not do that."); }} />
  );
}

export function SignOutAllSheet({ staff, onDone, onCancel }) {
  const { busy, error, run } = useAction(onDone);
  return (
    <Sheet title={`Sign ${staff.full_name} out of every device`} error={error} busy={busy} ready submitLabel="Sign out all devices" onCancel={onCancel}
      lines={["Every device they are signed in on stops working at once; they sign in again with their password.", "It asks for your password and is recorded in the audit log."]}
      onSubmit={(e) => { e.preventDefault(); run(() => apiPost(`/api/accounts/staff/${staff.id}/sign-out-everywhere/`, {}), `${staff.full_name} is signed out of every device.`, "Could not sign them out."); }} />
  );
}

// Reports-to and role. Each part posts on its own; the server says why when it
// refuses (a team to move first, the last Super Admin, a manager who cannot lead).
export function ChangeSheet({ staff, onDone, onCancel }) {
  const chart = useOrgChart();
  const [manager, setManager] = useState("");
  const [managerReason, setManagerReason] = useState("");
  const [role, setRole] = useState("");
  const [roleReason, setRoleReason] = useState("");
  const m = useAction(onDone);
  const r = useAction(onDone);
  const leads = (chart.data?.leads || []).filter((l) => l.id !== staff.id && l.id !== staff.manager?.id);
  const roles = Object.keys(ROLE_LABEL).filter((x) => x !== staff.role);
  return (
    <section aria-label={`Change manager or role of ${staff.full_name}`} style={{ ...card, border: `1px solid ${D.cardBorder}` }}>
      <h3 style={h3}>{`Change manager or role of ${staff.full_name}`}</h3>
      <form aria-label="Change manager" noValidate onSubmit={(e) => { e.preventDefault(); m.run(() => apiPost("/api/people/teams/reassign/", { staff: staff.id, manager: Number(manager), reason: managerReason.trim() }), `${staff.full_name} now reports to ${leads.find((l) => String(l.id) === manager)?.name}.`, "Could not change the manager."); }} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={labelStyle}>New manager
          <select value={manager} onChange={(e) => setManager(e.target.value)} style={field}>
            <option value="">Choose a manager</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{`${l.name} · ${l.role_label}`}</option>)}
          </select>
        </label>
        <label style={labelStyle}>Reason for the manager change
          <input value={managerReason} onChange={(e) => setManagerReason(e.target.value)} maxLength={300} style={field} />
        </label>
        <div style={{ fontSize: "0.78rem", color: D.text }}>They and both managers are told; requests already waiting stay with the old manager. Asks for your password; recorded in the audit log.</div>
        {m.error && <div role="alert" style={errorStyle}>{m.error}</div>}
        <div><button type="submit" disabled={!manager || !managerReason.trim() || m.busy} style={button(D.gold, D.text, !manager || !managerReason.trim() || m.busy)}>{m.busy ? "Saving…" : "Change manager"}</button></div>
      </form>
      <form aria-label="Change role" noValidate onSubmit={(e) => { e.preventDefault(); r.run(() => apiPost(`/api/people/staff/${staff.id}/role/`, { role, reason: roleReason.trim() }), `${staff.full_name} is now ${roleLabel(role)}.`, "Could not change the role."); }} style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${D.divider}`, paddingTop: 10 }}>
        <label style={labelStyle}>New role
          <select value={role} onChange={(e) => setRole(e.target.value)} style={field}>
            <option value="">Choose a role</option>
            {roles.map((x) => <option key={x} value={x}>{roleLabel(x)}</option>)}
          </select>
        </label>
        <label style={labelStyle}>Reason for the role change
          <input value={roleReason} onChange={(e) => setRoleReason(e.target.value)} maxLength={300} style={field} />
        </label>
        <div style={{ fontSize: "0.78rem", color: D.text }}>Their individual grants and revokes are kept and apply on top of the new role. A team lead must hand their team over first; a scout must hand over their businesses. Asks for your password; recorded in the audit log.</div>
        {r.error && <div role="alert" style={errorStyle}>{r.error}</div>}
        <div><button type="submit" disabled={!role || !roleReason.trim() || r.busy} style={button(D.gold, D.text, !role || !roleReason.trim() || r.busy)}>{r.busy ? "Saving…" : "Change role"}</button></div>
      </form>
      <div><button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Close</button></div>
    </section>
  );
}

// A person's own grants and revokes on top of their role. Checked = allowed now;
// unchecking a role permission revokes it for this person only. (Whole-role edits
// are on Roles & permissions.)
export function PermissionsSheet({ staff, permissions, onDone, onCancel }) {
  const catalog = usePermissionCatalog({ enabled: true });
  const role = new Set(permissions.role);
  const [effective, setEffective] = useState(() => new Set(permissions.effective));
  const { busy, error, run } = useAction(onDone);
  const toggle = (code) => setEffective((cur) => { const next = new Set(cur); if (next.has(code)) next.delete(code); else next.add(code); return next; });
  const save = (e) => {
    e.preventDefault();
    const grant = [...effective].filter((c) => !role.has(c));
    const revoke = [...role].filter((c) => !effective.has(c));
    run(() => apiPost(`/api/accounts/staff/${staff.id}/permissions/`, { grant, revoke }), `Saved ${staff.full_name}'s permissions.`, "Could not save these permissions.");
  };
  return (
    <form aria-label={`Permissions for ${staff.full_name}`} onSubmit={save} noValidate style={{ ...card, border: `1px solid ${D.cardBorder}` }}>
      <h3 style={h3}>{`Permissions for ${staff.full_name}`}</h3>
      <div style={{ fontSize: "0.78rem", color: D.text }}>Checked means allowed now. Ones marked "role" come from the role; unchecking one takes it away from this person only. Asks for your password.</div>
      {catalog.isLoading && <div role="status">Loading permissions…</div>}
      {catalog.isError && <div role="alert" style={errorStyle}>Could not load the permission list.</div>}
      {catalog.data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))", gap: "2px 16px" }}>
          {catalog.data.map((p) => (
            <label key={p.codename} style={{ display: "flex", gap: 7, padding: "4px 0", fontSize: "0.76rem", color: D.text, alignItems: "flex-start" }}>
              <input type="checkbox" checked={effective.has(p.codename)} onChange={() => toggle(p.codename)} style={{ marginTop: 2 }} />
              <span><b>{p.codename}</b>{role.has(p.codename) ? " · role" : ""}<span style={{ display: "block", color: D.textDim }}>{p.description}</span></span>
            </label>
          ))}
        </div>
      )}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
        <button type="submit" disabled={busy} style={button(D.gold, D.text, busy)}>{busy ? "Saving…" : "Save permissions"}</button>
      </div>
    </form>
  );
}

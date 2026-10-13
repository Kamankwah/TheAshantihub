import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useSessionsOverview } from "../../../hooks/usePeople.js";
import { useStaffSessionHistory } from "../../../hooks/useStaffSessions.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { KpiStrip, LoadState, ScreenHeader, col, tableStyle, td, th } from "./marketplaceParts.jsx";
import { RolePill, note, plural, roleLabel } from "./peopleParts.jsx";
import { SignInHistory, when } from "./sessionParts.jsx";
import { card, errorStyle, h3, labelStyle } from "./portfolioParts.jsx";

// Super Admin > Sessions & devices (screen 09). Everyone signed in now. Ending one
// session, signing a person out of every device, and signing every other staff
// member out all ask for the password and are recorded. A session row holds an IP
// address and a browser-and-system label only: there is no network name or
// location, so none is claimed. "New device" = the first session today on a kind
// of device that person has not signed in on before.

const isPhone = (label) => /Android|iPhone|iPad/.test(label || "");

function History({ staff }) {
  const { data, isLoading, isError } = useStaffSessionHistory(staff.id);
  return <SignInHistory sessions={data} label={`${staff.full_name}'s sign-in history`} isLoading={isLoading} isError={isError} />;
}

export default function SaSessionsPanel() {
  const queryClient = useQueryClient();
  const query = useSessionsOverview();
  const data = query.data;
  const [filters, setFilters] = useState({ person: "", role: "", device: "", fresh: false });
  const [history, setHistory] = useState(() => new Set());
  const [confirmAll, setConfirmAll] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn, ok, fail) => {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try { const out = await fn(); setMessage(typeof ok === "function" ? ok(out) : ok); setConfirmAll(false); }
    catch (err) { setError(apiErrorMessage(err, fail)); }
    finally { setBusy(false); ["staff-roster", "active-sessions", "my-sessions"].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] })); }
  };

  const all = data?.sessions || [];
  const mine = all.find((s) => s.is_current);
  const rows = all.filter((s) => !s.is_current
    && (!filters.person || s.staff.full_name.toLowerCase().includes(filters.person.toLowerCase()))
    && (!filters.role || s.staff.role === filters.role)
    && (!filters.device || (filters.device === "phone") === isPhone(s.device_label))
    && (!filters.fresh || s.new_device));
  const roles = [...new Set(all.map((s) => s.staff.role))];
  const k = data?.kpis;
  const rules = data?.rules;
  const tiles = k ? [
    { label: "Sessions open", value: k.sessions, sub: `On ${plural(k.people, "person's", "people's")} devices` },
    { label: "Signed in with 2-step", value: k.with_two_step, sub: `Of ${plural(k.people, "person", "people")} signed in` },
    { label: "Idle sign-out", value: `${rules.idle_minutes} min`, sub: "No activity, signed out" },
    { label: "Longest session", value: `${rules.longest_hours} h`, sub: "Then sign in again" },
    { label: "New devices today", value: k.new_devices_today, sub: k.new_device_people.join(", ") || "None", tone: k.new_devices_today ? "#A33A00" : undefined },
  ] : [];

  return (
    <div style={col}>
      <ScreenHeader title="Sessions & devices" note="Everyone signed in now. Ending a session signs that device out at once.">
        {!confirmAll && <button type="button" onClick={() => setConfirmAll(true)} style={button(D.panelBg, D.red)}>Sign out every staff member</button>}
      </ScreenHeader>
      {confirmAll && (
        <section aria-label="Sign out every staff member" style={{ ...card, border: `1px solid ${D.cardBorder}` }}>
          <h3 style={h3}>Sign out every staff member</h3>
          <div style={{ fontSize: "0.8rem", color: D.text }}>Everyone except you is signed out at once and has to sign in again. Your own sessions stay open. It asks for your password and is recorded.</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={busy} onClick={() => run(() => apiPost("/api/people/sessions/sign-out-all/", {}), (out) => `Signed out ${plural(out.people, "person", "people")} (${plural(out.ended, "session", "sessions")}).`, "Could not sign everyone out.")} style={button(D.red, "#fff", busy)}>Sign everyone out</button>
            <button type="button" onClick={() => setConfirmAll(false)} style={button(D.panelBg, D.text)}>Keep them signed in</button>
          </div>
        </section>
      )}
      <LoadState query={query} what="the sessions" />
      {data && <KpiStrip tiles={tiles} label="Sessions summary" />}
      {message && <div role="status" style={callout(D.green)}>{message}</div>}
      {error && <div role="alert" style={errorStyle}>{error}</div>}

      {mine && (
        <section aria-label="This session" style={card}>
          <h3 style={h3}>{`This session · ${mine.device_label}`}</h3>
          <div style={{ fontSize: "0.8rem", color: D.text }}>{`Signed in ${when(mine.created_at)}${mine.two_factor ? " with your password and authenticator code" : " with your password"} · ${mine.ip || "no IP recorded"} · ends ${when(mine.ends_at)} at the latest`}</div>
          {mine.sudo_until && <div style={dim}>{`Password re-entered: protected actions are unlocked until ${when(mine.sudo_until)}.`}</div>}
        </section>
      )}

      {data && (
        <section aria-label="Everyone signed in now" style={card}>
          <h3 style={h3}>Everyone signed in now</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: 10, alignItems: "end" }}>
            <label style={labelStyle}>Person<input type="search" value={filters.person} onChange={(e) => setFilters((f) => ({ ...f, person: e.target.value }))} style={field} /></label>
            <label style={labelStyle}>Role
              <select value={filters.role} onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))} style={field}>
                <option value="">All roles</option>
                {roles.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </select>
            </label>
            <label style={labelStyle}>Device
              <select value={filters.device} onChange={(e) => setFilters((f) => ({ ...f, device: e.target.value }))} style={field}>
                <option value="">Any device</option><option value="phone">Phone</option><option value="computer">Computer</option>
              </select>
            </label>
            <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 6 }}><input type="checkbox" checked={filters.fresh} onChange={(e) => setFilters((f) => ({ ...f, fresh: e.target.checked }))} />Only new devices</label>
          </div>
          {rows.length === 0 && <div style={dim}>{all.length <= 1 ? "Nobody else is signed in right now." : "No session matches these filters."}</div>}
          {rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table aria-label="Sessions" style={{ ...tableStyle, minWidth: 860 }}>
                <thead><tr><th style={th}>Person</th><th style={th}>Device</th><th style={th}>IP</th><th style={th}>Signed in</th><th style={th}>Last seen</th><th style={th}>Ends</th><th style={th}>Actions</th></tr></thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td style={td}><div style={{ fontWeight: 800 }}>{s.staff.full_name}</div><RolePill role={s.staff.role} /></td>
                      <td style={td}>{s.device_label}<div style={dim}>{s.two_factor ? "2-step" : "Password only"}</div>{s.new_device && <span style={chip(D.amber)}>New device today</span>}</td>
                      <td style={td}>{s.ip || "—"}</td>
                      <td style={td}>{when(s.created_at)}</td>
                      <td style={td}>{when(s.last_seen_at)}<div style={dim}>{`Idle: ${when(s.idle_ends_at)}`}</div></td>
                      <td style={td}>{`Latest: ${when(s.ends_at)}`}</td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <button type="button" aria-label={`End ${s.staff.full_name}'s session on ${s.device_label}`} disabled={busy} onClick={() => run(() => apiPost(`/api/accounts/staff/sessions/${s.id}/end/`, {}), "Session ended.", "Could not end that session.")} style={button(D.panelBg, D.text, busy)}>End session</button>
                          <button type="button" aria-label={`Sign out all of ${s.staff.full_name}'s devices`} disabled={busy} onClick={() => run(() => apiPost(`/api/accounts/staff/${s.staff.id}/sign-out-everywhere/`, {}), `${s.staff.full_name} is signed out of every device.`, "Could not sign them out.")} style={button(D.panelBg, D.red, busy)}>Sign out all devices</button>
                          <button type="button" aria-expanded={history.has(s.staff.id)} aria-label={`Sign-in history for ${s.staff.full_name}`} onClick={() => setHistory((cur) => { const next = new Set(cur); if (next.has(s.staff.id)) next.delete(s.staff.id); else next.add(s.staff.id); return next; })} style={button(D.panelBg, D.text)}>Sign-in history</button>
                        </div>
                        {history.has(s.staff.id) && <History staff={{ id: s.staff.id, full_name: s.staff.full_name }} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={dim}>{`${rows.length} of ${Math.max(all.length - (mine ? 1 : 0), 0)} other sessions · ending a session signs that device out within a minute; both actions are recorded. Only the IP address is known, not the network or where it is.`}</div>
        </section>
      )}

      {rules && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 14 }}>
          <section aria-label="Rules for every staff session" style={card}>
            <h3 style={h3}>Rules for every staff session</h3>
            {[["Idle sign-out", `After ${rules.idle_minutes} minutes without activity`], ["Longest session", `${rules.longest_hours} hours after signing in`], ["2-step sign-in", `Required for ${rules.two_step_required_for}; optional for others`], ["Password again", `Approving money, role and permission changes, suspensions, exports with personal data, ending someone's session · lasts ${rules.sudo_minutes} minutes`], ["Permission change", "Their devices reconnect with the new permissions"]].map(([a, b]) => (
              <div key={a} style={{ fontSize: "0.8rem", color: D.text }}><b>{a}</b><div style={dim}>{b}</div></div>
            ))}
          </section>
          <section aria-label="Worth a look" style={card}>
            <h3 style={h3}>Worth a look</h3>
            {k.new_devices_today === 0 && <div style={dim}>No new devices today.</div>}
            {all.filter((s) => s.new_device).map((s) => <div key={s.id} style={{ fontSize: "0.8rem", color: D.text }}>{`${s.staff.full_name} signed in on a new kind of device today (${s.device_label}) at ${when(s.created_at)}.`}</div>)}
            <div style={note}>Where a sign-in came from is not known beyond the IP address, so nothing is said about location.</div>
          </section>
        </div>
      )}
    </div>
  );
}

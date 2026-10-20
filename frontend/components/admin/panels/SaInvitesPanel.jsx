import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useOpsInvites } from "../../../hooks/useOpsPeople.js";
import { useSaInvites } from "../../../hooks/usePeople.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { FilterBar, KpiStrip, LoadState, ScreenHeader, col, dateTime, tableStyle, td, th } from "./marketplaceParts.jsx";
import { RolePill, dayText, note, roleLabel } from "./peopleParts.jsx";
import { card, errorStyle, h3, labelStyle } from "./portfolioParts.jsx";

// Super Admin > Invites (screen 07). Every open and expired invite, whatever the
// role, with who sent it. Sending, resending and revoking use the same endpoints
// as every other invite; sending, and any other change to an account, asks for the
// password. Only Sent, Opened and Expired are shown: whether an e-mail was delivered
// is not tracked, and SMS invites are not connected.

const STATE = { not_opened: ["Sent · not opened", D.amber], opened: ["Opened · password not set", D.amber], expired: ["Expired", D.red] };
const isoToday = () => new Date().toISOString().slice(0, 10);

function daysLeft(iso) {
  const ms = new Date(iso) - new Date();
  const days = Math.ceil(ms / 86400000);
  return ms <= 0 ? "ended" : `in ${days} ${days === 1 ? "day" : "days"}`;
}

export default function SaInvitesPanel() {
  const queryClient = useQueryClient();
  const query = useSaInvites();
  const { data: ops } = useOpsInvites();
  const data = query.data;
  const [roleFilter, setRoleFilter] = useState("");
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", role: "", manager: "", start_date: "" });
  const [areas, setAreas] = useState([]);
  const [revoking, setRevoking] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((cur) => ({ ...cur, [key]: e.target.value }));
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["staff-roster"] });
  const run = async (fn, ok, fail) => {
    setBusy(true); setError(null); setMessage(null);
    try { await fn(); setMessage(ok); setRevoking(null); refresh(); return true; }
    catch (err) { setError(apiErrorMessage(err, fail)); return false; }
    finally { setBusy(false); }
  };

  const send = async (e) => {
    e.preventDefault();
    const ok = await run(() => apiPost("/api/accounts/staff/invite/", {
      full_name: form.full_name.trim(), email: form.email.trim(), role: form.role,
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
      ...(form.manager ? { manager: Number(form.manager) } : {}),
      ...(form.start_date ? { start_date: form.start_date } : {}),
      ...(form.role === "scout" && areas.length ? { areas } : {}),
    }), `Invite sent to ${form.email.trim()}.`, "Could not send the invite. Check the email isn't already used.");
    if (ok) { setForm({ full_name: "", email: "", phone: "", role: "", manager: "", start_date: "" }); setAreas([]); }
  };

  const kpis = data?.kpis;
  const openByRole = kpis ? Object.entries(kpis.open_by_role).map(([r, n]) => `${n} ${roleLabel(r).toLowerCase()}`).join(" · ") : "";
  const tiles = kpis ? [
    { label: "Open invites", value: kpis.open, sub: openByRole || "None waiting" },
    { label: "Opened, not finished", value: kpis.opened_unfinished, sub: "Opened the link, no password yet", tone: kpis.opened_unfinished ? D.warnInk : undefined },
    { label: "Expired", value: kpis.expired, sub: kpis.expired ? "Send a new link or remove" : "None", tone: kpis.expired ? D.warnInk : undefined },
    { label: "Accepted · 30 days", value: kpis.accepted_30_days, sub: kpis.median_days_to_accept == null ? "" : `Median ${kpis.median_days_to_accept} days from the last link to a password` },
  ] : [];
  const invites = (data?.invites || []).filter((i) => !roleFilter || i.role === roleFilter);
  const roles = data?.roles || [];

  return (
    <div style={col}>
      <ScreenHeader title="Invites" note="Open and expired invites, whatever the role." />
      <LoadState query={query} what="the invites" />
      {data && <KpiStrip tiles={tiles} label="Invites summary" />}
      {message && <div role="status" style={callout(D.green)}>{message}</div>}
      {error && <div role="alert" style={errorStyle}>{error}</div>}

      {data && (
        <section aria-label="Open and expired invites" style={card}>
          <h3 style={h3}>Open and expired invites</h3>
          <FilterBar filters={[{ key: "role", label: "Role", options: [["", "All roles"], ...roles.map((r) => [r.name, r.label])] }]} values={{ role: roleFilter }} onChange={(_k, v) => setRoleFilter(v)} />
          {invites.length === 0 && <div style={dim}>No invites waiting.</div>}
          {invites.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table aria-label="Invites" style={{ ...tableStyle, minWidth: 820 }}>
                <thead><tr><th style={th}>Invited</th><th style={th}>Role · manager</th><th style={th}>Invited by</th><th style={th}>Sent</th><th style={th}>Expires</th><th style={th}>Progress</th><th style={th}>Actions</th></tr></thead>
                <tbody>
                  {invites.map((i) => {
                    const [stateLabel, stateColor] = STATE[i.state] || STATE.not_opened;
                    const expired = i.state === "expired";
                    return (
                      <tr key={i.id}>
                        <td style={td}><div style={{ fontWeight: 800 }}>{i.full_name}</div><div style={dim}>{i.email}</div>{(i.start_date || i.areas.length > 0) && <div style={dim}>{[i.start_date ? `Starts ${dayText(i.start_date)}` : null, i.areas.length ? i.areas.join(", ") : null].filter(Boolean).join(" · ")}</div>}</td>
                        <td style={td}><RolePill role={i.role} /><div style={dim}>{i.manager ? `Manager: ${i.manager.name}` : "No manager"}</div></td>
                        <td style={td}>{i.invited_by ? <>{i.invited_by.name}<div style={dim}>{i.invited_by.role_label}</div></> : "—"}</td>
                        <td style={td}>{dateTime(i.sent_at)}</td>
                        <td style={td}>{dateTime(i.expires_at)}<div style={dim}>{expired ? "never finished" : daysLeft(i.expires_at)}</div></td>
                        <td style={td}><span style={chip(stateColor)}>{stateLabel}</span></td>
                        <td style={td}>
                          {revoking === i.id ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 190 }}>
                              <div style={dim}>{`${expired ? "Remove" : "Revoke"} the invite to ${i.full_name}? The link stops working and the pending account is deleted.`}</div>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button type="button" disabled={busy} onClick={() => run(() => apiPost(`/api/accounts/staff/${i.id}/cancel-invite/`, {}), `Invite to ${i.full_name} ${expired ? "removed" : "revoked"}.`, "Could not revoke the invite.")} style={button(D.red, "#fff", busy)}>{expired ? "Remove" : "Revoke"}</button>
                                <button type="button" onClick={() => setRevoking(null)} style={button(D.panelBg, D.text)}>Keep it</button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button type="button" aria-label={`${expired ? "Send a new link to" : "Resend invite to"} ${i.full_name}`} disabled={busy} onClick={() => run(() => apiPost(`/api/accounts/staff/${i.id}/resend-invite/`, {}), `New link sent to ${i.email}.`, "Could not resend the invite.")} style={button(D.panelBg, D.text, busy)}>{expired ? "Send a new link" : "Resend"}</button>
                              <button type="button" aria-label={`${expired ? "Remove" : "Revoke"} invite to ${i.full_name}`} onClick={() => setRevoking(i.id)} style={button(D.panelBg, D.text)}>{expired ? "Remove" : "Revoke"}</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={note}>{`Resending sends a fresh link that works for ${data.link_days} days and cancels the old one. Revoking cancels the link at once; the person is not told unless you write to them. Whether an e-mail was delivered is not tracked.`}</div>
        </section>
      )}

      {data && (
        <section aria-label="Accepted or revoked, last 30 days" style={card}>
          <h3 style={h3}>Accepted or revoked · last 30 days</h3>
          {data.recent.length === 0 && <div style={dim}>Nothing in the last 30 days.</div>}
          {data.recent.map((r, idx) => <div key={`${r.state}-${r.name}-${idx}`} style={{ fontSize: "0.8rem", color: D.text }}><span style={chip(r.state === "accepted" ? D.green : D.red)}>{r.state === "accepted" ? "Accepted" : "Revoked"}</span>{` ${r.name} · ${r.role_label || "—"} · ${r.state === "accepted" ? "invited by" : "removed by"} ${r.by} · ${dayText(r.at)}`}</div>)}
        </section>
      )}

      {data && (
        <form aria-label="Invite someone" onSubmit={send} noValidate style={card}>
          <h3 style={h3}>Invite someone</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
            <label style={labelStyle}>Full name<input value={form.full_name} onChange={set("full_name")} style={field} required /></label>
            <label style={labelStyle}>Email<input type="email" value={form.email} onChange={set("email")} style={field} required /></label>
            <label style={labelStyle}>Phone (optional)<input type="tel" value={form.phone} onChange={set("phone")} style={field} />
              <span style={{ ...dim, fontWeight: 400 }}>SMS invites are not connected; the invite goes by email.</span></label>
            <label style={labelStyle}>Role
              <select value={form.role} onChange={set("role")} style={field} required>
                <option value="">Choose a role</option>
                {roles.map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}
              </select>
            </label>
            <label style={labelStyle}>Manager
              <select value={form.manager} onChange={set("manager")} style={field}>
                <option value="">No manager</option>
                {data.leads.map((l) => <option key={l.id} value={l.id}>{`${l.name} · ${l.role_label}`}</option>)}
              </select>
            </label>
            <label style={labelStyle}>Starts on<input type="date" value={form.start_date} min={isoToday()} onChange={set("start_date")} style={field} /></label>
          </div>
          {form.role === "scout" && (ops?.zones || []).length > 0 && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend style={{ ...labelStyle, padding: 0, marginBottom: 6 }}>Areas (scouts)</legend>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {ops.zones.map((z) => {
                  const on = areas.includes(z.id);
                  return <label key={z.id} style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "6px 10px", borderRadius: 10, fontSize: "0.8rem", color: D.text, border: `${on ? 2 : 1}px solid ${on ? D.text : D.cardBorder}` }}>
                    <input type="checkbox" checked={on} onChange={() => setAreas((cur) => (cur.includes(z.id) ? cur.filter((x) => x !== z.id) : [...cur, z.id]))} />{z.name}</label>;
                })}
              </div>
            </fieldset>
          )}
          <div style={note}>{`They get an email with a one-time link to set their own password, valid for ${data.link_days} days, and the staff app install link. ${form.role === "super_admin" ? "A new Super Admin also sets up 2-step sign-in before their first page. " : ""}${form.role === "cosigner" ? "The co-signer sees and decides only the requests above the co-sign limit. " : ""}Sending asks for your password.`}</div>
          <div><button type="submit" disabled={!form.full_name.trim() || !form.email.trim() || !form.role || busy} style={button(D.gold, D.text, !form.full_name.trim() || !form.email.trim() || !form.role || busy)}>{busy ? "Sending…" : "Send invite"}</button></div>
        </form>
      )}

      {data && (
        <section aria-label="Who can invite whom" style={card}>
          <h3 style={h3}>Who can invite whom</h3>
          {data.who_can_invite.map((r) => <div key={r.who} style={{ fontSize: "0.8rem", color: D.text, display: "flex", justifyContent: "space-between", gap: 8 }}><b>{r.who}</b><span>{r.can}</span></div>)}
          <div style={note}>The person who sends an invite becomes the new person's manager unless Super Admin names another. Only Super Admin can change a role or deactivate someone.</div>
        </section>
      )}
    </div>
  );
}

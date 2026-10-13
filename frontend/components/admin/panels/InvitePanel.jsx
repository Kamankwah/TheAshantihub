import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useInvitableRoles } from "../../../hooks/useInvitableRoles.js";
import { useOpsInvites } from "../../../hooks/useOpsPeople.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, chip, dim, field } from "./panelStyles.js";
import MyTeamPanel from "./MyTeamPanel.jsx";
import { dayShort, isoDay, longDay, scroll, table, td, th, timeShort } from "./opsPeopleParts.jsx";
import { errorStyle, eyebrow, h2, labelStyle, toDate } from "./portfolioParts.jsx";

// ─── 06 Invite ───────────────────────────────────────────────────────────────
// A team lead invites a Scout or Support person. The person gets an email with
// a link (good for the days the server says); "SMS: not connected" stays — no
// text message is sent. Areas are the zones a new scout will work: they are
// held on the pending account and count as the scout's areas once it is
// accepted. Below the form: pending invites (Resend / Cancel, with the state
// the server tracks: not opened, opened but no password yet, expired), who
// joined in the last 60 days, and the people already on the team.
const ROLE_LABEL = { scout: "Scout", support: "Support", operations: "Operations", accountant: "Accountant", marketing: "Marketing", delivery_manager: "Delivery Manager", dispatch: "Dispatch", cosigner: "Co-signer", super_admin: "Super Admin" };
const ROLE_NOTE = { scout: "Registers and manages businesses in the field", support: "Runs the help desk and call log" };
const STATE = { not_opened: ["Not opened", D.textDim], opened: ["Opened · password not set", D.amber], expired: ["Expired", D.red] };

function expiry(invite, now) {
  const at = toDate(invite.expires_at);
  if (!at) return { text: "—", warn: false };
  if (invite.state === "expired" || at <= now) {
    const today = at.toDateString() === now.toDateString();
    return { text: `Expired ${today ? "today" : dayShort(invite.expires_at)}, ${timeShort(invite.expires_at)}`, warn: true, hard: true };
  }
  const days = Math.ceil((at - now) / 86400000);
  return { text: `${dayShort(invite.expires_at)} · in ${days} ${days === 1 ? "day" : "days"}`, warn: days <= 2 };
}

export default function InvitePanel({ auth }) {
  const queryClient = useQueryClient();
  const { data: roles } = useInvitableRoles();
  const { data, isLoading, isError, refetch } = useOpsInvites();
  const [role, setRole] = useState("");
  const [form, setForm] = useState({ full_name: "", email: "", phone: "", start_date: "" });
  const [areas, setAreas] = useState([]);
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [sending, setSending] = useState(false);
  const chosen = role || (roles || [])[0] || "";
  const today = isoDay(new Date());
  const days = data?.link_days ?? 7;
  const limited = roles && roles.length > 0 && roles.every((r) => r === "scout" || r === "support");
  const refresh = () => { ["ops-invites", "my-team", "staff-roster"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] })); };
  const set = (key) => (e) => setForm((cur) => ({ ...cur, [key]: e.target.value }));

  const send = async (e) => {
    e.preventDefault();
    if (!chosen) return;
    setActionError(null); setMessage(null); setSending(true);
    try {
      await apiPost("/api/accounts/staff/invite/", {
        full_name: form.full_name.trim(), email: form.email.trim(), role: chosen,
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(form.start_date ? { start_date: form.start_date } : {}),
        ...(chosen === "scout" && areas.length ? { areas } : {}),
        ...(auth?.user?.id ? { manager: auth.user.id } : {}),
      });
      setMessage(`Invite sent to ${form.email.trim()}.`);
      setForm({ full_name: "", email: "", phone: "", start_date: "" }); setAreas([]);
      refresh();
    } catch (err) { setActionError(apiErrorMessage(err, "Could not send the invite. Check the email isn't already used.")); }
    finally { setSending(false); }
  };
  const run = async (fn, ok, fail) => {
    setActionError(null); setMessage(null);
    try { await fn(); setMessage(ok); setCancelling(null); refresh(); }
    catch (err) { setActionError(apiErrorMessage(err, fail)); }
  };
  const toggleArea = (id) => setAreas((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const now = new Date();
  const pending = data?.pending || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={eyebrow}>People</div>
        <h2 style={{ ...h2, fontSize: "1.4rem", margin: "2px 0 0" }}>Invite to your team</h2>
      </div>
      {message && <div role="status" style={{ color: D.green, fontSize: "0.82rem", fontWeight: 700 }}>{message}</div>}
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}

      <form aria-labelledby="invite-new" onSubmit={send} style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 id="invite-new" style={{ ...h2, fontSize: "1rem" }}>New invite</h3>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <legend style={{ ...labelStyle, padding: 0, marginBottom: 6 }}>Role</legend>
          {roles && roles.length === 0 && <div style={dim}>You can't invite anyone yet.</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(roles || []).map((r) => (
              <label key={r} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "8px 12px", borderRadius: 12, cursor: "pointer", background: chosen === r ? D.panelBg2 : D.panelBg, border: `${chosen === r ? 2 : 1}px solid ${chosen === r ? D.text : D.cardBorder}` }}>
                <input type="radio" name="invite-role" value={r} checked={chosen === r} onChange={() => setRole(r)} />
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontWeight: 800, fontSize: "0.85rem", color: D.text }}>{ROLE_LABEL[r] || r}</span>
                  {ROLE_NOTE[r] && <span style={dim}>{ROLE_NOTE[r]}</span>}
                </span>
              </label>
            ))}
          </div>
          {limited && <div style={dim}>{`You can invite ${roles.map((r) => `${ROLE_LABEL[r]}s`).join(" and ")} only. Other roles are invited by Super Admin.`}</div>}
        </fieldset>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10 }}>
          <label style={labelStyle}>Full name<input value={form.full_name} onChange={set("full_name")} style={field} required /></label>
          <label style={labelStyle}>Email<input type="email" value={form.email} onChange={set("email")} style={field} required /></label>
          <label style={labelStyle}>Phone<input type="tel" value={form.phone} onChange={set("phone")} placeholder="Phone number" style={field} />
            <span style={{ ...dim, fontWeight: 400 }}>Used for the self-dealing check on businesses they register</span></label>
          <label style={labelStyle}>Starts on<input type="date" value={form.start_date} min={today} onChange={set("start_date")} style={field} /></label>
        </div>

        {chosen === "scout" && (data?.zones || []).length > 0 && (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ ...labelStyle, padding: 0, marginBottom: 6 }}>Areas (scouts)</legend>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {data.zones.map((z) => {
                const on = areas.includes(z.id);
                return (
                  <label key={z.id} style={{ display: "inline-flex", gap: 6, alignItems: "center", padding: "6px 10px", borderRadius: 10, fontSize: "0.8rem", color: D.text, cursor: "pointer", background: on ? D.panelBg2 : D.panelBg, border: `${on ? 2 : 1}px solid ${on ? D.text : D.cardBorder}` }}>
                    <input type="checkbox" checked={on} onChange={() => toggleArea(z.id)} />
                    {z.name}
                    <span style={dim}>{`· ${z.scouts.length ? z.scouts.join(", ") : "no scout yet"}`}</span>
                  </label>
                );
              })}
            </div>
            <div style={{ ...dim, marginTop: 4 }}>The zones they will work. They count as the scout's areas once they join.</div>
          </fieldset>
        )}

        <div style={{ ...dim, lineHeight: 1.5 }}>
          <div><strong style={{ color: D.text }}>Manager:</strong> you{auth?.user?.full_name ? ` (${auth.user.full_name})` : ""} — a team invite makes you their manager.</div>
          {chosen === "scout" && <div><strong style={{ color: D.text }}>Targets:</strong> set after they join, in Targets, inside Super Admin's limits.</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={dim}>{`The link lasts ${days} days. Sent by email · SMS: not connected.`}</span>
          <button type="submit" disabled={!chosen || sending} style={button(D.gold, D.text, !chosen || sending)}>{sending ? "Sending…" : "Send invite"}</button>
        </div>
      </form>

      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Couldn't load your invites. <button type="button" onClick={() => refetch()} style={button(D.panelBg, D.text)}>Try again</button></div>}

      {data && (
        <>
          <section aria-labelledby="invite-pending" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
              <h3 id="invite-pending" style={{ ...h2, fontSize: "1rem" }}>Pending invites</h3>
              <span style={dim}>{`${pending.length} waiting`}</span>
            </div>
            {pending.length === 0 ? <div style={dim}>No invites waiting.</div> : (
              <div style={scroll}>
                <table style={table}>
                  <thead>
                    <tr>
                      {["Person", "Role", "Sent", "Link expires", "Status"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}
                      <th scope="col" style={th}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((v) => {
                      const exp = expiry(v, now);
                      const [stateLabel, stateColor] = STATE[v.state] || STATE.not_opened;
                      return (
                        <tr key={v.id}>
                          <td style={td}><div style={{ fontWeight: 700 }}>{v.full_name}</div><div style={dim}>{v.email}</div>
                            {(v.start_date || v.areas.length > 0) && <div style={dim}>{[v.start_date ? `Starts ${longDay(v.start_date)}` : null, v.areas.length ? v.areas.join(", ") : null].filter(Boolean).join(" · ")}</div>}</td>
                          <td style={td}>{ROLE_LABEL[v.role] || v.role}</td>
                          <td style={td}>{dayShort(v.sent_at)}</td>
                          <td style={{ ...td, color: exp.warn ? (exp.hard ? D.red : "#A33A00") : D.text, fontWeight: exp.warn ? 700 : 400 }}>{exp.text}</td>
                          <td style={td}><span style={chip(stateColor)}>{stateLabel}</span></td>
                          <td style={td}>
                            {cancelling === v.id ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 190 }}>
                                <div style={dim}>{`Cancel the invite to ${v.full_name}? The link stops working.`}</div>
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button type="button" onClick={() => run(() => apiPost(`/api/accounts/staff/${v.id}/cancel-invite/`, {}), `Invite to ${v.full_name} cancelled.`, "Could not cancel the invite.")} style={button(D.red, "#fff")}>Cancel invite</button>
                                  <button type="button" onClick={() => setCancelling(null)} style={button(D.panelBg, D.text)}>Keep it</button>
                                </div>
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: 6 }}>
                                <button type="button" aria-label={`Resend invite to ${v.full_name}`} onClick={() => run(() => apiPost(`/api/accounts/staff/${v.id}/resend-invite/`, {}), `New link sent to ${v.email}.`, "Could not resend the invite.")} style={button(D.panelBg, D.text)}>Resend</button>
                                <button type="button" aria-label={`Cancel invite to ${v.full_name}`} onClick={() => setCancelling(v.id)} style={button(D.panelBg, D.text)}>Cancel</button>
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
            <div style={dim}>{`Resend makes a new ${days}-day link and the old one stops working. Every invite, resend and cancel is recorded in the activity log.`}</div>
          </section>

          <section aria-labelledby="invite-joined" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 6 }}>
            <h3 id="invite-joined" style={{ ...h2, fontSize: "1rem" }}>Joined in the last 60 days</h3>
            {data.joined.length === 0 && <div style={dim}>Nobody has joined through an invite in the last 60 days.</div>}
            {data.joined.map((j) => (
              <div key={j.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: "0.82rem", color: D.text, borderTop: `1px solid ${D.divider}`, paddingTop: 6 }}>
                <span><strong>{j.full_name}</strong>{` · ${ROLE_LABEL[j.role] || j.role}${j.areas.length ? ` · ${j.areas.join(" and ")}` : ""}`}</span>
                <span style={dim}>{`Joined ${dayShort(j.joined_at)} · invited by ${j.invited_by_me ? "you" : j.invited_by}`}</span>
              </div>
            ))}
          </section>
        </>
      )}

      <section aria-labelledby="invite-gets" style={{ ...glassCard, padding: 16 }}>
        <h3 id="invite-gets" style={{ ...h2, fontSize: "1rem", marginBottom: 6 }}>What the person gets</h3>
        <p style={{ ...dim, margin: 0, lineHeight: 1.5 }}>
          {`An email with a link to ${window.location.host}/staff/activate, where they set their own password, then a page showing how to add the staff app to their phone's home screen. Their menu matches their role from the first sign-in.`}
        </p>
      </section>

      <MyTeamPanel currentStaffId={auth?.user?.id} rosterOnly />
    </div>
  );
}

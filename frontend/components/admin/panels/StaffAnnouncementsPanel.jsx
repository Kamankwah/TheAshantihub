import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useAnnouncement, useAnnouncements } from "../../../hooks/useStaffSecurity.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { errorStyle, h2, labelStyle } from "./portfolioParts.jsx";
import { page, section, sectionTitle } from "./insightsParts.jsx";

// ─── Super Admin 16 Staff announcements ──────────────────────────────────────
// A notice to staff only. It reaches each person as a banner at the top of the staff app
// and as a bell notification; optionally by e-mail where the server has e-mail connected.
// Push, SMS and WhatsApp are not connected, and are shown as such rather than as choices.
// It never reaches customers or businesses.
const STATUS = { draft: "Draft", scheduled: "Scheduled", sent: "Sent", cancelled: "Cancelled" };
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const blank = { title: "", body: "", roles: [], team_manager: "", require_confirm: false, send_email: false, when: "now", date: "", time: "" };

function Compose({ data, onDone }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const toggleRole = (name) => setForm((f) => ({ ...f, roles: f.roles.includes(name) ? f.roles.filter((r) => r !== name) : [...f.roles, name] }));
  const reach = data.roles.filter((r) => form.roles.includes(r.name)).reduce((n, r) => n + r.people, 0);
  const team = data.teams.find((t) => String(t.id) === String(form.team_manager));
  const approx = reach + (team ? team.people : 0);

  const submit = async (event, mode) => {
    event.preventDefault();
    setBusy(true); setError(null);
    const body = {
      title: form.title, body: form.body, roles: form.roles, team_manager: form.team_manager ? Number(form.team_manager) : null,
      require_confirm: form.require_confirm, send_email: form.send_email, when: mode,
      ...(mode === "schedule" ? { send_at: form.date && form.time ? new Date(`${form.date}T${form.time}`).toISOString() : "" } : {}),
    };
    try {
      await apiPost("/api/announcements/", body);
      queryClient.invalidateQueries({ queryKey: ["announcements"] });
      setForm(blank);
      onDone(mode === "now" ? "Sent." : mode === "schedule" ? "Scheduled." : "Draft saved.");
    } catch (err) {
      const detail = err?.body && typeof err.body === "object" ? Object.values(err.body).flat().join(" ") : "";
      setError(detail || apiErrorMessage(err, "Could not save the announcement."));
    } finally {
      setBusy(false);
    }
  };

  const labelCol = { ...labelStyle };
  return (
    <form aria-label="New announcement" onSubmit={(e) => submit(e, form.when === "schedule" ? "schedule" : "now")} style={section}>
      <h3 style={sectionTitle}>New announcement</h3>
      <label style={labelCol}>Title<input value={form.title} onChange={set("title")} maxLength={150} required style={field} /></label>
      <label style={labelCol}>Message<textarea value={form.body} onChange={set("body")} rows={5} maxLength={2000} required style={field} /></label>
      <fieldset style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: 10, display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
        <legend style={{ fontSize: "0.72rem", fontWeight: 700, color: D.text }}>Send to</legend>
        {data.roles.map((r) => (
          <label key={r.name} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: "0.82rem", color: D.text }}>
            <input type="checkbox" checked={form.roles.includes(r.name)} onChange={() => toggleRole(r.name)} />
            {r.label} <span style={dim}>({r.people})</span>
          </label>
        ))}
      </fieldset>
      <label style={labelCol}>Or one team
        <select value={form.team_manager} onChange={set("team_manager")} style={field}>
          <option value="">No single team</option>
          {data.teams.map((t) => <option key={t.id} value={t.id}>{`${t.name}’s team (${t.people})`}</option>)}
        </select>
      </label>
      <div style={dim}>{approx > 0 ? `Reaches about ${approx} ${approx === 1 ? "person" : "people"} (a person in two groups is counted twice here, and you are never sent your own).` : "Pick a role or a team."}</div>
      <fieldset style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        <legend style={{ fontSize: "0.72rem", fontWeight: 700, color: D.text }}>How</legend>
        <label style={{ fontSize: "0.82rem", color: D.text }}><input type="checkbox" checked disabled /> Banner and bell (always)</label>
        <label style={{ fontSize: "0.82rem", color: D.text }}>
          <input type="checkbox" checked={form.send_email} disabled={!data.channels.email} onChange={set("send_email")} /> Email{!data.channels.email ? " — not connected on this server" : ""}
        </label>
        <label style={{ fontSize: "0.82rem", color: D.textDim }}><input type="checkbox" disabled /> Push to phones — not connected</label>
        <label style={{ fontSize: "0.82rem", color: D.textDim }}><input type="checkbox" disabled /> SMS — not connected</label>
        <label style={{ fontSize: "0.82rem", color: D.textDim }}><input type="checkbox" disabled /> WhatsApp — not connected</label>
        {data.channels.email && <span style={dim}>E-mail is sent once, with no delivery check; the banner and bell are the record.</span>}
      </fieldset>
      <fieldset style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: 10, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <legend style={{ fontSize: "0.72rem", fontWeight: 700, color: D.text }}>When</legend>
        <label style={{ fontSize: "0.82rem", color: D.text }}><input type="radio" name="when" checked={form.when === "now"} onChange={() => setForm((f) => ({ ...f, when: "now" }))} /> Send now</label>
        <label style={{ fontSize: "0.82rem", color: D.text }}><input type="radio" name="when" checked={form.when === "schedule"} onChange={() => setForm((f) => ({ ...f, when: "schedule" }))} /> Schedule</label>
        {form.when === "schedule" && (
          <>
            <label style={labelCol}>Date<input type="date" value={form.date} onChange={set("date")} required style={field} /></label>
            <label style={labelCol}>Time<input type="time" value={form.time} onChange={set("time")} required style={field} /></label>
          </>
        )}
      </fieldset>
      <label style={{ fontSize: "0.82rem", color: D.text, display: "flex", gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" checked={form.require_confirm} onChange={set("require_confirm")} />
        <span>Ask each person to tap “I’ve read this”. You will see who hasn’t, and can remind them.</span>
      </label>
      {form.title && form.body && (
        <div role="note" aria-label="What staff will see" style={{ ...glassCard, padding: 12, display: "flex", flexDirection: "column", gap: 3, border: `1px dashed ${D.cardBorder}` }}>
          <span style={dim}>What staff will see</span>
          <strong style={{ color: D.text, fontSize: "0.85rem" }}>{form.title}</strong>
          <span style={{ color: D.text, fontSize: "0.8rem", whiteSpace: "pre-wrap" }}>{form.body}</span>
          {form.require_confirm && <span style={chip(D.gold)}>I’ve read this</span>}
        </div>
      )}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="submit" disabled={busy} style={button(D.gold, D.text, busy)}>{form.when === "schedule" ? "Schedule" : "Send now"}</button>
        <button type="button" disabled={busy || !form.title || !form.body} onClick={(e) => submit(e, "draft")} style={button(D.panelBg, D.text, busy || !form.title || !form.body)}>Save draft</button>
      </div>
    </form>
  );
}

function People({ id }) {
  const { data, isLoading, isError } = useAnnouncement(id);
  if (isLoading) return <div role="status" style={dim}>Loading…</div>;
  if (isError) return <div role="alert" style={errorStyle}>Could not load the recipients.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {data.people.map((p) => (
        <div key={p.id} style={{ fontSize: "0.78rem", color: D.text }}>
          {p.name} <span style={dim}>{p.role.replace("_", " ")}</span> · {p.confirmed_at ? `confirmed ${when(p.confirmed_at)}` : p.opened_at ? `opened ${when(p.opened_at)}` : "not opened yet"}
        </div>
      ))}
    </div>
  );
}

export default function StaffAnnouncementsPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useAnnouncements();
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [openId, setOpenId] = useState(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["announcements"] });

  const act = async (path, okText) => {
    setError(null); setNotice(null);
    try {
      const result = await apiPost(path, {});
      setNotice(typeof okText === "function" ? okText(result) : okText);
      refresh();
    } catch (err) {
      const detail = err?.body && typeof err.body === "object" ? Object.values(err.body).flat().join(" ") : "";
      setError(detail || apiErrorMessage(err, "That did not work."));
    }
  };

  return (
    <div style={page}>
      <h2 style={{ ...h2, fontSize: "1.4rem" }}>Staff announcements</h2>
      <div role="note" style={callout(D.amber)}>
        For staff only. Announcements appear inside the staff app as a banner and in the bell. They never reach customers or businesses; that is Marketing’s job, under AshantiHub’s own sender.
      </div>
      {notice && <div role="status" style={{ color: D.text, fontSize: "0.82rem", fontWeight: 700 }}>{notice}</div>}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      {isLoading && <div role="status" style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Could not load announcements. <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button></div>}
      {data && <Compose data={data} onDone={(text) => { setNotice(text); setError(null); }} />}
      {data && (
        <section aria-label="Scheduled and sent" style={section}>
          <h3 style={sectionTitle}>Scheduled and sent</h3>
          {data.announcements.length === 0 && <div style={dim}>No announcements yet.</div>}
          {data.announcements.length > 0 && (
            <div style={scroll}>
              <table style={table}>
                <thead><tr>{["Announcement", "To", "When", "Opened", "Confirmed", "Not opened yet", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {data.announcements.map((a) => (
                    <tr key={a.id}>
                      <td style={td}><span style={{ fontWeight: 700 }}>{a.title}</span> <span style={chip(a.status === "sent" ? D.green : D.textFaint)}>{STATUS[a.status]}</span></td>
                      <td style={td}>{a.to}{a.status === "sent" ? <div style={dim}>{`${a.recipients} people`}</div> : null}</td>
                      <td style={{ ...td, ...figures }}>{a.status === "sent" ? when(a.sent_at) : a.status === "scheduled" ? when(a.send_at) : ""}</td>
                      <td style={{ ...td, ...figures }}>{a.status === "sent" ? a.opened : ""}</td>
                      <td style={{ ...td, ...figures }}>{a.status === "sent" ? (a.require_confirm ? a.confirmed : "Not asked") : ""}</td>
                      <td style={{ ...td, ...figures }}>{a.status === "sent" ? a.not_opened : ""}</td>
                      <td style={td}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {a.status === "sent" && <button type="button" onClick={() => setOpenId(openId === a.id ? null : a.id)} style={button(D.panelBg, D.text)} aria-label={`Who has read ${a.title}`}>{openId === a.id ? "Hide" : "Who"}</button>}
                          {a.status === "sent" && <button type="button" onClick={() => act(`/api/announcements/${a.id}/remind/`, (r) => `Reminded ${r.reminded} ${r.reminded === 1 ? "person" : "people"}.`)} style={button(D.panelBg, D.text)} aria-label={`Remind them about ${a.title}`}>Remind them</button>}
                          {(a.status === "draft" || a.status === "scheduled") && <button type="button" onClick={() => act(`/api/announcements/${a.id}/cancel/`, "Cancelled.")} style={button(D.panelBg, D.red)} aria-label={`Cancel ${a.title}`}>Cancel</button>}
                        </div>
                        {openId === a.id && <div style={{ marginTop: 6 }}><People id={a.id} /></div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={dim}>Opened means the person saw it; confirmed means they tapped “I’ve read this”. A sent announcement cannot be taken back. A reminder can go once an hour.</div>
        </section>
      )}
    </div>
  );
}

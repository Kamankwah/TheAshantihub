import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiDownload, apiPatch, apiPost } from "../../../apiClient.js";
import { useMyExportFiles, useScheduleRuns, useScheduledExports } from "../../../hooks/useInsights.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { errorStyle } from "./portfolioParts.jsx";
import { Kpi, Status, Title, kpiGrid, page, section, sectionTitle, warn } from "./insightsParts.jsx";

// ─── Super Admin 09 Scheduled exports ────────────────────────────────────────
// Recurring files sent to named staff as a signed link, never as an attachment:
// the link works for 24 hours and only for that person, signed in. A schedule
// that includes personal data asks for the password when it is created or changed
// (the shell's password prompt retries the save), and every run is logged in the
// activity log as a report.exported event.
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const FORMATS = [["xlsx", "Excel"], ["csv", "CSV"], ["pdf", "PDF"]];
const FORMAT_LABEL = Object.fromEntries(FORMATS);
const RUN_LABEL = { ok: "Finished", partial: "Finished with problems", failed: "Failed" };
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
const ordinal = (n) => { const suffix = ["th", "st", "nd", "rd"]; const v = n % 100; return `${n}${suffix[(v - 20) % 10] || suffix[v] || suffix[0]}`; };
const everyText = (s) => (s.frequency === "daily" ? `Every day ${s.run_time}` : s.frequency === "weekly" ? `${WEEKDAYS[s.weekday]}s ${s.run_time}` : `The ${ordinal(s.day_of_month)} of the month ${s.run_time}`);
const blank = { name: "", kind: "revenue", period: "", team: "", recipients: [], frequency: "weekly", weekday: 0, day_of_month: 1, run_time: "07:00", format: "xlsx" };

function Runs({ id }) {
  const { data, isLoading, isError } = useScheduleRuns(id);
  if (isLoading) return <div role="status" style={dim}>Loading…</div>;
  if (isError) return <div role="alert" style={errorStyle}>Could not load the runs.</div>;
  if (!data.length) return <div style={dim}>It has not run yet.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {data.map((r) => (
        <div key={r.id} style={{ fontSize: "0.78rem", color: D.text }}>
          {when(r.started_at)} · {RUN_LABEL[r.status]} · {r.rows} rows
          {r.files.map((f) => <div key={f.recipient} style={{ ...dim, paddingLeft: 10 }}>{f.recipient}: {f.error ? f.error : f.opened ? "opened" : "not opened yet"}</div>)}
        </div>
      ))}
    </div>
  );
}

function Form({ data, initial, onDone, onCancel }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const kind = data.kinds.find((k) => k.key === form.kind);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggle = (id) => setForm((f) => ({ ...f, recipients: f.recipients.includes(id) ? f.recipients.filter((x) => x !== id) : [...f.recipients, id] }));
  const pickKind = (e) => {
    const next = data.kinds.find((k) => k.key === e.target.value);
    setForm((f) => ({ ...f, kind: next.key, period: next.presets[0]?.key || "", team: "", recipients: [] }));
  };

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    const body = {
      name: form.name, kind: form.kind, format: form.format, frequency: form.frequency, run_time: form.run_time, recipients: form.recipients,
      filters: { ...(kind.presets.length ? { period: form.period || kind.presets[0].key } : {}), ...(form.kind === "growth_funnel" && form.team ? { team: Number(form.team) } : {}) },
      ...(form.frequency === "weekly" ? { weekday: Number(form.weekday) } : {}),
      ...(form.frequency === "monthly" ? { day_of_month: Number(form.day_of_month) } : {}),
    };
    try {
      if (form.id) await apiPatch(`/api/insights/exports/${form.id}/`, body);
      else await apiPost("/api/insights/exports/", body);
      queryClient.invalidateQueries({ queryKey: ["insights"] });
      onDone();
    } catch (err) {
      const detail = err?.body && typeof err.body === "object" ? Object.values(err.body).flat().join(" ") : "";
      setError(detail || apiErrorMessage(err, "Could not save the schedule."));
    } finally {
      setSaving(false);
    }
  };

  const labelCol = { display: "flex", flexDirection: "column", gap: 3, fontSize: "0.72rem", fontWeight: 700, color: D.text };
  return (
    <form onSubmit={save} aria-label={form.id ? "Edit schedule" : "New schedule"} style={{ ...section, border: `1px solid ${D.gold}` }}>
      <h3 style={sectionTitle}>{form.id ? "Edit schedule" : "New schedule"}</h3>
      <label style={labelCol}>Name<input value={form.name} onChange={set("name")} maxLength={120} required style={field} /></label>
      <label style={labelCol}>What
        <select value={form.kind} onChange={pickKind} style={field}>{data.kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
        <span style={dim}>{kind.description}</span>
      </label>
      {kind.presets.length > 0 && (
        <label style={labelCol}>Period
          <select value={form.period || kind.presets[0].key} onChange={set("period")} style={field}>{kind.presets.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</select>
        </label>
      )}
      {form.kind === "growth_funnel" && (
        <label style={labelCol}>Team
          <select value={form.team} onChange={set("team")} style={field}><option value="">All scouts</option>{data.team_options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </label>
      )}
      <fieldset style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        <legend style={{ fontSize: "0.72rem", fontWeight: 700, color: D.text }}>Who gets it</legend>
        {data.staff.map((p) => (
          <label key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.82rem", color: D.text }}>
            <input type="checkbox" checked={form.recipients.includes(p.id)} onChange={() => toggle(p.id)} />
            {p.full_name} <span style={dim}>{p.role.replace(/_/g, " ")}</span>
          </label>
        ))}
        <span style={dim}>Someone who may not see this export is refused when you save.</span>
      </fieldset>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={labelCol}>Every
          <select value={form.frequency} onChange={set("frequency")} style={field}><option value="daily">Day</option><option value="weekly">Week</option><option value="monthly">Month</option></select>
        </label>
        {form.frequency === "weekly" && <label style={labelCol}>On<select value={form.weekday} onChange={set("weekday")} style={field}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>}
        {form.frequency === "monthly" && <label style={labelCol}>Day of the month<select value={form.day_of_month} onChange={set("day_of_month")} style={field}>{Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}</select></label>}
        <label style={labelCol}>At<input type="time" value={form.run_time} onChange={set("run_time")} required style={field} /></label>
        <label style={labelCol}>Format<select value={form.format} onChange={set("format")} style={field}>{FORMATS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      </div>
      {kind.personal_data && <div role="note" style={callout(D.amber)}>This export includes personal data. You will be asked for your password to save it. CSV cells that start with = + − or @ are made safe for Excel automatically.</div>}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={saving || form.recipients.length === 0 || !form.name.trim()} style={button(D.text, "#FDF6E3", saving || form.recipients.length === 0 || !form.name.trim())}>Save schedule</button>
        <button type="button" onClick={onCancel} style={button(D.panelBg, D.text)}>Cancel</button>
      </div>
    </form>
  );
}

function MyFiles() {
  const { data } = useMyExportFiles();
  const [error, setError] = useState("");
  if (!data?.length) return null;
  const get = async (file) => {
    setError("");
    try {
      await apiDownload(file.download_url, file.file_name);
    } catch (err) {
      setError(apiErrorMessage(err, "That link has expired."));
    }
  };
  return (
    <section aria-labelledby="my-files" style={section}>
      <h3 id="my-files" style={sectionTitle}>Files sent to you</h3>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      {data.map((f) => (
        <div key={f.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", fontSize: "0.82rem", color: D.text }}>
          <span>{f.name} <span style={dim}>· link works until {when(f.expires_at)}</span></span>
          <button type="button" onClick={() => get(f)} style={button(D.panelBg, D.text)}>Download</button>
        </div>
      ))}
    </section>
  );
}

export default function ScheduledExportsPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useScheduledExports();
  const [editing, setEditing] = useState(null);
  const [runsFor, setRunsFor] = useState(null);
  const [actionError, setActionError] = useState("");

  const toggle = async (s) => {
    setActionError("");
    try {
      await apiPost(`/api/insights/exports/${s.id}/${s.status === "paused" ? "resume" : "pause"}/`, {});
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not change the schedule."));
    } finally {
      queryClient.invalidateQueries({ queryKey: ["insights"] });
    }
  };
  const edit = (s) => setEditing({
    id: s.id, name: s.name, kind: s.kind, period: s.filters.period || "", team: s.filters.team || "", recipients: s.recipients.map((r) => r.id),
    frequency: s.frequency, weekday: s.weekday ?? 0, day_of_month: s.day_of_month ?? 1, run_time: s.run_time, format: s.format,
  });

  return (
    <div style={page}>
      <Title right={data && !editing && <button type="button" onClick={() => setEditing({ ...blank, period: data.kinds[0].presets[0]?.key || "" })} style={button(D.text, "#FDF6E3")}>New schedule</button>}>Scheduled exports</Title>
      <div style={{ ...dim, lineHeight: 1.5 }}>Files are never attached to emails. Each run makes a signed link that works for 24 hours and only for the named person, signed in. They are told by the bell and by email. A schedule that includes personal data asks for your password when you create or change it, and every run is logged in the activity log as an export.</div>
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <div style={kpiGrid}>
              <Kpi label="Active schedules" value={data.kpis.active} sub={`${data.kpis.active_personal} include personal data`} />
              <Kpi label="Paused" value={data.kpis.paused} sub="Not running" />
              <Kpi label="Runs in the last 7 days" value={data.kpis.runs_7_days} sub={data.kpis.runs_with_problems ? `${data.kpis.runs_with_problems} had problems` : "All finished"} subColor={data.kpis.runs_with_problems ? warn : undefined} />
              <Kpi label="Links never opened" value={data.kpis.never_opened} sub="Expired after 24 hours" />
            </div>
            {editing && <Form data={data} initial={editing} onDone={() => setEditing(null)} onCancel={() => setEditing(null)} />}
            <section aria-labelledby="schedules" style={section}>
              <h3 id="schedules" style={sectionTitle}>Schedules</h3>
              {data.schedules.length === 0 ? <span style={dim}>No export is scheduled. Choose New schedule to send one to named staff.</span> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Export", "Who gets it", "When", "Format", "Personal data", "Last · next run", "Status"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}<th scope="col" style={th}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Actions</span></th></tr></thead>
                    <tbody>
                      {data.schedules.map((s) => (
                        <tr key={s.id}>
                          <td style={td}><div style={{ fontWeight: 800 }}>{s.name}</div><div style={dim}>{s.kind_label}</div></td>
                          <td style={td}>{s.recipients.map((r) => r.full_name).join(", ")}</td>
                          <td style={td}>{everyText(s)}</td>
                          <td style={td}>{FORMAT_LABEL[s.format]}</td>
                          <td style={td}><span style={chip(s.personal_data ? D.amber : D.textDim)}>{s.personal_data ? "Yes" : "No"}</span>{s.password_confirmed_at && <div style={dim}>Password re-entered {when(s.password_confirmed_at)}</div>}</td>
                          <td style={{ ...td, ...figures }}>{s.last_run ? `${when(s.last_run_at)}${s.last_run.status !== "ok" ? ` · ${RUN_LABEL[s.last_run.status]}` : ""}` : "Not run yet"}<div style={dim}>{s.next_run_at ? `Next ${when(s.next_run_at)}` : "—"}</div></td>
                          <td style={td}><span style={chip(s.status === "paused" ? D.textDim : D.green)}>{s.status === "paused" ? "Paused" : "Active"}</span>{s.paused_by && <div style={dim}>By {s.paused_by}</div>}</td>
                          <td style={td}>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <button type="button" aria-label={`Edit ${s.name}`} onClick={() => edit(s)} style={button(D.panelBg, D.text)}>Edit</button>
                              <button type="button" aria-label={`${s.status === "paused" ? "Resume" : "Pause"} ${s.name}`} onClick={() => toggle(s)} style={button(D.panelBg, D.text)}>{s.status === "paused" ? "Resume" : "Pause"}</button>
                              <button type="button" aria-label={`Runs of ${s.name}`} onClick={() => setRunsFor(runsFor === s.id ? null : s.id)} style={button(D.panelBg, D.text)}>Runs</button>
                            </div>
                            {runsFor === s.id && <div style={{ marginTop: 8 }}><Runs id={s.id} /></div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            <MyFiles />
          </>
        )}
      </Status>
    </div>
  );
}

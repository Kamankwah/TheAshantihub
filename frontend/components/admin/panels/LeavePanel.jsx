import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiPatch, apiPost } from "../../../apiClient.js";
import { useHolidays, useLeavePreview, useTeamLeave } from "../../../hooks/useOpsPeople.js";
import { useMyTeam } from "../../../hooks/useMyTeam.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, chip, dim, field } from "./panelStyles.js";
import { dayShort, figures, isoDay, plural, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { errorStyle, eyebrow, h2, h3, labelStyle, toDate } from "./portfolioParts.jsx";

// ─── 08 Leave & calendar ─────────────────────────────────────────────────────
// A month grid of the team's leave with public holidays read-only (Super Admin
// keeps them), a form to record leave, and the team's leave list with Change
// and Cancel for leave that is current or still to come. Leave and holidays are
// zero-target days (targets.services.Calendar); this screen only records leave.
const KINDS = [
  ["annual", "Annual leave", D.blue], ["sick", "Sick leave", D.amber], ["compassionate", "Compassionate leave", D.purple],
  ["parental", "Maternity or paternity leave", D.green], ["unpaid", "Unpaid leave", D.textDim],
];
const KIND = Object.fromEntries(KINDS.map(([id, label, color]) => [id, { label, color }]));
KIND.other = { label: "Other leave", color: D.textDim };
const SHORT = { annual: "", sick: "sick", compassionate: "compassionate", parental: "parental", unpaid: "unpaid", other: "other" };
const STATUS = { on_leave: ["On leave now", D.blue], upcoming: ["Upcoming", D.amber], taken: ["Taken", D.textDim] };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const ROLE = { scout: "Scout", support: "Support", delivery_manager: "Delivery Manager", dispatch: "Dispatch" };

const initials = (name) => { const [first, ...rest] = (name || "").trim().split(/\s+/); return rest.length ? `${first} ${rest[rest.length - 1][0]}.` : first; };
const span = (leave) => (leave.start === leave.end ? dayShort(leave.start) : `${dayShort(leave.start)} – ${dayShort(leave.end)}`);

function Calendar({ month, leave, holidays, today, onMonth }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: Math.ceil((lead + count) / 7) * 7 }, (_, i) => i - lead + 1);
  const holidayOn = Object.fromEntries(holidays.map((h) => [h.date, h.name]));
  return (
    <section aria-labelledby="leave-cal" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 id="leave-cal" style={{ ...h2, fontSize: "1rem" }}>{first.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h3>
        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" aria-label="Previous month" onClick={() => onMonth(-1)} style={button(D.panelBg, D.text)}>‹</button>
          <button type="button" aria-label="Next month" onClick={() => onMonth(1)} style={button(D.panelBg, D.text)}>›</button>
        </div>
      </div>
      <div style={scroll}>
        <div role="grid" aria-labelledby="leave-cal" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(84px, 1fr))", gap: 4, minWidth: 620 }}>
          {WEEKDAYS.map((w) => <div key={w} role="columnheader" style={{ ...dim, fontWeight: 800, textAlign: "center" }}>{w}</div>)}
          {cells.map((n, i) => {
            if (n < 1 || n > count) return <div key={i} role="gridcell" aria-hidden="true" />;
            const iso = isoDay(new Date(month.getFullYear(), month.getMonth(), n));
            const sunday = i % 7 === 6;
            const isToday = iso === today;
            const away = leave.filter((l) => l.start <= iso && l.end >= iso);
            const holiday = holidayOn[iso];
            return (
              <div key={i} role="gridcell" aria-label={`${n} ${first.toLocaleDateString("en-GB", { month: "long" })}${isToday ? ", today" : ""}${holiday ? `, ${holiday}` : ""}${away.length ? `, ${away.map((l) => l.staff_name).join(", ")} on leave` : ""}`}
                style={{ minHeight: 78, borderRadius: 10, padding: 4, display: "flex", flexDirection: "column", gap: 3, background: sunday || holiday ? "#F1ECE4" : D.panelBg, border: isToday ? `2px solid ${D.text}` : `1px solid ${D.cardBorder}` }}>
                <span style={{ fontSize: "0.75rem", fontWeight: isToday ? 800 : 600, color: sunday ? D.textDim : D.text, ...figures }}>{n}</span>
                {holiday && <span style={{ ...chip(D.gold), whiteSpace: "normal" }}>{holiday}</span>}
                {away.map((l) => (
                  <span key={l.id} style={{ ...chip(KIND[l.kind]?.color || D.textDim), whiteSpace: "normal" }}>{`${initials(l.staff_name)}${SHORT[l.kind] ? ` · ${SHORT[l.kind]}` : ""}`}</span>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", ...dim }}>
        {KINDS.map(([id, label, color]) => <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: color }} />{label}</span>)}
        <span>Public holiday</span><span>Sunday · not a working day</span><span>Today (outlined)</span>
      </div>
    </section>
  );
}

function RecordForm({ team, auth, onDone }) {
  const today = isoDay(new Date());
  const [who, setWho] = useState("");
  const [kind, setKind] = useState("annual");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const person = team.find((m) => String(m.id) === String(who || team[0]?.id));
  const { data: preview } = useLeavePreview(person?.id, start, end);
  const first = person?.full_name.split(" ")[0];
  const submit = async (e) => {
    e.preventDefault();
    if (!person) return;
    setError(null); setSaving(true);
    try {
      await apiPost("/api/targets/leave/", { staff: person.id, kind, start, end });
      onDone(`Leave recorded for ${person.full_name}.`);
    } catch (err) { setError(apiErrorMessage(err, "Could not record the leave.")); }
    finally { setSaving(false); }
  };
  return (
    <form aria-labelledby="leave-add" onSubmit={submit} style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      <h3 id="leave-add" style={{ ...h2, fontSize: "1rem" }}>Record leave</h3>
      <label style={labelStyle}>Who
        <select value={person?.id ?? ""} onChange={(e) => setWho(e.target.value)} style={field}>
          {team.map((m) => <option key={m.id} value={m.id}>{`${m.full_name} (${ROLE[m.role] || m.role})`}</option>)}
        </select>
      </label>
      <label style={labelStyle}>Kind
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={field}>{KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ ...labelStyle, flex: 1 }}>From<input type="date" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} style={field} /></label>
        <label style={{ ...labelStyle, flex: 1 }}>To<input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} style={field} /></label>
      </div>
      {preview && (
        <div style={dim}>
          <strong style={{ color: D.text }}>{plural(preview.working_days, "working day", "working days")}</strong>
          {person?.role === "scout" ? ` · ${first}'s targets are zero on those days` : ` · ${first} is away on those days`}
        </div>
      )}
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <button type="submit" disabled={!person || saving} style={button(D.gold, D.text, !person || saving)}>{saving ? "Recording…" : "Record leave"}</button>
      <div style={dim}>You record leave for your own team only. The person sees it, and it's in the activity log.</div>
    </form>
  );
}

function LeaveRow({ row, mineId, onChanged, onMessage }) {
  const [mode, setMode] = useState(null); // "change" | "cancel"
  const [kind, setKind] = useState(row.kind);
  const [start, setStart] = useState(row.start);
  const [end, setEnd] = useState(row.end);
  const [error, setError] = useState(null);
  const [status, tone] = STATUS[row.status] || STATUS.taken;
  const started = row.status === "on_leave";
  const act = async (fn, ok) => {
    setError(null);
    try { await fn(); setMode(null); onMessage(ok); onChanged(); }
    catch (err) { setError(apiErrorMessage(err, "Could not do that.")); }
  };
  const kinds = row.kind === "other" ? [...KINDS, ["other", "Other leave", D.textDim]] : KINDS;
  return (
    <tr>
      <td style={td}><div style={{ fontWeight: 700 }}>{row.staff_name}</div><div style={dim}>{ROLE[row.staff_role] || row.staff_role}</div></td>
      <td style={td}>{KIND[row.kind]?.label || row.kind_label}</td>
      <td style={td}>{span(row)}</td>
      <td style={{ ...td, ...figures }}>{row.working_days}</td>
      <td style={td}>{`By ${row.recorded_by_id === mineId ? "you" : row.recorded_by} · ${dayShort(row.recorded_at)}`}</td>
      <td style={td}><span style={chip(tone)}>{status}</span></td>
      <td style={td}>
        {row.can_change && mode === null && (
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" aria-label={`Change leave for ${row.staff_name}`} onClick={() => setMode("change")} style={button(D.panelBg, D.text)}>Change</button>
            <button type="button" aria-label={`Cancel leave for ${row.staff_name}`} onClick={() => setMode("cancel")} style={button(D.panelBg, D.text)}>Cancel</button>
          </div>
        )}
        {mode === "change" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 190 }}>
            <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} style={field}>{kinds.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            <input aria-label="From" type="date" value={start} disabled={started} onChange={(e) => setStart(e.target.value)} style={field} />
            <input aria-label="To" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} style={field} />
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => act(() => apiPatch(`/api/targets/leave/${row.id}/`, { kind, start, end }), `Leave changed for ${row.staff_name}.`)} style={button(D.gold, D.text)}>Save</button>
              <button type="button" onClick={() => setMode(null)} style={button(D.panelBg, D.text)}>Close</button>
            </div>
          </div>
        )}
        {mode === "cancel" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 190 }}>
            <div style={dim}>{`Cancel this leave? ${row.staff_name.split(" ")[0]}'s targets count again on those days.`}</div>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" onClick={() => act(() => apiDelete(`/api/targets/leave/${row.id}/`), `Leave cancelled for ${row.staff_name}.`)} style={button(D.red, "#fff")}>Cancel leave</button>
              <button type="button" onClick={() => setMode(null)} style={button(D.panelBg, D.text)}>Keep it</button>
            </div>
          </div>
        )}
        {error && <div role="alert" style={errorStyle}>{error}</div>}
      </td>
    </tr>
  );
}

export default function LeavePanel({ auth }) {
  const queryClient = useQueryClient();
  const todayIso = isoDay(new Date());
  const [month, setMonth] = useState(() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), 1); });
  const [message, setMessage] = useState(null);
  const monthFrom = isoDay(month);
  const monthTo = isoDay(new Date(month.getFullYear(), month.getMonth() + 1, 0));
  const { data: inMonth } = useTeamLeave(monthFrom, monthTo);
  const { data: all, isLoading, isError, refetch } = useTeamLeave();
  const { data: team } = useMyTeam();
  const { data: holidaysThis } = useHolidays(month.getFullYear());
  const { data: holidaysNext } = useHolidays(month.getFullYear() + 1);
  const people = useMemo(() => (team || []).filter((m) => m.status === "active"), [team]);
  const holidays = useMemo(() => [...(holidaysThis || []), ...(holidaysNext || [])].sort((a, b) => (a.date < b.date ? -1 : 1)), [holidaysThis, holidaysNext]);
  const inThisMonth = holidays.filter((h) => h.date >= monthFrom && h.date <= monthTo);
  const upcoming = holidays.filter((h) => h.date >= todayIso && !inThisMonth.includes(h)).slice(0, 4);
  const listed = [...inThisMonth, ...upcoming];
  const refreshed = () => { ["team-leave", "targets-plans", "ops-scouts", "my-targets"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] })); };
  const done = (text) => { setMessage(text); refreshed(); };
  const order = { on_leave: 0, upcoming: 1, taken: 2 };
  const rows = [...(all || [])].sort((a, b) => (order[a.status] - order[b.status]) || (a.status === "taken" ? (a.start < b.start ? 1 : -1) : (a.start < b.start ? -1 : 1)));
  const monthName = month.toLocaleDateString("en-GB", { month: "long" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={eyebrow}>People</div>
        <h2 style={{ ...h2, fontSize: "1.4rem", margin: "2px 0 0" }}>Leave &amp; calendar</h2>
        <div style={dim}>Your team</div>
      </div>
      {message && <div role="status" style={{ color: D.green, fontSize: "0.82rem", fontWeight: 700 }}>{message}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
        <Calendar month={month} leave={inMonth || []} holidays={holidays} today={todayIso} onMonth={(n) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <section aria-labelledby="leave-hol" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <h3 id="leave-hol" style={{ ...h2, fontSize: "1rem" }}>Public holidays</h3>
              <span style={chip(D.textDim)}>Read-only</span>
            </div>
            <div style={dim}>Observed dates, kept by Super Admin. A holiday is a zero-target day for everyone.</div>
            {listed.map((h) => (
              <div key={h.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.82rem", color: D.text, borderTop: `1px solid ${D.divider}`, paddingTop: 6 }}>
                <span style={{ fontWeight: 700 }}>{h.name}</span><span style={figures}>{toDate(h.date)?.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
              </div>
            ))}
            {inThisMonth.length === 0 && <div style={dim}>{`No public holiday in ${monthName}.`}</div>}
            {holidays.length === 0 && <div style={dim}>No public holidays have been recorded yet.</div>}
          </section>
          <RecordForm key={people.length} team={people} auth={auth} onDone={done} />
        </div>
      </div>

      <section aria-labelledby="leave-team" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <h3 id="leave-team" style={{ ...h2, fontSize: "1rem" }}>Team leave</h3>
          <span style={dim}>Working days: scouts Mon–Sat · support Mon–Fri · set per person</span>
        </div>
        {isLoading && <div style={dim}>Loading…</div>}
        {isError && <div role="alert" style={errorStyle}>Couldn't load the leave. <button type="button" onClick={() => refetch()} style={button(D.panelBg, D.text)}>Try again</button></div>}
        {all && rows.length === 0 && <div style={dim}>No leave recorded for your team in the last 90 days, and none coming up.</div>}
        {rows.length > 0 && (
          <div style={scroll}>
            <table style={table}>
              <thead>
                <tr>
                  {["Person", "Kind", "Dates", "Working days", "Recorded", "Status"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}
                  <th scope="col" style={th}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Actions</span></th>
                </tr>
              </thead>
              <tbody>{rows.map((row) => <LeaveRow key={`${row.id}-${row.start}-${row.end}-${row.kind}`} row={row} mineId={auth?.user?.id} onChanged={refreshed} onMessage={setMessage} />)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

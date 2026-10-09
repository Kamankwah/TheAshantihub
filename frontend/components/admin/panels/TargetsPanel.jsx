import { useState } from "react";
import { useTargets } from "../../../hooks/useTargets.js";
import { D, glassCard } from "../theme.js";
import { button, dim } from "./panelStyles.js";
import { errorStyle, eyebrow, h3 } from "./portfolioParts.jsx";

// ─── 16 Targets ──────────────────────────────────────────────────────────────
// A scout's own targets for the day, week or month against what the records
// show they did. Targets come from Operations; this screen never invents one:
// a missing target says "No target set", a target with no work yet says "0 of T".
const PERIODS = [["day", "Day"], ["week", "Week"], ["month", "Month"]];
const figures = { fontVariantNumeric: "tabular-nums" };
const DAY_TAG = {
  done: ["Done", D.green], today: ["Today", D.text], ahead: ["Ahead", D.textDim], leave: ["Leave", D.textDim], holiday: ["Holiday", D.textDim],
};

// Parse "YYYY-MM-DD" as a local date (new Date("2026-10-10") would be UTC).
const local = (value) => { const [y, m, d] = String(value).split("-").map(Number); return new Date(y, m - 1, d); };
const fmt = (value, opts) => local(value).toLocaleDateString("en-GB", opts);
const longDate = (value) => fmt(value, { weekday: "long", day: "numeric", month: "long" });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function periodLine(data) {
  const { period, days = [] } = data;
  let range = data.label;
  if (period === "week" && days.length) {
    const first = days[0].date, last = days[days.length - 1].date;
    range = `${fmt(first, { weekday: "short", day: "numeric" })} – ${fmt(last, { weekday: "short", day: "numeric", month: "long" })}`;
  }
  const parts = [plural(data.working_days, "working day", "working days")];
  if (data.leave_days) parts.push(`${data.leave_days} on leave`);
  if (data.holiday_days) parts.push(plural(data.holiday_days, "public holiday", "public holidays"));
  return `${range} · ${parts.join(", ")}`;
}

const spanText = (leave) => (leave.start === leave.end
  ? `Leave on ${longDate(leave.start)}`
  : `Leave from ${longDate(leave.start)} to ${longDate(leave.end)}`);

// The note under the calendar, built only from what the server returned.
export function calendarNote(data) {
  const sentences = [];
  for (const leave of data.leave || []) sentences.push(`${spanText(leave)}, recorded by ${leave.recorded_by} — those days' targets are 0.`);
  for (const holiday of data.holidays || []) sentences.push(`${longDate(holiday.date)} is a public holiday (${holiday.name}) — that day's target is 0.`);
  if (data.sunday_off) sentences.push("Sunday isn't a working day.");
  return sentences.join(" ");
}

function MeasureCard({ measure, period }) {
  const hasTarget = measure.target != null;
  const pct = hasTarget && measure.target > 0 ? Math.min(100, Math.round((measure.done / measure.target) * 100)) : 0;
  const todayLine = measure.today_done == null ? null
    : measure.today_target == null ? `${period === "day" ? "This day" : "Today"} ${measure.today_done} · No target set`
      : `${period === "day" ? "This day" : "Today"} ${measure.today_done} of ${measure.today_target}`;
  return (
    <div role="group" aria-label={measure.label} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "0.95rem", fontWeight: 800, color: D.text }}>{measure.label}</span>
          <span style={dim}>{measure.how}</span>
        </span>
        <span style={{ fontSize: "1.25rem", fontWeight: 800, color: D.text, whiteSpace: "nowrap", ...figures }}>
          {measure.done}
          {hasTarget
            ? <span style={{ fontSize: "0.88rem", fontWeight: 600, color: D.textDim }}>{` of ${measure.target}`}</span>
            : <span style={{ fontSize: "0.78rem", fontWeight: 600, color: D.textDim }}>{" · No target set"}</span>}
        </span>
      </div>
      {hasTarget && (
        <div role="progressbar" aria-label={`${measure.label} progress`} aria-valuemin={0} aria-valuemax={measure.target} aria-valuenow={Math.min(measure.done, measure.target)}
          style={{ height: 8, borderRadius: 999, background: "#EADFC6", overflow: "hidden" }}>
          <div style={{ height: 8, width: `${pct}%`, background: D.text, borderRadius: 999 }} />
        </div>
      )}
      {todayLine && <div style={{ ...dim, fontWeight: 600, ...figures }}>{todayLine}</div>}
    </div>
  );
}

function DayCell({ day }) {
  const [tag, tagColor] = DAY_TAG[day.state] || DAY_TAG.ahead;
  const date = local(day.date);
  const isToday = day.state === "today";
  const muted = day.state === "leave" || day.state === "holiday";
  const dow = date.toLocaleDateString("en-GB", { weekday: "short" });
  const aria = `${dow} ${date.getDate()}, ${day.state === "ahead" ? "working day" : day.state}${muted ? ", targets 0" : ""}`;
  return (
    <li aria-label={aria} style={{
      borderRadius: 12, padding: "8px 2px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      background: muted ? "#F1ECE4" : D.panelBg, border: isToday ? `2px solid ${D.text}` : muted ? `1px dashed ${D.cardBorderStrong}` : `1px solid ${D.cardBorder}`,
    }}>
      <span style={{ fontSize: "0.68rem", fontWeight: 700, color: D.textDim }}>{dow}</span>
      <span style={{ fontSize: "1.1rem", fontWeight: 800, color: muted ? D.textDim : D.text, ...figures }}>{date.getDate()}</span>
      <span style={{ fontSize: "0.62rem", fontWeight: 800, color: tagColor }}>{tag}</span>
    </li>
  );
}

export default function TargetsPanel() {
  const [period, setPeriod] = useState("week");
  const { data, isLoading, isError, refetch } = useTargets(period);
  const lead = data?.lead?.name;
  const noun = period === "day" ? "this day" : `this ${period}`;
  const note = data ? calendarNote(data) : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div>
        <div style={eyebrow}>Performance</div>
        <h2 style={{ color: D.text, fontSize: "1.4rem", fontWeight: 800, margin: "2px 0 0" }}>Targets</h2>
        {data?.set_by && <div style={dim}>{`Set by ${data.set_by}`}</div>}
      </div>

      <div role="group" aria-label="Period" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", background: D.panelBg, border: `1px solid ${D.cardBorder}`, borderRadius: 12, padding: 4, gap: 4 }}>
        {PERIODS.map(([id, label]) => (
          <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)}
            style={{ minHeight: 44, border: 0, borderRadius: 9, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "0.88rem", background: period === id ? D.text : "transparent", color: period === id ? "#FDF6E3" : D.text }}>
            {label}
          </button>
        ))}
      </div>

      {isLoading && <div style={dim}>Loading…</div>}
      {isError && (
        <div role="alert" style={errorStyle}>
          Couldn't load your targets.{" "}
          <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button>
        </div>
      )}

      {data && (
        <>
          <div style={{ fontSize: "0.82rem", fontWeight: 600, color: D.text, ...figures }}>{periodLine(data)}</div>

          {!data.has_targets && (
            <div role="status" style={{ ...glassCard, padding: 14, fontSize: "0.85rem", color: D.text, lineHeight: 1.45 }}>
              <strong>No targets set yet</strong>{` — ${lead || "Operations"} sets them. What you have done ${noun} is shown below.`}
            </div>
          )}

          <section aria-label={`Your measures ${noun}`} style={{ ...glassCard, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
            {data.measures.map((m) => <MeasureCard key={m.metric} measure={m} period={period} />)}
          </section>

          {data.days.length > 0 && (
            <section aria-labelledby="targets-days" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <h3 id="targets-days" style={{ ...h3, fontSize: "0.95rem" }}>{`Working days ${noun}`}</h3>
              <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: `repeat(${Math.min(period === "month" ? 7 : 6, Math.max(1, data.days.length))}, minmax(0, 1fr))`, gap: 6 }}>
                {data.days.map((day) => <DayCell key={day.date} day={day} />)}
              </ol>
              {note && <div style={{ ...dim, fontSize: "0.78rem", lineHeight: 1.45 }}>{note}</div>}
            </section>
          )}

          {data.has_targets && (
            <section aria-labelledby="targets-daily" style={{ background: "#F5ECD8", borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              <h3 id="targets-daily" style={{ ...h3, fontSize: "0.95rem" }}>Your daily targets</h3>
              <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
                {data.daily.map((x) => (
                  <div key={x.metric} style={{ background: D.panelBg, borderRadius: 10, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <dt style={{ fontSize: "0.8rem", fontWeight: 600, color: D.textDim }}>{x.label}</dt>
                    <dd style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: D.text, ...figures }}>{x.value ?? "Not set"}</dd>
                  </div>
                ))}
              </dl>
              <div style={{ ...dim, fontSize: "0.78rem", lineHeight: 1.45 }}>
                {data.effective_from ? `Since ${fmt(data.effective_from, { day: "numeric", month: "long", year: "numeric" })}, within the limits Super Admin sets. ` : ""}
                Week and month are the sum of your working days.
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { C } from "../theme.js";

// Seven rows (Monday first, matching the API's weekday 0-6), a Closed toggle on
// each, and a "copy Monday to weekdays" shortcut. Nothing is pre-filled: a
// business with no saved hours starts blank, never with a made-up default.
// Times are Ghana (Accra) local time. Overnight hours are not allowed.
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function startRows(initialDays) {
  const byDay = new Map((initialDays || []).map((d) => [d.weekday, d]));
  return DAYS.map((_, weekday) => {
    const d = byDay.get(weekday);
    return { closed: !!d?.closed, opens: d?.opens || "", closes: d?.closes || "" };
  });
}

// The first thing wrong with the week, in plain words, or null.
export function hoursProblem(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    if (r.closed) continue;
    if (!r.opens || !r.closes) return `Enter opening and closing times for ${DAYS[i]}, or mark it closed.`;
    if (r.opens >= r.closes) return `${DAYS[i]}: opening time must be before closing time (overnight hours aren't supported).`;
  }
  if (rows.every((r) => r.closed)) return "Your business must be open at least one day a week.";
  return null;
}

const timeInput = { padding: "7px 8px", borderRadius: 8, border: "1.5px solid #ddd", fontSize: "0.8rem", fontFamily: "inherit", background: "#fff", color: C.darkBrown };

export default function BusinessHoursEditor({ initialDays, onSave, saving = false, saveLabel = "Save hours", error = null }) {
  const [rows, setRows] = useState(() => startRows(initialDays));
  const [touched, setTouched] = useState(false);
  const problem = hoursProblem(rows);

  const change = (i, patch) => { setTouched(true); setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); };
  const copyMonday = () => {
    setTouched(true);
    setRows((rs) => rs.map((r, j) => (j >= 1 && j <= 4 ? { ...rs[0] } : r)));
  };
  const submit = (e) => {
    e.preventDefault();
    if (problem) return;
    onSave(rows.map((r, weekday) => ({
      weekday, closed: r.closed, opens: r.closed ? null : r.opens, closes: r.closed ? null : r.closes,
    })));
  };

  return (
    <form onSubmit={submit} aria-label="Weekly opening hours">
      <div style={{ fontSize: "0.72rem", color: "#666", marginBottom: 10, lineHeight: 1.5 }}>
        Ghana time. An order placed while you are closed is held until you next open.
      </div>
      {rows.map((r, i) => (
        <div key={DAYS[i]} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 0", borderBottom: "1px solid rgba(44,24,16,0.1)" }}>
          <span style={{ width: 84, fontWeight: 700, fontSize: "0.78rem", color: C.darkBrown }}>{DAYS[i]}</span>
          <input type="time" aria-label={`${DAYS[i]} opens`} value={r.opens} disabled={r.closed} onChange={(e) => change(i, { opens: e.target.value })} style={{ ...timeInput, opacity: r.closed ? 0.4 : 1 }} />
          <span style={{ fontSize: "0.72rem", color: "#666" }}>to</span>
          <input type="time" aria-label={`${DAYS[i]} closes`} value={r.closes} disabled={r.closed} onChange={(e) => change(i, { closes: e.target.value })} style={{ ...timeInput, opacity: r.closed ? 0.4 : 1 }} />
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.74rem", color: C.darkBrown, marginLeft: "auto" }}>
            <input type="checkbox" aria-label={`${DAYS[i]} closed`} checked={r.closed} onChange={(e) => change(i, { closed: e.target.checked })} />
            Closed
          </label>
        </div>
      ))}
      <button type="button" onClick={copyMonday} style={{ marginTop: 10, background: "none", border: `1.5px solid ${C.gold}`, color: C.darkBrown, borderRadius: 20, padding: "6px 14px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
        Copy Monday to weekdays
      </button>
      {touched && problem && <div role="alert" style={{ color: C.kente1, fontSize: "0.74rem", marginTop: 10 }}>{problem}</div>}
      {error && <div role="alert" style={{ color: C.kente1, fontSize: "0.74rem", marginTop: 10 }}>{error}</div>}
      <button type="submit" disabled={saving || !!problem} style={{ width: "100%", background: C.gold, color: C.darkBrown, border: "none", borderRadius: 20, padding: 12, fontWeight: 900, fontSize: "0.85rem", cursor: problem || saving ? "not-allowed" : "pointer", opacity: problem ? 0.55 : 1, fontFamily: "inherit", marginTop: 12 }}>
        {saving ? "Saving…" : saveLabel}
      </button>
    </form>
  );
}

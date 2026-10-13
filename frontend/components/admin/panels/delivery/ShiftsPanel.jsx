import { useState } from "react";
import { apiDelete, apiPatch, apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useDeliveryShifts } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { button, chip, dim, field } from "../panelStyles.js";
import { Kpi, Status, Title, kpiGrid, page, section, sectionTitle } from "../insightsParts.jsx";
import { Empty, ErrorLine, Note, clock, dayOnly } from "./deliveryParts.jsx";

// ─── Delivery Manager 12 Shifts ──────────────────────────────────────────────
// A planned shift is a plan; the rider's actual time on shift is separate. The demand line is
// the average of the previous four same weekdays and is shown only when all four had
// deliveries: with less history it says "not enough history" instead of a number.
const STATUS = { draft: ["Draft", D.textDim], published: ["Published", D.green], open: ["Open", D.amber], swap: ["Swap asked", D.blue] };
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (value, n) => { const d = new Date(`${value}T00:00:00`); d.setDate(d.getDate() + n); return iso(d); };

function AddShift({ data, day, onDone }) {
  const [form, setForm] = useState({ rider: "", zone: "", start: "08:00", end: "17:00" });
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = async () => {
    setError("");
    try {
      await apiPost("/api/delivery/shifts/", {
        rider: form.rider ? Number(form.rider) : null, zone: form.zone ? Number(form.zone) : null,
        starts_at: new Date(`${day}T${form.start}:00`).toISOString(), ends_at: new Date(`${day}T${form.end}:00`).toISOString(),
      });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not add the shift."));
    }
  };
  const label = (text, control) => <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>{text}{control}</label>;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }} role="group" aria-label={`Add a shift on ${dayOnly(day)}`}>
      <ErrorLine>{error}</ErrorLine>
      {label("Rider", <select value={form.rider} onChange={set("rider")} style={field}><option value="">Open (no rider yet)</option>{data.riders.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}</select>)}
      {label("Zone", <select value={form.zone} onChange={set("zone")} style={field}><option value="">Any zone</option>{data.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>)}
      {label("From", <input type="time" value={form.start} onChange={set("start")} style={field} />)}
      {label("To", <input type="time" value={form.end} onChange={set("end")} style={field} />)}
      <button type="button" onClick={save} style={button(D.gold, D.text)}>Add shift</button>
    </div>
  );
}

export default function ShiftsPanel() {
  const [week, setWeek] = useState("");
  const { data, isLoading, isError, refetch } = useDeliveryShifts({ week });
  const [adding, setAdding] = useState(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const monday = data?.week_start;
  const run = async (fn, ok, failure) => {
    setError("");
    setDone("");
    try { const out = await fn(); setDone(typeof ok === "function" ? ok(out) : ok); refetch(); } catch (err) { setError(apiErrorMessage(err, failure)); }
  };
  const days = monday ? Array.from({ length: 7 }, (_, i) => addDays(monday, i)) : [];
  const byDay = (day) => (data?.results || []).filter((s) => iso(new Date(s.starts_at)) === day).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const demandOf = (day) => (data?.demand || []).find((d) => d.date === day);

  return (
    <div style={page}>
      <Title right={monday && (
        <>
          <button type="button" onClick={() => setWeek(addDays(monday, -7))} style={button(D.panelBg, D.text)}>Previous week</button>
          <button type="button" onClick={() => setWeek(addDays(monday, 7))} style={button(D.panelBg, D.text)}>Next week</button>
          <button type="button" onClick={() => run(() => apiPost("/api/delivery/shifts/copy-week/", { from: addDays(monday, -7), to: monday }), (o) => `Copied ${o.copied} shifts from last week.`, "Could not copy last week.")} style={button(D.panelBg, D.text)}>Copy last week</button>
          <button type="button" onClick={() => run(() => apiPost("/api/delivery/shifts/publish/", { week: monday }), (o) => `Published ${o.published} shifts; ${o.riders_told} riders told.`, "Could not publish.")} style={button(D.gold, D.text)}>Publish</button>
        </>
      )}>Shifts</Title>
      <ErrorLine>{error}</ErrorLine>
      {done && <div role="status" style={{ color: D.green, fontWeight: 700, fontSize: "0.8rem" }}>{done}</div>}
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <div style={{ fontSize: "0.85rem", fontWeight: 800, color: D.text }}>Week of {dayOnly(monday)}</div>
            <div style={kpiGrid}>
              <Kpi label="Draft" value={data.counts.draft} sub="Not yet seen by riders" />
              <Kpi label="Published" value={data.counts.published} />
              <Kpi label="Open, no rider" value={data.counts.open} />
              <Kpi label="Swaps to decide" value={data.counts.swap} />
            </div>
            {days.map((day) => {
              const shifts = byDay(day);
              const demand = demandOf(day);
              return (
                <section key={day} aria-label={dayOnly(day)} style={section}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                    <h3 style={sectionTitle}>{dayOnly(day)}</h3>
                    <span style={dim}>{demand?.enough_history ? `Expected about ${demand.average_deliveries} deliveries: ${demand.shifts_needed} shifts (${demand.per_shift} deliveries a shift)` : "Not enough history to expect a demand"}</span>
                  </div>
                  {shifts.length === 0 ? <Empty>No shift planned.</Empty> : shifts.map((s) => {
                    const [text, color] = STATUS[s.status] || [s.status_label, D.textDim];
                    return (
                      <div key={s.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: "0.82rem", color: D.text }}>
                        <span style={{ minWidth: 100, fontWeight: 700 }}>{clock(s.starts_at)}–{clock(s.ends_at)}</span>
                        <span style={{ minWidth: 140 }}>{s.rider ? s.rider.full_name : <i>No rider</i>}</span>
                        <span style={{ minWidth: 90 }}>{s.zone?.name || "Any zone"}</span>
                        <span style={chip(color)}>{text}</span>
                        {s.status === "swap" && s.swap_with && (
                          <>
                            <span style={dim}>with {s.swap_with.full_name}</span>
                            <button type="button" onClick={() => run(() => apiPost(`/api/delivery/shifts/${s.id}/swap-decision/`, { approve: true }), "Swap approved.", "Could not approve the swap.")} style={button(D.gold, D.text)}>Approve swap</button>
                            <button type="button" onClick={() => run(() => apiPost(`/api/delivery/shifts/${s.id}/swap-decision/`, { approve: false }), "Swap declined.", "Could not decline the swap.")} style={button(D.panelBg, D.text)}>Decline</button>
                          </>
                        )}
                        {s.status === "open" && (
                          <select aria-label={`Give ${dayOnly(day)} ${clock(s.starts_at)} shift to`} defaultValue="" onChange={(e) => e.target.value && run(() => apiPatch(`/api/delivery/shifts/${s.id}/`, { rider: Number(e.target.value) }), "Shift given.", "Could not give the shift.")} style={field}>
                            <option value="">Give to…</option>{data.riders.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
                          </select>
                        )}
                        <button type="button" aria-label={`Remove the ${clock(s.starts_at)} shift on ${dayOnly(day)}`} onClick={() => run(() => apiDelete(`/api/delivery/shifts/${s.id}/`), "Shift removed.", "Could not remove the shift.")} style={button(D.panelBg, D.text)}>Remove</button>
                      </div>
                    );
                  })}
                  {adding === day ? <AddShift data={data} day={day} onDone={() => { setAdding(null); refetch(); }} /> : <div><button type="button" onClick={() => setAdding(day)} style={button(D.panelBg, D.text)}>Add a shift</button></div>}
                </section>
              );
            })}
            <Note>Publishing tells each rider with a draft shift. Riders ask to swap from their app and you decide here. A planned shift does not put anyone on shift: riders start their own shift on their phone, and only with every paper in date.</Note>
          </>
        )}
      </Status>
    </div>
  );
}

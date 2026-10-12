import { useMemo, useState } from "react";
import { useTeamVisits } from "../../../hooks/useOpsActivity.js";
import { D, glassCard } from "../theme.js";
import TeamVisitMap from "./TeamVisitMap.jsx";
import { figures } from "./opsPeopleParts.jsx";
import { button, chip, dim, field } from "./panelStyles.js";
import { errorStyle, eyebrow, h2, h3, labelStyle } from "./portfolioParts.jsx";
import { LOCATION_RULE, PURPOSES, timeOf } from "./visitParts.jsx";

// ─── 20 Visit map ────────────────────────────────────────────────────────────
// One day's check-ins by the lead's own team (GET /api/field/visits/team/): a map
// of where each scout checked in, flagged ones marked, and the same visits as a
// list. Visit records, not live positions.
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const first = (name) => (name || "").trim().split(/\s+/)[0];
const placeOf = (v) => v.business?.name || v.prospect?.name || "Visit";
const timesOf = (v) => (v.status === "open" ? `${timeOf(v.checked_in_at)} · still there` : `${timeOf(v.checked_in_at)} – ${timeOf(v.checked_out_at)}`);
const distanceOf = (v) => {
  if (v.distance_m == null) return v.pin ? "" : v.business ? "No pin set for this business" : "Prospect · no pin yet";
  return `${Math.round(v.distance_m)} m from the pin${v.outside_radius ? ` — outside the ${v.radius_m} m radius` : ""}${v.accuracy_m != null ? ` · accuracy ±${Math.round(v.accuracy_m)} m` : ""}`;
};
const hasFix = (v) => Number.isFinite(v.fix?.lat) && Number.isFinite(v.fix?.lng) && !(v.fix.lat === 0 && v.fix.lng === 0);
const stateOf = (v) => (v.outside_radius ? "flagged" : v.status === "open" ? "here" : "out");

export default function TeamVisitMapPanel({ onOpenBusiness }) {
  const [day, setDay] = useState(today());
  const [scout, setScout] = useState("");
  const [purpose, setPurpose] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [selected, setSelected] = useState(null);
  const { data, isLoading, isError, refetch } = useTeamVisits({ day: day === today() ? "today" : day, scout, purpose, flagged: flagged ? "1" : "" });
  const visits = useMemo(() => data?.results || [], [data]);
  const summary = data?.summary || {};
  const points = useMemo(() => visits.filter(hasFix).map((v) => ({ id: v.id, lat: v.fix.lat, lng: v.fix.lng, state: stateOf(v), label: `${first(v.scout_name)} · ${placeOf(v)}${v.outside_radius ? ` · ${Math.round(v.distance_m)} m off` : ""}` })), [visits]);
  const unplaced = visits.length - points.length;
  const open = visits.find((v) => v.id === selected) || null;
  const isToday = day === today();
  const when = isToday ? "today" : new Date(`${day}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1100 }}>
      <div>
        <div style={eyebrow}>Activity · your team</div>
        <h2 style={{ ...h2, fontSize: "1.4rem", margin: "2px 0 0" }}>Visit map</h2>
      </div>

      <div role="group" aria-label="Filters" style={{ ...glassCard, padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, alignItems: "end" }}>
        <label style={labelStyle}>Day<input type="date" value={day} max={today()} onChange={(e) => { setDay(e.target.value || today()); setSelected(null); }} style={{ ...field, minHeight: 38 }} /></label>
        <label style={labelStyle}>Scout
          <select value={scout} onChange={(e) => { setScout(e.target.value); setSelected(null); }} style={{ ...field, minHeight: 38 }}>
            <option value="">{`All ${data?.scouts?.length ?? ""} scouts`.replace("  ", " ")}</option>
            {(data?.scouts || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label style={labelStyle}>Purpose
          <select value={purpose} onChange={(e) => { setPurpose(e.target.value); setSelected(null); }} style={{ ...field, minHeight: 38 }}>
            <option value="">Any purpose</option>
            {PURPOSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 38 }}>
          <input type="checkbox" checked={flagged} onChange={(e) => { setFlagged(e.target.checked); setSelected(null); }} /> Flagged only
        </label>
      </div>

      {isError && <div role="alert" style={errorStyle}>Couldn't load the team's check-ins. <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button></div>}
      {isLoading && <div style={dim}>Loading…</div>}

      {data && (
        <>
          <section aria-label="Map" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
              <h3 style={h3}>{`Check-ins ${when} · ${summary.total}`}</h3>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <span style={chip(D.green)}>{`${summary.still_there} still there`}</span>
                <span style={chip(D.textDim)}>{`${summary.checked_out} checked out`}</span>
                {summary.flagged > 0 && <span style={chip(D.amber)}>{`🚩 ${summary.flagged} outside the ${data.radius_m} m radius`}</span>}
              </span>
            </div>
            {points.length > 0
              ? <TeamVisitMap points={points} selectedId={selected} onSelect={setSelected} label={`Map of ${points.length} check-ins`} />
              : <div style={{ ...dim, padding: "18px 4px" }}>{summary.total === 0 ? (summary.team_total === 0 ? `Your team has no check-ins ${when}.` : "No check-ins match those filters.") : "None of these check-ins recorded a position."}</div>}
            {unplaced > 0 && points.length > 0 && <div style={dim}>{`${unplaced} ${unplaced === 1 ? "check-in has" : "check-ins have"} no recorded position and ${unplaced === 1 ? "is" : "are"} listed below only.`}</div>}
            <div style={{ ...dim, lineHeight: 1.45 }}>{`${LOCATION_RULE.replace("Your location is", "A scout's location is")} These are visit records, not live positions.`}</div>
          </section>

          {open && (
            <section aria-label="Check-in" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <h3 style={h3}>{placeOf(open)}</h3>
                <button type="button" onClick={() => setSelected(null)} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Close</button>
              </div>
              <div style={{ ...figures, fontSize: "0.82rem" }}>{`${open.scout_name} · ${open.purpose_label} · ${timesOf(open)}${open.minutes != null ? ` · ${open.minutes} min` : ""}`}</div>
              <div style={{ ...dim, ...figures, color: open.outside_radius ? D.red : D.textDim, fontWeight: open.outside_radius ? 700 : 400 }}>{distanceOf(open)}</div>
              {open.business?.area && <div style={dim}>{`Area: ${open.business.area}`}</div>}
              {open.notes && <div style={{ fontSize: "0.8rem" }}>{open.notes}</div>}
              <div style={dim}>{open.photos?.length ? `${open.photos.length} ${open.photos.length === 1 ? "photo" : "photos"} taken` : "No photos"}</div>
              {open.business && onOpenBusiness && <div><button type="button" onClick={() => onOpenBusiness(open.business.id)} style={{ ...button(D.gold, D.text), minHeight: 40 }}>Open the business</button></div>}
            </section>
          )}

          <section aria-label="Check-ins list" style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
              <h3 style={h3}>Newest first</h3>
              {summary.flagged > 0 && <span style={dim}>{`${summary.flagged} flagged`}</span>}
            </div>
            {visits.length === 0 && <div style={dim}>Nothing to list.</div>}
            {visits.map((v) => (
              <button key={v.id} type="button" aria-pressed={v.id === selected} onClick={() => setSelected(v.id)}
                style={{ textAlign: "left", background: v.outside_radius ? `${D.amber}1f` : v.id === selected ? D.panelBg2 : "transparent", border: "none", borderTop: `1px solid ${D.divider}`, padding: "9px 6px", cursor: "pointer", fontFamily: "inherit", color: D.text, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{placeOf(v)}</span>
                  <span style={{ ...figures, fontSize: "0.78rem", fontWeight: 700, whiteSpace: "nowrap" }}>{timesOf(v)}</span>
                </span>
                <span style={dim}>{`${v.scout_name} · ${v.purpose_label}`}</span>
                {distanceOf(v) && <span style={{ ...dim, ...figures, color: v.outside_radius ? D.red : D.textDim, fontWeight: v.outside_radius ? 700 : 400 }}>{distanceOf(v)}</span>}
              </button>
            ))}
            {data.truncated && <div style={dim}>Showing the newest 300. Narrow the filters to see the rest.</div>}
          </section>
        </>
      )}
    </div>
  );
}

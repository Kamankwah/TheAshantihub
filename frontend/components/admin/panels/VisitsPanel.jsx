import { useState } from "react";
import { useOpenVisit, useVisits } from "../../../hooks/useVisits.js";
import { D, glassCard } from "../theme.js";
import { button, dim, pill } from "./panelStyles.js";
import CheckInPanel from "./CheckInPanel.jsx";
import { errorStyle, eyebrow, h3 } from "./portfolioParts.jsx";
import { FOOTER_RULE, FlagChip, dayLabel, flagText, timeOf } from "./visitParts.jsx";

const PAGE = 50;
const figures = { fontVariantNumeric: "tabular-nums" };
const ageOf = (visit) => (visit.status === "open" ? "In progress" : visit.minutes != null ? `${visit.minutes} min` : "");
const timesOf = (visit) => (visit.status === "open" ? `In ${timeOf(visit.checked_in_at)}` : `${timeOf(visit.checked_in_at)} – ${timeOf(visit.checked_out_at)}`);

// The check-in route is /staff/visits/check-in (optionally -<businessId>, from
// a business page that pre-selects its business).
const CHECK_IN = /^check-in(?:-(\d+))?$/;

export function groupByDay(visits, now = new Date()) {
  const groups = [];
  for (const visit of visits) {
    const date = new Date(visit.checked_in_at);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      group = { key, label: dayLabel(date, now), visits: [] };
      groups.push(group);
    }
    group.visits.push(visit);
  }
  return groups;
}

const countText = (visits) => {
  const open = visits.filter((v) => v.status === "open").length;
  const done = visits.length - open;
  if (open) return `${done} done · ${open} open`;
  return visits.length === 1 ? "1 visit" : `${visits.length} visits`;
};

// 13 Visits — the scout's own check-ins, newest first, grouped by day.
export default function VisitsPanel({ detailId, onOpenDetail }) {
  const checkIn = typeof detailId === "string" ? CHECK_IN.exec(detailId) : null;
  if (checkIn) return <CheckInPanel presetBusinessId={checkIn[1] ? Number(checkIn[1]) : null} onBack={() => onOpenDetail?.(null)} />;
  return <VisitList onCheckIn={() => onOpenDetail?.("check-in")} />;
}

function VisitList({ onCheckIn }) {
  const [range, setRange] = useState("week");
  const [limit, setLimit] = useState(PAGE);
  const { data, isLoading, isError, refetch } = useVisits(range, limit);
  const { data: openData } = useOpenVisit();
  const month = new Date().toLocaleDateString("en-GB", { month: "long" });
  const results = data?.results || [];
  const summary = data?.summary || {};
  const hidden = Math.max(0, (data?.count || 0) - results.length);
  const nextDay = data?.next_hidden_at ? new Date(data.next_hidden_at).toLocaleDateString("en-GB", { weekday: "long" }) : "";
  const choose = (next) => { setRange(next); setLimit(PAGE); };
  const tiles = [
    ["This week", String(summary.done ?? 0), D.text],
    ["Average stay", summary.avg_minutes != null ? `${summary.avg_minutes} min` : "—", D.text],
    ["Flagged", String(summary.flagged ?? 0), summary.flagged ? D.amber : D.text],
  ];
  const empty = range === "flagged" ? "No flagged visits." : range === "month" ? `No visits in ${month} yet.` : "No visits this week yet.";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div>
        <div style={eyebrow}>Activity</div>
        <h2 style={{ color: D.text, fontSize: "1.4rem", fontWeight: 800, margin: "2px 0 0" }}>Visits</h2>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {tiles.map(([label, value, color]) => (
          <div key={label} style={{ ...glassCard, padding: "10px 12px" }}>
            <div style={{ ...dim, fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 800, color, ...figures }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div role="group" aria-label="Show" style={{ display: "flex", gap: 6, flex: 1, flexWrap: "wrap" }}>
          {[["week", "This week"], ["month", month], ["flagged", "Flagged"]].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={range === id} onClick={() => choose(id)} style={{ ...pill(range === id), minHeight: 40 }}>{label}</button>
          ))}
        </div>
        <button type="button" onClick={onCheckIn} style={{ ...button(D.gold, D.text), minHeight: 44, display: "inline-flex", alignItems: "center", gap: 6 }}>
          {openData?.visit ? "📍 Open visit" : "📍 Check in"}
        </button>
      </div>

      {isLoading && <div style={dim}>Loading…</div>}
      {isError && (
        <div role="alert" style={errorStyle}>
          Couldn't load your visits.{" "}
          <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button>
        </div>
      )}
      {!isLoading && !isError && results.length === 0 && <div style={{ ...glassCard, padding: 14, ...dim }}>{empty}</div>}

      {groupByDay(results).map((group) => (
        <section key={group.key} aria-label={group.label} style={{ ...glassCard, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
            <h3 style={h3}>{group.label}</h3>
            <span style={{ ...dim, fontWeight: 600 }}>{countText(group.visits)}</span>
          </div>
          {group.visits.map((visit) => {
            const body = (
              <>
                <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.85rem", color: D.text }}>{visit.business?.name || visit.prospect?.name || "Visit"}</span>
                  <span style={{ fontSize: "0.8rem", fontWeight: 800, whiteSpace: "nowrap", color: visit.status === "open" ? D.green : D.text, ...figures }}>{ageOf(visit)}</span>
                </span>
                <span style={{ ...dim, ...figures }}>
                  <span style={{ fontWeight: 700, color: D.text }}>{timesOf(visit)}</span>{` · ${visit.purpose_label}`}
                </span>
                {visit.outside_radius && <FlagChip>{flagText(visit)}</FlagChip>}
              </>
            );
            const rowStyle = { display: "flex", flexDirection: "column", gap: 3, padding: "9px 0", borderTop: `1px solid ${D.divider}`, textAlign: "left" };
            return visit.status === "open"
              ? <button key={visit.id} type="button" onClick={onCheckIn} style={{ ...rowStyle, background: "none", border: "none", borderTop: `1px solid ${D.divider}`, cursor: "pointer", fontFamily: "inherit", width: "100%" }}>{body}</button>
              : <div key={visit.id} style={rowStyle}>{body}</div>;
          })}
        </section>
      ))}

      {hidden > 0 && (
        <button type="button" onClick={() => setLimit((n) => n + PAGE)} style={{ ...button(D.panelBg, D.text), minHeight: 44 }}>{nextDay ? `Show ${hidden} more from ${nextDay}` : `Show ${hidden} more`}</button>
      )}
      <div style={{ ...dim, textAlign: "center", lineHeight: 1.45 }}>{FOOTER_RULE}</div>
    </div>
  );
}

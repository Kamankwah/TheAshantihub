import { useEffect, useState } from "react";
import { C } from "../theme.js";

// A flash-sale countdown: "Starts in" before the window, "Ends in" during it, nothing after.
// Used on the public site and in the Marketing editor's preview. Prices stay plain text
// (DESIGN.md: never gold), so only the digits' boxes are styled here.
export function countdownParts(target, now = Date.now()) {
  const left = Math.max(0, Math.floor((new Date(target).getTime() - now) / 1000));
  return { days: Math.floor(left / 86400), hours: Math.floor((left % 86400) / 3600), minutes: Math.floor((left % 3600) / 60), seconds: left % 60, left };
}

export function countdownWord(target, now = Date.now()) {
  const p = countdownParts(target, now);
  if (p.days) return `${p.days}d ${p.hours}h ${p.minutes}m`;
  if (p.hours) return `${p.hours}h ${p.minutes}m`;
  return `${p.minutes}m ${String(p.seconds).padStart(2, "0")}s`;
}

export default function PromoCountdown({ startsAt, endsAt, compact = false }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const started = new Date(startsAt).getTime() <= now;
  const target = started ? endsAt : startsAt;
  if (new Date(endsAt).getTime() <= now) return null;
  const p = countdownParts(target, now);
  const label = started ? "Ends in" : "Starts in";
  const cells = [[p.days, "days"], [p.hours, "hours"], [p.minutes, "min"], [p.seconds, "sec"]];
  if (compact) return <span role="timer" aria-label={`${label} ${countdownWord(target, now)}`} style={{ fontWeight: 800, fontSize: "0.7rem", color: C.ink }}>{label} {countdownWord(target, now)}</span>;
  return (
    <div role="timer" aria-label={`${label} ${p.days} days, ${p.hours} hours, ${p.minutes} minutes`} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <span style={{ fontSize: "0.72rem", fontWeight: 700, color: C.ink }}>{label}</span>
      {cells.map(([v, l]) => (
        <span key={l} style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", minWidth: 44, padding: "4px 6px", borderRadius: 8, border: `1px solid ${C.darkBrown}33`, background: C.surface }}>
          <strong style={{ fontSize: "1.05rem", color: C.ink, fontVariantNumeric: "tabular-nums" }}>{String(v).padStart(2, "0")}</strong>
          <span style={{ fontSize: "0.58rem", color: "#6b5a4d" }}>{l}</span>
        </span>
      ))}
    </div>
  );
}

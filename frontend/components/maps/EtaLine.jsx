import { D } from "../dashboard/theme.js";

// "About 7 min · 3.2 km · road route". The basis is always shown so an estimate never reads
// as a measured road time. A null leg draws nothing (no leg is not "0 min"). `ageS` is the
// age of the rider's last fix; when stale we say so rather than present it as live.
export default function EtaLine({ leg, stale = false, ageS = null }) {
  if (!leg) return null;
  const seconds = Number(leg.duration_s);
  if (leg.duration_s == null || !Number.isFinite(seconds)) return null;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  const km = Number(leg.distance_km);
  const parts = [`About ${minutes} min`];
  if (Number.isFinite(km)) parts.push(`${km} km`);
  if (leg.basis) parts.push(leg.basis);
  const staleNote = stale
    ? (ageS != null ? `Last location ${Math.max(1, Math.round(ageS / 60))} min ago` : "Last location is out of date")
    : null;
  return (
    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: D.text }}>
      {parts.join(" · ")}
      {staleNote && <span style={{ display: "block", fontWeight: 500, color: "#A33A00" }}>{staleNote}</span>}
    </p>
  );
}

import { useEffect, useState } from "react";
import { D } from "../../theme.js";
import { chip, dim } from "../panelStyles.js";
import { currentFix, metresBetween, useRiderLocation } from "../../../../lib/riderTracking.js";

// Shared pieces of the rider (Dispatch) screens: phone-first cards and big buttons, the location
// line, the five-step bar and the countdown. Nothing is shown for a thing the server cannot say.
export const card = { background: "#FFFFFF", border: `1px solid ${D.cardBorder}`, borderRadius: 16, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 };
export const h2 = { margin: 0, fontSize: "1rem", fontWeight: 800, color: D.text };
export const screen = { display: "flex", flexDirection: "column", gap: 12, maxWidth: 520, margin: "0 auto", width: "100%" };
export const bigButton = (disabled) => ({ minHeight: 56, border: "none", borderRadius: 14, background: D.gold, color: D.text, fontWeight: 800, fontSize: "1.05rem", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, fontFamily: "inherit", padding: "0 16px" });
export const quietButton = (disabled) => ({ minHeight: 48, border: `1px solid ${D.cardBorder}`, borderRadius: 14, background: "#FFFFFF", color: D.text, fontWeight: 700, fontSize: "0.92rem", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1, fontFamily: "inherit", padding: "0 14px" });
export const money = (v) => (v === null || v === undefined || v === "" ? "Not recorded" : `GH₵ ${Number(v).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");
export const longDay = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }) : "");
export const mmss = (seconds) => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, "0")}:${String(Math.max(0, seconds) % 60).padStart(2, "0")}`;
export const mono = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: "tabular-nums" };

export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => { const id = setInterval(() => set((n) => n + 1), ms); return () => clearInterval(id); }, [ms]);
}

export function Warn({ children }) {
  return <div role="note" style={{ background: "#FFF4E5", border: "1px solid #E8621A66", borderRadius: 10, padding: "10px 12px", fontSize: "0.82rem", lineHeight: 1.45, color: "#6B2E07" }}>{children}</div>;
}
export function Info({ children }) {
  return <div role="note" style={{ background: D.panelBg2, borderRadius: 10, padding: "10px 12px", fontSize: "0.8rem", lineHeight: 1.5, color: D.text }}>{children}</div>;
}
export function Err({ children }) {
  return children ? <div role="alert" style={{ color: D.red, fontWeight: 700, fontSize: "0.84rem" }}>{children}</div> : null;
}

// "Sharing location · updated 8 s ago" / what is wrong, from the tracker's own state.
export function LocationLine() {
  useTick(1000);
  const loc = useRiderLocation();
  if (loc.status === "sharing" && loc.fix) {
    const age = Math.max(0, Math.round((Date.now() - loc.fix.at) / 1000));
    return <div role="status" style={{ background: "#E3F1E3", borderRadius: 10, padding: "8px 12px", fontSize: "0.8rem", color: "#00400A" }}><b>Sharing location · updated {age} s ago</b>{loc.fix.accuracy_m ? ` (±${Math.round(loc.fix.accuracy_m)} m)` : ""}. Keep this screen open: phones pause location when you leave the app.</div>;
  }
  if (loc.status === "off") return null;
  return <Warn>{loc.error || "Waiting for your location. Allow location for this app."}</Warn>;
}

// Metres from the rider's last fix to a stop, or null when either is unknown.
export function useDistanceTo(lat, lng) {
  useTick(2000);
  const loc = useRiderLocation();
  const hasFix = Boolean(loc.fix);
  // No reading yet (tracking not started, or still waiting): ask the phone once so the distance can show.
  useEffect(() => { if (!hasFix) currentFix().catch(() => {}); }, [hasFix]);
  if (lat === null || lat === undefined || lng === null || lng === undefined || !loc.fix) return null;
  return metresBetween(loc.fix.lat, loc.fix.lng, Number(lat), Number(lng));
}
export const distanceText = (m) => (m === null ? null : m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);

const STEP_LABELS = ["Accepted", "Arrived", "Picked up", "Outside", "Delivered"];
export function StepBar({ steps }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <ol aria-label="Job steps" style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 6 }}>
      {STEP_LABELS.map((label, i) => (
        <li key={label} aria-current={i === done ? "step" : undefined} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ height: 6, borderRadius: 999, background: i < done ? D.green : i === done ? D.gold : "#EADFC6" }} />
          <span style={{ fontSize: "0.66rem", fontWeight: i === done ? 800 : 600, color: i < done ? "#00500A" : D.text }}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export function JobHeader({ job, title }) {
  return (
    <section aria-label="Job" style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <h1 style={{ ...h2, fontSize: "1.1rem" }}>Order #{job.order_id} · {title}</h1>
        <span style={chip(D.gold)}>{job.status_label}</span>
      </div>
      <StepBar steps={job.steps} />
      {job.flagged && <span style={dim}>A tap on this job was more than 150 m from its stop and is flagged for your manager.</span>}
    </section>
  );
}

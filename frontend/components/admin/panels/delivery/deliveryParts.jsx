import { D } from "../../theme.js";
import { chip, dim } from "../panelStyles.js";
import { errorStyle } from "../portfolioParts.jsx";

// Shared pieces of the Delivery Manager's screens. Nothing here invents a figure: a value the
// server answers null for is shown as the word the screen gives for it, never as 0.
export const WARN = "#A33A00";
export const money = (value) => (value === null || value === undefined || value === "" ? "Not set" : `GH₵ ${Number(value).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");
export const dayTime = (iso) => (iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
export const dayOnly = (iso) => (iso ? new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "");
export const mono = { fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: "tabular-nums" };

// "8 s", "4 min", "2 h 10 min".
export function span(seconds) {
  if (seconds === null || seconds === undefined) return "";
  const s = Math.max(0, Math.round(seconds));
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 120) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
}
export const spare = (minutes) => {
  if (minutes === null || minutes === undefined) return "No deadline set";
  if (minutes < 0) return `${span(-minutes * 60)} late`;
  return `${span(minutes * 60)} to spare`;
};
export const fixAge = (seconds, stale) => (seconds === null || seconds === undefined ? "No location yet" : `Location ${span(seconds)} old${stale ? " · stale" : ""}`);

export const STEP_COLORS = {
  assigned: D.textDim, accepted: D.gold, at_pickup: D.gold, picked_up: D.blue, at_customer: D.amber, delivered: D.green, confirmed: D.green, failed: D.red,
};
export function StepChip({ status, label }) {
  return <span style={chip(STEP_COLORS[status] || D.textDim)}>{label || status}</span>;
}

export function Note({ children, tone }) {
  return <div role="note" style={{ background: tone === "warn" ? "#FFF4E5" : D.panelBg2, border: `1px solid ${tone === "warn" ? "#E8621A66" : D.cardBorder}`, borderRadius: 10, padding: "8px 12px", fontSize: "0.78rem", color: D.text, lineHeight: 1.5 }}>{children}</div>;
}

export function Empty({ children }) {
  return <div style={{ ...dim, padding: "10px 0" }}>{children}</div>;
}

export function ErrorLine({ children }) {
  return children ? <div role="alert" style={errorStyle}>{children}</div> : null;
}

// A row of pressed-state filter buttons.
export function Filters({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {options.map(([id, text]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)} style={{ minHeight: 36, padding: "0 14px", borderRadius: 999, border: `1px solid ${D.cardBorder}`, background: value === id ? D.text : D.panelBg, color: value === id ? "#FDF6E3" : D.text, fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}>{text}</button>
      ))}
    </div>
  );
}

export const linkStyle = { background: "none", border: "none", padding: 0, color: D.deepGold, fontWeight: 800, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", fontSize: "inherit", textAlign: "left" };

export const SOURCE_LABEL = { manual: "Chosen by a manager", auto: "Auto-assigned", forced: "Forced", offer: "Offered and accepted" };

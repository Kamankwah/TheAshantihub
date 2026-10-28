import { D } from "../theme.js";
import { toDate } from "./portfolioParts.jsx";

// Small helpers shared by Operations' People screens (Scouts, Invite, Targets,
// Leave & calendar): local-date handling and table styles.

export const isoDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const addDays = (value, n) => { const d = toDate(value); d.setDate(d.getDate() + n); return d; };
export const dayShort = (value) => toDate(value)?.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) || "";
export const dayName = (value) => toDate(value)?.toLocaleDateString("en-GB", { weekday: "short" }) || "";
export const timeShort = (value) => toDate(value)?.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) || "";
export const longDay = (value) => toDate(value)?.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) || "";
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const figures = { fontVariantNumeric: "tabular-nums" };

export const table = { width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", color: D.text };
export const th = { textAlign: "left", fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.04em", textTransform: "uppercase", color: D.textDim, padding: "8px 10px", borderBottom: `1px solid ${D.divider}`, whiteSpace: "nowrap", verticalAlign: "bottom" };
export const td = { padding: "10px", borderBottom: `1px solid ${D.divider}`, verticalAlign: "top" };
export const scroll = { overflowX: "auto" };

export const toggleGroup = { display: "inline-flex", background: D.panelBg, border: `1px solid ${D.cardBorder}`, borderRadius: 12, padding: 3, gap: 3 };
export const toggleButton = (active) => ({ minHeight: 36, border: 0, borderRadius: 9, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "0.8rem", padding: "0 12px", background: active ? D.text : "transparent", color: active ? D.pageBg : D.text });

export function Bar({ pct, color = D.text, label }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, Math.round(pct)))}
      style={{ height: 6, borderRadius: 999, background: D.panelBg3, overflow: "hidden" }}>
      <div style={{ height: 6, width: `${Math.max(0, Math.min(100, pct))}%`, background: color, borderRadius: 999 }} />
    </div>
  );
}

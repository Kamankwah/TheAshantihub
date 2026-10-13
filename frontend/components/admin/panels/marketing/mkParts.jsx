import { D, glassCard } from "../../theme.js";
import { button, chip, dim } from "../panelStyles.js";
import { errorStyle, eyebrow, h2 } from "../portfolioParts.jsx";

// Shared bits of the Marketing screens (canvas 2026-10-13): one look for the page head,
// cards, figures, honest "not tracked / not connected" notes and tables.
export { button, chip, dim, errorStyle, eyebrow, h2 };
export { figures, plural, scroll, table, td, th, timeShort, dayShort, longDay, toggleButton, toggleGroup } from "../opsPeopleParts.jsx";

export const page = { display: "flex", flexDirection: "column", gap: 14 };
export const card = { ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 };
export const warnColor = "#A33A00";
export const linkStyle = { background: "none", border: 0, padding: 0, color: D.deepGold, fontWeight: 800, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" };
export const inputStyle = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: D.panelBg, minHeight: 36, boxSizing: "border-box" };
export const labelStyle = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text };

export const money = (value) => `GH₵ ${Number(value || 0).toLocaleString("en-GH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Heading of a screen: small date/crumb line, the title and the actions on the right.
export function PageHead({ crumb, title, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
      <div>
        {crumb && <div style={eyebrow}>{crumb}</div>}
        <h2 style={{ ...h2, fontSize: "1.4rem", margin: "2px 0 0" }}>{title}</h2>
      </div>
      {children && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{children}</div>}
    </div>
  );
}

export function Section({ id, title, action, children }) {
  return (
    <section aria-labelledby={id} style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <h3 id={id} style={{ ...h2, fontSize: "0.95rem" }}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

// A figure with a label and a line under it. `onClick` makes the whole tile a button.
export function Kpi({ label, value, sub, subColor, onClick }) {
  const body = (
    <>
      <span style={{ ...dim, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: "1.45rem", fontWeight: 800, color: D.text, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span style={{ ...dim, color: subColor || D.textDim, lineHeight: 1.4 }}>{sub}</span>
    </>
  );
  const inner = { display: "flex", flexDirection: "column", gap: 4, padding: 14, textAlign: "left", font: "inherit", color: "inherit", background: "none", border: 0, width: "100%", height: "100%", boxSizing: "border-box" };
  return (
    <div role="group" aria-label={label} style={{ ...glassCard, padding: 0 }}>
      {onClick ? <button type="button" onClick={onClick} style={{ ...inner, cursor: "pointer" }}>{body}</button> : <div style={inner}>{body}</div>}
    </div>
  );
}

// The honest empty state: says what is missing and why instead of a zero or a made-up figure.
export function Honest({ children, tone }) {
  return <div role="note" style={{ ...dim, lineHeight: 1.5, border: `1px dashed ${tone === "warn" ? warnColor : D.cardBorder}`, borderRadius: 10, padding: "10px 12px", background: D.panelBg2 }}>{children}</div>;
}

export function Loading({ error, onRetry, what = "this screen" }) {
  if (error) return <div role="alert" style={errorStyle}>Couldn't load {what}. <button type="button" onClick={onRetry} style={button(D.panelBg, D.text)}>Try again</button></div>;
  return <div role="status" style={dim}>Loading…</div>;
}

export const STATE_TONE = { connected: D.green, simulated: D.amber, not_connected: D.textFaint };
export const STATE_WORD = { connected: "Connected", simulated: "Simulated", not_connected: "Not connected" };

// Age since an ISO time as "4 h", "2 d".
export function ageWord(iso) {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 48) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} d`;
}

// ─── Moderation checklists (hero approval, promotions) ───────────────────────
// A server-computed check: {key, label, status: pass|warn|fail, detail}. The mark is
// a word-shaped glyph as well as a colour, so the state never rests on colour alone.
const CHECK_MARK = { pass: ["✓", "Passed", "#00500A", "#E3F1E3"], warn: ["~", "Check", "#6A4A00", "#FBF3DC"], fail: ["!", "Failed", "#A30000", "#FDE8E8"] };

export function CheckList({ checks, label = "Checks" }) {
  return (
    <ul aria-label={label} style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      {checks.map((c) => {
        const [mark, word, fg, bg] = CHECK_MARK[c.status] || CHECK_MARK.warn;
        return (
          <li key={c.key} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.8rem", color: D.text, lineHeight: 1.45 }}>
            <span aria-hidden="true" style={{ background: bg, color: fg, borderRadius: 999, minWidth: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: "0.7rem" }}>{mark}</span>
            <span><span className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{word}: </span><b>{c.label}</b>{c.detail ? <span style={{ color: D.textDim }}> {"—"} {c.detail}</span> : null}</span>
          </li>
        );
      })}
    </ul>
  );
}

// Queue switch (Waiting / Approved / Rejected ...): a pressed-state button group.
export function QueueSwitch({ label = "Queue", value, onChange, options }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map(([id, text]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}
          style={{ background: value === id ? D.text : "transparent", color: value === id ? D.panelBg : D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "6px 12px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{text}</button>
      ))}
    </div>
  );
}

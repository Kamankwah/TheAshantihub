import { useState } from "react";
import { apiDownload } from "../../../apiClient.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, callout, dim, field } from "./panelStyles.js";
import { figures } from "./opsPeopleParts.jsx";
import { errorStyle, h2 } from "./portfolioParts.jsx";

// Shared pieces of the Super Admin Insights and Money screens. Every figure on
// these screens is counted from records; a thing no record backs is named under
// "Not recorded" or "Not measured yet", never shown as a zero.
export const warn = "#A33A00";
export const section = { ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 };
export const sectionTitle = { margin: 0, color: D.text, fontSize: "0.95rem", fontWeight: 800 };
export const page = { display: "flex", flexDirection: "column", gap: 14 };
export const percent = (value) => (value === null || value === undefined ? "Not enough data" : `${Number(value).toFixed(1)}%`);

export function Kpi({ label, value, sub, subColor }) {
  return (
    <div role="group" aria-label={label} style={{ ...glassCard, padding: 12, display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ ...dim, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: "1.35rem", fontWeight: 800, color: D.text, ...figures }}>{value}</span>
      {sub && <span style={{ ...dim, color: subColor || D.textDim }}>{sub}</span>}
    </div>
  );
}

export const kpiGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 };

export function Title({ children, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <h2 style={{ ...h2, fontSize: "1.4rem" }}>{children}</h2>
      {right && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{right}</div>}
    </div>
  );
}

// The honest payments banner: shown while payments are simulated.
export function SimulatedBanner({ simulated, children }) {
  if (!simulated) return null;
  return <div role="note" style={callout(D.amber)}>Payments are simulated until Hubtel is connected. {children}</div>;
}

// "Not recorded" / "Not measured yet": what no table can produce, with the reason.
export function NotRecorded({ title, items }) {
  if (!items?.length) return null;
  return (
    <section aria-label={title} style={section}>
      <h3 style={sectionTitle}>{title}</h3>
      <span style={dim}>These are left blank on purpose rather than guessed.</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {items.map((item) => (
          <div key={item.name} style={{ border: `1px dashed ${D.cardBorder}`, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 3 }}>
            <span style={{ fontWeight: 800, fontSize: "0.82rem", color: D.text }}>{item.name}</span>
            <span style={dim}>{item.why}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Status({ isLoading, isError, empty, children }) {
  if (isLoading) return <div role="status" style={dim}>Loading…</div>;
  if (isError) return <div role="alert" style={errorStyle}>Could not load this screen.</div>;
  return empty || children;
}

// Excel / CSV / PDF for a JSON endpoint: the same address with ?format=. A file
// with personal data asks for the password first (the shell's prompt retries).
export function ExportBar({ path, stem, onError, label = "Export" }) {
  const [pending, setPending] = useState(null);
  const download = async (format) => {
    if (pending) return;
    setPending(format);
    onError?.("");
    try {
      await apiDownload(`${path}${path.includes("?") ? "&" : "?"}format=${format}`, `${stem}.${format}`);
    } catch (err) {
      onError?.(apiErrorMessage(err, "Could not export this."));
    } finally {
      setPending(null);
    }
  };
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {[["xlsx", "Excel"], ["csv", "CSV"], ["pdf", "PDF"]].map(([format, text]) => (
        <button key={format} type="button" disabled={Boolean(pending)} onClick={() => download(format)} style={button(D.panelBg, D.text, Boolean(pending))}>{text}</button>
      ))}
    </div>
  );
}

export function Select({ label, value, onChange, options, allLabel }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>
      {label}
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} style={field}>
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}

export const isoDay = (date) => {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};

// A bar made of a div whose width is a share of the largest value.
export function ShareBar({ share, label, color = D.gold }) {
  const pct = Math.max(0, Math.min(100, Math.round(share * 100)));
  return (
    <div role="img" aria-label={label} style={{ height: 8, borderRadius: 999, background: "#EADFC6", overflow: "hidden", minWidth: 80 }}>
      <div style={{ height: 8, width: `${pct}%`, background: color }} />
    </div>
  );
}

import { useState } from "react";
import { apiDownload } from "../../../apiClient.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { queryString } from "../../../hooks/useMarketplace.js";
import { D } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { card, errorStyle, formatDateTime, h2, labelStyle } from "./portfolioParts.jsx";

// Pieces shared by the Super Admin marketplace screens (Businesses, Customers,
// Listings & services, Orders & deliveries, Events & tickets, Disputes).
// Figures are always the server's; a figure with no record behind it is said
// to be missing, never shown as 0.

export const th = { padding: "6px 8px", textAlign: "left", color: D.textDim, fontWeight: 700, whiteSpace: "nowrap" };
export const td = { padding: "8px", verticalAlign: "top", borderTop: `1px solid ${D.divider}` };
export const tableStyle = { borderCollapse: "collapse", width: "100%", fontSize: "0.78rem", color: D.text, fontVariantNumeric: "tabular-nums" };
export const figures = { fontVariantNumeric: "tabular-nums" };
export const col = { display: "flex", flexDirection: "column", gap: 14 };

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const dateOnly = (value) => (value ? new Date(value).toLocaleDateString("en-GH", { day: "numeric", month: "short" }) : "—");
export const dateTime = formatDateTime;

// The title row of a screen: heading, one honest line and the page's actions.
export function ScreenHeader({ title, note, children }) {
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <h2 style={h2}>{title}</h2>
          {note && <div style={dim}>{note}</div>}
        </div>
        {children && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div>}
      </div>
    </div>
  );
}

// The KPI strip. tiles: [{label, value, sub, tone}]; a tile with value == null
// reads "Not available" so a missing figure is never a zero.
export function KpiStrip({ tiles, label = "Summary" }) {
  return (
    <div role="group" aria-label={label} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(150px, 100%), 1fr))", gap: 10 }}>
      {tiles.map((tile) => (
        <div key={tile.label} style={{ ...card, padding: 12, gap: 4 }}>
          <div style={{ color: D.textDim, fontSize: "0.68rem", fontWeight: 800 }}>{tile.label}</div>
          <div style={{ color: D.text, fontSize: tile.value == null ? "0.85rem" : "1.25rem", fontWeight: 900, ...figures }}>{tile.value == null ? "Not available" : tile.value}</div>
          {tile.sub && <div style={{ ...dim, color: tile.tone || D.textDim }}>{tile.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// One <select> per filter: filters [{key, label, options: [[value, text]]}].
export function FilterBar({ filters, values, onChange, search, onSearch, searchLabel }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: 10, alignItems: "end" }}>
      {onSearch && (
        <label style={labelStyle}>{searchLabel}
          <input type="search" value={search} onChange={(e) => onSearch(e.target.value)} style={field} />
        </label>
      )}
      {filters.map((f) => (
        <label key={f.key} style={labelStyle}>{f.label}
          <select value={values[f.key] ?? ""} onChange={(e) => onChange(f.key, e.target.value)} style={field}>
            {f.options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
      ))}
    </div>
  );
}

export function Pager({ data, page, setPage }) {
  if (!data?.next && !data?.previous) return null;
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
      <button type="button" disabled={!data.previous} onClick={() => setPage(page - 1)} style={button(D.panelBg, D.text, !data.previous)}>← Previous</button>
      <span style={dim}>{`Page ${page}`}</span>
      <button type="button" disabled={!data.next} onClick={() => setPage(page + 1)} style={button(D.panelBg, D.text, !data.next)}>Next →</button>
    </div>
  );
}

// "Showing 25 of 347" under a table.
export const showing = (data, rows) => `Showing ${rows.length} of ${data?.count ?? rows.length}`;

// Payments are simulated until Hubtel is connected: every money screen says so.
export function SimulatedBanner({ children }) {
  return <div role="note" style={callout(D.amber)}>{`Payments are simulated until Hubtel is connected.${children ? ` ${children}` : ""}`}</div>;
}

export function LoadState({ query, what }) {
  if (query.isLoading) return <div style={dim}>Loading…</div>;
  if (query.isError) return <div role="alert" style={errorStyle}>{`Could not load ${what}.`}</div>;
  return null;
}

// A download button: fetches with the staff header and saves the file. A
// refusal (a 403 that is not the password prompt) shows its reason.
export function ExportButton({ path, params, filename, label, onError }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    onError?.(null);
    try {
      const q = queryString(params);
      await apiDownload(`${path}${q ? `?${q}` : ""}`, filename);
    } catch (err) {
      onError?.(apiErrorMessage(err, "Could not export."));
    } finally {
      setBusy(false);
    }
  };
  return <button type="button" onClick={run} disabled={busy} style={button(D.panelBg, D.text, busy)}>{busy ? "Preparing…" : label}</button>;
}

export const Chip = ({ color, children }) => <span style={chip(color)}>{children}</span>;

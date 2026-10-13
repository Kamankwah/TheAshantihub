import { useState } from "react";
import { apiDownload } from "../../../apiClient.js";
import { useExportsLog } from "../../../hooks/useStaffSecurity.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { errorStyle, h2, labelStyle } from "./portfolioParts.jsx";
import { Kpi, kpiGrid, page, section, sectionTitle } from "./insightsParts.jsx";

// ─── Super Admin 13 Data exports log ─────────────────────────────────────────
// Every export in the activity record (verb report.exported), by hand or on a
// schedule, with who, filters, format, rows, whether it held personal data and the
// state of its link. Read-only: the lines are activity entries nobody can edit or
// remove. Older lines that never recorded the personal-data flag say "Not recorded".
const PERSONAL = [["", "Yes or no"], ["yes", "Only yes"], ["no", "Only no"], ["unknown", "Not recorded"]];
const at = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};
const filterField = { ...field, minHeight: 38 };
const filterText = (filters) => Object.entries(filters || {}).filter(([, v]) => v !== "" && v != null).map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ");

export default function DataExportsLogPanel() {
  const [person, setPerson] = useState("");
  const [personal, setPersonal] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [pageNo, setPageNo] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const { data, isLoading, isError, refetch } = useExportsLog({ actor: person, personal, since, until, page: pageNo > 1 ? pageNo : "" });
  const choose = (setter) => (e) => { setter(e.target.value); setPageNo(1); };
  const rows = data?.results || [];
  const summary = data?.summary;

  // The list itself, as a file: the audit log's own export of these entries (the password is asked for).
  const exportList = async () => {
    setExportError(null); setExporting(true);
    const q = new URLSearchParams(Object.entries({ verb: "report.exported", actor: person, since, until, format: "csv" }).filter(([, v]) => v)).toString();
    try { await apiDownload(`/api/activity/export/?${q}`, "ashantihub-data-exports-log.csv"); }
    catch (err) { setExportError(apiErrorMessage(err, "Could not export the list.")); }
    finally { setExporting(false); }
  };

  return (
    <div style={page}>
      <h2 style={{ ...h2, fontSize: "1.4rem" }}>Data exports log</h2>
      <div role="note" style={callout(D.amber)}>
        Every export is listed here with its filters, by hand or on a schedule, and nobody can remove a line. <strong>Personal data</strong> means names together with phone numbers, emails, addresses, ID numbers or pay; exporting it asks for the person’s password first. Download links work for 24 hours.
      </div>
      {summary && (
        <div style={kpiGrid}>
          <Kpi label="Exports, last 30 days" value={summary.last_30_days} />
          <Kpi label="With personal data" value={summary.personal_30_days} />
          <Kpi label="On a schedule" value={summary.scheduled_30_days} />
          <Kpi label="Flag not recorded" value={summary.not_recorded_30_days} sub="older lines" />
        </div>
      )}
      <section aria-label="Exports" style={section}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <h3 style={sectionTitle}>Exports</h3>
          <button type="button" disabled={exporting} onClick={exportList} style={button(D.panelBg, D.text, exporting)}>{exporting ? "Preparing…" : "Export this list"}</button>
        </div>
        {exportError && <div role="alert" style={errorStyle}>{exportError}</div>}
        <div role="group" aria-label="Filters" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
          <label style={labelStyle}>Person
            <select value={person} onChange={choose(setPerson)} style={filterField}>
              <option value="">Anyone</option>
              {(data?.people || []).map((p) => <option key={p.actor_id} value={p.actor_id}>{p.actor_label}</option>)}
            </select>
          </label>
          <label style={labelStyle}>Personal data
            <select value={personal} onChange={choose(setPersonal)} style={filterField}>{PERSONAL.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label style={labelStyle}>From<input type="date" value={since} max={until || undefined} onChange={choose(setSince)} style={filterField} /></label>
          <label style={labelStyle}>To<input type="date" value={until} min={since || undefined} onChange={choose(setUntil)} style={filterField} /></label>
        </div>
        {isLoading && <div role="status" style={dim}>Loading…</div>}
        {isError && <div role="alert" style={errorStyle}>Could not load the exports. <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button></div>}
        {data && rows.length === 0 && <div style={dim}>Nothing matches those filters.</div>}
        {rows.length > 0 && (
          <div style={scroll}>
            <table style={table}>
              <thead><tr>{["When", "Who", "What · filters", "Format", "Rows", "Personal data", "Link"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ ...td, whiteSpace: "nowrap", ...figures }}>{at(r.at)}</td>
                    <td style={td}><span style={{ fontWeight: 700 }}>{r.who}</span>{r.role ? <div style={dim}>{r.role.replace("_", " ")}</div> : null}{r.scheduled ? <div style={dim}>Scheduled</div> : null}</td>
                    <td style={td}>{r.what}{filterText(r.filters) ? <div style={dim}>{filterText(r.filters)}</div> : null}</td>
                    <td style={td}>{r.format ? r.format.toUpperCase() : "Not recorded"}</td>
                    <td style={{ ...td, ...figures }}>{r.rows ?? "Not recorded"}</td>
                    <td style={td}>{r.personal_data === true ? <span style={chip(D.amber)}>Yes</span> : r.personal_data === false ? "No" : <span style={dim}>Not recorded</span>}</td>
                    <td style={td}>{r.link}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button type="button" disabled={pageNo <= 1} onClick={() => setPageNo((n) => n - 1)} style={button(D.panelBg, D.text, pageNo <= 1)}>Newer</button>
          <button type="button" disabled={!data?.has_next} onClick={() => setPageNo((n) => n + 1)} style={button(D.panelBg, D.text, !data?.has_next)}>Older</button>
          {data && <span style={{ ...dim, ...figures }}>{data.count} exports</span>}
        </div>
        <div style={dim}>Whether a link was opened is not tracked, so it is not shown. Spreadsheet cells that could run as formulas are made safe automatically.</div>
      </section>
    </div>
  );
}

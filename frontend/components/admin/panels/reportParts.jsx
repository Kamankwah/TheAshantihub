import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiDownload } from "../../../apiClient.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, chip, dim } from "./panelStyles.js";

export const PERIODS = [["day", "Day"], ["week", "Week"], ["month", "Month"]];
// Draft takes D.textDim (an rgba token), which chip() renders as the neutral look.
export const STATUS_META = {
  draft: { label: "Draft", color: D.textDim },
  submitted: { label: "Submitted", color: D.blue },
  acknowledged: { label: "Acknowledged", color: D.green },
  returned: { label: "Returned", color: D.amber },
};
const RESULT_TEXT = { done: "Done", partly: "Partly done", not_done: "Not done", "": "Not marked" };
const humanise = (label) => String(label).replace(/[._-]+/g, " ").trim();

// Everything a report action can change: lists, the open report, the team
// view and the header counts/bell.
export const REPORT_CACHE_KEYS = ["my-reports", "report", "team-reports", "staff-badges", "notifications"];
export const refreshReportCaches = (queryClient) => REPORT_CACHE_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));

// 410 is an expired export link; everything else uses the server's message.
export function downloadErrorMessage(err, fallback) {
  if (err?.status === 410) return "That file has expired. Export it again.";
  return apiErrorMessage(err, fallback);
}

// The browser's local date as YYYY-MM-DD (not UTC's).
export function localISODate(date = new Date()) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

export function StatusChip({ status }) {
  const meta = STATUS_META[status] || { label: status, color: D.textDim };
  return <span style={chip(meta.color)}>{meta.label}</span>;
}

// "From the system": numbers counted from AshantiHub's records, never typed.
export function SystemSections({ sections, live }) {
  return (
    <section aria-label="From the system" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>From the system</div>
      <div style={dim}>{live ? "Counted live from AshantiHub's records and updated until you submit. You can't edit these." : "Frozen when the report was submitted."}</div>
      {(sections || []).length === 0 && <div style={dim}>Nothing recorded for this period.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(200px,100%),1fr))", gap: 10, fontVariantNumeric: "tabular-nums" }}>
        {(sections || []).map((section) => (
          <div key={section.key} style={{ background: D.panelBg2, borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ color: D.text, fontWeight: 700, fontSize: "0.78rem", marginBottom: 4 }}>{section.title}</div>
            {section.rows.map((row) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 8, color: D.text, fontSize: "0.75rem" }}>
                <span>{humanise(row.label)}</span><span style={{ fontWeight: 700 }}>{row.value}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

const heading = { color: D.textDim, fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" };

export function ReportNarrative({ report }) {
  const block = (title, text) => (
    <div>
      <div style={heading}>{title}</div>
      <div style={{ color: D.text, fontSize: "0.82rem", whiteSpace: "pre-wrap" }}>{text || "—"}</div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {report.plan_results.length > 0 && (
        <div>
          <div style={heading}>Previous plan</div>
          {report.plan_results.map((row) => <div key={row.item} style={{ color: D.text, fontSize: "0.8rem" }}>{row.item}: {RESULT_TEXT[row.result] || row.result}</div>)}
        </div>
      )}
      {block("What went well", report.achievements)}
      {block("What got in the way", report.blockers)}
      {block("Plan", report.plan_next.join("\n"))}
    </div>
  );
}

const small = { ...button(D.panelBg, D.text), borderRadius: 20, padding: "5px 12px", fontSize: "0.72rem", fontWeight: 700 };

export function ExportButtons({ path, stem, onError }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(null);
  const [notice, setNotice] = useState(null);
  const download = async (format) => {
    if (pending) return;
    setPending(format);
    setNotice(null);
    try {
      const result = await apiDownload(`${path}${path.includes("?") ? "&" : "?"}format=${format}`, `${stem}.${format}`);
      if (result?.status === "queued") {
        setNotice("We're preparing that file. It appears in your exports list when it's ready.");
        queryClient.invalidateQueries({ queryKey: ["report-exports"] });
      }
    } catch (err) {
      onError?.(downloadErrorMessage(err, "Could not export the report."));
    } finally {
      setPending(null);
    }
  };
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <div role="group" aria-label="Export" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[["xlsx", "Excel"], ["csv", "CSV"], ["pdf", "PDF"]].map(([format, label]) => (
          <button key={format} type="button" disabled={Boolean(pending)} onClick={() => download(format)} style={{ ...small, opacity: pending ? 0.5 : 1, cursor: pending ? "not-allowed" : "pointer" }}>{label}</button>
        ))}
      </div>
      {notice && <span role="status" style={{ ...dim, color: D.green }}>{notice}</span>}
    </div>
  );
}

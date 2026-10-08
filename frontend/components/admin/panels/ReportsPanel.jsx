import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiDownload, apiPost } from "../../../apiClient.js";
import { useCurrentReport, useMyReports, useReportExports } from "../../../hooks/useReports.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field, pill } from "./panelStyles.js";
import { ExportButtons, PERIODS, StatusChip, SystemSections, downloadErrorMessage, localISODate, refreshReportCaches } from "./reportParts.jsx";

const labelStyle = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text };
const PERIOD_TITLE = { day: "End of day report", week: "Week report", month: "Month report" };
const range = (r) => (r.period_start === r.period_end ? r.period_start : `${r.period_start} to ${r.period_end}`);
const lateChip = chip(D.amber);

export default function ReportsPanel({ auth }) {
  const [period, setPeriod] = useState("day");
  const today = localISODate();
  const { data: report, isLoading, isError } = useCurrentReport(period, today);
  const { data: history } = useMyReports(period);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>My reports</div>
          <div role="group" aria-label="Report period" style={{ display: "flex", gap: 6 }}>
            {PERIODS.map(([id, label]) => <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)} style={pill(period === id)}>{label}</button>)}
          </div>
        </div>
        {isLoading && <div role="status" style={dim}>Loading…</div>}
        {isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your report.</div>}
        {report && <ReportComposer key={`${period}:${report.period_start}`} report={report} period={period} />}
      </div>
      <History rows={history?.results || []} />
      <RangeExport auth={auth} />
    </div>
  );
}

function ReportComposer({ report, period }) {
  const queryClient = useQueryClient();
  const [achievements, setAchievements] = useState(report.achievements);
  const [blockers, setBlockers] = useState(report.blockers);
  const [plan, setPlan] = useState(report.plan_next.length ? report.plan_next : [""]);
  const [results, setResults] = useState(report.plan_results);
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const locked = !report.can_edit;
  const due = new Date(report.due_at).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" });

  const body = () => ({
    period, date: report.period_start, achievements, blockers,
    plan_next: plan.map((line) => line.trim()).filter(Boolean), plan_results: results,
  });
  // Saves the draft; returns the saved report or null. Never toggles `busy`
  // itself so submit can hold it across both calls.
  const saveDraft = async () => {
    try {
      return await apiPost("/api/reports/", body());
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not save the report."));
      return null;
    }
  };
  const save = async () => {
    if (busy) return;
    setActionError(null); setMessage(null); setBusy(true);
    try {
      if (await saveDraft()) setMessage("Draft saved.");
    } finally {
      setBusy(false);
      refreshReportCaches(queryClient);
    }
  };
  const submit = async () => {
    if (busy) return;
    setActionError(null); setMessage(null); setBusy(true);
    try {
      const saved = await saveDraft();
      if (!saved) return;
      try {
        await apiPost(`/api/reports/${saved.id}/submit/`, {});
        setMessage("Submitted.");
      } catch (err) {
        setActionError(apiErrorMessage(err, "Could not submit the report."));
      }
    } finally {
      setBusy(false);
      refreshReportCaches(queryClient);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: D.text, fontWeight: 800 }}>{PERIOD_TITLE[report.period]} · {range(report)}</span>
        <StatusChip status={report.status} />
        {report.is_late && <span style={lateChip}>Late</span>}
        {!locked && <span style={dim}>Due by {due}</span>}
      </div>
      {report.status === "returned" && report.review_note && (
        <div style={{ background: D.panelBg2, borderRadius: 10, padding: "8px 12px", fontSize: "0.8rem", color: D.text }}>
          Returned by {report.reviewer?.full_name || "your manager"}: “{report.review_note}”
        </div>
      )}
      <SystemSections sections={report.system} live={report.system_is_live} />
      {results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>Your last plan — how did it go?</div>
          {results.map((row, index) => (
            <label key={row.item} style={{ ...labelStyle, flexDirection: "row", alignItems: "center", justifyContent: "space-between", fontWeight: 600 }}>
              <span>{row.item}</span>
              <select aria-label={`Result for "${row.item}"`} disabled={locked} value={row.result}
                onChange={(e) => setResults(results.map((r, i) => (i === index ? { ...r, result: e.target.value } : r)))} style={field}>
                <option value="">Not marked</option><option value="done">Done</option><option value="partly">Partly done</option><option value="not_done">Not done</option>
              </select>
            </label>
          ))}
        </div>
      )}
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>In your words</div>
      <label style={labelStyle}>What went well<textarea value={achievements} readOnly={locked} onChange={(e) => setAchievements(e.target.value)} rows={4} style={field} /></label>
      <label style={labelStyle}>What got in the way<textarea value={blockers} readOnly={locked} onChange={(e) => setBlockers(e.target.value)} rows={3} style={field} /></label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={labelStyle}>Plan for next {report.period}</div>
        {plan.map((line, index) => (
          <input key={index} aria-label={`Plan line ${index + 1}`} value={line} readOnly={locked}
            onChange={(e) => setPlan(plan.map((l, i) => (i === index ? e.target.value : l)))} style={field} maxLength={300} />
        ))}
        {!locked && plan.length < 20 && <button type="button" onClick={() => setPlan([...plan, ""])} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Add a line</button>}
      </div>
      {report.similar_warning && (
        <div role="alert" style={callout(D.amber)}>
          This reads a lot like one of your last five reports. Write what actually happened this time — your manager sees the same flag.
        </div>
      )}
      {message && <div role="status" style={{ color: D.green, fontSize: "0.8rem" }}>{message}</div>}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {!locked && <button type="button" disabled={busy} onClick={save} style={button(D.panelBg, D.text, busy)}>Save draft</button>}
        {!locked && <button type="button" disabled={busy} onClick={submit} style={button(D.gold, D.text, busy)}>Submit</button>}
        {report.id && <ExportButtons path={`/api/reports/${report.id}/export/`} stem={`report-${report.period}-${report.period_start}`} onError={setActionError} />}
      </div>
    </div>
  );
}

function History({ rows }) {
  const [actionError, setActionError] = useState(null);
  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem", marginBottom: 8 }}>History</div>
      {rows.length === 0 && <div style={dim}>No reports yet for this period.</div>}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      {rows.map((r) => (
        <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${D.divider}`, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{range(r)}</span>
            <StatusChip status={r.status} />
            {r.is_late && <span style={lateChip}>Late</span>}
            {r.review_note && <span style={dim}>“{r.review_note}”</span>}
          </div>
          <ExportButtons path={`/api/reports/${r.id}/export/`} stem={`report-${r.period}-${r.period_start}`} onError={setActionError} />
        </div>
      ))}
    </div>
  );
}

function RangeExport({ auth }) {
  const today = localISODate();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [format, setFormat] = useState("xlsx");
  const [includeTeam, setIncludeTeam] = useState(false);
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data: exportsList, refetch } = useReportExports();
  const canIncludeTeam = auth?.hasPermission?.("staff.invite_team") || auth?.hasPermission?.("reports.view_all");

  const run = async () => {
    if (busy) return;
    setMessage(null); setActionError(null);
    if (!from || !to) { setActionError("Choose a start and an end date."); return; }
    if (from > to) { setActionError("Choose a start date on or before the end date."); return; }
    setBusy(true);
    const staff = includeTeam ? "" : `&staff=${auth?.user?.id}`;
    try {
      const queued = await apiDownload(`/api/reports/export/?from=${from}&to=${to}&format=${format}${staff}`, `ashantihub-reports-${from}-${to}.${format}`);
      if (queued?.status === "queued") {
        setMessage("We're preparing that file. It appears below when it's ready.");
        refetch();
      }
    } catch (err) {
      setActionError(downloadErrorMessage(err, "Could not export those reports."));
    } finally {
      setBusy(false);
    }
  };
  const [downloading, setDownloading] = useState(null);
  const download = async (item) => {
    if (downloading) return;
    setDownloading(item.id);
    setActionError(null);
    try {
      await apiDownload(item.download_url, item.file_name);
    } catch (err) {
      setActionError(downloadErrorMessage(err, "Could not download that file."));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Export</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={labelStyle}>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={field} /></label>
        <label style={labelStyle}>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={field} /></label>
        <label style={labelStyle}>Format<select value={format} onChange={(e) => setFormat(e.target.value)} style={field}><option value="xlsx">Excel</option><option value="csv">CSV</option><option value="pdf">PDF</option></select></label>
        {canIncludeTeam && <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center" }}><input type="checkbox" checked={includeTeam} onChange={(e) => setIncludeTeam(e.target.checked)} />Include my team's reports</label>}
        <button type="button" disabled={busy} onClick={run} style={button(D.gold, D.text, busy)}>Export reports</button>
      </div>
      <div style={dim}>Large ranges are prepared in the background and appear below when ready. Every export is recorded.</div>
      {message && <div role="status" style={{ color: D.green, fontSize: "0.8rem" }}>{message}</div>}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      {(exportsList || []).map((item) => (
        <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.78rem", color: D.text, flexWrap: "wrap" }}>
          <span>{item.file_name} · {item.status === "ready" ? `${item.row_count} reports` : item.status === "failed" ? `Failed: ${item.error}` : item.status}</span>
          {item.download_url && <button type="button" disabled={downloading !== null} onClick={() => download(item)} style={button(D.panelBg, D.text, downloading !== null)}>Download</button>}
        </div>
      ))}
    </div>
  );
}

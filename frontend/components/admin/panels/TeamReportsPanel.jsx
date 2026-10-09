import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useReport, useTeamReports } from "../../../hooks/useReports.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, chip, dim, field, pill } from "./panelStyles.js";
import { ExportButtons, PERIODS, ReportNarrative, StatusChip, SystemSections, localISODate, refreshReportCaches } from "./reportParts.jsx";

const flag = { ...chip(D.amber), alignSelf: "flex-start" };

export default function TeamReportsPanel({ auth }) {
  const [period, setPeriod] = useState("day");
  const [date, setDate] = useState(localISODate());
  const [scope, setScope] = useState("team");
  const [openId, setOpenId] = useState(null);
  const { data, isLoading, isError } = useTeamReports(period, date, scope);
  const canSeeEveryone = auth?.hasPermission?.("reports.view_all");
  const rows = data?.rows || [];
  const waiting = rows.filter((row) => row.report?.status === "submitted").length;

  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>{scope === "all" ? "Everyone's reports" : "My team's reports"}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {PERIODS.map(([id, label]) => <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)} style={pill(period === id)}>{label}</button>)}
          <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} style={field} />
          {canSeeEveryone && (
            <>
              <button type="button" aria-pressed={scope === "team"} onClick={() => setScope("team")} style={pill(scope === "team")}>My team</button>
              <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")} style={pill(scope === "all")}>Everyone</button>
            </>
          )}
        </div>
      </div>
      {waiting > 0 && <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>Waiting for you · {waiting}</div>}
      {isLoading && <div role="status" style={dim}>Loading…</div>}
      {isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the team's reports.</div>}
      {!isLoading && !isError && rows.length === 0 && <div style={dim}>Nobody to show for this period.</div>}
      {rows.map(({ staff, report }) => (
        <div key={staff.id} style={{ borderTop: `1px solid ${D.divider}`, padding: "10px 0", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>{staff.full_name}</span>
              <span style={dim}>{staff.role.replace("_", " ")}</span>
              {report ? <StatusChip status={report.status} /> : <span style={dim}>Not submitted yet</span>}
              {report?.submitted_at && <span style={dim}>{new Date(report.submitted_at).toLocaleString("en-GH")}</span>}
              {report?.is_late && <span style={flag}>Late</span>}
              {report?.similar_warning && <span style={flag}>Copy check {Math.round(report.similarity * 100)}%</span>}
            </div>
            {report && (
              <button type="button" aria-label={openId === report.id ? `Close ${staff.full_name}'s report` : `Open ${staff.full_name}'s report`}
                onClick={() => setOpenId(openId === report.id ? null : report.id)} style={button(D.panelBg, D.text)}>
                {openId === report.id ? "Close" : "Open"}
              </button>
            )}
          </div>
          {report && openId === report.id && <ReportReview id={report.id} />}
        </div>
      ))}
    </div>
  );
}

function ReportReview({ id }) {
  const queryClient = useQueryClient();
  const { data: report, isLoading, isError } = useReport(id);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  if (isLoading) return <div role="status" style={dim}>Loading…</div>;
  if (isError || !report) return <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not open this report.</div>;

  const review = async (action) => {
    if (busy) return;
    setActionError(null);
    setBusy(true);
    try {
      await apiPost(`/api/reports/${id}/${action}/`, { note });
      setNote("");
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not save your review."));
    } finally {
      setBusy(false);
      // Refresh even after a refusal: the report may have changed under us.
      refreshReportCaches(queryClient);
    }
  };

  return (
    <div style={{ background: D.pageBg, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <SystemSections sections={report.system} live={report.system_is_live} lockedAt={report.submitted_at} />
      <ReportNarrative report={report} />
      {report.similar_warning && <div style={flag}>Copy check: the narrative reads {Math.round(report.similarity * 100)}% like one of their earlier reports.</div>}
      {report.is_late && <div style={flag}>Submitted after the deadline.</div>}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      <ExportButtons path={`/api/reports/${id}/export/`} stem={`report-${report.staff.full_name}-${report.period_start}`} onError={setActionError} />
      {report.can_review && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text }}>
            Comment to {report.staff.full_name} (required to return)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={field} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={busy} onClick={() => review("acknowledge")} style={button(D.green, D.panelBg, busy)}>Acknowledge</button>
            <button type="button" disabled={busy || !note.trim()} onClick={() => review("return")} style={button(D.panelBg, D.red, busy || !note.trim())}>Return with comment</button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useReport, useTeamMissing, useTeamReports } from "../../../hooks/useReports.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { formatDuration } from "../../../lib/timeAgo.js";
import { D, glassCard } from "../theme.js";
import { button, chip, dim, field, pill } from "./panelStyles.js";
import { dayShort, figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { ExportButtons, PERIODS, ReportNarrative, StatusChip, SystemSections, localISODate, refreshReportCaches } from "./reportParts.jsx";

const flag = { ...chip(D.amber), alignSelf: "flex-start" };
const linkStyle = { background: "none", border: 0, padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 800, color: D.deepGold, textDecoration: "underline" };
const roleName = (role) => (role || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const clock = (iso) => new Date(iso).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
const reportName = (report) => (report.period === "day" ? `Day · ${dayShort(report.period_start)}` : report.period === "week" ? `Week · ${dayShort(report.period_start)} – ${dayShort(report.period_end)}` : `Month · ${dayShort(report.period_start)}`);

function Kpi({ label, value, sub, color }) {
  return (
    <div role="group" aria-label={label} style={{ ...glassCard, padding: 12, display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ ...dim, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: "1.4rem", fontWeight: 800, color: D.text, ...figures }}>{value}</span>
      <span style={{ ...dim, color: color || D.textDim }}>{sub}</span>
    </div>
  );
}

function Flags({ report }) {
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {report?.is_late && <span style={flag}>Late</span>}
      {report?.similar_warning && <span style={flag}>Copy check {Math.round(report.similarity * 100)}%</span>}
    </span>
  );
}

// "Not in": the working days a direct report never sent a day report for. Leave,
// holidays and days off are not counted (server side); Remind sends one in-app
// notification and is recorded in the activity log.
function NotIn() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useTeamMissing();
  const [sent, setSent] = useState({});
  const [actionError, setActionError] = useState(null);
  const rows = data?.rows || [];
  const remind = async (row) => {
    const key = `${row.staff.id}:${row.date}`;
    setActionError(null);
    try {
      await apiPost("/api/reports/team/remind/", { staff: row.staff.id, date: row.date });
      setSent((current) => ({ ...current, [key]: true }));
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not send the reminder."));
    } finally {
      queryClient.invalidateQueries({ queryKey: ["team-reports", "missing"] });
    }
  };
  return (
    <section aria-labelledby="not-in" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <h3 id="not-in" style={{ margin: 0, color: D.text, fontSize: "0.95rem", fontWeight: 800 }}>
          {data ? `Not in · ${dayShort(data.from)} – ${dayShort(data.to)}` : "Not in"}
        </h3>
        <span style={dim}>Leave and days off aren't counted</span>
      </div>
      {isLoading && <div role="status" style={dim}>Loading…</div>}
      {isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the days without a report.</div>}
      {!isLoading && !isError && rows.length === 0 && <div style={dim}>Everyone sent a report for each working day.</div>}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      {rows.map((row) => {
        const done = sent[`${row.staff.id}:${row.date}`] || row.reminded_today;
        return (
          <div key={`${row.staff.id}:${row.date}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", borderTop: `1px solid ${D.divider}`, paddingTop: 6, fontSize: "0.82rem", color: D.text }}>
            <span><span style={{ fontWeight: 700 }}>{row.staff.full_name}</span> · {dayShort(row.date)}</span>
            {done
              ? <span style={dim}>Reminded today</span>
              : <button type="button" aria-label={`Remind ${row.staff.full_name} about ${dayShort(row.date)}`} onClick={() => remind(row)} style={button(D.panelBg, D.text)}>Remind</button>}
          </div>
        );
      })}
    </section>
  );
}

export default function TeamReportsPanel({ auth }) {
  const [period, setPeriod] = useState("day");
  const [date, setDate] = useState(localISODate());
  const [scope, setScope] = useState("team");
  const [openId, setOpenId] = useState(null);
  const { data, isLoading, isError } = useTeamReports(period, date, scope);
  const canSeeEveryone = auth?.hasPermission?.("reports.view_all");
  const leadsTeam = auth?.hasPermission?.("staff.invite_team");
  const rows = data?.rows || [];
  const reports = rows.filter((row) => row.report);
  const waiting = rows.filter((row) => row.report?.status === "submitted" && row.report.can_review);
  const others = rows.filter((row) => !waiting.includes(row));
  const late = reports.filter((row) => row.report.is_late).length;
  const copies = reports.filter((row) => row.report.similar_warning).length;
  const open = reports.find((row) => row.report.id === openId);
  const toggle = (id) => setOpenId(openId === id ? null : id);

  const openButton = (staff, report) => (
    <button type="button" aria-label={openId === report.id ? `Close ${staff.full_name}'s report` : `Open ${staff.full_name}'s report`}
      onClick={() => toggle(report.id)} style={button(openId === report.id ? D.gold : D.panelBg, D.text)}>
      {openId === report.id ? "Close" : "Open"}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, color: D.text, fontWeight: 800, fontSize: "1.4rem" }}>{scope === "all" ? "Everyone's reports" : "My team's reports"}</h2>
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

      {isLoading && <div role="status" style={dim}>Loading…</div>}
      {isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the team's reports.</div>}
      {!isLoading && !isError && rows.length === 0 && <div style={dim}>Nobody to show for this period.</div>}

      {rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <Kpi label="Reports in" value={`${reports.length} of ${rows.length}`} sub={`${PERIODS.find(([id]) => id === period)?.[1]} reports, ${dayShort(data.period_start)}`} />
          <Kpi label="Late reports" value={late} sub="After the deadline on the day" color={late ? D.warnInk : undefined} />
          <Kpi label="Copy-check flags" value={copies} sub="Reads like an earlier report" color={copies ? D.errInk : undefined} />
          <Kpi label="To review" value={waiting.length} sub="Acknowledge or return" />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: open ? "repeat(auto-fit, minmax(320px, 1fr))" : "1fr", gap: 14, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {waiting.length > 0 && (
            <section aria-labelledby="waiting" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <h3 id="waiting" style={{ margin: 0, color: D.text, fontWeight: 700, fontSize: "0.95rem" }}>Waiting for you · {waiting.length}</h3>
              <div style={scroll}>
                <table style={table}>
                  <thead><tr>{["Person", "Report", "Submitted", "Flags"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}<th scope="col" style={th}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Open</span></th></tr></thead>
                  <tbody>
                    {waiting.map(({ staff, report }) => (
                      <tr key={staff.id} style={{ background: openId === report.id ? D.panelBg2 : "transparent" }}>
                        <td style={td}><div style={{ fontWeight: 800 }}>{staff.full_name}</div><div style={dim}>{roleName(staff.role)}</div></td>
                        <td style={td}>{reportName(report)}</td>
                        <td style={{ ...td, ...figures }}>{report.submitted_at ? clock(report.submitted_at) : ""}</td>
                        <td style={td}><Flags report={report} />{!report.is_late && !report.similar_warning && <span style={dim}>None</span>}</td>
                        <td style={td}>{openButton(staff, report)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {others.length > 0 && (
            <section aria-label="Everyone else" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 4 }}>
              <h3 style={{ margin: 0, color: D.text, fontWeight: 700, fontSize: "0.95rem" }}>{waiting.length ? "The rest of the team" : "The team"}</h3>
              {others.map(({ staff, report }) => (
                <div key={staff.id} style={{ borderTop: `1px solid ${D.divider}`, padding: "8px 0", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>{staff.full_name}</span>
                    <span style={dim}>{staff.role.replace("_", " ")}</span>
                    {report ? <StatusChip status={report.status} /> : <span style={dim}>Not submitted yet</span>}
                    {report?.submitted_at && <span style={dim}>{new Date(report.submitted_at).toLocaleString("en-GH")}</span>}
                    <Flags report={report} />
                  </div>
                  {report && openButton(staff, report)}
                </div>
              ))}
            </section>
          )}

          {leadsTeam && scope === "team" && <NotIn />}
        </div>

        {open && (
          <aside aria-label={`${open.staff.full_name}'s report`} style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={dim}>{`${roleName(open.staff.role)} · ${open.report.period} report${open.report.submitted_at ? ` · submitted ${clock(open.report.submitted_at)}` : ""}`}</div>
              <h3 style={{ margin: 0, color: D.text, fontSize: "1rem", fontWeight: 800 }}>{`${open.staff.full_name} · ${dayShort(open.report.period_start)}`}</h3>
            </div>
            <ReportReview id={open.report.id} />
          </aside>
        )}
      </div>
    </div>
  );
}

export function ReportReview({ id }) {
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
      <SystemSections sections={report.system} live={report.system_is_live} lockedAt={report.snapshot_at || report.submitted_at} />
      <ReportNarrative report={report} />
      {report.similar_warning && <div style={flag}>Copy check: the narrative reads {Math.round(report.similarity * 100)}% like one of their earlier reports.</div>}
      {report.is_late && (
        <div style={flag}>{report.submitted_at && report.due_at && new Date(report.submitted_at) > new Date(report.due_at)
          ? `Submitted ${formatDuration(new Date(report.submitted_at) - new Date(report.due_at))} after the deadline.`
          : "Submitted after the deadline."}</div>
      )}
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

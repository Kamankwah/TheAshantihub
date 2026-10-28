import { useState } from "react";
import { useReportsHub } from "../../../hooks/useInsights.js";
import { D } from "../theme.js";
import { button, chip, dim, field, pill } from "./panelStyles.js";
import { dayShort, figures, scroll, table, td, th } from "./opsPeopleParts.jsx";
import { Kpi, Status, Title, kpiGrid, page, section, sectionTitle, warn } from "./insightsParts.jsx";
import { ExportButtons, PERIODS } from "./reportParts.jsx";
import { ReportReview } from "./TeamReportsPanel.jsx";

// ─── Super Admin 08 Reports hub ──────────────────────────────────────────────
// Every role's reports for one day, week or month: who owed one (leave, holidays
// and days off are not expected), who sent it on time or late, who has not, and
// what a reviewer did. Opening, acknowledging and returning use the reports
// app's own endpoints; the file export is the same one My team uses, so exports
// over 31 days or 5,000 rows are built in the background and arrive as a link
// valid for 24 hours, and every export is logged.
const STATE = {
  submitted: ["Submitted", D.blue], late: ["Late", D.amber], missing: ["Missing", D.red],
  returned: ["Returned", D.blue], acknowledged: ["Acknowledged", D.green], not_due: ["Not due yet", D.textDim],
};
const STATUSES = [["all", "All"], ["waiting", "Waiting for you"], ["submitted", "Submitted"], ["late", "Late"], ["missing", "Missing"], ["returned", "Returned"], ["acknowledged", "Acknowledged"]];
const ROLE_OF_TEAM = { operations: "operations", scouts: "scout", support: "support", accounting: "accountant", marketing: "marketing" };
const roleName = (role) => (role || "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const clock = (iso) => new Date(iso).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });

export default function ReportsHubPanel() {
  const [period, setPeriod] = useState("day");
  const [date, setDate] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("all");
  const [person, setPerson] = useState("");
  const [openId, setOpenId] = useState(null);
  const [exportError, setExportError] = useState("");
  const { data, isLoading, isError } = useReportsHub({ period, date, role, status, person });
  const k = data?.kpis;
  const exportRole = ROLE_OF_TEAM[role];
  const exportPath = data ? `/api/reports/export/?from=${data.from}&to=${data.to}&period=${period}${exportRole ? `&role=${exportRole}` : ""}` : "";
  const open = data?.rows.find((r) => r.report?.id === openId);

  return (
    <div style={page}>
      <Title right={
        <>
          {PERIODS.map(([id, label]) => <button key={id} type="button" aria-pressed={period === id} onClick={() => { setPeriod(id); setOpenId(null); }} style={pill(period === id)}>{label}</button>)}
          <input type="date" aria-label="Date" value={date || data?.from || ""} onChange={(e) => setDate(e.target.value)} style={field} />
        </>
      }>Reports hub</Title>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <div style={kpiGrid}>
              <Kpi label="Waiting for you" value={k.waiting} sub="Submitted, not yet acknowledged or returned" subColor={k.waiting ? warn : undefined} />
              <Kpi label="Today so far" value={`${k.today_sent} of ${k.today_expected}`} sub={`Day reports due ${data.due_time}`} />
              <Kpi label="Yesterday on time" value={`${k.yesterday_on_time} of ${k.yesterday_due}`} sub={k.yesterday_due ? `${Math.round((k.yesterday_on_time / k.yesterday_due) * 100)}%` : "Nobody owed one"} />
              <Kpi label="Yesterday late" value={k.yesterday_late} sub={`After ${data.due_time}`} subColor={k.yesterday_late ? warn : undefined} />
              <Kpi label="Yesterday missing" value={k.yesterday_missing} sub="Never sent" subColor={k.yesterday_missing ? D.red : undefined} />
            </div>

            <section aria-labelledby="by-team" style={section}>
              <h3 id="by-team" style={sectionTitle}>{PERIODS.find(([id]) => id === period)?.[1]} reports by team · {dayShort(data.from)}{data.to !== data.from ? ` – ${dayShort(data.to)}` : ""}</h3>
              <span style={dim}>Due {data.due_time} · people on leave or off shift aren't expected</span>
              {data.teams.length === 0 ? <span style={dim}>Nobody owed a report for this period.</span> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Team", "Reviewed by", "Expected", "On time", "Late", "Missing", "Acknowledged", "On time %"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {data.teams.map((t) => (
                        <tr key={t.key}>
                          <td style={{ ...td, fontWeight: 800 }}>{t.label}</td>
                          <td style={td}>{t.reviewers.join(", ")}</td>
                          <td style={{ ...td, ...figures }}>{t.expected}</td>
                          <td style={{ ...td, ...figures }}>{t.on_time}</td>
                          <td style={{ ...td, ...figures, color: t.late ? warn : undefined }}>{t.late}</td>
                          <td style={{ ...td, ...figures, color: t.missing ? D.red : undefined }}>{t.missing}</td>
                          <td style={{ ...td, ...figures }}>{t.acknowledged}</td>
                          <td style={{ ...td, ...figures }}>{t.on_time_share === null ? "Not due yet" : `${t.on_time_share}%`}</td>
                        </tr>
                      ))}
                      <tr>
                        <td style={{ ...td, fontWeight: 800 }}>Everyone</td><td style={td} />
                        <td style={{ ...td, ...figures, fontWeight: 800 }}>{data.everyone.expected}</td>
                        <td style={{ ...td, ...figures, fontWeight: 800 }}>{data.everyone.on_time}</td>
                        <td style={{ ...td, ...figures, fontWeight: 800 }}>{data.everyone.late}</td>
                        <td style={{ ...td, ...figures, fontWeight: 800 }}>{data.everyone.missing}</td>
                        <td style={{ ...td, ...figures, fontWeight: 800 }}>{data.everyone.acknowledged}</td>
                        <td style={{ ...td, ...figures, fontWeight: 800 }}>{data.everyone.on_time_share === null ? "Not due yet" : `${data.everyone.on_time_share}%`}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <div style={{ display: "grid", gridTemplateColumns: open ? "repeat(auto-fit, minmax(320px, 1fr))" : "1fr", gap: 14, alignItems: "start" }}>
              <section aria-labelledby="reports" style={section}>
                <h3 id="reports" style={sectionTitle}>Reports</h3>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                  <label style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text, display: "flex", flexDirection: "column", gap: 2 }}>Role
                    <select value={role} onChange={(e) => setRole(e.target.value)} style={field}>
                      <option value="">All roles</option>
                      {data.role_options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text, display: "flex", flexDirection: "column", gap: 2 }}>Status
                    <select value={status} onChange={(e) => setStatus(e.target.value)} style={field}>{STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
                  </label>
                  <label style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text, display: "flex", flexDirection: "column", gap: 2 }}>Person
                    <input value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Name" style={field} />
                  </label>
                  <ExportButtons path={exportPath} stem={`ashantihub-reports-${data.from}-${data.to}`} onError={setExportError} />
                </div>
                {exportError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{exportError}</div>}
                {data.rows.length === 0 ? <span style={dim}>No reports match.</span> : (
                  <div style={scroll}>
                    <table style={table}>
                      <thead><tr>{["Person", "Submitted", "Status", "Reviewer"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}<th scope="col" style={th}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Actions</span></th></tr></thead>
                      <tbody>
                        {data.rows.map((r) => {
                          const [label, color] = STATE[r.state] || [r.state, D.textDim];
                          return (
                            <tr key={r.staff.id} style={{ background: r.report?.id === openId ? D.panelBg2 : "transparent" }}>
                              <td style={td}><div style={{ fontWeight: 800 }}>{r.staff.full_name}</div><div style={dim}>{roleName(r.staff.role)}</div></td>
                              <td style={{ ...td, ...figures }}>{r.report?.submitted_at ? clock(r.report.submitted_at) : "Not submitted"}
                                {r.report?.is_late && <div style={{ ...dim, color: warn }}>Late</div>}
                                {r.report?.similar_warning && <div style={{ ...dim, color: warn }}>Reads like an earlier one ({Math.round(r.report.similarity * 100)}%)</div>}
                              </td>
                              <td style={td}><span style={chip(color)}>{label}</span>{r.state === "returned" && r.report.review_note && <div style={dim}>“{r.report.review_note}”</div>}</td>
                              <td style={td}>{r.report?.reviewer ? `${r.report.reviewer}${r.report.reviewed_at ? ` · ${clock(r.report.reviewed_at)}` : ""}` : r.manager}</td>
                              <td style={td}>
                                {r.report && (
                                  <button type="button" aria-label={r.report.id === openId ? `Close ${r.staff.full_name}'s report` : `${r.report.can_review ? "Review" : "Open"} ${r.staff.full_name}'s report`}
                                    onClick={() => setOpenId(r.report.id === openId ? null : r.report.id)} style={button(r.report.id === openId ? D.gold : D.panelBg, D.text)}>
                                    {r.report.id === openId ? "Close" : r.report.can_review ? "Review" : "Open"}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <span style={{ ...dim, lineHeight: 1.5 }}>System numbers in a report are filled in from records and can't be edited; the person writes the narrative. A report flagged "reads like an earlier one" is at least 80% similar to one of that person's last five.</span>
              </section>
              {open && (
                <aside aria-label={`${open.staff.full_name}'s report`} style={{ ...section }}>
                  <div style={dim}>{roleName(open.staff.role)} · {period} report</div>
                  <h3 style={{ ...sectionTitle, fontSize: "1rem" }}>{open.staff.full_name}</h3>
                  <ReportReview id={open.report.id} />
                </aside>
              )}
            </div>
          </>
        )}
      </Status>
    </div>
  );
}

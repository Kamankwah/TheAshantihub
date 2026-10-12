import { useState } from "react";
import { useOpsScouts } from "../../../hooks/useOpsPeople.js";
import { D, glassCard } from "../theme.js";
import { button, chip, dim } from "./panelStyles.js";
import { Bar, dayName, dayShort, figures, plural, scroll, table, td, th, timeShort, toggleButton, toggleGroup } from "./opsPeopleParts.jsx";
import { errorStyle, eyebrow, h2 } from "./portfolioParts.jsx";

// ─── 04 Scouts ───────────────────────────────────────────────────────────────
// The scoreboard: today against target for every scout on the lead's team, and
// every other team's scouts read-only. All numbers come from
// GET /api/operations/scouts/ (check-ins, the call log, KYC approvals,
// payments); nothing here is typed in.
const MEASURES = [["registrations", "Registrations"], ["visits", "Visits"], ["calls", "Calls"], ["renewals", "Renewals"]];
const TOTAL_SUB = {
  registrations: () => "Counted when KYC is approved",
  visits: (totals) => `Check-ins with a check-out${totals.visits_flagged ? ` · ${totals.visits_flagged} flagged` : ""}`,
  calls: () => "From the call log",
  renewals: () => "Subscription payments in the app",
};
const REPORT_LABEL = { not_yet: "Not yet", draft: "Draft saved", submitted: "Submitted", acknowledged: "Acknowledged", returned: "Returned" };
const REPORT_COLOR = { draft: D.amber, submitted: D.blue, acknowledged: D.green, returned: D.red };

function MeasureCell({ row, metric }) {
  const m = row.measures[metric];
  if (row.state !== "working") return <span style={{ color: D.textDim }} aria-label="Not a working day">—</span>;
  if (m.target == null) return <span>{m.done}<span style={{ ...dim, display: "block" }}>No target set</span></span>;
  const behind = m.done < m.target;
  return <span style={{ fontWeight: 700, color: behind && metric === "registrations" ? "#A33A00" : D.text, ...figures }}>{`${m.done} / ${m.target}`}</span>;
}

function MonthCell({ row, label }) {
  const { month } = row;
  if (month.target == null) return <span style={dim}>No target set</span>;
  const pct = month.target ? (month.done / month.target) * 100 : 0;
  const pace = month.on_pace ? "On pace" : `${month.due_by_today} due by today`;
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontWeight: 700, ...figures }}>{`${month.done} / ${month.target}`}</div>
      <Bar pct={pct} label={`${label} registrations this month`} color={month.on_pace ? D.green : D.text} />
      <div style={{ ...dim, color: month.on_pace ? "#00500A" : "#A33A00", ...figures }}>{pace}</div>
      {month.leave_cut > 0 && <div style={dim}>{`Leave cuts ${month.leave_cut} from the month`}</div>}
    </div>
  );
}

function PortfolioCell({ row }) {
  const p = row.portfolio || {};
  if (!p.size) return <span style={dim}>No businesses yet</span>;
  const part = (n, color) => (n ? <div style={{ flex: n, background: color, height: 6 }} /> : null);
  const text = [`${p.healthy} healthy`, `${p.needs_attention} attention`, `${p.at_risk} at risk`, ...(p.new ? [`${p.new} new`] : [])].join(" · ");
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ fontWeight: 700, ...figures }}>{plural(p.size, "business", "businesses")}</div>
      <div role="img" aria-label={text} style={{ display: "flex", gap: 2, borderRadius: 999, overflow: "hidden", margin: "3px 0" }}>
        {part(p.healthy, D.green)}{part(p.new, D.textFaint)}{part(p.needs_attention, D.amber)}{part(p.at_risk, D.red)}
      </div>
      <div style={dim}>{text}</div>
    </div>
  );
}

function CheckInCell({ row }) {
  if (row.state === "leave") return <span style={dim}>{row.back_on ? `On leave · back ${dayShort(row.back_on)}` : "On leave"}</span>;
  if (row.state === "holiday") return <span style={dim}>Public holiday</span>;
  if (row.state === "off") return <span style={dim}>Not a working day</span>;
  const c = row.check_in;
  return (
    <div style={{ minWidth: 150 }}>
      {c ? (
        <div style={{ color: c.outside_radius ? "#A33A00" : D.text, ...figures }}>
          {c.outside_radius && c.distance_m != null ? `${c.place} · ${c.distance_m} m outside the business radius · ${timeShort(c.at)}` : `${c.place} · ${timeShort(c.at)}`}
        </div>
      ) : <span style={dim}>No check-in today</span>}
      {row.outside_7d >= 2 && (
        <span style={{ ...chip(D.amber), display: "inline-block", marginTop: 3 }}>
          {`${row.outside_7d} outside the radius in 7 days${row.fraud_case_open ? " · fraud case raised" : ""}`}
        </span>
      )}
    </div>
  );
}

function ReportCell({ row }) {
  if (row.state === "leave") {
    return <div><span style={chip(D.textDim)}>On leave</span>{row.back_on && <div style={dim}>{`Back ${dayShort(row.back_on)}`}</div>}</div>;
  }
  const { today, last } = row.report;
  const lastText = last ? `${dayName(last.date)}: ${[last.status === "acknowledged" ? "acknowledged" : last.status === "returned" ? "returned" : "submitted", ...(last.is_late ? ["late"] : []), ...(last.similar ? ["copy-check flag"] : [])].join(", ")}` : null;
  return (
    <div>
      <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
        <span style={chip(REPORT_COLOR[today.status] || D.textDim)}>{REPORT_LABEL[today.status] || today.status}</span>
        {today.late && <span style={chip(D.red)}>Late</span>}
      </span>
      <div style={dim}>{lastText || (today.status === "not_yet" ? `Due ${today.due}` : "")}</div>
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", ...dim }} aria-label="Portfolio health colours">
      {[["Healthy", D.green], ["Needs attention", D.amber], ["At risk", D.red]].map(([label, color]) => (
        <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: color }} />{label}
        </span>
      ))}
    </div>
  );
}

export default function OpsScoutsPanel({ auth, onNavigate, onOpenScout }) {
  const [scope, setScope] = useState("team");
  const { data, isLoading, isError, refetch } = useOpsScouts(scope);
  const canInvite = auth?.hasPermission?.("staff.invite_team") ?? false;
  const rows = data?.scouts || [];
  const mine = rows.filter((r) => r.mine);
  const others = rows.filter((r) => !r.mine);
  const otherLeads = [...new Set(others.map((r) => r.manager?.name).filter(Boolean))];
  const grouped = scope === "all" && others.length > 0;

  const renderRow = (row) => (
    <tr key={row.id} style={{ color: row.mine ? D.text : "rgba(44,24,16,0.85)" }}>
      <td style={td}>
        <div style={{ fontWeight: 800 }}>{row.name}</div>
        <div style={dim}>{row.areas.length ? row.areas.join(" · ") : "No area yet"}</div>
      </td>
      {MEASURES.map(([metric]) => <td key={metric} style={td}><MeasureCell row={row} metric={metric} /></td>)}
      <td style={td}><MonthCell row={row} label={row.name} /></td>
      <td style={td}><PortfolioCell row={row} /></td>
      <td style={td}><CheckInCell row={row} /></td>
      <td style={td}><ReportCell row={row} /></td>
      <td style={td}>
        <button type="button" aria-label={`${row.mine ? "Open" : "View"} ${row.name}`} onClick={() => onOpenScout?.(row.id)} style={button(row.mine ? D.gold : D.panelBg, D.text)}>
          {row.mine ? "Open" : "View"}
        </button>
      </td>
    </tr>
  );
  const header = (title, note) => (
    <tr key={`h-${title}`}>
      <th scope="rowgroup" colSpan={10} style={{ ...th, background: D.panelBg2, textTransform: "none", fontSize: "0.78rem" }}>
        {title}<span style={{ ...dim, fontWeight: 600, marginLeft: 10 }}>{note}</span>
      </th>
    </tr>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={eyebrow}>People</div>
          <h2 style={{ ...h2, fontSize: "1.4rem", margin: "2px 0 0" }}>Scouts</h2>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div role="group" aria-label="Which scouts" style={toggleGroup}>
            <button type="button" aria-pressed={scope === "team"} onClick={() => setScope("team")} style={toggleButton(scope === "team")}>{`My team${data ? ` · ${data.counts.team}` : ""}`}</button>
            <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")} style={toggleButton(scope === "all")}>{`All scouts${data ? ` · ${data.counts.all}` : ""}`}</button>
          </div>
          {canInvite && <button type="button" onClick={() => onNavigate?.("my-team")} style={button(D.gold, D.text)}>Invite a scout</button>}
        </div>
      </div>

      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Couldn't load the scouts. <button type="button" onClick={() => refetch()} style={button(D.panelBg, D.text)}>Try again</button></div>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
            {MEASURES.map(([metric, label]) => {
              const t = data.totals[metric];
              return (
                <div key={metric} role="group" aria-label={`Your team · ${label.toLowerCase()}`} style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ ...dim, fontWeight: 700 }}>{`Your team · ${label.toLowerCase()}`}</div>
                  <div style={{ fontSize: "1.4rem", fontWeight: 800, color: D.text, ...figures }}>{t.target ? `${t.done} / ${t.target}` : t.done}</div>
                  {t.target > 0 && <Bar pct={(t.done / t.target) * 100} label={`${label} against target`} />}
                  <div style={dim}>{TOTAL_SUB[metric](data.totals)}</div>
                </div>
              );
            })}
          </div>

          <section aria-labelledby="ops-scouts-table" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <h3 id="ops-scouts-table" style={{ ...h2, fontSize: "0.95rem" }}>Today against target</h3>
              <Legend />
            </div>
            {rows.length === 0 ? (
              <div style={dim}>{scope === "team" ? "No scouts report to you yet. Invite one from the Invite screen." : "There are no active scouts yet."}</div>
            ) : (
              <div style={scroll}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th scope="col" style={th}>Scout</th>
                      {MEASURES.map(([metric, label]) => <th key={metric} scope="col" style={th}>{label}</th>)}
                      <th scope="col" style={th}>{`${data.month_label} registrations`}</th>
                      <th scope="col" style={th}>Portfolio</th>
                      <th scope="col" style={th}>Last check-in</th>
                      <th scope="col" style={th}>Today's report</th>
                      <th scope="col" style={th}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped ? (
                      <>
                        {mine.length > 0 && header("Your team", "")}
                        {mine.map(renderRow)}
                        {others.length > 0 && header(`${otherLeads.length === 1 ? `${otherLeads[0]}'s team` : "Other teams"}`, "Read-only for you")}
                        {others.map(renderRow)}
                      </>
                    ) : rows.map(renderRow)}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ ...dim, lineHeight: 1.5 }}>
              {others.length > 0
                ? `You act on your own team — targets, leave, reassigning businesses and acknowledging reports. ${otherLeads.length === 1 ? `${otherLeads[0]}'s` : "Other teams'"} scouts are read-only here; ask ${otherLeads.length === 1 ? otherLeads[0] : "their lead"} to act on them. `
                : "You act on your own team — targets, leave, reassigning businesses and acknowledging reports. "}
              Numbers come from check-ins, the call log, KYC approvals and payments — nobody types them.
            </div>
          </section>
        </>
      )}
    </div>
  );
}

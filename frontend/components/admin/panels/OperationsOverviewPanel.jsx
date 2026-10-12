import { useActivity } from "../../../hooks/useActivity.js";
import { useOpsOverview } from "../../../hooks/useOpsPeople.js";
import { formatDuration } from "../../../lib/timeAgo.js";
import { useState } from "react";
import { D, ROLE_ACCENTS, ROLE_BADGE_TEXT, glassCard } from "../theme.js";
import { button, chip, dim } from "./panelStyles.js";
import { CheckInCell, MonthCell, PortfolioCell, ReportCell } from "./OpsScoutsPanel.jsx";
import { figures, plural, scroll, table, td, th, timeShort, toggleButton, toggleGroup } from "./opsPeopleParts.jsx";
import { errorStyle, eyebrow, h2 } from "./portfolioParts.jsx";

// ─── 01 Operations overview ──────────────────────────────────────────────────
// Six counts, the lead's scouts, what waits for them, the live activity feed and
// the issues on the team's businesses. Every figure comes from
// GET /api/operations/overview/ (targets, KYC approvals, check-ins, approvals,
// health ratings, fraud cases) and GET /api/activity/. Support and delivery
// issues have no records yet, so the issue count says so rather than showing 0.
const PERIODS = [["today", "Today"], ["week", "Week"], ["month", "Month"]];
const PERIOD_WORD = { today: "today", week: "this week", month: "this month" };
const warn = "#A33A00";

function Kpi({ label, value, sub, subColor, onClick }) {
  const body = (
    <>
      <span style={{ ...dim, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: "1.55rem", fontWeight: 800, color: D.text, ...figures }}>{value}</span>
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

function ageText(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  return ms < 60000 ? "just now" : formatDuration(ms);
}

function moveText(item) {
  if (!item.next_move) return null;
  const left = new Date(item.next_move.at).getTime() - Date.now();
  return left > 0 ? `Moves to ${item.next_move.label} in ${formatDuration(left)}` : `Moves to ${item.next_move.label} now`;
}

export function kpiCards(data, period) {
  const k = data.kpis;
  const r = k.registrations;
  const word = PERIOD_WORD[period];
  const issueParts = [`${k.issues.fraud} fraud`];
  if (k.issues.support != null) issueParts.push(`${k.issues.support} support`);
  if (k.issues.delivery != null) issueParts.push(`${k.issues.delivery} delivery`);
  const checkedSub = [
    k.checked_in.working ? `Working ${word === "today" ? "today" : "now"}` : "Nobody is working today",
    ...(k.checked_in.on_leave.length ? [`${k.checked_in.on_leave.join(", ")} on leave`] : []),
    ...(k.checked_in.flagged ? [`${k.checked_in.flagged} flagged`] : []),
  ].join(" · ");
  return {
    registrations: { label: `Team registrations ${word}`, value: r.target != null ? `${r.done} / ${r.target}` : `${r.done}`, sub: r.target != null ? `Target = sum of ${plural(r.planned, "scout's", "scouts'")} plan${r.planned === 1 ? "" : "s"}` : "No targets set yet" },
    activations: { label: `Activations ${word}`, value: `${k.activations.count}`, sub: `KYC approved and first listing live · ${k.activations.registered} registered` },
    approvals: { label: "Approvals waiting", value: `${k.approvals.waiting}`, sub: k.approvals.oldest ? `Oldest ${ageText(k.approvals.oldest.created_at)} · ${k.approvals.oldest.target_label || k.approvals.oldest.title}` : "Nothing waiting for you", color: k.approvals.waiting ? warn : undefined },
    checked_in: { label: "Scouts checked in", value: `${k.checked_in.count} / ${k.checked_in.working}`, sub: checkedSub },
    at_risk: { label: "At-risk businesses", value: `${k.at_risk.count}`, sub: `${k.at_risk.needs_attention} more need attention`, color: k.at_risk.count ? warn : undefined },
    issues: { label: "Open service issues", value: `${k.issues.total}`, sub: `${issueParts.join(" · ")}${k.issues.support == null ? " · support and delivery counts arrive with those screens" : ""}` },
  };
}

export default function OperationsOverviewPanel({ auth, onNavigate, onOpenApproval, onOpenBusiness }) {
  const [period, setPeriod] = useState("today");
  const { data, isLoading, isError, refetch } = useOpsOverview(period);
  const feed = useActivity();
  const events = (feed.data?.results || []).slice(0, 6);
  const canInvite = auth?.hasPermission?.("staff.invite_team");
  const cards = data ? kpiCards(data, period) : null;
  const now = data ? new Date(data.now) : new Date();
  const dateLine = `${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${timeShort(now)}${auth?.user?.full_name ? ` · ${auth.user.full_name}` : ""}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={eyebrow}>{dateLine}</div>
          <h2 style={{ ...h2, fontSize: "1.4rem", margin: "2px 0 0" }}>Operations overview</h2>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div role="group" aria-label="Period" style={toggleGroup}>
            {PERIODS.map(([id, label]) => <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)} style={toggleButton(period === id)}>{label}</button>)}
          </div>
          {canInvite && <button type="button" onClick={() => onNavigate?.("my-team")} style={button(D.gold, D.text)}>Invite to your team</button>}
        </div>
      </div>

      {isLoading && <div role="status" style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Couldn't load the overview. <button type="button" onClick={() => refetch()} style={button(D.panelBg, D.text)}>Try again</button></div>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
            <Kpi {...cards.registrations} onClick={() => onNavigate?.("ops-scouts")} />
            <Kpi {...cards.activations} />
            <Kpi {...cards.approvals} subColor={cards.approvals.color} onClick={() => onNavigate?.("approvals")} />
            <Kpi {...cards.checked_in} onClick={() => onNavigate?.("ops-scouts")} />
            <Kpi {...cards.at_risk} subColor={cards.at_risk.color} onClick={() => onNavigate?.("at-risk")} />
            <Kpi {...cards.issues} onClick={() => onNavigate?.("fraud-cases")} />
          </div>

          <section aria-labelledby="ov-scouts" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <h3 id="ov-scouts" style={{ ...h2, fontSize: "0.95rem" }}>Scout progress · registrations</h3>
              <span style={{ display: "inline-flex", gap: 12 }}>
                <button type="button" onClick={() => onNavigate?.("ops-scouts")} style={linkStyle}>All measures</button>
                {auth?.hasPermission?.("targets.manage") && <button type="button" onClick={() => onNavigate?.("targets")} style={linkStyle}>Set targets</button>}
              </span>
            </div>
            {data.scouts.length === 0 ? (
              <div style={dim}>No scouts report to you yet. Invite one from the Invite screen.</div>
            ) : (
              <div style={scroll}>
                <table style={table}>
                  <thead>
                    <tr>
                      <th scope="col" style={th}>Scout</th>
                      <th scope="col" style={th}>Today</th>
                      <th scope="col" style={th}>{`${data.month_label} so far`}</th>
                      <th scope="col" style={th}>Portfolio</th>
                      <th scope="col" style={th}>Last check-in</th>
                      <th scope="col" style={th}>Today's report</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.scouts.map((row) => {
                      const m = row.measures.registrations;
                      return (
                        <tr key={row.id}>
                          <td style={td}><div style={{ fontWeight: 800 }}>{row.name}</div><div style={dim}>{row.areas.length ? row.areas.join(" · ") : "No area yet"}</div></td>
                          <td style={{ ...td, ...figures, fontWeight: 700 }}>{row.state !== "working" ? "—" : m.target == null ? `${m.done}` : `${m.done} / ${m.target}`}</td>
                          <td style={td}><MonthCell row={row} label={row.name} /></td>
                          <td style={td}><PortfolioCell row={row} /></td>
                          <td style={td}><CheckInCell row={row} /></td>
                          <td style={td}><ReportCell row={row} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ ...dim, lineHeight: 1.5 }}>
              {data.totals.registrations.target > 0
                ? <>Your team's registration target today is the sum of your scouts' targets: <strong style={{ color: D.text, ...figures }}>{`${data.totals.registrations.done} of ${data.totals.registrations.target}`}</strong>. </>
                : null}
              A registration counts when its KYC is approved. A scout on leave has a target of zero.
            </div>
          </section>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
            <section aria-labelledby="ov-waiting" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h3 id="ov-waiting" style={{ ...h2, fontSize: "0.95rem" }}>Waiting for you</h3>
                <button type="button" onClick={() => onNavigate?.("approvals")} style={linkStyle}>{`All ${data.kpis.approvals.waiting}`}</button>
              </div>
              {data.waiting.length === 0 && <div style={dim}>Nothing is waiting for your decision.</div>}
              {data.waiting.map((item) => (
                <div key={item.id} style={{ borderTop: `1px solid ${D.divider}`, paddingTop: 8, display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontWeight: 800, color: D.text }}>{item.title}</span>
                    <span style={{ ...dim, ...figures }}>{ageText(item.created_at)}</span>
                  </div>
                  <div style={dim}>{`Requested by ${item.maker}${item.target_label ? ` · ${item.target_label}` : ""}`}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <span style={dim}>{moveText(item) || ""}</span>
                    <button type="button" aria-label={`Open request: ${item.title}`} onClick={() => onOpenApproval?.(item.id)} style={linkStyle}>Open request</button>
                  </div>
                </div>
              ))}
            </section>

            <section aria-labelledby="ov-activity" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <h3 id="ov-activity" style={{ ...h2, fontSize: "0.95rem" }}>Live activity</h3>
              {feed.isLoading && <div style={dim}>Loading…</div>}
              {feed.isError && <div role="alert" style={errorStyle}>Couldn't load the activity feed.</div>}
              {!feed.isLoading && !feed.isError && events.length === 0 && <div style={dim}>No activity yet.</div>}
              {events.map((e) => (
                <div key={e.id} style={{ display: "flex", gap: 8, alignItems: "baseline", borderTop: `1px solid ${D.divider}`, paddingTop: 6, fontSize: "0.8rem", flexWrap: "wrap" }}>
                  {e.actor_role && <span style={{ background: ROLE_ACCENTS[e.actor_role] || D.textDim, color: ROLE_BADGE_TEXT[e.actor_role] || "#fff", borderRadius: 20, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 800 }}>{e.actor_role.replace("_", " ")}</span>}
                  <span style={{ color: D.text, flex: 1, minWidth: 140 }}>{`${e.actor_label} · ${e.verb.replace(/[._-]+/g, " ").trim()}${e.target_label ? ` · ${e.target_label}` : ""}`}</span>
                  <span style={{ ...dim, ...figures }}>{timeShort(e.occurred_at)}</span>
                </div>
              ))}
            </section>
          </div>

          <section aria-labelledby="ov-issues" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <h3 id="ov-issues" style={{ ...h2, fontSize: "0.95rem" }}>Issues on your team's businesses</h3>
              <button type="button" onClick={() => onNavigate?.("fraud-cases")} style={linkStyle}>{`All fraud cases (${data.issue_total})`}</button>
            </div>
            {data.issues.length === 0 ? (
              <div style={dim}>No open fraud cases on your team's businesses. Support and delivery issues will join this list when those screens arrive.</div>
            ) : (
              <div style={scroll}>
                <table style={table}>
                  <thead><tr>{["Type", "Business", "What happened", "Account manager", "Open for"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.issues.map((i) => (
                      <tr key={i.id}>
                        <td style={td}><span style={chip(D.red)}>Fraud</span></td>
                        <td style={{ ...td, fontWeight: 700 }}>
                          {i.business_id ? <button type="button" onClick={() => onOpenBusiness?.(i.business_id)} style={{ ...linkStyle, fontWeight: 700, color: D.text }}>{i.business}</button> : i.business}
                        </td>
                        <td style={td}>{i.what}</td>
                        <td style={td}>{i.account_manager || "—"}</td>
                        <td style={{ ...td, ...figures }}>{formatDuration(i.open_seconds * 1000)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

const linkStyle = { background: "none", border: 0, padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 800, color: D.deepGold, textDecoration: "underline" };

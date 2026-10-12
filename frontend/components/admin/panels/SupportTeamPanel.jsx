import { useSupportTeam } from "../../../hooks/useOpsPeople.js";
import { formatDuration } from "../../../lib/timeAgo.js";
import { D, glassCard } from "../theme.js";
import { figures, plural, scroll, table, td, th, longDay } from "./opsPeopleParts.jsx";
import { button, callout, chip, dim } from "./panelStyles.js";
import { card, errorStyle, h2 } from "./portfolioParts.jsx";
import { LastSignIn } from "./sessionParts.jsx";

// ─── 05 Support team (reduced) ───────────────────────────────────────────────
// The support agents who report to the caller, with what the system records for
// them (sign-in, calls logged today, day report), and the support conversation
// queue as counts. Conversations have no assignee, reply author or time limit
// yet, so there is no per-agent queue, first-reply time or breach count, and
// nothing to reassign: those arrive with the Support phase.
const REPORT = { draft: "Draft saved", submitted: "Submitted", acknowledged: "Acknowledged", returned: "Returned" };
const SOON = "Who a conversation is assigned to, first-reply times and time-limit breaches arrive with the Support phase. Until then the queue is shared and shown here as counts.";

function Kpi({ label, value, sub }) {
  return (
    <div role="group" aria-label={label} style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ ...dim, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: "1.55rem", fontWeight: 800, color: D.text, ...figures }}>{value}</span>
      <span style={dim}>{sub}</span>
    </div>
  );
}

export default function SupportTeamPanel({ onNavigate }) {
  const { data, isLoading, isError, refetch } = useSupportTeam();
  const q = data?.queue;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={h2}>Support team</h2>
          {onNavigate && <button type="button" onClick={() => onNavigate("my-team")} style={button(D.gold, D.text)}>Invite a support agent</button>}
        </div>
        <div style={callout(D.amber)}>{SOON}</div>
      </div>
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && (
        <div role="alert" style={{ ...card, ...errorStyle }}>Could not load the support team.
          <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Try again</button>
        </div>
      )}
      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(200px, 100%), 1fr))", gap: 12 }}>
            <Kpi label="Open conversations" value={q.open} sub={`${plural(q.by_starter.customers, "customer", "customers")} · ${plural(q.by_starter.business_owners, "business owner", "business owners")} · ${plural(q.by_starter.guests, "guest", "guests")}`} />
            <Kpi label="Waiting for a reply" value={q.awaiting_reply} sub="Open, and the last message is not from Support" />
            <Kpi label="Longest wait" value={q.oldest_waiting_seconds == null ? "—" : formatDuration(q.oldest_waiting_seconds * 1000)} sub="Since the last message in that conversation" />
            <Kpi label="Closed this week" value={q.closed_this_week} sub={`${q.closed_total} closed in all`} />
          </div>
          <section aria-labelledby="st-agents" style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <h3 id="st-agents" style={{ ...h2, fontSize: "0.95rem" }}>Agents reporting to you</h3>
            {data.agents.length === 0 ? <div style={dim}>No support agent reports to you yet.</div> : (
              <div style={scroll}>
                <table style={table}>
                  <thead><tr>{["Agent", "Calls logged today", "Report today", "Last report"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.agents.map((a) => (
                      <tr key={a.id}>
                        <td style={td}><div style={{ fontWeight: 800 }}>{a.name}{a.suspended && <span style={{ ...chip(D.red), marginLeft: 6 }}>Suspended</span>}</div><LastSignIn staff={a} /></td>
                        <td style={{ ...td, ...figures }}>{a.calls_today}</td>
                        <td style={td}>{a.report_today ? REPORT[a.report_today] || a.report_today : "Not yet"}</td>
                        <td style={td}>{a.last_report ? `${longDay(a.last_report.date)}: ${(REPORT[a.last_report.status] || a.last_report.status).toLowerCase()}` : "No report yet"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <div style={dim}>Conversations are always with AshantiHub Support about a business, never with the business itself. Today the “About” line comes from the conversation's subject.</div>
        </>
      )}
    </div>
  );
}

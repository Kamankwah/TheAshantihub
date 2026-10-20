import { useActivity } from "../../../hooks/useActivity.js";
import { useSaOverview } from "../../../hooks/useSaOverview.js";
import { formatDuration } from "../../../lib/timeAgo.js";
import { D, ROLE_ACCENTS, ROLE_BADGE_TEXT, glassCard } from "../theme.js";
import { button, chip, dim } from "./panelStyles.js";
import { figures, scroll, timeShort } from "./opsPeopleParts.jsx";
import { errorStyle, eyebrow, h2, money } from "./portfolioParts.jsx";

// ─── Super Admin 01 Command center ───────────────────────────────────────────
// Everything comes from GET /api/operations/superadmin-overview/ (approvals engine,
// live sessions, the Operations scoreboard, service issues, fraud cases, settings)
// and GET /api/activity/. What nothing records (service time limits, payouts, SMS
// balance) is listed under "Not tracked yet", never shown as a zero.
const STATE = {
  ok: ["Working", D.green], configured: ["Set up", D.green], simulated: ["Simulated", D.amber],
  down: ["Down", D.red], not_connected: ["Not connected", D.textFaint], not_tracked: ["Not tracked yet", D.textFaint],
};
const warn = D.warnInk;
const linkStyle = { background: "none", border: 0, padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 800, color: D.deepGold, textDecoration: "underline" };

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

const age = (iso) => { const ms = Date.now() - new Date(iso).getTime(); return ms < 60000 ? "just now" : formatDuration(ms); };
const roleName = (role) => { const text = (role || "").replace(/_/g, " "); return text.charAt(0).toUpperCase() + text.slice(1); };

export function kpiCards(data) {
  const k = data.kpis;
  return {
    decisions: { label: "Decisions waiting for you", value: `${k.decisions.waiting}`, sub: k.decisions.escalated ? `${k.decisions.escalated} escalated to you · ${k.decisions.open_everywhere} open across AshantiHub` : `${k.decisions.open_everywhere} open across AshantiHub`, color: k.decisions.waiting ? warn : undefined },
    online: { label: "Staff online", value: `${k.staff_online.online} / ${k.staff_online.active}`, sub: "Signed in with a live session" },
    fraud: { label: "Open fraud cases", value: `${k.fraud_open}`, sub: k.fraud_open ? "Waiting for a decision" : "None open", color: k.fraud_open ? warn : undefined },
    issues: { label: "Open service issues", value: `${k.service_issues}`, sub: "Support chats, disputes and contact messages" },
    at_risk: { label: "At-risk businesses", value: `${k.at_risk.count}`, sub: `${k.at_risk.needs_attention} more need attention`, color: k.at_risk.count ? warn : undefined },
    reports: { label: "Day reports in today", value: `${k.reports_today.submitted}`, sub: "Submitted or acknowledged" },
  };
}

export default function SuperAdminOverviewPanel({ auth, onNavigate, onOpenApproval }) {
  const { data, isLoading, isError, refetch } = useSaOverview();
  const feed = useActivity();
  const events = (feed.data?.results || []).slice(0, 8);
  const cards = data ? kpiCards(data) : null;
  const now = data ? new Date(data.now) : new Date();
  const dateLine = `${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${timeShort(now)}${auth?.user?.full_name ? ` · ${auth.user.full_name}` : ""}`;
  const section = { ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={eyebrow}>{dateLine}</div>
        <h2 style={{ ...h2, fontSize: "1.4rem", margin: "2px 0 0" }}>Command center</h2>
      </div>
      {isLoading && <div role="status" style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Couldn't load the command center. <button type="button" onClick={() => refetch()} style={button(D.panelBg, D.text)}>Try again</button></div>}
      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
            <Kpi {...cards.decisions} subColor={cards.decisions.color} onClick={() => onNavigate?.("approvals")} />
            <Kpi {...cards.online} onClick={() => onNavigate?.("sessions")} />
            <Kpi {...cards.fraud} subColor={cards.fraud.color} onClick={() => onNavigate?.("fraud-cases")} />
            <Kpi {...cards.issues} />
            <Kpi {...cards.at_risk} subColor={cards.at_risk.color} onClick={() => onNavigate?.("all-portfolios")} />
            <Kpi {...cards.reports} onClick={() => onNavigate?.("team-reports")} />
          </div>

          <section aria-labelledby="sa-waiting" style={section}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <h3 id="sa-waiting" style={{ ...h2, fontSize: "0.95rem" }}>Needs your decision · most urgent first</h3>
              <button type="button" onClick={() => onNavigate?.("approvals")} style={linkStyle}>{`My approvals (${data.kpis.decisions.waiting})`}</button>
            </div>
            {data.waiting.length === 0 && <div style={dim}>Nothing is waiting for your decision.</div>}
            {data.waiting.map((item) => (
              <div key={item.id} style={{ borderTop: `1px solid ${D.divider}`, paddingTop: 8, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={chip(D.blue)}>{item.kind_label}</span>
                    {item.escalation_level > 0 && <span style={chip(D.red)}>Escalated to you</span>}
                    {item.requires_sudo && <span style={chip(D.amber)}>Asks for your password</span>}
                    <span style={{ fontWeight: 800, color: D.text }}>{item.title}</span>
                  </div>
                  <div style={dim}>{`Made by ${item.maker} (${roleName(item.maker_role)}) · waiting ${age(item.created_at)}${item.amount != null ? ` · ${money(item.amount)}` : ""}`}</div>
                </div>
                <button type="button" aria-label={`Review: ${item.title}`} onClick={() => onOpenApproval?.(item.id)} style={button(D.gold, D.text)}>Review</button>
              </div>
            ))}
          </section>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
            <section aria-labelledby="sa-platform" style={section}>
              <h3 id="sa-platform" style={{ ...h2, fontSize: "0.95rem" }}>Platform status</h3>
              {data.platform.map((s) => {
                const [word, color] = STATE[s.state] || [s.state, D.textDim];
                return (
                  <div key={s.key} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderTop: `1px solid ${D.divider}`, paddingTop: 6, fontSize: "0.8rem", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 700, color: D.text }}>{s.name}</span>
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "baseline" }}><span style={dim}>{s.detail}</span><span style={chip(color)}>{word}</span></span>
                  </div>
                );
              })}
              <div style={dim}>{`Set up means the setting is present, not that the provider was reached. Not tracked yet: ${data.not_tracked.join(", ").toLowerCase()}.`}</div>
            </section>

            <section aria-labelledby="sa-activity" style={section}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <h3 id="sa-activity" style={{ ...h2, fontSize: "0.95rem" }}>Activity across AshantiHub</h3>
                <button type="button" onClick={() => onNavigate?.("activity")} style={linkStyle}>Full audit log</button>
              </div>
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

          <section aria-labelledby="sa-teams" style={section}>
            <h3 id="sa-teams" style={{ ...h2, fontSize: "0.95rem" }}>Teams right now</h3>
            <div style={dim}>Open a team to see its workspace read-only.</div>
            <div style={scroll}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                {data.teams.map((t) => (
                  <div key={t.role} role="group" aria-label={t.label} style={{ border: `1px solid ${D.cardBorder}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontWeight: 800, color: D.text }}>{t.label}</div>
                    <div style={{ ...dim, ...figures }}>{`${t.online} of ${t.staff} online`}</div>
                    {t.work.map((line) => <div key={line} style={{ fontSize: "0.78rem", color: D.text }}>{line}</div>)}
                    {t.work.length === 0 && <div style={dim}>No work figures for this team yet.</div>}
                    {t.flag && <div style={{ fontSize: "0.78rem", color: warn, fontWeight: 700 }}>{t.flag}</div>}
                    <button type="button" aria-label={`Step in: ${t.label}`} onClick={() => onNavigate?.(t.step_in)} style={{ ...linkStyle, alignSelf: "flex-start" }}>Step in · read-only</button>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

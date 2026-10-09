import { useApprovals } from "../../../hooks/useApprovals.js";
import { useMyCommission } from "../../../hooks/useCommission.js";
import { useMyTasks } from "../../../hooks/useMyTasks.js";
import { useTargets } from "../../../hooks/useTargets.js";
import { D, glassCard } from "../theme.js";
import { SOURCE, dueLabel } from "./FollowUpsPanel.jsx";
import { button, dim } from "./panelStyles.js";
import { errorStyle, eyebrow, h3 } from "./portfolioParts.jsx";

// ─── 01 Today ────────────────────────────────────────────────────────────────
// The scout's home screen. Every card owns its hook and shows only what the
// server returned: no targets set means "No targets set yet", an empty queue
// says so, and nothing is filled in with a plausible number.
const figures = { fontVariantNumeric: "tabular-nums" };
const card = { ...glassCard, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 };
const link = { background: "none", border: "none", padding: 0, color: D.deepGold, fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline", minHeight: 44 };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function greeting(hour) {
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function CardHead({ title, action, onAction, actionLabel }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <h3 style={{ ...h3, fontSize: "0.95rem" }}>{title}</h3>
      {action && <button type="button" onClick={onAction} aria-label={actionLabel} style={link}>{action}</button>}
    </div>
  );
}

// "2 of 5" / "No target set", from one measure of the week or month payload.
const ofTarget = (measure) => (measure?.target == null ? null : `${measure.done} of ${measure.target}`);

function TargetRow({ measure, week, month, monthName }) {
  const hasTarget = measure.today_target != null;
  const pct = hasTarget && measure.today_target > 0 ? Math.min(100, Math.round((measure.today_done / measure.today_target) * 100)) : 0;
  const complete = hasTarget && measure.today_target > 0 && measure.today_done >= measure.today_target;
  const weekText = ofTarget(week), monthText = ofTarget(month);
  return (
    <div role="group" aria-label={measure.label} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: "0.9rem", fontWeight: 700, color: D.text }}>{measure.label}</span>
        <span style={{ fontSize: "0.95rem", fontWeight: 800, color: D.text, ...figures }}>
          {measure.today_done}
          {hasTarget
            ? <span style={{ fontWeight: 600, color: D.textDim }}>{` / ${measure.today_target}`}</span>
            : <span style={{ fontSize: "0.72rem", fontWeight: 600, color: D.textDim }}>{" · No target set"}</span>}
        </span>
      </div>
      {hasTarget && measure.today_target > 0 && (
        <div role="progressbar" aria-label={`${measure.label} today`} aria-valuemin={0} aria-valuemax={measure.today_target} aria-valuenow={Math.min(measure.today_done, measure.today_target)}
          style={{ height: 6, borderRadius: 999, background: "#EADFC6", overflow: "hidden" }}>
          <div style={{ height: 6, width: `${pct}%`, background: complete ? D.green : D.text, borderRadius: 999 }} />
        </div>
      )}
      {hasTarget && measure.today_target === 0 && <div style={dim}>No target today</div>}
      {(weekText || monthText) && (
        <div style={{ ...dim, ...figures }}>
          {[weekText && `Week ${weekText}`, monthText && `${monthName} ${monthText}`].filter(Boolean).join(" · ")}
        </div>
      )}
    </div>
  );
}

function TargetsCard({ lead, onOpen }) {
  const week = useTargets("week");
  const month = useTargets("month");
  const data = week.data;
  const monthName = data?.today ? new Date(`${data.today}T12:00:00`).toLocaleDateString("en-GB", { month: "long" }) : "This month";
  return (
    <section aria-label="Today's targets" style={card}>
      <CardHead title="Today's targets" action="Targets" actionLabel="Open Targets" onAction={onOpen} />
      {week.isLoading && <div style={dim}>Loading…</div>}
      {week.isError && <div role="alert" style={errorStyle}>Couldn't load your targets.</div>}
      {data && !data.has_targets && (
        <div style={{ ...dim, lineHeight: 1.45 }}><strong style={{ color: D.text }}>No targets set yet</strong>{` — ${lead || "Operations"} sets them. What you have done today is shown below.`}</div>
      )}
      {data && data.measures.map((measure) => (
        <TargetRow key={measure.metric} measure={measure} monthName={monthName}
          week={measure} month={month.data?.measures?.find((m) => m.metric === measure.metric)} />
      ))}
      <div style={{ ...dim, lineHeight: 1.45 }}>Registrations count when Operations approves KYC. Renewals count when the owner pays in the app.</div>
    </section>
  );
}

function ActionsCard({ canCheckIn, canRegister, onCheckIn, onRegister }) {
  if (!canCheckIn && !canRegister) return null;
  return (
    <section aria-label="Quick actions" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: canCheckIn && canRegister ? "1fr 1fr" : "1fr", gap: 8 }}>
        {canCheckIn && <button type="button" onClick={onCheckIn} style={{ ...button(D.gold, D.text), minHeight: 52, fontSize: "0.95rem" }}>Check in</button>}
        {canRegister && <button type="button" onClick={onRegister} style={{ ...button(D.panelBg, D.text), minHeight: 52, fontSize: "0.95rem" }}>Register a business</button>}
      </div>
      {canCheckIn && <div style={{ ...dim, textAlign: "center" }}>Your location is recorded only when you check in or out.</div>}
    </section>
  );
}

function DueRow({ task, section, onOpenBusiness }) {
  const [label, bg, fg] = SOURCE[task.kind] || SOURCE.manual;
  const name = task.business?.name || task.prospect?.name || task.title;
  const urgent = section === "overdue" || (task.kind === "subscription_overdue" && task.overdue != null);
  const body = (
    <>
      <span style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ background: bg, color: fg, borderRadius: 999, padding: "2px 8px", fontSize: "0.68rem", fontWeight: 800 }}>{label}</span>
        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: urgent ? "#A33A00" : D.textDim, ...figures }}>{dueLabel(task, section)}</span>
      </span>
      <span style={{ fontWeight: 700, fontSize: "0.88rem", color: D.text }}>{name}</span>
      {task.title && task.title !== name && <span style={{ ...dim, lineHeight: 1.4 }}>{task.title}</span>}
    </>
  );
  const style = { display: "flex", flexDirection: "column", gap: 3, padding: "9px 0", textAlign: "left", background: "none", border: "none", borderTop: `1px solid ${D.divider}`, fontFamily: "inherit", width: "100%" };
  return task.business
    ? <button type="button" aria-label={`Open ${name}`} onClick={() => onOpenBusiness?.(task.business.id)} style={{ ...style, cursor: "pointer" }}>{body}</button>
    : <div style={style}>{body}</div>;
}

function FollowUpsCard({ onOpenBusiness, onOpen }) {
  const overdue = useMyTasks("overdue");
  const today = useMyTasks("due_today");
  const open = useMyTasks("open");
  const loading = overdue.isLoading || today.isLoading;
  const failed = overdue.isError || today.isError;
  const rows = [...(overdue.data || []).map((t) => [t, "overdue"]), ...(today.data || []).map((t) => [t, "today"])].slice(0, 3);
  const overdueCount = (overdue.data || []).length;
  const total = open.data ? open.data.length : (overdueCount + (today.data || []).length);
  return (
    <section aria-label="Due follow-ups" style={card}>
      <CardHead title="Due follow-ups"
        action={!loading && !failed && total > 0 ? `All ${total} · ${overdueCount} overdue` : null} actionLabel="Open all follow-ups" onAction={onOpen} />
      {loading && <div style={dim}>Loading…</div>}
      {failed && <div role="alert" style={errorStyle}>Couldn't load your follow-ups.</div>}
      {!loading && !failed && rows.length === 0 && (
        <div style={{ ...dim, lineHeight: 1.45 }}>Nothing due — follow-ups appear here when a subscription is overdue, a delivery goes wrong, an approval comes back or you set a follow-up date.</div>
      )}
      <div>{rows.map(([task, section]) => <DueRow key={task.id} task={task} section={section} onOpenBusiness={onOpenBusiness} />)}</div>
    </section>
  );
}

// What each approval kind is called in the "Waiting for" line.
const WAITING_NOUN = {
  "New business (KYC)": ["registration", "registrations"],
  "Business details change": ["change", "changes"],
  "New product or service": ["new product", "new products"],
  "Listing photos": ["photo set", "photo sets"],
};

export function waitingLine(rows, count) {
  const groups = new Map();
  for (const row of rows) groups.set(row.kind_label, (groups.get(row.kind_label) || 0) + 1);
  const parts = [...groups].map(([label, n]) => {
    const [one, many] = WAITING_NOUN[label] || [label.toLowerCase(), label.toLowerCase()];
    return plural(n, one, many);
  });
  const hidden = count - rows.length;
  if (hidden > 0) parts.push(`${hidden} more`);
  return parts.join(" · ");
}

function WaitingCard({ lead, onSeeAll }) {
  const approvals = useApprovals("made", "pending");
  const rows = approvals.data?.results || [];
  const count = approvals.data?.count ?? rows.length;
  return (
    <section aria-label="Waiting for approval" style={card}>
      <CardHead title={`Waiting for ${lead || "your lead"}`} action={count > 0 ? "See all" : null} actionLabel="See all requests I made" onAction={onSeeAll} />
      {approvals.isLoading && <div style={dim}>Loading…</div>}
      {approvals.isError && <div role="alert" style={errorStyle}>Couldn't load your requests.</div>}
      {approvals.isSuccess && count === 0 && <div style={dim}>Nothing is waiting. Registrations and changes you send appear here until they are decided.</div>}
      {count > 0 && <div style={{ fontSize: "0.88rem", fontWeight: 600, color: D.text, ...figures }}>{waitingLine(rows, count)}</div>}
    </section>
  );
}

// "Adwoa Fabrics is at 2 of 3 — its overdue renewal would complete it."
export function bonusLine(row) {
  const head = `${row.business} is at ${row.paid_months} of 3`;
  const { state } = row;
  if (row.paid_months === 2) {
    if (state.kind === "overdue") return `${head} — its overdue renewal would complete it.`;
    if (state.kind === "next_renewal") return `${head} — its next renewal would complete it.`;
  }
  return `${head}.`;
}

function CommissionCard({ onOpen }) {
  const { data, isLoading, isError } = useMyCommission(1);
  const month = data?.statement?.to ? new Date(`${data.statement.to}T12:00:00`).toLocaleDateString("en-GB", { month: "long" }) : "";
  const policy = data?.policy;
  const noPolicy = policy && !policy.registration && !policy.three_paid_months_bonus;
  const nearest = data?.bonus?.length ? [...data.bonus].sort((a, b) => b.paid_months - a.paid_months)[0] : null;
  return (
    <section aria-label="My commission" style={card}>
      <CardHead title={month ? `My commission · ${month}` : "My commission"} action="Statement" actionLabel="Open the commission statement" onAction={onOpen} />
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Couldn't load your commission.</div>}
      {data && noPolicy && data.count === 0 && <div style={{ ...dim, lineHeight: 1.45 }}>No commission policy is approved yet, so nothing is earned yet.</div>}
      {data && !(noPolicy && data.count === 0) && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={dim}>On hold (90 days)</span>
              <span style={{ fontSize: "1.05rem", fontWeight: 800, color: D.text, ...figures }}>{`GH₵ ${data.totals.on_hold.amount}`}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={dim}>Approved to pay</span>
              <span style={{ fontSize: "1.05rem", fontWeight: 800, color: D.text, ...figures }}>{`GH₵ ${data.totals.payable.amount}`}</span>
            </div>
          </div>
          {nearest && <div style={{ ...dim, lineHeight: 1.45 }}><strong style={{ color: D.text }}>3-paid-months bonus:</strong>{` ${bonusLine(nearest)}`}</div>}
        </>
      )}
    </section>
  );
}

export default function ScoutTodayPanel({ auth, onNavigate, onCheckIn, onRegister, onSeeApprovals, onOpenBusiness }) {
  const user = auth.user || {};
  const first = user.full_name?.split(" ")[0] || "";
  const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const areas = Array.isArray(user.areas) ? user.areas.join(" & ") : "";
  const lead = user.manager?.full_name;
  const canCheckIn = auth.hasPermission("businesses.manage_portfolio") || auth.hasPermission("scouts.verify");
  const canRegister = auth.hasPermission("businesses.register");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div>
        <div style={eyebrow}>Today</div>
        <h2 style={{ color: D.text, fontSize: "1.4rem", fontWeight: 800, margin: "2px 0 0" }}>{`${greeting(new Date().getHours())}${first ? `, ${first}` : ""}`}</h2>
        <div style={{ ...dim, fontSize: "0.85rem" }}>{areas ? `${date} · ${areas}` : date}</div>
      </div>
      <TargetsCard lead={lead} onOpen={() => onNavigate("targets")} />
      <ActionsCard canCheckIn={canCheckIn} canRegister={canRegister} onCheckIn={onCheckIn} onRegister={onRegister} />
      <FollowUpsCard onOpenBusiness={onOpenBusiness} onOpen={() => onNavigate("tasks")} />
      <WaitingCard lead={lead} onSeeAll={onSeeApprovals} />
      <CommissionCard onOpen={() => onNavigate("commission")} />
    </div>
  );
}

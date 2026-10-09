import { Fragment, useState } from "react";
import { useSubscriptionsDue } from "../../../hooks/useSubscriptionsDue.js";
import { D } from "../theme.js";
import { button, callout, chip, dim, pill } from "./panelStyles.js";
import { FollowUpForm, card, errorStyle, formatDay, h2, h3, lastContactText, money } from "./portfolioParts.jsx";

// /staff/subscriptions-due (portfolio.manage): billing's overdue clock as
// Operations works it — overdue subscriptions in their 14-day grace (most
// urgent first), paused ones whose listings are hidden, and the ones paid in
// the last 7 days. Every date and count is the server's. Nobody here collects
// money: owners pay in the app, and payments stay simulated until Hubtel is
// connected. "Open" shows the business page under All portfolios.

const SCOPES = [["team", "My team"], ["all", "All businesses"]];
const CLOCK_STEPS = [
  ["Day 1 · overdue", "The owner is told in the app, and by email when they have one; a follow-up task goes to the account manager."],
  ["Days 1–14 · grace", "Listings stay live; the owner sees a renew banner."],
  ["Day 7 and day 13", "Reminders to the owner, and a task for the account manager."],
  ["After day 14 · paused", "Listings and events are hidden — not deleted."],
  ["Paid in the app", "The pause lifts at once and the listings reappear."],
];
// How the clock's notices reached this owner: email only when one is on file.
const noticeChannels = (ownerHasEmail) => (ownerHasEmail ? "In-app and email · SMS: not connected" : "In-app only · SMS: not connected");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const th = { padding: "6px 8px", textAlign: "left", color: D.textDim, fontSize: "0.7rem", fontWeight: 800, whiteSpace: "nowrap" };
const td = { padding: "8px", verticalAlign: "top", fontSize: "0.8rem", color: D.text };
const tableStyle = { borderCollapse: "collapse", width: "100%", minWidth: 640, fontVariantNumeric: "tabular-nums" };
const column = { display: "flex", flexDirection: "column", gap: 2 };

function planLine(sub) {
  return [
    sub?.plan_name ? `${sub.plan_name} plan` : null,
    sub?.monthly_price ? `${money(sub.monthly_price)} / month` : null,
    sub?.overdue_since ? `overdue since ${formatDay(sub.overdue_since)}` : null,
  ].filter(Boolean).join(" · ");
}

function clearedText(row) {
  const day = row.paid_on_day != null ? ` on day ${row.paid_on_day}` : "";
  return `${row.business_name} — paid in the app${day} (${formatDay(row.at)})`;
}

function Notices({ notices, ownerHasEmail }) {
  return (
    <div style={column}>
      {notices?.length
        ? notices.map((notice) => <div key={`${notice.label}-${notice.at}`}>{`${notice.label} · ${formatDay(notice.at)}`}</div>)
        : <div>None sent yet</div>}
      <div style={dim}>{noticeChannels(ownerHasEmail)}</div>
    </div>
  );
}

function Manager({ business }) {
  return (
    <div style={column}>
      {business.account_manager
        ? <div style={{ fontWeight: 700 }}>{business.account_manager.full_name}</div>
        : <span style={{ ...chip(D.amber), alignSelf: "flex-start" }}>No account manager</span>}
      <div style={dim}>{`Last contact: ${lastContactText(business.last_contact)}`}</div>
    </div>
  );
}

function DueTable({ label, rows, paused = false, auth, openId, toggle, onOpen, onCreated }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table aria-label={label} style={tableStyle}>
        <thead>
          <tr>
            <th style={th}>Business</th>
            <th style={th}>{paused ? "Paused" : "Overdue clock"}</th>
            <th style={th}>Notices sent to the owner</th>
            <th style={th}>Account manager</th>
            <th style={th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const sub = b.subscription || {};
            return (
              <Fragment key={b.id}>
                <tr style={{ borderTop: `1px solid ${D.divider}` }}>
                  <td style={td}>
                    <div style={{ fontWeight: 800 }}>{b.business_name}</div>
                    <div style={dim}>{planLine(sub)}</div>
                  </td>
                  <td style={td}>
                    {paused ? (
                      <div style={column}>
                        <div style={{ fontWeight: 800 }}>{`Paused since ${formatDay(sub.paused_at)}`}</div>
                        <div style={dim}>Listings and events hidden — not deleted</div>
                      </div>
                    ) : (
                      <div style={column}>
                        <div style={{ fontWeight: 800 }}>{sub.overdue_day != null ? `Day ${sub.overdue_day} of 14` : "Overdue"}</div>
                        {sub.hide_on && <div style={dim}>{`Listings hidden from ${formatDay(sub.hide_on)} if still unpaid`}</div>}
                      </div>
                    )}
                  </td>
                  <td style={td}><Notices notices={b.notices} ownerHasEmail={Boolean(b.owner_has_email)} /></td>
                  <td style={td}><Manager business={b} /></td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {onOpen && (
                        <button type="button" aria-label={`Open ${b.business_name}`} onClick={() => onOpen(b.id)} style={button(D.panelBg, D.text)}>Open</button>
                      )}
                      <button type="button" aria-label={`Create follow-up task for ${b.business_name}`} aria-expanded={openId === b.id}
                        onClick={() => toggle(b.id)} style={button(D.panelBg, D.text)}>Follow-up task</button>
                    </div>
                  </td>
                </tr>
                {openId === b.id && (
                  <tr>
                    <td colSpan={5} style={{ padding: "0 8px 10px" }}>
                      <FollowUpForm business={b} auth={auth} onCancel={() => toggle(b.id)} onDone={onCreated} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function SubscriptionsDuePanel({ auth, onOpenBusiness }) {
  const [scope, setScope] = useState(auth?.user?.role === "super_admin" ? "all" : "team");
  const [openId, setOpenId] = useState(null);
  const [status, setStatus] = useState(null);
  const { data, isLoading, isError, refetch } = useSubscriptionsDue(scope);
  const overdue = data?.overdue || [];
  const paused = data?.paused || [];
  const cleared = data?.cleared || [];
  const toggle = (id) => { setStatus(null); setOpenId((current) => (current === id ? null : id)); };
  const created = (message) => { setOpenId(null); setStatus(message); };
  const tableProps = { auth, openId, toggle, onOpen: onOpenBusiness, onCreated: created };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={card}>
        <h2 style={h2}>Subscriptions due</h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={chip(D.amber)}>Payments are simulated until Hubtel is connected</span>
          <span style={chip(D.blue)}>Owners pay in the app · scouts never collect cash</span>
        </div>
        <div role="group" aria-label="Which businesses" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {SCOPES.map(([id, text]) => (
            <button key={id} type="button" aria-pressed={scope === id} onClick={() => { setScope(id); setOpenId(null); }} style={pill(scope === id)}>{text}</button>
          ))}
        </div>
      </div>

      <div style={card}>
        <h3 style={h3}>The overdue clock</h3>
        <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", color: D.text }}>
          {CLOCK_STEPS.map(([when, what]) => <li key={when}><strong>{when}</strong>{` — ${what}`}</li>)}
        </ol>
        <div style={dim}>SMS isn't connected yet, so every notice goes in the app, and by email when the owner has one. Only a payment in the app clears the clock.</div>
      </div>

      {status && <div role="status" style={callout(D.green)}>{status}</div>}
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && (
        <div role="alert" style={{ ...card, ...errorStyle }}>
          Could not load subscriptions due.
          <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Try again</button>
        </div>
      )}

      {data && (
        <>
          <div style={card}>
            <h3 style={h3}>Overdue · listings still visible</h3>
            <div style={dim}>{overdue.length ? `${plural(overdue.length, "business", "businesses")} · most urgent first` : "No subscription is overdue right now."}</div>
            {overdue.length > 0 && <DueTable label="Overdue subscriptions" rows={overdue} {...tableProps} />}
          </div>
          <div style={card}>
            <h3 style={h3}>Paused · listings hidden</h3>
            <div style={dim}>{paused.length ? plural(paused.length, "business", "businesses") : "No business is paused."}</div>
            {paused.length > 0 && <DueTable label="Paused subscriptions" rows={paused} paused {...tableProps} />}
            <div style={dim}>Reversible: the moment the owner pays in the app, the pause lifts and the listings reappear.</div>
          </div>
          <div style={card}>
            <h3 style={h3}>Cleared this week</h3>
            {cleared.length === 0 ? (
              <div style={dim}>No overdue subscription was paid in the last 7 days.</div>
            ) : (
              <ul aria-label="Cleared this week" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", color: D.text }}>
                {cleared.map((row) => <li key={`${row.id}-${row.at}`}>{clearedText(row)}</li>)}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

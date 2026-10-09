import { useState } from "react";
import { useMyCommission } from "../../../hooks/useCommission.js";
import { D, glassCard } from "../theme.js";
import { button, dim } from "./panelStyles.js";
import { errorStyle, eyebrow, h3 } from "./portfolioParts.jsx";

// ─── 17 Commission ───────────────────────────────────────────────────────────
// A scout's own commission statement: four totals, the lines, and progress
// toward the 3-paid-months bonus for the businesses they manage. Every amount
// is the server's (GH₵ strings from an approved policy); with no policy the
// screen says nothing has been earned rather than showing zeros as a result.
// Payout batches aren't built yet, so nothing here says a line is "in a batch".
const figures = { fontVariantNumeric: "tabular-nums" };
const local = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(`${value}T12:00:00`) : new Date(value));
// Month names are spelled out here: ICU versions disagree on "Sep" and "Sept".
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const day = (value, opts = { day: "numeric", month: "short" }) => {
  const d = local(value);
  const name = (opts.month === "long" ? LONG : SHORT)[d.getMonth()];
  return `${d.getDate()} ${name}${opts.year ? ` ${d.getFullYear()}` : ""}`;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const STATUS_STYLE = {
  on_hold: ["#FBF3DC", "#6A4A00"],
  payable: ["#E3F1E3", "#00500A"],
  in_batch: ["#E3F1E3", "#00500A"],
  paid: ["#F1ECE4", "rgba(44,24,16,0.8)"],
  reversed: ["#FDE8E8", "#A30000"],
};

export function statementRange(statement) {
  if (!statement) return "";
  const from = local(statement.from), to = local(statement.to);
  const month = (d, withYear) => d.toLocaleDateString("en-GB", withYear ? { month: "long", year: "numeric" } : { month: "long" });
  if (from.getFullYear() === to.getFullYear() && from.getMonth() === to.getMonth()) return month(to, true);
  return `${month(from, from.getFullYear() !== to.getFullYear())} to ${month(to, true)}`;
}

export function statusText(line) {
  if (line.status === "on_hold") return `On hold until ${day(line.hold_until, { day: "numeric", month: "short", year: "numeric" })}`;
  if (line.status === "reversed") return `Reversed${line.reversed_label ? ` · ${line.reversed_label}` : ""}`;
  return line.status_label;
}

export function lineWhen(line) {
  if (line.status === "reversed" && line.reversed_at) return `reversed ${day(line.reversed_at)}`;
  return line.kind === "registration" ? `KYC approved ${day(line.earned_at)}` : `earned ${day(line.earned_at)}`;
}

export function bonusNote(row) {
  const { state, paid_months: paid } = row;
  if (state.kind === "trial_until") return [`On trial until ${day(state.date, { day: "numeric", month: "long" })} · trial months don’t count`, false];
  if (state.kind === "overdue") return [`Renewal overdue · day ${state.day}${paid === 2 ? " — paying it would complete the bonus" : ""}`, true];
  if (state.kind === "next_renewal") return [`Next renewal ${day(state.date, { day: "numeric", month: "long" })}`, false];
  return ["No subscription yet", false];
}

function Tile({ label, color, amount, sub }) {
  return (
    <div style={{ ...glassCard, borderRadius: 14, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: "0.75rem", fontWeight: 700, color }}>{label}</span>
      <span style={{ fontSize: "1.1rem", fontWeight: 800, color: D.text, ...figures }}>{`GH₵ ${amount}`}</span>
      <span style={{ fontSize: "0.7rem", fontWeight: 600, color: D.textDim }}>{sub}</span>
    </div>
  );
}

function tiles(totals) {
  const held = totals.on_hold;
  const heldSub = held.count === 0 ? "Nothing on hold"
    : [held.registrations && plural(held.registrations, "registration", "registrations"), held.bonuses && plural(held.bonuses, "bonus", "bonuses")].filter(Boolean).join(", ");
  const reasons = Object.entries(totals.reversed.reasons || {}).map(([label, n]) => `${n} ${label}`).join(", ");
  return [
    ["On hold", "#6A4A00", held.amount, heldSub],
    ["Approved to pay", "#00500A", totals.payable.amount, totals.payable.count ? `${plural(totals.payable.count, "line", "lines")} · payouts aren't set up yet` : "Nothing approved yet"],
    ["Paid", D.textDim, totals.paid.amount, totals.paid.count ? plural(totals.paid.count, "line", "lines") : "Nothing paid out yet"],
    ["Reversed", "#A30000", totals.reversed.amount, totals.reversed.count ? reasons || plural(totals.reversed.count, "line", "lines") : "None reversed"],
  ];
}

export default function CommissionPanel() {
  const [all, setAll] = useState(false);
  const { data, isLoading, isError, refetch } = useMyCommission(all ? 100 : 4);
  const policy = data?.policy;
  const noPolicy = policy && !policy.registration && !policy.three_paid_months_bonus;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <div>
        <div style={eyebrow}>Performance</div>
        <h2 style={{ color: D.text, fontSize: "1.4rem", fontWeight: 800, margin: "2px 0 0" }}>Commission</h2>
        {data && <div style={dim}>{`Statement · ${statementRange(data.statement)}`}</div>}
      </div>

      {isLoading && <div style={dim}>Loading…</div>}
      {isError && (
        <div role="alert" style={errorStyle}>
          Couldn't load your commission.{" "}
          <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button>
        </div>
      )}

      {data && (
        <>
          {noPolicy && (
            <div role="status" style={{ ...glassCard, padding: 14, fontSize: "0.85rem", color: D.text, lineHeight: 1.45 }}>
              No commission amounts are approved yet, so nothing has been earned.
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {tiles(data.totals).map(([label, color, amount, sub]) => <Tile key={label} label={label} color={color} amount={amount} sub={sub} />)}
          </div>

          <section aria-labelledby="commission-lines" style={{ ...glassCard, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 4 }}>
              <h3 id="commission-lines" style={{ ...h3, fontSize: "0.95rem" }}>Lines</h3>
              {data.count > 4 && (
                <button type="button" onClick={() => setAll((v) => !v)}
                  style={{ background: "none", border: 0, padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 700, color: D.deepGold }}>
                  {all ? "Show fewer" : `All ${data.count}`}
                </button>
              )}
            </div>
            {data.results.length === 0 && <div style={{ ...dim, padding: "8px 0" }}>No commission lines yet. A registration earns one when Operations approves its KYC.</div>}
            {data.results.map((line) => {
              const [bg, fg] = STATUS_STYLE[line.status] || STATUS_STYLE.paid;
              const reversed = line.status === "reversed";
              return (
                <div key={line.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 0", borderTop: `1px solid ${D.divider}` }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, fontSize: "0.88rem", color: D.text }}>{line.business}</span>
                    <span style={{ fontSize: "0.75rem", color: D.textDim }}>{`${line.kind_label} · ${lineWhen(line)}`}</span>
                    <span style={{ alignSelf: "flex-start", fontSize: "0.68rem", fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: bg, color: fg }}>{statusText(line)}</span>
                  </div>
                  <span style={{ fontSize: "0.95rem", fontWeight: 800, whiteSpace: "nowrap", color: reversed ? D.textDim : D.text, textDecoration: reversed ? "line-through" : "none", ...figures }}>{`GH₵ ${line.amount}`}</span>
                </div>
              );
            })}
          </section>

          <section aria-labelledby="commission-bonus" style={{ ...glassCard, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <h3 id="commission-bonus" style={{ ...h3, fontSize: "0.95rem" }}>
                {policy.three_paid_months_bonus ? `3-paid-months bonus · GH₵ ${policy.three_paid_months_bonus.amount}` : "3-paid-months bonus"}
              </h3>
              <span style={dim}>Goes to whoever manages the business when its 3rd month is paid.</span>
              {!policy.three_paid_months_bonus && <span style={dim}>No bonus amount is approved yet, so none can be earned.</span>}
            </div>
            {data.bonus.length === 0 && <div style={dim}>None of the businesses you manage are working toward this bonus yet.</div>}
            {data.bonus.map((row) => {
              const [note, warn] = bonusNote(row);
              return (
                <div key={row.business_id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.82rem" }}>
                    <span style={{ fontWeight: 700, color: D.text }}>{row.business}</span>
                    <span style={{ fontWeight: 800, color: D.text, ...figures }}>{`${row.paid_months} of 3 months`}</span>
                  </div>
                  <div role="img" aria-label={`${row.paid_months} of 3 months paid`} style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4 }}>
                    {[1, 2, 3].map((i) => <span key={i} style={{ height: 6, borderRadius: 999, background: i <= row.paid_months ? D.green : "#EADFC6" }} />)}
                  </div>
                  <span style={{ fontSize: "0.75rem", color: warn ? "#A33A00" : D.textDim }}>{note}</span>
                </div>
              );
            })}
            {data.bonus_more > 0 && <div style={dim}>{`and ${plural(data.bonus_more, "more business", "more businesses")}`}</div>}
          </section>

          <section aria-label="How commission works" style={{ background: "#F5ECD8", borderRadius: 16, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: "0.75rem", lineHeight: 1.45, color: D.text }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 800 }}>Scouts never collect cash.</div>
            <div>Owners pay their subscription in the app; you remind them and log the call. Payments are simulated until Hubtel is connected.</div>
            <div>Amounts come from the commission policy Super Admin approved. Each line is held 90 days and reversed if the business proves fake or a duplicate.</div>
            <div>Payout batches aren't set up yet, so nothing is paid out from this screen.</div>
          </section>
        </>
      )}
    </div>
  );
}

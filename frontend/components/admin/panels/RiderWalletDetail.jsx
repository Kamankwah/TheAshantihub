import { useStaffRiderWallet } from "../../../hooks/useStaffRiderMoney.js";
import { accraWhen, isBelowZero, percentFromBp } from "../../wallet/riderMoney.js";
import { walletMessage } from "../../wallet/walletErrors.js";
import { formatGhs, formatWhen, signedGhs } from "../../wallet/walletMoney.js";
import { D, glassCard } from "../theme.js";
import { button, chip, dim } from "./panelStyles.js";
import { scroll, table, td, th } from "./opsPeopleParts.jsx";
import { Title, page, sectionTitle } from "./insightsParts.jsx";
import { DaysTable, amount, employmentLabel } from "./riderMoneyParts.jsx";

// ─── One rider's wallet (staff, read-only) ───────────────────────────────────
// Everything is the server's: the summary, the last 20 earnings, 30 days and 20
// withdrawals (destination already masked). Nothing here changes money.
const has = (v) => v !== undefined && v !== null && v !== "";

function Figure({ label, children, note }) {
  return (
    <div style={{ ...glassCard, padding: 14, flex: "1 1 200px" }}>
      <div style={{ ...dim, fontSize: "0.7rem" }}>{label}</div>
      <div style={{ ...amount, fontSize: "1.2rem" }}>{children}</div>
      {note && <div style={{ ...dim, marginTop: 4 }}>{note}</div>}
    </div>
  );
}

function Section({ label, children }) {
  return (
    <section aria-label={label} style={{ ...glassCard, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={sectionTitle}>{label}</h3>
      {children}
    </section>
  );
}

export default function RiderWalletDetail({ riderId, onBack }) {
  const query = useStaffRiderWallet(riderId);
  const back = <button type="button" onClick={onBack} style={button(D.panelBg, D.text, false)}>Back to riders</button>;
  if (query.error) {
    const m = walletMessage(query.error);
    return (
      <div style={page}>
        <Title right={back}>Rider wallet</Title>
        <div role={m.kind === "off" ? "status" : "alert"} style={dim}>{m.text}</div>
      </div>
    );
  }
  const d = query.data;
  if (!d) {
    return <div style={page}><Title right={back}>Rider wallet</Title><div role="status" style={dim}>Loading…</div></div>;
  }
  const r = d.rider || {};
  const below = isBelowZero(d.balance);
  const count = has(d.withdrawals_per_day) && has(d.withdrawals_today);
  const resets = accraWhen(d.withdrawals_reset_at);
  const since = formatWhen(r.third_party_since);
  const earnings = d.earnings || [];
  const days = d.days || [];
  const withdrawals = d.withdrawals || [];

  return (
    <div style={page}>
      <Title right={back}>{r.name || `Rider ${riderId}`}</Title>
      <div style={dim}>
        {employmentLabel(r.employment)}
        {r.company_name ? ` · ${r.company_name}` : ""}
        {since ? ` · third-party since ${since}` : ""}
      </div>
      {below && r.employment === "ashantihub" && (
        <div role="note" style={{ ...glassCard, padding: 12, color: D.text, fontSize: "0.82rem" }}>
          This rider is now AshantiHub&apos;s own: nothing in the app collects a balance below zero.
        </div>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Figure label="Balance" note={d.balance_note}>
          {signedGhs(d.balance)}
          {below && <span style={{ ...chip(D.red), marginLeft: 8 }}>Below zero</span>}
        </Figure>
        <Figure label="Commission held" note={d.reserve_note}>{formatGhs(d.reserve)}</Figure>
        {has(d.commission_bp) && <Figure label="Commission rate">{percentFromBp(d.commission_bp)}</Figure>}
        {has(d.awaiting_release) && <Figure label="Awaiting release">{d.awaiting_release}</Figure>}
      </div>
      {count && (
        <div style={dim}>
          Withdrawals today: {d.withdrawals_today} of {d.withdrawals_per_day}.
          {resets ? ` The count starts again at ${resets}.` : ""}
        </div>
      )}

      <Section label="Earnings">
        {earnings.length === 0 ? <div style={dim}>No delivery has been paid to this wallet yet.</div> : (
          <div style={scroll}>
            <table style={table}>
              <thead><tr>{["Order", "Delivered", "Fee", "Commission", "Rider got", "Status"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {earnings.map((e) => (
                  <tr key={e.id}>
                    <td style={td}>{e.kind === "redelivery" ? `Re-delivery of order #${e.order}` : `Order #${e.order}`}</td>
                    <td style={td}>{formatWhen(e.delivered_at)}</td>
                    <td style={{ ...td, ...amount }}>{formatGhs(e.gross)}</td>
                    <td style={{ ...td, ...amount }}>{formatGhs(e.commission)}</td>
                    <td style={{ ...td, ...amount }}>{formatGhs(e.you_got)}</td>
                    <td style={td}>{e.status_label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section label="Days">
        {days.length === 0 ? <div style={dim}>No day has been posted yet.</div> : <DaysTable rows={days} />}
      </Section>

      <Section label="Withdrawals">
        {withdrawals.length === 0 ? <div style={dim}>This rider has made no withdrawal.</div> : (
          <div style={scroll}>
            <table style={table}>
              <thead><tr>{["Reference", "Amount", "Charge", "Rider receives", "Status", "Paid to"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>
                {withdrawals.map((w) => (
                  <tr key={w.id ?? w.reference}>
                    <td style={td}>{w.reference}</td>
                    <td style={{ ...td, ...amount }}>{formatGhs(w.amount)}</td>
                    <td style={{ ...td, ...amount }}>{formatGhs(w.fee)}</td>
                    <td style={{ ...td, ...amount }}>{formatGhs(w.net)}</td>
                    <td style={td}>{w.status_label}</td>
                    <td style={td}>{w.destination?.account_number_masked}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

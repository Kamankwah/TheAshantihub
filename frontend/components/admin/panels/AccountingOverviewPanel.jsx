import { useAccountingOverview } from "../../../hooks/useInsights.js";
import { D, glassCard } from "../theme.js";
import { button, chip, dim } from "./panelStyles.js";
import { figures, scroll, table, td, th, timeShort } from "./opsPeopleParts.jsx";
import { errorStyle, eyebrow, h2, money } from "./portfolioParts.jsx";
import { NotRecorded, SimulatedBanner, section, sectionTitle } from "./insightsParts.jsx";

// ─── Accounting 01 Money desk ────────────────────────────────────────────────
// Everything comes from GET /api/insights/accounting-overview/: event ticket money
// held, scout commission by status, revenue by type this month before tax, refunds,
// disputes and approvals waiting, and the last staff-activity chain check. The
// canvas also draws what is owed to sellers, riders and scouts, the customer funds
// account, taxes due, payroll and reconciliation; no record backs those, so they
// are listed under "Not recorded yet" and never drawn as figures.
function Tile({ label, value, sub, subColor, onClick }) {
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

const warn = D.warnInk;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export default function AccountingOverviewPanel({ auth, onNavigate }) {
  const { data, isLoading, isError, refetch } = useAccountingOverview();
  const now = data ? new Date(data.now) : new Date();
  const dateLine = `${now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${timeShort(now)}${auth?.user?.full_name ? ` · ${auth.user.full_name}` : ""}`;
  const go = (id) => () => onNavigate?.(id);
  const chain = data?.chain;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={eyebrow}>{dateLine}</div>
        <h2 style={{ ...h2, fontSize: "1.4rem", margin: "2px 0 0" }}>Money desk</h2>
      </div>
      {isLoading && <div role="status" style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Couldn't load the money desk. <button type="button" onClick={() => refetch()} style={button(D.panelBg, D.text)}>Try again</button></div>}
      {data && (
        <>
          <SimulatedBanner simulated={data.simulated}>Every figure comes from simulated payments.</SimulatedBanner>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
            <Tile label="Ticket money held" value={money(data.tickets.held)} sub={`${plural(data.tickets.held_count, "ticket", "tickets")} in escrow. Orders and bookings are not held.`} onClick={go("escrow")} />
            <Tile label="Commission on hold" value={money(data.commission.on_hold.amount)} sub={`${plural(data.commission.on_hold.count, "line", "lines")}, ${money(data.commission.payable.amount)} approved to pay`} onClick={go("commissions")} />
            <Tile label="Revenue this month" value={money(data.revenue.total)} sub="Before tax. Plan fees, promotions, hero and event fees" onClick={go("acct-statements")} />
            <Tile label="Refunds this month" value={money(data.refunds.amount)} sub={plural(data.refunds.count, "recorded refund", "recorded refunds")} onClick={go("refunds")} />
            <Tile label="Disputes waiting" value={`${data.disputes_waiting}`} sub={data.disputes_waiting ? "Open or being investigated" : "None waiting"} subColor={data.disputes_waiting ? warn : undefined} onClick={go("disputes")} />
            <Tile label="Decisions waiting" value={`${data.approvals_waiting}`} sub={data.approvals_waiting ? "Requests waiting for you" : "Nothing waiting"} subColor={data.approvals_waiting ? warn : undefined} onClick={go("approvals")} />
          </div>

          <section aria-labelledby="ad-revenue" style={section}>
            <h3 id="ad-revenue" style={sectionTitle}>Revenue by type, this month so far</h3>
            <div style={scroll}>
              <table style={table}>
                <thead><tr><th scope="col" style={th}>Type</th><th scope="col" style={{ ...th, textAlign: "right" }}>Amount, before tax</th></tr></thead>
                <tbody>
                  {data.revenue.types.map((t) => (
                    <tr key={t.key}><td style={{ ...td, fontWeight: 800 }}>{t.label}</td><td style={{ ...td, ...figures, textAlign: "right" }}>{money(t.amount)}</td></tr>
                  ))}
                  <tr><td style={{ ...td, fontWeight: 800 }}>Total</td><td style={{ ...td, ...figures, textAlign: "right", fontWeight: 800 }}>{money(data.revenue.total)}</td></tr>
                </tbody>
              </table>
            </div>
            <span style={dim}>No VAT, NHIL or GETFund is calculated, so none is taken off.</span>
          </section>

          <section aria-labelledby="ad-controls" style={section}>
            <h3 id="ad-controls" style={sectionTitle}>Controls</h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: D.text, fontSize: "0.85rem", fontWeight: 700 }}>Staff activity chain</span>
              {chain.checked
                ? <span style={chip(chain.ok ? D.green : D.red)}>{chain.ok ? "Intact" : "Broken"}</span>
                : <span style={chip(D.textFaint)}>Not checked yet</span>}
              <span style={dim}>
                {chain.checked
                  ? `Last checked ${new Date(chain.checked_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} over ${chain.events.toLocaleString("en-GB")} events.`
                  : "The nightly check has not run yet."}
              </span>
              <button type="button" onClick={go("acct-audit-chain")} style={button(D.panelBg, D.text)}>Audit chain</button>
            </div>
            <span style={dim}>This is the log of what staff did. The money ledger does not exist yet, so it has no chain of its own.</span>
          </section>

          <NotRecorded title="Not recorded yet" items={data.not_recorded} />
        </>
      )}
    </div>
  );
}

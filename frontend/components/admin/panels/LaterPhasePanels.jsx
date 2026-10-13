import { usePayoutsOverview, useTaxRuling } from "../../../hooks/useSettingsScreens.js";
import { D } from "../theme.js";
import { button, callout, dim } from "./panelStyles.js";
import { scroll, table, td, th } from "./opsPeopleParts.jsx";
import { money } from "./portfolioParts.jsx";
import { Kpi, NotRecorded, SimulatedBanner, Status, Title, kpiGrid, page, section, sectionTitle } from "./insightsParts.jsx";

// ─── Money and Settings screens whose records belong to a later phase ────────
// Payouts & payroll, Reconciliation, Delivery pricing and Tax tables are drawn
// in the approved menu, but no payout, payroll, rate-card, ledger or tax record
// exists yet. Each shows its place, the few real records that do exist, and a
// plain statement of when the rest arrives. No rate, balance, run or tax is
// invented, and nothing here calculates tax.
function Arrives({ phase, children }) {
  return (
    <div role="status" style={callout(D.amber)}>
      Arrives with the {phase} phase. {children} Nothing on this screen is invented: where AshantiHub has no record it says so.
    </div>
  );
}

export function PayoutsPayrollPanel({ onNavigate }) {
  const overview = usePayoutsOverview();
  const data = overview.data;
  const c = data?.commission;
  const t = data?.tickets;
  return (
    <div style={page}>
      <Title>Payouts &amp; payroll</Title>
      <SimulatedBanner simulated={data?.simulated}>No money moves through AshantiHub yet, so there is nothing to pay out.</SimulatedBanner>
      <Arrives phase="Accounting">Accounting will prepare payroll, commission and seller payouts, you will approve them with your password, and above GH₵ 20,000.00 the named co-signer approves too.</Arrives>
      <Status isLoading={overview.isLoading} isError={overview.isError}>
        {data && (
          <>
            <section aria-labelledby="po-commission" style={section}>
              <h3 id="po-commission" style={sectionTitle}>Scout commission, by status</h3>
              <div style={kpiGrid}>
                <Kpi label="On hold" value={money(c.on_hold.amount)} sub={`${c.on_hold.count} line${c.on_hold.count === 1 ? "" : "s"}, held 90 days`} />
                <Kpi label="Approved to pay" value={money(c.payable.amount)} sub={`${c.payable.count} line${c.payable.count === 1 ? "" : "s"}, not yet in a batch`} />
                <Kpi label="In a payout batch" value="None yet" sub="No batch has been formed" />
                <Kpi label="Paid" value="None yet" sub="No payout has been recorded" />
              </div>
              {data.payout_blocker && <div role="alert" style={callout(D.amber)}>{data.payout_blocker}</div>}
              {onNavigate && <button type="button" onClick={() => onNavigate("commission-policy")} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Open Commission policy</button>}
            </section>
            <section aria-labelledby="po-tickets" style={section}>
              <h3 id="po-tickets" style={sectionTitle}>Event ticket money</h3>
              <span style={dim}>The only money AshantiHub holds and releases today is ticket money kept in escrow. These are simulated payments.</span>
              <div style={kpiGrid}>
                <Kpi label="Held in escrow" value={money(t.held)} sub={`${t.held_count} ticket${t.held_count === 1 ? "" : "s"}`} />
                <Kpi label="Released to organisers" value={money(t.released)} sub={`${t.released_count} ticket${t.released_count === 1 ? "" : "s"} · ${money(t.released_this_month)} this month`} />
                <Kpi label="Refunded" value={money(t.refunded)} sub={`${t.refunded_count} ticket${t.refunded_count === 1 ? "" : "s"}`} />
              </div>
            </section>
            <NotRecorded title="Not recorded yet" items={data.not_recorded} />
          </>
        )}
      </Status>
    </div>
  );
}

export function ReconciliationPanel() {
  return (
    <div style={page}>
      <Title>Reconciliation</Title>
      <Arrives phase="Accounting">The daily three-way check needs Hubtel live, the ledger it will compare against, and the bank and mobile money statements Accounting uploads.</Arrives>
      <NotRecorded title="Not available yet" items={[
        { name: "Matched and unmatched lines", why: "There is no Hubtel settlement file, bank statement or ledger to compare, so no match rate is shown." },
        { name: "Unmatched items by age", why: "Nothing has been compared, so nothing is waiting." },
        { name: "Last check", why: "No daily check has ever run." },
      ]} />
    </div>
  );
}

export function DeliveryPricingPanel() {
  return (
    <div style={page}>
      <Title>Delivery pricing</Title>
      <Arrives phase="Delivery">Accounting and Delivery will propose a rate card, and you will approve it here before it goes live.</Arrives>
      <section aria-labelledby="dp-decided" style={section}>
        <h3 id="dp-decided" style={sectionTitle}>Decided</h3>
        <span style={{ color: D.text, fontSize: "0.85rem" }}>Delivery fees carry no VAT, NHIL or GETFund. This is your recorded decision; the full list is under Tax tables.</span>
      </section>
      <NotRecorded title="Not set up yet" items={[
        { name: "Rate card", why: "No base fee, per-kilometre rate or minimum has been set, and orders do not carry a delivery fee." },
        { name: "Rider earnings", why: "No rider rate exists, so nothing is paid to riders." },
        { name: "Margin", why: "There are no priced deliveries to measure a margin on." },
        { name: "Try a route", why: "No road-distance service is connected yet (see Integrations)." },
      ]} />
    </div>
  );
}

const DECISIONS = [
  { name: "Delivery fee", tax: "No VAT, NHIL or GETFund", who: "Decided by you. Kept as a setting for each charge.", decided: true },
  { name: "Subscription plans", tax: "To confirm", who: "Waiting for the accountant." },
  { name: "Promotions and event visibility", tax: "To confirm", who: "Waiting for the accountant." },
  { name: "Commission on scouts' registrations", tax: "Scouts' tax status: see Commission policy", who: "Waiting for an accountant or GRA ruling.", link: true },
  { name: "Item prices set by sellers", tax: "The seller's own VAT", who: "Not AshantiHub's charge." },
];

export function TaxTablesPanel({ onNavigate }) {
  const ruling = useTaxRuling();
  const current = ruling.data?.current;
  return (
    <div style={page}>
      <Title>Tax tables</Title>
      <div role="status" style={callout(D.amber)}>No tax is calculated anywhere in AshantiHub yet. No PAYE, SSNIT, withholding or VAT rate is stored, because none has been confirmed by the accountant. Rates marked "to confirm" are not used.</div>
      <section aria-labelledby="tt-charges" style={section}>
        <h3 id="tt-charges" style={sectionTitle}>Tax on each kind of charge</h3>
        <div style={scroll}>
          <table style={table}>
            <thead><tr><th style={th}>Charge</th><th style={th}>Tax</th><th style={th}>Decided by</th></tr></thead>
            <tbody>
              {DECISIONS.map((row) => (
                <tr key={row.name}>
                  <td style={{ ...td, fontWeight: 800 }}>{row.name}</td>
                  <td style={td}>
                    {row.link && current
                      ? `${current.status_label} (ruling ${current.reference})`
                      : row.tax}
                    {row.link && onNavigate && <> <button type="button" onClick={() => onNavigate("commission-policy")} style={{ ...button(D.panelBg, D.text), padding: "3px 10px", fontSize: "0.7rem" }}>Commission policy</button></>}
                  </td>
                  <td style={td}>{row.link && current ? `Recorded ${new Date(current.ruled_on).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : row.who}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <Arrives phase="Accounting">Dated rate tables for PAYE, SSNIT, withholding tax and VAT are entered there, each proposed by Accounting and approved by you, with its source and start date.</Arrives>
    </div>
  );
}


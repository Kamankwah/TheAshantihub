import { usePayoutsOverview, useTaxRuling } from "../../../hooks/useSettingsScreens.js";
import { D } from "../theme.js";
import { dim } from "./panelStyles.js";
import { scroll, table, td, th } from "./opsPeopleParts.jsx";
import { money } from "./portfolioParts.jsx";
import { Kpi, NotRecorded, SimulatedBanner, Status, Title, kpiGrid, page, section, sectionTitle } from "./insightsParts.jsx";
import { Arrives, DECISIONS } from "./LaterPhasePanels.jsx";

// ─── The Accountant's screens whose records belong to the Accounting phase ───
// The approved canvas draws a double-entry ledger, payout runs, payroll and the
// tax schedules. AshantiHub has no ledger, journal, chart of accounts, payout,
// settlement, rider-pay, payroll, pay-profile, tax or period record, and the owner
// has said none is invented. Each such screen therefore opens in its place in the
// menu, says what arrives and why it is not here yet, shows the few real records
// that exist (`real`), and lists what it cannot show under "Not available yet".
// Nothing on these screens calculates a figure.
const NO_LEDGER = "There is no ledger, so ";

export const ACCOUNTING_SHELLS = {
  "acct-journal": {
    title: "Journal",
    arrives: "Every ledger entry, with its maker, checker, hash and source, and the form for a manual entry.",
    items: [
      { name: "Journal entries", why: `${NO_LEDGER}no entry has ever been posted and none can be listed.` },
      { name: "New journal entry", why: "A manual entry needs the ledger and the chart of accounts. The form is not offered, so nothing implies books that do not exist." },
      { name: "Hash of each entry", why: "Entries do not exist. The hash chain that does exist is the staff activity chain, shown under Audit chain." },
    ],
  },
  "acct-chart": {
    title: "Chart of accounts",
    arrives: "Assets, liabilities, equity, revenue and expenses with live balances.",
    items: [
      { name: "Accounts and balances", why: "No account list has been agreed, so none is shown. Seeding one would imply a books structure that has not been specified." },
    ],
  },
  "acct-trial-balance": {
    title: "Trial balance",
    arrives: "Proof that debits equal credits for a chosen date or period.",
    items: [
      { name: "Debits and credits", why: `${NO_LEDGER}there is nothing to total and nothing to prove.` },
    ],
  },
  "acct-payout-runs": {
    title: "Payout runs",
    arrives: "Seller settlements, rider payouts and commission batches, from prepared to approved to released.",
    real: "payouts",
    items: [
      { name: "Runs", why: "No payout run has ever been prepared. \"Prepare a run\" is not offered." },
      { name: "Verified payout accounts", why: "Businesses' payout details are held for checks on their own record; no run reads them." },
      { name: "Cooling-off after a payout account change", why: "Payout-account changes carry no change record, so the 72-hour pause cannot be applied." },
    ],
  },
  "acct-settlements": {
    title: "Seller settlements",
    arrives: "Each seller's statement: sales released from escrow, refunds and what is owed.",
    real: "tickets",
    items: [
      { name: "What is owed to each seller", why: "Order and booking money is not held in escrow and sellers are not paid through AshantiHub, so nothing is owed on record." },
      { name: "Seller statements", why: "A statement needs released sales by seller. Only event ticket money has a release record." },
    ],
  },
  "acct-rider-payouts": {
    title: "Rider payouts",
    arrives: "Rider earnings per job, per kilometre and waiting time, netted against cash-on-delivery money held.",
    items: [
      { name: "Rider earnings", why: "No rider rate exists and orders carry no delivery fee." },
      { name: "Cash on delivery held", why: "Cash collected by riders is not recorded, so there is nothing to net against." },
    ],
  },
  "acct-payroll": {
    title: "Payroll",
    arrives: "A monthly run for staff through prepared, checked, approved and released, with a payslip per person.",
    items: [
      { name: "Payroll run and register", why: "No payroll, pay profile or payslip record exists, and no PAYE or SSNIT is calculated." },
      { name: "Payslips", why: "A payslip needs a pay profile. None exists, so none can be shown or sent." },
    ],
  },
  "acct-pay-profiles": {
    title: "Pay profiles",
    arrives: "Each staff member's pay set-up and a masked, verified payout account.",
    real: "ruling",
    items: [
      { name: "Basic pay, allowances, SSNIT number, TIN", why: "AshantiHub holds no staff pay fields. They are not added without a payroll specification." },
      { name: "Staff payout accounts", why: "Only businesses have payout details on record; staff do not." },
    ],
  },
  "acct-paye": {
    title: "PAYE",
    arrives: "PAYE bands by effective date and each month's schedule for the tax return.",
    items: [
      { name: "Bands and monthly schedule", why: "No tax rate is stored because none has been confirmed by the accountant, and there is no payroll to apply it to. Researched rates are not data." },
    ],
  },
  "acct-ssnit": {
    title: "SSNIT & Tier 2",
    arrives: "Pension contributions per employee and the split between Tier 1 and Tier 2.",
    items: [
      { name: "Contributions and schedules", why: "There is no payroll, so no contribution exists, and no rate is stored." },
    ],
  },
  "acct-wht": {
    title: "Withholding tax",
    arrives: "Tax withheld by payee type, the return and credit certificates.",
    real: "ruling",
    items: [
      { name: "Withheld tax and certificates", why: "No payouts are made through AshantiHub, so nothing is withheld. Scouts' tax status is still unresolved (see the ruling above), which blocks scout payouts." },
    ],
  },
  "acct-vat": {
    title: "VAT, NHIL, GETFund",
    arrives: "Output and input tax by charge type and the monthly return figures.",
    decided: true,
    items: [
      { name: "Output and input tax", why: "No tax is calculated on any payment, and no payment is split into tax. Whether VAT applies to subscriptions, promotions and event fees waits for the accountant." },
    ],
  },
  "acct-tax-settings": {
    title: "Tax settings",
    arrives: "Tax treatment for each kind of charge and every rate by effective date, proposed here and approved by the Super Admin.",
    decided: true,
    items: [
      { name: "Rates by effective date", why: "No tax table exists. \"Propose a change\" is not offered because there is no rate to change." },
    ],
  },
  "acct-period-close": {
    title: "Period close",
    arrives: "A month-end checklist and locked months.",
    items: [
      { name: "Checklist and locked months", why: `${NO_LEDGER}there is no month to lock, and the checks it depends on (reconciliation, tax schedules) do not exist.` },
    ],
  },
};

function Real({ kind }) {
  return kind === "ruling" ? <RulingBlock /> : <PayoutsBlock kind={kind} />;
}

function RulingBlock() {
  const ruling = useTaxRuling();
  const current = ruling.data?.current;
  return (
    <section aria-labelledby="as-ruling" style={section}>
      <h3 id="as-ruling" style={sectionTitle}>Scouts' tax status</h3>
      <Status isLoading={ruling.isLoading} isError={ruling.isError}>
        {current
          ? <span style={{ color: D.text, fontSize: "0.85rem" }}><strong>{current.status_label}</strong> · ruling {current.reference}, {new Date(`${current.ruled_on}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
          : <span style={{ color: D.text, fontSize: "0.85rem" }}>{ruling.data?.blocked_message || "No ruling has been recorded."}</span>}
      </Status>
      <span style={dim}>The Super Admin records this ruling, under Commission policy. You can read it here.</span>
    </section>
  );
}

function PayoutsBlock({ kind }) {
  const overview = usePayoutsOverview();
  const data = overview.data;
  return (
    <Status isLoading={overview.isLoading} isError={overview.isError}>
      {data && (
        <>
          <SimulatedBanner simulated={data.simulated}>These figures come from simulated payments.</SimulatedBanner>
          {kind === "payouts" && (
            <section aria-labelledby="as-commission" style={section}>
              <h3 id="as-commission" style={sectionTitle}>Scout commission, by status</h3>
              <div style={kpiGrid}>
                <Kpi label="On hold" value={money(data.commission.on_hold.amount)} sub={`${data.commission.on_hold.count} line${data.commission.on_hold.count === 1 ? "" : "s"}, held 90 days`} />
                <Kpi label="Approved to pay" value={money(data.commission.payable.amount)} sub={`${data.commission.payable.count} line${data.commission.payable.count === 1 ? "" : "s"}, not yet in a batch`} />
                <Kpi label="In a payout batch" value="None yet" sub="No batch has been formed" />
                <Kpi label="Paid" value="None yet" sub="No payout has been recorded" />
              </div>
              {data.payout_blocker && <span style={dim}>{data.payout_blocker}</span>}
            </section>
          )}
          <section aria-labelledby="as-tickets" style={section}>
            <h3 id="as-tickets" style={sectionTitle}>Event ticket money</h3>
            <span style={dim}>The only money AshantiHub holds and releases today. These are simulated payments.</span>
            <div style={kpiGrid}>
              <Kpi label="Held in escrow" value={money(data.tickets.held)} sub={`${data.tickets.held_count} ticket${data.tickets.held_count === 1 ? "" : "s"}`} />
              <Kpi label="Released to organisers" value={money(data.tickets.released)} sub={`${data.tickets.released_count} ticket${data.tickets.released_count === 1 ? "" : "s"} · ${money(data.tickets.released_this_month)} this month`} />
              <Kpi label="Refunded" value={money(data.tickets.refunded)} sub={`${data.tickets.refunded_count} ticket${data.tickets.refunded_count === 1 ? "" : "s"}`} />
            </div>
          </section>
        </>
      )}
    </Status>
  );
}

function Decided() {
  return (
    <section aria-labelledby="as-decided" style={section}>
      <h3 id="as-decided" style={sectionTitle}>Tax on each kind of charge, as recorded</h3>
      <div style={scroll}>
        <table style={table}>
          <thead><tr><th style={th}>Charge</th><th style={th}>Tax</th><th style={th}>Decided by</th></tr></thead>
          <tbody>
            {DECISIONS.map((row) => (
              <tr key={row.name}><td style={{ ...td, fontWeight: 800 }}>{row.name}</td><td style={td}>{row.tax}</td><td style={td}>{row.who}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <span style={dim}>Rows marked "to confirm" are not used anywhere. No tax is calculated.</span>
    </section>
  );
}

export default function AccountingShellPanel({ id }) {
  const shell = ACCOUNTING_SHELLS[id];
  if (!shell) return null;
  return (
    <div style={page}>
      <Title>{shell.title}</Title>
      <Arrives phase="Accounting">{shell.arrives}</Arrives>
      {shell.decided && <Decided />}
      {shell.real && <Real kind={shell.real} />}
      <NotRecorded title="Not available yet" items={shell.items} />
    </div>
  );
}

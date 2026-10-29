import { useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useDeliveryCash, useDeliveryPayoutLines, useDeliveryPayouts } from "../../../../hooks/useDelivery.js";
import { formatGhs } from "../../../wallet/walletMoney.js";
import { D } from "../../theme.js";
import { button, chip, dim, field } from "../panelStyles.js";
import { scroll, table, td, th } from "../opsPeopleParts.jsx";
import { Kpi, Status, Title, kpiGrid, page, section, sectionTitle } from "../insightsParts.jsx";
import { labelled } from "./ConfigScreen.jsx";
import { Empty, ErrorLine, Note, WARN, dayTime, linkStyle, money } from "./deliveryParts.jsx";

// ─── Delivery Manager 14 Cash on delivery and 15 Rider payouts ───────────────
// Cash on delivery is not offered at checkout yet, so no rider holds cash and the screen says
// so; the hand-over form works the day a job carries cash and refuses a rider who holds none.
// Rider pay is what each delivered job earned under the rate card in force: a record, not a
// payment. Payout runs, tax and bank matching belong to Accounting and are not connected.
export function CashPanel() {
  const { data, isLoading, isError, refetch } = useDeliveryCash();
  const [rider, setRider] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const confirm = async () => {
    setError("");
    setDone("");
    try {
      const out = await apiPost("/api/delivery/cash/", { rider: Number(rider), counted, note });
      setDone(`Recorded: expected ${money(out.expected)}, counted ${money(out.counted)}${Number(out.difference) < 0 ? `, short by ${money(-Number(out.difference))}` : ""}.`);
      setCounted("");
      setNote("");
      refetch();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not record the hand-over."));
    }
  };
  const holders = data ? data.riders.filter((r) => Number(r.holding) > 0) : [];
  return (
    <div style={page}>
      <Title right={data && <span style={chip(D.textDim)}>Cap per rider {money(data.cap.amount)} · hand in by the end of every shift</span>}>Cash on delivery</Title>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            {!data.cod.offered && <Note tone="warn">{data.cod.note} Everything below will fill in when cash orders exist.</Note>}
            <div style={kpiGrid}>
              <Kpi label="Riders holding cash" value={holders.length} />
              <Kpi label="Over the cap" value={data.over_cap} subColor={data.over_cap ? WARN : undefined} sub={data.over_cap ? "No new cash jobs until they hand in" : undefined} />
              <Kpi label="Cash cap" value={money(data.cap.amount)} sub={data.cap.source === "version" ? `rules version ${data.cap.version}` : "built-in default"} />
              <Kpi label="Shortfalls recorded" value={data.shortfalls.length} />
            </div>
            <section aria-labelledby="held" style={section}>
              <h3 id="held" style={sectionTitle}>Held now, per rider</h3>
              {data.riders.length === 0 ? <Empty>No rider exists yet.</Empty> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Rider", "Held now", "Status"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>{data.riders.map((r) => <tr key={r.id}><td style={{ ...td, fontWeight: 700 }}>{r.full_name}</td><td style={td}>{money(r.holding)}</td><td style={td}>{r.over_cap ? <span style={chip(D.red)}>Over the cap</span> : Number(r.holding) > 0 ? <span style={chip(D.amber)}>Holding cash</span> : <span style={dim}>Nothing held</span>}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </section>
            <section aria-label="Count a hand-over" style={section}>
              <h3 style={sectionTitle}>Count a hand-over</h3>
              <ErrorLine>{error}</ErrorLine>
              {done && <div role="status" style={{ color: D.green, fontWeight: 700, fontSize: "0.8rem" }}>{done}</div>}
              {holders.length === 0 ? <span style={{ fontSize: "0.82rem", color: D.text }}>No rider holds cash, so there is nothing to count.</span> : (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                  {labelled("Rider", <select value={rider} onChange={(e) => setRider(e.target.value)} style={field}><option value="">Choose a rider</option>{holders.map((r) => <option key={r.id} value={r.id}>{r.full_name} · holds {money(r.holding)}</option>)}</select>)}
                  {labelled("Amount you counted (GH₵)", <input aria-label="Amount you counted (GH₵)" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} style={{ ...field, maxWidth: 140 }} />)}
                  {labelled("Note (needed for a shortfall)", <input value={note} onChange={(e) => setNote(e.target.value)} style={field} />)}
                  <button type="button" disabled={!rider || !counted} onClick={confirm} style={button(D.gold, D.text, !rider || !counted)}>Confirm</button>
                </div>
              )}
              <span style={dim}>You will be asked for your password. A shortfall tells the rider&apos;s manager and every Super Admin. This is a count of cash, not a ledger; matching hand-overs to bank deposits is not connected.</span>
            </section>
            <section aria-labelledby="recent" style={section}>
              <h3 id="recent" style={sectionTitle}>Recent hand-overs</h3>
              {data.handovers.length === 0 ? <Empty>No hand-over has been counted.</Empty> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["When", "Rider", "Expected", "Counted", "Difference", "Counted by"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>{data.handovers.map((h) => <tr key={h.id}><td style={td}>{dayTime(h.at)}</td><td style={td}>{h.rider}</td><td style={td}>{money(h.expected)}</td><td style={td}>{money(h.counted)}</td><td style={{ ...td, color: Number(h.difference) < 0 ? WARN : D.text, fontWeight: 700 }}>{money(h.difference)}{h.note && <div style={dim}>{h.note}</div>}</td><td style={td}>{h.counted_by}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </section>
            <section aria-labelledby="how" style={section}>
              <h3 id="how" style={sectionTitle}>How cash works</h3>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.82rem", color: D.text, lineHeight: 1.6 }}>
                <li>A rider holds at most {money(data.cap.amount)} from cash orders. Over that, auto-assign leaves them out of new jobs until they hand in.</li>
                <li>Cash is handed in at the end of every shift and counted by you. Scouts never collect cash.</li>
                <li>A shortfall needs a note and is told to the rider&apos;s manager and every Super Admin.</li>
              </ul>
            </section>
          </>
        )}
      </Status>
    </div>
  );
}

function Lines({ staffId, weeks, onClose }) {
  const { data, isLoading, isError } = useDeliveryPayoutLines(staffId, weeks);
  return (
    <section aria-label="Lines behind the total" style={section}>
      <div style={{ display: "flex", justifyContent: "space-between" }}><h3 style={sectionTitle}>Lines behind the total</h3><button type="button" onClick={onClose} style={linkStyle}>Close</button></div>
      <Status isLoading={isLoading} isError={isError}>
        {data && (data.results.length === 0 ? <Empty>No delivered job in this period.</Empty> : (
          <div style={scroll}>
            <table style={table}>
              <thead><tr>{["Order", "Delivered", "Pay", "How it was worked out"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
              <tbody>{data.results.map((l) => (
                <tr key={l.assignment_id}>
                  <td style={td}>#{l.order_id}</td><td style={td}>{dayTime(l.delivered_at)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{l.pay === null ? "Not recorded" : money(l.pay)}{l.wait_pay_held && <div style={{ ...dim, color: WARN }}>Waiting pay held</div>}</td>
                  <td style={td}>{l.breakdown?.lines ? l.breakdown.lines.map((x) => `${x.label} ${money(x.amount)}`).join(" + ") : <span style={dim}>No rate card was in force, or the route could not be measured.</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ))}
      </Status>
      {data?.redeliveries?.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          <h4 style={sectionTitle}>Re-delivery trips</h4>
          <div style={scroll}>
            <table style={table}>
              <thead><tr>{["Order", "Trip", "Done", "Fee owed"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
              <tbody>{data.redeliveries.map((r) => (
                <tr key={r.id}>
                  <td style={td}>#{r.order}</td><td style={td}>Re-delivery {r.attempt}</td><td style={td}>{dayTime(r.completed_at)}</td>
                  <td style={{ ...td, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatGhs(r.fee)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

export function PayoutsPanel() {
  const [weeks, setWeeks] = useState(2);
  const [open, setOpen] = useState(null);
  const { data, isLoading, isError } = useDeliveryPayouts(weeks);
  return (
    <div style={page}>
      <Title right={(
        <label style={{ fontSize: "0.7rem", fontWeight: 700, color: D.text, display: "flex", flexDirection: "column", gap: 2 }}>Period
          <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} style={field}>{[[1, "Last 7 days"], [2, "Last 2 weeks"], [4, "Last 4 weeks"], [12, "Last 12 weeks"]].map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>
        </label>
      )}>Rider payouts</Title>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <Note tone="warn">{data.payout.note} Payments are simulated until Hubtel is connected.</Note>
            <section aria-labelledby="earned" style={section}>
              <h3 id="earned" style={sectionTitle}>What each rider earned</h3>
              {!data.card && <Note>No rate card is in force, so no job has recorded any pay. Pay appears here after a delivery completes under an approved rate card.</Note>}
              {data.riders.length === 0 ? <Empty>No job was delivered in this period.</Empty> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Rider", "Jobs", "Jobs with pay recorded", "Earned"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>{data.riders.map((r) => (
                      <tr key={r.staff_id}>
                        <td style={td}><button type="button" onClick={() => setOpen(open === r.staff_id ? null : r.staff_id)} style={linkStyle}>{r.full_name}</button></td>
                        <td style={td}>{r.jobs}</td><td style={td}>{r.jobs_with_pay}</td>
                        <td style={{ ...td, fontWeight: 800 }}>{r.earned === null ? "Not recorded" : money(r.earned)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              <span style={dim}>Pay for a job is recorded when it is delivered, from the rate card in force then{data.card ? ` (version ${data.card.version}: ${money(data.card.rider_per_job)} a job + ${money(data.card.rider_per_km)} a km + ${money(data.card.wait_per_min)} a minute waited after ${data.card.wait_after_min})` : ""}. You check the jobs and waiting; Accounting prepares any payout run and works out tax withheld; a Super Admin approves. Nothing is paid from this screen.</span>
            </section>
            {data.redeliveries?.length > 0 && (
              <section aria-labelledby="redeliveries" style={section}>
                <h3 id="redeliveries" style={sectionTitle}>Re-delivery trips owed through payroll</h3>
                <span style={dim}>The customer paid each re-delivery fee. It is owed to the AshantiHub rider who made the second trip and is paid through payroll, not from this screen.</span>
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Rider", "Trips", "Owed"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>{data.redeliveries.map((r) => (
                      <tr key={r.staff_id}>
                        <td style={td}>{r.full_name}</td><td style={td}>{r.trips}</td>
                        <td style={{ ...td, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{formatGhs(r.owed)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>
            )}
            {open != null && <Lines staffId={open} weeks={weeks} onClose={() => setOpen(null)} />}
          </>
        )}
      </Status>
    </div>
  );
}

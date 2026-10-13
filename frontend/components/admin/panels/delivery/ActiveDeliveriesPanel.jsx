import { useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useDeliveryActive, useDeliveryJob } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { button, chip, dim, field } from "../panelStyles.js";
import { scroll, table, td, th } from "../opsPeopleParts.jsx";
import { Kpi, Status, Title, kpiGrid, page, section, sectionTitle } from "../insightsParts.jsx";
import { Empty, ErrorLine, Filters, Note, StepChip, WARN, clock, dayTime, fixAge, linkStyle, mono, money, spare } from "./deliveryParts.jsx";

// ─── Delivery Manager 03 Active deliveries and 04 Delivery detail ────────────
// Every row is a job on the road with the last stamp the rider's phone sent. Nothing about
// cash or a delivery fee is shown for a job that has none: cash on delivery is not offered at
// checkout yet and the fee arrives with the rate card.
const PIPELINE = [["assigned", "Assigned"], ["accepted", "Accepted"], ["at_pickup", "Arrived at pickup"], ["picked_up", "Picked up"], ["at_customer", "Arrived at customer"]];

export function ActiveDeliveriesPanel({ onOpenDelivery }) {
  const [filter, setFilter] = useState("all");
  const { data, isLoading, isError } = useDeliveryActive(filter);
  const counts = data?.counts;
  const p = data?.pipeline;
  return (
    <div style={page}>
      <Title right={data && <span style={chip(D.textDim)}>{counts.all} job{counts.all === 1 ? "" : "s"} on the road · updates live</span>}>Active deliveries</Title>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <section aria-labelledby="steps" style={section}>
              <h3 id="steps" style={sectionTitle}>Where the jobs are right now</h3>
              <div style={kpiGrid}>
                {PIPELINE.map(([key, label]) => <Kpi key={key} label={label} value={p[key]} />)}
                <Kpi label="Delivered today" value={p.delivered_today} sub={p.delivered_today_with_deadline ? `${p.delivered_today_on_time} of ${p.delivered_today_with_deadline} on time` : "No delivery time limit set yet"} />
                <Kpi label="Could not deliver today" value={p.could_not_deliver_today} />
              </div>
            </section>
            <Filters label="Filter deliveries" value={filter} onChange={setFilter} options={[["all", `All · ${counts.all}`], ["at_customer", `Waiting at customer · ${counts.at_customer}`], ["flagged", `Flagged · ${counts.flagged}`], ["stale", `Stale location · ${counts.stale}`]]} />
            <section aria-labelledby="tbl" style={section}>
              <h3 id="tbl" style={sectionTitle}>In flight</h3>
              {data.results.length === 0 ? <Empty>No delivery matches.</Empty> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Order", "Rider", "Current step", "Last stamp", "Deliver by", "Payment", "Flag"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {data.results.map((r) => (
                        <tr key={r.id}>
                          <td style={td}><button type="button" onClick={() => onOpenDelivery?.(r.id)} style={linkStyle}>#{r.order_id}</button><div style={dim}>{r.route.from || "Pickup not set"} → {r.route.to || "No address"}</div></td>
                          <td style={{ ...td, fontWeight: 700 }}>{r.rider.full_name}<div style={dim}>{r.vehicle}</div></td>
                          <td style={td}><StepChip status={r.status} label={r.status_label} /><div style={dim}>{r.step_note}</div></td>
                          <td style={td}>{r.last_stamp ? <>{clock(r.last_stamp.at)} · {r.last_stamp.distance_m === null ? "no stop location" : `${Math.round(r.last_stamp.distance_m)} m from the stop`}</> : "No stamp yet"}<div style={{ ...dim, color: r.stale ? WARN : D.green, fontWeight: 700 }}>{fixAge(r.location_age_seconds, r.stale)}</div></td>
                          <td style={td}>{r.deadline_at ? <b>{clock(r.deadline_at)}</b> : <span style={dim}>None set</span>}<div style={{ ...dim, color: r.minutes_to_spare !== null && r.minutes_to_spare < 0 ? WARN : D.textDim }}>{r.stale && r.minutes_to_spare !== null ? "Cannot tell: no fresh location" : spare(r.minutes_to_spare)}</div></td>
                          <td style={td}>{r.payment.label}</td>
                          <td style={td}>{r.flag ? <span style={chip(D.amber)}>{r.flag.label}</span> : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <span style={dim}>Steps: Accepted, Arrived at pickup, Picked up (the rider types the business&apos;s 4-digit pickup code), Arrived at customer (the 10-minute wait starts), Delivered (the customer&apos;s 4-digit code). Every tap is stamped with time and location; a tap more than 150 m from the stop still works but is flagged here.</span>
            </section>
          </>
        )}
      </Status>
    </div>
  );
}

function Decision({ job, onDone }) {
  const [decision, setDecision] = useState("");
  const [note, setNote] = useState("");
  const [hold, setHold] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setError("");
    setBusy(true);
    try {
      await apiPost(`/api/delivery/jobs/${job.id}/flag-decision/`, { decision, note, hold_wait_pay: hold });
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not save the decision."));
    } finally {
      setBusy(false);
    }
  };
  if (job.flag.decision) {
    return <Note>Decision: <b>{job.flag.decision === "cleared" ? "Flag cleared" : "Flag upheld"}</b> by {job.flag.decided_by?.full_name} on {dayTime(job.flag.decided_at)}. {job.flag.note}{job.flag.wait_pay_held ? " Waiting pay is held." : ""}</Note>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ErrorLine>{error}</ErrorLine>
      <div role="radiogroup" aria-label="Your decision" style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.82rem", color: D.text }}>
        <label><input type="radio" name="flag" checked={decision === "cleared"} onChange={() => setDecision("cleared")} /> Clear the flag: the tap was fine</label>
        <label><input type="radio" name="flag" checked={decision === "upheld"} onChange={() => setDecision("upheld")} /> Uphold the flag: the tap was not where the rider said</label>
      </div>
      {decision === "upheld" && <label style={{ fontSize: "0.8rem", color: D.text }}><input type="checkbox" checked={hold} onChange={(e) => setHold(e.target.checked)} /> Hold the waiting pay (a hold only: there is no pay record yet)</label>}
      <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>
        Note{decision === "upheld" ? " (required)" : ""}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} style={field} />
      </label>
      <div><button type="button" disabled={!decision || busy || (decision === "upheld" && !note.trim())} onClick={save} style={button(D.gold, D.text, !decision || busy || (decision === "upheld" && !note.trim()))}>Save decision</button></div>
    </div>
  );
}

export function DeliveryDetail({ id, onBack, onOpenCase }) {
  const { data: job, isLoading, isError, refetch } = useDeliveryJob(id);
  const [error, setError] = useState("");
  const [phone, setPhone] = useState(null);
  const callRider = async () => {
    setError("");
    try {
      const out = await apiPost(`/api/delivery/jobs/${id}/call-rider/`, {});
      setPhone(out.phone);
      refetch();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not log the call."));
    }
  };
  return (
    <div style={page}>
      <button type="button" onClick={onBack} style={{ ...linkStyle, alignSelf: "flex-start" }}>Back to active deliveries</button>
      <Status isLoading={isLoading} isError={isError}>
        {job && (
          <>
            <Title right={(
              <>
                <StepChip status={job.status} label={job.status_label} />
                {job.rider.full_name && <button type="button" onClick={callRider} style={button(D.panelBg, D.text)}>Call {job.rider.full_name.split(" ")[0]} (logged)</button>}
                {phone && <a href={`tel:${phone}`} style={{ ...linkStyle, fontWeight: 800 }}>{phone}</a>}
              </>
            )}>Order #{job.order_id}</Title>
            <ErrorLine>{error}</ErrorLine>
            <div style={kpiGrid}>
              <Kpi label="Rider" value={job.rider.full_name || "None"} sub={`${job.rider.vehicle || ""}${job.rider.plate ? ` · ${job.rider.plate}` : ""}`} />
              <Kpi label="Deliver by" value={job.deadline_at ? clock(job.deadline_at) : "None set"} sub={job.delivered_at ? `Delivered ${clock(job.delivered_at)}` : "Not delivered yet"} />
              <Kpi label="Payment" value={job.payment.label} sub={`Order total ${money(job.total_amount)}`} />
              <Kpi label="Delivery fee" value="Not recorded" sub="Orders carry no delivery fee yet; it arrives with the rate card" />
            </div>
            <section aria-labelledby="tl" style={section}>
              <h3 id="tl" style={sectionTitle}>Check-ins and events</h3>
              <span style={dim}>Stamped by the rider&apos;s phone, with server time.</span>
              {job.timeline.length === 0 ? <Empty>No check-in yet.</Empty> : job.timeline.map((e) => (
                <div key={e.id} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline", fontSize: "0.82rem", color: D.text }}>
                  <span style={{ ...mono, minWidth: 48 }}>{clock(e.at)}</span>
                  <span style={{ fontWeight: 800, minWidth: 150 }}>{e.label}</span>
                  <span>{e.distance_m === null ? "No stop location to measure from" : `${Math.round(e.distance_m)} m from the stop`}{e.accuracy_m ? ` · accuracy ${Math.round(e.accuracy_m)} m` : ""}</span>
                  {e.flagged && <span style={chip(D.amber)}>Flagged</span>}
                  {e.note && <span style={dim}>{e.note}</span>}
                </div>
              ))}
              <div style={{ ...dim, display: "flex", gap: 14, flexWrap: "wrap" }}>
                <span>Pickup code: {job.codes.pickup.matched ? "matched" : "not entered yet"}{job.codes.pickup.wrong_tries ? `, ${job.codes.pickup.wrong_tries} wrong tr${job.codes.pickup.wrong_tries === 1 ? "y" : "ies"}` : ""}</span>
                <span>Customer code: {job.codes.drop.matched ? "matched" : "not entered yet"}{job.codes.drop.wrong_tries ? `, ${job.codes.drop.wrong_tries} wrong tr${job.codes.drop.wrong_tries === 1 ? "y" : "ies"}` : ""}</span>
              </div>
              {job.wait && <Note tone="warn">Waiting at the door: {Math.floor(job.wait.elapsed_seconds / 60)} of {Math.floor(job.wait.limit_seconds / 60)} minutes.</Note>}
              {job.failed && <Note tone="warn">Could not deliver at {clock(job.failed.at)}: {job.failed.reason}. {job.failed.note}</Note>}
              {job.rider_note && <Note>Rider&apos;s note: {job.rider_note}</Note>}
            </section>
            <section aria-labelledby="pc" style={section}>
              <h3 id="pc" style={sectionTitle}>Photos and calls</h3>
              {job.photos.length === 0 ? <Empty>No photo was taken.</Empty> : <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.82rem", color: D.text }}>{job.photos.map((p) => <li key={p.id}>{p.kind_label} · {clock(p.at)}</li>)}</ul>}
              {job.calls.length === 0 ? <Empty>No call was logged.</Empty> : <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.82rem", color: D.text }}>{job.calls.map((c) => <li key={c.id}>{clock(c.at)} · {c.kind === "manager_to_rider" ? "Manager to rider" : "Rider to customer"} · {c.outcome || "no result recorded"}</li>)}</ul>}
              <span style={dim}>The rider calls the customer&apos;s delivery phone ({job.customer.phone_masked || "no phone"}) from the job screen, and every call is logged. The business never sees this number.</span>
            </section>
            {job.flag.flagged_steps.length > 0 && (
              <section aria-labelledby="fl" style={section}>
                <h3 id="fl" style={sectionTitle}>Location flag</h3>
                <span style={{ fontSize: "0.82rem", color: D.text }}>A tap was more than 150 m from its stop at: {job.flag.flagged_steps.join(", ").replace(/_/g, " ")}.</span>
                <Decision job={job} onDone={refetch} />
              </section>
            )}
            <section aria-labelledby="cs" style={section}>
              <h3 id="cs" style={sectionTitle}>Cases on this order</h3>
              {job.cases.length === 0 ? <Empty>No case has been raised. Customers raise cases through AshantiHub Support; a rider&apos;s &quot;Can&apos;t deliver&quot; opens one automatically.</Empty> : job.cases.map((c) => (
                <div key={c.id}><button type="button" onClick={() => onOpenCase?.(c.id)} style={linkStyle}>Case #{c.id}</button> · {c.status} · {dayTime(c.created_at)}</div>
              ))}
            </section>
          </>
        )}
      </Status>
    </div>
  );
}

export default function ActiveDeliveries({ detailId, onOpenDetail, onOpenCase }) {
  if (detailId != null) return <DeliveryDetail id={detailId} onBack={() => onOpenDetail(null)} onOpenCase={onOpenCase} />;
  return <ActiveDeliveriesPanel onOpenDelivery={onOpenDetail} />;
}

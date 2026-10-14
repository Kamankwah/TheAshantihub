import { useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useDeliveryActive, useDeliveryJob } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { button, chip, dim, field } from "../panelStyles.js";
import { scroll, table, td, th } from "../opsPeopleParts.jsx";
import { Kpi, Status, Title, kpiGrid, page, section, sectionTitle } from "../insightsParts.jsx";
import { JobMap } from "./deliveryMaps.jsx";
import { Empty, ErrorLine, Filters, Note, StepChip, WARN, clock, dayTime, fixAge, linkStyle, mono, money, skipPin, spare } from "./deliveryParts.jsx";

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

const LOCK_AT = 5; // CODE_ATTEMPT_LIMIT on the server; the server is the one that enforces it

// One code's line in the record: matched or not, wrong tries, and, once five wrong tries have locked it,
// an unlock that needs a written reason (it is logged with the manager's name). The code itself is
// never shown to a manager.
function CodeLine({ label, which, jobId, stopId, state, onDone, canUnlock = true }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = canUnlock && !state.matched && state.wrong_tries >= LOCK_AT;
  const unlock = async () => {
    setError("");
    setBusy(true);
    try {
      await apiPost(`/api/delivery/jobs/${jobId}/unlock-code/`, { which, note: note.trim(), ...(stopId != null ? { stop: stopId } : {}) });
      setOpen(false);
      setNote("");
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not unlock the code."));
      if (err?.status === 409 || err?.code === "not_locked") onDone(); // someone else unlocked it: show the current state
    } finally {
      setBusy(false);
    }
  };
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span>{label}: {state.matched ? "matched" : "not entered yet"}{state.wrong_tries ? `, ${state.wrong_tries} wrong tr${state.wrong_tries === 1 ? "y" : "ies"}` : ""}</span>
      {locked && (
        <span style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
          <span style={chip(D.amber)}>Code locked</span>
          {!open && <button type="button" onClick={() => setOpen(true)} style={button(D.panelBg, D.text)}>Unlock code</button>}
          {open && (
            <span style={{ display: "flex", flexDirection: "column", gap: 6, alignSelf: "stretch" }}>
              <ErrorLine>{error}</ErrorLine>
              <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>
                Why are you unlocking this code? (required, kept in the activity log)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} style={field} />
              </label>
              <span style={{ display: "flex", gap: 8 }}>
                <button type="button" disabled={!note.trim() || busy} onClick={unlock} style={button(D.gold, D.text, !note.trim() || busy)}>Confirm unlock</button>
                <button type="button" disabled={busy} onClick={() => { setOpen(false); setError(""); }} style={button(D.panelBg, D.text)}>Cancel</button>
              </span>
            </span>
          )}
        </span>
      )}
    </span>
  );
}

const STOP_LABEL = { pending: "Waiting", arrived: "Rider at the shop", collected: "Collected", skipped: "Skipped" };
const SKIPPABLE = ["assigned", "accepted", "at_pickup"];

// One shop of a multi-shop delivery. A job from before multi-stop delivery has one unsaved stop the server names id 0
// (a GET never writes); that 0 is sent back as it came and the server reads it as the first stop.
function StopRow({ jobId, stop, canSkip, onDone }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const openStop = stop.status === "pending" || stop.status === "arrived";
  const skip = async () => {
    setError("");
    setBusy(true);
    try {
      await apiPost(`/api/delivery/jobs/${jobId}/stops/${stop.id}/skip/`, { note: note.trim() });
      setOpen(false);
      setNote("");
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not skip this shop."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="group" aria-label={`Stop ${stop.sequence}: ${stop.business_name}`} style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1px solid ${D.divider}`, paddingTop: 8, fontSize: "0.82rem", color: D.text }}>
      <span><b>{stop.sequence}. {stop.business_name}</b> · {STOP_LABEL[stop.status] || stop.status}{stop.collected_at ? ` ${clock(stop.collected_at)}` : ""}{stop.status === "pending" && stop.planned_arrival ? ` · expected about ${clock(stop.planned_arrival)}${stop.late ? ", running late" : ""}` : ""}</span>
      {stop.skip_note && <span style={dim}>Skipped: {stop.skip_note}</span>}
      {(stop.skips || []).map((k, i) => (
        <span key={`${k.at}-${i}`} style={dim}>{k.by === "rider" ? "Rider reported" : "Skipped by a manager"} {clock(k.at)}: {k.note}{k.by === "rider" ? `. ${skipPin(k)}.` : "."}</span>
      ))}
      {stop.id != null && <CodeLine label="Pickup code" which="pickup" jobId={jobId} stopId={stop.id} canUnlock={openStop} state={{ matched: stop.status === "collected", wrong_tries: stop.wrong_tries || 0 }} onDone={onDone} />}
      {canSkip && openStop && stop.id != null && !open && <button type="button" onClick={() => setOpen(true)} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Skip this shop</button>}
      {open && (
        <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <ErrorLine>{error}</ErrorLine>
          <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700 }}>
            Why is this shop skipped? (required; the customer is told and a case asks for this shop&apos;s items to be refunded)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} style={field} />
          </label>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" disabled={!note.trim() || busy} onClick={skip} style={button(D.gold, D.text, !note.trim() || busy)}>Confirm skip</button>
            <button type="button" disabled={busy} onClick={() => { setOpen(false); setError(""); }} style={button(D.panelBg, D.text)}>Cancel</button>
          </span>
        </span>
      )}
    </div>
  );
}

// The detour warning keys off over_limit; the percentage may be null, so the message does not need it.
function RouteLine({ plan, count, stops = [] }) {
  if (!plan) return null;
  const missingPin = stops.some((s) => s.lat === null);
  const allowance = `allowance ${plan.limit_pct}%${plan.limit_source === "defaults" ? ", built-in default" : ""}`;
  return (
    <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: "0.82rem", color: D.text }}>
      {plan.total_km != null ? `Planned route ${plan.total_km} km through ${count} shops${plan.basis ? ` (${plan.basis})` : ""}.` : `No planned route for this order.${missingPin ? " A shop has no map pin." : ""}`}
      {plan.over_limit && <span style={chip(D.amber)}>{plan.detour_pct != null ? `Detour ${plan.detour_pct}%` : "Longer than going direct"} ({allowance})</span>}
    </span>
  );
}

export function DeliveryDetail({ id, onBack, onOpenCase }) {
  const { data: job, isLoading, isError, refetch } = useDeliveryJob(id);
  const [error, setError] = useState("");
  const [phone, setPhone] = useState(null);
  const multi = (job?.stops || []).length > 1;
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
            <section aria-labelledby="mp" style={section}>
              <h3 id="mp" style={sectionTitle}>Where it is</h3>
              <JobMap jobId={id} riderName={job.rider.full_name} />
            </section>
            {multi && (
              <section aria-label="Shops on this delivery" style={section}>
                <h3 style={sectionTitle}>Shops on this delivery</h3>
                <RouteLine plan={job.route_plan} count={job.stops.length} stops={job.stops} />
                {job.stops.map((s) => <StopRow key={s.sequence} jobId={id} stop={s} canSkip={SKIPPABLE.includes(job.status)} onDone={refetch} />)}
              </section>
            )}
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
                {!multi && <CodeLine label="Pickup code" which="pickup" jobId={id} state={job.codes.pickup} onDone={refetch} />}
                <CodeLine label="Customer code" which="drop" jobId={id} state={job.codes.drop} onDone={refetch} />
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

import { useRef, useState } from "react";
import { apiPost, apiPostForm } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { currentFix } from "../../../../lib/riderTracking.js";
import { useRiderEarnings, useRiderJob, useRiderMe } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { chip, dim, field } from "../panelStyles.js";
import JobMap from "./JobMap.jsx";
import { Err, Info, JobHeader, LocationLine, Warn, bigButton, card, distanceText, h2, hhmm, mmss, mono, money, quietButton, screen, useDistanceTo, useTick } from "./riderParts.jsx";

// ─── Dispatch 04 to 09: one job from accepted to delivered ───────────────────
// Every step is stamped with the phone's own location and sent to the server, which measures the
// distance from the stop. The arrival buttons are offered within 150 m of the stop; a tap farther
// away still works but is flagged for the manager, and the screen says so. The rider never sees
// the pickup or drop code (the shop and the customer read them out); a wrong code is refused by
// the server, which counts the tries.
const FLAG_M = 150;

// "stop 2 of 3" when a delivery collects from several shops; nothing extra for one shop (or a job from before
// multi-stop delivery, whose payload carries no progress).
const titled = (job, base) => (job.progress?.total > 1 && job.progress?.current ? `${base} · stop ${job.progress.current} of ${job.progress.total}` : base);
const OPEN = ["pending", "arrived"];
const nextShop = (job) => {
  const cur = job.current_stop;
  return (job.pickups || []).find((s) => cur && s.sequence > cur.sequence && OPEN.includes(s.status)) || null;
};

function PhotoPick({ label, onFile, file }) {
  return (
    <label style={{ ...quietButton(false), display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer" }}>
      {file ? `Photo ready: ${file.name}` : label}
      <input type="file" accept="image/jpeg,image/png" capture="environment" aria-label={label} onChange={(e) => onFile(e.target.files?.[0] || null)} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} />
    </label>
  );
}

// Runs one step: asks for a fresh location, posts it, and hands the refreshed job to the parent.
function useStep(job, onChanged, { onStale } = {}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false); // a fast double tap must send one request, not two
  const run = async (name, extra = {}, { locate = true } = {}) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setError("");
    setBusy(true);
    try {
      const body = { ...extra };
      if (locate) {
        const fix = await currentFix();
        Object.assign(body, { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m });
      }
      const out = await apiPost(`/api/delivery/rider/jobs/${job.id}/${name}/`, body);
      onChanged(out);
      return out;
    } catch (err) {
      if (err?.body?.code === "stop_done" && onStale) {
        // The same tap went through already (or the stop moved on): reload the job instead of showing an error.
        onStale();
        return null;
      }
      setError(apiErrorMessage(err, err?.message || "That did not work. Try again."));
      return null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { run, error, busy, setError };
}

function ArriveButton({ distance, located, onTap, busy, label, noPinText }) {
  const near = distance !== null && distance <= FLAG_M;
  const unknown = distance === null && located === false;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {near || unknown ? (
        <button type="button" disabled={busy} onClick={onTap} style={bigButton(busy)}>{label}</button>
      ) : (
        <button type="button" disabled={busy} onClick={onTap} style={quietButton(busy)}>{label}: tap anyway (flagged)</button>
      )}
      <div style={{ ...dim, textAlign: "center", lineHeight: 1.45 }}>
        {unknown ? noPinText : near ? `Showing because you're within ${FLAG_M} m (${distanceText(distance)}).` : distance === null ? "Waiting for your location to check how far you are." : `You are ${distanceText(distance)} away. A tap farther than ${FLAG_M} m still works but is flagged for your manager.`}
      </div>
    </div>
  );
}

function CallBlock({ job, onChanged }) {
  const [error, setError] = useState("");
  const [call, setCall] = useState(null);
  const dial = async () => {
    setError("");
    try {
      const out = await apiPost(`/api/delivery/rider/jobs/${job.id}/call/`, {});
      setCall(out);
      window.location.href = `tel:${out.phone}`;
      onChanged();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not place the call."));
    }
  };
  const outcome = async (value) => {
    try { await apiPost(`/api/delivery/rider/calls/${call.call_id}/outcome/`, { outcome: value }); setCall(null); onChanged(); } catch (err) { setError(apiErrorMessage(err, "Could not save that.")); }
  };
  return (
    <section aria-label="Call the customer" style={card}>
      <button type="button" onClick={dial} style={quietButton(false)}>Call {job.customer_name}</button>
      <Err>{error}</Err>
      {call && (
        <div role="group" aria-label="How did the call go" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: "0.8rem", color: D.text }}>How did the call go?</span>
          <button type="button" onClick={() => outcome("connected")} style={quietButton(false)}>They answered</button>
          <button type="button" onClick={() => outcome("no_answer")} style={quietButton(false)}>No answer</button>
        </div>
      )}
      <span style={dim}>Dials the delivery phone given at checkout. Each call is logged on this job ({job.calls} so far). The business never sees this number.</span>
    </section>
  );
}

function ToPickup({ job, step, onChanged, onSkip }) {
  const p = job.current_stop || job.pickup;
  const next = nextShop(job);
  const distance = useDistanceTo(p?.lat, p?.lng);
  const accepted = job.status !== "assigned";
  return (
    <>
      <JobHeader job={job} title={titled(job, accepted ? "to pickup" : "new job")} />
      <LocationLine />
      <section aria-label="Pickup" style={card}>
        <h2 style={{ ...h2, fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", color: D.textDim }}>To the pickup</h2>
        <div style={{ fontSize: "1.9rem", fontWeight: 800, color: D.text, lineHeight: 1.1 }}>{distance === null ? "Location needed" : <>{distanceText(distance)} <span style={{ fontSize: "1rem", fontWeight: 600, color: D.textDim }}>to go (straight line)</span></>}</div>
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: "0.9rem" }}>
          <dt style={{ color: D.textDim }}>Shop</dt><dd style={{ margin: 0, fontWeight: 700 }}>{p?.business_name || "Not set"}</dd>
          <dt style={{ color: D.textDim }}>Then to</dt><dd style={{ margin: 0, fontWeight: 700 }}>{next ? next.business_name : (job.delivery_address || "No address")}</dd>
          {p?.late && <><dt style={{ color: D.textDim }}>Timing</dt><dd style={{ margin: 0, fontWeight: 700, color: "#A33A00" }}>Running late for this shop</dd></>}
          <dt style={{ color: D.textDim }}>Deliver by</dt><dd style={{ margin: 0, fontWeight: 700 }}>{job.deadline_at ? hhmm(job.deadline_at) : "No time limit set"}</dd>
          <dt style={{ color: D.textDim }}>Payment</dt><dd style={{ margin: 0, fontWeight: 700 }}>{job.payment.label}</dd>
        </dl>
        <JobMap jobId={job.id} />
        {p?.lat !== null && p?.lat !== undefined && (
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`} target="_blank" rel="noreferrer" style={{ ...quietButton(false), display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>Open in Google Maps</a>
        )}
        <Warn>Tracking pauses while you are in another app. Come back to this screen before you arrive: the arrival button needs your location.</Warn>
        <Info>At the shop, ask for <b>Order #{job.order_id}</b>. Each shop reads you its own 4-digit pickup code from its AshantiHub order screen.</Info>
      </section>
      <Err>{step.error}</Err>
      {!accepted ? (
        <button type="button" disabled={step.busy} onClick={() => step.run("accept", {}, { locate: false })} style={bigButton(step.busy)}>Accept this job</button>
      ) : (
        <>
          <ArriveButton distance={distance} located={p?.lat !== null && p?.lat !== undefined} busy={step.busy} label="I've arrived" onTap={() => step.run("arrive-pickup")} noPinText="This shop has no map pin, so the distance cannot be checked." />
          {onSkip && <button type="button" onClick={onSkip} style={quietButton(false)}>Can&apos;t hand over?</button>}
        </>
      )}
    </>
  );
}

function AtPickup({ job, step, onChanged, onSkip }) {
  const p = job.current_stop || job.pickup;
  useTick(1000);
  const [code, setCode] = useState("");
  const [photo, setPhoto] = useState(null);
  const arrived = job.arrived_pickup_at ? Math.max(0, Math.round((Date.now() - new Date(job.arrived_pickup_at)) / 1000)) : 0;
  const pick = async () => {
    if (photo) {
      try {
        const form = new FormData();
        form.append("image", photo);
        form.append("kind", "pickup");
        await apiPostForm(`/api/delivery/rider/jobs/${job.id}/photo/`, form);
      } catch (err) {
        step.setError(apiErrorMessage(err, "The photo did not upload. Pick up without it, or try again."));
        return;
      }
    }
    step.run("pickup", { code });
  };
  return (
    <>
      <JobHeader job={job} title={titled(job, "at pickup")} />
      <LocationLine />
      <section aria-label="Pickup" style={card}>
        <div style={{ fontWeight: 800, color: D.text }}>{p?.business_name}</div>
        <div style={dim}>Arrived {hhmm(job.arrived_pickup_at)} · waiting {mmss(arrived)}. Waiting pay starts after 10:00.</div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", fontWeight: 800, color: D.text }}>
          Pickup code
          <input aria-label="Pickup code" inputMode="numeric" maxLength={4} autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} style={{ ...field, ...mono, fontSize: "1.6rem", letterSpacing: "0.3em", textAlign: "center", minHeight: 56 }} />
        </label>
        <span style={dim}>Type the 4-digit code shown on the shop&apos;s AshantiHub order screen. It proves the shop handed this order to you. {(p?.attempts_left ?? job.pickup_attempts_left) < 5 ? `${p?.attempts_left ?? job.pickup_attempts_left} tries left.` : ""}</span>
        <div>
          <b style={{ fontSize: "0.82rem", color: D.text }}>Check the items</b>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: "0.86rem", color: D.text }}>{(p?.items || []).map((i) => <li key={i}>{i}</li>)}</ul>
          <span style={dim}>Something missing or damaged? Do not pick up: report it from the menu.</span>
        </div>
        <PhotoPick label="Package photo (optional)" file={photo} onFile={setPhoto} />
        <span style={dim}>Helps settle it quickly if the customer says the parcel arrived damaged.</span>
      </section>
      <Err>{step.error}</Err>
      <button type="button" disabled={step.busy || code.length !== 4} onClick={pick} style={bigButton(step.busy || code.length !== 4)}>Picked up</button>
      {onSkip && <button type="button" onClick={onSkip} style={quietButton(false)}>Can&apos;t hand over?</button>}
      <span style={{ ...dim, textAlign: "center" }}>The tap is stamped with time and location. The shop sees your name and Order #{job.order_id}, never the customer&apos;s phone number.</span>
    </>
  );
}

function ToCustomer({ job, step, onChanged }) {
  const distance = useDistanceTo(job.delivery_lat, job.delivery_lng);
  const located = job.delivery_lat !== null && job.delivery_lat !== undefined;
  return (
    <>
      <JobHeader job={job} title="to customer" />
      <LocationLine />
      <section aria-label="Customer" style={card}>
        <h2 style={{ ...h2, fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", color: D.textDim }}>To the customer</h2>
        <div style={{ fontSize: "1.9rem", fontWeight: 800, color: D.text, lineHeight: 1.1 }}>{distance === null ? "Location needed" : <>{distanceText(distance)} <span style={{ fontSize: "1rem", fontWeight: 600, color: D.textDim }}>to go (straight line)</span></>}</div>
        <div><b>{job.customer_name}</b><div style={{ fontSize: "0.88rem", color: D.text }}>{job.delivery_address}</div></div>
        <div style={dim}>Deliver by {job.deadline_at ? hhmm(job.deadline_at) : "(no time limit set)"} · Payment {job.payment.label}{job.payment.cash_due ? ` · collect ${money(job.payment.cash_due)}` : " · nothing to collect"}</div>
        <JobMap jobId={job.id} />
        {located && <a href={`https://www.google.com/maps/dir/?api=1&destination=${job.delivery_lat},${job.delivery_lng}`} target="_blank" rel="noreferrer" style={{ ...quietButton(false), display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>Open in Google Maps</a>}
      </section>
      <CallBlock job={job} onChanged={onChanged} />
      <Err>{step.error}</Err>
      <ArriveButton distance={distance} located={located} busy={step.busy} label="I'm outside" onTap={() => step.run("arrive-drop")} noPinText="This address has no map pin, so the distance cannot be checked." />
    </>
  );
}

function AtCustomer({ job, step, onChanged, onCant }) {
  useTick(1000);
  const [code, setCode] = useState("");
  const wait = job.wait;
  const elapsed = wait ? wait.elapsed_seconds + 0 : 0;
  const started = job.arrived_drop_at ? Math.max(0, Math.round((Date.now() - new Date(job.arrived_drop_at)) / 1000)) : elapsed;
  const limit = wait?.limit_seconds || 600;
  return (
    <>
      <JobHeader job={job} title="at customer" />
      <LocationLine />
      <section aria-label="Waiting" style={card}>
        <div style={{ fontSize: "0.86rem", color: D.text }}>{job.customer_name} · {job.delivery_address} · outside since {hhmm(job.arrived_drop_at)}</div>
        <div style={{ textAlign: "center" }}>
          <div role="timer" aria-label={`Waiting ${mmss(started)} of ${mmss(limit)}`} style={{ ...mono, fontSize: "2.6rem", fontWeight: 800, color: started >= limit ? "#A33A00" : D.text }}>{mmss(started)}</div>
          <div style={dim}>of {mmss(limit)}</div>
        </div>
        <span style={dim}>The customer was told you are outside, in the app. SMS and push are not connected. After {mmss(limit)}, waiting pay starts and &quot;No answer&quot; becomes a reason you can choose.</span>
      </section>
      <CallBlock job={job} onChanged={onChanged} />
      <section aria-label="Customer's delivery code" style={card}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", fontWeight: 800, color: D.text }}>
          Delivery code
          <input aria-label="Delivery code" inputMode="numeric" maxLength={4} autoComplete="off" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} style={{ ...field, ...mono, fontSize: "1.6rem", letterSpacing: "0.3em", textAlign: "center", minHeight: 56 }} />
        </label>
        <span style={dim}>Ask {job.customer_name} for the 4-digit code in their AshantiHub order. Type it only once the parcel is in their hands. {job.drop_attempts_left < 5 ? `${job.drop_attempts_left} tries left.` : ""}</span>
      </section>
      <Err>{step.error}</Err>
      <button type="button" disabled={step.busy || code.length !== 4} onClick={() => step.run("deliver", { code })} style={bigButton(step.busy || code.length !== 4)}>Delivered</button>
      <button type="button" onClick={onCant} style={quietButton(false)}>Can&apos;t deliver?</button>
      <span style={{ ...dim, textAlign: "center" }}>Wrong address or a refusal can be reported now. &quot;No answer&quot; needs the full wait and 2 calls.</span>
    </>
  );
}

export function SkipStop({ job, onBack, onDone }) {
  const [note, setNote] = useState("");
  const step = useStep(job, (out) => onDone(out), { onStale: () => onDone(null) });
  const p = job.current_stop || job.pickup;
  const left = (job.progress?.total || 1) - (job.progress?.done || 0) - (job.progress?.skipped || 0);
  const ends = left <= 1 && !(job.progress?.done > 0);
  // A skip names the shop (stop_id), so a retried tap cannot skip the next one; the location is required (the server's own
  // "location needed" message is shown as is).
  const submit = () => step.run("skip-stop", { stop_id: job.current_stop_id, note: note.trim() });
  return (
    <>
      <section aria-label="Shop cannot hand over" style={card}>
        <h1 style={h2}>Order #{job.order_id} · {p?.business_name || "this shop"} can&apos;t hand over</h1>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", fontWeight: 800, color: D.text }}>
          What happened? (required)
          <textarea aria-label="What happened" rows={3} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} style={field} />
        </label>
        <Info>
          {ends ? "Nothing has been collected and this is the last shop, so you stop here. The order goes back to your manager to send out again." : left > 1 ? "You move on to the next shop." : "You go on to the customer with what you collected."}{" "}
          The customer is told. AshantiHub Support reviews this shop&apos;s items for a refund. The shop sees only the time and your note; phone numbers and emails are removed. Your location is sent with this report.
        </Info>
      </section>
      <Err>{step.error}</Err>
      <button type="button" disabled={!note.trim() || step.busy} onClick={submit} style={bigButton(!note.trim() || step.busy)}>Confirm: skip this shop</button>
      <button type="button" onClick={onBack} style={quietButton(false)}>Back to the job</button>
    </>
  );
}

const REASONS = [
  ["no_answer", "No answer", "Needs the full wait at the door and 2 logged calls."],
  ["wrong_address", "Wrong address", "The address does not exist or is not where the pin says."],
  ["refused", "Customer refused", "They will not take the parcel."],
  ["unsafe", "Unsafe to hand over", "You do not feel safe at this stop."],
  ["other", "Something else", "Say what happened below."],
];

export function CantDeliver({ job, onBack, onDone }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState(null);
  const step = useStep(job, (out) => onDone(out));
  const wait = job.wait;
  const waitedOut = wait ? wait.left_seconds === 0 : false;
  const noAnswerReady = waitedOut && job.calls >= 2;
  const blocked = reason === "no_answer" && !noAnswerReady;
  const submit = async () => {
    if (photo) {
      try {
        const form = new FormData();
        form.append("image", photo);
        form.append("kind", "evidence");
        await apiPostForm(`/api/delivery/rider/jobs/${job.id}/photo/`, form);
      } catch (err) {
        step.setError(apiErrorMessage(err, "The photo did not upload. Send without it, or try again."));
        return;
      }
    }
    step.run("cant-deliver", { reason, note });
  };
  return (
    <>
      <section aria-label="Can't deliver" style={card}>
        <h1 style={h2}>Order #{job.order_id} · can&apos;t deliver</h1>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <legend style={{ fontWeight: 800, fontSize: "0.9rem", color: D.text, marginBottom: 6 }}>What happened?</legend>
          {REASONS.map(([id, label, hint]) => (
            <label key={id} style={{ display: "flex", gap: 8, alignItems: "flex-start", border: `1px solid ${reason === id ? D.text : D.cardBorder}`, borderRadius: 12, padding: "10px 12px", cursor: "pointer" }}>
              <input type="radio" name="reason" checked={reason === id} onChange={() => setReason(id)} />
              <span><b style={{ color: D.text }}>{label}</b><div style={dim}>{hint}</div></span>
            </label>
          ))}
        </fieldset>
        {blocked && <Warn>&quot;No answer&quot; needs the full {wait ? mmss(wait.limit_seconds) : "10:00"} wait at the door and 2 logged calls. You have {job.calls} call{job.calls === 1 ? "" : "s"} logged{waitedOut ? "" : " and the wait is not over"}.</Warn>}
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", fontWeight: 800, color: D.text }}>
          Anything to add? (optional)
          <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} style={field} />
        </label>
        <PhotoPick label="Add a photo of the gate (optional)" file={photo} onFile={setPhoto} />
        <Info>What happens next: take the parcel back as your manager tells you. Your manager opens a case and Support contacts the customer. Your pay for this trip is decided with the case.</Info>
      </section>
      <Err>{step.error}</Err>
      <button type="button" disabled={!reason || blocked || step.busy} onClick={submit} style={bigButton(!reason || blocked || step.busy)}>Confirm: can&apos;t deliver</button>
      <button type="button" onClick={onBack} style={quietButton(false)}>Back to the job</button>
    </>
  );
}

export function Delivered({ job, onNext }) {
  const earnings = useRiderEarnings("today");
  const line = (earnings.data?.results || []).find((r) => r.assignment_id === job.id);
  const taken = job.accepted_at && job.delivered_at ? Math.max(1, Math.round((new Date(job.delivered_at) - new Date(job.accepted_at)) / 60000)) : null;
  return (
    <>
      <section aria-label="Delivered" style={{ ...card, alignItems: "center", textAlign: "center" }}>
        <h1 style={{ ...h2, fontSize: "1.6rem" }}>Delivered</h1>
        <div style={{ color: D.text }}>Order #{job.order_id} · {job.customer_name}, {job.delivery_address} · {hhmm(job.delivered_at)}</div>
        <div role="status" style={{ background: "#E3F1E3", borderRadius: 12, padding: "8px 14px", color: "#00400A", fontWeight: 800 }}>{job.deadline_at ? (new Date(job.delivered_at) <= new Date(job.deadline_at) ? "On time" : "After the deliver-by time") : "No deliver-by time was set"}</div>
      </section>
      <section aria-label="What you earned" style={card}>
        <h2 style={h2}>You earned on this job</h2>
        {!line || line.pay === null ? <span style={{ fontSize: "0.86rem", color: D.text }}>No pay was recorded for this job: no rate card was in force, or the route could not be measured. Ask your manager.</span> : (
          <>
            {line.lines.map((l) => <div key={l.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: D.text }}><span>{l.label}</span><b>{money(l.amount)}</b></div>)}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, borderTop: `1px solid ${D.divider}`, paddingTop: 6, color: D.text }}><span>Total</span><span>{money(line.pay)}</span></div>
            {line.wait_pay_held && <span style={dim}>Waiting pay is held while your manager decides a location flag.</span>}
          </>
        )}
        <span style={dim}>Payments are simulated until Hubtel is connected. Your pay is recorded; no money moves yet.</span>
      </section>
      <section aria-label="Times" style={card}>
        <h2 style={h2}>Time{taken ? `: ${taken} min` : ""}</h2>
        {job.steps.filter((s) => s.done).map((s) => <div key={s.step} style={{ display: "flex", gap: 10, fontSize: "0.86rem", color: D.text }}><span style={{ ...mono, minWidth: 48 }}>{hhmm(s.event?.at)}</span><span>{s.label}{s.event?.flagged ? " (flagged)" : ""}</span></div>)}
      </section>
      <button type="button" onClick={onNext} style={bigButton(false)}>Ready for the next job</button>
    </>
  );
}

export default function ActiveJob({ jobId, onDelivered }) {
  const { data: job, isLoading, isError, refetch } = useRiderJob(jobId);
  const me = useRiderMe();
  const [cant, setCant] = useState(false);
  const [skip, setSkip] = useState(false);
  const changed = (out) => { refetch(); me.refetch(); if (out?.status === "delivered" || out?.status === "failed") onDelivered?.(out); };
  const step = useStep(job || { id: jobId }, changed);
  const canSkip = job?.current_stop_id !== undefined && job?.current_stop_id !== null;
  if (isLoading) return <div role="status" style={dim}>Loading the job…</div>;
  if (isError || !job) return <Err>Could not load this job.</Err>;
  if (job.status === "delivered" || job.status === "confirmed") return <div style={screen}><Delivered job={job} onNext={() => onDelivered?.(null)} /></div>;
  if (job.status === "failed") {
    return <div style={screen}><section style={card}><h1 style={h2}>Order #{job.order_id} · could not deliver</h1><span style={{ color: D.text, fontSize: "0.88rem" }}>{job.failed_reason === "all_stops_skipped" ? "No shop could hand over the items. The order has gone back to your manager to send out again; nothing goes to the customer." : <>Reason: {String(job.failed_reason || "").replace(/_/g, " ")}. Your manager has been told and will open a case. Take the parcel back as they tell you.</>}</span></section><button type="button" onClick={() => onDelivered?.(null)} style={bigButton(false)}>Back to the shift</button></div>;
  }
  if (skip) return <div style={screen}><SkipStop job={job} onBack={() => setSkip(false)} onDone={(out) => { setSkip(false); changed(out); }} /></div>;
  if (cant) return <div style={screen}><CantDeliver job={job} onBack={() => setCant(false)} onDone={(out) => { setCant(false); changed(out); }} /></div>;
  return (
    <div style={screen}>
      {(job.status === "assigned" || job.status === "accepted") && <ToPickup job={job} step={step} onChanged={refetch} onSkip={canSkip ? () => setSkip(true) : undefined} />}
      {job.status === "at_pickup" && <AtPickup job={job} step={step} onChanged={refetch} onSkip={canSkip ? () => setSkip(true) : undefined} />}
      {job.status === "picked_up" && <ToCustomer job={job} step={step} onChanged={refetch} />}
      {job.status === "at_customer" && <AtCustomer job={job} step={step} onChanged={refetch} onCant={() => setCant(true)} />}
      {me.data?.rider?.manager && <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.82rem", fontWeight: 700 }}><span style={dim}>Something wrong? Use Report an issue in the menu.</span>{me.data.rider.manager.phone && <a href={`tel:${me.data.rider.manager.phone}`} style={{ color: D.deepGold }}>Call {me.data.rider.manager.full_name.split(" ")[0]}</a>}</div>}
    </div>
  );
}

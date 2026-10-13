import { useEffect, useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { currentFix, startTracking, stopTracking } from "../../../../lib/riderTracking.js";
import { useRiderCash, useRiderDocuments, useRiderEarnings, useRiderJobs, useRiderMe, useRiderOffers, useRiderShifts } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { chip, dim } from "../panelStyles.js";
import ActiveJob from "./JobFlow.jsx";
import { Err, Info, LocationLine, Warn, bigButton, card, h2, hhmm, longDay, mmss, mono, money, quietButton, screen, useTick } from "./riderParts.jsx";

// ─── Dispatch 01 Off shift, 02 On shift, 03 New offer ────────────────────────
// The shift is the rider's own switch. Going on shift needs every required paper approved and in
// date (the server refuses otherwise and names what is missing) and a location reading. Location
// is shared only while the app is open; the tracker in the shell does the sharing, this screen
// only starts and ends the shift. An offer fills the screen with its timer and the pay the rate
// card gives; with no card, no pay is promised.
function docState(docs) {
  const rows = docs?.results || [];
  const expiring = rows.filter((d) => d.status === "approved" && d.days_left !== null && d.days_left <= 30);
  return { ok: rows.filter((d) => d.status === "approved" && !(d.days_left !== null && d.days_left <= 30)).length, expiring, missing: docs?.missing || [] };
}

function OffFirst({ me, onGo, busy, error }) {
  const shifts = useRiderShifts();
  const docs = useRiderDocuments();
  const d = docState(docs.data);
  const today = (shifts.data?.results || []).find((s) => new Date(s.starts_at).toDateString() === new Date().toDateString());
  const name = (me.rider.full_name || "").split(" ")[0];
  return (
    <div style={screen}>
      <div>
        <div style={dim}>{longDay(new Date().toISOString())}</div>
        <h1 style={{ margin: "2px 0 0", fontFamily: "Fraunces, Georgia, serif", fontWeight: 600, fontSize: "1.7rem", color: D.text }}>Hello, {name}</h1>
        <div style={dim}>You&apos;re off shift. Your location is not being shared.</div>
      </div>
      {me.rider.suspended && <Warn><b>Your account is suspended.</b> {me.rider.suspension_reason || ""} Call your manager.</Warn>}
      {me.rider.job_hold && <Warn>Your manager has stopped new jobs for now. You can still go on shift.</Warn>}
      <section aria-label="Today's shift" style={{ ...card, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={h2}>{today ? `Today's shift · ${hhmm(today.starts_at)}–${hhmm(today.ends_at)}` : "No shift is planned for today"}</h2>
          <div style={dim}>{today ? `${today.zone?.name || "Any zone"} · set by ${me.rider.manager?.full_name || "your manager"}` : "You can still go on shift."}</div>
        </div>
      </section>
      <section aria-label="Documents" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><h2 style={h2}>Documents</h2><span style={dim}>{d.ok} OK{d.expiring.length ? ` · ${d.expiring.length} expiring` : ""}{d.missing.length ? ` · ${d.missing.length} missing` : ""}</span></div>
        {(docs.data?.results || []).filter((x) => x.status !== "expired" || true).map((x) => (
          <div key={x.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.88rem", color: D.text }}>
            <span><b>{x.kind_label}</b><div style={dim}>{x.expires_on ? `Valid to ${new Date(x.expires_on).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : "No expiry"}</div></span>
            <span style={chip(x.status === "approved" ? (x.days_left !== null && x.days_left <= 30 ? D.amber : D.green) : D.amber)}>{x.status === "approved" ? (x.days_left !== null && x.days_left <= 30 ? `${x.days_left} days left` : "OK") : x.status_label}</span>
          </div>
        ))}
        {d.missing.length > 0 && <Warn><b>You cannot go on shift yet.</b> Missing or out of date: {d.missing.join(", ").replace(/_/g, " ")}. Upload them under Documents &amp; vehicle in the menu.</Warn>}
        {d.expiring.length > 0 && <Warn>{d.expiring.map((x) => `${x.kind_label} ends in ${x.days_left} days`).join("; ")}. An expired document pauses your shifts automatically.</Warn>}
      </section>
      <section aria-label="Vehicle" style={card}>
        <h2 style={h2}>Vehicle</h2>
        {me.rider.vehicle ? <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.9rem", color: D.text }}><span>{me.rider.vehicle_type} · {me.rider.vehicle.description}</span><span style={{ ...mono, background: D.panelBg2, borderRadius: 8, padding: "4px 8px" }}>{me.rider.vehicle.plate}</span></div> : <span style={{ fontSize: "0.88rem", color: D.text }}>No vehicle is assigned to you yet. Your manager assigns one.</span>}
      </section>
      <Err>{error}</Err>
      <button type="button" disabled={busy || me.rider.suspended || !me.papers.can_start_shift} onClick={onGo} style={bigButton(busy || me.rider.suspended || !me.papers.can_start_shift)}>Go on shift</button>
      <ul style={{ margin: 0, padding: "12px 14px 12px 30px", background: D.panelBg2, borderRadius: 12, fontSize: "0.8rem", lineHeight: 1.5, color: D.text }}>
        <li>Going on shift shares your location with dispatch <b>only while this app is open</b>. Phones pause it when you switch apps.</li>
        <li>The screen stays awake while you are on shift. Keep the phone charged and mounted.</li>
        <li>Sharing stops the moment you go off shift.</li>
      </ul>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return <div role="group" aria-label={label} style={{ background: D.panelBg2, borderRadius: 12, padding: "10px 12px" }}><div style={{ fontSize: "0.72rem", fontWeight: 600, color: D.textDim }}>{label}</div><div style={{ fontSize: "1.1rem", fontWeight: 800, color: D.text }}>{value}</div>{sub && <div style={{ fontSize: "0.68rem", color: D.textDim }}>{sub}</div>}</div>;
}

function Waiting({ me, offers, onBreak, onEnd, busy, error }) {
  const earnings = useRiderEarnings("today");
  const cash = useRiderCash();
  const today = useRiderJobs("today");
  const acc = offers.data?.acceptance_30d;
  const onBreakNow = me.shift.on_break;
  return (
    <div style={screen}>
      <section aria-label="Shift" style={card}>
        <h1 style={{ ...h2, fontSize: "1.1rem" }}>On shift · {me.rider.full_name}</h1>
        <div style={dim}>{me.rider.vehicle_type}{me.shift.zone ? ` · ${me.shift.zone}` : ""} · since {hhmm(me.shift.started_at)}</div>
        <LocationLine />
        <div style={{ ...dim, display: "flex", gap: 6 }}><span aria-hidden="true">▯</span> Screen kept awake while you are on shift where your phone allows it.</div>
      </section>
      <section aria-label="Waiting for jobs" style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h2 style={{ ...h2, fontFamily: "Fraunces, Georgia, serif", fontSize: "1.3rem" }}>{onBreakNow ? "On a break" : "Waiting for jobs"}</h2>
          <span style={chip(onBreakNow ? D.textDim : D.green)}>{onBreakNow ? "Offers paused" : "Open to offers"}</span>
        </div>
        <span style={{ fontSize: "0.88rem", color: D.text, lineHeight: 1.5 }}>{onBreakNow ? "You will get no new offers until you end the break. Your shift stays on." : `No offer right now. A new offer fills this screen and you have ${offers.data?.results?.[0] ? "" : "a short time"} to answer. Offers also reach this screen only while the app is open: push alerts are not connected.`}</span>
        <Err>{error}</Err>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" disabled={busy} onClick={onBreak} style={{ ...quietButton(busy), flex: 1 }}>{onBreakNow ? "End the break" : "Take a break"}</button>
          <button type="button" disabled={busy} onClick={onEnd} style={{ ...quietButton(busy), flex: 1 }}>Go off shift</button>
        </div>
        <span style={dim}>A break pauses new offers; your shift stays on.</span>
      </section>
      <section aria-label="Today so far" style={card}>
        <h2 style={h2}>Today so far</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
          <Stat label="Delivered" value={me.today.delivered} sub={me.today.could_not_deliver ? `${me.today.could_not_deliver} could not deliver` : undefined} />
          <Stat label="Earned" value={earnings.data ? money(earnings.data.total) : "…"} sub="Recorded; no money moves yet" />
          <Stat label="Cash you hold" value={cash.data ? (cash.data.holding === null ? "Not applicable" : money(cash.data.holding)) : "…"} sub={cash.data?.holding !== null && cash.data ? `Cap ${money(cash.data.cap)}` : "Cash on delivery is not offered yet"} />
          <Stat label="Acceptance · 30 days" value={acc && acc.of ? `${Math.round(acc.accepted / acc.of * 100)}%` : "No data yet"} sub={acc && acc.of ? `${acc.accepted} of ${acc.of} offers` : undefined} />
          <Stat label="Flagged taps" value={today.data ? today.data.counts.flagged : "…"} />
        </div>
      </section>
    </div>
  );
}

function Offer({ offer, onChanged }) {
  useTick(500);
  const [left, setLeft] = useState(offer.seconds_left);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setLeft(offer.seconds_left); }, [offer.id, offer.seconds_left]);
  useEffect(() => { const id = setInterval(() => setLeft((n) => Math.max(0, n - 1)), 1000); return () => clearInterval(id); }, [offer.id]);
  useEffect(() => { if (left === 0) onChanged(); }, [left]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = 45;
  const act = async (verb) => {
    setError("");
    setBusy(true);
    try { await apiPost(`/api/delivery/rider/offers/${offer.id}/${verb}/`, verb === "decline" ? { reason: "declined" } : {}); onChanged(); } catch (err) { setError(apiErrorMessage(err, `Could not ${verb} the offer.`)); } finally { setBusy(false); }
  };
  const pay = offer.pay;
  return (
    <div style={screen}>
      <section aria-label="New delivery offer" style={{ ...card, border: `2px solid ${D.gold}`, borderRadius: 20, padding: "18px 16px", gap: 14, boxShadow: "0 10px 28px rgba(44,24,16,0.12)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <div style={{ fontSize: "0.74rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: D.deepGold }}>Order #{offer.order_id}</div>
            <h1 style={{ margin: 0, fontFamily: "Fraunces, Georgia, serif", fontWeight: 600, fontSize: "1.7rem", lineHeight: 1.1, color: D.text }}>New delivery offer</h1>
          </div>
          <div role="timer" aria-label={`${left} seconds left to answer`} style={{ ...mono, width: 76, height: 76, borderRadius: "50%", border: `7px solid ${left <= 10 ? D.red : D.gold}`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: "1.1rem", color: D.text, flex: "none" }}>{mmss(left)}</div>
        </div>
        <div>
          <div style={dim}>Pick up{offer.to_pickup_km !== null ? ` · ${offer.to_pickup_km} km from you (estimate)` : ""}</div>
          <div style={{ fontWeight: 800, color: D.text }}>{offer.pickup.business_name || "Pickup not set"}</div>
          <div style={{ ...dim, marginTop: 8 }}>Drop off{offer.trip_km !== null ? ` · ${offer.trip_km} km after pickup (estimate)` : ""}</div>
          <div style={{ fontWeight: 800, color: D.text }}>{offer.delivery_address || "No address"}</div>
          <div style={dim}>{offer.items} item{offer.items === 1 ? "" : "s"}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Stat label="Deliver by" value={offer.deadline_at ? hhmm(offer.deadline_at) : "No limit set"} />
          <Stat label="Payment" value={offer.payment.method === "prepaid" ? "Prepaid" : offer.payment.label} sub={offer.payment.cash_due ? `Collect ${money(offer.payment.cash_due)}` : "No cash to collect"} />
        </div>
        <section aria-label="What you earn" style={{ background: D.panelBg2, borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: D.textDim }}>What you earn</div>
          {pay ? (
            <>
              {pay.lines.map((l) => <div key={l.label} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: D.text }}><span>{l.label}</span><b>{money(l.amount)}</b></div>)}
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: `1px solid ${D.divider}`, paddingTop: 6, fontWeight: 800, color: D.text }}><span>You earn</span><span>{money(pay.total)}</span></div>
            </>
          ) : <span style={{ fontSize: "0.86rem", color: D.text }}>No pay is shown: there is no approved rate card yet, or the route could not be measured.</span>}
        </section>
        <Err>{error}</Err>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" disabled={busy || left === 0} onClick={() => act("accept")} style={{ ...bigButton(busy || left === 0), flex: 2 }}>Accept</button>
          <button type="button" disabled={busy} onClick={() => act("decline")} style={{ ...quietButton(busy), flex: 1 }}>Decline</button>
        </div>
        <span style={dim}>No answer in {total} seconds passes the offer to the next rider. Declining lowers your 30-day acceptance, which dispatch uses when choosing who gets offers.</span>
      </section>
    </div>
  );
}

export default function ShiftPanel() {
  const meQuery = useRiderMe();
  const me = meQuery.data;
  const onShift = Boolean(me?.shift);
  const offers = useRiderOffers(onShift);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [finished, setFinished] = useState(null);

  const go = async () => {
    setError("");
    setBusy(true);
    try {
      const fix = await currentFix();
      await apiPost("/api/delivery/rider/shift/start/", { lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m });
      startTracking({ onJob: false });
      meQuery.refetch();
    } catch (err) {
      const missing = err?.body?.missing || err?.data?.missing;
      setError(missing?.length ? `Missing or out of date: ${missing.join(", ").replace(/_/g, " ")}.` : apiErrorMessage(err, err?.message || "Could not start the shift."));
    } finally {
      setBusy(false);
    }
  };
  const end = async () => {
    setError("");
    setBusy(true);
    try { await apiPost("/api/delivery/rider/shift/end/", {}); stopTracking(); meQuery.refetch(); } catch (err) { setError(apiErrorMessage(err, "Could not end the shift.")); } finally { setBusy(false); }
  };
  const toggleBreak = async () => {
    setError("");
    setBusy(true);
    try { await apiPost("/api/delivery/rider/shift/break/", { on: !me.shift.on_break }); meQuery.refetch(); } catch (err) { setError(apiErrorMessage(err, "Could not change the break.")); } finally { setBusy(false); }
  };

  if (meQuery.isLoading) return <div role="status" style={dim}>Loading…</div>;
  if (meQuery.isError || !me) return <Err>Could not load your shift.</Err>;
  if (finished) return <div style={screen}><ActiveJob jobId={finished} onDelivered={() => { setFinished(null); meQuery.refetch(); }} /></div>;
  if (me.active_job_id) return <ActiveJob jobId={me.active_job_id} onDelivered={(job) => { if (job && (job.status === "delivered" || job.status === "confirmed")) setFinished(job.id); else meQuery.refetch(); }} />;
  if (!onShift) return <OffFirst me={me} onGo={go} busy={busy} error={error} />;
  const offer = offers.data?.results?.[0];
  if (offer && !me.shift.on_break) return <Offer offer={offer} onChanged={() => { offers.refetch(); meQuery.refetch(); }} />;
  return <Waiting me={me} offers={offers} onBreak={toggleBreak} onEnd={end} busy={busy} error={error} />;
}

import { useState } from "react";
import { apiPost, apiPostForm } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { currentFix } from "../../../../lib/riderTracking.js";
import { useRiderCash, useRiderDocuments, useRiderEarnings, useRiderJobs, useRiderMe } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { chip, dim, field } from "../panelStyles.js";
import { ScoutDevices } from "../../shell/ScoutProfile.jsx";
import { Err, Info, Tabs, Warn, bigButton, card, h2, hhmm, mono, money, quietButton, screen } from "./riderParts.jsx";

// ─── Dispatch 10 Jobs, 11 Earnings, 12 Cash, 13 Report an issue, 14 Documents, 16 Menu ───
// Everything is the rider's own data. Pay is a record of what each job earned under the rate card
// in force; payouts are Accounting's and not connected. Cash on delivery is not offered yet, so
// the cash screen says so instead of showing a balance.
const day = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const PERIODS = [["today", "Today"], ["week", "This week"], ["all", "Earlier"]];
const STATUS = { delivered: ["Delivered", D.green], confirmed: ["Delivered", D.green], failed: ["Could not deliver", D.red], assigned: ["Assigned", D.amber], accepted: ["Accepted", D.gold], at_pickup: ["At pickup", D.gold], picked_up: ["On the way", D.blue], at_customer: ["At the customer", D.amber] };

export function JobsScreen() {
  const [scope, setScope] = useState("today");
  const { data, isLoading, isError } = useRiderJobs(scope);
  return (
    <div style={screen}>
      <h1 style={{ ...h2, fontSize: "1.3rem" }}>Jobs</h1>
      <Tabs label="Period" value={scope} onChange={setScope} options={PERIODS.map(([id, t]) => [id === "week" ? "week" : id, t])} />
      {isLoading && <div role="status" style={dim}>Loading…</div>}
      {isError && <Err>Could not load your jobs.</Err>}
      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
            {[["Accepted", data.counts.accepted], ["Delivered", data.counts.delivered], ["Could not deliver", data.counts.could_not_deliver], ["Flagged taps", data.counts.flagged]].map(([l, v]) => (
              <div key={l} role="group" aria-label={l} style={{ background: D.panelBg2, borderRadius: 12, padding: "8px 10px", textAlign: "center" }}><div style={{ fontWeight: 800, fontSize: "1.2rem", color: D.text }}>{v}</div><div style={{ fontSize: "0.64rem", color: D.textDim }}>{l}</div></div>
            ))}
          </div>
          {data.results.length === 0 ? <div style={{ ...card, color: D.text, fontSize: "0.88rem" }}>No job in this period.</div> : data.results.map((j) => {
            const [text, color] = STATUS[j.status] || [j.status_label, D.textDim];
            return (
              <section key={j.id} aria-label={`Order #${j.order_id}`} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b style={{ color: D.text }}>Order #{j.order_id} · {hhmm(j.assigned_at)}</b><span style={chip(color)}>{text}</span></div>
                <div style={{ fontSize: "0.86rem", color: D.text }}>{j.pickup?.business_name || "Pickup not set"} → {j.customer_name}, {j.delivery_address}</div>
                <div style={dim}>{day(j.assigned_at)} · {j.payment.label}{j.calls ? ` · ${j.calls} call${j.calls === 1 ? "" : "s"}` : ""}</div>
                {j.flagged && <Warn>A tap on this job was more than 150 m from its stop and is flagged for your manager.{j.rider_note ? ` Your note: "${j.rider_note}"` : ""}</Warn>}
                {j.status === "failed" && <span style={dim}>Reason: {String(j.failed_reason || "").replace(/_/g, " ")}. Your pay for this trip is decided with the case.</span>}
              </section>
            );
          })}
          <span style={dim}>Showing your most recent 100 jobs at most.</span>
        </>
      )}
    </div>
  );
}

export function EarningsScreen() {
  const [period, setPeriod] = useState("today");
  const { data, isLoading, isError } = useRiderEarnings(period);
  return (
    <div style={screen}>
      <h1 style={{ ...h2, fontSize: "1.3rem" }}>Earnings</h1>
      <Tabs label="Period" value={period} onChange={setPeriod} options={[["today", "Today"], ["week", "Week"]]} />
      <Warn>Payments are simulated until Hubtel is connected. Your pay is recorded; no money moves yet.</Warn>
      {isLoading && <div role="status" style={dim}>Loading…</div>}
      {isError && <Err>Could not load your earnings.</Err>}
      {data && (
        <>
          <section aria-label="Total" style={card}>
            <div style={dim}>{period === "today" ? "Today" : "This week"}</div>
            <div style={{ fontSize: "2rem", fontWeight: 800, color: D.text }}>{money(data.total)}</div>
            <div style={dim}>{data.jobs} job{data.jobs === 1 ? "" : "s"} delivered{data.could_not_deliver ? ` · ${data.could_not_deliver} could not be delivered, pay decided with the case` : ""}{data.jobs_without_pay ? ` · ${data.jobs_without_pay} with no pay recorded` : ""}</div>
          </section>
          <section aria-label="Pay per job" style={card}>
            <h2 style={h2}>Pay per job</h2>
            {data.results.length === 0 ? <span style={{ fontSize: "0.88rem", color: D.text }}>No delivered job in this period.</span> : data.results.map((r) => (
              <div key={r.assignment_id} style={{ borderTop: `1px solid ${D.divider}`, paddingTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: D.text }}><b>#{r.order_id}{r.km ? ` · ${r.km} km` : ""}</b><b>{money(r.pay)}</b></div>
                <div style={dim}>{r.lines.length ? r.lines.map((l) => `${l.label} ${money(l.amount)}`).join(" · ") : "No rate card was in force, or the route could not be measured."}{r.wait_pay_held ? " · waiting pay held" : ""}</div>
              </div>
            ))}
          </section>
          <section aria-label="Rates" style={card}>
            <h2 style={h2}>How your pay is worked out</h2>
            {data.rates ? <span style={{ fontSize: "0.86rem", color: D.text, lineHeight: 1.5 }}>{money(data.rates.per_job)} a job + {money(data.rates.per_km)} a km + {money(data.rates.wait_per_min)} a minute after {data.rates.wait_after_min} minutes waiting (rate card version {data.rates.version}).{data.rate_change_pending ? " A change to the rates is waiting for approval; you will be told before it applies." : ""}</span> : <span style={{ fontSize: "0.86rem", color: D.text }}>No rate card has been approved yet, so no job records any pay.</span>}
          </section>
          <section aria-label="Payouts" style={card}>
            <h2 style={h2}>Payouts</h2>
            <span style={{ fontSize: "0.86rem", color: D.text }}>{data.payouts.note}</span>
          </section>
        </>
      )}
    </div>
  );
}

export function RiderCashScreen() {
  const { data, isLoading, isError } = useRiderCash();
  return (
    <div style={screen}>
      <h1 style={{ ...h2, fontSize: "1.3rem" }}>Cash to remit</h1>
      {isLoading && <div role="status" style={dim}>Loading…</div>}
      {isError && <Err>Could not load your cash.</Err>}
      {data && (
        <>
          {!data.cod.offered ? <Info>{data.cod.note}</Info> : (
            <>
              <section aria-label="Holding" style={card}>
                <div style={dim}>You&apos;re holding</div>
                <div style={{ fontSize: "2rem", fontWeight: 800, color: D.text }}>{money(data.holding)}</div>
                <div style={dim}>Cap {money(data.cap)} · room for {money(data.room)} more</div>
                <span style={dim}>Above {money(data.cap)}, new cash-on-delivery jobs stop until you remit. Prepaid jobs keep coming.</span>
              </section>
              <section aria-label="Today" style={card}>
                <h2 style={h2}>Today</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                  {[["Collected", data.collected_today], ["Remitted", data.remitted_today], ["Holding", data.holding]].map(([l, v]) => <div key={l} role="group" aria-label={l} style={{ background: D.panelBg2, borderRadius: 12, padding: "8px 10px" }}><div style={{ fontSize: "0.7rem", color: D.textDim }}>{l}</div><b style={{ color: D.text }}>{money(v)}</b></div>)}
                </div>
                {data.lines.map((l) => <div key={l.order_id} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.86rem", color: D.text }}><span>Order #{l.order_id} · {hhmm(l.at)}</span><b>{money(l.amount)}</b></div>)}
              </section>
            </>
          )}
          <section aria-label="Your hand-overs" style={card}>
            <h2 style={h2}>Your hand-overs</h2>
            {data.handovers.length === 0 ? <span style={{ fontSize: "0.86rem", color: D.text }}>No hand-over has been counted for you.</span> : data.handovers.map((h) => <div key={h.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.86rem", color: D.text }}><span>{day(h.at)} · counted by {h.counted_by}</span><b>{money(h.counted)}{Number(h.difference) < 0 ? ` (short ${money(-Number(h.difference))})` : ""}</b></div>)}
          </section>
          <section aria-label="How to remit" style={card}>
            <h2 style={h2}>How to remit</h2>
            <span style={{ fontSize: "0.86rem", color: D.text, lineHeight: 1.5 }}>{data.how} Paying in by MoMo comes when Hubtel is connected.</span>
          </section>
        </>
      )}
    </div>
  );
}

const ISSUES = [["vehicle", "Vehicle problem"], ["accident", "Accident"], ["item", "Item missing or damaged"], ["customer", "Problem with the customer"], ["app", "App problem"], ["other", "Something else"]];

export function ReportIssueScreen() {
  const me = useRiderMe();
  const jobs = useRiderJobs("today");
  const [kind, setKind] = useState("");
  const [job, setJob] = useState("");
  const [text, setText] = useState("");
  const [pause, setPause] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const manager = me.data?.rider?.manager;
  const send = async () => {
    setError("");
    setBusy(true);
    let fix = null;
    try { fix = await currentFix(); } catch { fix = null; }
    try {
      await apiPost("/api/delivery/rider/issues/", { kind, text, job: job || undefined, lat: fix?.lat, lng: fix?.lng, pause_offers: pause });
      setSent(true);
      me.refetch();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not send this."));
    } finally {
      setBusy(false);
    }
  };
  if (sent) return <div style={screen}><section style={card}><h1 style={h2}>Sent to {manager?.full_name || "your manager"}</h1><span style={{ fontSize: "0.88rem", color: D.text }}>They have been told with the time{pause ? ". New offers are paused; end the break from Shift when you are ready" : ""}.</span></section><button type="button" onClick={() => { setSent(false); setKind(""); setText(""); }} style={quietButton(false)}>Report another</button></div>;
  return (
    <div style={screen}>
      <h1 style={{ ...h2, fontSize: "1.3rem" }}>Report an issue</h1>
      <span style={dim}>Goes straight to {manager?.full_name || "your manager"}, Delivery Manager.</span>
      <Warn>Is anyone hurt? <a href="tel:112" style={{ color: D.warnInk, fontWeight: 800 }}>Call 112</a> first.</Warn>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <legend style={{ fontWeight: 800, color: D.text, marginBottom: 6 }}>What kind of problem?</legend>
        {ISSUES.map(([id, label]) => <label key={id} style={{ display: "flex", gap: 8, alignItems: "center", border: `1px solid ${kind === id ? D.text : D.cardBorder}`, borderRadius: 12, padding: "10px 12px" }}><input type="radio" name="kind" checked={kind === id} onChange={() => setKind(id)} />{label}</label>)}
      </fieldset>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontWeight: 800, fontSize: "0.82rem", color: D.text }}>Which job?
        <select value={job} onChange={(e) => setJob(e.target.value)} style={field}>
          <option value="">No job right now</option>
          {(jobs.data?.results || []).map((j) => <option key={j.id} value={j.id}>Order #{j.order_id} · {j.pickup?.business_name || "pickup"} ({j.status_label})</option>)}
        </select>
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontWeight: 800, fontSize: "0.82rem", color: D.text }}>What happened
        <textarea rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} style={field} />
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.86rem", color: D.text }}><input type="checkbox" checked={pause} onChange={(e) => setPause(e.target.checked)} /><span><b>Pause new offers while I sort this out</b><div style={dim}>Your shift stays on. Turn offers back on from Shift.</div></span></label>
      <Err>{error}</Err>
      <button type="button" disabled={!kind || busy} onClick={send} style={bigButton(!kind || busy)}>Send to {(manager?.full_name || "your manager").split(" ")[0]}</button>
      {manager?.phone && <a href={`tel:${manager.phone}`} style={{ ...quietButton(false), display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}>Call {manager.full_name.split(" ")[0]}</a>}
      <span style={dim}>Sent with the time and your location. Photos are not attached to issues yet.</span>
    </div>
  );
}

const DOC_KINDS = [["insurance", "Insurance"], ["roadworthy", "Roadworthy"], ["licence", "Driver's licence"], ["ghana_card", "Ghana Card"], ["vehicle_reg", "Vehicle registration"], ["okada_licence", "Commercial rider's licence (pending DVLA)"]];

export function RiderDocumentsScreen() {
  const docs = useRiderDocuments();
  const me = useRiderMe();
  const [kind, setKind] = useState("insurance");
  const [expires, setExpires] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = docs.data?.results || [];
  const soon = rows.filter((d) => d.status === "approved" && d.days_left !== null && d.days_left <= 30);
  const send = async () => {
    setError("");
    setDone("");
    setBusy(true);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      if (expires) form.append("expires_on", expires);
      await apiPostForm("/api/delivery/rider/documents/", form);
      setDone("Sent for checking.");
      setFile(null);
      docs.refetch();
    } catch (err) {
      setError(apiErrorMessage(err, "Could not send the paper."));
    } finally {
      setBusy(false);
    }
  };
  const v = me.data?.rider?.vehicle;
  return (
    <div style={screen}>
      <h1 style={{ ...h2, fontSize: "1.3rem" }}>Documents &amp; vehicle</h1>
      {soon.length > 0 && <Warn>{soon.map((d) => `${d.kind_label} ends in ${d.days_left} days`).join("; ")}. An expired document pauses your shifts automatically until a renewal is checked.</Warn>}
      <section aria-label="Documents" style={card}>
        <h2 style={h2}>Documents</h2>
        <span style={dim}>You upload; {me.data?.rider?.manager?.full_name || "your manager"} checks. Nobody approves their own documents.</span>
        {docs.isLoading && <div role="status" style={dim}>Loading…</div>}
        {rows.map((d) => (
          <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.88rem", color: D.text }}>
            <span><b>{d.kind_label}</b><div style={dim}>{d.expires_on ? `Ends ${new Date(d.expires_on).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : "No expiry"}{d.number_masked ? ` · ${d.number_masked}` : ""}{d.reject_reason ? ` · sent back: ${d.reject_reason}` : ""}</div></span>
            <span style={chip(d.status === "approved" ? D.green : d.status === "uploaded" ? D.amber : D.red)}>{d.status_label}</span>
          </div>
        ))}
        {docs.data?.missing?.length > 0 && <Warn>Missing or out of date: {docs.data.missing.join(", ").replace(/_/g, " ")}.</Warn>}
      </section>
      <section aria-label="Vehicle" style={card}>
        <h2 style={h2}>Vehicle</h2>
        {v ? <div style={{ display: "flex", justifyContent: "space-between", color: D.text }}><span>{me.data.rider.vehicle_type} · {v.description}</span><span style={{ ...mono, background: D.panelBg2, borderRadius: 8, padding: "4px 8px" }}>{v.plate}</span></div> : <span style={{ fontSize: "0.88rem", color: D.text }}>No vehicle is assigned to you yet.</span>}
      </section>
      <section aria-label="Upload a renewal" style={card}>
        <h2 style={h2}>Upload a renewal</h2>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontWeight: 800, fontSize: "0.8rem", color: D.text }}>Document
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={field}>{DOC_KINDS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontWeight: 800, fontSize: "0.8rem", color: D.text }}>New end date
          <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} style={field} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontWeight: 800, fontSize: "0.8rem", color: D.text }}>Photo or PDF of the new certificate
          <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </label>
        <Err>{error}</Err>
        {done && <div role="status" style={{ color: D.green, fontWeight: 700 }}>{done}</div>}
        <button type="button" disabled={!file || busy} onClick={send} style={bigButton(!file || busy)}>Send for checking</button>
        <span style={dim}>Your current certificate counts until it ends.</span>
      </section>
    </div>
  );
}

export function RiderMenuScreen({ auth, onSelect, onSignOut }) {
  const me = useRiderMe();
  const r = me.data?.rider;
  const initials = (auth.user?.full_name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
  const link = (id, label) => <button key={id} type="button" onClick={() => onSelect(id)} style={{ ...quietButton(false), textAlign: "left", display: "flex", justifyContent: "space-between" }}>{label}<span aria-hidden="true">›</span></button>;
  return (
    <div style={screen}>
      <h1 style={{ ...h2, fontSize: "1.3rem" }}>Menu</h1>
      <section aria-label="Profile" style={{ ...card, flexDirection: "row", alignItems: "center" }}>
        <div aria-hidden="true" style={{ width: 52, height: 52, borderRadius: "50%", background: D.text, color: D.pageBg, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, flex: "none" }}>{initials}</div>
        <div>
          <div style={{ fontWeight: 800, color: D.text }}>{auth.user?.full_name}</div>
          <div style={dim}>Dispatch rider{r ? ` · ${r.vehicle_type}${r.home_zone ? ` · ${r.home_zone}` : ""}` : ""}</div>
          {r?.manager && <div style={dim}>Reports to {r.manager.full_name}, Delivery Manager</div>}
          {me.data?.shift && <div style={{ ...dim, color: D.okInk, fontWeight: 700 }}>On shift since {hhmm(me.data.shift.started_at)}</div>}
        </div>
      </section>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {link("dr-issue", "Report an issue")}
        {link("dr-documents", "Documents & vehicle")}
        {link("reports", "End of day report")}
        {link("tasks", "Tasks")}
        {link("activity", "My activity")}
        {link("security", "Sign-in & security")}
      </div>
      <Info>Name and phone changes go to {r?.manager?.full_name || "your manager"} for approval.</Info>
      <ScoutDevices />
      <button type="button" onClick={onSignOut} style={quietButton(false)}>Sign out</button>
      <span style={dim}>Signing out stops location sharing. End your shift first if a job is on the road.</span>
    </div>
  );
}

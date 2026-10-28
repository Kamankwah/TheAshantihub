import { useState } from "react";
import { apiPatch, apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { saveBlob } from "../../../../lib/saveBlob.js";
import { useDeliveryRider, useDeliveryRiders, useDeliveryZones } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { button, chip, dim, field } from "../panelStyles.js";
import { scroll, table, td, th } from "../opsPeopleParts.jsx";
import { Kpi, Status, Title, kpiGrid, page, section, sectionTitle } from "../insightsParts.jsx";
import RiderEmploymentSection from "./RiderEmploymentSection.jsx";
import { Empty, ErrorLine, Filters, Note, WARN, clock, dayOnly, dayTime, fixAge, linkStyle, mono, money } from "./deliveryParts.jsx";

// ─── Delivery Manager 07 Riders & drivers and 08 Rider profile ───────────────
// Counted from assignments, offers and shifts. A figure with no source is the word the screen
// gives for it: on time needs jobs that had a deliver-by time, cash needs cash on delivery.
const STATUS_COLOR = { on_shift: D.green, on_job: D.gold, break: D.textDim, off_shift: D.textDim, suspended: D.red, invited: D.amber };
const VEHICLES = [["", "All vehicles"], ["motorbike", "Motorbike"], ["tricycle", "Tricycle"], ["car", "Car"], ["van", "Van"]];
const rate = (pair) => (!pair || !pair.of ? "No data yet" : `${Math.round((pair.on_time ?? pair.accepted) / pair.of * 100)}%`);
const low = (pair) => Boolean(pair && pair.of && (pair.on_time ?? pair.accepted) / pair.of < 0.85);

export function RidersList({ onOpenRider, onNavigate }) {
  const [zone, setZone] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [status, setStatus] = useState("");
  const zones = useDeliveryZones();
  const { data, isLoading, isError } = useDeliveryRiders({ zone, vehicle, status });
  const csv = () => {
    const head = ["Name", "Status", "Vehicle", "Zone", "Jobs today", "On time 30 d", "Acceptance 30 d", "Cash held"];
    const body = data.results.map((r) => [r.full_name, r.status_label, r.vehicle_type, r.home_zone?.name || "", r.jobs_today, rate(r.on_time_30d), rate(r.acceptance_30d), r.cash_held ?? "Not applicable"]);
    const text = [head, ...body].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    saveBlob(new Blob([text], { type: "text/csv" }), "riders.csv");
  };
  const counts = data?.counts || {};
  return (
    <div style={page}>
      <Title right={(
        <>
          {data && <button type="button" onClick={csv} style={button(D.panelBg, D.text)}>Export list</button>}
          <button type="button" onClick={() => onNavigate?.("dm-invite")} style={button(D.gold, D.text)}>Invite a rider</button>
        </>
      )}>Riders &amp; drivers</Title>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <div style={kpiGrid}>
              <Kpi label="On shift" value={(counts.on_shift || 0) + (counts.on_job || 0) + (counts.break || 0)} sub={`${counts.on_job || 0} on a job · ${counts.break || 0} on a break`} />
              <Kpi label="Off shift" value={counts.off_shift || 0} />
              <Kpi label="Suspended" value={counts.suspended || 0} subColor={WARN} />
              <Kpi label="Invited, not signed in" value={counts.invited || 0} />
            </div>
            <Filters label="Status" value={status} onChange={setStatus} options={[["", `All · ${data.total}`], ["on_shift", "Free"], ["on_job", "On a job"], ["break", "On a break"], ["off_shift", "Off shift"], ["suspended", "Suspended"], ["invited", "Invited"]]} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>Zone
                <select value={zone} onChange={(e) => setZone(e.target.value)} style={field}><option value="">All zones</option>{(zones.data?.results || []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>Vehicle
                <select value={vehicle} onChange={(e) => setVehicle(e.target.value)} style={field}>{VEHICLES.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>
              </label>
            </div>
            <section aria-labelledby="roster" style={section}>
              <h3 id="roster" style={sectionTitle}>Roster · {data.results.length} {data.results.length === 1 ? "person" : "people"}</h3>
              {data.results.length === 0 ? <Empty>No rider matches. Riders you invite appear here.</Empty> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Rider or driver", "Status", "Vehicle", "Zone", "Jobs today", "On time · 30 d", "Acceptance · 30 d", "Cash held", "Location"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {data.results.map((r) => (
                        <tr key={r.id}>
                          <td style={td}><button type="button" onClick={() => onOpenRider?.(r.id)} style={linkStyle}>{r.full_name}</button></td>
                          <td style={td}><span style={chip(STATUS_COLOR[r.status])}>{r.status_label}</span>{r.job_hold && <div style={dim}>Stopped from new jobs</div>}{r.papers.expired > 0 && <div style={{ ...dim, color: WARN }}>A paper has expired</div>}</td>
                          <td style={td}>{r.vehicle_type}{r.vehicle && <div style={dim}>{r.vehicle.plate}</div>}</td>
                          <td style={td}>{r.home_zone?.name || <span style={dim}>None</span>}</td>
                          <td style={td}>{r.jobs_today}<div style={dim}>{r.delivered_today} delivered</div></td>
                          <td style={{ ...td, color: low(r.on_time_30d) ? WARN : D.text, fontWeight: low(r.on_time_30d) ? 800 : 400 }}>{rate(r.on_time_30d)}</td>
                          <td style={{ ...td, color: low(r.acceptance_30d) ? WARN : D.text, fontWeight: low(r.acceptance_30d) ? 800 : 400 }}>{rate(r.acceptance_30d)}</td>
                          <td style={td}>{r.cash_held === null ? <span style={dim}>Not applicable</span> : money(r.cash_held)}</td>
                          <td style={td}>{r.location ? <span style={{ color: r.location.stale ? WARN : D.text }}>{fixAge(r.location.age_seconds, r.location.stale)}</span> : <span style={dim}>Off shift</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <span style={dim}>Riders and drivers have the Dispatch role: they see only their own jobs, earnings and cash. Location is shared only while their shift screen is open. Red figures are below 85%. Cash on delivery is not offered at checkout yet, so no rider holds cash.</span>
            </section>
          </>
        )}
      </Status>
    </div>
  );
}

function Suspend({ staff, suspended, onDone }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const run = async () => {
    setError("");
    try {
      await apiPost(`/api/accounts/staff/${staff.id}/${suspended ? "unsuspend" : "suspend"}/`, suspended ? {} : { reason: reason.trim() });
      setOpen(false);
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, suspended ? "Could not lift the suspension." : "Could not suspend."));
    }
  };
  if (!open) return <button type="button" onClick={() => setOpen(true)} style={button(suspended ? D.green : D.red, "#fff")}>{suspended ? "Lift suspension" : "Suspend"}</button>;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <ErrorLine>{error}</ErrorLine>
      {!suspended && <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>Reason (the rider is told)<input value={reason} onChange={(e) => setReason(e.target.value)} style={field} /></label>}
      <button type="button" disabled={!suspended && !reason.trim()} onClick={run} style={button(D.red, "#fff", !suspended && !reason.trim())}>{suspended ? "Lift it" : "Confirm suspension"}</button>
      <button type="button" onClick={() => setOpen(false)} style={button(D.panelBg, D.text)}>Cancel</button>
    </div>
  );
}

export function RiderProfile({ id, onBack, onOpenDelivery, onNavigate }) {
  const { data, isLoading, isError, refetch } = useDeliveryRider(id);
  const zones = useDeliveryZones();
  const [error, setError] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const act = async (fn, failure) => {
    setError("");
    try { await fn(); refetch(); } catch (err) { setError(apiErrorMessage(err, failure)); }
  };
  const r = data?.rider;
  const s = data?.staff;
  return (
    <div style={page}>
      <button type="button" onClick={onBack} style={{ ...linkStyle, alignSelf: "flex-start" }}>Back to riders &amp; drivers</button>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            <Title right={(
              <>
                <span style={chip(STATUS_COLOR[r.status])}>{r.status_label}</span>
                <Suspend staff={s} suspended={r.suspended} onDone={refetch} />
                {r.suspended && r.suspension_source === "documents" && <button type="button" onClick={() => act(() => apiPost(`/api/delivery/riders/${id}/reinstate/`, {}), "Could not reinstate this rider.")} style={button(D.gold, D.text)}>Reinstate (papers are in order)</button>}
              </>
            )}>{s.full_name}</Title>
            <div style={{ fontSize: "0.82rem", color: D.text }}>
              {r.vehicle_type} · {r.home_zone?.name || "no zone"} zone · reports to {s.manager?.full_name || "no one"} · {s.start_date ? `joined ${dayOnly(s.start_date)}` : s.activated_at ? `joined ${dayOnly(s.activated_at)}` : "invite not accepted yet"} · {s.phone ? `phone ${s.phone.slice(0, 4)} ••• ${s.phone.slice(-3)}` : "no phone on file"}
            </div>
            <ErrorLine>{error}</ErrorLine>
            {r.suspended && <Note tone="warn">Suspended{r.suspension_reason ? `: ${r.suspension_reason}` : ""}. {r.suspension_source === "documents" ? "A required paper lapsed. Reinstate once every paper is approved and in date." : "Suspended by a manager."}</Note>}
            <div style={kpiGrid}>
              <Kpi label="Jobs today" value={r.jobs_today} sub={`${r.delivered_today} delivered`} />
              <Kpi label="On time · 30 d" value={rate(r.on_time_30d)} sub={r.on_time_30d.of ? `${r.on_time_30d.on_time} of ${r.on_time_30d.of}` : "No deliver-by times yet"} />
              <Kpi label="Acceptance · 30 d" value={rate(r.acceptance_30d)} sub={r.acceptance_30d.of ? `${r.acceptance_30d.accepted} of ${r.acceptance_30d.of} offers` : "No offers answered yet"} />
              <Kpi label="Delivered · 30 d" value={r.delivered_30d} sub={`${r.could_not_deliver_30d} could not deliver`} />
              <Kpi label="Cash held" value={r.cash_held === null ? "Not applicable" : money(r.cash_held)} sub="Cash on delivery is not offered yet" />
            </div>

            <section aria-labelledby="docs" style={section}>
              <h3 id="docs" style={sectionTitle}>Documents</h3>
              {data.documents.length === 0 ? <Empty>No paper has been uploaded.</Empty> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Document", "Number", "Expires", "Status"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>{data.documents.map((d) => (
                      <tr key={d.id}><td style={{ ...td, fontWeight: 700 }}>{d.kind_label}{!d.required && <div style={dim}>Optional</div>}</td><td style={{ ...td, ...mono }}>{d.number_masked || "None"}</td><td style={td}>{d.expires_on ? dayOnly(d.expires_on) : "No expiry"}{d.days_left !== null && d.days_left <= 30 && <div style={{ ...dim, color: WARN }}>{d.days_left < 0 ? "Expired" : `${d.days_left} days left`}</div>}</td><td style={td}>{d.status_label}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
              {r.papers.missing.length > 0 && <Note tone="warn">Missing or out of date: {r.papers.missing.join(", ").replace(/_/g, " ")}. This rider cannot start a shift.</Note>}
              <span style={dim}>An expired paper suspends the rider automatically on the expiry date, after any job on the road is finished. Reminders go 30, 14 and 7 days before, in the app.</span>
              <div><button type="button" onClick={() => onNavigate?.("dm-documents")} style={button(D.panelBg, D.text)}>Open the documents queue</button></div>
            </section>

            <section aria-labelledby="jobs" style={section}>
              <h3 id="jobs" style={sectionTitle}>Recent jobs</h3>
              {data.recent_jobs.length === 0 ? <Empty>No job yet.</Empty> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Order", "Address", "Result", "Assigned"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>{data.recent_jobs.map((j) => (
                      <tr key={j.id}><td style={td}><button type="button" onClick={() => onOpenDelivery?.(j.id)} style={linkStyle}>#{j.order_id}</button></td><td style={td}>{j.address || "No address"}</td><td style={td}>{j.status_label}{j.flagged && <span style={{ ...chip(D.amber), marginLeft: 6 }}>Flagged</span>}</td><td style={td}>{dayTime(j.assigned_at)}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </section>

            <section aria-labelledby="veh" style={section}>
              <h3 id="veh" style={sectionTitle}>Vehicle</h3>
              {data.vehicle ? (
                <div style={{ fontSize: "0.82rem", color: D.text }}>
                  <b>{data.vehicle.vehicle_type_label}</b> {data.vehicle.description} · <span style={mono}>{data.vehicle.plate}</span> · {data.vehicle.owner_label}
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{data.vehicle.papers.map((p) => <li key={p.label}>{p.label}: {p.expires_on ? dayOnly(p.expires_on) : "not recorded"}</li>)}</ul>
                </div>
              ) : <Empty>No vehicle is assigned. Assign one under Vehicles.</Empty>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>Home zone
                  <select value={r.home_zone?.id || ""} onChange={(e) => act(() => apiPatch(`/api/delivery/riders/${id}/`, { home_zone: e.target.value ? Number(e.target.value) : null }), "Could not change the zone.")} style={field}>
                    <option value="">None</option>{(zones.data?.results || []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                </label>
              </div>
            </section>

            <section aria-labelledby="ctl" style={section}>
              <h3 id="ctl" style={sectionTitle}>New jobs</h3>
              <span style={{ fontSize: "0.82rem", color: D.text }}>{r.job_hold ? "New jobs are stopped for this rider. Auto-assign skips them; you can still assign by hand." : "This rider can be offered new jobs."}</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                {!r.job_hold && <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>Reason<input value={holdReason} onChange={(e) => setHoldReason(e.target.value)} style={field} /></label>}
                <button type="button" onClick={() => act(() => apiPost(`/api/delivery/riders/${id}/job-hold/`, { hold: !r.job_hold, reason: holdReason }), "Could not change this.")} style={button(D.panelBg, D.text)}>{r.job_hold ? "Resume new jobs" : "Stop new jobs"}</button>
              </div>
            </section>

            {data.employment && <RiderEmploymentSection riderId={id} employment={data.employment} onDone={refetch} />}

            <section aria-labelledby="dev" style={section}>
              <h3 id="dev" style={sectionTitle}>Phone and sign-ins</h3>
              {data.devices.length === 0 ? <Empty>No signed-in device.</Empty> : data.devices.map((d) => (
                <div key={d.id} style={{ fontSize: "0.82rem", color: D.text }}>{d.device_label || "Unnamed device"} · signed in {dayTime(d.signed_in_at)} · last seen {dayTime(d.last_seen_at)}</div>
              ))}
              {r.location && <span style={dim}>{fixAge(r.location.age_seconds, r.location.stale)} (last fix {clock(r.location.last_fix_at)}).</span>}
              <div><button type="button" onClick={() => act(() => apiPost(`/api/accounts/staff/${s.id}/sign-out-everywhere/`, {}), "Could not sign this rider out.")} style={button(D.panelBg, D.text)}>Sign out every device</button></div>
            </section>

            <section aria-labelledby="pay" style={section}>
              <h3 id="pay" style={sectionTitle}>Pay</h3>
              <span style={{ fontSize: "0.82rem", color: D.text }}>Rider pay is recorded per delivered job. Weekly payout runs arrive with Accounting; payments are simulated until Hubtel is connected.</span>
              {data.employment?.wallet && <span style={{ fontSize: "0.82rem", color: D.text }}>This rider is a third-party rider. Deliveries on orders paid through the wallet ledger are paid into their AshantiHub wallet when Support confirms the order, and Rider payouts does not count them.</span>}
              <div><button type="button" onClick={() => onNavigate?.("dm-payouts")} style={button(D.panelBg, D.text)}>Open rider payouts</button></div>
            </section>
          </>
        )}
      </Status>
    </div>
  );
}

export default function Riders({ detailId, onOpenDetail, onOpenDelivery, onNavigate }) {
  if (detailId != null) return <RiderProfile id={detailId} onBack={() => onOpenDetail(null)} onOpenDelivery={onOpenDelivery} onNavigate={onNavigate} />;
  return <RidersList onOpenRider={onOpenDetail} onNavigate={onNavigate} />;
}

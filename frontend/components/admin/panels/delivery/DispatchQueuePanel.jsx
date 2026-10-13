import { useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useDeliveryDispatchQueue, useQueueRanking } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { button, chip, dim, field } from "../panelStyles.js";
import { scroll, table, td, th } from "../opsPeopleParts.jsx";
import { Status, Title, page, section, sectionTitle } from "../insightsParts.jsx";
import { Empty, ErrorLine, Note, SOURCE_LABEL, WARN, clock, linkStyle, spare, span } from "./deliveryParts.jsx";

// ─── Delivery Manager 02 Dispatch queue ──────────────────────────────────────
// Waiting orders, least time to spare first. What is ranked is exactly what the engine
// would do (backend/delivery/dispatching.py): the three parts of the score and their weights
// are shown, and a rider left out is named with the reason. An order with no deliver-by time
// (no time limits in force) sorts by how long it has waited and says so.
const SHORT_MINUTES = 10;

// What the server says about how distances were measured; nothing is assumed when it says nothing.
const distanceSentence = (routing) => {
  if (!routing || !routing.mode) return "";
  return routing.mode === "road" ? "Distances are road routes." : `Distances are a straight-line estimate times ${routing.factor}.`;
};

function Ranking({ orderId, row, onDone, canForce, routing }) {
  const { data, isLoading, isError } = useQueueRanking(orderId);
  const [rider, setRider] = useState("");
  const [releaseAt, setReleaseAt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (path, body, failure) => {
    setError("");
    setBusy(true);
    try {
      await apiPost(`/api/delivery/queue/${orderId}/${path}/`, body);
      onDone();
    } catch (err) {
      setError(apiErrorMessage(err, failure));
    } finally {
      setBusy(false);
    }
  };
  const eligible = data?.eligible || [];
  const chosen = rider || (eligible[0] ? String(eligible[0].rider_id) : "");
  const short = row.minutes_to_spare !== null && row.minutes_to_spare < SHORT_MINUTES;
  const pick = eligible.find((e) => String(e.rider_id) === chosen);

  return (
    <section aria-label={`Order #${orderId} detail`} style={section}>
      <h3 style={sectionTitle}>Order #{orderId}: choose a rider</h3>
      <ErrorLine>{error}</ErrorLine>
      <Status isLoading={isLoading} isError={isError}>
        {data && (
          <>
            {!data.pickup_located && <Note tone="warn">This business has no map pin, so the engine cannot rank riders. You can still pick a rider by hand below.</Note>}
            {row.offer && <Note>Offered to <b>{row.offer.rider}</b>, {span(row.offer.seconds_left)} left. If time runs out the offer passes to the next rider.</Note>}
            {short && <Note tone="warn"><b>Time is short.</b> Under {SHORT_MINUTES} minutes to spare. You can force-assign a rider now: they are told the job is assigned, not offered.</Note>}
            <div style={scroll}>
              <table style={table}>
                <thead><tr>{["Rider", "Distance", "Fairness", "Idle", "Score"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {eligible.length === 0 && <tr><td colSpan={5} style={td}>{data.left_out.length ? "No rider is eligible." : "No rider exists."}</td></tr>}
                  {eligible.map((e, i) => (
                    <tr key={e.rider_id}>
                      <td style={{ ...td, fontWeight: 800 }}>{e.full_name}{i === 0 && <span style={{ ...chip(D.green), marginLeft: 6 }}>Best</span>}<div style={dim}>{e.vehicle_type} · {e.active_jobs} active</div></td>
                      {e.parts.map((p) => <td key={p.key} style={td}>{p.points} <span style={dim}>× {p.weight}</span><div style={dim}>{p.label}</div></td>)}
                      <td style={{ ...td, fontWeight: 800 }}>{e.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <span style={dim}>Score is the sum of each part (0 to 100) times its weight; the highest score is offered first. {distanceSentence(routing)} Weights are set in Auto-assign rules.</span>
            {data.left_out.length > 0 && (
              <div>
                <b style={{ fontSize: "0.8rem", color: D.text }}>Left out</b>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: "0.78rem", color: D.text }}>
                  {data.left_out.map((x) => <li key={x.rider_id}>{x.full_name}: {x.reason}</li>)}
                </ul>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>
                Rider
                <select value={chosen} onChange={(e) => setRider(e.target.value)} style={field}>
                  {eligible.length === 0 && <option value="">No eligible rider</option>}
                  {eligible.map((e) => <option key={e.rider_id} value={e.rider_id}>{e.full_name} · score {e.total}</option>)}
                </select>
              </label>
              <button type="button" disabled={busy || !chosen} onClick={() => act("offer", { rider: Number(chosen) }, "Could not send the offer.")} style={button(D.gold, D.text, busy || !chosen)}>{pick ? `Offer to ${pick.full_name}` : "Offer"}</button>
              {canForce && <button type="button" disabled={busy || !chosen} onClick={() => act("force-assign", { rider: Number(chosen) }, "Could not assign the order.")} style={button(D.panelBg, D.text, busy || !chosen)}>Force-assign now</button>}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: "0.7rem", fontWeight: 700, color: D.text }}>
                Hold until
                <input type="datetime-local" value={releaseAt} onChange={(e) => setReleaseAt(e.target.value)} style={field} />
              </label>
              <button type="button" disabled={busy || !releaseAt} onClick={() => act("schedule", { release_at: new Date(releaseAt).toISOString() }, "Could not schedule this order.")} style={button(D.panelBg, D.text, busy || !releaseAt)}>Schedule</button>
              {row.held_until && <button type="button" disabled={busy} onClick={() => act("schedule", { release_at: null }, "Could not release this order.")} style={button(D.panelBg, D.text, busy)}>Release now (held until {clock(row.held_until)})</button>}
            </div>
          </>
        )}
      </Status>
    </section>
  );
}

export default function DispatchQueuePanel({ auth, onNavigate }) {
  const queue = useDeliveryDispatchQueue();
  const [selected, setSelected] = useState(null);
  const data = queue.data;
  const rows = data?.results || [];
  const row = rows.find((r) => r.order_id === selected);

  return (
    <div style={page}>
      <Title right={(
        <>
          {data && <span style={chip(data.auto_assign.on ? D.green : D.amber)}>{data.auto_assign.on ? "Auto-assign on" : "Auto-assign off"}</span>}
          <button type="button" onClick={() => onNavigate?.("dm-autoassign")} style={button(D.panelBg, D.text)}>Auto-assign rules</button>
        </>
      )}>Dispatch queue</Title>
      <Status isLoading={queue.isLoading} isError={queue.isError}>
        {data && (
          <>
            {data.deadlines === "none" && <Note>No delivery time limits are in force, so orders have no deliver-by time. They are listed by how long they have waited.</Note>}
            <section aria-labelledby="wait" style={section}>
              <h3 id="wait" style={sectionTitle}>Waiting for a rider ({data.total}), least time to spare first</h3>
              {rows.length === 0 ? <Empty>No order is waiting for a rider.</Empty> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Order", "Route", "Time", "State", "Pick", ""].map((h, i) => <th key={i} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {rows.map((o) => (
                        <tr key={o.order_id} style={{ background: o.order_id === selected ? D.panelBg2 : "transparent" }}>
                          <td style={{ ...td, fontWeight: 800 }}>#{o.order_id}{o.returned && <div style={dim}>Returned after a failed attempt</div>}</td>
                          <td style={td}>{o.route.from || "Pickup not set"} → {o.route.to || "No address"}<div style={dim}>{o.unzoned ? "Outside every zone" : o.zone} · {o.payment.label}</div></td>
                          <td style={td}><span style={{ fontWeight: 800, color: o.minutes_to_spare !== null && o.minutes_to_spare < SHORT_MINUTES ? WARN : D.text }}>{o.minutes_to_spare === null ? `Waiting ${span(o.waiting_minutes * 60)}` : spare(o.minutes_to_spare)}</span>{o.deadline_at && <div style={dim}>Deliver by {clock(o.deadline_at)}</div>}</td>
                          <td style={td}>{o.offer ? <span style={chip(D.gold)}>Offered to {o.offer.rider}, {span(o.offer.seconds_left)} left</span> : o.held_until ? <span style={chip(D.textDim)}>Held until {clock(o.held_until)}</span> : <span style={chip(D.amber)}>Waiting</span>}{o.refusals > 0 && <div style={dim}>{o.refusals} declined or timed out</div>}</td>
                          <td style={td}>{o.suggested ? <>{o.suggested.full_name}<div style={dim}>score {o.suggested.total}{o.suggested.km !== null ? ` · ${o.suggested.km} km` : ""} · {o.eligible} eligible</div></> : <span style={dim}>{o.pickup_located ? "No eligible rider" : "Pickup location missing"}</span>}</td>
                          <td style={td}><button type="button" onClick={() => setSelected(o.order_id === selected ? null : o.order_id)} style={linkStyle}>{o.order_id === selected ? "Close" : "Choose rider"}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
            {row && <Ranking key={row.order_id} orderId={row.order_id} row={row} canForce routing={data.routing} onDone={() => { queue.refetch(); setSelected(null); }} />}
            <section aria-labelledby="recent" style={section}>
              <h3 id="recent" style={sectionTitle}>Assigned in the last 30 minutes</h3>
              {data.recent.length === 0 ? <Empty>Nothing was assigned in the last 30 minutes.</Empty> : data.recent.map((r) => (
                <div key={`${r.order_id}-${r.at}`} style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: "0.8rem", color: D.text }}>
                  <span style={{ minWidth: 48 }}>{clock(r.at)}</span><span style={{ fontWeight: 800 }}>#{r.order_id} → {r.rider}</span><span style={dim}>{SOURCE_LABEL[r.mode] || r.mode_label}</span>
                </div>
              ))}
            </section>
            {data.routing?.note && <span style={dim}>{data.routing.note}</span>}
          </>
        )}
      </Status>
    </div>
  );
}

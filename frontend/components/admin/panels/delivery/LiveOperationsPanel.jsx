import { useState } from "react";
import { apiPost } from "../../../../apiClient.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { useDeliveryDispatchQueue, useDeliveryLive } from "../../../../hooks/useDelivery.js";
import { D } from "../../theme.js";
import { button, chip, dim } from "../panelStyles.js";
import { scroll, table, td, th } from "../opsPeopleParts.jsx";
import { Kpi, Status, Title, kpiGrid, page, section, sectionTitle } from "../insightsParts.jsx";
import RiderMap from "./RiderMap.jsx";
import { Empty, ErrorLine, Note, WARN, fixAge, linkStyle, span } from "./deliveryParts.jsx";

// ─── Delivery Manager 01 Live operations ─────────────────────────────────────
// Every figure is counted from assignments, shifts and pings. A rider shares a location only
// while their shift screen is open, so each pin carries the age of its last fix. Orders waiting
// are not drawn on the map: an order has no map position until a rider is chosen.
const NEED_ACTION = { unassigned: ["Open dispatch queue", "dm-queue"], stale: ["Open active deliveries", "dm-active"], flag: ["Open the delivery", "dm-active"], late: ["Open the delivery", "dm-active"] };

export default function LiveOperationsPanel({ auth, onNavigate, onOpenDelivery, onOpenCase }) {
  const live = useDeliveryLive();
  const queue = useDeliveryDispatchQueue();
  const [actionError, setActionError] = useState("");
  const [pending, setPending] = useState(false);
  const data = live.data;
  const autoOn = queue.data?.auto_assign?.on;
  const canSwitch = auth?.hasPermission?.("delivery.rates");

  const toggle = async () => {
    setActionError("");
    setPending(true);
    try {
      await apiPost("/api/delivery/auto-assign/switch/", { on: !autoOn });
      queue.refetch();
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not change auto-assign."));
    } finally {
      setPending(false);
    }
  };

  const points = (data?.pins || []).filter((p) => p.lat !== null && p.lng !== null).map((p) => ({
    id: p.rider_id, lat: p.lat, lng: p.lng, state: p.stale ? "stale" : p.status, label: `${p.full_name} · ${fixAge(p.age_seconds, p.stale)}`,
  }));
  const noFix = (data?.pins || []).filter((p) => p.lat === null || p.lng === null);
  const k = data?.kpis;
  const act = (item) => {
    const [, tab] = NEED_ACTION[item.kind] || [];
    if (item.kind === "flag" || item.kind === "late") onOpenDelivery?.(item.assignment_id);
    else onNavigate?.(tab || "dm-queue");
  };

  return (
    <div style={page}>
      <Title right={(
        <>
          {autoOn !== undefined && <span style={chip(autoOn ? D.green : D.amber)}>{autoOn ? "Auto-assign on" : "Auto-assign off"}</span>}
          {canSwitch && autoOn !== undefined && <button type="button" disabled={pending} onClick={toggle} style={button(D.panelBg, D.text, pending)}>{autoOn ? "Switch to manual" : "Switch auto-assign on"}</button>}
          <button type="button" onClick={() => onNavigate?.("dm-queue")} style={button(D.gold, D.text)}>Open dispatch queue</button>
        </>
      )}>Live operations</Title>
      <ErrorLine>{actionError}</ErrorLine>
      <Status isLoading={live.isLoading} isError={live.isError}>
        {data && (
          <>
            <div style={kpiGrid}>
              <Kpi label="On the road" value={k.on_the_road} sub="Jobs between accepted and delivered" />
              <Kpi label="Waiting for a rider" value={k.waiting} sub={k.waiting ? "Paid orders no rider holds" : "Nothing waiting"} subColor={k.waiting ? WARN : undefined} />
              <Kpi label="Late now" value={k.late_now} sub={k.late_now ? "Past the deliver-by time" : "None past their deadline"} subColor={k.late_now ? WARN : undefined} />
              <Kpi label="Delivered today" value={k.delivered_today} sub={k.on_time_today.of ? `${k.on_time_today.on_time} of ${k.on_time_today.of} on time` : "No delivery time limit set yet"} />
              <Kpi label="Riders on shift" value={k.riders.on_shift} sub={`${k.riders.free} free · ${k.riders.on_job} on a job · ${k.riders.break} on a break`} />
              <Kpi label="Stale locations" value={k.riders.stale} sub={`No fix for over ${span(data.stale_after_seconds)}`} subColor={k.riders.stale ? WARN : undefined} />
            </div>

            <section aria-labelledby="need" style={section}>
              <h3 id="need" style={sectionTitle}>Needs you now</h3>
              {data.needs_you.length === 0 ? <Empty>Nothing needs you right now.</Empty> : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {data.needs_you.map((item, i) => (
                    <li key={`${item.kind}-${item.order_id}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", borderTop: i ? `1px solid ${D.divider}` : "none", paddingTop: i ? 8 : 0 }}>
                      <span style={{ fontSize: "0.82rem", color: D.text, fontWeight: 700 }}>{item.text}</span>
                      <button type="button" onClick={() => act(item)} style={button(D.panelBg, D.text)}>{(NEED_ACTION[item.kind] || ["Open"])[0]}</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="map" style={section}>
              <h3 id="map" style={sectionTitle}>Riders now</h3>
              {points.length ? <RiderMap points={points} label="Riders on the map, each with the age of its last location" height={340} /> : <Empty>{k.riders.on_shift ? "No rider on shift has shared a location yet." : "No rider is on shift, so there is nothing to draw."}</Empty>}
              {noFix.length > 0 && <span style={dim}>No location yet: {noFix.map((p) => p.full_name).join(", ")}.</span>}
              <span style={dim}>{data.routing?.note} Riders share location only while their shift screen is open, so each pin shows how old its last fix is. A pin older than {span(data.stale_after_seconds)} turns stale and the rider is left out of auto-assign.</span>
            </section>

            <section aria-labelledby="queue" style={section}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <h3 id="queue" style={sectionTitle}>Dispatch queue ({k.waiting})</h3>
                <button type="button" onClick={() => onNavigate?.("dm-queue")} style={linkStyle}>All {k.waiting}</button>
              </div>
              {data.queue.length === 0 ? <Empty>No order is waiting for a rider.</Empty> : (
                <div style={scroll}>
                  <table style={table}>
                    <thead><tr>{["Order", "Waiting", "Route", "Zone"].map((h) => <th key={h} scope="col" style={th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {data.queue.map((o) => (
                        <tr key={o.order_id}>
                          <td style={{ ...td, fontWeight: 800 }}>#{o.order_id}{o.returned ? " · returned" : ""}</td>
                          <td style={td}>{span(o.waiting_minutes * 60)}</td>
                          <td style={td}>{o.route.from || "Pickup not set"} → {o.route.to || "No address"}</td>
                          <td style={td}>{o.unzoned ? "Outside every zone" : o.zone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section aria-labelledby="cases" style={section}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <h3 id="cases" style={sectionTitle}>Disputes &amp; returns, oldest first</h3>
                <button type="button" onClick={() => onNavigate?.("dm-cases")} style={linkStyle}>All open</button>
              </div>
              {data.disputes.length === 0 ? <Empty>No open case.</Empty> : data.disputes.map((d) => (
                <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: "0.82rem", color: D.text }}>
                  <span><b>{d.reason_label}</b> · order #{d.order_id}</span>
                  <button type="button" onClick={() => onOpenCase?.(d.id)} style={button(D.panelBg, D.text)}>Open case</button>
                </div>
              ))}
            </section>
            {queue.data?.deadlines === "none" && <Note>No delivery time limits are in force, so no order has a deliver-by time and nothing is counted late. They are set under Delivery time limits.</Note>}
          </>
        )}
      </Status>
    </div>
  );
}

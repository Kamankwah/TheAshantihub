import { useQueueMap, useJobMap } from "../../../../hooks/useTracking.js";
import TrackMap from "../../../maps/TrackMap.jsx";
import EtaLine from "../../../maps/EtaLine.jsx";
import { D } from "../../theme.js";
import { dim } from "../panelStyles.js";

// Maps for the Delivery Manager: the dispatch queue's ranking drawer and the active-job drawer.
// Nothing is invented: no pickup coordinates means no map and a line saying so; a rider without a
// location is never pinned; a missing route draws no line. The server decides what is shown
// (backend/delivery/tracking.py); the estimate/road basis comes from the payload, never assumed.
const has = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && p.lat !== null && p.lng !== null;
const line = { fontSize: "0.78rem", color: D.text };

export function QueueMap({ orderId, onSelectRider }) {
  const { data, isLoading, isError } = useQueueMap(orderId);
  if (isLoading) return <span style={dim}>Loading the map...</span>;
  if (isError || !data) return <span style={dim}>The map could not be loaded.</span>;
  const riders = (data.riders || []).filter(has);
  if (!has(data.pickup)) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={line}>No map pin for this pickup, so there is nothing to draw.</span>
        {riders.length === 0 && <span style={line}>No rider has shared a location recently.</span>}
      </div>
    );
  }
  const markers = [
    { id: "pickup", kind: "pickup", lat: data.pickup.lat, lng: data.pickup.lng, label: data.pickup.name || "Pickup" },
    ...(has(data.drop) ? [{ id: "drop", kind: "drop", lat: data.drop.lat, lng: data.drop.lng, label: "Drop-off" }] : []),
    ...riders.map((r) => ({
      id: r.rider_id,
      kind: r.stale ? "stale" : r.eligible ? "rider" : "candidate",
      lat: r.lat, lng: r.lng,
      label: r.eligible ? r.name : `${r.name}${r.reason ? `: ${r.reason}` : ""}`,
    })),
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <TrackMap markers={markers} route={data.route} height={280} label={`Map of order #${orderId}: pickup, drop-off and nearby riders`}
        onSelect={(id) => { if (id !== "pickup" && id !== "drop") onSelectRider?.(id); }} />
      <EtaLine leg={data.trip} prefix="Shop to drop-off: " />
      {!has(data.drop) && <span style={line}>This order has no drop-off pin, so there is no trip route or time.</span>}
      {riders.length === 0 && <span style={line}>No rider has shared a location recently.</span>}
      <span style={dim}>Gold: shop · {has(data.drop) ? "Green: drop-off · " : ""}Dark: eligible rider · White: left out (hover for the reason) · Dashed: location out of date. Select a rider to find them in the table.</span>
    </div>
  );
}

export function JobMap({ jobId, riderName }) {
  const { data, isLoading, isError } = useJobMap(jobId);
  if (isLoading) return <span style={dim}>Loading the map...</span>;
  if (isError || !data) return <span style={dim}>The map could not be loaded.</span>;
  const name = data.rider?.name || riderName || "Rider";
  const markers = [
    ...(has(data.pickup) ? [{ id: "pickup", kind: "pickup", lat: data.pickup.lat, lng: data.pickup.lng, label: data.pickup.name || "Pickup" }] : []),
    ...(has(data.drop) ? [{ id: "drop", kind: "drop", lat: data.drop.lat, lng: data.drop.lng, label: "Drop-off" }] : []),
    ...(has(data.rider) ? [{ id: "rider", kind: data.rider.stale ? "stale" : "rider", lat: data.rider.lat, lng: data.rider.lng, label: name }] : []),
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <TrackMap markers={markers} route={data.route} height={280} label="Map of this delivery: stops and the rider" />
      <EtaLine leg={data.leg} stale={!!data.rider?.stale} ageS={data.rider?.age_s ?? null} />
      {!has(data.drop) && <span style={line}>This order has no drop-off pin, so there is no trip route or time.</span>}
      {!has(data.rider) && <span style={line}>The rider has not shared a location yet.</span>}
      <span style={dim}>
        {[has(data.pickup) && "Gold: shop", has(data.drop) && "Green: drop-off", has(data.rider) && "Dark: rider", has(data.rider) && "Dashed: location out of date"].filter(Boolean).join(" · ")}
      </span>
    </div>
  );
}

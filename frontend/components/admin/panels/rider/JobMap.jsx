import { useDispatchMap } from "../../../../hooks/useTracking.js";
import { shopMarkers, unpinnedShops } from "../../../maps/shopMarkers.js";
import TrackMap from "../../../maps/TrackMap.jsx";
import EtaLine from "../../../maps/EtaLine.jsx";
import { D } from "../../theme.js";
import { dim } from "../panelStyles.js";

// The map on the rider's job screen, for both stages (to the shop, to the customer). It shows the
// server's last fix for the rider (not this phone's GPS), the shop and the customer's drop pin, and
// the road route when the server has one. Nothing is invented: a stop without a pin is named and
// not drawn, a rider without a fix is not pinned, a missing route draws no line. It shows nothing
// the job screen does not already show (no phone numbers, no codes).
const has = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)) && p.lat !== null && p.lng !== null;
const line = { fontSize: "0.78rem", color: D.text };

export default function JobMap({ jobId }) {
  const { data, isLoading, isError } = useDispatchMap(jobId);
  if (isLoading) return <span style={dim}>Loading the map...</span>;
  if (isError || !data) return <span style={dim}>The map could not be loaded.</span>;
  const shops = shopMarkers(data);
  const markers = [
    ...shops,
    ...(has(data.drop) ? [{ id: "drop", kind: "drop", lat: data.drop.lat, lng: data.drop.lng, label: "Customer" }] : []),
    ...(has(data.rider) ? [{ id: "rider", kind: data.rider.stale ? "stale" : "rider", lat: data.rider.lat, lng: data.rider.lng, label: "You" }] : []),
  ];
  const prefix = data.leg?.to === "pickup" ? "To the shop: " : data.leg?.to === "drop" ? "To the customer: " : "";
  const unpinned = unpinnedShops(data);
  const late = (data.pickups || []).filter((s) => s.late && (!s.status || s.status === "pending" || s.status === "arrived")).map((s) => s.name);
  const missing = [(unpinned.length ? unpinned.join(" or the ") : !has(data.pickup) && (data.pickups || []).length <= 1 && "shop"), !has(data.drop) && "customer's address"].filter(Boolean);
  const legend = [shops.some((m) => m.kind === "pickup") && "Gold: shop",
    shops.some((m) => m.kind === "stop") && "Ringed: later shops", has(data.drop) && "Green: customer", has(data.rider) && "Dark: you", has(data.rider) && data.rider.stale && "Dashed: location out of date"].filter(Boolean).join(" · ");
  return (
    <div role="group" aria-label="Map of this job" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <TrackMap markers={markers} route={data.route} height={240} label="Map of this job: the shop, the customer and you" />
      <EtaLine leg={data.leg} stale={!!data.rider?.stale} ageS={data.rider?.age_s ?? null} prefix={prefix} />
      {missing.length > 0 && <span style={line}>No map pin for the {missing.join(" or the ")}, so the route and time cannot be shown for it.</span>}
      {late.length > 0 && <span style={line}>Running late: {late.join(", ")}.</span>}
      {!has(data.rider) && <span style={line}>Your location has not reached the server yet.</span>}
      {legend && <span style={dim}>{legend}</span>}
    </div>
  );
}

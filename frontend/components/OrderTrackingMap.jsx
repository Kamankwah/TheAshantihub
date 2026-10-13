import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrderTracking } from "../hooks/useTracking.js";
import TrackMap from "./maps/TrackMap.jsx";
import EtaLine from "./maps/EtaLine.jsx";
import { D } from "./dashboard/theme.js";

// The customer's live view of their delivery (backend OrderTrackingView). Before pickup it is
// TEXT ONLY and the tracking hook is never enabled, so no rider position is requested or shown.
// From pickup it shows the rider's first name and vehicle (the server sends nothing more), the
// drop pin and the ETA. There is deliberately no call or message action: businesses and riders
// are not contacted directly (root CLAUDE.md).
const BEFORE_PICKUP = ["assigned", "accepted", "at_pickup"];
const LIVE = ["picked_up", "at_customer"];
const note = { margin: "10px 0 0", color: D.textDim, fontSize: "0.74rem" };

function LiveMap({ orderId }) {
  const queryClient = useQueryClient();
  const { data, isError } = useOrderTracking(orderId, { enabled: true });
  const rider = data?.rider;
  const hasFix = rider && rider.lat != null && rider.lng != null && Number.isFinite(Number(rider.lat)) && Number.isFinite(Number(rider.lng));
  // The delivery moved on while the customer was watching (delivered, confirmed, failed): refresh
  // the orders list so the card shows its new state and the confirm-receipt button, and drop the map.
  const moved = data && !LIVE.includes(data.stage);
  useEffect(() => { if (moved) queryClient.invalidateQueries({ queryKey: ["orders"] }); }, [moved, queryClient]);
  if (isError && !data) return <p style={note}>Could not load the live map. Please try again shortly.</p>;
  if (!data) return <p style={note}>Loading the live map…</p>;
  if (moved) return null;
  if (!hasFix) return <p style={note}>The rider's location is not available right now.</p>;
  const who = [rider.first_name, rider.vehicle_type].filter(Boolean).join(" · ");
  const markers = [
    { id: "rider", kind: rider.stale ? "stale" : "rider", lat: rider.lat, lng: rider.lng, label: who || "Your rider" },
    data.drop ? { id: "drop", kind: "drop", lat: data.drop.lat, lng: data.drop.lng, label: "Your delivery location" } : null,
  ].filter(Boolean);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ color: D.text, fontSize: "0.76rem", fontWeight: 700, marginBottom: 6 }}>
        {rider.first_name ? `${rider.first_name} is on the way` : "Your rider is on the way"}
        {rider.vehicle_type ? ` · ${rider.vehicle_type}` : ""}
      </div>
      <TrackMap markers={markers} route={data.route ?? null} height={240} label="Map of your rider and delivery location" />
      <div style={{ color: D.textDim, fontSize: "0.68rem", marginTop: 4 }}>Dark pin: rider. Green pin: your delivery location.</div>
      <div style={{ marginTop: 6 }}><EtaLine leg={data.leg} stale={!!rider.stale} ageS={rider.age_s ?? null} /></div>
    </div>
  );
}

// `deliveryStatus` is the order's own delivery_status: the pre-pickup lines only show while it is
// still "processing", so an order staff moved on directly never reads "Finding a rider".
export default function OrderTrackingMap({ orderId, assignmentStatus, deliveryStatus }) {
  const processing = deliveryStatus === "processing";
  if (assignmentStatus == null) return processing ? <p style={note}>Finding a rider</p> : null;
  if (BEFORE_PICKUP.includes(assignmentStatus)) return processing ? <p style={note}>A rider is heading to the shop</p> : null;
  if (LIVE.includes(assignmentStatus)) return <LiveMap orderId={orderId} />;
  return null;
}

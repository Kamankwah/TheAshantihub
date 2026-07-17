import { useMemo } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Leaflet's default marker icon references image files by relative path, which
// break under Vite's bundler. Point them at the CDN copies so markers render
// without shipping the assets. (This is the app, not a CSP-locked artifact, so
// external tiles/images are fine.)
const iconBase = "https://unpkg.com/leaflet@1.9.4/dist/images/";
L.Icon.Default.mergeOptions({
  iconRetinaUrl: `${iconBase}marker-icon-2x.png`,
  iconUrl: `${iconBase}marker-icon.png`,
  shadowUrl: `${iconBase}marker-shadow.png`,
});

// A coloured marker so pickup (business) and drop-off (customer) are told apart
// at a glance without extra assets — a small divIcon pin.
function pin(color) {
  return L.divIcon({
    className: "",
    html: `<div style="background:${color};width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 18],
  });
}
const PICKUP_PIN = pin("#d4a017");
const DROPOFF_PIN = pin("#16a34a");

// Route map for a dispatch's delivery (punch-list item 11). Plots each pickup
// (business) point in gold and the customer drop-off in green, with a straight
// guide line between them. Deliberately a straight polyline, not a driven
// route — there is no routing/directions service wired up; the line is a
// "these are the two ends" hint, not turn-by-turn navigation.
//
// `pickups`: [{business_name, lat, lng, ...}]  `dropoff`: {lat, lng, address}
// Points without coordinates are skipped rather than faked at 0,0.
export default function DeliveryRouteMap({ pickups = [], dropoff = null, height = 320 }) {
  const pickupPoints = pickups.filter((p) => p.lat != null && p.lng != null);
  const hasDropoff = dropoff && dropoff.lat != null && dropoff.lng != null;

  const allPoints = useMemo(() => {
    const pts = pickupPoints.map((p) => [p.lat, p.lng]);
    if (hasDropoff) pts.push([dropoff.lat, dropoff.lng]);
    return pts;
  }, [pickupPoints, hasDropoff, dropoff]);

  if (allPoints.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", background: "#f3efe6", borderRadius: 12, color: "#8A7A6B", fontSize: "0.78rem", textAlign: "center", padding: 16 }}>
        No map coordinates for this delivery yet — use the address and phone below.
      </div>
    );
  }

  // Centre on the mean of the available points; Leaflet fits the rest.
  const center = [
    allPoints.reduce((s, p) => s + p[0], 0) / allPoints.length,
    allPoints.reduce((s, p) => s + p[1], 0) / allPoints.length,
  ];

  // The guide line only makes sense with both ends present.
  const routeLine = hasDropoff && pickupPoints.length > 0
    ? [[pickupPoints[0].lat, pickupPoints[0].lng], [dropoff.lat, dropoff.lng]]
    : null;

  return (
    <MapContainer center={center} zoom={13} style={{ height, borderRadius: 12 }} scrollWheelZoom={false}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {pickupPoints.map((p, i) => (
        <Marker key={`pickup-${i}`} position={[p.lat, p.lng]} icon={PICKUP_PIN}>
          <Popup>📦 Pickup: {p.business_name}</Popup>
        </Marker>
      ))}
      {hasDropoff && (
        <Marker position={[dropoff.lat, dropoff.lng]} icon={DROPOFF_PIN}>
          <Popup>🏠 Drop-off{dropoff.address ? `: ${dropoff.address}` : ""}</Popup>
        </Marker>
      )}
      {routeLine && <Polyline positions={routeLine} pathOptions={{ color: "#16a34a", dashArray: "6 8" }} />}
    </MapContainer>
  );
}

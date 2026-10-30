import { Circle, MapContainer, Marker } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import BaseTileLayers from "../../maps/BaseTileLayers.jsx";
import { D } from "../theme.js";

// The stored shop pin with an accuracy circle of the stored radius, satellite
// first when a satellite source is configured (Streets otherwise). Leaflet does
// not render under jsdom, so tests stub this file (test/setup.js); its real
// behaviour is checked in a browser. A pin without finite coordinates, or at
// exactly 0,0, draws nothing: never a default location.
const goldPin = L.divIcon({
  className: "",
  html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#D4A017;border:2px solid #2C1810"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

export default function AddressPinMap({ pin, label, height = 240 }) {
  const lat = Number(pin?.lat);
  const lng = Number(pin?.lng);
  if (!pin || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  const radius = Number(pin.accuracy_m);
  const hasRadius = Number.isFinite(radius) && radius > 0;
  return (
    <div role="group" aria-label={label} style={{ position: "relative", height, borderRadius: 12, overflow: "hidden" }}>
      <MapContainer center={[lat, lng]} zoom={18} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <BaseTileLayers initial="satellite" />
        <Marker position={[lat, lng]} icon={goldPin} />
        {hasRadius && <Circle center={[lat, lng]} radius={radius} pathOptions={{ color: "#006400", weight: 1.5, dashArray: "6 5", fillOpacity: 0.12 }} />}
      </MapContainer>
      <span style={{ position: "absolute", left: 8, top: 8, zIndex: 500, fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: D.panelBg, color: D.text }}>
        {hasRadius ? `Ring: the fix's accuracy, ±${radius} m` : "Accuracy not recorded"}
      </span>
    </div>
  );
}

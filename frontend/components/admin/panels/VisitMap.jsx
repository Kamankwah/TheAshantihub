import { Circle, CircleMarker, MapContainer, Marker } from "react-leaflet";
import BaseTileLayers from "../../maps/BaseTileLayers.jsx";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { D } from "../theme.js";

// A gold pin for the business, a blue dot for the scout and a ring at the
// allowed radius. Leaflet doesn't render under jsdom, so tests stub this file
// (test/setup.js); its real behaviour is checked in a browser. A point
// without coordinates is skipped, never drawn at 0,0.
const goldPin = L.divIcon({
  className: "",
  html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#D4A017;border:2px solid #2C1810"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 22],
});

const valid = (point) => point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && !(point.lat === 0 && point.lng === 0);

export default function VisitMap({ pin, fix, radiusM = 100, height = 200, label }) {
  const hasPin = valid(pin);
  const hasFix = valid(fix);
  const center = hasPin ? [pin.lat, pin.lng] : hasFix ? [fix.lat, fix.lng] : null;
  if (!center) return null;
  return (
    <div role="group" aria-label={label} style={{ position: "relative", height, borderRadius: 12, overflow: "hidden" }}>
      <MapContainer center={center} zoom={17} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <BaseTileLayers />
        {hasPin && <Marker position={[pin.lat, pin.lng]} icon={goldPin} />}
        {hasPin && <Circle center={[pin.lat, pin.lng]} radius={radiusM} pathOptions={{ color: "#006400", weight: 1.5, dashArray: "6 5", fillOpacity: 0.07 }} />}
        {hasFix && <CircleMarker center={[fix.lat, fix.lng]} radius={7} pathOptions={{ color: "#FFFFFF", weight: 2.5, fillColor: "#000080", fillOpacity: 1 }} />}
      </MapContainer>
      <span style={{ position: "absolute", left: 8, top: 8, zIndex: 500, fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: D.panelBg, color: D.text }}>
        {`Gold: business · Blue: you · Ring: ${radiusM} m`}
      </span>
    </div>
  );
}

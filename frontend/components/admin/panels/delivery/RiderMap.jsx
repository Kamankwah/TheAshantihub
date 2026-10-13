import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { D } from "../../theme.js";

// Riders on a map: each pin is the rider's last reported fix, never a live track. Colour
// says what the rider is doing; a pin older than the stale limit is drawn as a dashed ring.
// A rider with no fix has no pin (the caller drops them), never one at 0,0. Leaflet does not
// render under jsdom, so tests stub this file (test/setup.js); check it in a browser.
const STYLE = {
  free: { color: "#FFFFFF", weight: 2.5, fillColor: "#006400", fillOpacity: 1 },
  on_job: { color: "#FFFFFF", weight: 2.5, fillColor: "#D4A017", fillOpacity: 1 },
  break: { color: "#FFFFFF", weight: 2.5, fillColor: "#2C1810", fillOpacity: 1 },
  stale: { color: "#A33A00", weight: 3, dashArray: "4 3", fillColor: "#FFFFFF", fillOpacity: 1 },
  waiting: { color: "#CC0000", weight: 3, fillColor: "#FFFFFF", fillOpacity: 1 },
};

function Fit({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) { map.setView([points[0].lat, points[0].lng], 15); return; }
    map.fitBounds(points.map((p) => [p.lat, p.lng]), { padding: [36, 36], maxZoom: 16 });
  }, [map, points]);
  return null;
}

export default function RiderMap({ points, height = 360, label, onSelect }) {
  if (!points.length) return null;
  return (
    <div role="img" aria-label={label} style={{ position: "relative", height, borderRadius: 12, overflow: "hidden" }}>
      <MapContainer center={[points[0].lat, points[0].lng]} zoom={13} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <TileLayer attribution='Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Fit points={points} />
        {points.map((p) => (
          <CircleMarker key={p.id} center={[p.lat, p.lng]} radius={9} pathOptions={STYLE[p.state] || STYLE.break} eventHandlers={{ click: () => onSelect?.(p.id) }}>
            <Tooltip direction="top" offset={[0, -6]}>{p.label}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      <span style={{ position: "absolute", left: 8, top: 8, zIndex: 500, fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: D.panelBg, color: D.text }}>
        Green: free · Gold: on a job · Brown: on a break · Dashed ring: stale · Red ring: order waiting
      </span>
    </div>
  );
}

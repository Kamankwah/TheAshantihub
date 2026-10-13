import { useEffect } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { D } from "../dashboard/theme.js";

// One map for every delivery audience: pickup, drop, a rider's last fix, candidate riders and the
// road route. A null route draws no line (never a fake straight one); a marker without
// coordinates is skipped (never 0,0). Leaflet does not render under jsdom, so tests stub this
// file (test/setup.js); check it in a browser.
const STYLE = {
  pickup: { color: "#FFFFFF", weight: 2.5, fillColor: "#D4A017", fillOpacity: 1 },
  drop: { color: "#FFFFFF", weight: 2.5, fillColor: "#006400", fillOpacity: 1 },
  rider: { color: "#FFFFFF", weight: 2.5, fillColor: "#2C1810", fillOpacity: 1 },
  candidate: { color: "#2C1810", weight: 2, fillColor: "#FFFFFF", fillOpacity: 1 },
  stale: { color: "#A33A00", weight: 3, dashArray: "4 3", fillColor: "#FFFFFF", fillOpacity: 1 },
};
const hasCoords = (m) => Number.isFinite(Number(m?.lat)) && Number.isFinite(Number(m?.lng)) && m.lat !== null && m.lng !== null;

function Fit({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) { map.setView(points[0], 15); return; }
    map.fitBounds(points, { padding: [36, 36], maxZoom: 16 });
  }, [map, points]);
  return null;
}

export default function TrackMap({ markers = [], route = null, height = 320, label, onSelect }) {
  const pins = markers.filter(hasCoords);
  const line = Array.isArray(route) && route.length >= 2 ? route : null;
  if (!pins.length) {
    return (
      <div role="img" aria-label={label} style={{ height, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: D.panelBg, color: D.text, fontSize: 13, textAlign: "center", padding: 16 }}>
        No map coordinates for this delivery yet.
      </div>
    );
  }
  const points = [...pins.map((m) => [Number(m.lat), Number(m.lng)]), ...(line || [])];
  return (
    <div role="img" aria-label={label} style={{ position: "relative", height, borderRadius: 12, overflow: "hidden" }}>
      <MapContainer center={points[0]} zoom={13} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <TileLayer attribution='Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <Fit points={points} />
        {line && <Polyline positions={line} pathOptions={{ color: "#2C1810", weight: 4, opacity: 0.75 }} />}
        {pins.map((m) => (
          <CircleMarker key={m.id} center={[Number(m.lat), Number(m.lng)]} radius={9} pathOptions={STYLE[m.kind] || STYLE.candidate} eventHandlers={{ click: () => onSelect?.(m.id) }}>
            <Tooltip direction="top" offset={[0, -6]}>{m.label}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}

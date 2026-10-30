import { useEffect, useRef } from "react";
import { CircleMarker, MapContainer, Polyline, Tooltip, useMap } from "react-leaflet";
import BaseTileLayers from "./BaseTileLayers.jsx";
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
  stop: { color: "#D4A017", weight: 3, fillColor: "#FFFFFF", fillOpacity: 1 },
  stale: { color: "#A33A00", weight: 3, dashArray: "4 3", fillColor: "#FFFFFF", fillOpacity: 1 },
};
const hasCoords = (m) => Number.isFinite(Number(m?.lat)) && Number.isFinite(Number(m?.lng)) && m.lat !== null && m.lng !== null;

// What the camera frames: the stops (pickup/drop) and the route's destination (its last point;
// the route starts at the moving rider, so its start and length change every poll). A moving rider or
// candidate does not change it, so a poll never snaps the map back under a user who panned.
// With no stops, the set of marker ids stands in so the first rider still gets framed.
export function fitSignature(markers = [], route = null) {
  const pins = markers.filter(hasCoords);
  const stops = pins.filter((m) => m.kind === "pickup" || m.kind === "drop" || m.kind === "stop");
  const shown = (stops.length ? stops : pins.map((m) => ({ ...m, lat: 0, lng: 0 })))
    .map((m) => `${m.kind}:${m.id}:${Number(m.lat)},${Number(m.lng)}`).sort().join("|");
  const line = Array.isArray(route) && route.length >= 2
    ? `to:${route[route.length - 1]}` : "none";
  return `${shown}#${line}`;
}

function Fit({ points, signature }) {
  const map = useMap();
  const latest = useRef(points);
  latest.current = points;
  useEffect(() => {
    const pts = latest.current;
    if (!pts.length) return;
    if (pts.length === 1) { map.setView(pts[0], 15); return; }
    map.fitBounds(pts, { padding: [36, 36], maxZoom: 16 });
  }, [map, signature]);
  return null;
}

export default function TrackMap({ markers = [], route = null, height = 320, label, onSelect }) {
  const pins = markers.filter(hasCoords);
  const signature = fitSignature(markers, route);
  const line = Array.isArray(route) && route.length >= 2 ? route : null;
  if (!pins.length) {
    return (
      <div style={{ height, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", background: D.panelBg, color: D.text, fontSize: 13, textAlign: "center", padding: 16 }}>
        No map coordinates for this delivery yet.
      </div>
    );
  }
  const points = [...pins.map((m) => [Number(m.lat), Number(m.lng)]), ...(line || [])];
  return (
    <div {...(label ? { role: "img", "aria-label": label } : {})} style={{ position: "relative", height, borderRadius: 12, overflow: "hidden" }}>
      <MapContainer center={points[0]} zoom={13} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <BaseTileLayers />
        <Fit points={points} signature={signature} />
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

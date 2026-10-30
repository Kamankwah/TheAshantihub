import { useEffect } from "react";
import { CircleMarker, MapContainer, Tooltip, useMap } from "react-leaflet";
import BaseTileLayers from "../../maps/BaseTileLayers.jsx";
import "leaflet/dist/leaflet.css";
import { D } from "../theme.js";

// Several check-in fixes on one map: green where the scout is still there, brown
// once checked out, a dashed amber ring for a flagged check-in. Points are the fix
// taken at check-in (a visit record, never a live position); one without a
// position is dropped by the caller, never drawn at 0,0. Leaflet doesn't render
// under jsdom, so tests stub this file (test/setup.js); its real behaviour is
// checked in a browser.
const STYLE = {
  here: { color: "#FFFFFF", weight: 2.5, fillColor: "#006400", fillOpacity: 1 },
  out: { color: "#FFFFFF", weight: 2.5, fillColor: "#2C1810", fillOpacity: 1 },
  flagged: { color: "#A33A00", weight: 3, dashArray: "4 3", fillColor: "#FFFFFF", fillOpacity: 1 },
};

function Fit({ points }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) { map.setView([points[0].lat, points[0].lng], 16); return; }
    map.fitBounds(points.map((p) => [p.lat, p.lng]), { padding: [36, 36], maxZoom: 17 });
  }, [map, points]);
  return null;
}

export default function TeamVisitMap({ points, selectedId, onSelect, height = 420, label }) {
  if (!points.length) return null;
  return (
    <div role="img" aria-label={label} style={{ position: "relative", height, borderRadius: 12, overflow: "hidden" }}>
      <MapContainer center={[points[0].lat, points[0].lng]} zoom={14} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <BaseTileLayers />
        <Fit points={points} />
        {points.map((p) => (
          <CircleMarker key={p.id} center={[p.lat, p.lng]} radius={p.id === selectedId ? 11 : 8} pathOptions={STYLE[p.state] || STYLE.out} eventHandlers={{ click: () => onSelect?.(p.id) }}>
            <Tooltip direction="top" offset={[0, -6]}>{p.label}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      <span style={{ position: "absolute", left: 8, top: 8, zIndex: 500, fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: D.panelBg, color: D.text }}>
        Green: still there · Brown: checked out · Dashed ring: flagged
      </span>
    </div>
  );
}

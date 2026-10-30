import { useEffect, useRef } from "react";
import L from "leaflet";
import { MapContainer, Polygon, useMap } from "react-leaflet";
import BaseTileLayers from "./BaseTileLayers.jsx";
import "leaflet/dist/leaflet.css";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import { latLngsFromRing, ringFromLatLngs } from "./zoneRing.js";

// Draw one delivery-zone polygon: Leaflet Draw offers polygon draw, edit and delete only. `ring`
// is the zone's [lng, lat] boundary, `others` the other zones' rings (thin grey, not clickable).
// onChange gets a new [lng, lat] ring, or null when the shape is deleted. Leaflet does not render
// under jsdom, so tests stub this file (test/setup.js); check it in a browser.
const KUMASI = [6.6885, -1.6244];
const sig = (ring) => JSON.stringify(ring || null);

function Editor({ ring, onChange }) {
  const map = useMap();
  const group = useRef(null);
  const emitted = useRef(sig(ring));
  const change = useRef(onChange);
  change.current = onChange;

  useEffect(() => {
    const layers = new L.FeatureGroup().addTo(map);
    group.current = layers;
    // showArea: false avoids leaflet-draw 1.0.4's "type is not defined" in its area read-out.
    const control = new L.Control.Draw({
      position: "topright",
      draw: { polygon: { showArea: false, allowIntersection: false, shapeOptions: { color: "#2C1810", weight: 3 } }, marker: false, circle: false, rectangle: false, polyline: false, circlemarker: false },
      edit: { featureGroup: layers },
    });
    map.addControl(control);
    const emit = (next) => { emitted.current = sig(next); change.current?.(next); };
    const readLayer = () => {
      const layer = layers.getLayers()[0];
      if (!layer) return null;
      const pts = layer.getLatLngs()[0] || [];
      return ringFromLatLngs(pts.map((p) => [p.lat, p.lng]));
    };
    const onCreated = (e) => { layers.clearLayers(); layers.addLayer(e.layer); emit(readLayer()); };
    const onEdited = () => emit(readLayer());
    const onDeleted = () => { if (!layers.getLayers().length) emit(null); };
    map.on(L.Draw.Event.CREATED, onCreated);
    map.on(L.Draw.Event.EDITED, onEdited);
    map.on(L.Draw.Event.DELETED, onDeleted);
    return () => {
      map.off(L.Draw.Event.CREATED, onCreated);
      map.off(L.Draw.Event.EDITED, onEdited);
      map.off(L.Draw.Event.DELETED, onDeleted);
      map.removeControl(control);
      map.removeLayer(layers);
    };
  }, [map]);

  // Show the ring prop; skip when it is only the echo of what the map itself just emitted.
  useEffect(() => {
    const layers = group.current;
    if (!layers) return;
    const pts = latLngsFromRing(ring);
    const existing = layers.getLayers().length > 0;
    if (sig(ring) === emitted.current && (existing || !pts.length)) return;
    layers.clearLayers();
    emitted.current = sig(ring);
    if (pts.length) {
      const poly = L.polygon(pts, { color: "#2C1810", weight: 3 });
      layers.addLayer(poly);
      map.fitBounds(poly.getBounds(), { padding: [30, 30], maxZoom: 16 });
    }
  }, [ring, map]);
  return null;
}

export default function ZoneDrawMap({ ring = null, others = [], onChange, height = 320 }) {
  const start = latLngsFromRing(ring);
  return (
    <div style={{ position: "relative", height, borderRadius: 12, overflow: "hidden" }}>
      <MapContainer
        center={KUMASI}
        zoom={11}
        bounds={start.length ? start : undefined}
        boundsOptions={{ padding: [30, 30], maxZoom: 16 }}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
      >
        <BaseTileLayers />
        {others.map((r, i) => {
          const pts = latLngsFromRing(r);
          return pts.length ? <Polygon key={i} positions={pts} interactive={false} pathOptions={{ color: "#8A8178", weight: 1, fillOpacity: 0.05, interactive: false }} /> : null;
        })}
        <Editor ring={ring} onChange={onChange} />
      </MapContainer>
    </div>
  );
}

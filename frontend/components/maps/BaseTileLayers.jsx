import { LayersControl, TileLayer } from "react-leaflet";
import { tileLayers } from "../../lib/mapTiles.js";

// The one base map for every Leaflet map. Render it as a child of <MapContainer> in place of a raw
// <TileLayer>. Streets always; when the build has a satellite source (Mapbox with a token) a labelled
// Streets/Satellite switch (Leaflet's layer control: keyboard-usable radio buttons) appears too.
// With no token it is today's OpenStreetMap street tiles and no switch (R17).
//
//   initial   "streets" (default) | "satellite" - the layer shown first; ignored without a satellite source.
//   layers    override of tileLayers() - for tests only.
export default function BaseTileLayers({ initial = "streets", layers }) {
  const { streets, satellite } = layers || tileLayers();
  // Leaflet lets an explicit undefined override its defaults (tileSize 256), so drop absent options.
  const props = (l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined));

  if (!satellite) return <TileLayer {...props(streets)} />;

  const startOnSatellite = initial === "satellite";
  return (
    <LayersControl position="topright" collapsed={false}>
      <LayersControl.BaseLayer name="Streets" checked={!startOnSatellite}>
        <TileLayer {...props(streets)} />
      </LayersControl.BaseLayer>
      <LayersControl.BaseLayer name="Satellite" checked={startOnSatellite}>
        <TileLayer {...props(satellite)} />
      </LayersControl.BaseLayer>
    </LayersControl>
  );
}

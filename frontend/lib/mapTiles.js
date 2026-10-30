// Map tile sources for every Leaflet map (Director ruling 6, 2026-10-30).
//
// Two providers: `osm` (today's public OpenStreetMap street tiles, no satellite) and `mapbox`
// (Mapbox raster tiles through the Styles API, streets plus satellite). The provider and the
// Mapbox token come from the BUILD environment:
//   VITE_MAP_TILES_PROVIDER = mapbox | osm   (default osm)
//   VITE_MAPBOX_TOKEN       = a public, URL-restricted Mapbox token (pk.…); never a secret one
// `mapbox` without a token quietly falls back to OSM streets and NO satellite layer (R17): there
// is no free satellite source with clear terms, so there is nothing to offer instead.

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const MAPBOX_ATTRIBUTION =
  '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> ' +
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
  '<strong><a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noopener noreferrer">Improve this map</a></strong>';
const MAXAR = ' &copy; <a href="https://www.maxar.com/">Maxar</a>';

const OSM_STREETS = Object.freeze({
  url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: OSM_ATTRIBUTION,
  maxZoom: 18, // Leaflet's default, as before
});

// Mapbox serves 512 px tiles through the Styles API; Leaflet needs tileSize 512 and zoomOffset -1.
const mapboxLayer = (style, token, attribution) => ({
  url: `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/{z}/{x}/{y}?access_token=${encodeURIComponent(token)}`,
  attribution,
  maxZoom: 22,
  tileSize: 512,
  zoomOffset: -1,
});

// The provider the build asked for: "mapbox" or "osm" (anything else, or unset, is osm).
export function configuredProvider() {
  return String(import.meta.env.VITE_MAP_TILES_PROVIDER || "").trim().toLowerCase() === "mapbox" ? "mapbox" : "osm";
}

// The public Mapbox token from the build environment, or "" when there is none.
export function configuredMapboxToken() {
  return String(import.meta.env.VITE_MAPBOX_TOKEN || "").trim();
}

// -> { streets: { url, attribution, maxZoom, ... }, satellite: { ... } | null }
// `token` defaults to the build's; pass one only in a test.
export function tileLayers(provider = configuredProvider(), token = configuredMapboxToken()) {
  if (provider === "mapbox" && token) {
    return {
      streets: mapboxLayer("streets-v12", token, MAPBOX_ATTRIBUTION),
      satellite: mapboxLayer("satellite-streets-v12", token, MAPBOX_ATTRIBUTION + MAXAR),
    };
  }
  return { streets: { ...OSM_STREETS }, satellite: null };
}

// True when this build offers a satellite layer (Mapbox with a token).
export function hasSatellite() {
  return tileLayers().satellite !== null;
}

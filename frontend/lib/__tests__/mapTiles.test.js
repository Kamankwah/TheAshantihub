import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredProvider, hasSatellite, tileLayers } from "../mapTiles.js";

const OSM_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const FAKE_TOKEN = "pk.test-token-not-real";

afterEach(() => vi.unstubAllEnvs());

describe("tileLayers", () => {
  it("osm is today's street tiles with its attribution and no satellite", () => {
    const t = tileLayers("osm");
    expect(t.streets.url).toBe(OSM_URL);
    expect(t.streets.attribution).toContain("OpenStreetMap");
    expect(t.streets.attribution).not.toContain("Mapbox");
    expect(t.satellite).toBeNull();
  });

  it("mapbox with a token gives streets and satellite from the Styles API (512px tiles)", () => {
    const t = tileLayers("mapbox", FAKE_TOKEN);
    expect(t.streets.url).toContain("https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=");
    expect(t.satellite.url).toContain("/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}?access_token=");
    for (const l of [t.streets, t.satellite]) {
      expect(l.tileSize).toBe(512);
      expect(l.zoomOffset).toBe(-1);
      expect(l.url).toContain(FAKE_TOKEN);
    }
  });

  it("mapbox attribution names Mapbox and OpenStreetMap and links 'Improve this map'", () => {
    const t = tileLayers("mapbox", FAKE_TOKEN);
    for (const l of [t.streets, t.satellite]) {
      expect(l.attribution).toContain("Mapbox");
      expect(l.attribution).toContain("OpenStreetMap");
      expect(l.attribution).toContain("Improve this map");
    }
  });

  it("mapbox without a token falls back to OSM streets and no satellite", () => {
    const t = tileLayers("mapbox", "");
    expect(t.streets.url).toBe(OSM_URL);
    expect(t.satellite).toBeNull();
  });

  it("an unknown provider is osm", () => {
    expect(tileLayers("google", FAKE_TOKEN).satellite).toBeNull();
  });
});

describe("env selection", () => {
  it("defaults to osm with nothing set", () => {
    vi.stubEnv("VITE_MAP_TILES_PROVIDER", "");
    vi.stubEnv("VITE_MAPBOX_TOKEN", "");
    expect(configuredProvider()).toBe("osm");
    expect(tileLayers().streets.url).toBe(OSM_URL);
    expect(hasSatellite()).toBe(false);
  });

  it("mapbox plus a token offers satellite", () => {
    vi.stubEnv("VITE_MAP_TILES_PROVIDER", "mapbox");
    vi.stubEnv("VITE_MAPBOX_TOKEN", FAKE_TOKEN);
    expect(configuredProvider()).toBe("mapbox");
    expect(hasSatellite()).toBe(true);
    expect(tileLayers().streets.url).toContain("api.mapbox.com");
  });

  it("mapbox with no token stays on OSM, no satellite", () => {
    vi.stubEnv("VITE_MAP_TILES_PROVIDER", "mapbox");
    vi.stubEnv("VITE_MAPBOX_TOKEN", "");
    expect(hasSatellite()).toBe(false);
    expect(tileLayers().streets.url).toBe(OSM_URL);
  });

  it("a token alone does not switch provider (osm stays)", () => {
    vi.stubEnv("VITE_MAP_TILES_PROVIDER", "osm");
    vi.stubEnv("VITE_MAPBOX_TOKEN", FAKE_TOKEN);
    expect(hasSatellite()).toBe(false);
  });
});

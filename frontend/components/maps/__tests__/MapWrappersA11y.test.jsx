import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real maps (test/setup.js stubs them globally). With a satellite source the Streets/Satellite
// radios live inside the map wrapper, so the wrapper must not be role="img" (its children would be
// presentational, hiding the radios from assistive tech): it is a labelled group.
// Vector layers need an SVG renderer jsdom lacks, so they render nothing here; the map, tiles and layer
// control are real.
vi.mock("react-leaflet", async (importOriginal) => {
  const actual = await importOriginal();
  const none = () => null;
  return { ...actual, Circle: none, CircleMarker: none, Marker: none, Polyline: none, Tooltip: none, Popup: none };
});

const real = async (path) => (await vi.importActual(path)).default;

beforeEach(() => {
  vi.stubEnv("VITE_MAP_TILES_PROVIDER", "mapbox");
  vi.stubEnv("VITE_MAPBOX_TOKEN", "pk.test-token-not-real");
});
afterEach(() => vi.unstubAllEnvs());

const point = { id: 1, lat: 6.69, lng: -1.62, state: "here", label: "Kofi" };
const CASES = [
  ["VisitMap", "../../admin/panels/VisitMap.jsx", (C) => <C pin={{ lat: 6.69, lng: -1.62 }} label="Visit map" />],
  ["TeamVisitMap", "../../admin/panels/TeamVisitMap.jsx", (C) => <C points={[point]} label="Visit map" />],
  ["RiderMap", "../../admin/panels/delivery/RiderMap.jsx", (C) => <C points={[{ ...point, state: "free" }]} label="Visit map" />],
  ["TrackMap", "../TrackMap.jsx", (C) => <C markers={[{ id: "a", kind: "rider", lat: 6.69, lng: -1.62, label: "Rider" }]} label="Visit map" />],
];

describe.each(CASES)("%s wrapper", (_name, path, renderIt) => {
  it("is a labelled group, and the Streets/Satellite radios are not inside a presentational image", async () => {
    const Component = await real(path);
    render(renderIt(Component));
    const group = screen.getByRole("group", { name: "Visit map" });
    expect(screen.queryByRole("img", { name: "Visit map" })).toBeNull();
    const satellite = screen.getByRole("radio", { name: "Satellite" });
    expect(group).toContainElement(satellite);
    expect(satellite.closest('[role="img"]')).toBeNull();
    expect(screen.getByRole("radio", { name: "Streets" })).toBeChecked();
  });
});

import { render, screen } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import { describe, expect, it } from "vitest";
import BaseTileLayers from "../BaseTileLayers.jsx";
import { tileLayers } from "../../../lib/mapTiles.js";

// Real Leaflet, rendered under jsdom: only the layer control and attribution text are asserted.
const inMap = (node) =>
  render(
    <MapContainer center={[6.69, -1.62]} zoom={13} style={{ height: 200 }}>
      {node}
    </MapContainer>,
  );

describe("BaseTileLayers", () => {
  it("OSM only: street tiles, OSM attribution, no Streets/Satellite switch", () => {
    const { container } = inMap(<BaseTileLayers layers={tileLayers("osm")} />);
    expect(container.querySelector(".leaflet-tile-pane")).not.toBeNull();
    expect(container.querySelector(".leaflet-control-layers")).toBeNull();
    expect(screen.queryByLabelText("Satellite")).toBeNull();
    expect(container.querySelector(".leaflet-control-attribution").textContent).toContain("OpenStreetMap");
  });

  it("mapbox with a token: a labelled Streets/Satellite switch, Streets selected first", () => {
    const { container } = inMap(<BaseTileLayers layers={tileLayers("mapbox", "pk.test-token-not-real")} />);
    expect(container.querySelector(".leaflet-control-layers")).not.toBeNull();
    expect(screen.getByLabelText("Streets")).toBeChecked();
    expect(screen.getByLabelText("Satellite")).not.toBeChecked();
    expect(container.querySelector(".leaflet-control-attribution").textContent).toContain("Mapbox");
  });

  it("shows Mapbox's wordmark on Mapbox tiles only", () => {
    const mapbox = inMap(<BaseTileLayers layers={tileLayers("mapbox", "pk.test-token-not-real")} />)
    const logo = mapbox.container.querySelector("a.ah-mapbox-logo")
    expect(logo).not.toBeNull()
    expect(logo).toHaveAttribute("aria-label", "Mapbox")
    expect(logo.querySelector("img").getAttribute("src")).toContain("data:image/svg+xml")
    mapbox.unmount()
    const osm = inMap(<BaseTileLayers layers={tileLayers("osm")} />)
    expect(osm.container.querySelector("a.ah-mapbox-logo")).toBeNull()
  });

  it("can open on satellite", () => {
    inMap(<BaseTileLayers initial="satellite" layers={tileLayers("mapbox", "pk.test-token-not-real")} />);
    expect(screen.getByLabelText("Satellite")).toBeChecked();
  });

  it("initial=satellite is ignored when there is no satellite source", () => {
    const { container } = inMap(<BaseTileLayers initial="satellite" layers={tileLayers("osm")} />);
    expect(container.querySelector(".leaflet-control-layers")).toBeNull();
  });
});

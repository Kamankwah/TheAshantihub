import { render, screen } from "@testing-library/react-native";

import { RiderMap, distanceLine, routePoints } from "../src/features/orders/RiderMap";
import type { Tracking } from "../src/features/orders/queries";
import * as maps from "../src/lib/maps";

jest.mock("../src/lib/maps", () => ({ mapsReady: jest.fn(() => true) }));
const mapsReady = maps.mapsReady as jest.Mock;

const live = (over: Partial<Tracking> = {}): Tracking => ({
  stage: "picked_up",
  rider: { first_name: "Kojo", vehicle_type: "motorbike", lat: 6.69, lng: -1.62, age_s: 20, stale: false },
  drop: { lat: 6.7, lng: -1.63 },
  leg: { to: "drop", distance_km: 3.2, duration_s: 540, basis: "road route" },
  route: [[6.69, -1.62], [6.695, -1.625], [6.7, -1.63]],
  rider_busy: false,
  ...over,
});

beforeEach(() => mapsReady.mockReturnValue(true));

describe("rider map", () => {
  it("shows_the_rider_and_the_drop_pin_and_the_route", async () => {
    await render(<RiderMap tracking={live()} />);
    expect(screen.getByLabelText("Map of your rider and delivery location")).toBeTruthy();
    const markers = screen.getAllByTestId("map-marker");
    expect(markers).toHaveLength(2);
    expect(markers[0].props.coordinate).toEqual({ latitude: 6.69, longitude: -1.62 });
    expect(markers[1].props.coordinate).toEqual({ latitude: 6.7, longitude: -1.63 });
    expect(screen.getByTestId("map-polyline").props.coordinates).toHaveLength(3);
  });

  it("names_the_rider_by_first_name_and_vehicle_only", async () => {
    await render(<RiderMap tracking={live({ rider: { first_name: "Kojo", vehicle_type: "motorbike", lat: 6.69, lng: -1.62, age_s: 5, stale: false, phone: "+233201112222" } as never })} />);
    expect(screen.getByText("Kojo is on the way · motorbike")).toBeTruthy();
    expect(screen.queryByText(/\+?233|0201112222|tel:|whatsapp|call/i)).toBeNull();
  });

  it("says_how_far_it_is_and_never_gives_minutes_or_an_arrival_time", async () => {
    await render(<RiderMap tracking={live()} />);
    expect(screen.getByText("About 3.2 km away · road route")).toBeTruthy();
    expect(screen.queryByText(/\bmin(ute)?s?\b|ETA|arriv|by \d/i)).toBeNull();
  });

  it("an_old_position_is_called_old", async () => {
    await render(<RiderMap tracking={live({ rider: { first_name: "Kojo", vehicle_type: "motorbike", lat: 6.69, lng: -1.62, age_s: 270, stale: true } })} />);
    expect(screen.getByText("Last location 5 min ago")).toBeTruthy();
  });

  it("draws_no_route_when_the_server_sent_none_instead_of_a_straight_line", async () => {
    await render(<RiderMap tracking={live({ route: null })} />);
    expect(screen.queryByTestId("map-polyline")).toBeNull();
    expect(screen.getAllByTestId("map-marker")).toHaveLength(2);
  });

  it("without_a_drop_pin_it_shows_the_rider_alone_and_says_the_route_cannot_be_shown", async () => {
    await render(<RiderMap tracking={live({ drop: null, route: null, leg: null })} />);
    expect(screen.getAllByTestId("map-marker")).toHaveLength(1);
    expect(screen.getByText(/no map pin, so the route can.t be shown/i)).toBeTruthy();
  });

  it("nothing_is_drawn_while_the_rider_is_on_another_job_or_has_no_position", async () => {
    await render(<RiderMap tracking={live({ rider_busy: true, rider: null })} />);
    expect(screen.queryByTestId("map")).toBeNull();
    expect(screen.getByText("Your rider is finishing another delivery first.")).toBeTruthy();
  });

  it("no_position_yet_says_so_in_words", async () => {
    await render(<RiderMap tracking={live({ rider: { first_name: "Kojo", vehicle_type: "motorbike" } })} />);
    expect(screen.queryByTestId("map")).toBeNull();
    expect(screen.getByText("Your rider’s location isn’t available right now.")).toBeTruthy();
  });

  it("before_pickup_there_is_no_map", async () => {
    await render(<RiderMap tracking={live({ stage: "accepted", rider: null })} />);
    expect(screen.queryByTestId("map")).toBeNull();
  });

  it("a_phone_without_maps_keeps_the_text_and_hides_the_map", async () => {
    mapsReady.mockReturnValue(false);
    await render(<RiderMap tracking={live()} />);
    expect(screen.queryByTestId("map")).toBeNull();
    expect(screen.getByText("Kojo is on the way · motorbike")).toBeTruthy();
    expect(screen.getByText("About 3.2 km away · road route")).toBeTruthy();
  });

  it("ignores_a_position_that_is_not_a_number", async () => {
    await render(<RiderMap tracking={live({ rider: { first_name: "Kojo", vehicle_type: "motorbike", lat: Number.NaN, lng: -1.6 } })} />);
    expect(screen.queryByTestId("map")).toBeNull();
  });
});

describe("helpers", () => {
  it("route_points_turns_lat_lng_pairs_into_coordinates_and_drops_bad_ones", () => {
    expect(routePoints([[6.1, -1.1], [Number.NaN, 2], [6.2, -1.2]])).toEqual([{ latitude: 6.1, longitude: -1.1 }, { latitude: 6.2, longitude: -1.2 }]);
    expect(routePoints(null)).toEqual([]);
  });
  it("distance_line_uses_the_servers_basis_word", () => {
    expect(distanceLine({ to: "drop", distance_km: 1, duration_s: 100, basis: "straight-line estimate x 1.3" })).toBe("About 1 km away · straight-line estimate x 1.3");
    expect(distanceLine(null)).toBeNull();
  });
});

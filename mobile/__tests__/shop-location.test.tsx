import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as Location from "expo-location";

import ShopLocation from "../src/app/(auth)/register/shop-location";
import { ApiError, api } from "../src/lib/api";
import * as maps from "../src/lib/maps";

jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { High: 4 },
}));
jest.mock("../src/lib/maps", () => ({ mapsReady: jest.fn(() => true) }));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;
const { router } = jest.requireMock("expo-router");
const permission = Location.requestForegroundPermissionsAsync as jest.Mock;
const position = Location.getCurrentPositionAsync as jest.Mock;
const mapsReady = maps.mapsReady as jest.Mock;

// What the server really answers: the plus code of the pin sent, tier "located" and its label.
const SAVED = { plus_code: "6CRWM9QG+C6", landmark: "Opposite the Total station", tier: "located", tier_label: "Location shared by the owner", is_manual: false };
const PIN_6_7 = { ...SAVED, plus_code: "6CRWP92C+22", tier_label: "Location shared by the owner", is_manual: true };
const PIN_6_69 = { ...SAVED, plus_code: "6CRWM9RJ+22", is_manual: true };
const LOCATION = "/api/accounts/me/location/";

beforeEach(() => {
  jest.clearAllMocks();
  mapsReady.mockReturnValue(true);
  permission.mockResolvedValue({ granted: true });
  position.mockResolvedValue({ coords: { latitude: 6.6885123456, longitude: -1.6244, accuracy: 17.6 } });
});

const useMyLocation = () => fireEvent.press(screen.getByRole("button", { name: "Use my current location" }));

describe("shop location step", () => {
  it("asks_for_foreground_permission_then_a_high_accuracy_fix", async () => {
    await render(<ShopLocation />);
    await useMyLocation();
    await waitFor(() => expect(position).toHaveBeenCalledWith({ accuracy: Location.Accuracy.High }));
    expect(permission).toHaveBeenCalled();
    expect(await screen.findByText(/accurate to ±18 m/)).toBeTruthy();
  });

  it("saves_a_device_fix_with_its_accuracy_and_shows_the_servers_answer", async () => {
    apiMock.mockResolvedValue(SAVED);
    await render(<ShopLocation />);
    await useMyLocation();
    await screen.findByText(/accurate to/);
    await fireEvent.changeText(screen.getByLabelText("Landmark (optional)"), "  Opposite the Total station ");
    await fireEvent.press(screen.getByRole("button", { name: "Save my shop location" }));
    expect(await screen.findByText("6CRWM9QG+C6")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith(LOCATION, { body: { lat: 6.688512, lng: -1.6244, accuracy_m: 18, landmark: "Opposite the Total station" } });
    expect(screen.getByText("This is where riders will collect. You can fix it later.")).toBeTruthy();
    expect(screen.getByText("Opposite the Total station")).toBeTruthy();
  });

  it("shows_the_servers_tier_label", async () => {
    apiMock.mockResolvedValue(SAVED);
    await render(<ShopLocation />);
    await useMyLocation();
    await screen.findByText(/accurate to/);
    await fireEvent.press(screen.getByRole("button", { name: "Save my shop location" }));
    expect(await screen.findByText("Location shared by the owner")).toBeTruthy();
  });

  it("shows_no_tier_line_when_the_server_sent_no_label", async () => {
    apiMock.mockResolvedValue({ ...SAVED, tier_label: "" });
    await render(<ShopLocation />);
    await useMyLocation();
    await screen.findByText(/accurate to/);
    await fireEvent.press(screen.getByRole("button", { name: "Save my shop location" }));
    await screen.findByText("6CRWM9QG+C6");
    expect(screen.queryByText("Location shared by the owner")).toBeNull();
  });

  it("says_what_to_do_when_permission_is_denied_and_sends_nothing", async () => {
    permission.mockResolvedValue({ granted: false });
    await render(<ShopLocation />);
    await useMyLocation();
    expect(await screen.findByText("Allow location, or place the pin on the map")).toBeTruthy();
    expect(position).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save my shop location" })).toBeDisabled();
  });

  it("sends_a_pin_placed_on_the_map_as_manual_without_accuracy", async () => {
    apiMock.mockResolvedValue(PIN_6_7);
    await render(<ShopLocation />);
    await fireEvent(screen.getByTestId("map"), "press", { nativeEvent: { coordinate: { latitude: 6.7, longitude: -1.63 } } });
    await fireEvent.press(screen.getByRole("button", { name: "Save my shop location" }));
    await screen.findByText("6CRWP92C+22");
    expect(apiMock).toHaveBeenCalledWith(LOCATION, { body: { lat: 6.7, lng: -1.63, manual: true } });
  });

  it("dragging_the_pin_turns_a_device_fix_into_a_manual_pin", async () => {
    apiMock.mockResolvedValue(PIN_6_69);
    await render(<ShopLocation />);
    await useMyLocation();
    await screen.findByText(/accurate to/);
    await fireEvent(screen.getByTestId("map-marker"), "dragEnd", { nativeEvent: { coordinate: { latitude: 6.69, longitude: -1.62 } } });
    await fireEvent.press(screen.getByRole("button", { name: "Save my shop location" }));
    await screen.findByText("6CRWM9RJ+22");
    expect(apiMock).toHaveBeenCalledWith(LOCATION, { body: { lat: 6.69, lng: -1.62, manual: true } });
  });

  it("a_slow_phone_reading_does_not_overwrite_a_pin_placed_meanwhile", async () => {
    let arrive: (v: unknown) => void = () => {};
    position.mockReturnValue(new Promise((resolve) => { arrive = resolve; }));
    apiMock.mockResolvedValue(PIN_6_7);
    await render(<ShopLocation />);
    await useMyLocation();
    await waitFor(() => expect(position).toHaveBeenCalled());
    await fireEvent(screen.getByTestId("map"), "press", { nativeEvent: { coordinate: { latitude: 6.7, longitude: -1.63 } } });
    await act(async () => { arrive({ coords: { latitude: 6.5, longitude: -1.5, accuracy: 12 } }); });
    expect(screen.queryByText(/accurate to/)).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Save my shop location" }));
    await screen.findByText("6CRWP92C+22");
    expect(apiMock).toHaveBeenCalledWith(LOCATION, { body: { lat: 6.7, lng: -1.63, manual: true } });
  });

  it("shows_the_servers_refusal_as_it_was_sent", async () => {
    apiMock.mockRejectedValue(new ApiError(400, { accuracy_m: ["Your location is accurate to ±140 m. Step outside and try again."] }));
    await render(<ShopLocation />);
    await useMyLocation();
    await screen.findByText(/accurate to ±18/);
    await fireEvent.press(screen.getByRole("button", { name: "Save my shop location" }));
    expect(await screen.findByText("Your location is accurate to ±140 m. Step outside and try again.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue" })).toBeNull();
  });

  it("shows_a_detail_message_from_the_server", async () => {
    apiMock.mockRejectedValue(new ApiError(400, { detail: "That point is outside the Ashanti Region." }));
    await render(<ShopLocation />);
    await fireEvent(screen.getByTestId("map"), "press", { nativeEvent: { coordinate: { latitude: 5.6, longitude: -0.2 } } });
    await fireEvent.press(screen.getByRole("button", { name: "Save my shop location" }));
    expect(await screen.findByText("That point is outside the Ashanti Region.")).toBeTruthy();
  });

  it("continue_asks_the_server_for_the_next_step", async () => {
    apiMock.mockResolvedValueOnce(SAVED).mockResolvedValueOnce({ registration_step: "plan_selection", kyc_status: "pending" });
    await render(<ShopLocation />);
    await fireEvent(screen.getByTestId("map"), "press", { nativeEvent: { coordinate: { latitude: 6.7, longitude: -1.63 } } });
    await fireEvent.press(screen.getByRole("button", { name: "Save my shop location" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/register/plan"));
    expect(apiMock).toHaveBeenLastCalledWith("/api/accounts/me/");
  });

  it("without_a_map_in_this_build_it_says_so_and_still_offers_the_phone_location", async () => {
    mapsReady.mockReturnValue(false);
    await render(<ShopLocation />);
    expect(screen.queryByTestId("map")).toBeNull();
    expect(screen.getByText(/map isn.t available in this version/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use my current location" })).toBeTruthy();
  });
});

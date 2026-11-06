import { api } from "../src/lib/api";
import { resendEmailConfirmation, saveShopLocation, stepRoute } from "../src/lib/registrationApi";

jest.mock("expo-router", () => ({ router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() } }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;
beforeEach(() => jest.clearAllMocks());

describe("registration api", () => {
  it("maps_shop_location_to_its_own_screen", () => {
    expect(stepRoute("shop_location", "pending")).toBe("/register/shop-location");
  });

  it("keeps_the_other_steps_where_they_were", () => {
    expect(stepRoute("business_info")).toBe("/register/business");
    expect(stepRoute("payment_info")).toBe("/register/payout");
    expect(stepRoute("terms")).toBe("/register/terms");
  });

  it("posts_a_device_fix_with_its_accuracy", async () => {
    apiMock.mockResolvedValue({ plus_code: "6CCHPV8F+9Q", tier: "unverified", tier_label: "", is_manual: false, landmark: "" });
    await saveShopLocation({ lat: 6.69, lng: -1.62, accuracy_m: 18 });
    expect(apiMock).toHaveBeenCalledWith("/api/accounts/me/location/", { body: { lat: 6.69, lng: -1.62, accuracy_m: 18 } });
  });

  it("posts_a_hand_placed_pin_as_manual_without_accuracy", async () => {
    apiMock.mockResolvedValue({});
    await saveShopLocation({ lat: 6.69, lng: -1.62, manual: true });
    expect(apiMock).toHaveBeenCalledWith("/api/accounts/me/location/", { body: { lat: 6.69, lng: -1.62, manual: true } });
  });

  it("sends_a_trimmed_landmark_only_when_there_is_one", async () => {
    apiMock.mockResolvedValue({});
    await saveShopLocation({ lat: 1, lng: 2, manual: true, landmark: "  Opposite the Total station  " });
    expect(apiMock.mock.calls[0][1].body.landmark).toBe("Opposite the Total station");
    await saveShopLocation({ lat: 1, lng: 2, manual: true, landmark: "   " });
    expect(apiMock.mock.calls[1][1].body).not.toHaveProperty("landmark");
  });

  it("resends_the_confirmation_email", async () => {
    apiMock.mockResolvedValue(undefined);
    await resendEmailConfirmation();
    expect(apiMock).toHaveBeenCalledWith("/api/accounts/business-owners/me/email-confirmation/", { body: {} });
  });
});

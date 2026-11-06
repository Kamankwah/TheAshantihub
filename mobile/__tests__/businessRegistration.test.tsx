import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";

import BusinessScreen from "../src/app/(auth)/register/business";
import BusinessSignIn from "../src/app/(auth)/business-sign-in";
import { api } from "../src/lib/api";
import { stepRoute } from "../src/lib/registrationApi";
import { useAuth } from "../src/state/auth";

jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn(), requestMediaLibraryPermissionsAsync: jest.fn() }));
jest.mock("expo-screen-capture", () => ({ usePreventScreenCapture: jest.fn() }));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});

const apiMock = api as jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  useAuth.setState({ status: "signedOut", account: undefined });
});

describe("business registration", () => {
  it("resumes_at_server_registration_step", () => {
    expect(stepRoute("personal_info", "pending")).toBe("/register/personal");
    expect(stepRoute("business_info", "pending")).toBe("/register/business");
    expect(stepRoute("plan_selection", "pending")).toBe("/register/plan");
    expect(stepRoute("payment_info", "pending")).toBe("/register/payout");
    expect(stepRoute("terms", "pending")).toBe("/register/terms");
  });

  it("submitted_screen_shown_when_step_complete_and_not_yet_verified", () => {
    expect(stepRoute("complete", "pending")).toBe("/register/submitted");
    expect(stepRoute("complete", "verified")).toBe("/");
  });

  it("business sign in resumes at the server's step", async () => {
    apiMock
      .mockResolvedValueOnce({ token: "t", refresh_token: "r", account_type: "business_owner", id: 3, full_name: "Kwame" })
      .mockResolvedValueOnce({ account_type: "business_owner", id: 3, full_name: "Kwame", registration_step: "payment_info", kyc_status: "pending" });
    await render(<BusinessSignIn />);
    await fireEvent.changeText(screen.getByLabelText("Phone or email"), "+233207886600");
    await fireEvent.changeText(screen.getByLabelText("Password"), "s3cret-pass");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/register/payout"));
    expect(useAuth.getState().account?.type).toBe("business_owner");
  });

  it("ghana_post_address_not_starting_with_A_is_rejected_inline", async () => {
    await render(<BusinessScreen />);
    await fireEvent.changeText(screen.getByLabelText("Ghana Post GPS address"), "GA-123-4567");
    await fireEvent.changeText(screen.getByLabelText("Business contact phone"), "0207886600");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByText("AshantiHub only admits businesses in the Ashanti Region. Your address must begin with “A”."),
    ).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("a malformed address gets the format hint", async () => {
    await render(<BusinessScreen />);
    await fireEvent.changeText(screen.getByLabelText("Ghana Post GPS address"), "AK-39");
    await fireEvent.changeText(screen.getByLabelText("Business contact phone"), "0207886600");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Enter a valid Ghana Post GPS address, like AK-039-5028.")).toBeTruthy();
  });

  it("a_loosely_typed_address_is_saved_in_canonical_form", async () => {
    apiMock.mockResolvedValueOnce({}).mockResolvedValueOnce({ account_type: "business_owner", id: 3, full_name: "K", registration_step: "plan_selection", kyc_status: "pending" });
    await render(<BusinessScreen />);
    await fireEvent.changeText(screen.getByLabelText("Ghana Post GPS address"), "ao t010 3560");
    await fireEvent.changeText(screen.getByLabelText("Business contact phone"), "0207886600");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/register/plan"));
    const [, init] = apiMock.mock.calls[0];
    expect(init.body.get("gps_address")).toBe("AO-T010-3560");
  });

  it("a_seven_character_code_with_no_second_group_gets_the_format_hint", async () => {
    await render(<BusinessScreen />);
    await fireEvent.changeText(screen.getByLabelText("Ghana Post GPS address"), "AK039502");
    await fireEvent.changeText(screen.getByLabelText("Business contact phone"), "0207886600");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Enter a valid Ghana Post GPS address, like AK-039-5028.")).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("tin_field_only_for_formal_business", async () => {
    await render(<BusinessScreen />);
    expect(screen.queryByLabelText("TIN")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Formal (registered)" }));
    expect(screen.getByLabelText("TIN")).toBeTruthy();
  });

  it("a valid Ashanti address is saved and the flow moves on", async () => {
    apiMock.mockResolvedValueOnce({}).mockResolvedValueOnce({ account_type: "business_owner", id: 3, full_name: "K", registration_step: "plan_selection", kyc_status: "pending" });
    await render(<BusinessScreen />);
    await fireEvent.changeText(screen.getByLabelText("Ghana Post GPS address"), "ak-039-5028");
    await fireEvent.changeText(screen.getByLabelText("Business contact phone"), "0207886600");
    await fireEvent.press(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/register/plan"));
    const [path, init] = apiMock.mock.calls[0];
    expect(path).toBe("/api/accounts/business-owners/me/profile/");
    expect(init.method).toBe("PATCH");
  });

  it("a_card_photo_picker_that_throws_is_caught_and_explained", async () => {
    const picker = jest.requireMock("expo-image-picker");
    picker.launchImageLibraryAsync.mockRejectedValueOnce(new Error("no gallery"));
    await render(<BusinessScreen />);
    await fireEvent.press(screen.getByLabelText("Card front"));
    expect(await screen.findByText(/couldn.t open your photos/i)).toBeTruthy();
    expect(screen.getByLabelText("Card front")).toBeTruthy();
  });
});

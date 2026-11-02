import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Linking, Share } from "react-native";

import Otp from "../src/app/(auth)/otp";
import Security from "../src/app/security";
import { api, ApiError } from "../src/lib/api";
import { useAuth } from "../src/state/auth";

let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("expo-local-authentication", () => ({ hasHardwareAsync: jest.fn(async () => false), isEnrolledAsync: jest.fn(async () => false), authenticateAsync: jest.fn() }));
jest.mock("expo-screen-capture", () => ({ usePreventScreenCapture: jest.fn() }));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;
const { router } = jest.requireMock("expo-router");

const login = { token: "t", refresh_token: "r", account_type: "customer", id: 1, full_name: "Ama Mensah" };
function client(ui: ReactElement) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>{ui}</QueryClientProvider>;
}

describe("signing in with an authenticator app", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { mfa_token: "tok-1", channels: "", authenticator: "1" };
    useAuth.setState({ status: "signedOut", account: undefined });
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/otp/sign-in/verify/") return login;
      throw new ApiError(404, {});
    });
  });

  it("asks_for_the_app_code_and_sends_no_text", async () => {
    await render(<Otp />);
    expect(screen.getByText("Enter the code from your authenticator app")).toBeTruthy();
    expect(apiMock.mock.calls.some((c) => c[0] === "/api/otp/sign-in/send/")).toBe(false);
  });

  it("signs_in_with_the_six_digit_code", async () => {
    await render(<Otp />);
    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "123456");
    await fireEvent.press(screen.getByLabelText("Verify"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(apiMock).toHaveBeenCalledWith("/api/otp/sign-in/verify/", expect.objectContaining({ body: { mfa_token: "tok-1", code: "123456" } }));
    expect(useAuth.getState().status).toBe("signedIn");
  });

  it("a_lost_phone_can_use_a_recovery_code_instead", async () => {
    await render(<Otp />);
    await fireEvent.press(screen.getByLabelText("Use a recovery code instead"));
    await fireEvent.changeText(screen.getByLabelText("Recovery code"), "abcd-efgh-ijkl");
    await fireEvent.press(screen.getByLabelText("Verify"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(apiMock).toHaveBeenCalledWith("/api/otp/sign-in/verify/", expect.objectContaining({ body: { mfa_token: "tok-1", recovery_code: "abcd-efgh-ijkl" } }));
  });

  it("a_wrong_code_shows_the_servers_words_and_stays", async () => {
    apiMock.mockImplementation(async () => { throw new ApiError(400, { detail: "That code isn't right. Try the newest code in your app." }, "wrong_code"); });
    await render(<Otp />);
    await fireEvent.changeText(screen.getByLabelText("6-digit code"), "000000");
    await fireEvent.press(screen.getByLabelText("Verify"));
    expect(await screen.findByText("That code isn't right. Try the newest code in your app.")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("security: authenticator app", () => {
  let state: { enabled: boolean; left: number };
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    state = { enabled: false, left: 0 };
    useAuth.setState({ status: "signedIn", account: { type: "customer", id: 1, fullName: "Ama Mensah" } });
    apiMock.mockImplementation(async (path: string, init?: { body?: Record<string, unknown>; headers?: Record<string, string> }) => {
      if (path === "/api/otp/authenticator/") return { enabled: state.enabled, enabled_at: state.enabled ? "2026-11-01T10:00:00Z" : null, recovery_codes_left: state.left, available: true };
      if (path === "/api/otp/step-up/send/") return { hint: "•••• 4567" };
      if (path === "/api/otp/step-up/verify/") return { step_up_token: "su-1" };
      if (path === "/api/otp/authenticator/setup/") return { secret: "JBSWY3DPEHPK3PXP", otpauth_uri: "otpauth://totp/AshantiHub:ama?secret=JBSWY3DPEHPK3PXP&issuer=AshantiHub" };
      if (path === "/api/otp/authenticator/setup/confirm/") {
        if (init?.body?.code !== "123456") throw new ApiError(400, { detail: "That code isn't right. Check the app shows AshantiHub and try again." }, "wrong_code");
        state = { enabled: true, left: 10 };
        return { recovery_codes: ["aaaa-bbbb-cccc", "dddd-eeee-ffff"] };
      }
      if (path === "/api/otp/authenticator/recovery-codes/") return { recovery_codes: ["1111-2222-3333"] };
      if (path === "/api/otp/authenticator/disable/") { state = { enabled: false, left: 0 }; return undefined; }
      throw new ApiError(404, {});
    });
  });

  async function confirmIt() {
    await fireEvent.changeText(await screen.findByLabelText("Code we sent you"), "654321");
    await fireEvent.press(screen.getByLabelText("Confirm"));
  }

  it("shows_it_is_off_and_offers_to_turn_it_on", async () => {
    await render(client(<Security />));
    expect(await screen.findByText(/Authenticator app is off/)).toBeTruthy();
    expect(screen.getByLabelText("Turn on authenticator app")).toBeTruthy();
  });

  it("turns_on_after_a_code_then_the_first_app_code_then_shows_recovery_codes_once", async () => {
    await render(client(<Security />));
    await fireEvent.press(await screen.findByLabelText("Turn on authenticator app"));
    await confirmIt();
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
    expect(screen.getByLabelText(/QR code for/)).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith("/api/otp/authenticator/setup/", expect.objectContaining({ headers: expect.objectContaining({ "X-Step-Up-Token": "su-1" }) }));
    await fireEvent.changeText(screen.getByLabelText("Code from your app"), "123456");
    await fireEvent.press(screen.getByLabelText("Turn it on"));
    expect(await screen.findByText("aaaa-bbbb-cccc")).toBeTruthy();
    expect(screen.getByText(/shown only once/i)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("I have saved them"));
    expect(await screen.findByText(/Authenticator app is on/)).toBeTruthy();
    expect(screen.getByText(/10 recovery codes left/)).toBeTruthy();
  });

  it("a_wrong_first_code_keeps_the_setup_open", async () => {
    await render(client(<Security />));
    await fireEvent.press(await screen.findByLabelText("Turn on authenticator app"));
    await confirmIt();
    await fireEvent.changeText(await screen.findByLabelText("Code from your app"), "000000");
    await fireEvent.press(screen.getByLabelText("Turn it on"));
    expect(await screen.findByText(/That code isn.t right/)).toBeTruthy();
    expect(screen.getByText("JBSWY3DPEHPK3PXP")).toBeTruthy();
  });

  it("opens_the_phones_authenticator_app_from_the_link", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true as never);
    await render(client(<Security />));
    await fireEvent.press(await screen.findByLabelText("Turn on authenticator app"));
    await confirmIt();
    await fireEvent.press(await screen.findByLabelText("Open in my authenticator app"));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^otpauth:\/\/totp\//));
  });

  it("recovery_codes_can_be_shared_from_the_share_sheet", async () => {
    const share = jest.spyOn(Share, "share").mockResolvedValue({ action: "sharedAction" } as never);
    await render(client(<Security />));
    await fireEvent.press(await screen.findByLabelText("Turn on authenticator app"));
    await confirmIt();
    await fireEvent.changeText(await screen.findByLabelText("Code from your app"), "123456");
    await fireEvent.press(screen.getByLabelText("Turn it on"));
    await fireEvent.press(await screen.findByLabelText("Save or share my recovery codes"));
    expect(share).toHaveBeenCalledWith({ message: expect.stringContaining("aaaa-bbbb-cccc") });
  });

  it("when_on_it_can_renew_recovery_codes_after_a_code", async () => {
    state = { enabled: true, left: 3 };
    await render(client(<Security />));
    expect(await screen.findByText(/3 recovery codes left/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Get new recovery codes"));
    await confirmIt();
    expect(await screen.findByText("1111-2222-3333")).toBeTruthy();
    expect(apiMock).toHaveBeenCalledWith("/api/otp/authenticator/recovery-codes/", expect.objectContaining({ headers: expect.objectContaining({ "X-Step-Up-Token": "su-1" }) }));
  });

  it("turning_it_off_warns_first_then_asks_for_a_code", async () => {
    state = { enabled: true, left: 10 };
    await render(client(<Security />));
    await fireEvent.press(await screen.findByLabelText("Turn off authenticator app"));
    expect(await screen.findByText(/Your account will be protected by a password only/i)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Yes, turn it off"));
    await confirmIt();
    expect(await screen.findByText(/Authenticator app is off/)).toBeTruthy();
  });

  it("unavailable_or_failing_status_says_so_without_inventing_a_state", async () => {
    apiMock.mockImplementation(async () => { throw new ApiError(500, {}); });
    await render(client(<Security />));
    expect(await screen.findByLabelText("Try again")).toBeTruthy();
    expect(screen.queryByText(/Authenticator app is (on|off)/)).toBeNull();
  });
});

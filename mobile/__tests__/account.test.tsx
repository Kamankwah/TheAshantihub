import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import type { ReactElement } from "react";

import AccountScreen from "../src/app/customer/account";
import DeleteAccountScreen from "../src/app/delete-account";
import LegalScreen from "../src/app/legal/[doc]";
import SecurityScreen from "../src/app/security";
import { reasonText } from "../src/features/account/deletion";
import { api, ApiError } from "../src/lib/api";
import { useAuth } from "../src/state/auth";
import { useLock } from "../src/state/lock";
import { usePrefs } from "../src/state/prefs";

let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
}));
const mockStore: Record<string, string> = {};
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => { mockStore[k] = v; }),
  deleteItemAsync: jest.fn(async (k: string) => { delete mockStore[k]; }),
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({})) }));
jest.mock("../src/lib/biometrics", () => ({ biometrics: { available: jest.fn(async () => true), prompt: jest.fn(async () => "ok") } }));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;

function client(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

let signOut: jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  mockParams = {};
  signOut = jest.fn(async () => {});
  useAuth.setState({ status: "signedIn", account: { type: "customer", id: 1, fullName: "Ama Owusu" }, signOut } as never);
  usePrefs.setState({ themePreference: "system" });
  useLock.setState({ enabled: false, locked: false });
});

async function typePassword(value = "s3cret-pass") {
  await fireEvent.changeText(screen.getByLabelText("Your password"), value);
}

describe("delete my account", () => {
  it("delete_blocked_lists_plain_language_reasons", async () => {
    apiMock.mockRejectedValue(new ApiError(409, { code: "deletion_blocked", reasons: ["open_orders", "wallet_balance"], order_ids: [5, 6] }, "deletion_blocked"));
    await render(client(<DeleteAccountScreen />));
    await typePassword();
    await fireEvent.press(screen.getByLabelText("Delete my account"));
    expect(await screen.findByText(/You have orders that are not finished yet/)).toBeTruthy();
    expect(screen.getByText(/money in your AshantiHub wallet/i)).toBeTruthy();
    expect(screen.getByText(/Orders #5, #6/)).toBeTruthy();
    expect(screen.queryByText(/open_orders|wallet_balance|deletion_blocked/)).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("every_blocker_code_has_a_plain_sentence", () => {
    for (const code of ["open_orders", "open_withdrawal", "active_booking", "open_service_request", "live_listings", "active_promotion", "wallet_balance", "company_account"]) {
      expect(reasonText(code)).not.toContain("_");
      expect(reasonText(code).length).toBeGreaterThan(20);
    }
    expect(reasonText("something_new")).toMatch(/Contact Support/);
  });

  it("delete_success_signs_out", async () => {
    apiMock.mockResolvedValue(undefined);
    await render(client(<DeleteAccountScreen />));
    await typePassword();
    await fireEvent.press(screen.getByLabelText("Delete my account"));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith("/api/accounts/me/delete/", { body: { password: "s3cret-pass" } });
  });

  it("wrong_password_error_inline", async () => {
    apiMock.mockRejectedValue(new ApiError(400, { code: "wrong_password", detail: "That password is not right." }, "wrong_password"));
    await render(client(<DeleteAccountScreen />));
    await typePassword("nope");
    await fireEvent.press(screen.getByLabelText("Delete my account"));
    expect(await screen.findByText("That password is not right.")).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("button_needs_a_password", async () => {
    await render(client(<DeleteAccountScreen />));
    expect(screen.getByLabelText("Delete my account").props.accessibilityState.disabled).toBe(true);
  });

  it("explains_what_is_erased_and_what_is_kept", async () => {
    await render(client(<DeleteAccountScreen />));
    expect(screen.getByText(/What we erase/i)).toBeTruthy();
    expect(screen.getByText(/What we must keep/i)).toBeTruthy();
  });

  it("step_up_asks_for_a_code_then_retries_with_the_token", async () => {
    apiMock.mockImplementation(async (path: string, init?: { headers?: Record<string, string> }) => {
      if (path === "/api/accounts/me/delete/") {
        if (init?.headers?.["X-Step-Up-Token"] === "tok123") return undefined;
        throw new ApiError(403, { code: "step_up_required", action: "account_delete", detail: "Confirm it's you with a code first." }, "step_up_required");
      }
      if (path === "/api/otp/step-up/send/") return { hint: "•••4567" };
      if (path === "/api/otp/step-up/verify/") return { step_up_token: "tok123" };
      throw new ApiError(404, {});
    });
    await render(client(<DeleteAccountScreen />));
    await typePassword();
    await fireEvent.press(screen.getByLabelText("Delete my account"));
    await fireEvent.changeText(await screen.findByLabelText("Code we sent you"), "123456");
    await fireEvent.press(screen.getByLabelText("Confirm and delete"));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(apiMock).toHaveBeenCalledWith("/api/otp/step-up/send/", { body: { action: "account_delete" } });
    expect(apiMock).toHaveBeenCalledWith("/api/otp/step-up/verify/", { body: { action: "account_delete", code: "123456" } });
  });
});

describe("appearance", () => {
  it("theme_switch_persists", async () => {
    await render(client(<AccountScreen />));
    await fireEvent.press(screen.getByLabelText("Dark"));
    expect(usePrefs.getState().themePreference).toBe("dark");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("ashantihub.theme", "dark");
    usePrefs.setState({ themePreference: "system" });
    await act(async () => { await usePrefs.getState().hydrate(); });
    expect(usePrefs.getState().themePreference).toBe("dark");
  });

  it("theme_options_are_system_light_dark", async () => {
    await render(client(<AccountScreen />));
    for (const label of ["Match my phone", "Light", "Dark"]) expect(screen.getByLabelText(label)).toBeTruthy();
  });
});

describe("account hub", () => {
  it("shows_name_and_links_to_messages_notifications_security", async () => {
    await render(client(<AccountScreen />));
    expect(screen.getByText("Ama Owusu")).toBeTruthy();
    for (const label of ["Messages", "Notifications", "Security", "Contact Support", "Terms of use", "Privacy policy"]) expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it("sign_out_calls_sign_out", async () => {
    await render(client(<AccountScreen />));
    await fireEvent.press(screen.getByLabelText("Sign out"));
    expect(signOut).toHaveBeenCalled();
  });
});

describe("security", () => {
  it("biometric_toggle_turns_the_lock_on", async () => {
    const setEnabled = jest.fn(async () => {});
    useLock.setState({ setEnabled } as never);
    await render(client(<SecurityScreen />));
    const toggle = await screen.findByLabelText(/Unlock with/);
    await fireEvent(toggle, "valueChange", true);
    expect(setEnabled).toHaveBeenCalledWith(true);
  });

  it("links_to_delete_account", async () => {
    await render(client(<SecurityScreen />));
    await fireEvent.press(screen.getByLabelText("Delete my account"));
    expect(jest.requireMock("expo-router").router.push).toHaveBeenCalledWith("/delete-account");
  });
});

describe("legal", () => {
  it("opens_the_public_page_in_the_in_app_browser", async () => {
    mockParams = { doc: "privacy" };
    await render(client(<LegalScreen />));
    await waitFor(() => expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(expect.stringMatching(/\/privacy$/)));
    expect(screen.getByText("Privacy policy")).toBeTruthy();
  });

  it("unknown_document_says_so", async () => {
    mockParams = { doc: "nope" };
    await render(client(<LegalScreen />));
    expect(screen.getByText(/couldn.t find that document/i)).toBeTruthy();
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
  });
});

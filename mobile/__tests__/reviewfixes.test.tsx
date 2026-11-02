import { useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import AppProviders from "../src/ui/AppProviders";
import CheckoutScreen from "../src/app/checkout";
import BookingScreen from "../src/app/booking/[id]";
import Explore from "../src/app/customer/explore";
import SupportChat from "../src/app/support/[id]";
import { ListingCard } from "../src/features/browse/ListingCard";
import { normalizeDeal } from "../src/features/browse/queries";
import { waitForPayment } from "../src/features/cart/checkout";
import { toResult, messageFor } from "../src/lib/authApi";
import { api, ApiError } from "../src/lib/api";
import { useSignOutRedirect } from "../src/lib/useSignOutRedirect";
import { useReducedMotion } from "../src/features/listing/useReducedMotion";
import { useAuth } from "../src/state/auth";
import { session } from "../src/lib/session";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({})) }));
jest.mock("expo-location", () => ({ requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })), Accuracy: { Balanced: 3 } }));
jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native");
  const React = require("react");
  return { __esModule: true, default: () => React.createElement(View), DateTimePickerAndroid: { open: jest.fn() } };
});
let mockReduced = false;
jest.mock("react-native-reanimated", () => {
  const actual = jest.requireActual("react-native-reanimated");
  return { ...actual, useReducedMotion: () => mockReduced };
});
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;
const { router } = jest.requireMock("expo-router");

function withClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  mockReduced = false;
  useAuth.setState({ status: "signedIn", account: { type: "customer", id: 1, fullName: "Ama" } } as never);
});

describe("review fix 1: the app has a query client", () => {
  it("app_providers_gives_screens_a_query_client", async () => {
    apiMock.mockResolvedValue({ ok: true });
    function Probe() {
      const q = useQuery({ queryKey: ["probe"], queryFn: () => api<{ ok: boolean }>("/x") });
      return <Text>{q.data ? "loaded" : "loading"}</Text>;
    }
    await render(<AppProviders><Probe /></AppProviders>);
    expect(await screen.findByText("loaded")).toBeTruthy();
  });
});

describe("review fix 2: deals rows are not listing rows", () => {
  const row = { id: 3, name: "Kente stole", photo: "https://x/p.jpg", category_label: "Fashion", price_amount: "500.00", sale_price: "400.00", was_price: "500.00", discount_percent: 20, sponsored: true, review_count: 0, avg_rating: null };
  it("a_deal_row_renders_without_an_owner", async () => {
    const card = normalizeDeal(row);
    expect(card.effective_price).toBe("400.00");
    expect(card.is_promoted).toBe(true);
    await render(<ListingCard compact listing={card} onPress={() => {}} />);
    expect(screen.getByText("Kente stole")).toBeTruthy();
    expect(screen.getByText("GH₵ 400.00")).toBeTruthy();
  });
});

describe("review fix 3: sign-in challenges", () => {
  it("channels_arrive_as_objects_and_leave_as_names", () => {
    const r = toResult({ mfa_token: "t", channels: [{ channel: "sms", hint: "•••4567" }, { channel: "email", hint: "a•••@x.com" }] }, "customer");
    expect(r.kind === "challenge" && r.challenge.channels).toEqual(["sms", "email"]);
  });
  it("authenticator_accounts_get_their_own_challenge_not_a_dead_end", () => {
    const r = toResult({ two_factor_required: true, mfa_token: "t" }, "business_owner");
    expect(r.kind === "challenge" && r.challenge).toEqual({ mfa_token: "t", channels: [], authenticator: true });
  });
  it("staff_refusal_says_use_the_web_dashboard_not_a_token", () => {
    const e = new ApiError(403, { token: "eyJhbGciOi...", full_name: "S" }, "staff_not_supported");
    expect(messageFor(e, "x")).toMatch(/web dashboard/i);
    expect(messageFor(e, "x")).not.toMatch(/eyJ/);
  });
});

describe("review fix 5: payment status words", () => {
  it("success_is_paid_and_expired_is_failed", async () => {
    apiMock.mockResolvedValueOnce({ status: "success", order_id: 5 });
    expect(await waitForPayment("R1", () => false)).toEqual({ status: "paid", orderId: 5 });
    apiMock.mockResolvedValueOnce({ status: "expired", order_id: 5 });
    expect((await waitForPayment("R2", () => false)).status).toBe("failed");
  });
});

describe("review fix 6 and 11: checkout", () => {
  const cart = { id: 1, total: "900.00", items: [{ id: 11, listing: 7, listing_name: "Kente", variant_label: "", quantity: 2, unit_price_snapshot: "450.00", line_total: "900.00", in_stock: true }] };
  function server(over: Record<string, unknown> = {}) {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/cart/") return cart;
      if (path === "/api/storefront/opening/") return { gate_enabled: false, is_open: true, server_now: "2026-11-07T10:00:00Z" };
      if (path === "/api/orders/delivery-preview/") return { delivery: null };
      if (path === "/api/orders/checkout/") return { mode: "redirect", checkout_url: "https://pay/x", reference: "R9" };
      if (path.startsWith("/api/payments/checkout-sessions/")) return { status: "pending" };
      return over[path] ?? {};
    });
  }
  it("stop_waiting_does_not_reenable_pay_and_points_to_orders", async () => {
    server();
    await render(withClient(<CheckoutScreen />));
    await fireEvent.press(await screen.findByLabelText("Store pickup"));
    await fireEvent.press(await screen.findByLabelText(/^Pay /));
    await fireEvent.press(await screen.findByLabelText("Stop waiting"));
    expect(await screen.findByText(/check your orders/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^Pay /)).toBeNull();
  });
  it("door_to_door_without_a_fee_does_not_state_a_total_in_the_pay_button", async () => {
    server();
    await render(withClient(<CheckoutScreen />));
    await fireEvent.press(await screen.findByLabelText("Door-to-door delivery"));
    expect(screen.getByLabelText(/^Pay with Mobile Money/)).toBeTruthy();
    expect(screen.queryByLabelText(/Pay GH₵/)).toBeNull();
  });
});

describe("review fix 7: losing the session sends you to the front", () => {
  it("signed_in_to_signed_out_goes_to_welcome", async () => {
    await renderHook(() => useSignOutRedirect());
    await act(async () => { useAuth.setState({ status: "signedOut", account: undefined } as never); });
    expect(router.replace).toHaveBeenCalledWith("/welcome");
  });
});

describe("review fix 8: offline start keeps the session", () => {
  it("a_network_error_is_not_a_sign_out", async () => {
    const clear = jest.spyOn(session, "clear").mockResolvedValue(undefined as never);
    jest.spyOn(session, "load").mockResolvedValue({ access: "a", refresh: "r" } as never);
    apiMock.mockRejectedValue(new TypeError("Network request failed"));
    useAuth.setState({ status: "loading", account: undefined } as never);
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().status).toBe("offline");
    expect(clear).not.toHaveBeenCalled();
  });
  it("a_401_still_signs_out", async () => {
    jest.spyOn(session, "load").mockResolvedValue({ access: "a", refresh: "r" } as never);
    apiMock.mockRejectedValue(new ApiError(401, {}));
    useAuth.setState({ status: "loading", account: undefined } as never);
    await useAuth.getState().bootstrap();
    expect(useAuth.getState().status).toBe("signedOut");
  });
});

describe("review fix 9: reduce motion is known on the first render", () => {
  it("first_render_already_reduced", async () => {
    mockReduced = true;
    const { result } = await renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });
});

describe("review fix 10: the chat keeps its thread when a refresh fails", () => {
  it("thread_stays_after_a_throttled_refetch", async () => {
    mockParams = { id: "9" };
    let calls = 0;
    const convo = { id: 9, subject: "Kente", status: "open", updated_at: "x", messages: [{ id: 1, sender_type: "customer", body: "Hello there", created_at: "x" }] };
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/messaging/conversations/") { if (++calls > 1) throw new ApiError(429, {}); return [convo]; }
      return {};
    });
    await render(withClient(<SupportChat />));
    await fireEvent.changeText(await screen.findByLabelText("Your message"), "More");
    await fireEvent.press(screen.getByLabelText("Send message"));
    await waitFor(() => expect(calls).toBeGreaterThan(1));
    expect(screen.getByText("Hello there")).toBeTruthy();
    expect(screen.queryByText(/couldn.t load this conversation/i)).toBeNull();
  });
});

describe("review fix 12: no promises of screens that do not exist", () => {
  it("service_request_sent_does_not_point_to_orders", async () => {
    mockParams = { id: "6" };
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/listings/6/") return { id: 6, name: "Tailoring", price_amount: "1.00", main_photo: null, business_owner: { id: 2, name: "A" }, category: { kind: "service" }, photos: [], variants: [], cancellation_policy: "flexible" };
      if (path === "/api/storefront/opening/") return { gate_enabled: false, is_open: true, server_now: "x" };
      if (path === "/api/ledger/booking-terms/") return { enabled: false, policies: {} };
      return {};
    });
    await render(withClient(<BookingScreen />));
    await fireEvent.changeText(await screen.findByLabelText("What do you need?"), "Two shirts");
    await fireEvent.press(screen.getByLabelText("Send request"));
    expect(await screen.findByText(/Request sent/)).toBeTruthy();
    expect(screen.queryByText(/under Orders|from your orders|View my orders/i)).toBeNull();
    expect(screen.getByLabelText("Contact Support")).toBeTruthy();
  });
});

describe("review fix 13: a second department from Home changes Explore", () => {
  it("category_param_change_updates_the_list", async () => {
    mockParams = { category: "food" };
    apiMock.mockImplementation(async (path: string, init?: { query?: Record<string, string> }) => {
      if (path === "/api/storefront/home/") return { most_visited: [] };
      return { results: [], next: null, _cat: init?.query?.category };
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const ui = () => <QueryClientProvider client={qc}><Explore /></QueryClientProvider>;
    const view = await render(ui());
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/listings/", expect.objectContaining({ query: expect.objectContaining({ category: "food" }) })));
    mockParams = { category: "crafts" };
    await view.rerender(ui());
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/listings/", expect.objectContaining({ query: expect.objectContaining({ category: "crafts" }) })));
  });
});

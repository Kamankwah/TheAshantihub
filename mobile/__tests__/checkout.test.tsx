import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import CartScreen from "../src/app/cart";
import CheckoutScreen from "../src/app/checkout";
import OrderConfirmed from "../src/app/order-confirmed";
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
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({})) }));
jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 6.69, longitude: -1.62 } })),
  Accuracy: { Balanced: 3 },
}));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;
const { router } = jest.requireMock("expo-router");

const cart = {
  id: 1,
  total: "900.00",
  items: [
    { id: 11, listing: 7, listing_name: "Hand-woven kente stole", variant: null, variant_label: "", quantity: 2, unit_price_snapshot: "450.00", line_total: "900.00", seller_name: "Akosua Ntoma Store", in_stock: true, stock_quantity: 5, listing_photo: null },
  ],
};

function mockServer(opts: { wallet?: object | Error; opening?: object; checkout?: (body: Record<string, unknown>) => unknown; preview?: object; session?: () => object } = {}) {
  apiMock.mockImplementation(async (path: string, init?: { body?: Record<string, unknown>; method?: string; query?: Record<string, unknown> }) => {
    if (path === "/api/cart/") return cart;
    if (path === "/api/cart/guard/") return { listing: { blocked: null } };
    if (path === "/api/wallet/") {
      if (opts.wallet instanceof Error) throw opts.wallet;
      if (opts.wallet) return opts.wallet;
      throw new ApiError(409, { code: "ledger_off" }, "ledger_off");
    }
    if (path === "/api/storefront/opening/") return { server_now: new Date().toISOString(), gate_enabled: false, is_open: true, ...opts.opening };
    if (path === "/api/orders/delivery-preview/") return opts.preview ?? { delivery: null };
    if (path === "/api/orders/checkout/") {
      const out = opts.checkout ? opts.checkout(init!.body!) : { id: 501, status: "paid", total_amount: "900.00" };
      if (out instanceof Error) throw out;
      return out;
    }
    if (path.startsWith("/api/payments/checkout-sessions/")) return opts.session ? opts.session() : { status: "paid", order_id: 501 };
    if (path.startsWith("/api/cart/items/")) return {};
    throw new ApiError(404, {});
  });
}

function client(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  useAuth.setState({ status: "signedIn", account: { type: "customer", id: 1, fullName: "Ama" } });
});

async function chooseDoorToDoor() {
  await fireEvent.press(await screen.findByLabelText("Door-to-door delivery"));
}
async function fillAddress(over: { gps?: string; landmark?: string } = {}) {
  await fireEvent.changeText(screen.getByLabelText("Delivery address"), "12 Adum Road, Kumasi");
  await fireEvent.changeText(screen.getByLabelText("Phone for the rider"), "0241234567");
  await fireEvent.changeText(screen.getByLabelText("GhanaPost digital address"), over.gps ?? "AK-039-5028");
  await fireEvent.changeText(screen.getByLabelText("Nearest landmark"), over.landmark ?? "Opposite the blue kiosk");
}

describe("cart", () => {
  it("cart_shows_no_delivery_date", async () => {
    mockServer();
    await render(client(<CartScreen />));
    expect(await screen.findByText("Hand-woven kente stole")).toBeTruthy();
    expect(screen.getByText(/worked out at checkout/i)).toBeTruthy();
    expect(screen.queryByText(/arrives|delivered by|estimated|delivery date/i)).toBeNull();
    expect(screen.getAllByText("GH₵ 900.00")).toHaveLength(2); // the line and the items total
  });

  it("empty_cart_offers_browsing", async () => {
    apiMock.mockResolvedValue({ id: 1, total: "0.00", items: [] });
    await render(client(<CartScreen />));
    expect(await screen.findByText(/cart is empty/i)).toBeTruthy();
  });

  it("removing_a_line_calls_delete", async () => {
    mockServer();
    await render(client(<CartScreen />));
    await fireEvent.press(await screen.findByLabelText("Remove Hand-woven kente stole"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/cart/items/11/", expect.objectContaining({ method: "DELETE" })));
  });
});

describe("checkout", () => {
  it("door_to_door_requires_ghanapost_and_landmark", async () => {
    mockServer();
    await render(client(<CheckoutScreen />));
    await chooseDoorToDoor();
    await fillAddress({ gps: "", landmark: "" });
    expect(screen.getByLabelText(/^Pay /).props.accessibilityState.disabled).toBe(true);
    await fillAddress();
    await waitFor(() => expect(screen.getByLabelText(/^Pay /).props.accessibilityState.disabled).toBe(false));
  });

  it("pickup_does_not", async () => {
    mockServer();
    await render(client(<CheckoutScreen />));
    await fireEvent.press(await screen.findByLabelText("Store pickup"));
    expect(screen.queryByLabelText("GhanaPost digital address")).toBeNull();
    expect(screen.queryByLabelText("Nearest landmark")).toBeNull();
    await waitFor(() => expect(screen.getByLabelText(/^Pay /).props.accessibilityState.disabled).toBe(false));
  });

  it("wallet_option_disabled_not_available_yet", async () => {
    mockServer();
    await render(client(<CheckoutScreen />));
    const wallet = await screen.findByLabelText("AshantiHub wallet, not available yet");
    expect(wallet.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText("Mobile Money")).toBeTruthy();
    expect(screen.queryByText(/card number|saved card|default payment/i)).toBeNull();
  });

  it("wallet_option_turns_on_only_when_the_server_wallet_covers_the_total", async () => {
    mockServer({ wallet: { kind: "customer", balance: "1000.00" } });
    await render(client(<CheckoutScreen />));
    const wallet = await screen.findByLabelText("AshantiHub wallet, balance GH₵ 1,000.00");
    expect(wallet.props.accessibilityState.disabled).toBe(false);
    expect(screen.getByLabelText("Pay GH₵ 900.00 with Mobile Money")).toBeTruthy();
    await fireEvent.press(wallet);
    expect(await screen.findByLabelText("Pay GH₵ 900.00 from your wallet")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Pay GH₵ 900.00 from your wallet"));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const sent = apiMock.mock.calls.find((c) => c[0] === "/api/orders/checkout/")![1].body;
    expect(sent.payment_method).toBe("wallet");
    expect(typeof sent.request_id).toBe("string"); // the idempotency key (MOB-09): a retry returns the first order
    expect(sent.request_id.length).toBeGreaterThan(8);
    expect(router.replace).toHaveBeenCalledWith({ pathname: "/order-confirmed", params: { id: "501" } });
  });

  it("wallet_option_says_balance_too_low_and_cannot_be_chosen", async () => {
    mockServer({ wallet: { kind: "customer", balance: "100.00" } });
    await render(client(<CheckoutScreen />));
    const wallet = await screen.findByLabelText("AshantiHub wallet, balance too low (GH₵ 100.00)");
    expect(wallet.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(wallet);
    await fireEvent.press(await screen.findByLabelText(/^Pay /));
    await waitFor(() => expect(apiMock.mock.calls.some((c) => c[0] === "/api/orders/checkout/")).toBe(true));
    expect(apiMock.mock.calls.find((c) => c[0] === "/api/orders/checkout/")![1].body.payment_method).toBe("momo");
  });

  it("a_wallet_payment_the_server_refuses_shows_its_words_and_places_no_order", async () => {
    mockServer({
      wallet: { kind: "customer", balance: "1000.00" },
      checkout: () => new ApiError(409, { detail: "Your AshantiHub wallet doesn't hold enough for this order.", code: "insufficient_funds" }, "insufficient_funds"),
    });
    await render(client(<CheckoutScreen />));
    await fireEvent.press(await screen.findByLabelText("AshantiHub wallet, balance GH₵ 1,000.00"));
    await fireEvent.press(await screen.findByLabelText("Pay GH₵ 900.00 from your wallet"));
    expect(await screen.findByText(/wallet doesn't hold enough/i)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("delivery_fee_line_says_worked_out_at_checkout_until_the_preview_returns_one", async () => {
    mockServer();
    await render(client(<CheckoutScreen />));
    await chooseDoorToDoor();
    expect(await screen.findByText(/worked out at checkout/i)).toBeTruthy();
  });

  it("delivery_fee_from_the_preview_is_added_to_the_total", async () => {
    mockServer({ preview: { delivery: { fee: "15.00", fee_status: "ok", waived: false } } });
    await render(client(<CheckoutScreen />));
    await chooseDoorToDoor();
    await fireEvent.press(await screen.findByLabelText("Use my current location as the delivery point"));
    expect(await screen.findByText("GH₵ 15.00")).toBeTruthy();
    expect(screen.getByLabelText("Pay GH₵ 915.00 with Mobile Money")).toBeTruthy();
  });

  it("sends_the_delivery_fields_and_goes_to_confirmed", async () => {
    mockServer();
    await render(client(<CheckoutScreen />));
    await chooseDoorToDoor();
    await fillAddress();
    await fireEvent.press(screen.getByLabelText(/^Pay /));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: "/order-confirmed", params: { id: "501" } }));
    const call = apiMock.mock.calls.find((c) => c[0] === "/api/orders/checkout/");
    expect(call[1].body).toMatchObject({
      payment_method: "momo", delivery_method: "door_to_door",
      delivery_address: "12 Adum Road, Kumasi", delivery_phone: "0241234567",
      delivery_gps_address: "AK-039-5028", delivery_landmark: "Opposite the blue kiosk",
    });
  });

  async function sentGps(typed: string) {
    mockServer();
    await render(client(<CheckoutScreen />));
    await chooseDoorToDoor();
    await fillAddress({ gps: typed });
    await fireEvent.press(screen.getByLabelText(/^Pay /));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: "/order-confirmed", params: { id: "501" } }));
    return apiMock.mock.calls.find((c) => c[0] === "/api/orders/checkout/")[1].body.delivery_gps_address;
  }

  it("sends_a_loosely_typed_ghanapost_code_in_canonical_form", async () => {
    expect(await sentGps(" ak 039 5028 ")).toBe("AK-039-5028");
  });

  it("sends_a_letter_bearing_ghanapost_code_in_canonical_form", async () => {
    expect(await sentGps("aot0103560")).toBe("AO-T010-3560");
  });

  it("server_field_errors_show_under_the_field", async () => {
    mockServer({ checkout: () => new ApiError(400, { delivery_gps_address: ["That is not an Ashanti Region digital address."] }) });
    await render(client(<CheckoutScreen />));
    await chooseDoorToDoor();
    await fillAddress({ gps: "GA-123-4567" });
    await fireEvent.press(screen.getByLabelText(/^Pay /));
    expect(await screen.findByText(/not an Ashanti Region/)).toBeTruthy();
  });

  it("polls_until_paid_then_shows_confirmed", async () => {
    let calls = 0;
    mockServer({
      checkout: () => ({ mode: "redirect", checkout_url: "https://pay.example/x", reference: "REF1" }),
      session: () => (++calls < 2 ? { status: "pending", order_id: 501 } : { status: "paid", order_id: 501 }),
    });
    await render(client(<CheckoutScreen />));
    await fireEvent.press(await screen.findByLabelText("Store pickup"));
    await fireEvent.press(await screen.findByLabelText(/^Pay /));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: "/order-confirmed", params: { id: "501" } }), { timeout: 8000 });
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("a_failed_payment_says_so_and_keeps_the_cart", async () => {
    mockServer({
      checkout: () => ({ mode: "redirect", checkout_url: "https://pay.example/x", reference: "REF2" }),
      session: () => ({ status: "failed", order_id: 501 }),
    });
    await render(client(<CheckoutScreen />));
    await fireEvent.press(await screen.findByLabelText("Store pickup"));
    await fireEvent.press(await screen.findByLabelText(/^Pay /));
    expect(await screen.findByText(/payment didn.t go through/i)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("closed_marketplace_message_replaces_pay_button", async () => {
    mockServer({ opening: { gate_enabled: true, is_open: false, opens_at: "2026-11-06T06:00:00Z" } });
    await render(client(<CheckoutScreen />));
    expect(await screen.findByText(/opens on/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^Pay /)).toBeNull();
  });
});

describe("order confirmed", () => {
  it("shows_the_order_and_no_delivery_date", async () => {
    mockParams = { id: "501" };
    await render(client(<OrderConfirmed />));
    expect(screen.getByText(/Order #501/)).toBeTruthy();
    expect(screen.queryByText(/arrives|delivered by|estimated/i)).toBeNull();
    await fireEvent.press(screen.getByLabelText("Track this order"));
    expect(router.replace).toHaveBeenCalledWith("/order/501");
  });
});

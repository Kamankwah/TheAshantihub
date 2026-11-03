import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import ScreenMoney from "../src/app/business/money";
import { api, ApiError } from "../src/lib/api";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({}),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("expo-screen-capture", () => ({ usePreventScreenCapture: jest.fn() }));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;

const page = (results: unknown[]) => ({ count: results.length, next: null, previous: null, results });
const overview = (over: Record<string, unknown> = {}) => ({
  pending: "12.00", available: "48.50", withdrawable: "48.50", negative: false, awaiting_call: 2, withdrawing: "0.00",
  fee_cap: { limit: "500.00", used: "120.00", remaining: "380.00" }, ...over,
});
const sale = (over: Record<string, unknown> = {}) => ({
  kind: "order", order: 42, reference: "Order #42", placed_at: "2026-11-02T09:00:00Z", items: [{ name: "Hand-woven kente stole", quantity: 1, line_total: "450.00" }],
  item_subtotal: "450.00", refunded: "0.00", platform_fee: "9.00", free_delivery_promo: "0.00", net: "441.00", status: "awaiting_call",
  status_label: "Waiting for the customer to collect", on_hold: false, handed_over: false, released_at: null, ...over,
});
const booking = () => ({
  kind: "booking", sale: 5, booking_kind: "stay", booking_kind_label: "Stay", reference: "Booking #5", what: "2 nights, Room 3", placed_at: "2026-11-02T09:00:00Z",
  item_subtotal: "300.00", refunded: "0.00", platform_fee: "6.00", free_delivery_promo: "0.00", net: "294.00", status: "released", status_label: "Released to you", on_hold: false,
});
const totals = { orders: 3, sold: "900.00", fees: "18.00", released: "400.00", refunded: "0.00", free_delivery_promo: "0.00", withdrawn: "100.00", other: "0.00", net_change: "782.00" };

let state: { overview: unknown; sales: unknown[] };
let calls: { path: string; query?: Record<string, unknown> }[];

function serve() {
  apiMock.mockImplementation(async (path: string, init?: { query?: Record<string, unknown> }) => {
    calls.push({ path, query: init?.query });
    if (path === "/api/wallet/vendor/") {
      if (state.overview instanceof ApiError) throw state.overview;
      return state.overview;
    }
    if (path === "/api/wallet/vendor/sales/") return page(state.sales);
    if (path === "/api/wallet/vendor/bookings/") return page([booking()]);
    if (path === "/api/wallet/vendor/daily/") return { from: "2026-10-03", to: "2026-11-02", days: [{ day: "2026-11-02", ...totals }], totals };
    if (path === "/api/wallet/vendor/fees/") {
      return {
        fee_base: "Worked out per order on your items' total, never on delivery.", fee_cap: { limit: "500.00", used: "120.00", remaining: "380.00" },
        categories: [{ category: "product", label: "Products", applies_to: "Product orders", charged: true, in_force_from: "2026-10-01T00:00:00Z", bands: [{ from: "0.00", to: "1000.00", percent: "2", fee: "2%" }], next: null }],
      };
    }
    if (path === "/api/wallet/destinations/") return { results: [{ id: 7, rail: "momo", institution: "MTN", account_number_masked: "024****567", account_name: "Akosua Ntoma", usable_from: "2026-11-01T10:00:00Z", usable: true, removed: false }], cooling_hours: 24 };
    if (path === "/api/wallet/withdrawals/") return page([]);
    throw new ApiError(404, {});
  });
}

function client(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  calls = [];
  state = { overview: overview(), sales: [sale()] };
  serve();
});

describe("business money", () => {
  it("blocks_screenshots_and_screen_recording_of_money", async () => {
    const capture = jest.requireMock("expo-screen-capture").usePreventScreenCapture as jest.Mock;
    await render(client(<ScreenMoney />));
    await screen.findByText("GH₵ 48.50");
    expect(capture).toHaveBeenCalled();
  });

  it("off_state_is_calm_and_shows_no_money", async () => {
    state.overview = new ApiError(409, { code: "ledger_off" }, "ledger_off");
    await render(client(<ScreenMoney />));
    expect(await screen.findByText("Money is not available yet")).toBeTruthy();
    expect(screen.queryByText(/GH₵/)).toBeNull();
    expect(screen.queryByLabelText("Withdraw")).toBeNull();
  });

  it("shows_pending_available_and_what_can_be_withdrawn", async () => {
    await render(client(<ScreenMoney />));
    expect(await screen.findByText("GH₵ 48.50")).toBeTruthy();
    expect(screen.getByText("GH₵ 12.00")).toBeTruthy();
    expect(screen.getByText(/2 sales are waiting to be released/i)).toBeTruthy();
    expect(screen.getByText(/GH₵ 120\.00 of GH₵ 500\.00/)).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText("Withdraw").props.accessibilityState?.disabled).toBe(false));
  });

  it("a_negative_available_balance_is_explained_and_blocks_withdrawing", async () => {
    state.overview = overview({ available: "-5.00", withdrawable: "0.00", negative: true });
    await render(client(<ScreenMoney />));
    expect(await screen.findByText(/below zero after a refund/i)).toBeTruthy();
    expect(screen.getByLabelText("Withdraw").props.accessibilityState?.disabled).toBe(true);
  });

  it("sales_tab_lists_orders_without_any_customer_detail", async () => {
    await render(client(<ScreenMoney />));
    await screen.findByText("GH₵ 48.50");
    expect(await screen.findByText("Order #42")).toBeTruthy();
    expect(screen.getByText(/Hand-woven kente stole/)).toBeTruthy();
    expect(screen.getByText("Waiting for the customer to collect")).toBeTruthy();
    expect(screen.getByText(/Fee GH₵ 9\.00/)).toBeTruthy();
    expect(screen.getByText(/You keep GH₵ 441\.00/)).toBeTruthy();
    expect(calls.find((c) => c.path === "/api/wallet/vendor/sales/")?.query?.status).toBe("all");
  });

  it("filtering_sales_asks_the_server_for_that_status", async () => {
    await render(client(<ScreenMoney />));
    await screen.findByText("Order #42");
    await fireEvent.press(screen.getByLabelText("Released"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/wallet/vendor/sales/" && c.query?.status === "released")).toBe(true));
  });

  it("bookings_days_fees_and_payouts_tabs_each_show_their_data", async () => {
    await render(client(<ScreenMoney />));
    await screen.findByText("GH₵ 48.50");
    await fireEvent.press(screen.getByLabelText("Bookings"));
    expect(await screen.findByText("Booking #5")).toBeTruthy();
    expect(screen.getByText(/2 nights, Room 3/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Days"));
    await screen.findByText("Total");
    expect(screen.getAllByText(/Sold GH₵ 900\.00/)).toHaveLength(2); // the range total and the one day
    await fireEvent.press(screen.getByLabelText("Fees"));
    expect(await screen.findByText("Product orders")).toBeTruthy();
    expect(screen.getByText(/never on delivery/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Payouts"));
    expect(await screen.findByText(/MTN · 024\*\*\*\*567/)).toBeTruthy();
    expect(await screen.findByText("No withdrawals yet.")).toBeTruthy();
  });

  it("offers_no_statement_download_because_a_file_cannot_be_saved_honestly_yet", async () => {
    await render(client(<ScreenMoney />));
    await screen.findByText("GH₵ 48.50");
    expect(screen.queryByText(/download|export/i)).toBeNull();
  });
});

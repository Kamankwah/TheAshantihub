import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import BookingScreen from "../src/app/booking/[id]";
import MyBookings from "../src/app/bookings";
import { api, ApiError } from "../src/lib/api";
import { useAuth } from "../src/state/auth";

const params: { id: string } = { id: "5" };
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => params,
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({ type: "dismiss" })) }));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
jest.mock("../src/features/cart/checkout", () => ({ ...jest.requireActual("../src/features/cart/checkout"), waitForPayment: jest.fn(async () => ({ status: "paid" })) }));
const apiMock = api as jest.Mock;
const { router } = jest.requireMock("expo-router");

const stay = { id: 5, name: "Kumasi Guesthouse", price_amount: "300.00", effective_price: "300.00", main_photo: null, review_count: 0, business_owner: { id: 2, name: "Akosua" }, category: { kind: "service", is_accommodation: true }, cancellation_policy: "moderate" };
const off = () => new ApiError(409, { detail: "off", code: "ledger_off" });
const money = (over: Record<string, unknown> = {}) => ({
  sale: 12, release_at: "2026-12-01T06:00:00Z", released_at: null, accepted_at: null, refunded: null, refunded_whole: false, problem: null, policy: null, start: null,
  can_cancel: true, cancelled_by_you: false, can_report: true, ...over,
});
const booking = (over: Record<string, unknown> = {}) => ({
  id: 21, listing: 5, listing_name: "Kumasi Guesthouse", check_in: "2026-12-01", check_out: "2026-12-03", nights: 2, units: 1, nightly_rate: "300.00", total_price: "600.00",
  status: "confirmed", paid_at: "2026-11-02T10:00:00Z", money: null, ...over,
});
const request = (over: Record<string, unknown> = {}) => ({
  id: 31, listing: 6, listing_name: "Tailoring", message: "Two shirts", budget: null, agreed_price: null, decline_reason: "", progress_note: "", status: "requested",
  responded_at: null, paid_at: null, completed_at: null, created_at: "2026-11-02T10:00:00Z", auto_accept_at: null, settled: false, problem_reported: false, money: null, ...over,
});

type Calls = { path: string; init?: { method?: string; body?: Record<string, unknown> } }[];
let calls: Calls;
let world: { wallet: unknown; bookings: unknown[]; requests: unknown[]; bookResult: unknown; payResult: unknown };

function serve() {
  apiMock.mockImplementation(async (path: string, init?: Calls[number]["init"]) => {
    calls.push({ path, init });
    const post = init?.body !== undefined;
    if (path === "/api/listings/5/") return stay;
    if (path === "/api/storefront/opening/") return { server_now: new Date().toISOString(), gate_enabled: false, is_open: true };
    if (path === "/api/ledger/booking-terms/") return { enabled: true, event_release_delay_hours: 24, service_auto_accept_hours: 72, stay_issue_window_hours: 24, policies: {} };
    if (path === "/api/bookings/availability/") return { available: true, units_free: 2, nights: 1, nightly_rate: "300.00", units: 1, total_price: "300.00" };
    if (path === "/api/bookings/" && post) return world.bookResult;
    if (path === "/api/wallet/") {
      if (world.wallet instanceof ApiError) throw world.wallet;
      return world.wallet;
    }
    if (path === "/api/wallet/processing/") return { amount: "300.00", payment_processing: "4.50", you_pay: "304.50", provider: "simulated" };
    if (path === "/api/bookings/mine/") return world.bookings;
    if (path === "/api/services/requests/mine/") return world.requests;
    if (path === "/api/bookings/21/cancel/" && post) return { cancelled: true };
    if (path === "/api/services/requests/31/pay/" && post) return world.payResult;
    if (path === "/api/services/requests/31/accept/" && post) return { released: true };
    if (path === "/api/services/requests/31/cancel/" && post) return { cancelled: true, wallet_refund: "80.00" };
    if (path === "/api/ledger/bookings/12/cancel-quote/") return { refund: "80.00", whole: true };
    throw new ApiError(404, {});
  });
}
function withClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}
beforeEach(() => {
  jest.clearAllMocks();
  calls = [];
  params.id = "5";
  world = { wallet: off(), bookings: [], requests: [], bookResult: { id: 77, total_price: "300.00" }, payResult: request({ status: "in_progress" }) };
  serve();
  useAuth.setState({ status: "signedIn", account: { type: "customer", id: 1, fullName: "Ama" } });
});

describe("booking a stay", () => {
  it("offers_the_wallet_and_sends_payment_method_wallet_when_the_balance_covers_the_total", async () => {
    world.wallet = { kind: "customer", balance: "500.00" };
    await render(withClient(<BookingScreen />));
    const wallet = await screen.findByLabelText(/AshantiHub wallet, balance/i);
    await waitFor(() => expect(wallet.props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(wallet);
    await waitFor(() => expect(screen.getByLabelText("Book this stay").props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByLabelText("Book this stay"));
    await waitFor(() => expect(screen.getByText(/Booking confirmed/i)).toBeTruthy());
    expect(calls.find((c) => c.path === "/api/bookings/")!.init?.body).toMatchObject({ listing: 5, units: 1, payment_method: "wallet" });
  });

  it("momo_shows_what_you_pay_with_the_processing_charge_while_the_ledger_is_on", async () => {
    world.wallet = { kind: "customer", balance: "1.00" };
    await render(withClient(<BookingScreen />));
    expect(await screen.findByText("You pay GH₵ 304.50")).toBeTruthy();
    const wallet = screen.getByLabelText(/AshantiHub wallet, balance too low/i);
    expect(wallet.props.accessibilityState.disabled).toBe(true);
  });

  it("with_the_ledger_off_the_request_is_unchanged_and_the_wallet_says_not_available_yet", async () => {
    await render(withClient(<BookingScreen />));
    await screen.findByText("GH₵ 300.00");
    await waitFor(() => expect(screen.getByLabelText("Book this stay").props.accessibilityState.disabled).toBe(false));
    expect(screen.getByLabelText(/AshantiHub wallet, not available yet/i).props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText("Book this stay"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/bookings/" && c.init?.body)).toBe(true));
    expect(calls.find((c) => c.path === "/api/bookings/")!.init?.body).not.toHaveProperty("payment_method");
  });

  it("a_redirect_payment_waits_then_confirms_instead_of_leaving_the_screen", async () => {
    world.bookResult = { mode: "redirect", checkout_url: "https://pay.example/b/1", reference: "B1" };
    await render(withClient(<BookingScreen />));
    await screen.findByText("GH₵ 300.00");
    await waitFor(() => expect(screen.getByLabelText("Book this stay").props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByLabelText("Book this stay"));
    await waitFor(() => expect(screen.getByText(/Booking confirmed/i)).toBeTruthy());
  });

  it("confirmation_points_to_bookings_and_requests_not_the_website", async () => {
    await render(withClient(<BookingScreen />));
    await screen.findByText("GH₵ 300.00");
    await waitFor(() => expect(screen.getByLabelText("Book this stay").props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByLabelText("Book this stay"));
    await screen.findByText(/Booking confirmed/i);
    expect(screen.queryByText(/website/i)).toBeNull();
    await fireEvent.press(screen.getByLabelText("View my bookings"));
    expect(router.push).toHaveBeenCalledWith("/bookings");
  });
});

describe("bookings and requests", () => {
  it("lists_stays_with_dates_status_and_the_servers_total", async () => {
    world.bookings = [booking()];
    await render(withClient(<MyBookings />));
    expect(await screen.findByText("Kumasi Guesthouse")).toBeTruthy();
    expect(screen.getByText(/2026-12-01 to 2026-12-03/)).toBeTruthy();
    expect(screen.getByText(/600\.00/)).toBeTruthy();
    expect(screen.getByText("Confirmed")).toBeTruthy();
  });

  it("with_the_ledger_off_a_confirmed_stay_can_be_cancelled_after_a_confirmation_that_says_no_refund_is_made", async () => {
    world.bookings = [booking()];
    await render(withClient(<MyBookings />));
    await fireEvent.press(await screen.findByLabelText("Cancel booking"));
    expect(await screen.findByText(/No refund is made in the app/i)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Yes, cancel booking"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/bookings/21/cancel/")).toBe(true));
  });

  it("with_a_money_block_the_stay_shows_the_servers_payout_line_and_offers_report", async () => {
    world.bookings = [booking({ money: money() })];
    await render(withClient(<MyBookings />));
    expect(await screen.findByText(/The host is paid on Tue 1 Dec, 06:00 unless you report a problem before then\./)).toBeTruthy();
    expect(screen.getByLabelText("Report a problem")).toBeTruthy();
  });

  it("a_requested_service_says_it_is_waiting_for_the_business_and_has_no_pay_button", async () => {
    world.requests = [request()];
    await render(withClient(<MyBookings />));
    await fireEvent.press(await screen.findByLabelText("Services"));
    expect(await screen.findByText("Tailoring")).toBeTruthy();
    expect(screen.getByText(/waiting for the business to reply/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^Pay /)).toBeNull();
  });

  it("an_accepted_quote_is_paid_from_the_wallet_when_it_covers_the_price", async () => {
    world.wallet = { kind: "customer", balance: "500.00" };
    world.requests = [request({ status: "accepted", agreed_price: "250.00" })];
    await render(withClient(<MyBookings />));
    await fireEvent.press(await screen.findByLabelText("Services"));
    expect(await screen.findByText(/Quote: GH₵ 250\.00/)).toBeTruthy();
    const wallet = await screen.findByLabelText(/AshantiHub wallet, balance/i);
    await waitFor(() => expect(wallet.props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(wallet);
    await fireEvent.press(screen.getByLabelText("Pay for Tailoring"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/services/requests/31/pay/")).toBe(true));
    expect(calls.find((c) => c.path === "/api/services/requests/31/pay/")!.init?.body).toEqual({ payment_method: "wallet" });
  });

  it("a_declined_request_shows_the_businesss_reason", async () => {
    world.requests = [request({ status: "declined", decline_reason: "Fully booked until January." })];
    await render(withClient(<MyBookings />));
    await fireEvent.press(await screen.findByLabelText("Services"));
    expect(await screen.findByText("Fully booked until January.")).toBeTruthy();
  });

  it("a_finished_service_can_be_accepted_or_reported", async () => {
    world.requests = [request({ status: "completed", agreed_price: "250.00", completed_at: "2026-11-02T10:00:00Z", auto_accept_at: "2026-11-05T10:00:00Z", money: money() })];
    await render(withClient(<MyBookings />));
    await fireEvent.press(await screen.findByLabelText("Services"));
    expect(await screen.findByText(/Accepts automatically on Thu 5 Nov, 10:00 unless you report a problem\./)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Accept service"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/services/requests/31/accept/")).toBe(true));
  });

  it("a_paid_service_in_progress_can_be_cancelled_with_the_servers_quote", async () => {
    world.requests = [request({ status: "in_progress", agreed_price: "250.00", money: money() })];
    await render(withClient(<MyBookings />));
    await fireEvent.press(await screen.findByLabelText("Services"));
    await fireEvent.press(await screen.findByLabelText("Cancel service"));
    expect(await screen.findByText(/GH₵ 80\.00 goes back to your AshantiHub wallet/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Yes, cancel service"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/services/requests/31/cancel/")).toBe(true));
  });

  it("empty_lists_say_so_without_inventing_rows", async () => {
    await render(withClient(<MyBookings />));
    expect(await screen.findByText(/No stay bookings yet/i)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Services"));
    expect(await screen.findByText(/No service requests yet/i)).toBeTruthy();
  });
});

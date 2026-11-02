import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import EventScreen from "../src/app/event/[id]";
import MyTickets from "../src/app/tickets";
import TicketScreen from "../src/app/ticket/[id]";
import { qrMatrix } from "../src/features/tickets/qr";
import { TicketQr } from "../src/features/tickets/TicketQr";
import { api, ApiError } from "../src/lib/api";
import { useAuth } from "../src/state/auth";
import * as WebBrowser from "expo-web-browser";

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

const event = (over: Record<string, unknown> = {}) => ({
  id: 5, name: "Kumasi Kente Night", event_date: "2026-11-20T18:00:00Z", address: "Manhyia Palace Grounds", description: "An evening of kente.",
  has_tickets: true, avg_rating: null, review_count: 0, refund_until_days_before: null, organizer: { name: "Akosua Ntoma Store", kind: "business" }, ...over,
});
const types = [
  { id: 11, name: "General", description: "Standing", price: "50.00", delivery_method: "digital", quantity_remaining: 4 },
  { id: 12, name: "VIP", description: "Seated", price: "200.00", delivery_method: "digital", quantity_remaining: 0 },
];
const ticket = (over: Record<string, unknown> = {}) => ({
  id: 31, code: "TKT-AB12CD", price: "50.00", delivery_method: "digital", escrow_status: "held", delivered_at: null, refunded_at: null,
  ticket_type: { id: 11, name: "General" }, event: { id: 5, name: "Kumasi Kente Night", event_date: "2026-11-20T18:00:00Z" }, money: null, ...over,
});
const off = () => new ApiError(409, { detail: "off", code: "ledger_off" });

type Calls = { path: string; init?: { method?: string; body?: Record<string, unknown>; query?: Record<string, unknown> } }[];
let calls: Calls;
let world: { event: unknown; wallet: unknown; opening: Record<string, unknown>; purchase: unknown; mine: unknown[]; quote?: unknown; terms: unknown };

function serve() {
  apiMock.mockImplementation(async (path: string, init?: Calls[number]["init"]) => {
    calls.push({ path, init });
    const post = init?.body !== undefined;
    if (path === "/api/events/5/") return world.event;
    if (path === "/api/events/5/ticket-types/") return types;
    if (path === "/api/events/5/tickets/purchase/" && post) {
      if (world.purchase instanceof ApiError) throw world.purchase;
      return world.purchase;
    }
    if (path === "/api/events/tickets/mine/") return world.mine;
    if (path === "/api/wallet/") {
      if (world.wallet instanceof ApiError) throw world.wallet;
      return world.wallet;
    }
    if (path === "/api/wallet/processing/") return { amount: "50.00", payment_processing: "1.00", you_pay: "51.00", provider: "simulated" };
    if (path === "/api/storefront/opening/") return { server_now: new Date().toISOString(), ...world.opening };
    if (path === "/api/ledger/booking-terms/") return world.terms;
    if (path === "/api/ledger/bookings/9/cancel-quote/") return world.quote ?? { refund: "50.00", whole: true };
    if (path === "/api/events/tickets/purchases/9/cancel/" && post) return { cancelled: true, wallet_refund: "50.00" };
    throw new ApiError(404, {});
  });
}

function withClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}
const signIn = (type: "customer" | "business_owner" = "customer") => useAuth.setState({ status: "signedIn", account: { type, id: 1, fullName: "Ama Mensah" } });


async function pressBuy() {
  const buy = await screen.findByLabelText("Buy tickets");
  await waitFor(() => expect(screen.getByLabelText("Buy tickets").props.accessibilityState.disabled).toBe(false));
  await fireEvent.press(buy);
}

beforeEach(() => {
  jest.clearAllMocks();
  calls = [];
  params.id = "5";
  world = { event: event(), wallet: off(), opening: { gate_enabled: false, is_open: true }, purchase: [ticket()], mine: [], terms: { enabled: false } };
  serve();
  signIn();
});

describe("ticket QR", () => {
  it("the_qr_holds_just_the_ticket_code_and_is_the_same_every_time", () => {
    const a = qrMatrix("TKT-AB12CD");
    const b = qrMatrix("TKT-AB12CD");
    expect(a.size).toBeGreaterThanOrEqual(21);
    expect(a.dark).toEqual(b.dark);
    expect(a.dark).toHaveLength(a.size * a.size);
    expect(qrMatrix("TKT-ZZ99ZZ").dark).not.toEqual(a.dark);
  });
  it("the_qr_is_labelled_for_screen_readers_with_the_code", async () => {
    await render(<TicketQr code="TKT-AB12CD" size={200} />);
    expect(screen.getByLabelText("QR code for ticket TKT-AB12CD")).toBeTruthy();
  });
});

describe("buying tickets on the event page", () => {
  it("lists_ticket_types_with_price_and_what_is_left_and_marks_sold_out", async () => {
    await render(withClient(<EventScreen />));
    expect(await screen.findByText("General")).toBeTruthy();
    expect(screen.getByText(/50\.00/)).toBeTruthy();
    expect(screen.getByText("Only 4 left")).toBeTruthy();
    expect(screen.getByText("VIP")).toBeTruthy();
    expect(screen.getByText("Sold out")).toBeTruthy();
    expect(screen.queryByText(/not in the app yet/i)).toBeNull();
  });

  it("buys_with_mobile_money_while_the_ledger_is_off_and_sends_no_payment_method", async () => {
    await render(withClient(<EventScreen />));
    await fireEvent.press(await screen.findByLabelText("Buy General tickets"));
    await pressBuy();
    await waitFor(() => expect(calls.some((c) => c.path === "/api/events/5/tickets/purchase/")).toBe(true));
    const buy = calls.find((c) => c.path === "/api/events/5/tickets/purchase/")!;
    expect(buy.init?.body).toEqual({ ticket_type: 11, quantity: 1 });
    expect(await screen.findByText("TKT-AB12CD")).toBeTruthy();
    expect(screen.getByLabelText("QR code for ticket TKT-AB12CD")).toBeTruthy();
  });

  it("pays_from_the_wallet_when_the_server_says_it_works_and_the_balance_covers_it", async () => {
    world.wallet = { kind: "customer", balance: "300.00" };
    await render(withClient(<EventScreen />));
    await fireEvent.press(await screen.findByLabelText("Buy General tickets"));
    const wallet = await screen.findByLabelText(/AshantiHub wallet, balance/i);
    await waitFor(() => expect(wallet.props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(wallet);
    await pressBuy();
    await waitFor(() => expect(calls.some((c) => c.path === "/api/events/5/tickets/purchase/")).toBe(true));
    expect(calls.find((c) => c.path === "/api/events/5/tickets/purchase/")!.init?.body).toEqual({ ticket_type: 11, quantity: 1, payment_method: "wallet" });
  });

  it("a_customer_organised_event_takes_mobile_money_only", async () => {
    world.wallet = { kind: "customer", balance: "300.00" };
    world.event = event({ organizer: { name: "Kofi Boateng", kind: "customer" } });
    await render(withClient(<EventScreen />));
    await fireEvent.press(await screen.findByLabelText("Buy General tickets"));
    const wallet = await screen.findByLabelText(/AshantiHub wallet/i);
    expect(wallet.props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText("This event takes Mobile Money only")).toBeTruthy();
  });

  it("the_quantity_is_capped_by_what_is_left", async () => {
    await render(withClient(<EventScreen />));
    await fireEvent.press(await screen.findByLabelText("Buy General tickets"));
    for (let i = 0; i < 6; i += 1) await fireEvent.press(await screen.findByLabelText("One more ticket"));
    expect(screen.getByLabelText("One more ticket").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText("4")).toBeTruthy();
  });

  it("a_redirect_payment_opens_the_provider_then_sends_you_to_my_tickets", async () => {
    world.purchase = { mode: "redirect", checkout_url: "https://pay.example/c/1", reference: "R1" };
    await render(withClient(<EventScreen />));
    await fireEvent.press(await screen.findByLabelText("Buy General tickets"));
    await pressBuy();
    await waitFor(() => expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith("https://pay.example/c/1"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/tickets"));
  });

  it("shows_the_servers_refusal_in_plain_words", async () => {
    world.purchase = new ApiError(400, { detail: "Not enough tickets remaining." });
    await render(withClient(<EventScreen />));
    await fireEvent.press(await screen.findByLabelText("Buy General tickets"));
    await pressBuy();
    expect(await screen.findByText("Not enough tickets remaining.")).toBeTruthy();
  });

  it("says_who_can_buy_when_signed_out_or_a_business", async () => {
    useAuth.setState({ status: "signedOut", account: undefined });
    await render(withClient(<EventScreen />));
    expect(await screen.findByText("Sign in as a customer to buy tickets.")).toBeTruthy();
    expect(screen.queryByLabelText("Buy General tickets")).toBeNull();
  });

  it("business_accounts_cannot_buy", async () => {
    signIn("business_owner");
    await render(withClient(<EventScreen />));
    expect(await screen.findByText("Only customer accounts can buy tickets.")).toBeTruthy();
  });

  it("a_closed_marketplace_disables_buying_with_the_opening_date", async () => {
    world.opening = { gate_enabled: true, is_open: false, opens_at: "2026-11-06T06:00:00Z" };
    await render(withClient(<EventScreen />));
    await screen.findByText("General");
    expect(await screen.findByText(/opens on/i)).toBeTruthy();
    expect(screen.getByLabelText("Buy General tickets").props.accessibilityState.disabled).toBe(true);
  });

  it("shows_refund_and_payout_terms_once_before_paying_when_the_ledger_terms_are_on", async () => {
    world.terms = { enabled: true, event_release_delay_hours: 24, policies: {} };
    await render(withClient(<EventScreen />));
    await fireEvent.press(await screen.findByLabelText("Buy General tickets"));
    expect(await screen.findByText("No refund after purchase")).toBeTruthy();
    expect(screen.getByText("The organiser is paid 24 hours after the event day ends.")).toBeTruthy();
  });

  it("an_event_without_ticket_types_shows_no_ticket_section_and_keeps_contact_support", async () => {
    world.event = event({ has_tickets: false });
    await render(withClient(<EventScreen />));
    await screen.findByText("Kumasi Kente Night");
    expect(screen.queryByText("Tickets")).toBeNull();
    expect(screen.getByLabelText("Contact Support")).toBeTruthy();
  });
});

describe("my tickets", () => {
  it("lists_each_purchase_with_status_and_opens_the_qr", async () => {
    world.mine = [ticket(), ticket({ id: 32, code: "TKT-OLD111", refunded_at: "2026-11-03T10:00:00Z" })];
    await render(withClient(<MyTickets />));
    expect(await screen.findByText("TKT-AB12CD")).toBeTruthy();
    expect(screen.getByText("Refunded")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Show ticket TKT-AB12CD"));
    expect(router.push).toHaveBeenCalledWith("/ticket/31");
  });

  it("explains_an_empty_list_without_inventing_tickets", async () => {
    await render(withClient(<MyTickets />));
    expect(await screen.findByText(/haven.t bought any tickets/i)).toBeTruthy();
  });

  it("offers_try_again_when_it_cannot_load", async () => {
    apiMock.mockImplementation(async () => { throw new ApiError(500, {}); });
    await render(withClient(<MyTickets />));
    expect(await screen.findByLabelText("Try again")).toBeTruthy();
  });

  it("cancels_a_purchase_after_showing_the_refund_the_server_quotes", async () => {
    world.terms = { enabled: true, event_release_delay_hours: 24, policies: {} };
    world.mine = [ticket({ money: { sale: 9, release_at: "2026-11-21T06:00:00Z", released_at: null, accepted_at: null, refunded: null, refunded_whole: false, problem: null, policy: null, start: null, can_cancel: true, cancelled_by_you: false, can_report: true } })];
    await render(withClient(<MyTickets />));
    await fireEvent.press(await screen.findByLabelText("Cancel tickets"));
    expect(await screen.findByText(/GH₵ 50\.00 goes back to your AshantiHub wallet/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Yes, cancel tickets"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/events/tickets/purchases/9/cancel/")).toBe(true));
    expect(await screen.findByText(/Cancelled\. GH₵ 50\.00 went back to your AshantiHub wallet\./)).toBeTruthy();
  });
});

describe("ticket screen", () => {
  it("shows_a_large_qr_the_code_and_the_brightness_note", async () => {
    params.id = "31";
    world.mine = [ticket()];
    await render(withClient(<TicketScreen />));
    expect(await screen.findByLabelText("QR code for ticket TKT-AB12CD")).toBeTruthy();
    expect(screen.getByText("TKT-AB12CD")).toBeTruthy();
    expect(screen.getByText(/turn your screen brightness up/i)).toBeTruthy();
  });

  it("a_refunded_ticket_shows_no_qr", async () => {
    params.id = "31";
    world.mine = [ticket({ refunded_at: "2026-11-03T10:00:00Z" })];
    await render(withClient(<TicketScreen />));
    expect(await screen.findByText(/was refunded and will not be accepted/i)).toBeTruthy();
    expect(screen.queryByLabelText(/QR code for ticket/)).toBeNull();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import type { ReactElement } from "react";

import ScreenWallet from "../src/app/customer/wallet";
import { isWalletOff, walletChoice } from "../src/features/wallet/api";
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

const dest = (over: Record<string, unknown> = {}) => ({
  id: 7, rail: "momo", institution: "MTN", account_number_masked: "024****567", account_name: "Akosua Ntoma", name_check: "hubtel",
  usable_from: "2026-11-01T10:00:00Z", usable: true, removed: false, created_at: "2026-10-31T10:00:00Z", ...over,
});
const withdrawal = (over: Record<string, unknown> = {}) => ({
  id: 3, reference: "WD-3", amount: "100.00", charge: "1.00", you_receive: "99.00", status: "pending", status_label: "Held, not sent yet",
  destination: dest(), created_at: "2026-11-02T10:00:00Z", settled_at: null, failure_reason: "", ...over,
});
const line = (over: Record<string, unknown> = {}) => ({
  id: 1, at: "2026-11-02T10:30:00Z", account: "wallet", kind: "wallet_top_up", label: "Top-up", direction: "in", amount: "20.00",
  order: null, booking_sale: null, reference: "", ...over,
});
const page = (results: unknown[], next: string | null = null) => ({ count: results.length, next, previous: null, results });

type Calls = { path: string; init?: { method?: string; body?: unknown; headers?: Record<string, string>; query?: Record<string, unknown> } }[];
let calls: Calls;
let state: { wallet: unknown; destinations: unknown[]; withdrawals: unknown[]; lines: unknown[] };

function serve() {
  apiMock.mockImplementation(async (path: string, init?: Calls[number]["init"]) => {
    calls.push({ path, init });
    const method = init?.method ?? (init?.body !== undefined ? "POST" : "GET");
    if (path === "/api/wallet/" && method === "GET") {
      if (state.wallet instanceof ApiError) throw state.wallet;
      return state.wallet;
    }
    if (path === "/api/wallet/transactions/") return page(state.lines);
    if (path === "/api/wallet/withdrawals/" && method === "GET") return page(state.withdrawals);
    if (path === "/api/wallet/destinations/" && method === "GET") return { results: state.destinations, cooling_hours: 24 };
    if (path === "/api/wallet/processing/") return { amount: "50.00", payment_processing: "1.00", you_pay: "51.00", provider: "simulated" };
    if (path === "/api/wallet/top-up/") return { mode: "immediate", reference: "T1", amount: "50.00", payment_processing: "1.00", you_pay: "51.00", kind: "customer", balance: "1300.50" };
    if (path === "/api/otp/step-up/send/") return { channel: "sms", hint: "•••• 4567", expires_in: 300, resend_in: 30 };
    if (path === "/api/otp/step-up/verify/") return { step_up_token: "tok-1", action: init?.body && (init.body as { action: string }).action, expires_in: 300 };
    if (path === "/api/wallet/destinations/" && method === "POST") return dest({ id: 9, usable: false });
    if (path === "/api/wallet/withdrawals/" && method === "POST") return withdrawal({ id: 4, status: "processing", status_label: "Sent, waiting for the provider" });
    if (path === "/api/wallet/withdrawals/3/cancel/") return withdrawal({ status: "cancelled", status_label: "Cancelled, money returned" });
    if (path === "/api/wallet/destinations/7/remove/") return undefined;
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
  state = {
    wallet: { kind: "customer", balance: "1250.50", held_topup_pesewas: 0, topup_free_at: null },
    destinations: [dest()],
    withdrawals: [],
    lines: [line(), line({ id: 2, kind: "order_payment", label: "Order payment", direction: "out", amount: "7.50", order: 42 })],
  };
  serve();
});

const posted = (path: string) => calls.filter((c) => c.path === path && (c.init?.method ?? (c.init?.body !== undefined ? "POST" : "GET")) === "POST");

describe("wallet switched off", () => {
  it("shows_a_calm_not_available_state_and_no_money", async () => {
    state.wallet = new ApiError(409, { code: "ledger_off", detail: "Wallets aren't switched on yet." }, "ledger_off");
    await render(client(<ScreenWallet />));
    expect(await screen.findByText("Wallet is not available yet")).toBeTruthy();
    expect(screen.queryByText(/GH₵/)).toBeNull();
    expect(screen.queryByLabelText("Add money")).toBeNull();
    expect(screen.queryByLabelText("Withdraw")).toBeNull();
  });

  it("treats_a_404_the_same_way", () => {
    expect(isWalletOff(new ApiError(404, {}))).toBe(true);
    expect(isWalletOff(new ApiError(409, { code: "ledger_off" }, "ledger_off"))).toBe(true);
    expect(isWalletOff(new ApiError(500, {}))).toBe(false);
    expect(isWalletOff(new ApiError(409, { code: "insufficient_funds" }, "insufficient_funds"))).toBe(false);
  });

  it("a_server_error_offers_retry_not_the_off_message", async () => {
    state.wallet = new ApiError(500, {});
    await render(client(<ScreenWallet />));
    expect(await screen.findByText(/couldn.t load your wallet/i)).toBeTruthy();
    expect(screen.getByLabelText("Try again")).toBeTruthy();
    expect(screen.queryByText("Wallet is not available yet")).toBeNull();
  });
});

describe("wallet on", () => {
  it("shows_balance_and_activity_with_signs", async () => {
    await render(client(<ScreenWallet />));
    expect(await screen.findByText("GH₵ 1,250.50")).toBeTruthy();
    expect(await screen.findByText("Top-up")).toBeTruthy();
    expect(screen.getByText("+GH₵ 20.00")).toBeTruthy();
    expect(screen.getByText("−GH₵ 7.50")).toBeTruthy();
    expect(screen.getByText("Order payment")).toBeTruthy();
  });

  it("explains_money_added_recently_cannot_be_withdrawn_yet", async () => {
    state.wallet = { kind: "customer", balance: "300.00", held_topup_pesewas: 5000, topup_free_at: "2026-11-02T14:00:00Z" };
    await render(client(<ScreenWallet />));
    expect(await screen.findByText(/GH₵ 50\.00 of this was added recently/i)).toBeTruthy();
  });

  it("never_calls_payout_accounts_payment_methods_or_cards", async () => {
    await render(client(<ScreenWallet />));
    await screen.findByText("GH₵ 1,250.50");
    expect(screen.queryByText(/saved card|payment method|default payment/i)).toBeNull();
    expect(screen.getByText(/payout accounts/i)).toBeTruthy();
  });

  it("lists_payout_accounts_masked", async () => {
    await render(client(<ScreenWallet />));
    expect(await screen.findByText(/MTN · 024\*\*\*\*567/)).toBeTruthy();
    expect(screen.getByText(/Akosua Ntoma/)).toBeTruthy();
  });

  it("empty_states_say_so", async () => {
    state.lines = [];
    state.destinations = [];
    await render(client(<ScreenWallet />));
    expect(await screen.findByText("No activity yet")).toBeTruthy();
    expect(screen.getByText(/no payout accounts yet/i)).toBeTruthy();
    expect(screen.getByLabelText("Withdraw").props.accessibilityState?.disabled).toBe(true);
  });
});

describe("top-up", () => {
  it("quotes_the_processing_charge_then_adds_money", async () => {
    await render(client(<ScreenWallet />));
    await screen.findByText("GH₵ 1,250.50");
    await fireEvent.press(screen.getByLabelText("Add money"));
    await fireEvent.changeText(screen.getByLabelText("Amount (GH₵)"), "50");
    expect(await screen.findByText(/You pay GH₵ 51\.00/)).toBeTruthy();
    expect(screen.getByText(/includes GH₵ 1\.00 payment processing/i)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Add to wallet"));
    await waitFor(() => expect(posted("/api/wallet/top-up/")).toHaveLength(1));
    expect(posted("/api/wallet/top-up/")[0].init?.body).toEqual({ amount: "50" });
    expect(await screen.findByText(/GH₵ 50\.00 added to your wallet/i)).toBeTruthy();
  });

  it("refuses_a_bad_amount_without_calling_the_server", async () => {
    await render(client(<ScreenWallet />));
    await screen.findByText("GH₵ 1,250.50");
    await fireEvent.press(screen.getByLabelText("Add money"));
    await fireEvent.changeText(screen.getByLabelText("Amount (GH₵)"), "abc");
    expect(screen.getByLabelText("Add to wallet").props.accessibilityState?.disabled).toBe(true);
    expect(posted("/api/wallet/top-up/")).toHaveLength(0);
  });
});

describe("payout accounts and withdrawals need a code", () => {
  it("adding_a_mobile_money_account_sends_a_code_then_the_token", async () => {
    await render(client(<ScreenWallet />));
    await screen.findByText("GH₵ 1,250.50");
    await fireEvent.press(screen.getByLabelText("Add a payout account"));
    await fireEvent.press(screen.getByLabelText("Telecel"));
    await fireEvent.changeText(screen.getByLabelText("Mobile Money number"), "0241234567");
    await fireEvent.press(screen.getByLabelText("Continue"));
    await waitFor(() => expect(posted("/api/otp/step-up/send/")).toHaveLength(1));
    expect(posted("/api/otp/step-up/send/")[0].init?.body).toEqual({ action: "payout_destination", channel: "sms" });
    expect(posted("/api/wallet/destinations/")).toHaveLength(0);
    await fireEvent.changeText(await screen.findByLabelText("Code we sent you"), "123456");
    await fireEvent.press(screen.getByLabelText("Confirm"));
    await waitFor(() => expect(posted("/api/wallet/destinations/")).toHaveLength(1));
    const add = posted("/api/wallet/destinations/")[0].init;
    expect(add?.body).toEqual({ rail: "momo", institution: "Telecel", account_number: "0241234567" });
    expect(add?.headers).toEqual({ "X-Step-Up-Token": "tok-1" });
    expect(await screen.findByText(/payout account was added/i)).toBeTruthy();
  });

  it("a_name_mismatch_is_shown_and_the_form_can_be_corrected", async () => {
    const base = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (path: string, init?: Calls[number]["init"]) => {
      if (path === "/api/wallet/destinations/" && init?.body !== undefined) {
        throw new ApiError(400, { detail: "The name on that account doesn't match the name we have verified for you.", code: "name_mismatch" }, "name_mismatch");
      }
      return base(path, init);
    });
    await render(client(<ScreenWallet />));
    await screen.findByText("GH₵ 1,250.50");
    await fireEvent.press(screen.getByLabelText("Add a payout account"));
    await fireEvent.changeText(screen.getByLabelText("Mobile Money number"), "0241234567");
    await fireEvent.press(screen.getByLabelText("Continue"));
    await fireEvent.changeText(await screen.findByLabelText("Code we sent you"), "123456");
    await fireEvent.press(screen.getByLabelText("Confirm"));
    expect(await screen.findByText(/doesn't match the name we have verified/i)).toBeTruthy();
    expect(screen.getByLabelText("Back")).toBeTruthy();
  });

  it("withdrawing_asks_for_a_code_and_sends_one_request_id", async () => {
    await render(client(<ScreenWallet />));
    await screen.findByText("GH₵ 1,250.50");
    await fireEvent.press(screen.getByLabelText("Withdraw"));
    await fireEvent.press(screen.getByLabelText("MTN 024****567"));
    await fireEvent.changeText(screen.getByLabelText("Amount to withdraw (GH₵)"), "100");
    await fireEvent.press(screen.getByLabelText("Continue"));
    await waitFor(() => expect(posted("/api/otp/step-up/send/")).toHaveLength(1));
    expect(posted("/api/otp/step-up/send/")[0].init?.body).toEqual({ action: "withdrawal", channel: "sms" });
    await fireEvent.changeText(await screen.findByLabelText("Code we sent you"), "123456");
    await fireEvent.press(screen.getByLabelText("Confirm"));
    await waitFor(() => expect(posted("/api/wallet/withdrawals/")).toHaveLength(1));
    const sent = posted("/api/wallet/withdrawals/")[0].init;
    const body = sent?.body as { destination: number; amount: string; request_id: string };
    expect(body.destination).toBe(7);
    expect(body.amount).toBe("100");
    expect(body.request_id.length).toBeGreaterThanOrEqual(8);
    expect(body.request_id.length).toBeLessThanOrEqual(64);
    expect(sent?.headers).toEqual({ "X-Step-Up-Token": "tok-1" });
    expect(await screen.findByText(/withdrawal was sent/i)).toBeTruthy();
  });

  it("an_account_still_cooling_down_cannot_be_chosen", async () => {
    state.destinations = [dest({ usable: false, usable_from: "2026-11-03T10:00:00Z" })];
    await render(client(<ScreenWallet />));
    await screen.findByText("GH₵ 1,250.50");
    expect(screen.getByLabelText("Withdraw").props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByText(/can receive money from/i)).toBeTruthy();
  });

  it("shows_withdrawals_with_charge_and_what_you_receive_and_cancels_a_held_one", async () => {
    state.withdrawals = [withdrawal(), withdrawal({ id: 5, status: "succeeded", status_label: "Paid", amount: "40.00", charge: "0.40", you_receive: "39.60" })];
    await render(client(<ScreenWallet />));
    expect(await screen.findByText("Held, not sent yet")).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
    expect(screen.getAllByText(/You receive GH₵ 99\.00/).length).toBe(1);
    expect(screen.getAllByLabelText("Cancel withdrawal")).toHaveLength(1);
    await fireEvent.press(screen.getByLabelText("Cancel withdrawal"));
    await waitFor(() => expect(posted("/api/wallet/withdrawals/3/cancel/")).toHaveLength(1));
  });

  it("removing_an_account_needs_a_code_too", async () => {
    await render(client(<ScreenWallet />));
    await fireEvent.press(await screen.findByLabelText("Remove MTN 024****567"));
    await waitFor(() => expect(posted("/api/otp/step-up/send/")).toHaveLength(1));
    expect(posted("/api/otp/step-up/send/")[0].init?.body).toEqual({ action: "payout_destination", channel: "sms" });
    await fireEvent.changeText(await screen.findByLabelText("Code we sent you"), "123456");
    await fireEvent.press(screen.getByLabelText("Confirm"));
    await waitFor(() => expect(posted("/api/wallet/destinations/7/remove/")).toHaveLength(1));
    expect(posted("/api/wallet/destinations/7/remove/")[0].init?.headers).toEqual({ "X-Step-Up-Token": "tok-1" });
  });

  it("falls_back_to_email_when_the_text_cannot_be_sent", async () => {
    const base = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (path: string, init?: Calls[number]["init"]) => {
      if (path === "/api/otp/step-up/send/" && (init?.body as { channel: string }).channel === "sms") {
        calls.push({ path, init });
        throw new ApiError(400, { detail: "No phone." });
      }
      return base(path, init);
    });
    await render(client(<ScreenWallet />));
    await screen.findByText("GH₵ 1,250.50");
    await fireEvent.press(screen.getByLabelText("Add a payout account"));
    await fireEvent.changeText(screen.getByLabelText("Mobile Money number"), "0241234567");
    await fireEvent.press(screen.getByLabelText("Continue"));
    await waitFor(() => expect(posted("/api/otp/step-up/send/").map((c) => (c.init?.body as { channel: string }).channel)).toEqual(["sms", "email"]));
  });
});

describe("pay at checkout choice", () => {
  const ok = (balance: string) => ({ data: { kind: "customer", balance }, isPending: false, isError: false, error: null }) as never;
  it("is_off_while_the_ledger_is_off", () => {
    expect(walletChoice({ data: undefined, isPending: false, isError: true, error: new ApiError(409, { code: "ledger_off" }, "ledger_off") } as never, 50)).toEqual({ enabled: false, note: "Not available yet" });
  });
  it("is_off_when_the_balance_is_too_low", () => {
    const c = walletChoice(ok("20.00"), 50);
    expect(c.enabled).toBe(false);
    expect(c.note).toMatch(/Balance too low/);
  });
  it("is_on_when_the_balance_covers_the_total", () => {
    const c = walletChoice(ok("50.00"), 50);
    expect(c.enabled).toBe(true);
    expect(c.note).toMatch(/GH₵ 50\.00/);
  });
  it("is_off_while_loading_or_after_other_errors", () => {
    expect(walletChoice({ data: undefined, isPending: true, isError: false, error: null } as never, 50).enabled).toBe(false);
    expect(walletChoice({ data: undefined, isPending: false, isError: true, error: new ApiError(500, {}) } as never, 50).note).toMatch(/couldn.t check/i);
  });
  it("is_off_for_a_vendor_wallet_body", () => {
    expect(walletChoice({ data: { kind: "vendor", pending: "1", available: "1" }, isPending: false, isError: false, error: null } as never, 50).enabled).toBe(false);
  });
});

void within;

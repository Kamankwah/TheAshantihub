import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import BusinessHome from "../src/app/business/home";
import ScreenMoney from "../src/app/business/money";
import { buildSpendSeries } from "../src/features/business/spend";
import { SpendChart } from "../src/features/business/SpendChart";
import { rangeFor } from "../src/features/wallet/statement";
import { api, ApiError } from "../src/lib/api";

const mockWrite = jest.fn();
const mockCreate = jest.fn();
jest.mock("expo-file-system", () => ({
  Paths: { cache: "file:///cache/" },
  File: class {
    uri: string;
    constructor(_dir: string, name: string) {
      this.uri = `file:///cache/${name}`;
    }
    create(...a: unknown[]) {
      return mockCreate(...a);
    }
    write(...a: unknown[]) {
      return mockWrite(...a);
    }
  },
}));
const mockShare = jest.fn(async () => {});
const mockAvailable = jest.fn(async () => true);
jest.mock("expo-sharing", () => ({ shareAsync: (...a: unknown[]) => mockShare(...(a as [])), isAvailableAsync: () => mockAvailable() }));
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
const NOW = new Date("2026-11-15T10:00:00Z");

const tx = (amount: string, created_at: string, status = "success") => ({ id: Math.random(), amount, created_at, status, purpose: "Subscription" });

describe("spend series", () => {
  it("is_six_months_ending_this_month_counting_only_successful_payments", () => {
    const series = buildSpendSeries([tx("100.00", "2026-11-02T00:00:00Z"), tx("50.50", "2026-11-09T00:00:00Z"), tx("30.00", "2026-09-01T00:00:00Z"), tx("999.00", "2026-11-03T00:00:00Z", "failed"), tx("5.00", "2025-01-01T00:00:00Z")], NOW);
    expect(series.map((s) => s.month)).toEqual(["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]);
    expect(series.map((s) => s.amount)).toEqual([0, 0, 0, 30, 0, 150.5]);
  });
  it("tolerates_junk_rows", () => {
    expect(buildSpendSeries([{ status: "success", amount: "x", created_at: "2026-11-01" } as never, null as never], NOW).every((s) => s.amount === 0)).toBe(true);
  });
});

describe("spend chart", () => {
  it("is_labelled_your_ashantihub_spend_not_revenue_and_says_what_it_counts", async () => {
    await render(<SpendChart series={buildSpendSeries([tx("100.00", "2026-11-02T00:00:00Z")], NOW)} />);
    expect(screen.getByText("Your AshantiHub spend")).toBeTruthy();
    expect(screen.getByText(/subscriptions and promotions/i)).toBeTruthy();
    expect(screen.getByLabelText(/Your AshantiHub spend, last 6 months: GH₵ 100\.00/)).toBeTruthy();
    expect(screen.queryByText(/revenue|sales|income|profit/i)).toBeNull();
  });
  it("shows_an_honest_empty_state_with_no_payments", async () => {
    await render(<SpendChart series={buildSpendSeries([], NOW)} />);
    expect(screen.getByText(/No payments to AshantiHub in the last 6 months/)).toBeTruthy();
  });
  it("lists_each_month_amount_as_text_too", async () => {
    await render(<SpendChart series={buildSpendSeries([tx("100.00", "2026-11-02T00:00:00Z")], NOW)} />);
    expect(screen.getByText("Nov")).toBeTruthy();
    expect(screen.getByText("GH₵ 100.00")).toBeTruthy();
  });
});

const client = (ui: ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })}>{ui}</QueryClientProvider>;

describe("business home shows the spend", () => {
  it("fetches_the_owners_transactions", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/billing/transactions/mine/") return [tx("100.00", new Date().toISOString())];
      if (path === "/api/accounts/me/") return { id: 2, full_name: "Kwame Mensah", kyc_status: "approved", identity_status: "verified" };
      if (path === "/api/orders/owner/") return { results: [], next: null };
      if (path === "/api/catalogue/stock/") return { results: [] };
      if (path === "/api/accounts/business/hours/") return { has_hours: true, days: [] };
      throw new ApiError(404, {});
    });
    await render(client(<BusinessHome />));
    expect(await screen.findByText("Your AshantiHub spend")).toBeTruthy();
  });
});

describe("statement ranges", () => {
  it("last_30_days_ends_today", () => {
    expect(rangeFor("30", NOW)).toEqual({ date_from: "2026-10-16", date_to: "2026-11-15" });
    expect(rangeFor("90", NOW)).toEqual({ date_from: "2026-08-17", date_to: "2026-11-15" });
    expect(rangeFor("365", NOW)).toEqual({ date_from: "2025-11-15", date_to: "2026-11-15" });
  });
});

describe("statement export", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAvailable.mockResolvedValue(true);
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/wallet/vendor/") return { pending: "0.00", available: "10.00", withdrawable: "10.00", negative: false, awaiting_call: 0, withdrawing: "0.00", fee_cap: { limit: null, used: "0.00", remaining: null } };
      if (path.startsWith("/api/wallet/vendor/")) return { count: 0, next: null, previous: null, results: [] };
      if (path === "/api/wallet/vendor/statement/export/") return "Date,Kind\n2026-11-01,sale\n";
      throw new ApiError(404, {});
    });
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/wallet/vendor/statement/export/") return "Date,Kind\n2026-11-01,sale\n";
      if (path === "/api/wallet/vendor/") return { pending: "0.00", available: "10.00", withdrawable: "10.00", negative: false, awaiting_call: 0, withdrawing: "0.00", fee_cap: { limit: null, used: "0.00", remaining: null } };
      if (path === "/api/wallet/vendor/daily/") return { from: "2026-10-16", to: "2026-11-15", days: [], totals: { orders: 0, sold: "0.00", fees: "0.00", released: "0.00", refunded: "0.00", free_delivery_promo: "0.00", withdrawn: "0.00", other: "0.00", net_change: "0.00" } };
      return { count: 0, next: null, previous: null, results: [] };
    });
  });

  it("downloads_the_csv_writes_it_to_a_file_and_opens_the_share_sheet", async () => {
    await render(client(<ScreenMoney />));
    await fireEvent.press(await screen.findByLabelText("Days"));
    await fireEvent.press(await screen.findByLabelText("Export statement"));
    await waitFor(() => expect(mockShare).toHaveBeenCalled());
    const call = apiMock.mock.calls.find((c) => c[0] === "/api/wallet/vendor/statement/export/")!;
    expect(Object.keys(call[1].query).sort()).toEqual(["date_from", "date_to"]);
    expect(mockWrite).toHaveBeenCalledWith("Date,Kind\n2026-11-01,sale\n");
    const args = mockShare.mock.calls[0] as unknown as [string, { mimeType: string }];
    expect(args[0]).toMatch(/^file:\/\/\/cache\/ashantihub-statement-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(args[1].mimeType).toBe("text/csv");
  });

  it("a_longer_range_can_be_chosen", async () => {
    await render(client(<ScreenMoney />));
    await fireEvent.press(await screen.findByLabelText("Days"));
    await fireEvent.press(await screen.findByLabelText("Last 90 days"));
    await fireEvent.press(screen.getByLabelText("Export statement"));
    await waitFor(() => expect(mockShare).toHaveBeenCalled());
    const call = apiMock.mock.calls.find((c) => c[0] === "/api/wallet/vendor/statement/export/")!;
    const days = (new Date(call[1].query.date_to).getTime() - new Date(call[1].query.date_from).getTime()) / 86400000;
    expect(days).toBe(90);
  });

  it("a_refusal_from_the_server_is_shown", async () => {
    const base = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (path: string, init?: unknown) => {
      if (path === "/api/wallet/vendor/statement/export/") throw new ApiError(400, { detail: "That is too many rows. Choose a shorter range." });
      return base(path, init);
    });
    await render(client(<ScreenMoney />));
    await fireEvent.press(await screen.findByLabelText("Days"));
    await fireEvent.press(await screen.findByLabelText("Export statement"));
    expect(await screen.findByText("That is too many rows. Choose a shorter range.")).toBeTruthy();
    expect(mockShare).not.toHaveBeenCalled();
  });

  it("a_phone_that_cannot_share_says_so", async () => {
    mockAvailable.mockResolvedValue(false);
    await render(client(<ScreenMoney />));
    await fireEvent.press(await screen.findByLabelText("Days"));
    await fireEvent.press(await screen.findByLabelText("Export statement"));
    expect(await screen.findByText(/can.t share files/i)).toBeTruthy();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import Delivery from "../src/app/manage/promo-delivery";
import Discounts from "../src/app/manage/promo-discounts";
import Flash from "../src/app/manage/promo-flash";
import Hub from "../src/app/manage/promotions";
import Sponsored from "../src/app/manage/promo-sponsored";
import { buildDeliveryPromoBody, canSendDeliveryPromo, promoStatus } from "../src/features/business/promotions";
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
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;
const { router } = jest.requireMock("expo-router");

const promo = (over: Record<string, unknown> = {}) => ({
  id: 4, name: "Free delivery weekend", starts_at: "2026-11-07T08:00:00Z", ends_at: "2026-11-09T20:00:00Z", all_items: true, listings: [], status: "active",
  effective_status: "active", live: false, rejection_reason: "", covered_orders: 2, covered_total: "24.00", funded_by: "business", ...over,
});
const listing = (id: number, name: string, status = "published") => ({ id, name, status, price_amount: "100.00", stock_quantity: 5, photos: [] });

type Calls = { path: string; init?: { method?: string; body?: unknown } }[];
let calls: Calls;
let world: { promos: unknown[]; listings: unknown[]; pricing: unknown; discounts: unknown[]; promote: unknown; flash: unknown[] };
function serve() {
  apiMock.mockImplementation(async (path: string, init?: Calls[number]["init"]) => {
    calls.push({ path, init });
    const post = init?.body !== undefined || init?.method === "POST";
    if (path === "/api/marketing/owner/delivery-promos/" && !post) return { results: world.promos };
    if (path === "/api/marketing/owner/delivery-promos/" && post) return promo({ id: 9, status: "pending", effective_status: "pending" });
    if (/^\/api\/marketing\/owner\/delivery-promos\/\d+\/(pause|resume|end)\/$/.test(path)) return promo();
    if (path === "/api/listings/mine/") return world.listings;
    if (path === "/api/listings/promotions/pricing/") return world.pricing;
    if (path === "/api/listings/mine/1/discounts/" && !post) return world.discounts;
    if (path === "/api/listings/mine/1/discounts/" && post) return world.discounts;
    if (path === "/api/listings/mine/1/discounts/end/") return [];
    if (path === "/api/listings/1/promote/" && post) {
      if (world.promote instanceof ApiError) throw world.promote;
      return world.promote;
    }
    if (path === "/api/marketing/owner/flash-sales/") return { results: world.flash };
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
  world = { promos: [promo()], listings: [listing(1, "Kente stole"), listing(2, "Draft thing", "draft")], pricing: { enabled: false }, discounts: [], promote: { id: 1, free: true }, flash: [] };
  serve();
});

describe("promotion logic", () => {
  it("status_words", () => {
    expect(promoStatus({ effective_status: "pending", live: false }).label).toBe("Waiting for review");
    expect(promoStatus({ effective_status: "active", live: true }).label).toBe("Approved · running now");
    expect(promoStatus({ effective_status: "paused", live: false }).label).toBe("Paused");
    expect(promoStatus({ effective_status: "rejected", live: false }).tone).toBe("error");
  });
  it("needs_a_name_valid_times_in_order_and_items", () => {
    const base = { name: "Weekend", startDate: "2026-11-07", startTime: "08:00", endDate: "2026-11-09", endTime: "20:00", allItems: true, picked: [] as number[] };
    expect(canSendDeliveryPromo(base)).toBe(true);
    expect(canSendDeliveryPromo({ ...base, name: " " })).toBe(false);
    expect(canSendDeliveryPromo({ ...base, endDate: "2026-11-06" })).toBe(false);
    expect(canSendDeliveryPromo({ ...base, startTime: "8am" })).toBe(false);
    expect(canSendDeliveryPromo({ ...base, allItems: false })).toBe(false);
    expect(canSendDeliveryPromo({ ...base, allItems: false, picked: [3] })).toBe(true);
  });
  it("builds_the_body_in_accra_time", () => {
    expect(buildDeliveryPromoBody({ name: " Weekend ", startDate: "2026-11-07", startTime: "08:00", endDate: "2026-11-09", endTime: "20:00", allItems: false, picked: [3, 4] })).toEqual({
      name: "Weekend", starts_at: "2026-11-07T08:00:00Z", ends_at: "2026-11-09T20:00:00Z", all_items: false, listing_ids: [3, 4],
    });
  });
});

describe("promotions hub", () => {
  it("links_to_each_tool", async () => {
    await render(withClient(<Hub />));
    await fireEvent.press(screen.getByLabelText("Free delivery"));
    expect(router.push).toHaveBeenCalledWith("/manage/promo-delivery");
    await fireEvent.press(screen.getByLabelText("Discounts"));
    expect(router.push).toHaveBeenCalledWith("/manage/promo-discounts");
    await fireEvent.press(screen.getByLabelText("Sponsored ad"));
    expect(router.push).toHaveBeenCalledWith("/manage/promo-sponsored");
    await fireEvent.press(screen.getByLabelText("Flash-sale invitations"));
    expect(router.push).toHaveBeenCalledWith("/manage/promo-flash");
  });
});

describe("free-delivery promos", () => {
  it("lists_promos_with_what_they_covered", async () => {
    await render(withClient(<Delivery />));
    expect(await screen.findByText("Free delivery weekend")).toBeTruthy();
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.getByText(/GH₵ 24\.00 on 2 orders/)).toBeTruthy();
  });
  it("pauses_after_one_tap", async () => {
    await render(withClient(<Delivery />));
    await fireEvent.press(await screen.findByLabelText("Pause Free delivery weekend"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/marketing/owner/delivery-promos/4/pause/")).toBe(true));
  });
  it("ending_asks_first_and_says_customers_pay_delivery_again", async () => {
    await render(withClient(<Delivery />));
    await fireEvent.press(await screen.findByLabelText("End Free delivery weekend"));
    expect(await screen.findByText(/Customers will pay delivery again straight away/)).toBeTruthy();
    expect(calls.some((c) => c.path.endsWith("/end/"))).toBe(false);
    await fireEvent.press(screen.getByLabelText("Yes, end it"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/marketing/owner/delivery-promos/4/end/")).toBe(true));
  });
  it("a_waiting_promo_can_be_withdrawn_and_a_paused_one_resumed", async () => {
    world.promos = [promo({ id: 5, name: "A", status: "pending", effective_status: "pending" }), promo({ id: 6, name: "B", status: "paused", effective_status: "paused" })];
    await render(withClient(<Delivery />));
    expect(await screen.findByLabelText("Withdraw A")).toBeTruthy();
    expect(screen.getByLabelText("Resume B")).toBeTruthy();
  });
  it("a_rejected_promo_shows_the_reason_and_no_controls", async () => {
    world.promos = [promo({ status: "rejected", effective_status: "rejected", rejection_reason: "Dates overlap a sale." })];
    await render(withClient(<Delivery />));
    expect(await screen.findByText(/Dates overlap a sale\./)).toBeTruthy();
    expect(screen.queryByLabelText(/^End /)).toBeNull();
  });
  it("sends_a_new_promo_for_review", async () => {
    await render(withClient(<Delivery />));
    await fireEvent.press(await screen.findByLabelText("New promo"));
    await fireEvent.changeText(await screen.findByLabelText("Promo name"), "Weekend");
    await waitFor(() => expect(screen.getByLabelText("Send for review").props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByLabelText("Send for review"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/marketing/owner/delivery-promos/" && c.init?.body)).toBe(true));
    const body = calls.find((c) => c.path === "/api/marketing/owner/delivery-promos/" && c.init?.body)!.init!.body as Record<string, unknown>;
    expect(body).toMatchObject({ name: "Weekend", all_items: true, listing_ids: [] });
    expect(String(body.starts_at)).toMatch(/Z$/);
  });
  it("says_you_cover_the_fee", async () => {
    await render(withClient(<Delivery />));
    await fireEvent.press(await screen.findByLabelText("New promo"));
    expect(await screen.findByText(/You cover the delivery fee/)).toBeTruthy();
  });
});

describe("discounts", () => {
  it("starts_a_percent_discount_on_a_published_listing_only", async () => {
    await render(withClient(<Discounts />));
    await fireEvent.press(await screen.findByLabelText("Listing"));
    expect(screen.queryByLabelText("Draft thing")).toBeNull();
    await fireEvent.press(await screen.findByLabelText("Kente stole"));
    await fireEvent.changeText(await screen.findByLabelText("Percent off"), "15");
    await fireEvent.press(screen.getByLabelText("Start discount"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/listings/mine/1/discounts/" && c.init?.body)).toBe(true));
    expect(calls.find((c) => c.path === "/api/listings/mine/1/discounts/" && c.init?.body)!.init!.body).toEqual({ percent_off: 15 });
  });
  it("shows_the_running_discount_and_ends_it", async () => {
    world.discounts = [{ target: "listing", variant: null, label: null, regular_price: "100.00", sale_price: "85.00", percent_off: 15, ends_at: null }];
    await render(withClient(<Discounts />));
    await fireEvent.press(await screen.findByLabelText("Listing"));
    await fireEvent.press(await screen.findByLabelText("Kente stole"));
    expect(await screen.findByText(/GH₵ 85\.00 instead of GH₵ 100\.00/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("End discount"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/listings/mine/1/discounts/end/")).toBe(true));
  });
  it("the_servers_refusal_is_shown", async () => {
    apiMock.mockImplementation(async (path: string, init?: Calls[number]["init"]) => {
      if (path === "/api/listings/mine/") return world.listings;
      if (path === "/api/listings/mine/1/discounts/" && init?.body === undefined) return [];
      if (path === "/api/listings/mine/1/discounts/") throw new ApiError(409, { detail: "A discount is already running." });
      throw new ApiError(404, {});
    });
    await render(withClient(<Discounts />));
    await fireEvent.press(await screen.findByLabelText("Listing"));
    await fireEvent.press(await screen.findByLabelText("Kente stole"));
    await fireEvent.changeText(await screen.findByLabelText("Percent off"), "10");
    await fireEvent.press(screen.getByLabelText("Start discount"));
    expect(await screen.findByText("A discount is already running.")).toBeTruthy();
  });
});

describe("sponsored ad", () => {
  async function choose() {
    await fireEvent.press(await screen.findByLabelText("Listing"));
    await fireEvent.press(await screen.findByLabelText("Kente stole"));
  }
  it("while_free_a_featured_request_goes_to_review", async () => {
    await render(withClient(<Sponsored />));
    expect(await screen.findByText(/Free for now/)).toBeTruthy();
    await choose();
    await fireEvent.press(screen.getByLabelText("Request this ad"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/listings/1/promote/")).toBe(true));
    expect(calls.find((c) => c.path === "/api/listings/1/promote/")!.init!.body).toEqual({ kind: "featured", days: 7 });
    expect(await screen.findByText(/Sent for review/)).toBeTruthy();
  });
  it("a_boost_needs_keywords", async () => {
    await render(withClient(<Sponsored />));
    await choose();
    await fireEvent.press(screen.getByLabelText("Type: Boost"));
    expect(screen.getByLabelText("Request this ad").props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText("Keywords"), "kente, wedding");
    await fireEvent.press(screen.getByLabelText("Request this ad"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/listings/1/promote/")).toBe(true));
    expect(calls.find((c) => c.path === "/api/listings/1/promote/")!.init!.body).toEqual({ kind: "boost", days: 7, keywords: "kente, wedding" });
  });
  it("once_ads_are_charged_the_app_sends_you_to_the_website_instead_of_guessing_a_price", async () => {
    world.pricing = { enabled: true };
    await render(withClient(<Sponsored />));
    expect(await screen.findByText(/no longer free/i)).toBeTruthy();
    expect(screen.queryByLabelText("Request this ad")).toBeNull();
  });
  it("stopping_an_ad_early_goes_through_support_and_is_not_a_refund", async () => {
    await render(withClient(<Sponsored />));
    expect(await screen.findByText(/stopping an ad early is not a refund/i)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Contact Support"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/support/new", params: { about: "My sponsored ad" } });
  });
  it("the_servers_refusal_is_shown", async () => {
    world.promote = new ApiError(400, { detail: "This listing already has a pending or active featured promotion." });
    await render(withClient(<Sponsored />));
    await choose();
    await fireEvent.press(screen.getByLabelText("Request this ad"));
    expect(await screen.findByText(/already has a pending or active featured promotion/)).toBeTruthy();
  });
});

describe("flash-sale invitations", () => {
  it("lists_invitations_read_only", async () => {
    world.flash = [{ sale_id: 1, name: "Black Friday", starts_at: "2026-11-27T06:00:00Z", ends_at: "2026-11-28T06:00:00Z", discount_pct: 20, answer: "asked", listings: [{ id: 1, name: "Kente stole", normal_price: "100.00", sale_price: "80.00" }] }];
    await render(withClient(<Flash />));
    expect(await screen.findByText("Black Friday")).toBeTruthy();
    expect(screen.getByText(/Waiting for your answer/)).toBeTruthy();
    expect(screen.getByText(/GH₵ 80\.00 instead of GH₵ 100\.00/)).toBeTruthy();
    expect(screen.getByText(/answer on the AshantiHub website/i)).toBeTruthy();
  });
  it("an_empty_list_says_so", async () => {
    await render(withClient(<Flash />));
    expect(await screen.findByText(/No flash-sale invitations yet/)).toBeTruthy();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import EventDetail from "../src/app/manage/event/[id]";
import Events from "../src/app/manage/events";
import NewEvent from "../src/app/manage/new-event";
import { api, ApiError } from "../src/lib/api";

const params: { id: string } = { id: "8" };
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
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: "file:///e.jpg", fileName: "e.jpg", mimeType: "image/jpeg" }] })),
}));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;
const { router } = jest.requireMock("expo-router");

const node = (id: number, label: string, kind: string) => ({ id, slug: label.toLowerCase(), label, icon: "", color: "", kind, is_accommodation: false, children: [] });
const tree = [node(1, "Fashion", "product"), node(4, "Concerts", "event")];
const ev = (over: Record<string, unknown> = {}) => ({
  id: 8, name: "Kente Night", description: "An evening.", address: "Manhyia", event_date: "2026-11-20T18:30:00Z", visibility_days: 30, status: "pending", rejection_reason: "",
  access_level: "public", access_code: "ABC123", paid_at: null, expires_at: null, going_count: 0, refund_until_days_before: null, cancelled_at: null, cancel_reason: "", ...over,
});
const tt = (over: Record<string, unknown> = {}) => ({ id: 3, name: "General", description: "Standing", price: "50.00", delivery_method: "digital", quantity_total: 100, quantity_sold: 4, quantity_remaining: 96, is_active: true, ...over });

type Calls = { path: string; init?: { method?: string; body?: unknown } }[];
let calls: Calls;
let world: { events: unknown[]; types: unknown[]; submit: unknown; pay: unknown };
function serve() {
  apiMock.mockImplementation(async (path: string, init?: Calls[number]["init"]) => {
    calls.push({ path, init });
    const post = init?.body !== undefined;
    if (path === "/api/listings/categories/tree/") return tree;
    if (path === "/api/listings/zones/") return [{ id: 5, name: "Kumasi Central" }];
    if (path === "/api/accounts/business-owners/me/profile/") return { business_kind: null };
    if (path === "/api/events/pricing-tiers/") return [{ id: 1, duration_days: 7, live_price: "20.00" }, { id: 2, duration_days: 30, live_price: "60.00" }];
    if (path === "/api/events/mine/") return world.events;
    if (path === "/api/events/submit/" && post) {
      if (world.submit instanceof ApiError) throw world.submit;
      return world.submit;
    }
    if (path === "/api/events/8/media/" && post) return { id: 1 };
    if (path === "/api/events/8/ticket-types/mine/") return world.types;
    if (path === "/api/events/8/ticket-types/" && post) return tt({ id: 9 });
    if (path === "/api/events/8/pay/" && post) return world.pay;
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
  params.id = "8";
  world = { events: [ev()], types: [], submit: ev(), pay: ev({ status: "approved", paid_at: "2026-11-02T10:00:00Z" }) };
  serve();
});
async function pick(label: string, option: string) {
  await fireEvent.press(await screen.findByLabelText(label));
  await fireEvent.press(await screen.findByLabelText(option));
}

describe("your events", () => {
  it("lists_events_with_the_status_in_words_and_opens_one", async () => {
    world.events = [ev(), ev({ id: 9, name: "Old Fair", status: "rejected", rejection_reason: "Address unclear" })];
    await render(withClient(<Events />));
    expect(await screen.findByText("Kente Night")).toBeTruthy();
    expect(screen.getByText("Waiting for review")).toBeTruthy();
    expect(screen.getByText("Needs changes")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Kente Night, Waiting for review"));
    expect(router.push).toHaveBeenCalledWith("/manage/event/8");
  });
  it("an_empty_list_offers_the_first_event", async () => {
    world.events = [];
    await render(withClient(<Events />));
    expect(await screen.findByText(/no events yet/i)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("New event"));
    expect(router.push).toHaveBeenCalledWith("/manage/new-event");
  });
});

describe("new event", () => {
  async function fill() {
    await pick("Category", "Concerts");
    await pick("Area", "Kumasi Central");
    await fireEvent.changeText(screen.getByLabelText("Name"), "Kente Night");
    await fireEvent.changeText(screen.getByLabelText("Description"), "An evening.");
    await fireEvent.changeText(screen.getByLabelText("Address"), "Manhyia Palace");
    await pick("How long it is shown", "30 days, GH₵ 60.00");
  }
  it("offers_only_event_categories", async () => {
    await render(withClient(<NewEvent />));
    await fireEvent.press(await screen.findByLabelText("Category"));
    expect(await screen.findByLabelText("Concerts")).toBeTruthy();
    expect(screen.queryByLabelText("Fashion")).toBeNull();
  });
  it("submits_for_review_with_a_photo_and_opens_the_event", async () => {
    await render(withClient(<NewEvent />));
    await fill();
    await fireEvent.press(screen.getByLabelText("Add a photo"));
    await screen.findByText("1 photo chosen");
    await waitFor(() => expect(screen.getByLabelText("Send for review").props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByLabelText("Send for review"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/manage/event/8"));
    const body = calls.find((c) => c.path === "/api/events/submit/" && c.init?.body)!.init!.body as Record<string, unknown>;
    expect(body).toMatchObject({ category: 4, zone: 5, name: "Kente Night", address: "Manhyia Palace", visibility_days: 30, access_level: "public" });
    expect(String(body.event_date)).toMatch(/T18:00:00Z$/);
    expect(calls.some((c) => c.path === "/api/events/8/media/")).toBe(true);
  });
  it("shows_the_servers_refusal_like_the_three_event_limit", async () => {
    world.submit = new ApiError(400, { detail: "You already have 3 events live or waiting. Contact Support to feature more." });
    await render(withClient(<NewEvent />));
    await fill();
    await waitFor(() => expect(screen.getByLabelText("Send for review").props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByLabelText("Send for review"));
    expect(await screen.findByText(/already have 3 events/)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });
  it("a_bad_time_keeps_send_off", async () => {
    await render(withClient(<NewEvent />));
    await fill();
    await fireEvent.changeText(screen.getByLabelText("Start time (24-hour, like 18:00)"), "6pm");
    expect(screen.getByLabelText("Send for review").props.accessibilityState.disabled).toBe(true);
  });
});

describe("one event", () => {
  it("a_waiting_event_says_it_is_being_checked_and_has_no_pay_button", async () => {
    await render(withClient(<EventDetail />));
    expect(await screen.findByText("Waiting for review")).toBeTruthy();
    expect(screen.queryByLabelText(/^Pay /)).toBeNull();
  });
  it("a_rejected_event_shows_what_to_fix", async () => {
    world.events = [ev({ status: "rejected", rejection_reason: "The address is unclear." })];
    await render(withClient(<EventDetail />));
    expect(await screen.findByText("The address is unclear.")).toBeTruthy();
  });
  it("an_approved_unpaid_event_is_paid_for_its_visibility_window_at_the_tier_price", async () => {
    world.events = [ev({ status: "approved" })];
    await render(withClient(<EventDetail />));
    expect(await screen.findByText(/GH₵ 60\.00 to show it for 30 days/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Pay GH₵ 60.00"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/events/8/pay/")).toBe(true));
  });
  it("adds_a_ticket_type_with_price_and_quantity", async () => {
    world.events = [ev({ status: "approved", paid_at: "2026-11-02T10:00:00Z" })];
    world.types = [tt()];
    await render(withClient(<EventDetail />));
    expect(await screen.findByText("General")).toBeTruthy();
    expect(screen.getByText(/96 left/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Add a ticket type"));
    await fireEvent.changeText(await screen.findByLabelText("Ticket name"), "VIP");
    await fireEvent.changeText(screen.getByLabelText("Price in GH₵"), "200");
    await fireEvent.changeText(screen.getByLabelText("How many (leave empty for no limit)"), "20");
    await fireEvent.press(screen.getByLabelText("Save ticket type"));
    await waitFor(() => expect(calls.some((c) => c.path === "/api/events/8/ticket-types/" && c.init?.body)).toBe(true));
    expect(calls.find((c) => c.path === "/api/events/8/ticket-types/" && c.init?.body)!.init!.body).toEqual({ name: "VIP", description: "", price: "200", delivery_method: "digital", quantity_total: 20, is_active: true });
  });
  it("a_pending_event_cannot_get_ticket_types_yet", async () => {
    await render(withClient(<EventDetail />));
    await screen.findByText("Waiting for review");
    expect(screen.queryByLabelText("Add a ticket type")).toBeNull();
    expect(screen.getByText(/Ticket types can be added once your event is live/)).toBeTruthy();
  });
});

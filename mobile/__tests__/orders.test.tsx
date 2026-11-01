import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import OrdersScreen from "../src/app/customer/orders";
import OrderDetail from "../src/app/order/[id]/index";
import ProblemScreen from "../src/app/order/[id]/problem";
import ReviewScreen from "../src/app/review/[id]";
import { orderStatus } from "../src/features/orders/status";
import { api, ApiError } from "../src/lib/api";
import { useAuth } from "../src/state/auth";

let mockParams: Record<string, string> = { id: "501" };
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
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

const order = (over: Record<string, unknown> = {}) => ({
  id: 501, status: "paid", delivery_status: "processing", total_amount: "915.00", placed_at: "2026-11-06T09:30:00Z",
  delivery_method: "door_to_door", delivery_address: "12 Adum Road", delivery_gps_address: "AK-039-5028",
  delivery_landmark: "Blue kiosk", delivery_phone: "0241234567", delivery_fee: "15.00",
  delivery_assignment_status: null, delivery_code: null, collection_code: null, collect_by: null, delivery_stops: null,
  items: [{ id: 1, listing: 7, listing_name: "Hand-woven kente stole", variant_label: "", quantity: 2, unit_price: "450.00", line_total: "900.00" }],
  ...over,
});

function client(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: "501" };
  useAuth.setState({ status: "signedIn", account: { type: "customer", id: 1, fullName: "Ama" } });
});

describe("order status", () => {
  it("status_pill_has_text_and_icon", async () => {
    apiMock.mockResolvedValue([order()]);
    await render(client(<OrdersScreen />));
    expect(await screen.findByText("Being prepared")).toBeTruthy();
    expect(screen.getByTestId("icon-clock", { includeHiddenElements: true })).toBeTruthy();
  });

  it("every_state_has_words_and_an_icon", () => {
    const cases = [
      order({ status: "pending" }),
      order({ status: "cancelled" }),
      order({ delivery_status: "shipped" }),
      order({ delivery_status: "out_for_delivery" }),
      order({ delivery_status: "delivered" }),
      order({ delivery_assignment_status: "confirmed" }),
      order({ delivery_method: "store_pickup" }),
    ];
    for (const o of cases) {
      const s = orderStatus(o as never);
      expect(s.label.length).toBeGreaterThan(3);
      expect(s.icon).toBeTruthy();
    }
  });

  it("orders_list_shows_total_and_no_delivery_date", async () => {
    apiMock.mockResolvedValue([order()]);
    await render(client(<OrdersScreen />));
    expect(await screen.findByText("Order #501")).toBeTruthy();
    expect(screen.getByText("GH₵ 915.00")).toBeTruthy();
    expect(screen.queryByText(/arrives|delivered by|estimated/i)).toBeNull();
  });

  it("empty_orders_say_so", async () => {
    apiMock.mockResolvedValue([]);
    await render(client(<OrdersScreen />));
    expect(await screen.findByText(/no orders yet/i)).toBeTruthy();
  });

  it("error_state_offers_retry", async () => {
    apiMock.mockRejectedValue(new ApiError(500, {}));
    await render(client(<OrdersScreen />));
    expect(await screen.findByLabelText("Try again")).toBeTruthy();
  });
});

describe("order detail and tracking", () => {
  function mockDetail(o: object, tracking: object = { stage: "not_assigned" }) {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/orders/501/") return o;
      if (path === "/api/orders/501/tracking/") return tracking;
      if (path === "/api/orders/501/confirm-receipt/") return {};
      throw new ApiError(404, {});
    });
  }

  it("tracking_never_renders_a_phone_number", async () => {
    mockDetail(
      order({ delivery_status: "out_for_delivery", delivery_assignment_status: "picked_up", delivery_code: "4821" }),
      { stage: "picked_up", rider: { first_name: "Kojo", vehicle_type: "motorbike", phone: "+233201112222", lat: 6.7, lng: -1.6 }, stops: { total: 2, done: 2, skipped: 0 } },
    );
    await render(client(<OrderDetail />));
    expect(await screen.findByText(/Kojo/)).toBeTruthy();
    expect(screen.getByText(/motorbike/i)).toBeTruthy();
    expect(screen.queryByText(/\+?233\s?20|0201112222|0241234567|tel:/)).toBeNull();
    expect(screen.queryByText(/whatsapp|call your rider|call the seller/i)).toBeNull();
  });

  it("delivery_code_is_shown_in_the_code_font", async () => {
    mockDetail(order({ delivery_assignment_status: "picked_up", delivery_code: "4821" }));
    await render(client(<OrderDetail />));
    const code = await screen.findByText("4821");
    expect(JSON.stringify(code.props.style)).toContain("JetBrainsMono");
  });

  it("pickup_order_shows_the_collection_code", async () => {
    mockDetail(order({ delivery_method: "store_pickup", collection_code: "384920", collect_by: "2026-11-09T17:00:00Z" }));
    await render(client(<OrderDetail />));
    expect(await screen.findByText("384920")).toBeTruthy();
  });

  it("confirm_receipt_posts_when_the_rider_marked_it_delivered", async () => {
    mockDetail(order({ delivery_status: "delivered", delivery_assignment_status: "delivered" }));
    await render(client(<OrderDetail />));
    await fireEvent.press(await screen.findByLabelText("Confirm I received this order"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/orders/501/confirm-receipt/", expect.objectContaining({ method: "POST" })));
  });

  it("report_a_problem_and_review_links_exist", async () => {
    mockDetail(order());
    await render(client(<OrderDetail />));
    await fireEvent.press(await screen.findByLabelText("Report a problem"));
    expect(router.push).toHaveBeenCalledWith("/order/501/problem");
    await fireEvent.press(screen.getByLabelText("Review Hand-woven kente stole"));
    expect(router.push).toHaveBeenCalledWith({ pathname: "/review/[id]", params: { id: "7", name: "Hand-woven kente stole" } });
  });
});

describe("report a problem", () => {
  it("problem_form_submits_reason_and_details", async () => {
    apiMock.mockResolvedValue({ id: 3 });
    await render(client(<ProblemScreen />));
    expect(screen.getByLabelText("Send report").props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText("Delivery issue"));
    await fireEvent.changeText(screen.getByLabelText("What went wrong?"), "The rider never came.");
    await fireEvent.press(screen.getByLabelText("Send report"));
    await waitFor(() => expect(screen.getByText(/Report sent/i)).toBeTruthy());
    expect(apiMock).toHaveBeenCalledWith("/api/orders/501/dispute/", { body: { reason: "delivery_issue", description: "The rider never came." } });
  });

  it("problem_form_failure_keeps_the_text", async () => {
    apiMock.mockRejectedValue(new ApiError(500, {}));
    await render(client(<ProblemScreen />));
    await fireEvent.changeText(screen.getByLabelText("What went wrong?"), "Wrong item");
    await fireEvent.press(screen.getByLabelText("Send report"));
    expect(await screen.findByText(/couldn.t send/i)).toBeTruthy();
    expect(screen.getByLabelText("What went wrong?").props.value).toBe("Wrong item");
  });
});

describe("review", () => {
  beforeEach(() => {
    mockParams = { id: "7", name: "Hand-woven kente stole" };
  });

  it("review_requires_rating", async () => {
    await render(client(<ReviewScreen />));
    await fireEvent.changeText(screen.getByLabelText("Your review"), "Lovely cloth");
    expect(screen.getByLabelText("Submit review").props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText("4 stars"));
    expect(screen.getByLabelText("Submit review").props.accessibilityState.disabled).toBe(false);
  });

  it("review_posts_listing_rating_and_comment", async () => {
    apiMock.mockResolvedValue({ id: 1 });
    await render(client(<ReviewScreen />));
    await fireEvent.press(screen.getByLabelText("5 stars"));
    await fireEvent.changeText(screen.getByLabelText("Your review"), "Lovely cloth");
    await fireEvent.press(screen.getByLabelText("Submit review"));
    await waitFor(() => expect(screen.getByText(/Thank you/i)).toBeTruthy());
    expect(apiMock).toHaveBeenCalledWith("/api/reviews/", { body: { target_type: "listing", target_id: 7, rating: 5, comment: "Lovely cloth" } });
  });

  it("review_refusal_shows_the_servers_words", async () => {
    apiMock.mockRejectedValue(new ApiError(403, { detail: "You can only review items you bought." }));
    await render(client(<ReviewScreen />));
    await fireEvent.press(screen.getByLabelText("3 stars"));
    await fireEvent.changeText(screen.getByLabelText("Your review"), "ok");
    await fireEvent.press(screen.getByLabelText("Submit review"));
    expect(await screen.findByText(/only review items you bought/i)).toBeTruthy();
  });
});

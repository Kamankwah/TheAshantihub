import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import BookingScreen from "../src/app/booking/[id]";
import EventScreen from "../src/app/event/[id]";
import SellerScreen from "../src/app/seller/[id]";
import { api, ApiError } from "../src/lib/api";
import { useAuth } from "../src/state/auth";

let mockParams: Record<string, string> = { id: "2" };
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
jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native");
  const React = require("react");
  const Picker = () => React.createElement(View, { testID: "date-picker" });
  Picker.displayName = "DateTimePicker";
  return { __esModule: true, default: Picker, DateTimePickerAndroid: { open: jest.fn() } };
});
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;

const card = (id: number, name: string, category: object) => ({
  id, name, price_amount: "100.00", effective_price: "100.00", main_photo: null, review_count: 0,
  business_owner: { id: 2, name: "Akosua Ntoma Store" }, category,
});

function client(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: "2" };
  useAuth.setState({ status: "signedIn", account: { type: "customer", id: 1, fullName: "Ama" } });
});

describe("seller page", () => {
  function mockSeller(counts: object) {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/listings/sellers/2/") return { id: 2, name: "Akosua Ntoma Store", since: "2026-01-15T00:00:00Z", counts };
      if (path === "/api/listings/") return { results: [card(1, "Kente stole", { kind: "product" }), card(2, "Tailoring", { kind: "service" })], next: null };
      if (path === "/api/events/") return { results: [{ id: 9, name: "Kente Fair", event_date: "2026-12-01T10:00:00Z" }], next: null };
      throw new ApiError(404, {});
    });
  }

  it("seller_page_has_no_phone_or_whatsapp_links", async () => {
    mockSeller({ products: 1, services: 1 });
    await render(client(<SellerScreen />));
    expect(await screen.findByRole("header", { name: "Akosua Ntoma Store" })).toBeTruthy();
    expect(screen.getByText("Contact Support")).toBeTruthy();
    expect(screen.queryByText(/whatsapp|call |phone|tel:/i)).toBeNull();
    expect(screen.getByText(/On AshantiHub since January 2026/)).toBeTruthy();
  });

  it("tabs_only_for_kinds_that_have_something_live", async () => {
    mockSeller({ products: 1, services: 1, stays: 0, events: 0 });
    await render(client(<SellerScreen />));
    expect(await screen.findByText("Products (1)")).toBeTruthy();
    expect(screen.getByText("Services (1)")).toBeTruthy();
    expect(screen.queryByText(/Stays/)).toBeNull();
    expect(screen.queryByText(/Reviews/)).toBeNull();
    expect(await screen.findByText("Kente stole")).toBeTruthy();
    expect(screen.queryByText("Tailoring")).toBeNull();
  });

  it("unavailable_seller_offers_retry", async () => {
    apiMock.mockRejectedValue(new ApiError(404, {}));
    await render(client(<SellerScreen />));
    expect(await screen.findByText(/isn.t available/i)).toBeTruthy();
    expect(screen.getByLabelText("Try again")).toBeTruthy();
  });
});

describe("event page", () => {
  it("shows_the_event_and_support_only", async () => {
    mockParams = { id: "9" };
    apiMock.mockResolvedValue({ id: 9, name: "Kente Fair", description: "A day of weaving.", event_date: "2026-12-01T10:00:00Z", address: "Manhyia Palace Museum", going_count: 12 });
    await render(client(<EventScreen />));
    expect(await screen.findByText("Kente Fair")).toBeTruthy();
    expect(screen.getByText("Manhyia Palace Museum")).toBeTruthy();
    expect(screen.getByText("Contact Support")).toBeTruthy();
    expect(screen.queryByText(/whatsapp/i)).toBeNull();
  });
});

describe("booking page", () => {
  const stay = { ...card(5, "Kumasi Guesthouse", { kind: "service", is_accommodation: true }), price_amount: "300.00", cancellation_policy: "moderate", description: "Quiet rooms." };
  const service = { ...card(6, "Tailoring", { kind: "service" }), cancellation_policy: "flexible" };

  function mockBooking(listing: object, opening: object = { gate_enabled: false, is_open: true }) {
    apiMock.mockImplementation(async (path: string, init?: { body?: unknown }) => {
      if (path === "/api/listings/5/" || path === "/api/listings/6/") return listing;
      if (path === "/api/storefront/opening/") return { server_now: new Date().toISOString(), ...opening };
      if (path === "/api/ledger/booking-terms/")
        return { enabled: true, policies: { moderate: { label: "Moderate", text: "Full refund up to 5 days before check-in.", tiers: [] }, flexible: { label: "Flexible", text: "Free cancellation until the job is done.", tiers: [] } } };
      if (path === "/api/bookings/availability/") return { available: true, units_free: 2, nights: 1, nightly_rate: "300.00", units: 1, total_price: "300.00" };
      if (path === "/api/bookings/") return { id: 77, total_price: "300.00" };
      if (path === "/api/services/requests/") return { id: 3 };
      throw new ApiError(404, {});
    });
  }

  it("booking_shows_cancellation_policy_text", async () => {
    mockParams = { id: "5" };
    mockBooking(stay);
    await render(client(<BookingScreen />));
    expect(await screen.findByText(/Full refund up to 5 days before check-in/)).toBeTruthy();
  });

  it("stay_total_comes_from_the_server_quote_and_booking_posts_it", async () => {
    mockParams = { id: "5" };
    mockBooking(stay);
    await render(client(<BookingScreen />));
    expect(await screen.findByText("GH₵ 300.00")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Book this stay"));
    await waitFor(() => expect(screen.getByText(/Booking confirmed/i)).toBeTruthy());
    const call = apiMock.mock.calls.find((c) => c[0] === "/api/bookings/");
    expect(call[1].body).toMatchObject({ listing: 5, units: 1 });
    expect(call[1].body.check_in < call[1].body.check_out).toBe(true);
  });

  it("closed_marketplace_disables_booking_with_the_message", async () => {
    mockParams = { id: "5" };
    mockBooking(stay, { gate_enabled: true, is_open: false, opens_at: "2026-11-06T06:00:00Z" });
    await render(client(<BookingScreen />));
    expect(await screen.findByText(/opens on/i)).toBeTruthy();
    expect(screen.getByLabelText("Book this stay").props.accessibilityState.disabled).toBe(true);
  });

  it("service_request_needs_a_message_and_sends_it", async () => {
    mockParams = { id: "6" };
    mockBooking(service);
    await render(client(<BookingScreen />));
    await screen.findByText("Tailoring");
    expect(screen.getByLabelText("Send request").props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText("What do you need?"), "Two shirts, slim fit");
    await fireEvent.press(screen.getByLabelText("Send request"));
    await waitFor(() => expect(screen.getByText(/Request sent/i)).toBeTruthy());
    const call = apiMock.mock.calls.find((c) => c[0] === "/api/services/requests/");
    expect(call[1].body).toMatchObject({ listing: 6, message: "Two shirts, slim fit", budget: null });
  });

  it("booking_conflict_shows_dates_unavailable", async () => {
    mockParams = { id: "5" };
    mockBooking(stay);
    const base = apiMock.getMockImplementation()!;
    apiMock.mockImplementation(async (path: string, init?: unknown) => {
      if (path === "/api/bookings/") throw new ApiError(409, { detail: "Those dates aren't available for the number of units requested." });
      return base(path, init);
    });
    await render(client(<BookingScreen />));
    await screen.findByText("GH₵ 300.00");
    await fireEvent.press(screen.getByLabelText("Book this stay"));
    expect(await screen.findByText(/aren.t available/i)).toBeTruthy();
  });
});

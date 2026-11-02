import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import BusinessScreen from "../src/app/(auth)/register/business";
import PlanStep from "../src/app/(auth)/register/plan";
import CartScreen from "../src/app/cart";
import ListingManage from "../src/app/manage/listing/[id]";
import NotificationsScreen from "../src/app/notifications";
import SellerScreen from "../src/app/seller/[id]";
import { useHideSplash } from "../src/lib/useHideSplash";
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
jest.mock("expo-screen-capture", () => ({ usePreventScreenCapture: jest.fn() }));
jest.mock("expo-splash-screen", () => ({ preventAutoHideAsync: jest.fn(), hideAsync: jest.fn(async () => {}) }));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;
const splash = jest.requireMock("expo-splash-screen");
const picker = jest.requireMock("expo-image-picker");

function client(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  useAuth.setState({ status: "signedIn", account: { type: "customer", id: 1, fullName: "Ama" } });
});

describe("splash screen", () => {
  it("stays_until_fonts_and_the_account_lookup_are_done", async () => {
    useAuth.setState({ status: "loading", account: undefined });
    await renderHook(() => useHideSplash(true));
    expect(splash.hideAsync).not.toHaveBeenCalled();
    await act(async () => useAuth.setState({ status: "signedOut" }));
    expect(splash.hideAsync).toHaveBeenCalledTimes(1);
  });

  it("waits_for_fonts_even_when_the_lookup_is_done", async () => {
    useAuth.setState({ status: "signedOut", account: undefined });
    const { rerender } = await renderHook((p: { ready: boolean }) => useHideSplash(p.ready), { initialProps: { ready: false } });
    expect(splash.hideAsync).not.toHaveBeenCalled();
    await rerender({ ready: true });
    expect(splash.hideAsync).toHaveBeenCalledTimes(1);
  });

  it("never_holds_the_splash_forever_when_the_lookup_hangs", async () => {
    jest.useFakeTimers();
    try {
      useAuth.setState({ status: "loading", account: undefined });
      await renderHook(() => useHideSplash(true));
      await act(async () => { jest.advanceTimersByTime(8000); });
      expect(splash.hideAsync).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("notifications", () => {
  const note = { id: 1, kind: "order", title: "Order paid", body: "Thanks", is_read: false, created_at: "2026-11-02T10:00:00Z" };
  it("a_failed_mark_all_read_says_so_instead_of_failing_silently", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/notifications/") return { unread_count: 1, results: [note] };
      throw new ApiError(500, {});
    });
    await render(client(<NotificationsScreen />));
    await fireEvent.press(await screen.findByLabelText("Mark all as read"));
    expect(await screen.findByText(/couldn.t update your notifications/i)).toBeTruthy();
  });

  it("a_failed_single_read_says_so_too", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/notifications/") return { unread_count: 1, results: [note] };
      throw new ApiError(500, {});
    });
    await render(client(<NotificationsScreen />));
    await fireEvent.press(await screen.findByLabelText(/Order paid/));
    expect(await screen.findByText(/couldn.t update your notifications/i)).toBeTruthy();
  });
});

describe("photo picker", () => {
  const rows = [{ id: 8, name: "Leather bag", price_amount: "120.00", status: "draft", stock_quantity: 3, rejection_reason: "", photos: [] }];
  function server() {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/listings/mine/") return rows;
      throw new ApiError(404, {});
    });
  }
  it("a_permission_request_that_throws_shows_a_message", async () => {
    mockParams = { id: "8" };
    server();
    picker.requestMediaLibraryPermissionsAsync.mockRejectedValueOnce(new Error("native module failed"));
    await render(client(<ListingManage />));
    await fireEvent.press(await screen.findByLabelText("Add a photo"));
    expect(await screen.findByText(/couldn.t open your photos/i)).toBeTruthy();
  });

  it("a_picker_that_throws_shows_a_message", async () => {
    mockParams = { id: "8" };
    server();
    picker.launchImageLibraryAsync.mockRejectedValueOnce(new Error("no activity"));
    await render(client(<ListingManage />));
    await fireEvent.press(await screen.findByLabelText("Add a photo"));
    expect(await screen.findByText(/couldn.t open your photos/i)).toBeTruthy();
  });
});

describe("cart", () => {
  it("quantity_and_remove_are_disabled_while_a_change_is_in_flight", async () => {
    let release: () => void = () => {};
    const cart = {
      id: 1, total: "900.00",
      items: [
        { id: 11, listing: 7, listing_name: "Kente stole", variant_label: "", quantity: 2, unit_price_snapshot: "450.00", line_total: "900.00", in_stock: true, stock_quantity: 5 },
        { id: 12, listing: 8, listing_name: "Adinkra cloth", variant_label: "", quantity: 1, unit_price_snapshot: "180.00", line_total: "180.00", in_stock: true, stock_quantity: 5 },
      ],
    };
    apiMock.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/api/cart/" && !init?.method) return cart;
      if (path.startsWith("/api/cart/items/")) return new Promise<void>((r) => { release = r; });
      throw new ApiError(404, {});
    });
    await render(client(<CartScreen />));
    await fireEvent.press(await screen.findByLabelText("One more Kente stole"));
    await waitFor(() => expect(screen.getByLabelText("One more Adinkra cloth").props.accessibilityState?.disabled).toBe(true));
    expect(screen.getByLabelText("One more Kente stole").props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByLabelText("One fewer Kente stole").props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByLabelText("Remove Adinkra cloth").props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByLabelText("Go to checkout").props.accessibilityState?.disabled).toBe(true);
    await act(async () => release());
    await waitFor(() => expect(screen.getByLabelText("One more Adinkra cloth").props.accessibilityState?.disabled).toBe(false));
  });
});

describe("business registration form", () => {
  it("typing_in_a_field_does_not_remount_the_toggle_or_upload_buttons", async () => {
    useAuth.setState({ status: "signedIn", account: { type: "business_owner", id: 3, fullName: "K" } });
    await render(<BusinessScreen />);
    const before = [screen.getByLabelText("Informal"), screen.getByLabelText("Card front")].map((e) => (e as unknown as { instance: unknown }).instance);
    await fireEvent.changeText(screen.getByLabelText("Business contact phone"), "0207886600");
    await fireEvent.changeText(screen.getByLabelText("Ghana Post GPS address"), "AK-039-5028");
    const after = [screen.getByLabelText("Informal"), screen.getByLabelText("Card front")].map((e) => (e as unknown as { instance: unknown }).instance);
    // compared with Object.is: a failing toBe would try to print two huge host trees
    expect(Object.is(after[0], before[0])).toBe(true);
    expect(Object.is(after[1], before[1])).toBe(true);
  });
});

describe("plan step", () => {
  const plan = { id: 1, tier: "starter", name: "Starter", kind: "product", monthly_price: "50.00" };
  it("a_kind_with_no_matching_plan_says_so_and_can_still_continue", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/billing/plans/") return [plan];
      if (path === "/api/billing/business-kind/") return {};
      if (path === "/api/accounts/me/") return { account_type: "business_owner", id: 3, full_name: "K", registration_step: "terms", kyc_status: "pending" };
      throw new ApiError(404, {});
    });
    useAuth.setState({ status: "signedIn", account: { type: "business_owner", id: 3, fullName: "K" } });
    await render(client(<PlanStep />));
    await fireEvent.press(await screen.findByLabelText("Services, stays and events"));
    expect(await screen.findByText(/no plans for this yet/i)).toBeTruthy();
    const next = screen.getByLabelText("Continue");
    expect(next.props.accessibilityState?.disabled).toBe(false);
    await fireEvent.press(next);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/billing/business-kind/", { body: { business_kind: "service" } }));
  });

  it("a_plans_answer_that_is_not_a_plain_list_does_not_crash", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path === "/api/billing/plans/") return { results: [plan] };
      throw new ApiError(404, {});
    });
    useAuth.setState({ status: "signedIn", account: { type: "business_owner", id: 3, fullName: "K" } });
    await render(client(<PlanStep />));
    await fireEvent.press(await screen.findByLabelText("Products"));
    expect(await screen.findByLabelText("Starter")).toBeTruthy();
  });
});

describe("seller page", () => {
  const listing = (id: number) => ({
    id, name: `Item ${id}`, price_amount: "10.00", effective_price: "10.00", main_photo: null, review_count: 0,
    business_owner: { id: 2, name: "Akosua Ntoma Store" }, category: { kind: "product" },
  });
  const pageOf = (n: number, from: number, next: boolean) => ({ results: Array.from({ length: n }, (_, i) => listing(from + i)), next: next ? "more" : null });
  it("loads_the_first_page_only_and_the_next_on_request", async () => {
    mockParams = { id: "2" };
    const asked: number[] = [];
    apiMock.mockImplementation(async (path: string, init?: { query?: { page?: number } }) => {
      if (path === "/api/listings/sellers/2/") return { id: 2, name: "Akosua Ntoma Store", since: null, counts: { products: 60 } };
      if (path === "/api/listings/") {
        const p = init?.query?.page ?? 1;
        asked.push(p);
        return pageOf(20, (p - 1) * 20 + 1, p < 3);
      }
      throw new ApiError(404, {});
    });
    await render(client(<SellerScreen />));
    expect(await screen.findByText("Item 1")).toBeTruthy();
    expect(asked).toEqual([1]);
    await fireEvent.press(screen.getByLabelText("Show more"));
    expect(await screen.findByText("Item 21")).toBeTruthy();
    expect(asked).toEqual([1, 2]);
  });
});

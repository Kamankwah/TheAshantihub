import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { AccessibilityInfo } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { PhotoGallery } from "../src/features/listing/PhotoGallery";
import { openingMode, photoSources, shouldClose } from "../src/features/listing/motion";
import { useReducedMotion } from "../src/features/listing/useReducedMotion";
import ListingScreen from "../src/app/listing/[id]";
import { api, ApiError } from "../src/lib/api";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ id: "7" }),
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

const variants = (n: number) => ({
  thumb: `https://x/${n}-t.webp`,
  medium: `https://x/${n}-m.webp`,
  large: `https://x/${n}-l.webp`,
});

const detail = (over: Record<string, unknown> = {}) => ({
  id: 7,
  name: "Hand-woven kente stole",
  description: "Woven in Bonwire.",
  price_amount: "450.00",
  effective_price: "450.00",
  sale_price: null,
  was_price: null,
  main_photo: "https://x/m.jpg",
  main_photo_variants: variants(0),
  photos: [
    { id: 1, image: "https://x/1.jpg", variants: variants(1) },
    { id: 2, image: "https://x/2.jpg", variants: variants(2) },
  ],
  variants: [],
  has_variants: false,
  stock_quantity: 5,
  delivery_time: null,
  category: { id: 1, label: "Fashion", kind: "product", is_food: false },
  avg_rating: 4.8,
  review_count: 12,
  business_owner: { id: 2, name: "Akosua Ntoma Store", identity_verified: true },
  ...over,
});

function mockApi(listing = detail(), opening: Record<string, unknown> = { gate_enabled: false, is_open: true }) {
  apiMock.mockImplementation(async (path: string) => {
    if (path === "/api/listings/7/") return listing;
    if (path === "/api/storefront/opening/") return { server_now: new Date().toISOString(), ...opening };
    if (path === "/api/cart/guard/") return { listing: { blocked: null } };
    throw new ApiError(404, {});
  });
}

function withClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

const Gallery = (props: React.ComponentProps<typeof PhotoGallery>) => (
  <GestureHandlerRootView style={{ flex: 1 }}>
    <PhotoGallery {...props} />
  </GestureHandlerRootView>
);

beforeEach(() => jest.clearAllMocks());

describe("motion rules", () => {
  it("reduce_motion_uses_fade_not_flight", () => {
    const origin = { id: 7, uri: "u", x: 10, y: 20, width: 100, height: 80 };
    expect(openingMode(true, origin)).toBe("fade");
    expect(openingMode(false, origin)).toBe("flight");
    expect(openingMode(false, null)).toBe("fade");
  });

  it("reduce_motion_hook_follows_the_system_setting", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
    const { result } = await renderHook(() => useReducedMotion());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("placeholder_is_thumb_then_large_url", () => {
    expect(photoSources(variants(1))).toEqual({ placeholder: "https://x/1-t.webp", uri: "https://x/1-l.webp" });
    expect(photoSources({ thumb: "t", medium: "m", large: null })).toEqual({ placeholder: "t", uri: "m" });
  });

  it("dragging_down_far_or_fast_closes", () => {
    expect(shouldClose(160, 0)).toBe(true);
    expect(shouldClose(30, 1200)).toBe(true);
    expect(shouldClose(40, 100)).toBe(false);
    expect(shouldClose(-200, -1500)).toBe(false);
  });
});

describe("photo gallery", () => {
  const photos = [1, 2, 3].map((n) => ({ id: n, variants: variants(n) }));

  it("gallery_starts_on_tapped_photo", async () => {
    await render(<Gallery photos={photos} initialIndex={2} onClose={() => {}} />);
    expect(screen.getByText("3 of 3")).toBeTruthy();
    expect(screen.getByLabelText("Photo 3 of 3")).toBeTruthy();
  });

  it("close_gesture_calls_onClose", async () => {
    const onClose = jest.fn();
    await render(<Gallery photos={photos} initialIndex={0} onClose={onClose} />);
    await fireEvent.press(screen.getByLabelText("Close photos"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("listing page", () => {
  it("shows_name_price_seller_and_rating", async () => {
    mockApi();
    await render(withClient(<ListingScreen />));
    expect(await screen.findByText("Hand-woven kente stole")).toBeTruthy();
    expect(screen.getByText(/450\.00/)).toBeTruthy();
    expect(screen.getByText("Akosua Ntoma Store")).toBeTruthy();
    expect(screen.getByText(/4\.8 · 12 reviews/)).toBeTruthy();
  });

  it("rating_row_hidden_when_zero_reviews", async () => {
    mockApi(detail({ review_count: 0, avg_rating: null }));
    await render(withClient(<ListingScreen />));
    await screen.findByText("Hand-woven kente stole");
    expect(screen.queryByText(/reviews?$/)).toBeNull();
  });

  it("has_contact_support_but_no_phone_or_whatsapp", async () => {
    mockApi();
    await render(withClient(<ListingScreen />));
    await screen.findByText("Hand-woven kente stole");
    expect(screen.getByText("Contact Support")).toBeTruthy();
    expect(screen.queryByText(/whatsapp|call the seller|tel:/i)).toBeNull();
  });

  it("delivery_info_has_no_dates", async () => {
    mockApi();
    await render(withClient(<ListingScreen />));
    await screen.findByText("Hand-woven kente stole");
    expect(screen.getByText(/worked out at checkout/i)).toBeTruthy();
    expect(screen.queryByText(/arrives|delivered by|estimated/i)).toBeNull();
  });

  it("closed_marketplace_shows_message_and_disables_add", async () => {
    mockApi(detail(), { gate_enabled: true, is_open: false, opens_at: "2026-11-06T06:00:00Z" });
    await render(withClient(<ListingScreen />));
    await screen.findByText("Hand-woven kente stole");
    expect(await screen.findByText(/opens on/i)).toBeTruthy();
    const add = screen.getByLabelText("Add to cart");
    expect(add.props.accessibilityState?.disabled).toBe(true);
  });

  it("variants_are_listed_and_out_of_stock_is_marked", async () => {
    mockApi(
      detail({
        has_variants: true,
        variants: [
          { id: 1, label: "Red", price_amount: "450.00", effective_price: "450.00", stock_quantity: 3 },
          { id: 2, label: "Blue", price_amount: "450.00", effective_price: "450.00", stock_quantity: 0 },
        ],
      }),
    );
    await render(withClient(<ListingScreen />));
    expect(await screen.findByText("Red")).toBeTruthy();
    expect(screen.getByText("Blue")).toBeTruthy();
    expect(screen.getByText("Out of stock")).toBeTruthy();
  });

  it("error_state_offers_retry", async () => {
    apiMock.mockRejectedValue(new ApiError(500, {}));
    await render(withClient(<ListingScreen />));
    expect(await screen.findByText(/couldn.t load/i)).toBeTruthy();
    await act(async () => {});
    expect(screen.getByLabelText("Try again")).toBeTruthy();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import ExploreScreen from "../src/app/customer/explore";
import { ListingCard } from "../src/features/browse/ListingCard";
import type { Listing } from "../src/features/browse/types";
import { api, ApiError } from "../src/lib/api";

jest.mock("expo-router", () => ({ router: { push: jest.fn() }, useLocalSearchParams: () => ({}) }));
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

const listing = (over: Partial<Listing> = {}): Listing => ({
  id: 1,
  name: "Hand-woven kente stole",
  price_amount: "450.00",
  effective_price: "450.00",
  sale_price: null,
  was_price: null,
  main_photo: "https://x/y.jpg",
  main_photo_variants: { thumb: "https://x/t.webp", medium: "https://x/m.webp", large: "https://x/l.webp" },
  avg_rating: 4.8,
  review_count: 36,
  is_promoted: false,
  business_owner: { id: 2, name: "Akosua Ntoma Store", identity_verified: true },
  ...over,
});

function withClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

beforeEach(() => jest.clearAllMocks());

describe("listing card", () => {
  it("rating_row_hidden_when_zero_reviews", async () => {
    await render(<ListingCard listing={listing({ review_count: 0, avg_rating: 0 })} onPress={() => {}} />);
    expect(screen.queryByText(/reviews?/)).toBeNull();
    expect(screen.queryByText("0.0")).toBeNull();
  });

  it("shows_the_rating_when_there_are_reviews", async () => {
    await render(<ListingCard listing={listing()} onPress={() => {}} />);
    expect(screen.getByText("4.8 · 36 reviews")).toBeTruthy();
  });

  it("promoted_tag_only_on_sponsored", async () => {
    await render(<ListingCard listing={listing()} onPress={() => {}} />);
    expect(screen.queryByText("Promoted")).toBeNull();
    await render(<ListingCard listing={listing({ is_promoted: true })} onPress={() => {}} />);
    expect(screen.getByText("Promoted")).toBeTruthy();
  });

  it("verified_badge_only_when_identity_verified", async () => {
    await render(<ListingCard listing={listing({ business_owner: { id: 2, name: "A", identity_verified: false } })} onPress={() => {}} />);
    expect(screen.queryByLabelText("Verified business")).toBeNull();
  });

  it("a_real_discount_shows_the_was_price_struck_through", async () => {
    await render(<ListingCard listing={listing({ effective_price: "380.00", sale_price: "380.00", was_price: "450.00" })} onPress={() => {}} />);
    expect(screen.getByText("GH₵ 380.00")).toBeTruthy();
    expect(screen.getByText("GH₵ 450.00")).toBeTruthy();
  });

  it("tapping_the_card_calls_onPress_with_the_id", async () => {
    const onPress = jest.fn();
    await render(<ListingCard listing={listing()} onPress={onPress} />);
    await fireEvent.press(screen.getByRole("button", { name: /Hand-woven kente stole/ }));
    expect(onPress).toHaveBeenCalledWith(1);
  });
});

describe("explore", () => {
  it("explore_loads_next_page_at_end", async () => {
    apiMock.mockImplementation(async (path: string, init?: { query?: { page?: number } }) => {
      if (path.includes("/storefront/home")) return { most_visited: [], ranked: false };
      return init?.query?.page === 2
        ? { count: 2, next: null, results: [listing({ id: 2, name: "Adinkra cloth" })] }
        : { count: 2, next: "https://api/listings/?page=2", results: [listing()] };
    });
    await render(withClient(<ExploreScreen />));
    expect(await screen.findByText("Hand-woven kente stole")).toBeTruthy();
    await fireEvent(screen.getByTestId("results-list"), "endReached");
    expect(await screen.findByText("Adinkra cloth")).toBeTruthy();
  });

  it("error_state_offers_retry", async () => {
    apiMock.mockImplementation(async (path: string) => {
      if (path.includes("/storefront/home")) return { most_visited: [], ranked: false };
      throw new ApiError(500, {});
    });
    await render(withClient(<ExploreScreen />));
    expect(await screen.findByText("We couldn't load listings")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy());
  });

  it("an_empty_result_says_so", async () => {
    apiMock.mockImplementation(async (path: string) =>
      path.includes("/storefront/home") ? { most_visited: [], ranked: false } : { count: 0, next: null, results: [] },
    );
    await render(withClient(<ExploreScreen />));
    expect(await screen.findByText("Nothing found")).toBeTruthy();
  });
});

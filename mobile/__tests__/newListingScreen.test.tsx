import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";

import NewListing from "../src/app/manage/new-listing";
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
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: "file:///a.jpg", fileName: "a.jpg", mimeType: "image/jpeg" }, { uri: "file:///b.jpg", fileName: "b.jpg", mimeType: "image/jpeg" }] })),
}));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;
const { router } = jest.requireMock("expo-router");
const ImagePicker = jest.requireMock("expo-image-picker");

const node = (id: number, label: string, kind: string, extra: Record<string, unknown> = {}) => ({ id, slug: label.toLowerCase(), label, icon: "", color: "", kind, is_accommodation: false, children: [], ...extra });
const tree = [
  node(1, "Fashion", "product", { children: [node(11, "Kente cloth", "product")] }),
  node(3, "Services", "service", { children: [node(31, "Guesthouses", "service", { is_accommodation: true })] }),
  node(4, "Events", "event"),
];

type Calls = { path: string; init?: { method?: string; body?: unknown } }[];
let calls: Calls;
let world: { kind: string | null; create: unknown; photo: unknown };

function serve() {
  apiMock.mockImplementation(async (path: string, init?: Calls[number]["init"]) => {
    calls.push({ path, init });
    const post = init?.body !== undefined || init?.method === "POST";
    if (path === "/api/listings/categories/tree/") return tree;
    if (path === "/api/listings/zones/") return [{ id: 5, name: "Kumasi Central" }, { id: 6, name: "Bantama" }];
    if (path === "/api/accounts/business-owners/me/profile/") return { business_kind: world.kind };
    if (path === "/api/ledger/booking-terms/") return { enabled: true, policies: { moderate: { label: "Moderate", text: "Full refund up to 5 days before.", tiers: [] }, flexible: { label: "Flexible", text: "Free until the day before.", tiers: [] } } };
    if (path === "/api/listings/mine/" && post) {
      if (world.create instanceof ApiError) throw world.create;
      return world.create;
    }
    if (path === "/api/listings/mine/77/photos/" && post) {
      if (world.photo instanceof ApiError) throw world.photo;
      return { id: 1 };
    }
    if (path === "/api/listings/mine/77/submit/" && post) return { id: 77, status: "pending_review" };
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
  world = { kind: null, create: { id: 77, status: "draft" }, photo: {} };
  serve();
});

async function pick(label: string, option: string) {
  await fireEvent.press(await screen.findByLabelText(label));
  await fireEvent.press(await screen.findByLabelText(option));
}
async function fillProduct() {
  await pick("Category", "Fashion › Kente cloth");
  await pick("Area", "Kumasi Central");
  await fireEvent.changeText(screen.getByLabelText("Name"), "Kente stole");
  await fireEvent.changeText(screen.getByLabelText("Description"), "Woven in Bonwire.");
  await fireEvent.changeText(screen.getByLabelText("Price in GH₵"), "450");
  await fireEvent.press(screen.getByLabelText("Warranty: No warranty"));
  await fireEvent.press(screen.getByLabelText("Expiry: No expiry date"));
  await fireEvent.changeText(screen.getByLabelText("Return policy"), "Returns within 7 days.");
}

describe("new listing", () => {
  it("offers_products_and_services_but_never_events", async () => {
    await render(withClient(<NewListing />));
    await fireEvent.press(await screen.findByLabelText("Category"));
    expect(await screen.findByLabelText("Fashion › Kente cloth")).toBeTruthy();
    expect(screen.getByLabelText("Services › Guesthouses")).toBeTruthy();
    expect(screen.queryByLabelText("Events")).toBeNull();
  });

  it("a_service_business_is_not_offered_products", async () => {
    world.kind = "service";
    await render(withClient(<NewListing />));
    await fireEvent.press(await screen.findByLabelText("Category"));
    await screen.findByLabelText("Services › Guesthouses");
    expect(screen.queryByLabelText("Fashion › Kente cloth")).toBeNull();
  });

  it("save_stays_off_until_the_product_questions_are_answered_then_posts_a_draft", async () => {
    await render(withClient(<NewListing />));
    await pick("Category", "Fashion › Kente cloth");
    await pick("Area", "Kumasi Central");
    await fireEvent.changeText(screen.getByLabelText("Name"), "Kente stole");
    await fireEvent.changeText(screen.getByLabelText("Description"), "Woven in Bonwire.");
    expect(screen.getByLabelText("Save as draft").props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(screen.getByLabelText("Warranty: No warranty"));
    await fireEvent.press(screen.getByLabelText("Expiry: No expiry date"));
    await fireEvent.changeText(screen.getByLabelText("Return policy"), "Returns within 7 days.");
    await fireEvent.changeText(screen.getByLabelText("Price in GH₵"), "450");
    await waitFor(() => expect(screen.getByLabelText("Save as draft").props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByLabelText("Save as draft"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/manage/listing/77"));
    const post = calls.find((c) => c.path === "/api/listings/mine/" && c.init?.body)!;
    expect(post.init?.body).toMatchObject({ category: 11, zone: 5, name: "Kente stole", price_amount: "450", has_warranty: false, has_expiry: false, return_policy: "Returns within 7 days.", price_unit: "per item" });
    expect(calls.some((c) => c.path.endsWith("/submit/"))).toBe(false);
  });

  it("send_for_review_uploads_the_photos_then_submits", async () => {
    await render(withClient(<NewListing />));
    await fillProduct();
    await fireEvent.press(screen.getByLabelText("Add photos"));
    expect(await screen.findByText("2 photos chosen")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Save and send for review"));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/manage/listing/77"));
    const paths = calls.filter((c) => c.init?.body !== undefined || c.init?.method === "POST").map((c) => c.path);
    expect(paths).toEqual(["/api/listings/mine/", "/api/listings/mine/77/photos/", "/api/listings/mine/77/photos/", "/api/listings/mine/77/submit/"]);
  });

  it("a_photo_that_fails_keeps_the_listing_and_says_so_instead_of_leaving", async () => {
    world.photo = new ApiError(400, { image: ["Image too large."] });
    await render(withClient(<NewListing />));
    await fillProduct();
    await fireEvent.press(screen.getByLabelText("Add photos"));
    await screen.findByText("2 photos chosen");
    await fireEvent.press(screen.getByLabelText("Save as draft"));
    expect(await screen.findByText(/Your listing was saved, but a photo was not added/)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Open your listing"));
    expect(router.replace).toHaveBeenCalledWith("/manage/listing/77");
  });

  it("shows_the_servers_refusal_in_plain_words_and_stays_on_the_form", async () => {
    world.create = new ApiError(400, { subscription: "Your subscription is not active. Renew it to add listings." });
    await render(withClient(<NewListing />));
    await fillProduct();
    await fireEvent.press(screen.getByLabelText("Save as draft"));
    expect(await screen.findByText("Your subscription is not active. Renew it to add listings.")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a_stay_asks_for_units_and_a_cancellation_policy_and_prices_per_night", async () => {
    await render(withClient(<NewListing />));
    await pick("Category", "Services › Guesthouses");
    await pick("Area", "Bantama");
    await fireEvent.changeText(screen.getByLabelText("Name"), "Kumasi Guesthouse");
    await fireEvent.changeText(screen.getByLabelText("Description"), "Quiet rooms.");
    await fireEvent.changeText(screen.getByLabelText("Price per night in GH₵"), "300");
    await fireEvent.changeText(screen.getByLabelText("Rooms or units available"), "8");
    expect(screen.getByLabelText("Save as draft").props.accessibilityState.disabled).toBe(true);
    await pick("Cancellation policy", "Moderate: Full refund up to 5 days before.");
    await waitFor(() => expect(screen.getByLabelText("Save as draft").props.accessibilityState.disabled).toBe(false));
    await fireEvent.press(screen.getByLabelText("Save as draft"));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(calls.find((c) => c.path === "/api/listings/mine/" && c.init?.body)!.init?.body).toMatchObject({ category: 31, units_total: 8, cancellation_policy: "moderate", price_unit: "per night" });
  });

  it("denied_photo_access_is_explained", async () => {
    ImagePicker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce({ granted: false });
    await render(withClient(<NewListing />));
    await fireEvent.press(await screen.findByLabelText("Add photos"));
    expect(await screen.findByText(/Allow photo access/)).toBeTruthy();
  });

  it("a_picker_that_throws_is_caught", async () => {
    ImagePicker.launchImageLibraryAsync.mockRejectedValueOnce(new Error("boom"));
    await render(withClient(<NewListing />));
    await fireEvent.press(await screen.findByLabelText("Add photos"));
    expect(await screen.findByText(/couldn.t open your photos/i)).toBeTruthy();
  });
});

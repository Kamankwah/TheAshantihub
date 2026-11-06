import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { Linking } from "react-native";

import BusinessHome from "../src/app/business/home";
import BusinessListings from "../src/app/business/listings";
import BusinessMore from "../src/app/business/more";
import BusinessOrders from "../src/app/business/orders";
import HoursScreen from "../src/app/manage/hours";
import ListingManage from "../src/app/manage/listing/[id]";
import OrderDetail from "../src/app/manage/order/[id]";
import VerificationScreen from "../src/app/manage/verification";
import { firstName } from "../src/features/business/orders";
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
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;
const { router } = jest.requireMock("expo-router");

const me = (over: Record<string, unknown> = {}) => ({
  account_type: "business_owner", id: 2, full_name: "Kwame Mensah", kyc_status: "verified", kyc_rejection_reason: "",
  identity_status: "verified", identity_rejection_reason: null, registration_step: "complete", ...over,
});
const order = (over: Record<string, unknown> = {}) => ({
  id: 501, customer_name: "Ama Owusu", status: "paid", delivery_status: "processing", placed_at: "2026-11-06T09:30:00Z",
  items: [{ id: 1, listing_name: "Hand-woven kente stole", quantity: 2, line_total: "900.00" }], owner_subtotal: "900.00",
  pickup_code: "4821", pickup_status: "pending", pickup_eta: null, pickup_eta_late: false, rider_report: null,
  delivery_method: "door_to_door", delivery_address: "12 Adum Road", delivery_gps_address: "AK-039-5028", delivery_landmark: "Blue kiosk", ...over,
});
const listing = (over: Record<string, unknown> = {}) => ({
  id: 7, name: "Hand-woven kente stole", price_amount: "450.00", status: "published", stock_quantity: 5, rejection_reason: "",
  description: "Woven in Bonwire.", photos: [], ...over,
});
const stock = (over: Record<string, unknown> = {}) => ({
  results: [], tracked_offers: 0, untracked_offers: 0, settings: { cover_days: 7, fallback_units: 5, window_days: 28, alerts_enabled: true }, ...over,
});

function server(routes: Record<string, unknown | ((init?: any) => unknown)>) {
  apiMock.mockImplementation(async (path: string, init?: any) => {
    const hit = routes[path];
    if (hit === undefined) throw new ApiError(404, {});
    const out = typeof hit === "function" ? (hit as (i?: unknown) => unknown)(init) : hit;
    if (out instanceof Error) throw out;
    return out;
  });
}

function client(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
  useAuth.setState({ status: "signedIn", account: { type: "business_owner", id: 2, fullName: "Kwame Mensah" } });
});

describe("business home", () => {
  it("low_stock_banner_uses_api_threshold", async () => {
    server({
      "/api/accounts/me/": me(),
      "/api/orders/owner/": { results: [], next: null },
      "/api/accounts/business/hours/": { has_hours: true, days: [] },
      "/api/catalogue/stock/": stock({
        results: [
          { listing_id: 7, name: "Kente stole", stock: 2, days_of_cover: "3.5", line: 5, low: true, sold_out: false },
          { listing_id: 8, name: "Adinkra cloth", stock: 0, days_of_cover: null, line: null, low: true, sold_out: true },
          { listing_id: 9, name: "Beads", stock: 4, days_of_cover: "2.0", line: null, low: true, sold_out: false },
        ],
      }),
    });
    await render(client(<BusinessHome />));
    expect(await screen.findByText("Kente stole")).toBeTruthy();
    expect(screen.getByText(/Your alert line: 5 units/)).toBeTruthy();
    expect(screen.getByText(/3\.5 days of sales left/)).toBeTruthy();
    expect(screen.getByText(/Sold out/)).toBeTruthy();
    expect(screen.getAllByText(/fewer than 7 days of sales left/).length).toBe(2); // the API's default, not a number made up here
  });

  it("no_banner_when_nothing_is_low", async () => {
    server({ "/api/accounts/me/": me(), "/api/orders/owner/": { results: [], next: null }, "/api/accounts/business/hours/": { has_hours: true, days: [] }, "/api/catalogue/stock/": stock() });
    await render(client(<BusinessHome />));
    await screen.findByText(/Akwaaba, Kwame/);
    expect(screen.queryByText(/running low/i)).toBeNull();
  });

  it("email_banner_shows_on_home_while_the_email_is_unconfirmed", async () => {
    server({
      "/api/accounts/me/": me({ go_live: { live: false, blockers: [{ code: "email_unconfirmed", message: "Confirm your email." }] } }),
      "/api/orders/owner/": { results: [], next: null },
      "/api/accounts/business/hours/": { has_hours: true, days: [] },
      "/api/catalogue/stock/": stock(),
    });
    await render(client(<BusinessHome />));
    expect(await screen.findByText("Confirm your email to publish listings")).toBeTruthy();
  });

  it("a_not_live_owner_sees_a_checklist_of_the_servers_blockers_with_no_approval_wait", async () => {
    server({
      "/api/accounts/me/": me({ kyc_status: "pending", identity_status: "not_submitted", go_live: { live: false, blockers: [{ code: "no_pin", message: "Share your shop location." }, { code: "terms_missing", message: "Accept the seller terms." }] } }),
      "/api/orders/owner/": { results: [], next: null },
      "/api/accounts/business/hours/": { has_hours: true, days: [] },
      "/api/catalogue/stock/": stock(),
    });
    await render(client(<BusinessHome />));
    expect(await screen.findByText("To start listing, finish these:")).toBeTruthy();
    expect(screen.getByText("Share your shop location.")).toBeTruthy();
    expect(screen.getByText("Accept the seller terms.")).toBeTruthy();
    expect(screen.queryByText(/once verified|as soon as you/i)).toBeNull();
  });

  it("no_checklist_for_a_live_owner_whose_kyc_is_still_pending", async () => {
    server({
      "/api/accounts/me/": me({ kyc_status: "pending", identity_status: "not_submitted", go_live: { live: true, blockers: [] } }),
      "/api/orders/owner/": { results: [], next: null },
      "/api/accounts/business/hours/": { has_hours: true, days: [] },
      "/api/catalogue/stock/": stock(),
    });
    await render(client(<BusinessHome />));
    await screen.findByText(/Akwaaba, Kwame/);
    expect(screen.queryByText("To start listing, finish these:")).toBeNull();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.queryByText("Verification in progress")).toBeNull();
  });

  const pillCases: [string, Record<string, unknown>, string][] = [
    ["verified", { kyc_status: "verified", go_live: { live: true, blockers: [] } }, "Verified"],
    ["live_but_not_verified", { kyc_status: "pending", go_live: { live: true, blockers: [] } }, "Live"],
    ["finishing_setup", { kyc_status: "pending", go_live: { live: false, blockers: [{ code: "no_pin", message: "Share your shop location." }] } }, "Finish setup"],
    ["rejected", { kyc_status: "rejected", go_live: { live: false, blockers: [{ code: "kyc_rejected", message: "Fix it." }] } }, "Needs changes"],
  ];
  it.each(pillCases)("status_pill_matches_the_web_chip_%s", async (_name, over, label) => {
    server({
      "/api/accounts/me/": me({ identity_status: "not_submitted", ...over }),
      "/api/orders/owner/": { results: [], next: null },
      "/api/accounts/business/hours/": { has_hours: true, days: [] },
      "/api/catalogue/stock/": stock(),
    });
    await render(client(<BusinessHome />));
    await screen.findByText(/Akwaaba, Kwame/);
    expect(screen.getByText(label)).toBeTruthy();
    expect(screen.queryByText("Verification in progress")).toBeNull();
    expect(screen.queryByText("Verification needs attention")).toBeNull();
  });

  it("a_rejected_owner_gets_no_email_banner_or_checklist_just_the_servers_sentence_and_a_way_to_fix_it", async () => {
    server({
      "/api/accounts/me/": me({ kyc_status: "rejected", identity_status: "not_submitted", go_live: { live: false, blockers: [{ code: "email_unconfirmed", message: "Confirm your email." }, { code: "kyc_rejected", message: "Your application needs changes. Open your profile to see what to fix." }] } }),
      "/api/orders/owner/": { results: [], next: null },
      "/api/accounts/business/hours/": { has_hours: true, days: [] },
      "/api/catalogue/stock/": stock(),
    });
    await render(client(<BusinessHome />));
    expect(await screen.findByText("Your application needs changes. Open your profile to see what to fix.")).toBeTruthy();
    expect(screen.queryByText("Confirm your email to publish listings")).toBeNull();
    expect(screen.queryByText("To start listing, finish these:")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "See what to fix" }));
    expect(router.push).toHaveBeenCalledWith("/manage/verification");
  });

  it("no_email_banner_when_the_server_reports_no_email_blocker", async () => {
    server({
      "/api/accounts/me/": me({ go_live: { live: true, blockers: [] } }),
      "/api/orders/owner/": { results: [], next: null },
      "/api/accounts/business/hours/": { has_hours: true, days: [] },
      "/api/catalogue/stock/": stock(),
    });
    await render(client(<BusinessHome />));
    await screen.findByText(/Akwaaba, Kwame/);
    expect(screen.queryByText("Confirm your email to publish listings")).toBeNull();
  });

  it("orders_waiting_to_be_prepared_are_counted_from_the_api", async () => {
    server({
      "/api/accounts/me/": me(),
      "/api/orders/owner/": { results: [order(), order({ id: 502 }), order({ id: 503, delivery_status: "shipped" })], next: null },
      "/api/accounts/business/hours/": { has_hours: true, days: [] },
      "/api/catalogue/stock/": stock(),
    });
    await render(client(<BusinessHome />));
    expect(await screen.findByText("2 orders to prepare")).toBeTruthy();
  });

  it("missing_hours_prompt_is_shown", async () => {
    server({ "/api/accounts/me/": me(), "/api/orders/owner/": { results: [], next: null }, "/api/accounts/business/hours/": { has_hours: false, days: [] }, "/api/catalogue/stock/": stock() });
    await render(client(<BusinessHome />));
    await fireEvent.press(await screen.findByLabelText("Add your opening hours"));
    expect(router.push).toHaveBeenCalledWith("/manage/hours");
  });

  it("whatsapp_update_goes_to_ashantihub_only", async () => {
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    server({ "/api/accounts/me/": me(), "/api/orders/owner/": { results: [], next: null }, "/api/accounts/business/hours/": { has_hours: true, days: [] }, "/api/catalogue/stock/": stock() });
    await render(client(<BusinessHome />));
    await fireEvent.press(await screen.findByLabelText("WhatsApp Update to AshantiHub"));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/233244000000/));
  });

  it("spend_is_not_called_revenue", async () => {
    server({ "/api/accounts/me/": me(), "/api/orders/owner/": { results: [], next: null }, "/api/accounts/business/hours/": { has_hours: true, days: [] }, "/api/catalogue/stock/": stock() });
    await render(client(<BusinessHome />));
    await screen.findByText(/Akwaaba, Kwame/);
    expect(screen.queryByText(/revenue|earnings|you earned/i)).toBeNull();
  });
});

describe("business orders", () => {
  it("order_detail_shows_first_name_only", async () => {
    mockParams = { id: "501" };
    server({ "/api/orders/owner/": { results: [order()], next: null } });
    await render(client(<OrderDetail />));
    expect(await screen.findByText(/Ama/)).toBeTruthy();
    expect(screen.queryByText(/Owusu/)).toBeNull();
    expect(screen.queryByText(/12 Adum Road|AK-039-5028|Blue kiosk/)).toBeNull();
    expect(screen.queryByText(/0\d{9}|\+233|tel:|whatsapp/i)).toBeNull();
  });

  it("first_name_helper", () => {
    expect(firstName("Ama Owusu")).toBe("Ama");
    expect(firstName("  ")).toBe("Customer");
    expect(firstName(undefined)).toBe("Customer");
  });

  it("pickup_code_is_for_the_rider_and_the_items_total_is_the_apis", async () => {
    mockParams = { id: "501" };
    server({ "/api/orders/owner/": { results: [order()], next: null } });
    await render(client(<OrderDetail />));
    expect(await screen.findByText("4821")).toBeTruthy();
    expect(screen.getByText(/Give this code to the rider/)).toBeTruthy();
    expect(screen.getAllByText("GH₵ 900.00").length).toBeGreaterThan(0);
    expect(screen.queryByText(/payout/i)).toBeNull(); // the API sends no payout figure, so none is shown
  });

  it("orders_list_marks_ones_to_prepare", async () => {
    server({ "/api/orders/owner/": { results: [order(), order({ id: 502, delivery_status: "shipped" })], next: null } });
    await render(client(<BusinessOrders />));
    expect(await screen.findByText("Order #501")).toBeTruthy();
    expect(screen.getByText("To prepare")).toBeTruthy();
    expect(screen.queryByText(/Owusu/)).toBeNull();
  });

  it("orders_error_offers_retry", async () => {
    server({ "/api/orders/owner/": new ApiError(500, {}) });
    await render(client(<BusinessOrders />));
    expect(await screen.findByLabelText("Try again")).toBeTruthy();
  });
});

describe("business listings", () => {
  const rows = [
    listing(),
    listing({ id: 8, name: "Draft bag", status: "draft" }),
    listing({ id: 9, name: "Refused hat", status: "rejected", rejection_reason: "Photo is too dark." }),
  ];

  it("status_filters_narrow_the_list", async () => {
    server({ "/api/listings/mine/": rows });
    await render(client(<BusinessListings />));
    expect(await screen.findByText("Draft bag")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Drafts"));
    expect(screen.queryByText("Refused hat")).toBeNull();
    expect(screen.getByText("Draft bag")).toBeTruthy();
  });

  it("each_status_has_words_and_icon", async () => {
    server({ "/api/listings/mine/": rows });
    await render(client(<BusinessListings />));
    await screen.findByText("Draft bag");
    expect(screen.getAllByLabelText("Live").length).toBeGreaterThan(1); // the filter chip and the row's status
    expect(screen.getAllByLabelText("Needs changes").length).toBeGreaterThan(0);
  });

  it("rejected_listing_shows_the_reason_and_can_be_sent_again", async () => {
    mockParams = { id: "9" };
    server({
      "/api/listings/mine/": rows,
      "/api/listings/mine/9/submit/": { id: 9, status: "pending_review" },
    });
    await render(client(<ListingManage />));
    expect(await screen.findByText(/Photo is too dark/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Send for review"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/listings/mine/9/submit/", { method: "POST" }));
  });

  it("live_listing_can_be_restocked_with_a_count", async () => {
    mockParams = { id: "7" };
    server({ "/api/listings/mine/": rows, "/api/listings/mine/7/restock/": { id: 7, stock_quantity: 15 } });
    await render(client(<ListingManage />));
    await fireEvent.changeText(await screen.findByLabelText("Add stock"), "10");
    await fireEvent.press(screen.getByLabelText("Add to stock"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/listings/mine/7/restock/", { body: { add: 10 } }));
  });

  it("hide_listing_posts_drop", async () => {
    mockParams = { id: "7" };
    server({ "/api/listings/mine/": rows, "/api/listings/mine/7/drop/": { id: 7, status: "dropped" } });
    await render(client(<ListingManage />));
    await fireEvent.press(await screen.findByLabelText("Hide listing"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/listings/mine/7/drop/", { method: "POST" }));
  });

  it("draft_edit_saves_name_price_and_stock", async () => {
    mockParams = { id: "8" };
    server({ "/api/listings/mine/": rows, "/api/listings/mine/8/": { id: 8 } });
    await render(client(<ListingManage />));
    await fireEvent.changeText(await screen.findByLabelText("Name"), "Leather bag");
    await fireEvent.changeText(screen.getByLabelText("Price in GH₵"), "120");
    await fireEvent.press(screen.getByLabelText("Save changes"));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/api/listings/mine/8/", { method: "PATCH", body: expect.objectContaining({ name: "Leather bag", price_amount: "120" }) }));
  });
});

describe("hours, verification and more", () => {
  it("hours_require_every_weekday_before_save", async () => {
    server({ "/api/accounts/business/hours/": { has_hours: false, days: [] } });
    await render(client(<HoursScreen />));
    await fireEvent.press(await screen.findByLabelText("Save opening hours"));
    expect(await screen.findByText(/Enter opening and closing times for Monday/)).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalledWith("/api/accounts/business/hours/", expect.objectContaining({ method: "PUT" }));
  });

  it("verification_shows_the_rejection_reason_from_the_api", async () => {
    server({ "/api/accounts/me/": me({ kyc_status: "rejected", kyc_rejection_reason: "The Ghana Card photo was blurry.", identity_status: "rejected", identity_rejection_reason: "Name does not match." }) });
    await render(client(<VerificationScreen />));
    expect(await screen.findByText(/Ghana Card photo was blurry/)).toBeTruthy();
    expect(screen.getByText(/Name does not match/)).toBeTruthy();
  });

  it("verified_shows_a_green_check_pill_not_gold", async () => {
    server({ "/api/accounts/me/": me() });
    await render(client(<VerificationScreen />));
    expect((await screen.findAllByLabelText("Verified business")).length).toBe(2); // business and identity
  });

  it("more_hub_lists_the_business_tools_and_signs_out", async () => {
    const signOut = jest.fn(async () => {});
    useAuth.setState({ signOut } as never);
    await render(client(<BusinessMore />));
    for (const l of ["Opening hours", "Verification", "Messages", "Notifications", "Contact Support", "Security", "Delete my account", "Terms of use", "Business agreement"]) {
      expect(screen.getByLabelText(l)).toBeTruthy();
    }
    await fireEvent.press(screen.getByLabelText("Delete my account"));
    expect(router.push).toHaveBeenCalledWith("/delete-account");
    await fireEvent.press(screen.getByLabelText("Sign out"));
    expect(signOut).toHaveBeenCalled();
  });
});

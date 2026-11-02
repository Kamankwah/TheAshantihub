import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react-native";
import type { ComponentType } from "react";
import { StyleSheet } from "react-native";

import { api } from "../src/lib/api";
import { useAuth } from "../src/state/auth";

let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  Redirect: () => null,
  Tabs: () => null,
  Stack: () => null,
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn(async () => ({})) }));
jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
}));
jest.mock("expo-location", () => ({ requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })), getCurrentPositionAsync: jest.fn(), Accuracy: { Balanced: 3 } }));
jest.mock("expo-screen-capture", () => ({ usePreventScreenCapture: jest.fn(), preventScreenCaptureAsync: jest.fn(), allowScreenCaptureAsync: jest.fn() }), { virtual: true });
jest.mock("expo-local-authentication", () => ({ hasHardwareAsync: jest.fn(async () => false), isEnrolledAsync: jest.fn(async () => false), authenticateAsync: jest.fn() }));
jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native");
  const React = require("react");
  const Picker = () => React.createElement(View, { testID: "date-picker" });
  return { __esModule: true, default: Picker, DateTimePickerAndroid: { open: jest.fn() } };
});
jest.mock("../src/lib/api", () => {
  const actual = jest.requireActual("../src/lib/api");
  return { ...actual, api: jest.fn() };
});
const apiMock = api as jest.Mock;

const v = (n: number) => ({ thumb: `https://x/${n}t.webp`, medium: `https://x/${n}m.webp`, large: `https://x/${n}l.webp` });
const card = (id: number, over: object = {}) => ({
  id, name: "Hand-woven kente stole", price_amount: "450.00", effective_price: "450.00", main_photo: "https://x/m.jpg", main_photo_variants: v(0),
  review_count: 12, avg_rating: 4.8, business_owner: { id: 2, name: "Akosua Ntoma Store", identity_verified: true }, ...over,
});
const detail = card(7, {
  description: "Woven in Bonwire.", photos: [{ id: 1, image: "https://x/1.jpg", variants: v(1) }], stock_quantity: 5,
  variants: [{ id: 1, label: "Red", price_amount: "450.00", effective_price: "450.00", stock_quantity: 3 }], has_variants: true,
  category: { id: 1, label: "Fashion", kind: "product" }, cancellation_policy: "moderate",
});
const myOrder = {
  id: 501, status: "paid", delivery_status: "processing", total_amount: "915.00", placed_at: "2026-11-06T09:30:00Z", delivery_method: "door_to_door",
  delivery_address: "12 Adum Road", delivery_gps_address: "AK-039-5028", delivery_landmark: "Blue kiosk", delivery_code: "4821", delivery_assignment_status: "delivered",
  items: [{ id: 1, listing: 7, listing_name: "Hand-woven kente stole", quantity: 2, unit_price: "450.00", line_total: "900.00" }],
};
const ownerOrder = {
  id: 501, customer_name: "Ama Owusu", status: "paid", delivery_status: "processing", placed_at: "2026-11-06T09:30:00Z", pickup_code: "4821",
  items: [{ id: 1, listing_name: "Hand-woven kente stole", quantity: 2, line_total: "900.00" }], owner_subtotal: "900.00",
};
const ownerListing = { id: 7, name: "Hand-woven kente stole", price_amount: "450.00", status: "published", stock_quantity: 5, photos: [] };
const cart = { id: 1, total: "900.00", items: [{ id: 11, listing: 7, listing_name: "Hand-woven kente stole", variant_label: "", quantity: 2, unit_price_snapshot: "450.00", line_total: "900.00", seller_name: "Akosua Ntoma Store", in_stock: true, stock_quantity: 5 }] };
const convo = { id: 9, subject: "Hand-woven kente stole", status: "open", updated_at: "2026-11-07T10:00:00Z", messages: [{ id: 1, sender_type: "customer", body: "Is it in stock?", created_at: "x" }, { id: 2, sender_type: "staff", body: "Yes.", created_at: "y" }] };

const ROUTES: Record<string, unknown> = {
  "/api/storefront/home/": { most_visited: [{ id: 1, slug: "fashion", label: "Fashion" }] },
  "/api/storefront/deals/": [card(3)],
  "/api/listings/": { results: [card(1), card(2)], next: null },
  "/api/listings/7/": detail,
  "/api/listings/sellers/2/": { id: 2, name: "Akosua Ntoma Store", since: "2026-01-15T00:00:00Z", counts: { products: 1, events: 1 } },
  "/api/events/": { results: [{ id: 9, name: "Kente Fair", event_date: "2026-12-01T10:00:00Z" }], next: null },
  "/api/events/9/": { id: 9, name: "Kente Fair", description: "Weaving.", event_date: "2026-12-01T10:00:00Z", address: "Manhyia Palace Museum", has_tickets: true },
  "/api/ledger/booking-terms/": { enabled: true, policies: { moderate: { label: "Moderate", text: "Refund up to 5 days before.", tiers: [] } } },
  "/api/bookings/availability/": { available: true, units_free: 2, nights: 1, units: 1, nightly_rate: "300.00", total_price: "300.00" },
  "/api/storefront/opening/": { server_now: "2026-11-07T10:00:00Z", gate_enabled: false, is_open: true },
  "/api/cart/": cart,
  "/api/cart/guard/": { listing: { blocked: null } },
  "/api/orders/": [myOrder],
  "/api/orders/501/": myOrder,
  "/api/orders/501/tracking/": { stage: "picked_up", rider: { first_name: "Kojo", vehicle_type: "motorbike" } },
  "/api/orders/owner/": { results: [ownerOrder], next: null },
  "/api/messaging/conversations/": [convo],
  "/api/notifications/": { unread_count: 1, results: [{ id: 1, kind: "order", title: "Order update", body: "Moved on.", is_read: false, created_at: "x" }] },
  "/api/accounts/me/": { account_type: "business_owner", id: 2, full_name: "Kwame Mensah", kyc_status: "rejected", kyc_rejection_reason: "Blurry photo.", identity_status: "rejected", identity_rejection_reason: "Name differs.", registration_step: "complete", can_buy: true },
  "/api/catalogue/stock/": { results: [{ listing_id: 7, name: "Kente stole", stock: 2, days_of_cover: "3.5", line: 5, low: true, sold_out: false }], settings: { cover_days: 7 } },
  "/api/accounts/business/hours/": { has_hours: false, days: [] },
  "/api/listings/mine/": [ownerListing, { ...ownerListing, id: 8, status: "rejected", rejection_reason: "Too dark." }, { ...ownerListing, id: 9, status: "draft" }],
  "/api/billing/plans/": [],
};

type Route = { name: string; load: () => ComponentType; params?: Record<string, string>; as?: "customer" | "business_owner"; customerFacing?: boolean };
const R = (name: string, load: () => { default: ComponentType }, extra: Partial<Route> = {}): Route => ({ name, load: () => load().default, customerFacing: true, as: "customer", ...extra });
const B = (name: string, load: () => { default: ComponentType }, extra: Partial<Route> = {}): Route => R(name, load, { as: "business_owner", customerFacing: false, ...extra });

const ALL: Route[] = [
  R("welcome", () => require("../src/app/(auth)/welcome")),
  R("customer-sign-in", () => require("../src/app/(auth)/customer-sign-in")),
  R("customer-sign-up", () => require("../src/app/(auth)/customer-sign-up")),
  R("business-sign-in", () => require("../src/app/(auth)/business-sign-in")),
  R("home", () => require("../src/app/customer/home")),
  R("explore", () => require("../src/app/customer/explore")),
  R("orders", () => require("../src/app/customer/orders")),
  R("account", () => require("../src/app/customer/account")),
  R("listing", () => require("../src/app/listing/[id]"), { params: { id: "7" } }),
  R("seller", () => require("../src/app/seller/[id]"), { params: { id: "2" } }),
  R("event", () => require("../src/app/event/[id]"), { params: { id: "9" } }),
  R("booking", () => require("../src/app/booking/[id]"), { params: { id: "7" } }),
  R("cart", () => require("../src/app/cart")),
  R("checkout", () => require("../src/app/checkout")),
  R("order-confirmed", () => require("../src/app/order-confirmed"), { params: { id: "501" } }),
  R("order", () => require("../src/app/order/[id]/index"), { params: { id: "501" } }),
  R("problem", () => require("../src/app/order/[id]/problem"), { params: { id: "501" } }),
  R("review", () => require("../src/app/review/[id]"), { params: { id: "7", name: "Kente stole" } }),
  R("support-new", () => require("../src/app/support/new"), { params: { about: "Kente stole", listing: "7" } }),
  R("support-chat", () => require("../src/app/support/[id]"), { params: { id: "9" } }),
  R("inbox", () => require("../src/app/inbox")),
  R("notifications", () => require("../src/app/notifications")),
  R("security", () => require("../src/app/security")),
  R("delete-account", () => require("../src/app/delete-account")),
  R("legal", () => require("../src/app/legal/[doc]"), { params: { doc: "privacy" } }),
  B("biz-home", () => require("../src/app/business/home")),
  B("biz-orders", () => require("../src/app/business/orders")),
  B("biz-listings", () => require("../src/app/business/listings")),
  B("biz-more", () => require("../src/app/business/more")),
  B("biz-order", () => require("../src/app/manage/order/[id]"), { params: { id: "501" } }),
  B("biz-listing", () => require("../src/app/manage/listing/[id]"), { params: { id: "7" } }),
  B("biz-listing-rejected", () => require("../src/app/manage/listing/[id]"), { params: { id: "8" } }),
  B("biz-listing-draft", () => require("../src/app/manage/listing/[id]"), { params: { id: "9" } }),
  B("biz-hours", () => require("../src/app/manage/hours")),
  B("biz-verification", () => require("../src/app/manage/verification")),
  B("submitted", () => require("../src/app/(auth)/register/submitted")),
];

type N = { type: string; props: Record<string, any>; children?: (N | string)[] | null };
function walk(node: N | string | null | undefined, visit: (n: N) => void, hidden = false) {
  if (!node || typeof node === "string") return;
  const isHidden = hidden || node.props?.accessibilityElementsHidden === true || node.props?.importantForAccessibility === "no-hide-descendants";
  if (!isHidden) visit(node);
  (node.children ?? []).forEach((c) => walk(c as N, visit, isHidden));
}
const textOf = (n: N | string | null | undefined): string => (!n ? "" : typeof n === "string" ? n : (n.children ?? []).map((c) => textOf(c as N)).join(" "));
const style = (n: N) => StyleSheet.flatten(n.props.style) ?? {};
const isPressable = (n: N) => typeof n.props.onClick === "function" || typeof n.props.onResponderRelease === "function";
const PHONE = /(\+?233[\s-]?\d{2}|\b0\d{9}\b|wa\.me|tel:)/i;

function sweep(name: string, customerFacing: boolean) {
  const offenders: string[] = [];
  const json = screen.toJSON() as unknown as N | N[];
  const roots = Array.isArray(json) ? json : [json];
  const all: string[] = [];
  roots.forEach((root) =>
    walk(root, (n) => {
      const p = n.props ?? {};
      if (isPressable(n)) {
        const label = p.accessibilityLabel || textOf(n).trim();
        if (!p.accessibilityRole && !p.role) offenders.push(`${name}: pressable without a role (${label || "no label"})`);
        if (!label) offenders.push(`${name}: pressable without a label or text`);
        const s = style(n);
        const h = s.minHeight ?? s.height;
        const w = s.minWidth ?? s.width;
        const ok = (typeof h === "number" && h >= 48) || (typeof w === "number" && w >= 48 && typeof h !== "number") || !!p.hitSlop;
        if (!ok) offenders.push(`${name}: touch target under 48 (${label}) height=${h} width=${w}`);
      }
      if (/ScrollView/.test(n.type)) {
        if (p.horizontal && p.showsHorizontalScrollIndicator !== false) offenders.push(`${name}: horizontal scrollbar visible`);
        if (!p.horizontal && p.showsVerticalScrollIndicator !== false) offenders.push(`${name}: vertical scrollbar visible`);
      }
      if (n.type === "Text" || typeof n.props?.children === "string") all.push(textOf(n));
      if (p.accessibilityLabel) all.push(String(p.accessibilityLabel));
    }),
  );
  if (customerFacing) {
    const joined = all.join(" | ");
    const m = joined.match(PHONE);
    if (m) offenders.push(`${name}: phone-like text or contact link "${m[0]}"`);
  }
  return offenders;
}

beforeEach(() => {
  jest.clearAllMocks();
  apiMock.mockImplementation(async (path: string) => {
    if (path in ROUTES) return ROUTES[path];
    if (path.startsWith("/api/payments/")) return { status: "pending" };
    return {};
  });
});

describe.each([320, 430])("every screen at %d dp wide", (width) => {
  beforeEach(() => {
    jest.spyOn(require("react-native").Dimensions, "get").mockReturnValue({ width, height: 800, scale: 2, fontScale: 1 });
    jest.spyOn(require("react-native").useWindowDimensions ? require("react-native") : {}, "useWindowDimensions").mockReturnValue({ width, height: 800, scale: 2, fontScale: 1 });
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(ALL.map((r) => [r.name, r] as const))("%s has roles, labels, 48dp targets, hidden scrollbars and no contact links", async (_n, route) => {
    mockParams = route.params ?? {};
    const Screen = route.load();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    useAuth.setState({ status: "signedIn", account: { type: route.as ?? "customer", id: 1, fullName: "Ama Owusu" } });
    await render(
      <QueryClientProvider client={qc}>
        <Screen />
      </QueryClientProvider>,
    );
    await screen.findAllByText(/./, undefined, { timeout: 3000 }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 50));
    const offenders = sweep(route.name, !!route.customerFacing);
    expect(offenders).toEqual([]);
  });
});

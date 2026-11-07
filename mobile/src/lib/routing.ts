import type { Feather } from "@expo/vector-icons";

import { stepRoute } from "./registrationApi";

type Icon = keyof typeof Feather.glyphMap;
export type Tab = { name: string; label: string; icon: Icon };
type Status = "loading" | "signedOut" | "signedIn" | "offline";
type AccountType = "customer" | "business_owner";

export const CUSTOMER_TABS: Tab[] = [
  { name: "home", label: "Home", icon: "home" },
  { name: "explore", label: "Explore", icon: "search" },
  { name: "orders", label: "Orders", icon: "shopping-bag" },
  { name: "wallet", label: "Wallet", icon: "credit-card" },
  { name: "account", label: "Account", icon: "user" },
];

export const BUSINESS_TABS: Tab[] = [
  { name: "home", label: "Home", icon: "home" },
  { name: "orders", label: "Orders", icon: "shopping-bag" },
  { name: "listings", label: "Listings", icon: "grid" },
  { name: "money", label: "Money", icon: "credit-card" },
  { name: "more", label: "More", icon: "more-horizontal" },
];

/** Where a person belongs: the welcome screen, or their own area. A business owner never enters customer screens. */
export function routeFor(
  status: Status,
  type?: AccountType,
  business?: { registrationStep?: string; kycStatus?: string },
): string {
  if (status !== "signedIn" || !type) return "/welcome";
  if (type === "customer") return "/customer/home";
  const step = business?.registrationStep;
  if (step && !(step === "complete" && business?.kycStatus === "verified")) {
    const route = stepRoute(step, business?.kycStatus);
    if (route !== "/") return route;
  }
  return "/business/home";
}

export function canEnter(area: "customer" | "business", status: Status, type?: AccountType): boolean {
  return status === "signedIn" && type === (area === "customer" ? "customer" : "business_owner");
}

/** Top-level screens that make no sense without a signed-in person (browsing stays open to guests). */
const SIGNED_IN_ONLY = new Set([
  "manage", "checkout", "bookings", "booking", "tickets", "ticket", "inbox", "notifications", "order", "order-confirmed",
  "review", "support", "security", "delete-account",
]);
/** Screens for business owners only; a customer who reaches one (a stale link, a shared URL) is sent home. */
const BUSINESS_ONLY = new Set(["manage"]);

/**
 * Where to send someone who has landed on a screen they should not be on, or null to let them stay (review MOB-12).
 * The server still enforces every permission; this keeps the screens from rendering errors for the wrong person.
 * While the session is still being read (`loading`) or the network is down (`offline`) nothing is redirected.
 */
export function guardRedirect(segments: string[], status: Status, type?: AccountType): string | null {
  const first = segments.find((s) => !s.startsWith("("));
  if (!first) return null;
  if (status === "signedOut" && SIGNED_IN_ONLY.has(first)) return "/welcome";
  if (status === "signedIn" && type === "customer" && BUSINESS_ONLY.has(first)) return "/customer/home";
  return null;
}

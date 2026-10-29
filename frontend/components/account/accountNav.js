// The Your Account hub: tile order, section titles and URL parsing. One place so the
// hub, the breadcrumb and the router all agree. Amazon's Prime, Gift cards, Family and
// Digital Services tiles are deliberately not here (AshantiHub has none of them).
export const ACCOUNT_ROOT = "/my-account";

export const ACCOUNT_TILES = [
  { id: "orders", icon: "📦", title: "Your Orders", text: "Track, review or buy again. Bookings, requests and tickets too.", path: `${ACCOUNT_ROOT}/orders` },
  { id: "security", icon: "🔒", title: "Login & security", text: "Your name, contact details, password and 2-step verification.", path: `${ACCOUNT_ROOT}/security` },
  { id: "addresses", icon: "📍", title: "Your Addresses", text: "Your GhanaPost delivery addresses.", path: `${ACCOUNT_ROOT}/addresses` },
  { id: "payments", icon: "💳", title: "Your Payments", text: "Wallet balance, top-ups, transactions and payout numbers.", path: `${ACCOUNT_ROOT}/payments/overview` },
  { id: "lists", icon: "❤️", title: "Your Lists", text: "Businesses you have saved.", path: `${ACCOUNT_ROOT}/lists` },
  { id: "help", icon: "🎧", title: "Customer Service", text: "Get help or report a problem.", path: `${ACCOUNT_ROOT}/help` },
  { id: "messages", icon: "💬", title: "Your Messages", text: "Your conversations with AshantiHub Support.", path: `${ACCOUNT_ROOT}/messages` },
  { id: "sell", icon: "🏪", title: "Sell on AshantiHub", text: "Register your business to sell here.", path: `${ACCOUNT_ROOT}/sell` },
];

export const PAYMENT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "wallet", label: "Wallet" },
  { id: "transactions", label: "Transactions" },
  { id: "settings", label: "Settings" },
];

export const ORDER_TABS = [
  { id: "orders", label: "Orders" },
  { id: "bookings", label: "Bookings" },
  { id: "requests", label: "Service requests" },
  { id: "tickets", label: "Tickets" },
  { id: "events", label: "My events" },
];

export const paymentsPath = (tab) => `${ACCOUNT_ROOT}/payments/${tab}`;

// "/my-account", "/my-account/orders", "/my-account/payments/wallet" -> { section, tab }.
// An unknown section parses as the hub (section null) so a mistyped URL never 404s.
export function parseAccountPath(pathname) {
  const parts = String(pathname || "").replace(/\/+$/, "").split("/").filter(Boolean);
  if (parts[0] !== "my-account") return { section: null, tab: null };
  const section = ACCOUNT_TILES.find((t) => t.id === parts[1])?.id ?? null;
  if (section !== "payments") return { section, tab: null };
  const tab = PAYMENT_TABS.find((t) => t.id === parts[2])?.id ?? "overview";
  return { section, tab };
}

export const isAccountPath = (pathname) => pathname === ACCOUNT_ROOT || String(pathname).startsWith(`${ACCOUNT_ROOT}/`);

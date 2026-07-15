// ─── Colors ──────────────────────────────────────────────────────────────────
// Single source of truth for the app's Ghanaian/Ashanti-themed palette.
// Exported from its own module (rather than left inline in App.jsx) so that
// extracted components under `frontend/components/` (Navbar, Hero, ...) can
// import it without creating a circular dependency with App.jsx.
export const C = {
  gold:"#D4A017", deepGold:"#B8860B", darkBrown:"#2C1810",
  lightGold:"#F5DEB3", cream:"#FDF6E3", black:"#1A1A1A",
  kente1:"#CC0000", kente2:"#006400", kente3:"#000080",
  ghRed:"#CE1126", ghGold:"#FCD116", ghGreen:"#006B3F",
  whatsapp:"#25D366", orange:"#E8621A",
  pureBlack:"#000000", white:"#ffffff",
  void:"#160E08",
};

// ─── Currency conversion ───────────────────────────────────────────────────
// All backend amounts are GHS-only (no currency field on any model) — the
// `currency` selector elsewhere in the app is a display-only client-side
// conversion applied on top of a GHS source-of-truth value. Exported from
// here (alongside `C`) for the same reason: so both App.jsx (Card's
// displayPrice) and frontend/components/* (e.g. CartDrawer) can apply the
// exact same conversion without a circular App.jsx <-> components/ import.
export const CURRENCIES = {GHS:1, USD:0.067, GBP:0.052, EUR:0.061};

// ─── Colors ──────────────────────────────────────────────────────────────────
// Single source of truth for the app's Ghanaian/Ashanti-themed palette.
// Exported from its own module (rather than left inline in App.jsx) so that
// extracted components under `frontend/components/` (Navbar, Hero, ...) can
// import it without creating a circular dependency with App.jsx.
//
// Two kinds of key live on `C`:
// - Brand colours (gold, darkBrown, cream, kente*, gh*, ...) are fixed hex
//   values that never change with the theme. Use them for brand marks, kente
//   stripes, gold buttons and text sitting ON those fixed colours. Plain hex,
//   so `${C.gold}22`-style alpha suffixes keep working.
// - Theme tokens (canvas, surface, ink, ...) follow the light/dark toggle.
//   Each is `var(--ah-*, <light value>)`; the variables are declared on
//   `:root` / `:root[data-theme="dark"]` in index.css (mirrored in
//   THEME_TOKENS below, kept in sync by __tests__/theme.test.jsx), and
//   useTheme() sets `data-theme` on <html>. Use these for every page/card/
//   modal/input surface and the text on it. They are not hex, so tint them
//   with `tint(color, "22")`, never by appending an alpha suffix.

// CSS custom-property values per theme (name without the leading `--`).
// index.css declares exactly these; theme.test.jsx fails if the two drift.
export const THEME_TOKENS = {
  light: {
    "ah-canvas": "#FDF6E3",                  // C.cream — page background
    "ah-surface": "#FFFFFF",                 // C.white — cards, modals, drawers, inputs
    "ah-surface-2": "#F5ECD8",               // recessed well (list rows, secondary buttons)
    "ah-surface-3": "#EADFC6",               // stronger well (disabled buttons, tracks)
    "ah-ink": "#2C1810",                     // C.darkBrown — body text
    "ah-ink-dim": "rgba(44, 24, 16, 0.62)",
    "ah-ink-faint": "rgba(44, 24, 16, 0.42)",
    "ah-line": "rgba(44, 24, 16, 0.12)",     // dividers, neutral input borders
    "ah-border": "rgba(212, 160, 23, 0.35)", // C.gold, low opacity — card borders
    "ah-border-strong": "rgba(212, 160, 23, 0.6)",
    "ah-shadow": "0 10px 28px rgba(44, 24, 16, 0.12)",
    "ah-price": "#2C1810",                   // DESIGN.md: prices dark brown on light
    "ah-green": "#006400",                   // C.kente2 — trust/verified/success
    "ah-red": "#CC0000",                     // C.kente1 — error/destructive
    "ah-blue": "#000080",                    // C.kente3 — info
    "ah-ok-bg": "#E3F1E3", "ah-ok-ink": "#00500A",
    "ah-err-bg": "#FDECEA", "ah-err-ink": "#A30000",
    "ah-warn-bg": "#FFF4E5", "ah-warn-ink": "#A33A00",
    "ah-header-bg": "linear-gradient(135deg, #2C1810 0%, #1A1A1A 50%, #000080 100%)",
    "ah-header-edge": "transparent",
  },
  dark: {
    "ah-canvas": "#160E08",                  // C.void
    "ah-surface": "#2C1810",                 // C.darkBrown
    "ah-surface-2": "#3D281A",               // darkBrown, lightened (index.css .dark --secondary)
    "ah-surface-3": "#4A3324",
    "ah-ink": "#F5DEB3",                     // C.lightGold
    "ah-ink-dim": "rgba(245, 222, 179, 0.72)",
    "ah-ink-faint": "rgba(245, 222, 179, 0.5)",
    "ah-line": "rgba(245, 222, 179, 0.14)",
    "ah-border": "rgba(212, 160, 23, 0.4)",
    "ah-border-strong": "rgba(212, 160, 23, 0.65)",
    "ah-shadow": "0 10px 28px rgba(0, 0, 0, 0.45)",
    "ah-price": "#F5DEB3",                   // C.lightGold — prices on dark surfaces
    "ah-green": "#2F9E2F",                   // kente green retuned for dark (index.css .dark --chart-3)
    "ah-red": "#E03A3A",                     // kente red retuned for dark (DESIGN.md)
    "ah-blue": "#9A9AFF",                    // kente navy retuned for dark (navy is unreadable on brown)
    "ah-ok-bg": "rgba(47, 158, 47, 0.18)", "ah-ok-ink": "#8FD98F",
    "ah-err-bg": "rgba(224, 58, 58, 0.18)", "ah-err-ink": "#FF9B9B",
    "ah-warn-bg": "rgba(232, 98, 26, 0.18)", "ah-warn-ink": "#FFB27A",
    "ah-header-bg": "linear-gradient(135deg, #160E08 0%, #2C1810 100%)",
    "ah-header-edge": "rgba(212, 160, 23, 0.25)",
  },
};

const token = (name) => `var(--${name}, ${THEME_TOKENS.light[name]})`;

export const C = {
  // brand colours — fixed in both themes
  gold:"#D4A017", deepGold:"#B8860B", darkBrown:"#2C1810",
  lightGold:"#F5DEB3", cream:"#FDF6E3", black:"#1A1A1A",
  kente1:"#CC0000", kente2:"#006400", kente3:"#000080",
  ghRed:"#CE1126", ghGold:"#FCD116", ghGreen:"#006B3F",
  whatsapp:"#25D366", orange:"#E8621A",
  pureBlack:"#000000", white:"#ffffff",
  void:"#160E08",
  // Always white in both themes: QR codes (scanners need dark-on-white) and
  // the frame behind product photos/logos that have their own white ground.
  paper:"#FFFFFF",
  // theme tokens — follow the light/dark toggle
  canvas: token("ah-canvas"),
  surface: token("ah-surface"),
  surface2: token("ah-surface-2"),
  surface3: token("ah-surface-3"),
  ink: token("ah-ink"),
  inkDim: token("ah-ink-dim"),
  inkFaint: token("ah-ink-faint"),
  line: token("ah-line"),
  border: token("ah-border"),
  borderStrong: token("ah-border-strong"),
  shadow: token("ah-shadow"),
  price: token("ah-price"),
  trust: token("ah-green"),
  danger: token("ah-red"),
  info: token("ah-blue"),
  okBg: token("ah-ok-bg"), okInk: token("ah-ok-ink"),
  errBg: token("ah-err-bg"), errInk: token("ah-err-ink"),
  warnBg: token("ah-warn-bg"), warnInk: token("ah-warn-ink"),
};

// Translucent version of a colour. A plain 6-digit hex keeps the old
// `${hex}${alpha}` form; a theme token (a var()) is mixed with transparent,
// since a hex alpha suffix after `var(...)` is invalid CSS.
const HEX6 = /^#[0-9a-f]{6}$/i;
export function tint(color, alpha) {
  if (HEX6.test(color)) return `${color}${alpha}`;
  const pct = Math.round((parseInt(alpha, 16) / 255) * 1000) / 10;
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
}

// ─── Currency conversion ───────────────────────────────────────────────────
// All backend amounts are GHS-only (no currency field on any model) — the
// `currency` selector elsewhere in the app is a display-only client-side
// conversion applied on top of a GHS source-of-truth value. Exported from
// here (alongside `C`) for the same reason: so both App.jsx (Card's
// displayPrice) and frontend/components/* (e.g. CartDrawer) can apply the
// exact same conversion without a circular App.jsx <-> components/ import.
export const CURRENCIES = {GHS:1, USD:0.067, GBP:0.052, EUR:0.061};

// ─── Shared <option> styling ─────────────────────────────────────────────────
// <option> elements don't reliably inherit a usable color/background pair
// from a translucent dark-styled <select> (the convention used by
// EventSubmissionPanel/EventTicketTypesPanel): most browsers render
// the popup list on their own (usually white) surface while the options
// inherit the select's white text — i.e. white-on-white, unreadable. Every
// <option> under one of those dark selects sets this explicitly so the popup
// list is always dark-on-light. Lives here (not in any one component) for the
// same anti-circular-import reason as C/CURRENCIES above — e.g.
// EventSubmissionPanel already imports EventTicketTypesPanel, so neither can
// own a constant the other needs.
export const optionStyle = { color: C.ink, background: C.surface };

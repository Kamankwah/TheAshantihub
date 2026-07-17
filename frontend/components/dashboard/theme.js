// ─── Business Command Center — light "artisan" theme ──────────────────────────
// Rebuilt from the dark "mission-control" glass theme onto a light theme
// sourced from the app's own `C` palette (frontend/theme.js) — C.cream/C.gold/
// C.deepGold/C.darkBrown/C.orange/C.kente1/C.kente2/C.kente3 map closely onto
// a warm cream+gold+earth-tone look, so this stays a "reuse my tokens" theme
// rather than a hardcoded new palette. The one genuine gap is a purple accent
// (used only for chart/usage-meter variety) — C has no purple, so a single new
// hex is introduced for it below, called out where it's defined.
// The shell root is <div className="shadcn-scope command-center"> (see
// frontend/index.css), which also feeds recharts its --chart-* / --primary
// tokens; these `D` values are the inline-style counterpart for the
// hand-styled panels, kept visually in step with that scope by hand (same
// "keep in sync by hand" caveat index.css notes for its own tokens vs `C`).
//
// NOTE: gold/deepGold/green/red/amber/blue/purple below are kept as PLAIN hex
// strings (not rgba()) because many call sites append a hex alpha suffix
// directly, e.g. `${D.green}22` for a translucent badge background — that
// pattern only works with a bare 6-digit hex.
import { C } from "../../theme.js";

export const D = {
  // cream page + white raised card surfaces
  pageBg: C.cream,            // #FDF6E3
  panelBg: "#FFFFFF",         // card fill
  panelSolid: "#FFFFFF",      // solid fill for chart tooltips etc.
  panelBg2: "#F5ECD8",        // recessed inner well (inputs, list rows) — a shade darker than pageBg
  cardBorder: "rgba(212,160,23,0.35)", // C.gold, low opacity
  cardBorderStrong: "rgba(212,160,23,0.6)",
  divider: "rgba(44,24,16,0.12)",      // C.darkBrown, low opacity
  // text
  text: C.darkBrown,          // #2C1810
  textDim: "rgba(44,24,16,0.62)",
  textFaint: "rgba(44,24,16,0.42)",
  // accents (gold primary + kente/status hues, retuned for legibility on cream)
  gold: C.gold,            // #D4A017
  goldSoft: "rgba(212,160,23,0.14)",
  deepGold: C.deepGold,    // #B8860B
  green: C.kente2,   // #006400
  amber: C.orange,   // #E8621A
  red: C.kente1,     // #CC0000
  blue: C.kente3,    // #000080
  purple: "#6B4E8E", // new — no purple exists in C; used only for chart/usage-meter variety
  kente1: C.kente1, kente2: C.kente2, kente3: C.kente3,
  whatsapp: C.whatsapp,
  // effects
  glow: "0 0 20px rgba(212,160,23,0.25)",
  shadow: "0 10px 28px rgba(44,24,16,0.12)",
};

// The five recharts series colors, read straight from the .command-center CSS
// scope so charts and the token system stay in step. Charts pass these as
// literal fills/strokes where a CSS var can't be used (e.g. gradient stops need
// a resolved color in some recharts versions); the values mirror index.css's
// .command-center --chart-1..5.
export const CHART = {
  c1: D.gold, c2: D.green, c3: D.blue, c4: D.purple, c5: D.amber,
  grid: "rgba(44,24,16,0.10)",
  axis: "rgba(44,24,16,0.55)",
};

// Reusable light card base style for panels — a bordered white card + soft
// warm shadow instead of the old dark-glass blur (no backdropFilter needed
// against a solid cream page background).
export const glassCard = {
  background: D.panelBg,
  border: `1px solid ${D.cardBorder}`,
  borderRadius: 16,
  boxShadow: D.shadow,
};

export const sectionTitle = {
  fontWeight: 800,
  color: D.text,
  fontSize: "0.92rem",
  margin: 0,
  letterSpacing: "0.01em",
};

// ─── Shared credit helpers/constants (moved out of App.jsx) ───────────────────
// Used by both CreditPanel and the Analytics panel's credit gauge, so they live
// here rather than in either panel. The score→color/grade/max-loan maps are the
// same client-side illustrative mappings the old CreditDashboard used
// (backend/credit/scoring.py's stub returns score/grade/factors, not a color or
// max-loan figure).
export function getScoreColor(score) {
  if (score >= 800) return D.green;
  if (score >= 700) return D.kente2;
  if (score >= 600) return D.gold;
  if (score >= 500) return D.amber;
  return D.red;
}

export function getScoreGrade(score) {
  if (score >= 850) return { grade: "A+", label: "Exceptional", color: D.green };
  if (score >= 800) return { grade: "A", label: "Excellent", color: D.green };
  if (score >= 750) return { grade: "A-", label: "Very Good", color: D.green };
  if (score >= 700) return { grade: "B+", label: "Good", color: D.kente2 };
  if (score >= 650) return { grade: "B", label: "Above Average", color: D.kente2 };
  if (score >= 600) return { grade: "B-", label: "Average", color: D.gold };
  if (score >= 550) return { grade: "C+", label: "Below Average", color: D.amber };
  if (score >= 500) return { grade: "C", label: "Poor", color: D.amber };
  return { grade: "D", label: "Very Poor", color: D.red };
}

export function maxLoanForScore(score) {
  if (score >= 800) return 50000;
  if (score >= 700) return 25000;
  if (score >= 600) return 10000;
  if (score >= 500) return 5000;
  return 0;
}

// Labels/icons for the real factor keys returned by GET /api/credit/scores/me/.
export const CREDIT_FACTOR_META = {
  listings_published: { icon: "🏷️", label: "Published Listings", desc: "Number of your listings that are live on AshantiHub (up to 10 counted)" },
  account_tenure_months: { icon: "📅", label: "Account Tenure", desc: "How long your business has been on AshantiHub (up to 24 months counted)" },
  kyc_verified: { icon: "🪪", label: "KYC Verified", desc: "Whether your Ghana Card / business KYC has been verified by AshantiHub staff" },
  payout_verified: { icon: "🏦", label: "Payout Details Verified", desc: "Whether your MoMo/bank payout details have been verified" },
};

// (LENDING_PARTNERS lived here as a hardcoded directory until item 16 moved it
// into a real backend model. Partners now come from GET /api/credit/partners/
// via useLendingPartners — seeded from these same six rows in
// credit/migrations/0003_seed_lending_partners.py — so both the business
// CreditPanel and the staff Credit panel share one source of truth.)

// Listing / hero status → label+color, retuned for legibility on cream (draft's
// muted warm-gray has no C equivalent — the one other new hex in this file).
export const LISTING_STATUS_META = {
  draft: { label: "Draft", color: "#8A7A6B" },
  pending_review: { label: "Pending Review", color: D.amber },
  published: { label: "Published", color: D.green },
  rejected: { label: "Rejected", color: D.red },
};

export const HERO_STATUS_META = {
  pending: { label: "Pending Review", color: D.amber },
  approved: { label: "Live", color: D.green },
  rejected: { label: "Rejected", color: D.red },
};

// GHS money formatter used across panels/charts.
export const ghs = (n) => `GHS ${Number(n || 0).toLocaleString("en-GH", { maximumFractionDigits: 0 })}`;

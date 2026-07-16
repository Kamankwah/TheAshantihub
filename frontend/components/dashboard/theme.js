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

// AshantiHub-verified lending partners directory (frontend-only; no backend
// model — see the note this carried in App.jsx). Matched against the owner's
// real score by minScore.
export const LENDING_PARTNERS = [
  { id: 1, name: "Fidelity Bank Ghana", type: "Bank", logo: "🏦", minScore: 600, maxLoan: "GHS 50,000", rate: "18–24% p.a.", turnaround: "3–5 days", focus: "SME Business Loans", contact: "0302 214 460", color: "#3a7afe" },
  { id: 2, name: "Sinapi Aba Savings & Loans", type: "Microfinance", logo: "🌱", minScore: 400, maxLoan: "GHS 10,000", rate: "24–36% p.a.", turnaround: "1–2 days", focus: "Micro & Small Business", contact: "0322 495 822", color: "#34d399" },
  { id: 3, name: "Opportunity International Ghana", type: "NGO Lender", logo: "🤝", minScore: 350, maxLoan: "GHS 5,000", rate: "20–28% p.a.", turnaround: "2–3 days", focus: "Women & Youth Businesses", contact: "0302 785 960", color: "#fb923c" },
  { id: 4, name: "ARB Apex Bank", type: "Bank", logo: "🏛️", minScore: 500, maxLoan: "GHS 25,000", rate: "20–26% p.a.", turnaround: "3–7 days", focus: "Rural & Informal Business", contact: "0322 022 328", color: "#f472b6" },
  { id: 5, name: "Absa Ghana SME", type: "Bank", logo: "🔴", minScore: 650, maxLoan: "GHS 100,000", rate: "16–22% p.a.", turnaround: "5–7 days", focus: "Established Businesses", contact: "0302 429 150", color: "#f87171" },
  { id: 6, name: "Ghana Enterprise Agency", type: "Government Grant", logo: "🇬🇭", minScore: 300, maxLoan: "GHS 20,000", rate: "0% (Grant)", turnaround: "2–4 weeks", focus: "SME Development Grants", contact: "0302 685 132", color: "#34d399" },
];

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

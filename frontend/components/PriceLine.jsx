import { C, CURRENCIES } from "../theme.js";

// A listing's price, by the Deals rule (DealsRow): the price shown is
// `effective_price` (the sale price while it is a real discount, else the
// regular price), falling back to `price_amount` for a row without it. Only
// `was_price` is ever struck through — sent by the server only when the
// listing really held it for the previous 7 days — and the regular
// `price_amount` is never struck through. Money is plain text with tabular
// figures and no decoration (DESIGN.md): dark brown on a light surface, the
// dark-mode text colour (light gold) on the legacy dark surfaces. `currency`
// A listing with options (variants) shows the lowest option's price, so it reads "From". `currency`
// is the display-only conversion the marketplace Card offers (GHS source).
const TABULAR = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum" 1' };

export function listingPriceAmounts(item) {
  const current = item?.effective_price ?? item?.price_amount ?? null;
  return { current, was: item?.was_price ?? null };
}

function format(amount, currency, unit) {
  if (amount == null || amount === "") return null;
  if (!currency || currency === "GHS") return `GHS ${amount}${unit || ""}`;
  const rate = CURRENCIES[currency];
  return `${currency} ${((parseFloat(amount) || 0) * rate).toFixed(0)}${unit || ""}`;
}

export default function PriceLine({ item, currency = "GHS", tone = "light", size = "1rem", style }) {
  const { current, was } = listingPriceAmounts(item);
  const now = format(current, currency, item?.price_unit);
  if (!now) return null;
  const then = format(was, currency, null);
  const color = tone === "dark" ? C.lightGold : C.darkBrown;
  return (
    <span data-testid="price-line" style={{ display: "inline-flex", alignItems: "baseline", flexWrap: "wrap", gap: "0 8px", ...style }}>
      {item?.has_variants && <span style={{ fontWeight: 600, color, fontSize: `calc(${size} * 0.75)`, opacity: 0.8 }}>From</span>}
      <span style={{ fontWeight: 800, color, fontSize: size, ...TABULAR }}>{now}</span>
      {then && (
        <s style={{ fontSize: `calc(${size} * 0.8)`, color, opacity: 0.7, ...TABULAR }}>
          <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>Was </span>{then}
        </s>
      )}
    </span>
  );
}

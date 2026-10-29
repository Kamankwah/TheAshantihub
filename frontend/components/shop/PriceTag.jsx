import { C } from "../../theme.js";
import { convertAmount } from "../PriceLine.jsx";

const TABULAR = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum" 1' };
const SR_ONLY = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" };

// The code, whole part and (for GHS) pesewas of a money string, via PriceLine's one converter.
function parts(amount, currency) {
  const shown = convertAmount(amount, currency);
  if (shown == null) return null;
  const [whole, fraction] = shown.split(".");
  return { code: currency || "GHS", whole, fraction: fraction ?? null, text: `${currency || "GHS"} ${shown}` };
}

// A price as the product page and cart rows show it: "GHS" small, the whole part large, pesewas as a superscript, in the
// price colour with tabular figures (DESIGN.md: money is never gold). `price` is the server's effective_price. A
// struck-through "was" price and "-NN%" appear only when the server sent `wasPrice` (its 7-day rule). Display-only
// conversion for other currencies, exactly as PriceLine does it. A screen reader gets the full amount as plain text.
export default function PriceTag({ price, wasPrice = null, discountPercent = null, currency = "GHS", size = "1.6rem", style }) {
  const now = parts(price, currency);
  if (!now) return null;
  const was = wasPrice != null && wasPrice !== "" ? parts(wasPrice, currency) : null;
  return (
    <span data-testid="price-tag" style={{ display: "inline-flex", alignItems: "baseline", flexWrap: "wrap", gap: "0 8px", color: C.price, ...TABULAR, ...style }}>
      <span style={SR_ONLY}>{now.text}</span>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}>
        <span style={{ fontSize: `calc(${size} * 0.45)`, fontWeight: 700 }}>{now.code}</span>
        <span style={{ fontSize: size, fontWeight: 800, lineHeight: 1 }}>{now.whole}</span>
        {now.fraction != null && <sup style={{ fontSize: `calc(${size} * 0.45)`, fontWeight: 700, lineHeight: 1 }}>{now.fraction}</sup>}
      </span>
      {was && (
        <>
          <span style={SR_ONLY}>{`Was ${was.text}`}</span>
          <s aria-hidden="true" style={{ fontSize: `calc(${size} * 0.5)`, color: C.inkDim }}>{was.text}</s>
          {discountPercent != null && (
            <span style={{ fontSize: `calc(${size} * 0.5)`, fontWeight: 800, color: C.trust }}>{`-${discountPercent}%`}</span>
          )}
        </>
      )}
    </span>
  );
}

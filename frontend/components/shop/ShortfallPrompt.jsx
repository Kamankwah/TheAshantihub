import { C } from "../../theme.js";
import { useOtherSellers } from "../../hooks/useOtherSellers.js";

// Beside a low or out-of-stock line: "{k} other seller(s) offer this product." with a jump to the Other sellers
// section. Nothing unless the server lists other offers (an ungrouped listing, an error or a 404 render nothing).
export default function ShortfallPrompt({ listingId }) {
  const { data } = useOtherSellers(listingId);
  const k = Array.isArray(data?.offers) ? data.offers.length : 0;
  if (!k) return null;
  return (
    <div style={{ marginTop: 6, fontSize: "0.8rem", color: C.inkDim, lineHeight: 1.5 }}>
      {k} other {k === 1 ? "seller offers" : "sellers offer"} this product.{" "}
      <button
        type="button"
        onClick={() => document.getElementById("other-sellers")?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
        style={{ background: "none", border: "none", padding: 0, color: C.info, fontWeight: 700, fontSize: "0.8rem", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}
      >See other sellers</button>
    </div>
  );
}

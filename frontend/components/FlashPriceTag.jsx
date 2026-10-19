import { C } from "../theme.js";
import { flashFor, usePublicPromos } from "../hooks/usePublicPromos.js";
import PromoCountdown from "./PromoCountdown.jsx";

// Shown on a listing card or page only while the owner's checkout switch is on and an agreed flash
// sale includes this listing. The price stays plain dark text (DESIGN.md: never gold). Nothing is
// rendered otherwise, so with the switch off the listing looks exactly as before.
export default function FlashPriceTag({ listingId }) {
  const { data } = usePublicPromos();
  const hit = flashFor(data, listingId);
  if (!hit) return null;
  const { sale, row } = hit;
  return (
    <div data-testid="flash-price" style={{ background: C.surface, color: C.ink, borderRadius: 10, padding: "6px 10px", margin: "0 0 8px", fontSize: "0.72rem", lineHeight: 1.5 }}>
      <div style={{ fontWeight: 800 }}>{sale.name} · {sale.discount_pct}% off</div>
      {sale.sold_out ? (
        <div>Sold out at the sale price. Normal price GHS {row.normal_price}.</div>
      ) : (
        <>
          <div><strong>GHS {row.sale_price}</strong> <s style={{ color: C.inkDim }}>GHS {row.normal_price}</s> <span>(sale price is applied at checkout; up to {sale.per_customer_limit} per customer, no coupons on sale items)</span></div>
          <PromoCountdown startsAt={sale.starts_at} endsAt={sale.ends_at} compact />
        </>
      )}
    </div>
  );
}

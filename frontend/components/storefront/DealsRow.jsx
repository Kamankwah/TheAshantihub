import { C } from "../../theme.js";
import { D } from "../dashboard/theme.js";
import { cedis, useDeals } from "../../hooks/useStorefront.js";
import { BODY_FONT, SECTION, SECTION_TITLE, TABULAR } from "./storefrontType.js";

// Today's deals: a horizontally scrolling row of product cards from
// GET /api/storefront/deals/. The price shown is the sale price when there is
// one (else the regular price, for a sponsored product with no sale). The
// struck-through "was" price appears only when the server sends `was_price`
// — the listing really held it for the previous 7 days — and the regular
// `price_amount` is never struck through. The "% off" badge needs
// `discount_percent`. A sponsored product says "Sponsored" in plain neutral
// text: advertising never borrows the verified look (green) or the brand gold.
// Prices are dark brown, tabular, undecorated. Hidden when empty or failing.
export default function DealsRow({ onOpen }) {
  const { data, isError } = useDeals();
  const rows = !isError && Array.isArray(data) ? data : [];
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="ah-deals-title" style={{ ...SECTION, paddingTop: 28 }}>
      <h2 id="ah-deals-title" style={SECTION_TITLE}>Today's deals</h2>
      <ul className="ah-deals-row" style={{ listStyle: "none", margin: 0, padding: "2px 2px 12px", display: "flex", gap: 12, overflowX: "auto", scrollSnapType: "x mandatory", WebkitOverflowScrolling: "touch" }}>
        {rows.map((row) => {
          const price = cedis(row.sale_price ?? row.price_amount);
          const was = cedis(row.was_price);
          return (
            <li key={row.id} data-deal={row.id} style={{ flex: "0 0 auto", width: 176, scrollSnapAlign: "start" }}>
              <button
                type="button"
                onClick={() => onOpen(row.id)}
                style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", padding: 0, border: `1px solid ${C.gold}33`, borderRadius: 16, overflow: "hidden", background: C.white, color: C.darkBrown, textAlign: "left", cursor: "pointer", fontFamily: BODY_FONT, boxShadow: "0 4px 14px rgba(44,24,16,0.08)" }}
              >
                {row.photo
                  ? <img src={row.photo} alt="" style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block" }} />
                  : <span aria-hidden="true" style={{ display: "block", width: "100%", aspectRatio: "1 / 1", background: D.panelBg2 }} />}
                <span style={{ display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px 12px" }}>
                  {row.discount_percent ? (
                    <span style={{ alignSelf: "flex-start", padding: "2px 8px", borderRadius: 999, background: C.darkBrown, color: C.white, fontSize: 12, fontWeight: 700, ...TABULAR }}>
                      {`${row.discount_percent}% off`}
                    </span>
                  ) : null}
                  <span style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "0 8px" }}>
                    {price && <span style={{ fontSize: 17, fontWeight: 700, color: C.darkBrown, ...TABULAR }}>{price}</span>}
                    {was && (
                      <s style={{ fontSize: 13, color: "rgba(44,24,16,0.62)", ...TABULAR }}>
                        <span className="ah-sr-only">Was </span>{was}
                      </s>
                    )}
                  </span>
                  <span style={{ fontSize: 14, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{row.name}</span>
                  {row.sponsored && <span style={{ fontSize: 12, color: "rgba(44,24,16,0.62)" }}>Sponsored</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <style>{`.ah-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }`}</style>
    </section>
  );
}

import { useListings } from "../../hooks/useListings.js";
import useBreakpoint from "../../hooks/useBreakpoint.js";
import { C } from "../../theme.js";
import { ProductTile } from "../shop/ProductCarousel.jsx";
import { BODY_FONT, HEADING_FONT, SECTION } from "./storefrontType.js";

const FILTERS = { kind: "product", ordering: "-created_at" };
const COLUMNS = { phone: 2, tablet: 4, desktop: 6 };

// New arrivals: the newest published products from GET /api/listings/ (goods
// only, newest first, first page), laid out as a wrapping grid of at least two
// rows (no scroll strip, so no scroll bar). Services, stays and events have
// their own pages. Hidden when there are none or the request fails, so an empty
// marketplace shows no placeholder tiles.
export default function NewArrivalsRow({ onOpen }) {
  const { data, isError } = useListings(FILTERS);
  const breakpoint = useBreakpoint();
  const columns = COLUMNS[breakpoint] ?? COLUMNS.desktop;
  const rows = breakpoint === "phone" ? 3 : 2;
  const items = !isError && data?.pages?.[0]?.results ? data.pages[0].results.slice(0, columns * rows) : [];
  if (items.length === 0) return null;
  return (
    <div style={{ ...SECTION, paddingTop: 28 }}>
      <section aria-label="New arrivals" style={{ margin: "4px 0 28px", fontFamily: BODY_FONT, color: C.ink, minWidth: 0 }}>
        <h2 style={{ margin: "0 0 12px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.3rem", lineHeight: 1.15, letterSpacing: "-0.02em", color: C.ink }}>New arrivals</h2>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: "20px 14px" }}>
          {items.map((item) => (
            <li key={item.id} style={{ minWidth: 0 }}>
              <ProductTile item={item} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

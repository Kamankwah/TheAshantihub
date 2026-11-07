import { C } from "../../theme.js";
import { categoryPath, sendCategoryVisit } from "../../hooks/useCategoryTree.js";
import { useListings } from "../../hooks/useListings.js";
import useBreakpoint from "../../hooks/useBreakpoint.js";
import { useHomeFeed } from "../../hooks/useStorefront.js";
import { ProductTile } from "../shop/ProductCarousel.jsx";
import { BODY_FONT, SECTION, VISUALLY_HIDDEN } from "./storefrontType.js";

// A shelf of newest products for each department, each with a "See all" link to that department's browse page:
// "Electronics ........ See all", then one row of products. Departments come from the home feed (those with
// something live in them); each shelf asks for its own products (GET /api/listings/?kind=product&category=<slug>),
// so a shelf that has none, or fails, renders nothing and the page never shows an empty row.
const MAX_SHELVES = 6;
const COLUMNS = { phone: 2, tablet: 4, desktop: 6 };

function Shelf({ department, onNavigate, onOpen }) {
  const { data, isError } = useListings({ kind: "product", category: department.slug, ordering: "-created_at" });
  const breakpoint = useBreakpoint();
  const columns = COLUMNS[breakpoint] ?? COLUMNS.desktop;
  const items = !isError && data?.pages?.[0]?.results ? data.pages[0].results.slice(0, columns) : [];
  if (items.length === 0) return null;
  const seeAll = () => {
    sendCategoryVisit(department.id);
    onNavigate(categoryPath({ ...department, kind: "product" }));
  };
  return (
    <section aria-label={department.label} style={{ margin: "0 0 28px", color: C.ink, fontFamily: BODY_FONT, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, margin: "0 0 8px" }}>
        <h2 style={VISUALLY_HIDDEN}>{department.label}</h2>
        <button type="button" onClick={seeAll} aria-label={`See all ${department.label}`} style={{ border: "none", background: "none", padding: "0 4px", minHeight: 44, color: C.ink, fontSize: 13, fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer", fontFamily: BODY_FONT, whiteSpace: "nowrap" }}>See all</button>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: "20px 14px" }}>
        {items.map((item) => (
          <li key={item.id} style={{ minWidth: 0 }}>
            <ProductTile item={item} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DepartmentShelves({ onNavigate, onOpen }) {
  const { data, isError } = useHomeFeed();
  const departments = !isError && Array.isArray(data?.most_visited) ? data.most_visited.slice(0, MAX_SHELVES) : [];
  if (departments.length === 0) return null;
  return (
    <div style={{ ...SECTION, paddingTop: 28 }}>
      {departments.map((department) => <Shelf key={department.id} department={department} onNavigate={onNavigate} onOpen={onOpen} />)}
    </div>
  );
}

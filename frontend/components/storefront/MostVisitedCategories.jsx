import { C } from "../../theme.js";
import { D } from "../dashboard/theme.js";
import { categoryPath, sendCategoryVisit } from "../../hooks/useCategoryTree.js";
import { useHomeFeed } from "../../hooks/useStorefront.js";
import { BODY_FONT, SECTION, SECTION_TITLE } from "./storefrontType.js";

// Most visited categories: square tiles (icon + label) for the departments in
// GET /api/storefront/home/ `most_visited` — ranked by the last 30 days of
// visits, in seed order until there is enough data, and only departments that
// have something in them (the server filters). A click counts one visit (the
// beacon) and opens the department. Hidden when the feed is empty or failing.
// The heading says "Most visited categories" only when the feed reports
// `ranked: true` (the order really comes from visits); on the seed-order
// fallback it says "Shop by department", so nothing claims a ranking it lacks.
export default function MostVisitedCategories({ onNavigate }) {
  const { data, isError } = useHomeFeed();
  const rows = !isError && Array.isArray(data?.most_visited) ? data.most_visited : [];
  if (rows.length === 0) return null;

  const open = (row) => {
    sendCategoryVisit(row.id);
    onNavigate(categoryPath({ ...row, kind: "product" }));
  };

  return (
    <section aria-labelledby="ah-visited-title" style={{ ...SECTION, paddingTop: 28 }}>
      <h2 id="ah-visited-title" style={SECTION_TITLE}>{data?.ranked === true ? "Most visited categories" : "Shop by department"}</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => open(row)}
              className="ah-visited-tile"
              style={{ display: "flex", flexDirection: "column", width: "100%", aspectRatio: "1 / 1", padding: 12, gap: 10, border: `1px solid ${C.gold}33`, borderRadius: 16, background: C.surface, color: C.ink, cursor: "pointer", fontFamily: BODY_FONT, textAlign: "left", boxSizing: "border-box", boxShadow: "0 4px 14px rgba(44,24,16,0.08)", transition: "box-shadow 150ms ease-out" }}
            >
              <span aria-hidden="true" style={{ flex: 1, width: "100%", borderRadius: 12, background: D.panelBg2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "clamp(2rem, 9vw, 3rem)" }}>
                {row.icon}
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.25 }}>{row.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <style>{`.ah-visited-tile:hover { box-shadow: 0 16px 36px rgba(44,24,16,0.16) !important; }
        @media (prefers-reduced-motion: reduce) { .ah-visited-tile { transition: none !important; } }`}</style>
    </section>
  );
}

import { C, tint } from "../../theme.js";
import { categoryPath, sendCategoryVisit } from "../../hooks/useCategoryTree.js";
import { useHomeFeed } from "../../hooks/useStorefront.js";
import { pictureProps } from "../../lib/pictureSrc.js";
import { BODY_FONT, HEADING_FONT, SECTION, SECTION_TITLE } from "./storefrontType.js";

// "Shop by category" (headed "Most visited categories" only when the feed reports `ranked: true`, so nothing claims
// a ranking it lacks): one card per department from GET /api/storefront/home/ `most_visited`, laid out the way
// Amazon's home does it — the department's name with a "See all" link, then up to four of its sub-categories as
// picture tiles. Pictures are the ones Marketing, Operations and Super Admin upload; a category without one shows
// its icon on a wash of its own colour, so a half-pictured catalogue still reads as complete. A department with no
// open sub-category shows itself as one large tile. A click counts one visit (the beacon). Only departments with something live in them are sent, so no
// card opens an empty page. Hidden when the feed is empty or failing.
function Tile({ node, big, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(node)}
      className="ah-dept-tile"
      style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", padding: 0, border: "none", background: "none", textAlign: "left", cursor: "pointer", color: C.ink, fontFamily: BODY_FONT, minWidth: 0 }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", aspectRatio: big ? "16 / 10" : "1 / 1", borderRadius: 12, overflow: "hidden", background: tint(node.color || C.gold, "26"), fontSize: big ? "3rem" : "2rem" }}>
        {node.image
          ? <img {...pictureProps(node, big ? "(max-width: 600px) 80vw, 260px" : "(max-width: 600px) 40vw, 120px")} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <span aria-hidden="true">{node.icon}</span>}
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{node.label}</span>
    </button>
  );
}

export default function DepartmentShowcase({ onNavigate }) {
  const { data, isError } = useHomeFeed();
  const rows = !isError && Array.isArray(data?.most_visited) ? data.most_visited : [];
  if (rows.length === 0) return null;

  const open = (node) => {
    sendCategoryVisit(node.id);
    onNavigate(categoryPath({ ...node, kind: "product" }));
  };

  return (
    <section aria-labelledby="ah-showcase-title" style={{ ...SECTION, paddingTop: 28 }}>
      <h2 id="ah-showcase-title" style={SECTION_TITLE}>{data?.ranked === true ? "Most visited categories" : "Shop by category"}</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))", gap: 16 }}>
        {rows.map((row) => {
          const tiles = Array.isArray(row.children) ? row.children : [];
          return (
            <li key={row.id} style={{ minWidth: 0 }}>
              <article aria-label={row.label} className="ah-dept-card" style={{ height: "100%", boxSizing: "border-box", background: C.surface, border: `1px solid ${C.gold}33`, borderTop: `4px solid ${row.color || C.gold}`, borderRadius: 16, padding: 16, boxShadow: "0 4px 14px rgba(44,24,16,0.08)", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <h3 style={{ margin: 0, fontFamily: HEADING_FONT, fontWeight: 600, fontSize: 19, lineHeight: 1.2, letterSpacing: "-0.02em", color: C.ink }}>{row.label}</h3>
                  <button type="button" onClick={() => open(row)} aria-label={`See all ${row.label}`} style={{ border: "none", background: "none", padding: 0, color: C.ink, fontSize: 13, fontWeight: 700, textDecoration: "underline", textUnderlineOffset: 3, cursor: "pointer", fontFamily: BODY_FONT, whiteSpace: "nowrap" }}>See all</button>
                </div>
                {tiles.length > 0 ? (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                    {tiles.map((tile) => <Tile key={tile.id} node={{ ...tile, color: row.color }} onOpen={(node) => { sendCategoryVisit(row.id); onNavigate(categoryPath({ ...node, kind: "product" })); }} />)}
                  </div>
                ) : <Tile node={row} big onOpen={open} />}
              </article>
            </li>
          );
        })}
      </ul>
      <style>{`.ah-dept-card:hover { box-shadow: 0 16px 36px rgba(44,24,16,0.16) !important; }
        .ah-dept-card { transition: box-shadow 150ms ease-out; }
        .ah-dept-tile:focus-visible { outline: 2px solid ${C.gold}; outline-offset: 2px; border-radius: 12px; }
        @media (prefers-reduced-motion: reduce) { .ah-dept-card { transition: none !important; } }`}</style>
    </section>
  );
}

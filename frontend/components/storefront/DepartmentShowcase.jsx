import { C } from "../../theme.js";
import { categoryPath, sendCategoryVisit } from "../../hooks/useCategoryTree.js";
import { useHomeFeed } from "../../hooks/useStorefront.js";
import { pictureProps } from "../../lib/pictureSrc.js";
import { BODY_FONT, HEADING_FONT, SECTION } from "./storefrontType.js";

// The department tiles on the home: one picture tile per department from GET /api/storefront/home/ `most_visited`,
// with no heading above them. The picture is the one Marketing, Operations and Super Admin upload; a department
// without one shows its icon on its own colour. Each tile is the full picture with the department name written over it. A department shows when something is live in it or when
// staff gave it a picture. A click counts one visit (the beacon) and opens the department. Hidden when the feed is
// empty or failing.
function Tile({ node, onOpen }) {
  const colour = node.color || C.gold;
  return (
    <button
      type="button"
      onClick={() => onOpen(node)}
      className="ah-dept-tile"
      style={{ position: "relative", display: "block", width: "100%", aspectRatio: "4 / 5", padding: 0, border: "none", borderRadius: 16, overflow: "hidden", background: `linear-gradient(rgba(0,0,0,0.28), rgba(0,0,0,0.28)), ${colour}`, textAlign: "left", cursor: "pointer", color: C.white, fontFamily: BODY_FONT, minWidth: 0, boxShadow: "0 4px 14px rgba(44,24,16,0.12)" }}
    >
      {node.image
        ? <img {...pictureProps(node, "(max-width: 600px) 45vw, 260px")} alt="" loading="lazy" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        : <span aria-hidden="true" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "4rem", paddingBottom: 28 }}>{node.icon}</span>}
      <span style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "36px 12px 12px", background: "linear-gradient(to top, rgba(20,10,5,0.82), rgba(20,10,5,0))", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: 18, lineHeight: 1.2, letterSpacing: "-0.01em", textShadow: "0 1px 2px rgba(0,0,0,0.4)" }}>{node.label}</span>
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
    <section aria-label="Departments" style={{ ...SECTION, paddingTop: 28 }}>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(170px, 44%), 1fr))", gap: 16 }}>
        {rows.map((row) => <li key={row.id} style={{ minWidth: 0 }}><Tile node={row} onOpen={open} /></li>)}
      </ul>
      <style>{`.ah-dept-tile { transition: box-shadow 150ms ease-out, transform 150ms ease-out; }
        .ah-dept-tile:hover { box-shadow: 0 16px 36px rgba(44,24,16,0.16) !important; transform: translateY(-2px); }
        .ah-dept-tile:focus-visible { outline: 2px solid ${C.gold}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { .ah-dept-tile { transition: none !important; transform: none !important; } }`}</style>
    </section>
  );
}

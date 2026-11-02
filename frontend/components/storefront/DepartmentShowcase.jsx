import { C, tint } from "../../theme.js";
import { categoryPath, sendCategoryVisit } from "../../hooks/useCategoryTree.js";
import { useHomeFeed } from "../../hooks/useStorefront.js";
import { pictureProps } from "../../lib/pictureSrc.js";
import { BODY_FONT, HEADING_FONT, SECTION } from "./storefrontType.js";

// The department tiles on the home: one picture tile per department from GET /api/storefront/home/ `most_visited`,
// with no heading above them. The picture is the one Marketing, Operations and Super Admin upload; a department
// without one shows its icon on a wash of its own colour. A department shows when something is live in it or when
// staff gave it a picture. A click counts one visit (the beacon) and opens the department. Hidden when the feed is
// empty or failing.
function Tile({ node, onOpen }) {
  const colour = node.color || C.gold;
  return (
    <button
      type="button"
      onClick={() => onOpen(node)}
      className="ah-dept-tile"
      style={{ display: "flex", flexDirection: "column", width: "100%", padding: 0, border: `1px solid ${colour}40`, borderBottom: `4px solid ${colour}`, borderRadius: 16, overflow: "hidden", background: C.surface, textAlign: "left", cursor: "pointer", color: C.ink, fontFamily: BODY_FONT, minWidth: 0, boxShadow: "0 4px 14px rgba(44,24,16,0.08)" }}
    >
      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", aspectRatio: "1 / 1", background: tint(colour, "26"), fontSize: "3rem", overflow: "hidden" }}>
        {node.image
          ? <img {...pictureProps(node, "(max-width: 600px) 45vw, 260px")} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <span aria-hidden="true">{node.icon}</span>}
      </span>
      <span style={{ padding: "10px 12px 12px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: 16, lineHeight: 1.25, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{node.label}</span>
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

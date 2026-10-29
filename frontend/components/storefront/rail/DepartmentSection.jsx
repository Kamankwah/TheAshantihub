import { findNodePath, departmentPatch } from "../browseRailSections.js";
import { linkButton, listReset, optionRow } from "./railStyles.js";
import { C } from "../../../theme.js";

// Amazon-style drill-down for the Department / Category section. `nodes` are
// the top-level department nodes in effect (browseRailSections.departmentNodes);
// `tree` is the whole category tree, used to find the selected slug.
//   - no category (or a slug not in the tree): the top-level list
//   - a node with children: a back link, the node (current), its children
//   - a leaf below the top level: a back link to the grandparent, the parent's
//     label, then the siblings with the leaf current
//   - a top-level leaf: "All departments" and the top-level list, it current
// Back links only set `category` (to the parent's slug, or undefined).
const ALL = "‹ All departments";

export default function DepartmentSection({ tree, nodes, filters, setFilters }) {
  if (!Array.isArray(nodes) || nodes.length === 0) return null;

  const path = findNodePath(tree, filters?.category);
  const selected = path ? path[path.length - 1] : null;
  const select = (node) => setFilters((f) => ({ ...f, ...departmentPatch(node, f) }));
  const goTo = (node) => setFilters((f) => ({ ...f, category: node ? node.slug : undefined }));

  let back = null; // { label, node }
  let heading = null; // plain parent label above the siblings
  let items = nodes;

  if (selected && selected.children?.length) {
    back = path.length > 1 ? { label: `‹ ${path[path.length - 2].label}`, node: path[path.length - 2] } : { label: ALL, node: null };
    items = [selected, ...selected.children];
  } else if (selected && path.length > 1) {
    const parent = path[path.length - 2];
    const grand = path.length > 2 ? path[path.length - 3] : null;
    back = grand ? { label: `‹ ${grand.label}`, node: grand } : { label: ALL, node: null };
    heading = parent.label;
    items = parent.children;
  } else if (filters?.category) {
    // A top-level leaf, or a slug the tree does not hold.
    back = { label: ALL, node: null };
  }

  return (
    <nav aria-label="Department">
      {back && (
        <button type="button" className="ah-rail-hit" onClick={() => goTo(back.node)} style={{ ...linkButton, marginTop: 4 }}>
          {back.label}
        </button>
      )}
      {heading && <div style={{ padding: "6px 8px 0 11px", fontWeight: 700, color: C.ink }}>{heading}</div>}
      <ul style={listReset}>
        {items.map((node, index) => {
          const current = !!selected && node.slug === selected.slug;
          // Under a selected parent, the parent comes first and its children are indented.
          const nested = !!selected && !!selected.children?.length && index > 0;
          const indent = nested || heading ? 14 : 0;
          return (
            <li key={node.id ?? node.slug}>
              <button
                type="button"
                className="ah-rail-hit"
                aria-current={current ? "true" : undefined}
                onClick={() => select(node)}
                style={optionRow(current, indent)}
              >
                {node.label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

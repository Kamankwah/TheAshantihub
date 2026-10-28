// Business and staff forms read the flat GET /api/listings/categories/ list
// (~300 rows since the department tree landed, ruling R34). Many sub-category
// labels repeat across departments ("Accessories" under Electronics and under
// Clothing), so a flat <select> shows the same bare label several times. These
// helpers group product categories under their department (each row carries
// `parent`, the parent's id or null) and keep service, stay and event
// categories in one group per kind, as before.

const KIND_GROUP = { service: "Services", event: "Events" };

function byIdOf(list) {
  return new Map((list || []).map((c) => [c.id, c]));
}

// The chain from the top-level department down to `cat` (inclusive).
function chainOf(cat, byId) {
  const chain = [cat];
  const seen = new Set([cat.id]);
  let cur = cat;
  while (cur.parent != null && byId.has(cur.parent) && !seen.has(cur.parent)) {
    cur = byId.get(cur.parent);
    seen.add(cur.id);
    chain.unshift(cur);
  }
  return chain;
}

// "Department › Sub" for a sub-category, the bare label for a top-level one.
// For places that can only take one flat label (a filter chip list).
export function categoryPathLabel(cat, all) {
  const byId = byIdOf(all);
  return chainOf(cat, byId).map((c) => c.label).join(" › ");
}

// → [{ key, label, options: [{ id, label }] }] in list order. A product
// department becomes a group holding itself (as "<Dept> — general" when it has
// sub-categories) and its sub-categories; deeper levels read "Sub › Sub-sub".
// `all` is the full flat list, used to find parents that `categories` (an
// already filtered list) may leave out.
export function categoryOptionGroups(categories, all = categories) {
  const byId = byIdOf(all);
  const list = categories || [];
  const hasChildren = new Set(list.filter((c) => c.parent != null).map((c) => c.parent));
  const groups = new Map();
  const groupFor = (key, label) => {
    if (!groups.has(key)) groups.set(key, { key, label, options: [] });
    return groups.get(key);
  };
  for (const c of list) {
    if (c.kind && c.kind !== "product") {
      groupFor(`kind:${c.kind}`, KIND_GROUP[c.kind] || c.kind).options.push({ id: c.id, label: c.label });
      continue;
    }
    const chain = chainOf(c, byId);
    const top = chain[0];
    const group = groupFor(`dept:${top.id}`, `${top.icon ? `${top.icon} ` : ""}${top.label}`);
    if (chain.length === 1) {
      group.options.unshift({ id: c.id, label: hasChildren.has(c.id) ? `${c.label} — general` : c.label });
    } else {
      group.options.push({ id: c.id, label: chain.slice(1).map((x) => x.label).join(" › ") });
    }
  }
  return [...groups.values()];
}

// <option>s grouped into <optgroup>s; drop straight into a <select> after its
// placeholder option.
export function CategoryOptions({ categories, all }) {
  return categoryOptionGroups(categories, all).map((g) => (
    <optgroup key={g.key} label={g.label}>
      {g.options.map((o) => <option key={o.id} value={String(o.id)}>{o.label}</option>)}
    </optgroup>
  ));
}

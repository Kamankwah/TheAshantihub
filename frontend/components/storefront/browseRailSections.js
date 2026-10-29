// Pure helpers for the browse rail (BrowseRail.jsx): which filter sections a
// browsing context shows, their labels and icons, which filters each section
// owns, and the fixed option lists. No React, no fetching.
//
// Contexts: the Business page browses goods (kind "product", or no kind) or
// services (kind "service"); the Events page browses events. The kind in
// effect is `filters.kind`, or else the kind of the selected category node.
// A section with nothing to filter on (no departments, no zones, no event
// categories) is dropped, so it never renders — not even as an icon.
// The API returns no facet counts, so nothing here carries one.

const GOODS = ["department", "rating", "price", "soldBy", "deals", "area"];
const SERVICES = ["department", "rating", "price", "verified", "area"];
const EVENTS = ["eventCategory", "when", "area"];

// id -> { label, icon, keys }. `icon` names one of the rail's inline SVGs;
// `keys` are the filter keys the section sets (its "Clear" empties them).
export const SECTION_META = {
  department: { label: "Department", icon: "department", keys: ["category"] },
  rating: { label: "Customer reviews", icon: "rating", keys: ["minRating"] },
  price: { label: "Price", icon: "price", keys: ["minPrice", "maxPrice"] },
  soldBy: { label: "Sold by", icon: "soldBy", keys: ["directOnly", "verified"] },
  verified: { label: "Seller", icon: "verified", keys: ["verified"] },
  deals: { label: "Deals", icon: "deals", keys: ["onSale"] },
  area: { label: "Area", icon: "area", keys: ["zone"] },
  when: { label: "When", icon: "when", keys: ["when"] },
  eventCategory: { label: "Category", icon: "eventCategory", keys: ["category"] },
};

export function sectionsFor({ mode, kind } = {}) {
  if (mode === "events") return [...EVENTS];
  return kind === "service" ? [...SERVICES] : [...GOODS];
}

// The department section is a "Category" tree when browsing services.
export function sectionLabel(id, kind) {
  if (id === "department" && kind === "service") return "Category";
  return SECTION_META[id]?.label ?? id;
}

// The node with this slug anywhere in the tree, as [top-level, …, node];
// null when the slug is not in the tree.
export function findNodePath(tree, slug) {
  if (!slug || !Array.isArray(tree)) return null;
  for (const node of tree) {
    if (node.slug === slug) return [node];
    const below = findNodePath(node.children, slug);
    if (below) return [node, ...below];
  }
  return null;
}

export function effectiveKind(filters, tree) {
  if (filters?.kind) return filters.kind;
  const path = findNodePath(tree, filters?.category);
  return path ? path[path.length - 1].kind || undefined : undefined;
}

// Top-level departments for the Business page: never events; only the kind in
// effect when there is one.
export function departmentNodes(tree, kind) {
  if (!Array.isArray(tree)) return [];
  return tree.filter((node) => node.kind !== "event" && (!kind || node.kind === kind));
}

const hasAny = (list) => Array.isArray(list) && list.length > 0;

export function availableSections(ids, { departmentNodes: nodes, zones, eventCategories } = {}) {
  return ids.filter((id) => {
    if (id === "department") return hasAny(nodes);
    if (id === "area") return hasAny(zones);
    if (id === "eventCategory") return hasAny(eventCategories);
    return true;
  });
}

const hasValue = (v) => v !== undefined && v !== null && v !== "" && v !== false;

export function isSectionActive(id, filters) {
  return (SECTION_META[id]?.keys ?? []).some((key) => hasValue(filters?.[key]));
}

export function clearSectionPatch(id) {
  return Object.fromEntries((SECTION_META[id]?.keys ?? []).map((key) => [key, undefined]));
}

// The Business page's kind switcher. Changing kind drops the category (it may
// belong to the other kind) and, for services, the goods-only filters whose
// sections services do not show, so nothing keeps narrowing invisibly.
export const KIND_OPTIONS = [
  { value: undefined, label: "All" },
  { value: "product", label: "Products" },
  { value: "service", label: "Services" },
];

export function kindPatch(kind) {
  const patch = { kind, category: undefined };
  if (kind === "service") Object.assign(patch, { onSale: undefined, directOnly: undefined });
  return patch;
}

// GH₵ price bands; a missing bound is open.
export const PRICE_BANDS = [
  { label: "Under GH₵ 50", max: 50 },
  { label: "GH₵ 50 to GH₵ 100", min: 50, max: 100 },
  { label: "GH₵ 100 to GH₵ 200", min: 100, max: 200 },
  { label: "GH₵ 200 to GH₵ 500", min: 200, max: 500 },
  { label: "GH₵ 500 and above", min: 500 },
];

export const WHEN_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

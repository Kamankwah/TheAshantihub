export type Kind = "products" | "services" | "stays" | "events";
export const KINDS: { id: Kind; label: string }[] = [
  { id: "products", label: "Products" },
  { id: "services", label: "Services" },
  { id: "stays", label: "Stays" },
  { id: "events", label: "Events" },
];

/** The same split the server counts by. */
export function kindOfListing(item: { category?: { kind?: string; is_accommodation?: boolean } }): Kind {
  if (item.category?.is_accommodation) return "stays";
  return item.category?.kind === "service" ? "services" : "products";
}

export function sinceText(since: string | null): string | null {
  const d = since ? new Date(since) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return `On AshantiHub since ${d.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;
}

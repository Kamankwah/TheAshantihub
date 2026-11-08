// What a business fills in to create a listing, and how it becomes the request the server expects.
// Mirrors the web form (ListingsPanel / listingFormFields) and the server's rules (OwnerListingSerializer.validate).

export type CategoryNode = {
  id: number; slug: string; label: string; icon: string; color: string; kind: "product" | "service" | "event";
  is_accommodation: boolean; is_food?: boolean; children: CategoryNode[];
};
export type CategoryRow = { id: number; label: string; path: string; kind: CategoryNode["kind"]; isAccommodation: boolean; isFood: boolean };

/** Every category a business may list in: products and services (never events), narrowed to its own kind when it has one. */
export function listableCategories(tree: CategoryNode[], businessKind: string | null | undefined): CategoryRow[] {
  const rows: CategoryRow[] = [];
  const locked = businessKind === "product" || businessKind === "service";
  const walk = (nodes: CategoryNode[], trail: string[]) => {
    for (const n of nodes) {
      const path = [...trail, n.label];
      const allowed = locked ? n.kind === businessKind : n.kind === "product" || n.kind === "service";
      if (allowed) rows.push({ id: n.id, label: n.label, path: path.join(" › "), kind: n.kind, isAccommodation: !!n.is_accommodation, isFood: !!n.is_food });
      walk(n.children ?? [], path);
    }
  };
  walk(tree, []);
  return rows;
}

export type YesNo = "" | "yes" | "no";
export type Draft = {
  category: number | null; zone: number | null; name: string; description: string; price: string;
  // goods
  hasWarranty: YesNo; warrantyDetails: string; hasExpiry: YesNo; expiryDate: string; returnPolicy: string;
  brand: string; condition: string; dimensions: string; weight: string; stock: string; barcode: string;
  // services
  duration: string; included: string; requirements: string; revisions: string; deliveryTime: string;
  // stays
  unitsTotal: string; cancellationPolicy: string; checkTimes: string; amenities: string; houseRules: string;
};
export const emptyDraft = (): Draft => ({
  category: null, zone: null, name: "", description: "", price: "",
  hasWarranty: "", warrantyDetails: "", hasExpiry: "", expiryDate: "", returnPolicy: "",
  brand: "", condition: "", dimensions: "", weight: "", stock: "", barcode: "",
  duration: "", included: "", requirements: "", revisions: "", deliveryTime: "",
  unitsTotal: "", cancellationPolicy: "", checkTimes: "", amenities: "", houseRules: "",
});

type Cat = Pick<CategoryRow, "kind" | "isAccommodation"> | { kind: string; is_accommodation?: boolean; isAccommodation?: boolean } | undefined;
const accommodation = (c: Cat) => !!c && ("isAccommodation" in c ? !!c.isAccommodation : !!(c as { is_accommodation?: boolean }).is_accommodation);

/** The body for POST /api/listings/mine/: only the fields that belong to the kind of listing. */
export function buildListingBody(d: Draft, category: Cat): Record<string, unknown> {
  const stay = accommodation(category);
  const kind = category?.kind;
  const body: Record<string, unknown> = {
    category: d.category, zone: d.zone, name: d.name.trim(), description: d.description.trim(),
    price_amount: d.price.trim() === "" ? null : d.price.trim(),
    price_unit: stay ? "per night" : kind === "service" ? "per service" : "per item",
  };
  if (stay) {
    Object.assign(body, {
      units_total: d.unitsTotal.trim() === "" ? undefined : Number(d.unitsTotal), cancellation_policy: d.cancellationPolicy,
      service_duration: d.checkTimes.trim(), whats_included: d.amenities.trim(), requirements: d.houseRules.trim(),
    });
  } else if (kind === "service") {
    Object.assign(body, {
      service_duration: d.duration.trim(), whats_included: d.included.trim(), requirements: d.requirements.trim(),
      revisions: d.revisions.trim(), delivery_time: d.deliveryTime.trim(),
    });
  } else if (kind === "product") {
    Object.assign(body, {
      has_warranty: d.hasWarranty === "yes", warranty_details: d.hasWarranty === "yes" ? d.warrantyDetails.trim() : "",
      has_expiry: d.hasExpiry === "yes", expiry_date: d.hasExpiry === "yes" ? d.expiryDate : null,
      return_policy: d.returnPolicy.trim(), brand: d.brand.trim(), condition: d.condition, dimensions: d.dimensions.trim(), weight: d.weight.trim(),
      stock_quantity: d.stock.trim() === "" ? null : Number(d.stock), barcode: d.barcode.trim(),
    });
  }
  return body;
}

/** The client-side mirror of the server's product rules, so Save stays off until the owner has answered on purpose. */
export function canSave(d: Draft, category: Cat): boolean {
  if (!category || d.category == null || d.zone == null || !d.name.trim() || !d.description.trim()) return false;
  if (!(Number(d.price) > 0)) return false; // an item without a price is not shown in the marketplace
  if (accommodation(category)) return d.cancellationPolicy !== "";
  if (category.kind === "product") {
    return d.hasWarranty !== "" && d.hasExpiry !== "" && d.returnPolicy.trim() !== "" &&
      (d.hasWarranty !== "yes" || d.warrantyDetails.trim() !== "") && (d.hasExpiry !== "yes" || d.expiryDate !== "");
  }
  return true;
}

const FIELD_NAMES: Record<string, string> = {
  has_warranty: "Warranty", has_expiry: "Expiry", return_policy: "Return policy", warranty_details: "Warranty details", expiry_date: "Expiry date",
  cancellation_policy: "Cancellation policy", price_amount: "Price", units_total: "Rooms or units", stock_quantity: "Stock", barcode: "Barcode",
  category: "Category", zone: "Area", name: "Name", description: "Description",
};
/** The server's field errors in plain words, one line each. */
export function fieldLines(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const lines: string[] = [];
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const text = Array.isArray(value) ? String(value[0]) : typeof value === "string" ? value : null;
    if (!text) continue;
    if (key === "detail" || key === "non_field_errors" || key === "subscription" || key === "max_active_listings") lines.push(text);
    else lines.push(`${FIELD_NAMES[key] ?? key.replaceAll("_", " ")}: ${text}`);
  }
  return lines;
}

import { buildListingBody, canSave, emptyDraft, listableCategories, type CategoryNode } from "../src/features/business/newListing";

const tree: CategoryNode[] = [
  { id: 1, slug: "fashion", label: "Fashion", icon: "", color: "", kind: "product", is_accommodation: false, is_food: false, children: [
    { id: 11, slug: "cloth", label: "Kente cloth", icon: "", color: "", kind: "product", is_accommodation: false, is_food: false, children: [] },
  ] },
  { id: 2, slug: "food", label: "Food", icon: "", color: "", kind: "product", is_accommodation: false, is_food: true, children: [] },
  { id: 3, slug: "services", label: "Services", icon: "", color: "", kind: "service", is_accommodation: false, is_food: false, children: [
    { id: 31, slug: "stays", label: "Guesthouses", icon: "", color: "", kind: "service", is_accommodation: true, is_food: false, children: [] },
  ] },
  { id: 4, slug: "events", label: "Events", icon: "", color: "", kind: "event", is_accommodation: false, is_food: false, children: [] },
];

const base = () => ({ ...emptyDraft(), category: 11, zone: 5, name: " Kente stole ", description: " Woven in Bonwire. ", price: "450.00" });
const product = () => ({ ...base(), hasWarranty: "no" as const, hasExpiry: "no" as const, returnPolicy: "Returns within 7 days." });

describe("which categories a business can list in", () => {
  it("leaves_out_events_and_shows_the_path", () => {
    const rows = listableCategories(tree, null);
    expect(rows.map((r) => r.id)).toEqual([1, 11, 2, 3, 31]);
    expect(rows.find((r) => r.id === 11)!.path).toBe("Fashion › Kente cloth");
  });
  it("a_product_business_sees_only_products_and_a_service_business_only_services", () => {
    expect(listableCategories(tree, "product").every((r) => r.kind === "product")).toBe(true);
    expect(listableCategories(tree, "service").map((r) => r.id)).toEqual([3, 31]);
  });
});

describe("building the request", () => {
  it("a_product_sends_its_answers_and_a_null_for_uncounted_stock", () => {
    const body = buildListingBody({ ...product(), stock: "" }, tree[0].children[0]);
    expect(body).toMatchObject({
      category: 11, zone: 5, name: "Kente stole", description: "Woven in Bonwire.", price_amount: "450.00", price_unit: "per item",
      has_warranty: false, has_expiry: false, expiry_date: null, return_policy: "Returns within 7 days.", stock_quantity: null,
    });
    expect(body).not.toHaveProperty("cancellation_policy");
    expect(body).not.toHaveProperty("units_total");
  });
  it("warranty_expiry_and_stock_are_sent_when_answered", () => {
    const body = buildListingBody({ ...product(), hasWarranty: "yes", warrantyDetails: "12 months", hasExpiry: "yes", expiryDate: "2027-05-01", stock: "7", brand: "Bonwire" }, tree[0].children[0]);
    expect(body).toMatchObject({ has_warranty: true, warranty_details: "12 months", has_expiry: true, expiry_date: "2027-05-01", stock_quantity: 7, brand: "Bonwire" });
  });
  it("a_stay_is_priced_per_night_with_units_and_a_cancellation_policy", () => {
    const body = buildListingBody({ ...base(), category: 31, unitsTotal: "8", cancellationPolicy: "moderate", checkTimes: "Check-in 2pm", amenities: "Wi-Fi", houseRules: "No smoking" }, tree[2].children[0]);
    expect(body).toMatchObject({ price_unit: "per night", units_total: 8, cancellation_policy: "moderate", service_duration: "Check-in 2pm", whats_included: "Wi-Fi", requirements: "No smoking" });
    expect(body).not.toHaveProperty("has_warranty");
  });
  it("a_service_sends_its_gig_fields_and_no_policy", () => {
    const body = buildListingBody({ ...base(), category: 3, duration: "2 hours", included: "Materials", requirements: "Measurements", revisions: "2", deliveryTime: "3 days" }, tree[2]);
    expect(body).toMatchObject({ service_duration: "2 hours", whats_included: "Materials", requirements: "Measurements", revisions: "2", delivery_time: "3 days" });
    expect(body).not.toHaveProperty("cancellation_policy");
  });
  it("a_blank_price_is_null_not_zero", () => {
    expect(buildListingBody({ ...product(), price: "" }, tree[0].children[0]).price_amount).toBeNull();
  });
});

describe("what is needed before saving", () => {
  const cloth = tree[0].children[0];
  it("a_product_needs_the_conscious_answers", () => {
    expect(canSave(product(), cloth)).toBe(true);
    expect(canSave({ ...product(), hasWarranty: "" }, cloth)).toBe(false);
    expect(canSave({ ...product(), hasExpiry: "" }, cloth)).toBe(false);
    expect(canSave({ ...product(), returnPolicy: "  " }, cloth)).toBe(false);
    expect(canSave({ ...product(), hasWarranty: "yes", warrantyDetails: "" }, cloth)).toBe(false);
    expect(canSave({ ...product(), hasExpiry: "yes", expiryDate: "" }, cloth)).toBe(false);
  });
  it("every_listing_needs_a_price_above_zero", () => {
    expect(canSave({ ...product(), price: "" }, cloth)).toBe(false);
    expect(canSave({ ...product(), price: "0" }, cloth)).toBe(false);
  });
  it("every_listing_needs_category_zone_name_and_description", () => {
    expect(canSave({ ...product(), zone: null }, cloth)).toBe(false);
    expect(canSave({ ...product(), name: " " }, cloth)).toBe(false);
    expect(canSave({ ...product(), description: "" }, cloth)).toBe(false);
    expect(canSave({ ...product(), category: null }, undefined)).toBe(false);
  });
  it("a_stay_needs_a_cancellation_policy", () => {
    const stay = tree[2].children[0];
    expect(canSave({ ...base(), category: 31 }, stay)).toBe(false);
    expect(canSave({ ...base(), category: 31, cancellationPolicy: "flexible" }, stay)).toBe(true);
  });
});

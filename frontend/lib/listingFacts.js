// Facts a listing detail (GET /api/listings/<id>/) states about itself, shared by
// the service/stay page's Specs tab and the product page, so neither copies the other.

export const CONDITION_LABELS = { new: "New", used: "Used", refurbished: "Refurbished" };

// The structured product attributes the seller filled in (brand, condition,
// dimensions, weight), each only when set — never a placeholder value.
export function attributeRows(item) {
  return [
    item?.brand && { label: "Brand", value: item.brand },
    item?.condition && { label: "Condition", value: CONDITION_LABELS[item.condition] || item.condition },
    item?.dimensions && { label: "Dimensions", value: item.dimensions },
    item?.weight && { label: "Weight", value: item.weight },
  ].filter(Boolean);
}

// "About this item": the description, one bullet per non-blank line. A leading
// "-", "*" or "•" the seller typed is dropped so it is not drawn twice. A blank
// description gives no bullets (the section is then left out).
export function aboutBullets(description) {
  if (typeof description !== "string") return [];
  return description
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*•]\s+/, "").trim())
    .filter(Boolean);
}

import { D, tint } from "../theme.js";

// Small things shared by the listing editor parts (card, variants, media, banner).
// Every part takes a `basePath` and builds its URLs from it, so Ashanti Direct can
// mount the same parts on "/api/direct/listings".
export { DEFAULT_LISTINGS_PATH } from "../../../hooks/useMyListings.js";

export const inputStyle = { padding: "8px 10px", borderRadius: 8, border: `1.5px solid ${D.divider}`, fontSize: "0.8rem", fontFamily: "inherit", background: D.panelBg2, color: D.text, boxSizing: "border-box" };
export const btn = { border: "none", borderRadius: 20, padding: "7px 14px", fontSize: "0.74rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
export const quietBtn = { ...btn, background: D.panelBg2, color: D.text, border: `1px solid ${D.divider}` };
export const noteStyle = { color: D.textFaint, fontSize: "0.68rem" };

// The server's own words, shown verbatim: a `detail`, else the first field message, else the fallback.
export function serverMessage(err, fallback) {
  const body = err?.body;
  if (body && typeof body === "object") {
    if (typeof body.detail === "string") return body.detail;
    for (const value of Object.values(body)) {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === "string") return first;
    }
  }
  return fallback;
}

// Variants exist only for goods and food (the server refuses anything else).
export function canHaveVariants(category) {
  return Boolean(category) && category.kind === "product" && !category.is_accommodation;
}

export function Chip({ color, children }) {
  return (
    <span style={{ background: tint(color, "22"), color, borderRadius: 20, padding: "2px 9px", fontSize: "0.62rem", fontWeight: 800 }}>{children}</span>
  );
}

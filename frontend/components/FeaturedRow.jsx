import { C } from "../theme.js";
import VerifiedMark from "./VerifiedMark.jsx";
import { usePublicFeatured } from "../hooks/useMarketingBanners.js";

// ─── FeaturedRow ────────────────────────────────────────────────────────────
// Paid featured listings (home row, or the top of a category). Paid and verified must never
// look alike: a featured card has a gold outline and the word "Featured" and no tick; a
// verified business (staff-approved identity, not KYC) has its own green tick on a plain field. Both can show side by side.
// Renders nothing when no slot is booked and live.
export default function FeaturedRow({ category = "", onOpen }) {
  const { data } = usePublicFeatured(category);
  const rows = data?.listings || [];
  if (rows.length === 0) return null;
  return (
    <section aria-label="Featured listings" style={{ maxWidth: 1200, margin: "0 auto", padding: "16px" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 800, color: C.ink, margin: "0 0 10px" }}>Featured listings</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        {rows.map((row) => (
          <button key={row.id} type="button" onClick={() => onOpen?.(row.id)} style={{ textAlign: "left", cursor: "pointer", font: "inherit", padding: 0, background: C.surface, border: `2px solid ${C.gold}`, borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            {row.main_photo ? <img src={row.main_photo} alt={row.name} style={{ width: "100%", height: 120, objectFit: "cover" }} /> : <div aria-hidden="true" style={{ height: 120, background: C.darkBrown }} />}
            <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ alignSelf: "flex-start", fontSize: "0.62rem", fontWeight: 800, color: C.ink, background: `${C.gold}33`, border: `1px solid ${C.gold}`, borderRadius: 6, padding: "1px 6px" }}>Featured</span>
              <strong style={{ fontSize: "0.85rem", color: C.ink }}>{row.name}</strong>
              <span style={{ fontSize: "0.72rem", color: C.inkDim }}>
                {row.business}
                {row.verified === true && <span style={{ marginLeft: 6 }}><VerifiedMark verified compact /></span>}
              </span>
              {row.price_amount != null && <span style={{ fontSize: "0.78rem", fontWeight: 700 }}>GH₵ {Number(row.price_amount).toLocaleString("en-GH", { minimumFractionDigits: 2 })}{row.price_unit ? ` / ${row.price_unit}` : ""}</span>}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

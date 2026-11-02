import { useMemo, useState } from "react";
import { useCategories } from "../../../hooks/useCategories.js";
import { D, glassCard } from "../theme.js";
import PictureSlot from "./PictureSlot.jsx";

// The pictures the storefront shows for each department and its sub-categories (home cards, department tiles,
// shelf headers). Pick a department, then upload a picture for it and for each sub-category; a category without one
// shows its icon on the shopper's page. Product departments only: they are what the home page is built from.
export default function CategoryPictures({ canEdit }) {
  const categories = useCategories();
  const rows = categories.data || [];
  const departments = useMemo(() => rows.filter((c) => c.kind === "product" && c.parent == null), [rows]);
  const [chosen, setChosen] = useState(null);
  const current = departments.find((d) => d.id === chosen) || departments[0];
  const children = current ? rows.filter((c) => c.parent === current.id) : [];
  const pictured = departments.filter((d) => d.image).length;

  if (categories.isLoading || departments.length === 0) return null;
  const slot = (c) => (
    <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <PictureSlot label={c.label} path={`/api/listings/categories/${c.id}/image/`} image={c.image_variants?.thumb || c.image} fallback={c.icon} canEdit={canEdit} onChanged={categories.refetch} />
      <span style={{ color: D.text, fontSize: "0.72rem", fontWeight: 700, maxWidth: 108, lineHeight: 1.3 }}>{c.label}</span>
    </div>
  );
  return (
    <section aria-labelledby="category-pictures-title" style={{ ...glassCard, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
        <h3 id="category-pictures-title" style={{ margin: 0, color: D.text, fontWeight: 800, fontSize: "0.88rem" }}>Department pictures</h3>
        <label style={{ display: "flex", gap: 6, alignItems: "center", color: D.textDim, fontSize: "0.72rem", fontWeight: 700 }}>
          Department
          <select value={current?.id ?? ""} onChange={(e) => setChosen(Number(e.target.value))} style={{ padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }}>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>
      </div>
      <div style={{ color: D.textDim, fontSize: "0.72rem", lineHeight: 1.45, marginBottom: 12 }}>
        {pictured} of {departments.length} departments have a picture. Use a square JPEG, PNG or WebP up to 5 MB. A category with no picture shows its icon.
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        {current && slot(current)}
        {children.length > 0 && <div aria-hidden="true" style={{ width: 1, alignSelf: "stretch", background: D.divider }} />}
        {children.map(slot)}
      </div>
    </section>
  );
}

import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useCategories } from "../../../hooks/useCategories.js";
import { useZones } from "../../../hooks/useZones.js";
import { D, glassCard } from "../theme.js";

export default function CategoriesZonesPanel({ auth }) {
  const categories = useCategories();
  const zones = useZones();
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [newZoneName, setNewZoneName] = useState("");
  const [actionError, setActionError] = useState(null);

  const addCategory = async () => {
    if (!newCategoryLabel) return;
    setActionError(null);
    try {
      const slug = newCategoryLabel.toLowerCase().replace(/\s+/g, "-");
      await apiPost("/api/listings/categories/", { slug, icon: "🆕", label: newCategoryLabel, color: "#888888" });
      setNewCategoryLabel("");
      categories.refetch();
    } catch (err) { setActionError("Could not add this category."); }
  };
  const addZone = async () => {
    if (!newZoneName) return;
    setActionError(null);
    try {
      await apiPost("/api/listings/zones/", { name: newZoneName });
      setNewZoneName("");
      zones.refetch();
    } catch (err) { setActionError("Could not add this zone."); }
  };

  return (
    <div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 }}>
        <div style={{ ...glassCard, padding: 18 }}>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 12 }}>Categories</div>
          {(categories.data || []).map(c => (
            <div key={c.id} style={{ padding: "6px 0", color: D.text, fontSize: "0.8rem" }}>{c.icon} {c.label}</div>
          ))}
          {auth.hasPermission("categories.manage") && <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
            <input value={newCategoryLabel} onChange={e => setNewCategoryLabel(e.target.value)} placeholder="New category label" style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
            <button onClick={addCategory} style={{ background: D.gold, color: "#1a1205", border: "none", borderRadius: 20, padding: "6px 14px", fontSize: "0.72rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Add category</button>
          </div>}
        </div>
        <div style={{ ...glassCard, padding: 18 }}>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 12 }}>Zones</div>
          {(zones.data || []).map(z => (
            <div key={z.id} style={{ padding: "6px 0", color: D.text, fontSize: "0.8rem" }}>{z.name}</div>
          ))}
          {auth.hasPermission("zones.manage") && <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
            <input value={newZoneName} onChange={e => setNewZoneName(e.target.value)} placeholder="New zone name" style={{ flex: 1, padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }} />
            <button onClick={addZone} style={{ background: D.gold, color: "#1a1205", border: "none", borderRadius: 20, padding: "6px 14px", fontSize: "0.72rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Add zone</button>
          </div>}
        </div>
      </div>
    </div>
  );
}

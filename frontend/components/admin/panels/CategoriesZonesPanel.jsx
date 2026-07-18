import { useState } from "react";
import { apiPost, apiPatch, apiDelete } from "../../../apiClient.js";
import { useCategories } from "../../../hooks/useCategories.js";
import { useZones } from "../../../hooks/useZones.js";
import { D, glassCard } from "../theme.js";

// Category kinds that staff can create/assign here. `event` categories exist
// (seeded for the Events tab) but aren't staff-authored from this panel, so
// they're not offered in the create/edit selectors — they still render in
// their own section below if present, rather than silently disappearing.
const CREATE_KINDS = [
  { value: "product", label: "Product" },
  { value: "service", label: "Service" },
];

// Section order + labels for grouping the category list by kind. Any kind not
// listed here (defensive) falls back to a generic section using the raw key.
const KIND_SECTIONS = [
  { kind: "product", label: "Products" },
  { kind: "service", label: "Services" },
  { kind: "event", label: "Events" },
];

const inputStyle = {
  padding: "6px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`,
  fontSize: "0.75rem", fontFamily: "inherit", background: D.panelBg2, color: D.text,
};
const goldBtn = {
  background: D.gold, color: "#1a1205", border: "none", borderRadius: 20,
  padding: "6px 14px", fontSize: "0.72rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
};
const ghostBtn = {
  background: "rgba(255,255,255,0.06)", color: D.textDim, border: `1px solid ${D.divider}`,
  borderRadius: 20, padding: "6px 12px", fontSize: "0.7rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};

function slugify(label) {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function CategoriesZonesPanel({ auth }) {
  const categories = useCategories();
  const zones = useZones();
  const canManageCategories = auth.hasPermission("categories.manage");
  const canManageZones = auth.hasPermission("zones.manage");

  const [newLabel, setNewLabel] = useState("");
  const [newIcon, setNewIcon] = useState("🆕");
  const [newColor, setNewColor] = useState("#888888");
  const [newKind, setNewKind] = useState("product");
  const [newIsAccommodation, setNewIsAccommodation] = useState(false);
  const [newZoneName, setNewZoneName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({});
  const [actionError, setActionError] = useState(null);

  const addCategory = async () => {
    if (!newLabel.trim()) return;
    setActionError(null);
    try {
      await apiPost("/api/listings/categories/", {
        slug: slugify(newLabel), icon: newIcon || "🆕", label: newLabel.trim(),
        color: newColor, kind: newKind,
        // Only a service category can be accommodation (hotel/real-estate/
        // Airbnb) — its listings are booked by date in the Bookings tab.
        is_accommodation: newKind === "service" ? newIsAccommodation : false,
      });
      setNewLabel(""); setNewIcon("🆕"); setNewColor("#888888"); setNewIsAccommodation(false);
      categories.refetch();
    } catch (err) { setActionError("Could not add this category."); }
  };

  const startEdit = (c) => {
    setActionError(null);
    setEditingId(c.id);
    setEditDraft({ label: c.label, icon: c.icon, color: c.color, kind: c.kind, is_accommodation: !!c.is_accommodation });
  };

  const saveEdit = async (id) => {
    setActionError(null);
    try {
      await apiPatch(`/api/listings/categories/${id}/`, {
        label: editDraft.label, icon: editDraft.icon, color: editDraft.color, kind: editDraft.kind,
        is_accommodation: editDraft.kind === "service" ? !!editDraft.is_accommodation : false,
      });
      setEditingId(null);
      categories.refetch();
    } catch (err) { setActionError("Could not save this category."); }
  };

  const deleteCategory = async (c) => {
    setActionError(null);
    try {
      await apiDelete(`/api/listings/categories/${c.id}/`);
      categories.refetch();
    } catch (err) {
      // The backend returns a clear 400 with a `detail` when the category is
      // still in use by listings — surface that message rather than a generic one.
      setActionError(err?.body?.detail || `Could not delete "${c.label}".`);
    }
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

  const allCategories = categories.data || [];
  const knownKinds = new Set(KIND_SECTIONS.map(s => s.kind));
  const sections = [
    ...KIND_SECTIONS,
    // Defensive: any unexpected kind still gets its own section.
    ...[...new Set(allCategories.map(c => c.kind))]
      .filter(k => !knownKinds.has(k))
      .map(k => ({ kind: k, label: k || "Other" })),
  ];

  const renderCategoryRow = (c) => {
    if (editingId === c.id) {
      return (
        <div key={c.id} style={{ padding: "8px 0", borderBottom: `1px solid ${D.divider}` }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input value={editDraft.icon} onChange={e => setEditDraft(d => ({ ...d, icon: e.target.value }))} style={{ ...inputStyle, width: 44, textAlign: "center" }} aria-label="Icon" />
            <input value={editDraft.label} onChange={e => setEditDraft(d => ({ ...d, label: e.target.value }))} style={{ ...inputStyle, flex: 1, minWidth: 120 }} aria-label="Label" />
            <input type="color" value={editDraft.color} onChange={e => setEditDraft(d => ({ ...d, color: e.target.value }))} style={{ width: 32, height: 30, padding: 0, border: `1.5px solid ${D.cardBorder}`, borderRadius: 8, background: D.panelBg2 }} aria-label="Color" />
            <select value={editDraft.kind} onChange={e => setEditDraft(d => ({ ...d, kind: e.target.value }))} style={inputStyle} aria-label="Kind">
              {CREATE_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          {editDraft.kind === "service" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, color: D.textDim, fontSize: "0.72rem", cursor: "pointer" }}>
              <input type="checkbox" checked={!!editDraft.is_accommodation} onChange={e => setEditDraft(d => ({ ...d, is_accommodation: e.target.checked }))} />
              🏨 Accommodation (booked by date — hotel / real estate / Airbnb)
            </label>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button onClick={() => saveEdit(c.id)} style={goldBtn}>Save</button>
            <button onClick={() => setEditingId(null)} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      );
    }
    return (
      <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${D.divider}` }}>
        <span style={{ color: D.text, fontSize: "0.8rem", flex: 1 }}>
          {c.icon} {c.label}
          {c.is_accommodation && <span style={{ marginLeft: 6, background: `${D.gold}22`, color: D.gold, borderRadius: 20, padding: "1px 7px", fontSize: "0.58rem", fontWeight: 800 }}>🏨 Accommodation</span>}
        </span>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: c.color, flexShrink: 0 }} title={c.color} />
        {canManageCategories && (
          <>
            <button onClick={() => startEdit(c)} style={{ ...ghostBtn, padding: "3px 8px" }} title="Edit">✏️</button>
            <button onClick={() => deleteCategory(c)} style={{ ...ghostBtn, padding: "3px 8px", color: D.red }} title="Delete">🗑️</button>
          </>
        )}
      </div>
    );
  };

  return (
    <div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 16 }}>
        <div style={{ ...glassCard, padding: 18 }}>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 12 }}>Categories</div>

          {sections.map(section => {
            const rows = allCategories.filter(c => c.kind === section.kind);
            if (rows.length === 0) return null;
            return (
              <div key={section.kind || "other"} style={{ marginBottom: 14 }}>
                <div style={{ color: D.textFaint, fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>{section.label}</div>
                {rows.map(renderCategoryRow)}
              </div>
            );
          })}

          {canManageCategories && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${D.cardBorder}` }}>
              <div style={{ color: D.textDim, fontSize: "0.72rem", fontWeight: 800, marginBottom: 8 }}>Add a category</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input value={newIcon} onChange={e => setNewIcon(e.target.value)} placeholder="🆕" style={{ ...inputStyle, width: 44, textAlign: "center" }} aria-label="New category icon" />
                <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="New category label" style={{ ...inputStyle, flex: 1, minWidth: 120 }} aria-label="New category label" />
                <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} style={{ width: 32, height: 30, padding: 0, border: `1.5px solid ${D.cardBorder}`, borderRadius: 8, background: D.panelBg2 }} aria-label="New category color" />
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                <select value={newKind} onChange={e => setNewKind(e.target.value)} style={inputStyle} aria-label="New category kind">
                  {CREATE_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </select>
                <button onClick={addCategory} style={goldBtn}>Add category</button>
              </div>
              {/* Accommodation is only meaningful for a service category — its
                  listings are booked by date in the Bookings tab rather than
                  carted. */}
              {newKind === "service" && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, color: D.textDim, fontSize: "0.72rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={newIsAccommodation} onChange={e => setNewIsAccommodation(e.target.checked)} />
                  🏨 Accommodation (booked by date — hotel / real estate / Airbnb)
                </label>
              )}
            </div>
          )}
        </div>

        <div style={{ ...glassCard, padding: 18 }}>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 12 }}>Zones</div>
          {(zones.data || []).map(z => (
            <div key={z.id} style={{ padding: "6px 0", color: D.text, fontSize: "0.8rem" }}>{z.name}</div>
          ))}
          {canManageZones && <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
            <input value={newZoneName} onChange={e => setNewZoneName(e.target.value)} placeholder="New zone name" style={{ ...inputStyle, flex: 1 }} />
            <button onClick={addZone} style={goldBtn}>Add zone</button>
          </div>}
        </div>
      </div>
    </div>
  );
}

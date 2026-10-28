import { useState } from "react";
import { apiDelete, apiPatch, apiPost } from "../../../../apiClient.js";
import { useCategories } from "../../../../hooks/useCategories.js";
import { apiErrorMessage } from "../../../../lib/apiErrorMessage.js";
import { C } from "../../../../theme.js";
import { D } from "../../theme.js";
import { Loading, PageHead, Section, button, dim, errorStyle, inputStyle, labelStyle, page, scroll, table, td, th } from "./mkParts.jsx";

// ─── 21 Categories (the categories half of CategoriesZonesPanel, for Marketing) ──
// Zones stay with Operations. Usage counts come from the server (listings and events per
// category); Delete is offered only when nothing uses the category, and a refusal from
// the server is shown in full.
export const SWATCHES = [
  ["Gold", C.gold], ["Deep gold", C.deepGold], ["Green", C.kente2], ["Navy", C.kente3],
  ["Red", C.kente1], ["Orange", C.orange], ["Ghana green", C.ghGreen], ["Dark brown", C.darkBrown],
];
const KINDS = [["service", "Service — customers send a request"], ["product", "Product — customers add to cart"]];
const slugify = (label) => label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const kindWord = (c) => (c.is_accommodation ? "Booked by date" : c.kind === "event" ? "Event" : c.kind === "service" ? "Service" : "Product");

export default function CategoriesMarketing({ auth }) {
  const categories = useCategories();
  const canManage = auth?.hasPermission?.("categories.manage") ?? false;
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [kind, setKind] = useState("service");
  const [booked, setBooked] = useState(false);
  const [colour, setColour] = useState(SWATCHES[2][1]);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const [actionError, setActionError] = useState("");
  const [refused, setRefused] = useState(null);
  const [busy, setBusy] = useState(false);

  const rows = categories.data || [];
  const run = async (fn, fallback) => {
    if (busy) return false;
    setBusy(true); setActionError(""); setRefused(null);
    try { await fn(); categories.refetch(); return true; }
    catch (err) { setActionError(apiErrorMessage(err, fallback)); return false; }
    finally { setBusy(false); }
  };

  const add = async () => {
    if (!name.trim()) return;
    const ok = await run(() => apiPost("/api/listings/categories/", {
      slug: slug || slugify(name), icon: "🆕", label: name.trim(), color: colour,
      kind, is_accommodation: kind === "service" && booked,
    }), "Could not add this category.");
    if (ok) { setName(""); setSlug(""); setSlugTouched(false); setBooked(false); }
  };
  const rename = async (c) => { if (await run(() => apiPatch(`/api/listings/categories/${c.id}/`, { label: draft.trim() }), "Could not rename this category.")) setEditingId(null); };
  const remove = async (c) => {
    if (busy) return;
    setBusy(true); setActionError(""); setRefused(null);
    try { await apiDelete(`/api/listings/categories/${c.id}/`); categories.refetch(); }
    catch (err) { setRefused({ label: c.label, detail: apiErrorMessage(err, `Could not delete “${c.label}”.`) }); categories.refetch(); }
    finally { setBusy(false); }
  };

  return (
    <div style={page}>
      <PageHead title="Categories" />
      <div style={dim}>Every change here is recorded in the activity log. Zones are managed by Operations.</div>
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      {refused && <div role="alert" style={{ ...errorStyle, color: D.text }}><b>{"“"}{refused.label}{"”"} wasn{"’"}t deleted.</b> {refused.detail}</div>}
      {categories.isLoading || categories.isError ? <Loading error={categories.isError} onRetry={categories.refetch} what="categories" /> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))", gap: 14, alignItems: "start" }}>
          <Section id="all-cats" title={`All categories · ${rows.length}`}>
            <div style={scroll}>
              <table style={table}>
                <thead><tr>
                  <th scope="col" style={th}>Category</th><th scope="col" style={th}>Kind</th><th scope="col" style={th}>Listings</th>
                  <th scope="col" style={th}>Events</th><th scope="col" style={th}>Web address</th>{canManage && <th scope="col" style={th}>Actions</th>}
                </tr></thead>
                <tbody>
                  {rows.map((c) => {
                    const used = (c.listing_count || 0) + (c.event_count || 0) > 0;
                    return (
                      <tr key={c.id}>
                        <th scope="row" style={{ ...td, textAlign: "left" }}>
                          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                            <span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                            {editingId === c.id
                              ? <input aria-label={`New name for ${c.label}`} value={draft} onChange={(e) => setDraft(e.target.value)} style={inputStyle} />
                              : c.label}
                          </span>
                        </th>
                        <td style={td}>{kindWord(c)}</td>
                        <td style={td}>{c.listing_count ?? "—"}</td>
                        <td style={td}>{c.event_count ?? "—"}</td>
                        <td style={td}>/c/{c.slug}</td>
                        {canManage && (
                          <td style={td}>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                              {editingId === c.id ? (
                                <>
                                  <button type="button" disabled={busy || !draft.trim()} onClick={() => rename(c)} style={button(D.text, D.panelBg, busy || !draft.trim())}>Save</button>
                                  <button type="button" onClick={() => setEditingId(null)} style={button(D.panelBg, D.text)}>Cancel</button>
                                </>
                              ) : <button type="button" onClick={() => { setEditingId(c.id); setDraft(c.label); }} style={button(D.panelBg, D.text)}>Rename</button>}
                              {used ? <span style={dim}>In use</span> : <button type="button" disabled={busy} onClick={() => remove(c)} style={button(D.panelBg, D.errInk, busy)}>Delete</button>}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={dim}>Delete only appears when nothing uses the category. Renaming changes the menu name; the web address stays so old links keep working.</div>
          </Section>

          {canManage && (
            <Section id="add-cat" title="Add a category">
              <label style={labelStyle}>Name
                <input type="text" value={name} onChange={(e) => { setName(e.target.value); if (!slugTouched) setSlug(slugify(e.target.value)); }} style={inputStyle} />
              </label>
              <label style={labelStyle}>Web address
                <input type="text" value={slug} onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); }} style={inputStyle} />
              </label>
              <label style={labelStyle}>Kind
                <select value={kind} onChange={(e) => { setKind(e.target.value); if (e.target.value !== "service") setBooked(false); }} style={inputStyle}>
                  {KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
              </label>
              <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center", fontWeight: 600 }}>
                <input type="checkbox" checked={booked} disabled={kind !== "service"} onChange={(e) => setBooked(e.target.checked)} />
                <span><b>Booked by date</b> {"—"} check-in and check-out, like hotels. Services only.</span>
              </label>
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend style={labelStyle}>Colour</legend>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                  {SWATCHES.map(([label, hex]) => (
                    <label key={hex} title={label} style={{ cursor: "pointer" }}>
                      <input type="radio" name="category-colour" aria-label={label} checked={colour === hex} onChange={() => setColour(hex)} style={{ position: "absolute", opacity: 0 }} />
                      <span aria-hidden="true" style={{ display: "block", width: 28, height: 28, borderRadius: "50%", background: hex, border: colour === hex ? `3px solid ${D.text}` : `1px solid ${D.cardBorder}`, boxSizing: "border-box" }} />
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="button" disabled={busy || !name.trim()} onClick={add} style={{ ...button(D.text, D.panelBg, busy || !name.trim()), alignSelf: "flex-start" }}>Add category</button>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

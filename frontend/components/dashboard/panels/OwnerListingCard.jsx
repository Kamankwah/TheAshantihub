import { useState } from "react";
import { apiPatch, apiPost, apiPut } from "../../../apiClient.js";
import { useListingRevision } from "../../../hooks/useListingRevision.js";
import { D, glassCard, sectionTitle, tint } from "../theme.js";
import ListingChangesBanner from "./ListingChangesBanner.jsx";
import MediaManager from "./MediaManager.jsx";
import VariantEditor from "./VariantEditor.jsx";
import { Chip, DEFAULT_LISTINGS_PATH, btn, inputStyle, noteStyle, quietBtn, serverMessage } from "./listingEditorShared.jsx";

// Shared owner-facing listing card for an approved listing. Only price and stock go live at
// once (the /manage/, /restock/ and variant "live" endpoints). Every other change ("Edit
// details", images, videos, variants) is kept as a draft edit that our team approves while the
// approved version stays live. An owner can also Drop (hide, reversible), Restore, or
// Discontinue (permanent) the listing. Reused by ProductsPanel (stock + restock + expiry),
// ServicesPanel and BookingsPanel; every URL is built from `basePath` so Ashanti Direct can
// mount the same card on "/api/direct/listings".

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function ExpiryBadge({ listing }) {
  if (!listing.has_expiry || !listing.expiry_date) return null;
  const days = daysUntil(listing.expiry_date);
  if (days == null) return null;
  const expired = days < 0;
  const soon = days >= 0 && days <= 14;
  if (!expired && !soon) return null;
  return (
    <span style={{ background: expired ? tint(D.red, "22") : `${D.amber}22`, color: expired ? D.red : D.amber, borderRadius: 20, padding: "2px 9px", fontSize: "0.62rem", fontWeight: 800 }}>
      {expired ? `⚠️ Expired ${-days}d ago` : `⏳ Expires in ${days}d`}
    </span>
  );
}


const CONFIRM_TEXT = {
  drop: {
    text: "Drop hides this listing from shoppers right away. Nothing is deleted, and you can restore it later.",
    action: "Yes, drop it",
  },
  discontinue: {
    text: "Discontinue is permanent: the listing can never be sold again. Old orders will still show it.",
    action: "Yes, discontinue it",
  },
};

// The "Edit price & specs" form. The price is live (it goes through /manage/); name, description,
// tag and specs go into a draft edit of the approved listing and need approval.
function DetailsEditor({ listing, basePath, onSaved, onCancel }) {
  const revision = useListingRevision(listing.id, { basePath });
  if (revision.isLoading) return <div style={{ ...noteStyle, marginTop: 10 }}>Loading your edit…</div>;
  const waiting = revision.data?.status === "pending";
  return <DetailsForm listing={listing} basePath={basePath} staged={waiting ? {} : (revision.data?.changes || {})} waiting={waiting} onSaved={onSaved} onCancel={onCancel} />;
}

function DetailsForm({ listing, basePath, staged, waiting, onSaved, onCancel }) {
  const [price, setPrice] = useState(listing.price_amount ?? "");
  const start = (field, fallback) => (staged[field] !== undefined ? staged[field] : listing[field] ?? fallback);
  const [name, setName] = useState(start("name", ""));
  const [description, setDescription] = useState(start("description", ""));
  const [tag, setTag] = useState(start("tag", "") || "");
  const [specs, setSpecs] = useState(start("specs", []) || []);
  const [error, setError] = useState(null);
  const setSpec = (i, key, val) => setSpecs(prev => prev.map((s, idx) => idx === i ? { ...s, [key]: val } : s));

  const save = async () => {
    setError(null);
    const cleanSpecs = specs.filter(s => s.label || s.value);
    const wanted = { name, description, tag: tag || null, specs: cleanSpecs };
    const current = { name: listing.name ?? "", description: listing.description ?? "", tag: listing.tag || null, specs: listing.specs || [] };
    const changes = waiting ? {} : Object.fromEntries(Object.keys(wanted).filter(k => JSON.stringify(wanted[k]) !== JSON.stringify(current[k])).map(k => [k, wanted[k]]));
    const priceChanged = !listing.has_variants && String(price) !== String(listing.price_amount ?? "");
    if (!priceChanged && Object.keys(changes).length === 0) { setError("You have not changed anything yet."); return; }
    try {
      if (priceChanged) await apiPatch(`${basePath}/${listing.id}/manage/`, { price_amount: price === "" ? null : price });
      if (Object.keys(changes).length > 0) await apiPut(`${basePath}/${listing.id}/revision/`, { changes });
      onSaved();
    } catch (err) { setError(serverMessage(err, "Could not save your changes. Please try again.")); }
  };

  return (
    <div style={{ marginTop: 12 }}>
      {!listing.has_variants && (
        <div style={{ marginBottom: 12 }}>
          <label htmlFor={`price-${listing.id}`} style={{ fontSize: "0.72rem", fontWeight: 700, color: D.text, display: "block", marginBottom: 4 }}>Price (GHS)</label>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input id={`price-${listing.id}`} type="number" value={price} onChange={e => setPrice(e.target.value)} style={{ ...inputStyle, width: 160 }} />
            <Chip color={D.green}>Live now</Chip>
          </div>
        </div>
      )}
      {waiting ? (
        <div style={{ color: D.amber, fontSize: "0.74rem", marginBottom: 8 }}>This edit is waiting for review, so the other details cannot change until it is decided.</div>
      ) : (
      <>
      <div style={{ ...noteStyle, marginBottom: 8 }}>Name, description, tag and specs need approval. Your approved version stays live until then.</div>
      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: D.text, display: "block", marginBottom: 4 }}>Name</label>
      <input value={name} onChange={e => setName(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 8 }} />
      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: D.text, display: "block", marginBottom: 4 }}>Description</label>
      <textarea value={description} onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, width: "100%", minHeight: 64, marginBottom: 8, resize: "vertical" }} />
      <label style={{ fontSize: "0.72rem", fontWeight: 700, color: D.text, display: "block", marginBottom: 4 }}>Tag</label>
      <input value={tag} onChange={e => setTag(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: 8 }} />
      <div style={{ ...sectionTitle, fontSize: "0.72rem", marginBottom: 6 }}>Specs</div>
      {specs.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input value={s.label || ""} onChange={e => setSpec(i, "label", e.target.value)} placeholder="Label" style={{ ...inputStyle, flex: 1 }} />
          <input value={s.value || ""} onChange={e => setSpec(i, "value", e.target.value)} placeholder="Value" style={{ ...inputStyle, flex: 1 }} />
          <button type="button" onClick={() => setSpecs(prev => prev.filter((_, idx) => idx !== i))} style={{ ...btn, background: tint(D.red, "22"), color: D.red }}>✕</button>
        </div>
      ))}
      <button type="button" onClick={() => setSpecs(prev => [...prev, { label: "", value: "" }])} style={{ ...quietBtn, marginBottom: 10 }}>+ Add spec</button>
      </>
      )}
      {error && <div style={{ color: D.red, fontSize: "0.74rem", marginBottom: 6 }}>{error}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" onClick={save} style={{ ...btn, background: D.gold, color: "#1a1205" }}>Save changes</button>
        <button type="button" onClick={onCancel} style={quietBtn}>Cancel</button>
      </div>
    </div>
  );
}

export default function OwnerListingCard({ listing, onChanged, variant = "product", basePath = DEFAULT_LISTINGS_PATH, showVariants }) {
  const isProduct = variant === "product";
  const variantsAllowed = showVariants ?? (isProduct || Boolean(listing.has_variants));
  const hasVariants = Boolean(listing.has_variants);
  const [editing, setEditing] = useState(false);
  const [restockOpen, setRestockOpen] = useState(false);
  const [restockQty, setRestockQty] = useState("");
  const [variantsOpen, setVariantsOpen] = useState(false);
  const [confirm, setConfirm] = useState(null); // "drop" | "discontinue" | null
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const dropped = listing.status === "dropped";
  const discontinued = listing.status === "discontinued";
  const lowStock = isProduct && listing.stock_quantity != null && listing.stock_quantity <= 3;
  const base = `${basePath}/${listing.id}`;

  const run = async (call, fallback, after) => {
    setActionError(null); setBusy(true);
    try { await call(); if (after) after(); onChanged(); }
    catch (err) { setActionError(serverMessage(err, fallback)); }
    finally { setBusy(false); }
  };

  const restock = () => {
    if (!restockQty) return;
    return run(() => apiPost(`${base}/restock/`, { add: Number(restockQty) }), "Could not restock. Please try again.", () => { setRestockOpen(false); setRestockQty(""); });
  };
  const lifecycle = (verb) => run(() => apiPost(`${base}/${verb}/`, {}), `Could not ${verb} this listing. Please try again.`, () => setConfirm(null));

  return (
    <div style={{ ...glassCard, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem" }}>{listing.name}</div>
          <div style={{ color: D.textDim, fontSize: "0.74rem", marginTop: 2 }}>{hasVariants ? "From " : ""}GHS {listing.price_amount ?? "—"}{listing.price_unit ? ` ${listing.price_unit}` : ""}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {dropped && <Chip color={D.amber}>Dropped: hidden from shoppers</Chip>}
          {discontinued && <Chip color={D.textFaint}>Discontinued</Chip>}
          <ExpiryBadge listing={listing} />
          {isProduct && (
            <span style={{ background: lowStock ? tint(D.red, "22") : tint(D.green, "22"), color: lowStock ? D.red : D.green, borderRadius: 20, padding: "2px 10px", fontSize: "0.66rem", fontWeight: 800 }}>
              {listing.stock_quantity == null ? "Stock not tracked" : `${listing.stock_quantity} in stock`}
            </span>
          )}
        </div>
      </div>

      <ListingChangesBanner listing={listing} basePath={basePath} onChanged={onChanged} onEdit={() => setEditing(true)} />

      {!discontinued && (
        <MediaManager listing={listing} basePath={basePath} onChanged={onChanged} />
      )}

      {actionError && <div style={{ color: D.red, fontSize: "0.74rem", marginTop: 6 }}>{actionError}</div>}
      {lowStock && !restockOpen && <div style={{ color: D.red, fontSize: "0.7rem", marginTop: 6 }}>Running low — restock soon.</div>}

      {!discontinued && !hasVariants && isProduct && (
        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={() => setRestockOpen(o => !o)} style={{ ...btn, background: D.gold, color: "#1a1205" }}>📦 Restock</button>
          {restockOpen && (
            <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
              <input type="number" min={1} value={restockQty} onChange={e => setRestockQty(e.target.value)} placeholder="Add quantity" style={{ ...inputStyle, width: 140 }} />
              <button type="button" onClick={restock} disabled={!restockQty || busy} style={{ ...btn, background: D.green, color: "#fff", cursor: restockQty ? "pointer" : "default" }}>Add to stock</button>
              <Chip color={D.green}>Live now</Chip>
            </div>
          )}
        </div>
      )}

      {!discontinued && variantsAllowed && (hasVariants || variantsOpen) && (
        <VariantEditor listing={listing} basePath={basePath} onChanged={onChanged} />
      )}

      {!discontinued && (
        <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          {variantsAllowed && !hasVariants && !variantsOpen && (
            <button type="button" onClick={() => setVariantsOpen(true)} style={quietBtn}>＋ Add variants</button>
          )}
          <button type="button" onClick={() => setEditing(e => !e)} style={quietBtn}>{editing ? "Close" : "✏️ Edit price & specs"}</button>
          {dropped
            ? <button type="button" disabled={busy} onClick={() => lifecycle("restore")} style={{ ...btn, background: D.green, color: "#fff" }}>Restore</button>
            : <button type="button" disabled={busy} onClick={() => setConfirm("drop")} style={quietBtn}>Drop</button>}
          <button type="button" disabled={busy} onClick={() => setConfirm("discontinue")} style={{ ...btn, background: tint(D.red, "22"), color: D.red }}>Discontinue</button>
        </div>
      )}

      {confirm && (
        <div role="alertdialog" aria-label={`Confirm ${confirm}`} style={{ marginTop: 10, padding: "10px 12px", border: `1px solid ${D.red}`, borderRadius: 10, color: D.text, fontSize: "0.76rem" }}>
          <div>{CONFIRM_TEXT[confirm].text}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button type="button" disabled={busy} onClick={() => lifecycle(confirm)} style={{ ...btn, background: D.red, color: "#fff" }}>{CONFIRM_TEXT[confirm].action}</button>
            <button type="button" onClick={() => setConfirm(null)} style={quietBtn}>Cancel</button>
          </div>
        </div>
      )}

      {editing && !discontinued && (
        <DetailsEditor listing={listing} basePath={basePath} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />
      )}
    </div>
  );
}

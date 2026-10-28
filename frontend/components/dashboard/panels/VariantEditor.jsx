import { useState } from "react";
import { apiDelete, apiPatch, apiPost, apiPut } from "../../../apiClient.js";
import { useListingRevision } from "../../../hooks/useListingRevision.js";
import { D, tint } from "../theme.js";
import { Chip, DEFAULT_LISTINGS_PATH, btn, inputStyle, noteStyle, quietBtn, serverMessage } from "./listingEditorShared.jsx";

// Variants of a product or food listing (flavour, size ...), each with its own price and stock.
//
// Three modes, picked from the listing:
//  - no listing yet (create form): rows are held by the parent (`rows`/`onRowsChange`) and posted
//    after the listing is created;
//  - draft or rejected: a variant is added with POST .../variants/ and removed with DELETE;
//  - published or dropped: price and stock are LIVE (PATCH .../variants/<id>/live/); adding,
//    removing or re-describing a variant goes into the open revision and needs approval.
const MAX_ATTRIBUTES = 4;
const emptyPair = () => ({ name: "", value: "" });

const pairsOf = (attributes) => {
  const list = Object.entries(attributes || {}).map(([name, value]) => ({ name, value }));
  return list.length ? list : [emptyPair()];
};
const objectOf = (pairs) => Object.fromEntries(pairs.filter(p => p.name.trim() && p.value.trim()).map(p => [p.name.trim(), p.value.trim()]));
const stockOf = (text) => (text === "" || text == null ? null : Number(text));
const describe = (attributes) => Object.entries(attributes || {}).map(([k, v]) => `${k}: ${v}`).join(", ");
const sameAttributes = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function AttributeFields({ pairs, onChange, disabled }) {
  const set = (i, key, value) => onChange(pairs.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)));
  return (
    <div>
      {pairs.map((p, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
          <input aria-label="Attribute name" disabled={disabled} value={p.name} onChange={e => set(i, "name", e.target.value)} placeholder="e.g. Size" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
          <input aria-label="Attribute value" disabled={disabled} value={p.value} onChange={e => set(i, "value", e.target.value)} placeholder="e.g. Large" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
        </div>
      ))}
      {pairs.length < MAX_ATTRIBUTES && !disabled && (
        <button type="button" onClick={() => onChange([...pairs, emptyPair()])} style={{ ...quietBtn, padding: "4px 10px", fontSize: "0.68rem" }}>+ Add attribute</button>
      )}
    </div>
  );
}

// The "new variant" row used in every mode; `onAdd` receives the API body and may throw.
function NewVariantForm({ onAdd, disabled, note }) {
  const [pairs, setPairs] = useState([emptyPair()]);
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("");
  const [error, setError] = useState(null);
  const attributes = objectOf(pairs);
  const ready = Object.keys(attributes).length > 0 && price !== "" && !disabled;

  const add = async () => {
    setError(null);
    try {
      await onAdd({ attributes, price_amount: price, stock_quantity: stockOf(stock) });
      setPairs([emptyPair()]); setPrice(""); setStock("");
    } catch (err) { setError(serverMessage(err, "Could not add that variant. Please try again.")); }
  };

  return (
    <div style={{ marginTop: 10, padding: 10, border: `1px dashed ${D.divider}`, borderRadius: 10 }}>
      <div style={{ color: D.text, fontWeight: 700, fontSize: "0.74rem", marginBottom: 6 }}>New variant</div>
      <AttributeFields pairs={pairs} onChange={setPairs} disabled={disabled} />
      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
        <input aria-label="New variant price" type="number" min={0} step="0.01" disabled={disabled} value={price} onChange={e => setPrice(e.target.value)} placeholder="Price (GHS)" style={{ ...inputStyle, width: 130 }} />
        <input aria-label="New variant stock" type="number" min={0} disabled={disabled} value={stock} onChange={e => setStock(e.target.value)} placeholder="Stock (blank = not tracked)" style={{ ...inputStyle, width: 190 }} />
        <button type="button" onClick={add} disabled={!ready} style={{ ...btn, background: ready ? D.green : D.panelBg2, color: ready ? "#fff" : D.textFaint, cursor: ready ? "pointer" : "default" }}>Add variant</button>
      </div>
      {note && <div style={{ ...noteStyle, marginTop: 4 }}>{note}</div>}
      {error && <div style={{ color: D.red, fontSize: "0.72rem", marginTop: 4 }}>{error}</div>}
    </div>
  );
}

// An existing variant of a draft, rejected, published or dropped listing.
function ExistingRow({ variant, mode, locked, staged, onLive, onRemove, onAttributes }) {
  const [pairs, setPairs] = useState(pairsOf(variant.attributes));
  const [price, setPrice] = useState(variant.price_amount ?? "");
  const [stock, setStock] = useState(variant.stock_quantity ?? "");
  const [error, setError] = useState(null);
  const revisionMode = mode === "revision";
  // Stock tracking cannot be switched on or off from here, so a blank stock is never sent.
  const untracked = variant.stock_quantity == null;
  const saveLive = async () => {
    const body = {};
    if (String(price) !== String(variant.price_amount ?? "")) body.price_amount = price;
    if (!untracked && stock !== "" && String(stock) !== String(variant.stock_quantity)) body.stock_quantity = Number(stock);
    if (Object.keys(body).length === 0) throw Object.assign(new Error("unchanged"), { body: { detail: "You have not changed the price or stock." } });
    await onLive(body);
  };
  const attributesChanged = !sameAttributes(objectOf(pairs), variant.attributes || {});

  const guard = async (call, fallback) => {
    setError(null);
    try { await call(); } catch (err) { setError(serverMessage(err, fallback)); }
  };

  return (
    <div style={{ padding: 10, border: `1px solid ${D.divider}`, borderRadius: 10, marginBottom: 8, opacity: staged === "remove" ? 0.6 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ color: D.text, fontWeight: 800, fontSize: "0.8rem" }}>{variant.label || describe(variant.attributes) || "Variant"}</span>
        {staged === "remove" && <Chip color={D.amber}>Removal waiting for approval</Chip>}
        {staged === "update" && <Chip color={D.amber}>Change waiting for approval</Chip>}
      </div>
      <AttributeFields pairs={pairs} onChange={setPairs} disabled={locked || staged === "remove"} />
      {attributesChanged && revisionMode && (
        <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" disabled={locked} onClick={() => guard(() => onAttributes(objectOf(pairs)), "Could not save that change.")} style={{ ...btn, background: D.gold, color: "#1a1205" }}>Save attribute change</button>
          <Chip color={D.amber}>Needs approval</Chip>
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input aria-label={`Price for ${variant.label || "variant"}`} type="number" min={0} step="0.01" value={price} onChange={e => setPrice(e.target.value)} style={{ ...inputStyle, width: 120 }} />
        <input aria-label={`Stock for ${variant.label || "variant"}`} type="number" min={0} value={stock} disabled={untracked} onChange={e => setStock(e.target.value)} placeholder="Stock not tracked" style={{ ...inputStyle, width: 120 }} />
        <button type="button" onClick={() => guard(saveLive, "Could not save price and stock.")} style={{ ...btn, background: D.gold, color: "#1a1205" }}>Save price &amp; stock</button>
        {revisionMode && <Chip color={D.green}>Live now</Chip>}
        {untracked && <span style={noteStyle}>Stock is not tracked for this variant; tracking cannot be switched on or off here.</span>}
        <button type="button" disabled={locked || staged === "remove"} onClick={() => guard(onRemove, "Could not remove that variant.")} style={{ ...btn, background: tint(D.red, "22"), color: D.red }}>Remove</button>
        {revisionMode && <Chip color={D.amber}>Removal needs approval</Chip>}
      </div>
      {error && <div style={{ color: D.red, fontSize: "0.72rem", marginTop: 4 }}>{error}</div>}
    </div>
  );
}

export default function VariantEditor({ listing = null, basePath = DEFAULT_LISTINGS_PATH, onChanged, rows = [], onRowsChange }) {
  const local = listing == null;
  const revisionMode = !local && ["published", "dropped"].includes(listing.status);
  const mode = local ? "local" : revisionMode ? "revision" : "direct";
  const revision = useListingRevision(listing?.id, { basePath, enabled: revisionMode });
  const waiting = revisionMode && revision.data?.status === "pending";
  const locked = revisionMode && (revision.isLoading || waiting);
  const ops = (revisionMode && revision.data?.variants) || [];
  const [actionError, setActionError] = useState(null);
  const variantsUrl = `${basePath}/${listing?.id}/variants/`;

  const refresh = async () => { if (revisionMode) await revision.refetch(); onChanged?.(); };
  const putOps = async (next) => {
    setActionError(null);
    try { await apiPut(`${basePath}/${listing.id}/revision/`, { variants: next }); await refresh(); }
    catch (err) { setActionError(serverMessage(err, "Could not save that change.")); throw err; }
  };
  const stage = (op) => putOps(op.op === "add" ? [...ops, op] : [...ops.filter(o => o.id !== op.id), op]);
  const unstage = (index) => putOps(ops.filter((_, i) => i !== index)).catch(() => {});

  const addNew = async (body) => {
    if (local) { onRowsChange?.([...rows, { ...body, key: `${Date.now()}-${rows.length}` }]); return; }
    if (revisionMode) { await stage({ op: "add", ...body }); return; }
    await apiPost(variantsUrl, body);
    onChanged?.();
  };

  const live = async (variant, body) => {
    setActionError(null);
    await apiPatch(`${variantsUrl}${variant.id}/live/`, body);
    await refresh();
  };

  const variants = (listing?.variants || []).filter(v => v.is_active !== false);
  const opFor = (id) => ops.find(o => o.id === id);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.8rem" }}>Variants</div>
      <div style={{ ...noteStyle, margin: "2px 0 8px" }}>
        {revisionMode
          ? "Price and stock go live at once. Adding, removing or renaming a variant needs approval."
          : local
            ? "Each variant has its own price and stock. They are saved when you create the listing."
            : "Each variant has its own price and stock."}
      </div>
      {waiting && <div style={{ color: D.amber, fontSize: "0.72rem", marginBottom: 6 }}>This edit is waiting for review.</div>}
      {actionError && <div style={{ color: D.red, fontSize: "0.74rem", marginBottom: 6 }}>{actionError}</div>}

      {local && rows.map((r, i) => (
        <div key={r.key || i} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 10px", border: `1px solid ${D.divider}`, borderRadius: 10, marginBottom: 6, color: D.text, fontSize: "0.76rem" }}>
          <span>{describe(r.attributes)} · GHS {r.price_amount}{r.stock_quantity == null ? "" : ` · ${r.stock_quantity} in stock`}</span>
          <button type="button" onClick={() => onRowsChange?.(rows.filter((_, idx) => idx !== i))} style={{ ...btn, padding: "2px 10px", background: tint(D.red, "22"), color: D.red }}>Remove</button>
        </div>
      ))}

      {!local && variants.length === 0 && ops.filter(o => o.op === "add").length === 0 && (
        <div style={{ color: D.textDim, fontSize: "0.76rem" }}>No variants yet. This listing has a single price and stock.</div>
      )}
      {!local && variants.map(v => (
        <ExistingRow
          key={v.id} variant={v} mode={mode} locked={locked} staged={opFor(v.id)?.op}
          onLive={(body) => live(v, body)}
          onRemove={async () => {
            if (revisionMode) await stage({ op: "remove", id: v.id });
            else { await apiDelete(`${variantsUrl}${v.id}/`); onChanged?.(); }
          }}
          onAttributes={(attributes) => stage({ op: "update", id: v.id, attributes })}
        />
      ))}
      {ops.map((o, i) => o.op === "add" && (
        <div key={`add-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", padding: "6px 10px", border: `1px dashed ${D.amber}`, borderRadius: 10, marginBottom: 6, color: D.text, fontSize: "0.76rem" }}>
          <span>{describe(o.attributes)} · GHS {o.price_amount}</span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Chip color={D.amber}>New: waiting for approval</Chip>
            {!locked && <button type="button" onClick={() => unstage(i)} style={{ ...btn, padding: "2px 10px", background: tint(D.red, "22"), color: D.red }}>Undo</button>}
          </span>
        </div>
      ))}

      <NewVariantForm onAdd={addNew} disabled={locked} note={revisionMode ? "A new variant needs approval before shoppers see it." : null} />
    </div>
  );
}

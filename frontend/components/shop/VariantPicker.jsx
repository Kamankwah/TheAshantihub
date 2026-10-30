import { useState } from "react";
import { C, tint } from "../../theme.js";
import { TABULAR } from "../storefront/storefrontType.js";
import PriceTag from "./PriceTag.jsx";

// A chip row per option axis (Colour, Size, ...) and, below, "Your selection": one row per chosen variant, each with its
// own quantity. Picking a value on every axis adds that variant at quantity 1; a combination with no variant, or one the
// server marks `available: false`, is dashed and cannot be picked. Hovering/focusing a chip (or picking) reports the
// variant it would be through `onPreview({variantId, price, wasPrice, discountPercent, image})` without adding it —
// `image` is the variant's own image when it has one, else null (the API has none today; nothing is invented).
// `selection` is {[variantId]: quantity} and is owned by the parent; every change goes out through `onChange(next)`.

const previewOf = (v) => v && ({
  variantId: v.id,
  price: v.effective_price ?? v.price_amount ?? null,
  wasPrice: v.was_price ?? null,
  discountPercent: v.discount_percent ?? null,
  image: v.image ?? v.image_url ?? null,
});

export default function VariantPicker({ axes, variants = [], onPreview, selection = {}, onChange, currency = "GHS" }) {
  const [chosen, setChosen] = useState({});
  // Variants without declared axes still need to be pickable: one axis made of their labels.
  const useLabels = !Array.isArray(axes) || axes.length === 0;
  const rows = useLabels ? [{ name: "Option", values: variants.map((v) => v.label) }] : axes;
  const valueOf = (v, axis) => (useLabels ? v.label : v.attributes?.[axis]);

  const matching = (picks) => variants.filter((v) => Object.entries(picks).every(([axis, value]) => valueOf(v, axis) === value));
  const usable = (v) => v.available !== false;
  const resolve = (picks) => (rows.every((a) => picks[a.name] != null) ? matching(picks).find(usable) || null : null);
  // A value is dashed only when no available variant has it at all; a value that merely conflicts with the other picks
  // stays pickable (see `withPick`), so a sparse matrix never strands the shopper.
  const optionOpen = (axis, value) => matching({ [axis]: value }).some(usable);
  // Picks after choosing `value`: the other picks stay only while a variant still matches them all; else they are dropped.
  const withPick = (axis, value) => {
    const keep = { ...chosen, [axis]: value };
    return matching(keep).some(usable) ? keep : { [axis]: value };
  };

  const chosenVariant = resolve(chosen);
  const emit = (next) => onChange && onChange(next);

  const pick = (axis, value) => {
    if (!optionOpen(axis, value)) return;
    const picks = withPick(axis, value);
    setChosen(picks);
    const v = resolve(picks);
    if (v) {
      onPreview && onPreview(previewOf(v));
      if (!(selection[v.id] > 0)) emit({ ...selection, [v.id]: 1 });
    }
  };
  const peek = (axis, value) => {
    if (!onPreview || !optionOpen(axis, value)) return;
    const v = resolve(withPick(axis, value));
    if (v) onPreview(previewOf(v));
  };
  const unpeek = () => { if (onPreview) onPreview(previewOf(chosenVariant)); };

  const setQty = (v, qty) => {
    const next = { ...selection };
    if (qty > 0) next[v.id] = qty; else delete next[v.id];
    emit(next);
  };

  const picked = variants.filter((v) => selection[v.id] > 0);

  return (
    <div data-testid="variant-picker">
      {rows.map((axis) => (
        <div key={axis.name} role="group" aria-label={axis.name} style={{ marginBottom: 12 }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 700, color: C.inkDim, marginBottom: 6 }}>
            {axis.name}{chosen[axis.name] ? <span style={{ color: C.ink }}>: {chosen[axis.name]}</span> : null}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {axis.values.map((value) => {
              const open = optionOpen(axis.name, value);
              const on = chosen[axis.name] === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  aria-disabled={!open}
                  onClick={() => pick(axis.name, value)}
                  onMouseEnter={() => peek(axis.name, value)}
                  onFocus={() => peek(axis.name, value)}
                  onMouseLeave={unpeek}
                  onBlur={unpeek}
                  style={{
                    minHeight: 40, padding: "6px 14px", borderRadius: 10, fontFamily: "inherit", fontSize: "0.85rem", fontWeight: on ? 800 : 600,
                    background: on ? tint(C.gold, "22") : C.surface,
                    color: open ? C.ink : C.inkFaint,
                    borderWidth: on ? 2 : 1, borderStyle: open ? "solid" : "dashed", borderColor: on ? C.gold : open ? C.line : C.inkFaint,
                    cursor: open ? "pointer" : "not-allowed",
                  }}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {picked.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: "0.82rem", fontWeight: 800, color: C.ink, marginBottom: 8 }}>Your selection</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {picked.map((v) => {
              const qty = selection[v.id];
              const max = v.stock_quantity;
              const atMax = max != null && qty >= max;
              const image = v.image ?? v.image_url ?? null;
              return (
                <div key={v.id} data-testid="selection-row" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 10px" }}>
                  {image && <img src={image} alt="" width={40} height={40} style={{ objectFit: "cover", borderRadius: 8 }} />}
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <div style={{ fontSize: "0.85rem", fontWeight: 700, color: C.ink }}>{v.label}</div>
                    <PriceTag price={v.effective_price ?? v.price_amount} wasPrice={v.was_price} discountPercent={v.discount_percent} currency={currency} size="1rem" />
                    {atMax && <div style={{ fontSize: "0.72rem", color: C.warnInk, fontWeight: 700 }}>Only {max} left</div>}
                  </div>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <button type="button" aria-label={`Decrease quantity of ${v.label}`} onClick={() => setQty(v, qty - 1)} style={stepBtn}>−</button>
                    <span data-testid="qty-value" style={{ minWidth: 28, textAlign: "center", fontWeight: 800, color: C.ink, ...TABULAR }}>{qty}</span>
                    <button type="button" aria-label={`Increase quantity of ${v.label}`} disabled={atMax} onClick={() => setQty(v, qty + 1)} style={{ ...stepBtn, opacity: atMax ? 0.4 : 1, cursor: atMax ? "not-allowed" : "pointer" }}>+</button>
                  </div>
                  <button type="button" aria-label={`Remove ${v.label}`} onClick={() => setQty(v, 0)} style={{ background: "none", border: "none", color: C.inkDim, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", minHeight: 32 }}>Remove</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const stepBtn = { width: 34, height: 34, borderRadius: 8, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontSize: "1rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" };

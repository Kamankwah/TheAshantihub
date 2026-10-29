import { useEffect, useState } from "react";
import { C, tint } from "../../theme.js";
import { useAddToCartBulk } from "../../hooks/useAddToCartBulk.js";
import { useCanBuy } from "../../hooks/useCanBuy.js";
import { useCartGuard } from "../../hooks/useCartGuard.js";
import { useStaffGate } from "../../hooks/useStaffGate.js";
import StaffGateNotice from "../StaffGateNotice.jsx";
import PriceTag from "./PriceTag.jsx";

// A counted stock at or below this reads "Only N left" (the number itself always comes from the server).
const LOW_STOCK_AT = 5;

const cents = (amount) => Math.round((parseFloat(amount) || 0) * 100);
const money = (c) => (c / 100).toFixed(2);

// The product page's buy box. Everything it says comes from the listing the server sent:
// price (`effective_price`, with `was_price`/`discount_percent` only when the server sends them), the stock line, "Sold by"
// the business name, and the listing's own warranty/return fields (a blank one renders nothing). No delivery date is
// shown — there is no ETA source — and there is no way to contact the business: "Report an issue" and "Contact Support"
// both go to AshantiHub Support through `onMessage(item)`.
//
// Props: `item` (GET /api/listings/<id>/), `user`, `selection` ({[variantId]: quantity}, owned by the page and edited
// in VariantPicker), `currency` (display only), `onMessage(item)`, `onSaveToList(item)`, `onOpenSeller(ownerId)`,
// `onShowDirect()` (the "More from Ashanti Direct" link: the page applies the browse filter sold_by=direct, i.e. the
// `directOnly` filter), `onSignIn()` (a signed-out visitor pressing Add to cart), `onAdded(response)` after a successful add.
// Add to cart is the one gold action; it is disabled with the exact reason (a business account, opening gate label from useCanBuy, out of stock,
// no price, no options chosen, or the server's cart-guard message). Staff sessions get the staff notice instead of an add.
export default function BuyBox({ item, user, selection = {}, currency = "GHS", onMessage, onSaveToList, onOpenSeller, onShowDirect, onSignIn, onAdded }) {
  const variants = Array.isArray(item?.variants) ? item.variants : [];
  const hasVariants = variants.length > 0;
  const { canBuy, label: opensLabel } = useCanBuy();
  const staffGate = useStaffGate(user);
  const isCustomer = user?.accountType === "customer";
  // Businesses sell, customers buy: a signed-in business account cannot add (the server refuses it too).
  const isBusinessAccount = !!user && !staffGate.isStaff && !isCustomer;
  const guard = useCartGuard(item?.id ?? null, { enabled: isCustomer && item?.id != null });
  const blocked = guard.data?.listing?.blocked || null;
  const cart = useAddToCartBulk();
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (!added) return undefined;
    const t = setTimeout(() => setAdded(false), 2000);
    return () => clearTimeout(t);
  }, [added]);

  const lines = variants.filter((v) => selection[v.id] > 0);
  const subtotal = lines.reduce((sum, v) => sum + cents(v.effective_price ?? v.price_amount) * selection[v.id], 0);
  const count = lines.reduce((n, v) => n + selection[v.id], 0);

  let stock;
  if (hasVariants) stock = variants.some((v) => v.available !== false) ? "in" : "out";
  else if (item.stock_quantity === 0) stock = "out";
  else if (item.stock_quantity != null && item.stock_quantity <= LOW_STOCK_AT) stock = "low";
  else stock = "in";
  const stockText = stock === "out" ? "Out of stock" : stock === "low" ? `Only ${item.stock_quantity} left` : "In stock";

  const unitPrice = item.effective_price ?? item.price_amount ?? null;
  const priced = hasVariants ? variants.some((v) => (v.effective_price ?? v.price_amount) != null) : unitPrice != null;

  // The one reason Add to cart cannot be pressed, shown as its label.
  let reason = null;
  if (isBusinessAccount) reason = "Customer accounts only";
  else if (!canBuy) reason = opensLabel || "Opens soon";
  else if (stock === "out") reason = "Out of stock";
  else if (!priced) reason = "No price set";
  else if (hasVariants && lines.length === 0) reason = "Choose options";
  const disabled = Boolean(reason) || Boolean(blocked) || cart.busy;

  async function handleAdd() {
    if (disabled) return;
    if (!user) { if (onSignIn) { onSignIn(); return; } }
    if (staffGate.blocked()) return;
    const ok = await cart.add(item.id, hasVariants ? selection : {});
    if (ok) { setAdded(true); if (onAdded) onAdded(); }
  }

  const owner = item.business_owner;
  const ownerName = owner?.name || owner?.full_name;
  // Only a warranty the seller declared; `false` is also the default of a field never filled in, so it says nothing.
  const warranty = item.has_warranty === true ? (item.warranty_details || "This product comes with a warranty.") : null;
  const returns = typeof item.return_policy === "string" && item.return_policy.trim() ? item.return_policy : null;

  return (
    <aside data-testid="buy-box" style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 18, color: C.ink }}>
      {hasVariants && lines.length === 0 ? (
        <div style={{ fontSize: "1.1rem", fontWeight: 800 }}>Choose options</div>
      ) : hasVariants ? (
        <div data-testid="buybox-subtotal">
          <div style={{ fontSize: "0.78rem", color: C.inkDim, fontWeight: 700, marginBottom: 2 }}>Subtotal ({count} {count === 1 ? "item" : "items"})</div>
          <PriceTag price={money(subtotal)} currency={currency} />
        </div>
      ) : (
        <PriceTag price={unitPrice} wasPrice={item.was_price} discountPercent={item.discount_percent} currency={currency} />
      )}

      <p style={{ margin: "10px 0 0", fontSize: "0.8rem", color: C.inkDim, lineHeight: 1.5 }}>
        Delivery fee is worked out at checkout from your GhanaPost address.
      </p>
      <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: C.inkDim, lineHeight: 1.5 }}>Pay with mobile money or your AshantiHub wallet</p>

      <div style={{ marginTop: 10, fontSize: "0.95rem", fontWeight: 800, color: stock === "out" ? C.danger : stock === "low" ? C.warnInk : C.trust }}>{stockText}</div>

      {ownerName && (
        <div style={{ marginTop: 10, fontSize: "0.82rem", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <span style={{ color: C.inkDim }}>
            Sold by{" "}
            {owner?.id != null ? (
              <a
                href={`/seller/${owner.id}`}
                onClick={(e) => { if (onOpenSeller) { e.preventDefault(); onOpenSeller(owner.id); } }}
                style={{ color: C.ink, fontWeight: 800 }}
              >{ownerName}</a>
            ) : <strong style={{ color: C.ink }}>{ownerName}</strong>}
          </span>
          {owner?.is_ashanti_direct === true && (
            <>
              <span style={{ background: tint(C.gold, "22"), color: C.ink, border: `1px solid ${tint(C.gold, "66")}`, borderRadius: 20, padding: "2px 9px", fontSize: "0.68rem", fontWeight: 800 }}>Ashanti Direct</span>
              {onShowDirect && (
                <button type="button" onClick={onShowDirect} style={{ background: "none", border: "none", padding: 0, color: C.info, fontWeight: 700, fontSize: "0.78rem", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>More from Ashanti Direct</button>
              )}
            </>
          )}
        </div>
      )}

      {blocked && (
        <div role="status" style={{ marginTop: 12, background: C.warnBg, color: C.warnInk, border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 12px", fontSize: "0.8rem", lineHeight: 1.5 }}>
          {blocked.code !== "not_deliverable" && (
            <div style={{ fontWeight: 900, marginBottom: 2 }}>{blocked.code === "food_far" || blocked.code === "food_unlocated" ? "Too far for this delivery" : "Delivery limit reached"}</div>
          )}
          {blocked.detail}
        </div>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={handleAdd}
        style={{
          marginTop: 14, width: "100%", minHeight: 46, borderRadius: 24, fontFamily: "inherit", fontSize: "0.9rem", fontWeight: 900,
          background: added ? C.trust : disabled ? C.surface3 : C.gold,
          color: added ? C.white : disabled ? C.inkFaint : C.darkBrown,
          border: disabled ? `1px solid ${C.line}` : "none",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        {/* The confirmation outlasts a selection the page clears after the add (the reason is then "Choose options"). */}
        {added ? "Added to cart ✓" : reason || (cart.busy ? "Adding…" : "Add to cart")}
      </button>
      {cart.actionError && <div role="alert" style={{ marginTop: 8, color: C.errInk, background: C.errBg, borderRadius: 10, padding: "8px 10px", fontSize: "0.78rem", lineHeight: 1.5 }}>{cart.actionError}</div>}
      {staffGate.shownFor && <StaffGateNotice style={{ marginTop: 10 }} />}

      {onSaveToList && (
        <button type="button" onClick={() => onSaveToList(item)} style={secondary}>Add to list</button>
      )}

      {(warranty || returns) && (
        <dl style={{ margin: "14px 0 0", fontSize: "0.8rem", lineHeight: 1.5 }}>
          {warranty && (<><dt style={dt}>Warranty</dt><dd style={dd}>{warranty}</dd></>)}
          {returns && (<><dt style={dt}>Returns</dt><dd style={dd}>{returns}</dd></>)}
        </dl>
      )}

      {onMessage && (
        <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 14 }}>
          <button type="button" onClick={() => onMessage(item)} style={linkBtn}>Report an issue with this item</button>
          <button type="button" onClick={() => onMessage(item)} style={linkBtn}>Contact Support</button>
        </div>
      )}

      {/* Reserved for Plan 6F (other sellers of this product). */}
      <section id="other-sellers" />
    </aside>
  );
}

const secondary = { marginTop: 10, width: "100%", minHeight: 42, borderRadius: 24, background: C.surface2, color: C.ink, border: `1px solid ${C.line}`, fontFamily: "inherit", fontSize: "0.85rem", fontWeight: 700, cursor: "pointer" };
const linkBtn = { background: "none", border: "none", padding: 0, color: C.info, fontWeight: 700, fontSize: "0.78rem", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", minHeight: 32 };
const dt = { fontWeight: 800, color: C.inkDim, marginTop: 6 };
const dd = { margin: 0, color: C.ink, whiteSpace: "pre-wrap" };

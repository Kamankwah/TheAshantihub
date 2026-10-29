import { useState } from "react";
import { C } from "../theme.js";
import { useQueryClient } from "@tanstack/react-query";
import { useCart } from "../hooks/useCart.js";
import { apiPatch, apiDelete } from "../apiClient.js";

// ─── CartDrawer ─────────────────────────────────────────────────────────────
// The slim mini-cart (Marketplace Plan 4). It opens after a product-page add (App.jsx) and shows the cart lines with a
// quantity stepper and remove, the subtotal, and "Go to cart". Checkout itself (delivery, GhanaPost address, payment)
// lives at /checkout (components/shop/CheckoutPage.jsx); nothing here collects an address or takes a payment.
//
// Self-contained data-wise (calls useCart() itself, same convention as ListingDetailPage owning its own
// useListing(id)). Mutations are plain apiPatch/apiDelete calls inside the handler, try/catch into a local
// actionError, refetch() on success (CLAUDE.md), never useMutation.
//
// Amounts are the cart's own GHS strings, always shown as GHS: what is charged is GHS whatever the display currency
// (Ruling P26), so there is no currency conversion here.
export default function CartDrawer({ onClose, onGoToCart }) {
  const { data: cart, isLoading, isError, refetch } = useCart();
  const queryClient = useQueryClient();
  const refreshGuard = () => { queryClient.invalidateQueries({ queryKey: ["cart-guard"] }); queryClient.invalidateQueries({ queryKey: ["listings"] }); };
  const [actionError, setActionError] = useState(null);
  const [pendingId, setPendingId] = useState(null);

  const items = cart?.items || [];
  const count = items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);

  const formatAmount = (amount) => `GHS ${(parseFloat(amount) || 0).toFixed(2)}`;

  const updateQuantity = async (item, nextQuantity) => {
    if (nextQuantity < 1) return;
    setActionError(null);
    setPendingId(item.id);
    try {
      await apiPatch(`/api/cart/items/${item.id}/`, { quantity: nextQuantity });
      await refetch();
      refreshGuard();
    } catch (err) {
      setActionError("Could not update the quantity for this item.");
    } finally {
      setPendingId(null);
    }
  };

  const removeItem = async (item) => {
    setActionError(null);
    setPendingId(item.id);
    try {
      await apiDelete(`/api/cart/items/${item.id}/`);
      await refetch();
      refreshGuard();
    } catch (err) {
      setActionError("Could not remove this item from your cart.");
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999 }} onClick={onClose}>
      <div
        style={{ position: "absolute", top: 65, right: 16, background: C.surface, borderRadius: 16, width: 340, maxHeight: "82vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800, color: C.ink, fontSize: "0.85rem" }}>🛒 Your Cart {items.length > 0 ? `(${items.length})` : ""}</div>
          <button onClick={onClose} aria-label="Close cart" style={{ background: "none", border: "none", cursor: "pointer", color: C.inkFaint, fontSize: "1.1rem" }}>✕</button>
        </div>

        {isLoading && (
          <div style={{ padding: "20px", textAlign: "center", color: C.inkFaint, fontSize: "0.78rem" }}>Loading your cart…</div>
        )}

        {isError && (
          <div style={{ padding: "20px", textAlign: "center", color: C.errInk, fontSize: "0.78rem" }}>
            Could not load your cart.
            <div><button onClick={() => refetch()} style={{ marginTop: 8, background: "none", border: `1px solid ${C.kente1}`, color: C.danger, borderRadius: 20, padding: "4px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>Retry</button></div>
          </div>
        )}

        {!isLoading && !isError && (
          <>
            {actionError && <div style={{ margin: "10px 14px 0", background: C.errBg, color: C.errInk, borderRadius: 10, padding: "8px 12px", fontSize: "0.72rem" }}>{actionError}</div>}

            {items.length === 0 && (
              <div style={{ padding: "20px", textAlign: "center", color: C.inkFaint, fontSize: "0.78rem" }}>Your cart is empty.<br />Add items from the Business tab to get started.</div>
            )}

            {items.map((item) => (
              <div key={item.id} style={{ padding: "10px 14px", borderBottom: `1px solid ${C.line}`, display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.78rem", color: C.ink }}>{item.listing_name}{item.variant_label ? ` (${item.variant_label})` : ""}</div>
                  <div style={{ fontSize: "0.65rem", color: C.inkDim }}>{formatAmount(item.unit_price_snapshot)} each</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <button
                      disabled={pendingId === item.id || item.quantity <= 1}
                      onClick={() => updateQuantity(item, item.quantity - 1)}
                      aria-label={`Decrease quantity of ${item.listing_name}`}
                      style={stepperBtnStyle}
                    >−</button>
                    <span style={{ fontSize: "0.78rem", fontWeight: 700, minWidth: 18, textAlign: "center" }}>{item.quantity}</span>
                    <button
                      disabled={pendingId === item.id}
                      onClick={() => updateQuantity(item, item.quantity + 1)}
                      aria-label={`Increase quantity of ${item.listing_name}`}
                      style={stepperBtnStyle}
                    >+</button>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, fontSize: "0.78rem", color: C.price, fontVariantNumeric: "tabular-nums" }}>{formatAmount(item.line_total)}</div>
                  <button
                    disabled={pendingId === item.id}
                    onClick={() => removeItem(item)}
                    aria-label={`Remove ${item.listing_name} from cart`}
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.danger, fontSize: "0.9rem", marginTop: 4 }}
                  >✕</button>
                </div>
              </div>
            ))}

            <div style={{ padding: "14px 16px", borderTop: `1px solid ${C.line}` }}>
              {items.length > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", fontWeight: 800, color: C.ink, marginBottom: 10 }}>
                  <span>{`Subtotal (${count} ${count === 1 ? "item" : "items"})`}</span>
                  <span data-testid="mini-cart-subtotal" style={{ color: C.price, fontVariantNumeric: "tabular-nums" }}>{formatAmount(cart?.total)}</span>
                </div>
              )}
              {onGoToCart && (
                <button
                  type="button"
                  onClick={onGoToCart}
                  style={{ width: "100%", background: C.gold, color: C.darkBrown, border: "none", borderRadius: 24, padding: "11px", fontWeight: 900, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}
                >Go to cart</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const stepperBtnStyle = {
  width: 22,
  height: 22,
  borderRadius: "50%",
  border: `1px solid ${C.line}`,
  background: C.surface,
  color: C.ink,
  fontWeight: 800,
  fontSize: "0.85rem",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  lineHeight: 1,
};

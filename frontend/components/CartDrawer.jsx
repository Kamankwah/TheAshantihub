import { useState } from "react";
import { C, CURRENCIES } from "../theme.js";
import { useCart } from "../hooks/useCart.js";
import { apiPatch, apiPost, apiDelete } from "../apiClient.js";

// ─── CartDrawer ─────────────────────────────────────────────────────────────
// Customer cart (docs/BUSINESS_EVENTS_ROADMAP.md Phase 4). Mirrors App.jsx's
// existing favourites drawer (`FavsDrawer`) for visual/interaction
// consistency — same fixed-inset backdrop + top-right anchored panel — but
// extracted as its own file under frontend/components/ per this app's stated
// direction of pulling things out of the App.jsx monolith.
//
// Self-contained data-wise (calls useCart() itself, same convention as
// ListingDetailPage owning its own useListing(id)) rather than having
// AshantiHub thread cart data down as props. AshantiHub separately calls
// useCart() too, for the Navbar badge count — same query key, so React Query
// shares the cache rather than double-fetching.
//
// Mutations follow this codebase's established "plain apiPost/apiPatch/
// apiDelete call inside the handler, try/catch into a local actionError
// state, refetch() on success" convention (CLAUDE.md) rather than useMutation.
//
// `PaymentComponent` is passed down as a prop (App.jsx's MoMoPayment) rather
// than imported directly, same "avoid an App.jsx <-> components/ circular
// import" convention as ListingDetailPage's `CardComponent` prop.
//
// Amounts are shown in raw GHS from the cart response (unit_price_snapshot/
// line_total/total) — the backend is GHS-only (no currency field anywhere in
// the Phase 4 contract). `CURRENCIES` (exported from theme.js alongside `C`,
// for exactly this reason) applies the same client-side display conversion
// Card.jsx's displayPrice() already uses elsewhere, so the drawer respects
// whichever currency the navbar selector is set to rather than reinventing
// its own rate table.
export default function CartDrawer({ onClose, user, currency = "GHS", PaymentComponent }) {
  const { data: cart, isLoading, isError, refetch } = useCart();
  const [actionError, setActionError] = useState(null);
  const [pendingId, setPendingId] = useState(null);
  const [step, setStep] = useState("cart"); // "cart" | "confirm" | "confirmation"
  const [showPayment, setShowPayment] = useState(false);
  const [checkoutError, setCheckoutError] = useState(null);
  const [order, setOrder] = useState(null);
  // Snapshotted when "Confirm & Pay" opens the payment modal, rather than
  // deriving PaymentComponent's `amount` prop live from `cart?.total` on
  // every render — handlePaymentSuccess's post-checkout refetch() empties
  // the cart while the modal is still open, which would otherwise drop the
  // displayed amount to 0 right as the success screen appears.
  const [checkoutAmount, setCheckoutAmount] = useState(0);

  const items = cart?.items || [];

  const formatAmount = (amount) => {
    const value = parseFloat(amount) || 0;
    if (currency === "GHS") return `GHS ${value.toFixed(2)}`;
    const rate = CURRENCIES[currency] ?? 1;
    return `${currency} ${(value * rate).toFixed(2)}`;
  };

  const updateQuantity = async (item, nextQuantity) => {
    if (nextQuantity < 1) return;
    setActionError(null);
    setPendingId(item.id);
    try {
      await apiPatch(`/api/cart/items/${item.id}/`, { quantity: nextQuantity });
      await refetch();
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
    } catch (err) {
      setActionError("Could not remove this item from your cart.");
    } finally {
      setPendingId(null);
    }
  };

  const handlePaymentSuccess = async (ref) => {
    setCheckoutError(null);
    try {
      const response = await apiPost("/api/orders/checkout/", {});
      // Hubtel integration (docs/HUBTEL_INTEGRATION.md) — once
      // payments_provider is "hubtel", OrderCheckoutView returns
      // {mode:"redirect", checkout_url} instead of the placed order, since
      // nothing is actually paid for yet. Redirect the browser to Hubtel's
      // hosted checkout rather than treating this as an already-placed
      // order — the order only becomes PAID once the webhook confirms it.
      if (response?.mode === "redirect") {
        window.location.href = response.checkout_url;
        return;
      }
      setOrder(response);
      refetch();
    } catch (err) {
      setCheckoutError("Payment was confirmed but we couldn't place your order. Please contact support with reference " + ref + ".");
    }
  };

  const handlePaymentClose = () => {
    setShowPayment(false);
    if (order) setStep("confirmation");
  };

  const startOver = () => {
    setOrder(null);
    setCheckoutError(null);
    setStep("cart");
  };

  return (
    <>
    <div style={{ position: "fixed", inset: 0, zIndex: 999 }} onClick={onClose}>
      <div
        style={{ position: "absolute", top: 65, right: 16, background: "white", borderRadius: 16, width: 340, maxHeight: "82vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 800, color: C.darkBrown, fontSize: "0.85rem" }}>🛒 Your Cart {items.length > 0 ? `(${items.length})` : ""}</div>
          <button onClick={onClose} aria-label="Close cart" style={{ background: "none", border: "none", cursor: "pointer", color: "#999", fontSize: "1.1rem" }}>✕</button>
        </div>

        {isLoading && (
          <div style={{ padding: "20px", textAlign: "center", color: "#aaa", fontSize: "0.78rem" }}>Loading your cart…</div>
        )}

        {isError && (
          <div style={{ padding: "20px", textAlign: "center", color: "#dc2626", fontSize: "0.78rem" }}>
            Could not load your cart.
            <div><button onClick={() => refetch()} style={{ marginTop: 8, background: "none", border: `1px solid ${C.kente1}`, color: C.kente1, borderRadius: 20, padding: "4px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>Retry</button></div>
          </div>
        )}

        {!isLoading && !isError && step === "cart" && (
          <>
            {actionError && <div style={{ margin: "10px 14px 0", background: "#fee2e2", color: "#dc2626", borderRadius: 10, padding: "8px 12px", fontSize: "0.72rem" }}>{actionError}</div>}

            {items.length === 0 && (
              <div style={{ padding: "20px", textAlign: "center", color: "#aaa", fontSize: "0.78rem" }}>Your cart is empty.<br />Add items from the Business tab to get started.</div>
            )}

            {items.map((item) => (
              <div key={item.id} style={{ padding: "10px 14px", borderBottom: "1px solid #f9f9f9", display: "flex", gap: 10, alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.78rem", color: C.darkBrown }}>{item.listing_name}</div>
                  <div style={{ fontSize: "0.65rem", color: "#888" }}>{formatAmount(item.unit_price_snapshot)} each</div>
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
                  <div style={{ fontWeight: 800, fontSize: "0.78rem", color: C.darkBrown }}>{formatAmount(item.line_total)}</div>
                  <button
                    disabled={pendingId === item.id}
                    onClick={() => removeItem(item)}
                    aria-label={`Remove ${item.listing_name} from cart`}
                    style={{ background: "none", border: "none", cursor: "pointer", color: C.kente1, fontSize: "0.9rem", marginTop: 4 }}
                  >✕</button>
                </div>
              </div>
            ))}

            {items.length > 0 && (
              <div style={{ padding: "14px 16px", borderTop: "1px solid #f0f0f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", fontWeight: 800, color: C.darkBrown, marginBottom: 10 }}>
                  <span>Total</span>
                  <span>{formatAmount(cart?.total)}</span>
                </div>
                <button
                  onClick={() => setStep("confirm")}
                  style={{ width: "100%", background: C.gold, color: C.darkBrown, border: "none", borderRadius: 24, padding: "11px", fontWeight: 900, fontSize: "0.82rem", cursor: "pointer", fontFamily: "inherit" }}
                >Checkout →</button>
              </div>
            )}
          </>
        )}

        {!isLoading && !isError && step === "confirm" && (
          <div style={{ padding: "16px" }}>
            <div style={{ fontWeight: 800, color: C.darkBrown, fontSize: "0.85rem", marginBottom: 10 }}>Confirm your order</div>
            {items.map((item) => (
              <div key={`confirm-${item.id}`} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.76rem", color: "#555", marginBottom: 6 }}>
                <span>{item.listing_name} × {item.quantity}</span>
                <span style={{ fontWeight: 700, color: C.darkBrown }}>{formatAmount(item.line_total)}</span>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, color: C.kente2, fontSize: "0.9rem", borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8, marginBottom: 16 }}>
              <span>Total</span>
              <span>{formatAmount(cart?.total)}</span>
            </div>
            {checkoutError && <div style={{ background: "#fee2e2", color: "#dc2626", borderRadius: 10, padding: "8px 12px", fontSize: "0.72rem", marginBottom: 12 }}>{checkoutError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setStep("cart")} style={{ flex: 1, background: "#f0f0f0", color: "#666", border: "none", borderRadius: 20, padding: "10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>← Back</button>
              <button onClick={() => { setCheckoutAmount(parseFloat(cart?.total) || 0); setShowPayment(true); }} style={{ flex: 2, background: C.kente2, color: "white", border: "none", borderRadius: 20, padding: "10px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>Confirm & Pay</button>
            </div>
          </div>
        )}

        {!isLoading && !isError && step === "confirmation" && order && (
          <div style={{ padding: "20px 16px", textAlign: "center" }}>
            <div style={{ fontSize: "2.4rem", marginBottom: 10 }}>✅</div>
            <div style={{ fontWeight: 900, color: C.kente2, fontSize: "0.95rem", marginBottom: 6 }}>Order Confirmed!</div>
            <div style={{ background: "#f9f9f9", borderRadius: 12, padding: "12px 14px", marginBottom: 14, textAlign: "left", fontSize: "0.74rem", lineHeight: 1.8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>Order Ref</span><span style={{ fontWeight: 700 }}>#{order.id}</span></div>
              {order.items?.map((oi, i) => (
                <div key={oi.id ?? i} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#888" }}>{oi.listing_name || oi.listing} × {oi.quantity}</span>
                  <span>{formatAmount(oi.line_total)}</span>
                </div>
              ))}
              <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #e0e0e0", paddingTop: 6, marginTop: 4 }}>
                <span style={{ fontWeight: 800 }}>Total Paid</span>
                <span style={{ fontWeight: 900, color: C.kente2 }}>{formatAmount(order.total_amount)}</span>
              </div>
            </div>
            <button onClick={startOver} style={{ background: C.gold, color: C.darkBrown, border: "none", borderRadius: 24, padding: "10px 22px", fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>Continue Shopping</button>
          </div>
        )}
      </div>
    </div>

    {/* Rendered as a sibling of (not nested inside) the backdrop above —
        PaymentComponent (MoMoPayment) is its own fixed-inset overlay with a
        higher z-index; nesting it inside the cart backdrop's onClick={onClose}
        div would bubble every click inside the payment modal up to that
        handler and close the whole cart drawer mid-payment. */}
    {showPayment && PaymentComponent && (
      <PaymentComponent
        amount={checkoutAmount}
        purpose="AshantiHub Order Checkout"
        businessName={user?.fullName || ""}
        onSuccess={handlePaymentSuccess}
        onClose={handlePaymentClose}
      />
    )}
    </>
  );
}

const stepperBtnStyle = {
  width: 22,
  height: 22,
  borderRadius: "50%",
  border: "1px solid #ddd",
  background: "white",
  color: C.darkBrown,
  fontWeight: 800,
  fontSize: "0.85rem",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  lineHeight: 1,
};

import { useEffect, useState } from "react";
import { C, CURRENCIES } from "../theme.js";
import { useQueryClient } from "@tanstack/react-query";
import { useCart } from "../hooks/useCart.js";
import { useCartGuard } from "../hooks/useCartGuard.js";
import { useDeliveryPreview } from "../hooks/useDeliveryPreview.js";
import { formatAccraDayTime } from "../lib/accraTime.js";
import { apiPatch, apiPost, apiDelete } from "../apiClient.js";
import { apiErrorMessage } from "../lib/apiErrorMessage.js";
import { quoteCart, usePublicPromos } from "../hooks/usePublicPromos.js";
import { useStaffGate } from "../hooks/useStaffGate.js";
import { useCanBuy } from "../hooks/useCanBuy.js";
import LocationPicker from "./LocationPicker.jsx";
import StaffGateNotice from "./StaffGateNotice.jsx";

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
  const queryClient = useQueryClient();
  // The delivery limits (backend cart/guard.py): `any` blocks every checkout, `door_to_door` only a rider delivery.
  const { data: guard, isError: guardError, isPending: guardPending } = useCartGuard(null, { enabled: user?.accountType === "customer" });
  const refreshGuard = () => { queryClient.invalidateQueries({ queryKey: ["cart-guard"] }); queryClient.invalidateQueries({ queryKey: ["listings"] }); };
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
  // Delivery method chosen before paying (Wave F). Door-to-door needs an
  // address + phone; store pickup needs neither.
  const [deliveryMethod, setDeliveryMethod] = useState("store_pickup");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryPhone, setDeliveryPhone] = useState("");
  const [deliveryLat, setDeliveryLat] = useState(null);
  const [deliveryLng, setDeliveryLng] = useState(null);
  const doorToDoorFilled = deliveryMethod !== "door_to_door" || (deliveryAddress.trim() && deliveryPhone.trim());
  // App.jsx only ever opens the cart for a customer; this is the
  // defence-in-depth layer so checkout itself refuses a staff session with
  // the shared staff notice.
  const staffGate = useStaffGate(user);
  // Before the marketplace opens the cart still shows, but checkout is greyed
  // with "Opens <D Mon>" unless this account may buy (see useCanBuy).
  const { canBuy, label: opensLabel } = useCanBuy();

  const items = cart?.items || [];

  // Checkout promotions (flash-sale prices and a coupon code) exist only while the owner has switched
  // them on; with the switch off none of this renders and the cart is exactly as before.
  const { data: promos } = usePublicPromos();
  const promosOn = !!promos?.enabled;
  const [couponInput, setCouponInput] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  // The delivery point (method + pin) the held `quote` was fetched for, and whether the last request failed.
  const [quotedFor, setQuotedFor] = useState(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const pinKey = `${deliveryMethod}:${deliveryLat}:${deliveryLng}`;
  const cartSignature = items.map((i) => `${i.id}:${i.quantity}`).join(",");
  // After-hours notice: independent of promotions (its own endpoint). Shown only for a rider delivery the server says is
  // deferred; nothing while loading or if the read fails. Platform hours are never presented as the shop's own.
  const { data: preview } = useDeliveryPreview("door_to_door", { enabled: user?.accountType === "customer" && deliveryMethod === "door_to_door" && items.length > 0, cartKey: cartSignature });
  const deferredFrom = deliveryMethod === "door_to_door" && preview?.deferred ? formatAccraDayTime(preview.delivery_from) : null;
  useEffect(() => {
    if (!promosOn || items.length === 0) { setQuote(null); return; }
    let live = true;
    setQuoting(true);
    setQuoteFailed(false);
    // A quote for another pin or method must never answer for this one: drop it as soon as the pin moves.
    if (quotedFor !== pinKey) { setQuote(null); setQuotedFor(null); }
    quoteCart({
      coupon_code: appliedCode, delivery_phone: deliveryMethod === "door_to_door" ? deliveryPhone : "",
      delivery_method: deliveryMethod, ...(deliveryMethod === "door_to_door" && deliveryLat != null ? { delivery_lat: deliveryLat, delivery_lng: deliveryLng } : {}),
    })
      .then((q) => { if (live) { setQuote(q); setQuotedFor(pinKey); setCouponError(q.coupon_error || ""); if (q.coupon_error) setAppliedCode(""); } })
      .catch(() => { if (live) { setQuote(null); setQuotedFor(null); setQuoteFailed(true); } })
      .finally(() => { if (live) setQuoting(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promosOn, cartSignature, appliedCode, deliveryMethod, deliveryLat, deliveryLng]);
  // Delivery as the server will charge it (the quote mirrors checkout): fee is null until a delivery point
  // is chosen, "0.00" with waived=true when a business's free-delivery promo covers the whole order.
  const delivery = promosOn ? quote?.delivery : null;
  const itemsTotal = promosOn && quote?.total ? quote.total : cart?.total;
  // Checkout refuses a door-to-door point outside the Ashanti Region, and payment runs before checkout, so the
  // pay button stays off until a quote for THIS pin has resolved and says it is in area (the delivery note
  // above carries the quote's message). A pending, stale or failed quote also keeps it off.
  // Known limit: with promotions off there is no quote endpoint, so the region cannot be checked here and the
  // button stays on; checkout still refuses an out-of-area point (a test pins this).
  const pinChosen = deliveryMethod === "door_to_door" && deliveryLat != null;
  const outOfArea = deliveryMethod === "door_to_door" && delivery?.fee_status === "out_of_area";
  const regionUnchecked = promosOn && pinChosen && (quoting || quotedFor !== pinKey || quoteFailed);
  const doorToDoorReady = doorToDoorFilled && !outOfArea && !regionUnchecked;
  const guardBlock = guard?.checkout?.any || (deliveryMethod === "door_to_door" ? guard?.checkout?.door_to_door : null) || null;
  // Payment runs in the browser before checkout, and checkout is where the server enforces the limits, so the pay
  // button stays off until the limits have actually been read (a customer only; staff are gated separately).
  const guardUnchecked = user?.accountType === "customer" && (guardPending || guardError);
  const deliveryLimitBlock = !!guardBlock && guardBlock.code !== "not_deliverable";
  // canBuy too: if the opening moves while the confirm step is open, paying stops.
  const payReady = canBuy && doorToDoorReady && !guardBlock && !guardUnchecked;
  const shownTotal = delivery?.fee != null && itemsTotal != null ? (parseFloat(itemsTotal) + parseFloat(delivery.fee)).toFixed(2) : itemsTotal;
  const [couponError, setCouponError] = useState("");

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

  const handlePaymentSuccess = async (ref) => {
    setCheckoutError(null);
    try {
      const response = await apiPost("/api/orders/checkout/", {
        delivery_method: deliveryMethod,
        delivery_address: deliveryAddress,
        delivery_phone: deliveryPhone,
        ...(promosOn && appliedCode ? { coupon_code: appliedCode } : {}),
        // Only sent when the customer dropped a pin — the backend treats
        // missing coords as "no pin", the dispatch map then falls back to the
        // text address.
        ...(deliveryMethod === "door_to_door" && deliveryLat != null
          ? { delivery_lat: deliveryLat, delivery_lng: deliveryLng }
          : {}),
      });
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
      // An out-of-area delivery point is refused with its own explanation; show that, not the generic text. The
      // payment screen has already said "Payment Successful" by now, so say plainly that no order was placed and
      // keep the payment reference for support.
      setCheckoutError(err?.body?.code === "out_of_area"
        ? `${apiErrorMessage(err, "We only deliver within the Ashanti Region for now.")} Your order was not placed. Payment reference: ${ref}.`
        : "Payment was confirmed but we couldn't place your order. Please contact support with reference " + ref + ".");
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

  // Coupon box and the flash-sale notes; renders nothing while checkout promotions are off.
  const PromoBlock = () => {
    if (!promosOn) return null;
    return (
      <div style={{ marginBottom: 10 }}>
        {quote?.notes?.map((n) => <div key={n} style={{ fontSize: "0.68rem", color: "#555", marginBottom: 4 }}>{n}</div>)}
        {quote?.lines?.some((l) => l.flash_sale) && <div style={{ fontSize: "0.68rem", color: "#555", marginBottom: 4 }}>Flash-sale prices are applied at checkout. Coupons don't apply to them.</div>}
        {quote?.coupon ? (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.74rem", color: C.darkBrown, marginBottom: 6 }}>
            <span>Coupon {quote.coupon.code}: − {formatAmount(quote.coupon.discount)}</span>
            <button type="button" onClick={() => { setAppliedCode(""); setCouponInput(""); }} style={{ background: "none", border: "none", color: C.kente1, cursor: "pointer", fontSize: "0.7rem", fontWeight: 700 }}>Remove</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <label style={{ flex: 1 }}>
              <span style={{ position: "absolute", left: -9999 }}>Coupon code</span>
              <input value={couponInput} onChange={(e) => { setCouponInput(e.target.value); setCouponError(""); }} placeholder="Coupon code" style={{ width: "100%", padding: "8px 10px", borderRadius: 10, border: "1.5px solid #e0e0e0", fontSize: "0.76rem", fontFamily: "inherit", boxSizing: "border-box" }} />
            </label>
            <button type="button" disabled={!couponInput.trim() || quoting} onClick={() => setAppliedCode(couponInput.trim())} style={{ background: "#f0f0f0", color: C.darkBrown, border: "none", borderRadius: 10, padding: "8px 12px", fontWeight: 800, fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit" }}>Apply</button>
          </div>
        )}
        {couponError && <div role="alert" style={{ color: "#dc2626", fontSize: "0.7rem", marginTop: 4 }}>{couponError}</div>}
      </div>
    );
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
                  <span>{formatAmount(shownTotal)}</span>
                </div>
                <PromoBlock />
                <button
                  disabled={!canBuy}
                  onClick={() => { if (!canBuy || staffGate.blocked()) return; setStep("confirm"); }}
                  style={{ width: "100%", background: canBuy ? C.gold : "#ccc", color: canBuy ? C.darkBrown : "#555", border: "none", borderRadius: 24, padding: "11px", fontWeight: 900, fontSize: "0.82rem", cursor: canBuy ? "pointer" : "not-allowed", fontFamily: "inherit" }}
                >{canBuy ? "Checkout →" : opensLabel}</button>
                {staffGate.shownFor && <StaffGateNotice style={{ marginTop: 10 }} />}
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
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, color: C.kente2, fontSize: "0.9rem", borderTop: "1px solid #eee", paddingTop: 8, marginTop: 8, marginBottom: 14 }}>
              <span>Total</span>
              <span>{formatAmount(shownTotal)}</span>
            </div>
            {promosOn && quote?.coupon && (
              <div style={{ fontSize: "0.72rem", color: "#555", margin: "-8px 0 12px" }}>Includes coupon {quote.coupon.code}: − {formatAmount(quote.coupon.discount)}</div>
            )}
            {delivery && (
              <div data-testid="cart-delivery" style={{ fontSize: "0.72rem", color: "#555", margin: "-8px 0 12px" }}>
                {delivery.waived
                  ? <>Delivery: <b style={{ color: C.kente2 }}>Free</b> ({delivery.waiver_name}){delivery.waived_fee != null ? <>, saving {formatAmount(delivery.waived_fee)}</> : null}</>
                  : delivery.fee != null
                    ? <>Delivery: {formatAmount(delivery.fee)}</>
                    : delivery.fee_status === "out_of_area"
                      ? <b data-testid="cart-delivery-out-of-area" role="alert" style={{ color: "#dc2626" }}>{delivery.message}</b>
                      : delivery.fee_status === "no_rate_card"
                        ? <>No delivery fee is being charged right now.</>
                        : <>Choose your delivery location on the map to see the delivery fee. Without one, no delivery fee is added.</>}
                {delivery.route?.stops > 1 && delivery.lines && (
                  <>
                    <div>{delivery.waived ? "Delivery value (not charged):" : "Delivery breakdown:"}</div>
                    <ul aria-label="Delivery fee breakdown" style={{ margin: "2px 0 0", paddingLeft: 16 }}>
                      {delivery.lines.map((l) => <li key={l.label}>{l.label}: {formatAmount(l.amount)}</li>)}
                    </ul>
                    {delivery.route.planned === false && <div>These shops are not on one planned route yet, so the distance is a straight-line estimate.</div>}
                  </>
                )}
                {delivery.mixed_note && <div>{delivery.mixed_note}</div>}
              </div>
            )}

            {/* Delivery method (Wave F) */}
            <div style={{ fontWeight: 800, color: C.darkBrown, fontSize: "0.78rem", marginBottom: 8 }}>How would you like it?</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {[["store_pickup", "🏬 Store pickup"], ["door_to_door", "🚚 Door-to-door"]].map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setDeliveryMethod(value)}
                  style={{ flex: 1, background: deliveryMethod === value ? C.kente2 : "#f0f0f0", color: deliveryMethod === value ? "white" : "#666", border: "none", borderRadius: 12, padding: "9px", fontWeight: 700, fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit" }}
                >
                  {label}
                </button>
              ))}
            </div>
            {deliveryMethod === "door_to_door" && (
              <div style={{ marginBottom: 12 }}>
                <input
                  value={deliveryAddress}
                  onChange={(e) => setDeliveryAddress(e.target.value)}
                  placeholder="Delivery address"
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid #e0e0e0", fontSize: "0.78rem", fontFamily: "inherit", boxSizing: "border-box", marginBottom: 8 }}
                />
                <input
                  value={deliveryPhone}
                  onChange={(e) => setDeliveryPhone(e.target.value)}
                  placeholder="Contact phone for delivery"
                  style={{ width: "100%", padding: "9px 12px", borderRadius: 10, border: "1.5px solid #e0e0e0", fontSize: "0.78rem", fontFamily: "inherit", boxSizing: "border-box", marginBottom: 8 }}
                />
                <LocationPicker
                  lat={deliveryLat}
                  lng={deliveryLng}
                  onChange={(la, ln) => { setDeliveryLat(la); setDeliveryLng(ln); }}
                  onAddress={(addr) => setDeliveryAddress(addr)}
                />
              </div>
            )}

            {deferredFrom && <div data-testid="cart-after-hours" style={{ background: "#fff7e6", color: "#7a4b00", borderRadius: 10, padding: "8px 12px", fontSize: "0.72rem", marginBottom: 12 }}>{preview.source === "business_hours" ? `Shop is closed now. Delivery starts ${deferredFrom}.` : `Delivery starts ${deferredFrom}.`}</div>}
            {promosOn && pinChosen && quoteFailed && <div data-testid="cart-delivery-unchecked" style={{ fontSize: "0.72rem", color: "#555", marginBottom: 12 }}>We couldn't check delivery to this location yet. Try again.</div>}
            {guardBlock && <div data-testid="cart-guard-block" role="alert" style={{ background: "#fee2e2", color: "#dc2626", borderRadius: 10, padding: "8px 12px", fontSize: "0.72rem", marginBottom: 12 }}>{guardBlock.detail}{deliveryLimitBlock && <div>Store pickup is still available.</div>}</div>}
            {guardUnchecked && !guardBlock && <div data-testid="cart-guard-unchecked" style={{ fontSize: "0.72rem", color: "#555", marginBottom: 12 }}>{guardError ? "We couldn't check your delivery limits yet. Try again shortly." : "Checking your delivery limits…"}</div>}
            {checkoutError && <div style={{ background: "#fee2e2", color: "#dc2626", borderRadius: 10, padding: "8px 12px", fontSize: "0.72rem", marginBottom: 12 }}>{checkoutError}</div>}
            {staffGate.shownFor && <StaffGateNotice style={{ marginBottom: 12 }} />}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setStep("cart")} style={{ flex: 1, background: "#f0f0f0", color: "#666", border: "none", borderRadius: 20, padding: "10px", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>← Back</button>
              <button
                onClick={() => { if (staffGate.blocked()) return; setCheckoutAmount(parseFloat(shownTotal) || 0); setShowPayment(true); }}
                disabled={!payReady}
                style={{ flex: 2, background: payReady ? C.kente2 : "#ccc", color: "white", border: "none", borderRadius: 20, padding: "10px", fontWeight: 900, cursor: payReady ? "pointer" : "not-allowed", fontFamily: "inherit" }}
              >
                Confirm &amp; Pay
              </button>
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

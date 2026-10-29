import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { C } from "../../theme.js";
import logoIcon from "../../assets/logo/logo-icon.png";
import { apiPatch, apiPost } from "../../apiClient.js";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";
import { ghanaPostError, normalizeGhanaPost } from "../../lib/ghanaPost.js";
import { formatAccraDayTime } from "../../lib/accraTime.js";
import { ADDRESSES_KEY, useAddresses } from "../../hooks/useAddresses.js";
import { useCart } from "../../hooks/useCart.js";
import { useCartGuard } from "../../hooks/useCartGuard.js";
import { useCanBuy } from "../../hooks/useCanBuy.js";
import { useDeliveryPreview } from "../../hooks/useDeliveryPreview.js";
import { quoteCart, usePublicPromos } from "../../hooks/usePublicPromos.js";
import { useStaffGate } from "../../hooks/useStaffGate.js";
import { useWallet } from "../../hooks/useWallet.js";
import { useWalletProcessing } from "../../hooks/useWalletProcessing.js";
import useBreakpoint from "../../hooks/useBreakpoint.js";
import AddressCard from "../account/AddressCard.jsx";
import AddressPicker from "../account/AddressPicker.jsx";
import GhanaPostField from "../account/GhanaPostField.jsx";
import LocationPicker from "../LocationPicker.jsx";
import PickupCollectionNote from "../PickupCollectionNote.jsx";
import StaffGateNotice from "../StaffGateNotice.jsx";
import PaymentMethodPicker from "../wallet/PaymentMethodPicker.jsx";
import ProcessingLine from "../wallet/ProcessingLine.jsx";
import { walletMessage } from "../wallet/walletErrors.js";
import { addGhs, formatGhs, ghsToPesewas, isPlausibleAmount } from "../wallet/walletMoney.js";
import { walletStyles } from "../wallet/walletStyles.js";
import { BODY_FONT, HEADING_FONT, TABULAR } from "../storefront/storefrontType.js";

const num = (v) => (v == null || v === "" ? null : Number(v));

// The secure checkout at /checkout (Marketplace Plan 4). A calm page: white cards on the cream canvas, one gold
// button. Left column: delivery method, where to deliver (a saved address, or a GhanaPost code + landmark + phone
// typed here), how to pay, the items. Right column: the summary and "Place your order in GHS".
//
// This is where the old cart drawer's checkout step lives now: the same delivery quote (`quoteCart` with promotions
// on, the delivery preview with them off), the same wallet / mobile-money rules and the same checkout POST. Amounts
// are always GHS (what is charged, Ruling P26), so `currency` is accepted for the page interface but unused.
// Every amount and every refusal comes from the server; nothing is computed here but whole-pesewa sums for display.
//
//   PaymentComponent  App.jsx's MoMoPayment (collects the paying number), passed in so components/ never import App.
//   onNavigate(path)  in-app navigation; a placed order goes to /checkout/verify?order=<id>.
//   onSignIn()        offered to a signed-out visitor.
//   authLoading       true while the session is still being restored, so a signed-in customer never sees "Sign in".
export default function CheckoutPage({ user, currency = "GHS", PaymentComponent, onNavigate, onSignIn, authLoading = false }) { // eslint-disable-line no-unused-vars
  const queryClient = useQueryClient();
  const phoneLayout = useBreakpoint() === "phone";
  const s = walletStyles("light");
  const staffGate = useStaffGate(user);
  const isCustomer = user?.accountType === "customer";
  const cartQuery = useCart(isCustomer);
  const guardQuery = useCartGuard(null, { enabled: isCustomer });
  const { canBuy, label: opensLabel } = useCanBuy();
  const addressesQuery = useAddresses(isCustomer);
  const { data: promos } = usePublicPromos();
  const promosOn = !!promos?.enabled;

  const items = Array.isArray(cartQuery.data?.items) ? cartQuery.data.items : [];
  const cart = cartQuery.data;
  const cartSignature = items.map((i) => `${i.id}:${i.quantity}`).join(",");

  // ── Delivery method. Door-to-door is the default; the server's guard can take it away (only pickup left).
  const [deliveryMethod, setDeliveryMethod] = useState("door_to_door");
  const guard = guardQuery.data;
  const guardAny = guard?.checkout?.any || null;
  const guardDoor = !guardAny ? guard?.checkout?.door_to_door || null : null;
  const method = guardDoor ? "store_pickup" : deliveryMethod;
  const door = method === "door_to_door";
  const guardUnchecked = isCustomer && (guardQuery.isPending || guardQuery.isError);

  // ── Where to deliver: a saved address (the default is preselected) or one typed for this order.
  const rows = Array.isArray(addressesQuery.data) ? addressesQuery.data : [];
  const [addr, setAddr] = useState(null);
  const [changing, setChanging] = useState(false);
  const [manual, setManual] = useState(false);
  const [makeDefault, setMakeDefault] = useState(false);
  const [lat, setLat] = useState(null);
  const [lng, setLng] = useState(null);
  const [mPhone, setMPhone] = useState("");
  const [mGps, setMGps] = useState("");
  const [mLandmark, setMLandmark] = useState("");
  const [mStreet, setMStreet] = useState("");
  const streetAuto = useRef(false);
  const preselected = useRef(false);

  const pick = (row) => {
    setAddr(row);
    setManual(false);
    setChanging(false);
    setMakeDefault(false);
    setLat(num(row.lat));
    setLng(num(row.lng));
  };
  useEffect(() => {
    if (preselected.current || !addressesQuery.isSuccess) return;
    preselected.current = true;
    const preferred = rows.find((r) => r.is_default);
    if (preferred) pick(preferred);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addressesQuery.isSuccess, addressesQuery.data]);

  // Entering typed mode drops the saved address's pin (the typed address has its own); going back re-syncs from it.
  const startTyping = () => {
    setManual(true);
    setLat(null);
    setLng(null);
    streetAuto.current = false;
  };
  const useSaved = () => {
    if (addr) pick(addr);
    else { setManual(false); setChanging(true); setLat(null); setLng(null); }
  };

  const addressesSettled = !addressesQuery.isPending;
  const typing = manual || (addressesSettled && rows.length === 0);
  const gps = typing ? normalizeGhanaPost(mGps) : addr?.gps_address || "";
  const landmark = (typing ? mLandmark : addr?.landmark || "").trim();
  const deliveryPhone = (typing ? mPhone : addr?.phone || "").trim();
  const deliveryAddress = typing ? mStreet.trim() || landmark : addr ? addr.address_text || addr.landmark : "";
  const addressFilled = !door || (!ghanaPostError(gps) && !!landmark && landmark.length <= 200 && !!deliveryPhone && !!deliveryAddress);
  const gpsShownError = typing && mGps.length >= 11 ? ghanaPostError(mGps) : null;
  const landmarkError = typing && mLandmark.trim().length > 200 ? "Keep the landmark under 200 characters." : null;
  const onMapAddress = (text) => {
    if (!typing || !text) return;
    if (mStreet.trim() && !streetAuto.current) return;
    streetAuto.current = true;
    setMStreet(text);
  };

  // ── The delivery fee, as the server will charge it (promotions on: the cart quote; off: the delivery preview).
  const [couponInput, setCouponInput] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const [couponError, setCouponError] = useState("");
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [quotedFor, setQuotedFor] = useState(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const pinKey = `${method}:${lat}:${lng}`;
  const { data: preview, isError: previewFailed, refetch: refetchPreview } = useDeliveryPreview("door_to_door", {
    enabled: isCustomer && door && items.length > 0, cartKey: cartSignature, lat: promosOn ? null : lat, lng: promosOn ? null : lng,
  });
  useEffect(() => {
    if (!promosOn || items.length === 0) { setQuote(null); return; }
    let live = true;
    setQuoting(true);
    setQuoteFailed(false);
    // A quote for another pin or method must never answer for this one: drop it as soon as the pin moves.
    if (quotedFor !== pinKey) { setQuote(null); setQuotedFor(null); }
    quoteCart({
      coupon_code: appliedCode, delivery_phone: door ? deliveryPhone : "",
      delivery_method: method, ...(door && lat != null ? { delivery_lat: lat, delivery_lng: lng } : {}),
    })
      .then((q) => { if (live) { setQuote(q); setQuotedFor(pinKey); setCouponError(q.coupon_error || ""); if (q.coupon_error) setAppliedCode(""); } })
      .catch(() => { if (live) { setQuote(null); setQuotedFor(null); setQuoteFailed(true); } })
      .finally(() => { if (live) setQuoting(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promosOn, cartSignature, appliedCode, method, lat, lng]);

  const delivery = !door ? null : promosOn ? quote?.delivery ?? null : preview?.delivery ?? null;
  const deferredFrom = door && preview?.deferred ? formatAccraDayTime(preview.delivery_from) : null;
  const pinChosen = door && lat != null;
  const outOfArea = door && delivery?.fee_status === "out_of_area";
  const regionUnchecked = promosOn && pinChosen && (quoting || quotedFor !== pinKey || quoteFailed);
  const itemsGross = promosOn && quote?.items_subtotal ? quote.items_subtotal : cart?.total;
  const itemsTotal = promosOn && quote?.total ? quote.total : cart?.total;
  const discount = promosOn && quote?.discount && (ghsToPesewas(quote.discount) ?? 0) > 0 ? quote.discount : null;
  // Whole pesewas (addGhs), never a float sum; with no fee known the shown total is the items alone.
  const shownTotal = delivery?.fee != null && itemsTotal != null ? addGhs(itemsTotal, delivery.fee) ?? itemsTotal : itemsTotal;

  // ── Payment. Only the server's ledger_off answer means "no wallet"; while the wallet read is loading, or after
  // any other failure, ordering waits (with a reason and a retry) rather than opening the fee modal against a ledger
  // that may be on.
  const [paymentMethod, setPaymentMethod] = useState("momo");
  const { data: wallet, error: walletError, isPending: walletPending, refetch: refetchWallet } = useWallet({ enabled: isCustomer });
  const pickerShown = !!wallet && wallet.balance !== undefined;
  const walletOff = !!walletError && walletMessage(walletError).kind === "off";
  const walletChecking = isCustomer && walletPending;
  const walletFailed = isCustomer && !!walletError && !walletOff && !pickerShown;
  const payMethod = pickerShown ? paymentMethod : "momo";
  const momoWithPicker = pickerShown && payMethod === "momo";
  const quotable = isPlausibleAmount(shownTotal);
  // Promotions off, a pin chosen, mobile money with the picker: the processing quote waits for the server's delivery
  // fee for THIS pin, so a charge is never quoted on less than the server takes.
  // With promotions off the preview carries the fee: whatever the payment switches, ordering waits for it.
  const feeLoading = !promosOn && pinChosen && preview === undefined;
  const feeWait = momoWithPicker && feeLoading;
  const { data: processingData, error: processingError, isError: processingFailed, refetch: refetchProcessing } = useWalletProcessing(momoWithPicker && !feeWait ? shownTotal : "");
  const processingReady = !feeWait && (!momoWithPicker || processingData?.payment_processing !== undefined);
  const processingPending = momoWithPicker && !feeWait && quotable && !processingData && !processingFailed;

  // ── Placing the order.
  const [showPayment, setShowPayment] = useState(false);
  const [checkoutAmount, setCheckoutAmount] = useState(0);
  const [checkoutProcessing, setCheckoutProcessing] = useState(undefined);
  const [checkoutError, setCheckoutError] = useState(null);
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  const [placedNext, setPlacedNext] = useState(null);
  const [cartError, setCartError] = useState(null);
  const [pendingId, setPendingId] = useState(null);

  const regionOk = !door || (!outOfArea && !regionUnchecked);
  const ready = canBuy && !staffGate.isStaff && items.length > 0 && !guardAny && !guardUnchecked && addressFilled && regionOk
    && !feeLoading && !walletChecking && !walletFailed && processingReady && !placing;
  let reason = null;
  if (!canBuy) reason = opensLabel || "Opens soon";
  else if (door && !addressFilled) reason = addressesSettled && !typing && !addr ? "Choose where to deliver." : "Add a valid Ghana Post address, a landmark and a phone number to continue.";
  else if (outOfArea) reason = "Choose a delivery point inside the Ashanti Region.";

  const checkoutBody = (extra = {}) => ({
    ...extra,
    delivery_method: method,
    ...(door ? {
      delivery_address: deliveryAddress, delivery_phone: deliveryPhone,
      ...(lat != null ? { delivery_lat: lat, delivery_lng: lng } : {}),
      delivery_gps_address: gps, delivery_landmark: landmark,
    } : {}),
    ...(promosOn && appliedCode ? { coupon_code: appliedCode } : {}),
  });

  // One POST for both payment paths. A refusal shows the server's own words and leaves the cart as it was. For a
  // mobile-money order the payment has already gone through by now, so the reference is kept on screen.
  const submitOrder = async (extra, payRef = null) => {
    placingRef.current = true;
    setPlacing(true);
    setCheckoutError(null);
    try {
      const response = await apiPost("/api/orders/checkout/", checkoutBody(extra));
      // Hubtel (docs/HUBTEL_INTEGRATION.md): the order is pending until the webhook confirms, so go to the hosted checkout.
      if (response?.mode === "redirect") {
        await applyDefault(); // the page is about to leave, so a failure here has nowhere to be shown
        window.location.assign(response.checkout_url);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      queryClient.invalidateQueries({ queryKey: ["cart-guard"] });
      queryClient.invalidateQueries({ queryKey: ["wallet"] });
      const next = `/checkout/verify?order=${response?.id}`;
      if (await applyDefault()) { if (onNavigate) onNavigate(next); }
      else setPlacedNext(next);
    } catch (err) {
      setCheckoutError({ text: apiErrorMessage(err, "We couldn't place your order. Please try again."), ref: payRef });
      if (payRef) setShowPayment(false);
      placingRef.current = false;
      setPlacing(false);
    }
  };

  // Only after the order is accepted: returns false when the shopper asked for a default and it could not be set.
  const applyDefault = async () => {
    if (!door || typing || !addr || addr.is_default || !makeDefault) return true;
    try {
      await apiPost(`/api/accounts/addresses/${addr.id}/set-default/`, {});
      queryClient.invalidateQueries({ queryKey: ADDRESSES_KEY });
      return true;
    } catch {
      return false;
    }
  };

  const placeOrder = async () => {
    if (placingRef.current || !ready) return;
    if (staffGate.blocked()) return;
    placingRef.current = true;
    setPlacing(true);
    if (payMethod === "wallet") {
      await submitOrder({ payment_method: "wallet" });
      return;
    }
    // Snapshotted so the modal's amount cannot change under it while the cart refreshes after the order.
    setCheckoutAmount(parseFloat(shownTotal) || 0);
    setCheckoutProcessing(pickerShown ? processingData?.payment_processing : undefined);
    setCheckoutError(null);
    setShowPayment(true);
    placingRef.current = false;
    setPlacing(false);
  };
  const handlePaymentSuccess = (ref) => submitOrder(pickerShown ? { payment_method: "momo" } : {}, ref);

  const refreshCart = async () => {
    await cartQuery.refetch();
    queryClient.invalidateQueries({ queryKey: ["cart-guard"] });
  };
  const updateQuantity = async (item, next) => {
    if (next < 1 || pendingId != null) return;
    setCartError(null);
    setPendingId(item.id);
    try {
      await apiPatch(`/api/cart/items/${item.id}/`, { quantity: next });
      await refreshCart();
    } catch (err) {
      setCartError(apiErrorMessage(err, "Could not update the quantity for this item."));
    } finally {
      setPendingId(null);
    }
  };

  // ── Rendering.
  const go = (path) => { if (onNavigate) onNavigate(path); };
  const card = { background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: phoneLayout ? 16 : 20, boxSizing: "border-box" };
  const h2 = { margin: "0 0 12px", fontFamily: HEADING_FONT, fontWeight: 600, fontSize: "1.1rem", lineHeight: 1.2, color: C.ink };
  const note = { fontSize: "0.8rem", color: C.inkDim, lineHeight: 1.5 };
  const linkBtn = { background: "none", border: "none", padding: "6px 0", color: C.trust, fontSize: "0.85rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minHeight: 32 };
  const alertBox = { background: C.errBg, color: C.errInk, borderRadius: 10, padding: "8px 12px", fontSize: "0.8rem", lineHeight: 1.5 };
  const radioRow = (disabled) => ({ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", minHeight: 44, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1 });
  const stepBtn = (disabled) => ({
    width: 32, height: 32, borderRadius: "50%", border: `1px solid ${C.line}`, background: C.surface, color: C.ink,
    fontSize: "1rem", fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", lineHeight: 1, opacity: disabled ? 0.5 : 1,
  });
  const row = { display: "flex", justifyContent: "space-between", gap: 12, fontSize: "0.9rem", color: C.ink, padding: "4px 0" };
  const amount = { color: C.price, ...TABULAR, textAlign: "right" };
  const shell = { background: C.canvas, minHeight: "100vh", fontFamily: BODY_FONT, color: C.ink };
  const inner = { maxWidth: 1120, margin: "0 auto", padding: phoneLayout ? "16px 16px 40px" : "24px 16px 56px", boxSizing: "border-box" };

  const header = (
    <header style={{ background: C.surface, borderBottom: `1px solid ${C.line}` }}>
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "10px 16px", display: "flex", alignItems: "center", gap: 14, boxSizing: "border-box" }}>
        <img src={logoIcon} alt="AshantiHub" style={{ height: 36, width: "auto", display: "block", flexShrink: 0 }} />
        <h1 style={{ margin: 0, flex: 1, fontFamily: HEADING_FONT, fontWeight: 600, fontSize: phoneLayout ? "1.15rem" : "1.4rem", color: C.ink }}>Secure checkout</h1>
        <a href="/cart" onClick={(e) => { e.preventDefault(); go("/cart"); }} style={{ color: C.trust, fontWeight: 700, fontSize: "0.85rem", textDecoration: "none" }}>Back to cart</a>
      </div>
    </header>
  );

  const modal = showPayment && PaymentComponent && (
    <PaymentComponent
      amount={checkoutAmount}
      purpose="AshantiHub Order Checkout"
      {...(checkoutProcessing !== undefined ? { processing: checkoutProcessing } : {})}
      businessName={user?.fullName || ""}
      onSuccess={handlePaymentSuccess}
      onClose={() => setShowPayment(false)}
    />
  );

  const page = (content) => (
    <div style={shell}>
      {header}
      <main style={inner}>{content}</main>
      {modal}
    </div>
  );

  if (staffGate.isStaff) {
    return page(<StaffGateNotice passive />);
  }
  if (!user && authLoading) {
    return page(<p style={{ color: C.inkDim }}>Loading your checkout{"…"}</p>);
  }
  if (!user) {
    return page(
      <div style={card}>
        <p style={{ margin: "0 0 12px", color: C.inkDim }}>Sign in to check out.</p>
        {onSignIn && <button type="button" onClick={onSignIn} style={s.button}>Sign in</button>}
      </div>,
    );
  }
  if (!isCustomer) {
    return page(<div style={card}><p style={{ margin: 0, color: C.inkDim }}>Checkout is for customer accounts.</p></div>);
  }
  if (cartQuery.isPending) {
    return page(<p style={{ color: C.inkDim }}>Loading your checkout{"…"}</p>);
  }
  if (cartQuery.isError) {
    return page(
      <div style={card}>
        <p role="alert" style={{ margin: "0 0 8px", color: C.errInk }}>We couldn{"’"}t load your cart.</p>
        <button type="button" onClick={() => cartQuery.refetch()} style={linkBtn}>Try again</button>
      </div>,
    );
  }
  if (items.length === 0) {
    return page(
      <div style={card}>
        <p style={{ margin: "0 0 12px", color: C.inkDim }}>Your cart is empty.</p>
        <button type="button" onClick={() => go("/")} style={s.button}>Continue shopping</button>
      </div>,
    );
  }

  const deliveryLine = (() => {
    if (!door) return "None for store pickup";
    if (!delivery) {
      if (!pinChosen) return "Choose a delivery point";
      return (preview === undefined && !previewFailed) || quoting ? "Checking…" : "No delivery fee";
    }
    if (delivery.waived) return <>Free ({delivery.waiver_name}){delivery.waived_fee != null && <>, saving {formatGhs(delivery.waived_fee)}</>}</>;
    if (delivery.fee != null) return formatGhs(delivery.fee);
    if (delivery.fee_status === "out_of_area") return <b role="alert" data-testid="checkout-out-of-area" style={{ color: C.errInk }}>{delivery.message}</b>;
    if (delivery.fee_status === "no_rate_card") return "No delivery fee is being charged right now";
    return "Choose a delivery point";
  })();

  const promoBlock = promosOn && (
    <div style={{ margin: "10px 0" }}>
      {quote?.notes?.map((n) => <div key={n} style={{ ...note, marginBottom: 4 }}>{n}</div>)}
      {quote?.lines?.some((l) => l.flash_sale) && <div style={{ ...note, marginBottom: 4 }}>Flash-sale prices are applied at checkout. Coupons don{"’"}t apply to them.</div>}
      {quote?.coupon ? (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", marginBottom: 6 }}>
          <span>Coupon {quote.coupon.code}</span>
          <button type="button" onClick={() => { setAppliedCode(""); setCouponInput(""); }} style={{ ...linkBtn, color: C.danger, padding: 0 }}>Remove</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <input aria-label="Coupon code" value={couponInput} onChange={(e) => { setCouponInput(e.target.value); setCouponError(""); }} placeholder="Coupon code" style={{ ...s.field, minHeight: 40, padding: "8px 10px", fontSize: "0.9rem" }} />
          <button type="button" disabled={!couponInput.trim() || quoting} onClick={() => setAppliedCode(couponInput.trim())} style={{ ...s.ghost, minHeight: 40, padding: "8px 14px" }}>Apply</button>
        </div>
      )}
      {couponError && <div role="alert" style={{ ...note, color: C.errInk, marginTop: 4 }}>{couponError}</div>}
    </div>
  );

  return page(
    <div style={{ display: "grid", gridTemplateColumns: phoneLayout ? "minmax(0, 1fr)" : "minmax(0, 1fr) 340px", gap: 20, alignItems: "start" }}>
      <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
        <section style={card} aria-label="Delivery method">
          <h2 style={h2}>Delivery method</h2>
          <fieldset style={{ border: "none", margin: 0, padding: 0 }}>
            <legend style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>How would you like it?</legend>
            <label style={radioRow(!!guardDoor)}>
              <input type="radio" name="delivery-method" checked={door} disabled={!!guardDoor} onChange={() => setDeliveryMethod("door_to_door")} />
              <span>Door-to-door<span style={{ ...note, display: "block" }}>A rider brings it to the address you choose.</span></span>
            </label>
            <label style={radioRow(false)}>
              <input type="radio" name="delivery-method" checked={!door} onChange={() => setDeliveryMethod("store_pickup")} />
              <span>Store pickup</span>
            </label>
          </fieldset>
          {!door && <div style={{ marginTop: 8 }}><PickupCollectionNote codeComing={pickerShown} /></div>}
          {(guardAny || guardDoor) && (
            <div data-testid="checkout-guard-note" role="alert" style={{ ...alertBox, marginTop: 8 }}>
              {(guardAny || guardDoor).detail}
              {guardDoor && guardDoor.code !== "not_deliverable" && <div>Store pickup is still available.</div>}
            </div>
          )}
          {guardUnchecked && !guardAny && !guardDoor && (
            <div data-testid="checkout-guard-unchecked" style={{ ...note, marginTop: 8 }}>
              {guardQuery.isError ? "We couldn't check your delivery limits yet. Try again shortly." : "Checking your delivery limits…"}
            </div>
          )}
        </section>

        {door && (
          <section style={card} aria-label="Delivering to">
            <h2 style={h2}>Delivering to</h2>
            {!addressesSettled && <div style={note}>Loading your addresses{"…"}</div>}
            {addressesSettled && !typing && addr && !changing && (
              <div style={{ display: "grid", gap: 8 }}>
                <AddressCard address={addr} />
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <button type="button" style={linkBtn} onClick={() => setChanging(true)}>Change</button>
                  <button type="button" style={linkBtn} onClick={startTyping}>Deliver somewhere else this time</button>
                </div>
                {!addr.is_default && (
                  <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.9rem" }}>
                    <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} />
                    Default to this address
                  </label>
                )}
              </div>
            )}
            {addressesSettled && !typing && (!addr || changing) && (
              <div style={{ display: "grid", gap: 8 }}>
                <AddressPicker value={addr} onChange={pick} />
                <button type="button" style={linkBtn} onClick={startTyping}>Deliver somewhere else this time</button>
              </div>
            )}
            {addressesSettled && typing && (
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <label htmlFor="checkout-phone" style={s.label}>Phone number</label>
                  <input id="checkout-phone" type="tel" inputMode="tel" autoComplete="tel" value={mPhone} onChange={(e) => setMPhone(e.target.value)} placeholder="024 123 4567" style={s.field} />
                  <div style={{ ...s.note, marginTop: 4 }}>The rider calls this number.</div>
                </div>
                <GhanaPostField value={mGps} onChange={setMGps} error={gpsShownError} />
                <div>
                  <label htmlFor="checkout-landmark" style={s.label}>Landmark near your door</label>
                  <input id="checkout-landmark" value={mLandmark} onChange={(e) => setMLandmark(e.target.value)} placeholder="Opposite the Total filling station" aria-invalid={landmarkError ? true : undefined} style={s.field} />
                  {landmarkError && <div role="alert" style={{ ...s.note, color: C.errInk, marginTop: 4 }}>{landmarkError}</div>}
                </div>
                <div>
                  <label htmlFor="checkout-street" style={s.label}>Street or area (optional)</label>
                  <input id="checkout-street" value={mStreet} onChange={(e) => { streetAuto.current = false; setMStreet(e.target.value); }} autoComplete="street-address" style={s.field} />
                </div>
                {rows.length > 0 && <button type="button" style={{ ...linkBtn, justifySelf: "start" }} onClick={useSaved}>Use a saved address</button>}
              </div>
            )}
            {addressesSettled && (
              <div style={{ marginTop: 14 }}>
                <div style={s.label}>Pin your door on the map</div>
                <LocationPicker lat={lat} lng={lng} onChange={(la, ln) => { setLat(la); setLng(ln); }} onAddress={onMapAddress} height={200} />
                <div style={{ ...s.note, marginTop: 4 }}>The pin works out the delivery fee; the Ghana Post code is what we deliver to.</div>
              </div>
            )}
            {deferredFrom && (
              <div data-testid="checkout-after-hours" style={{ background: C.warnBg, color: C.warnInk, borderRadius: 10, padding: "8px 12px", fontSize: "0.8rem", marginTop: 12 }}>
                {preview.source === "business_hours" ? `Shop is closed now. Delivery starts ${deferredFrom}.` : `Delivery starts ${deferredFrom}.`}
              </div>
            )}
            {promosOn && pinChosen && quoteFailed && (
              <div data-testid="checkout-delivery-unchecked" style={{ ...note, marginTop: 12 }}>{"We couldn't check delivery to this location yet. Try again."}</div>
            )}
          </section>
        )}

        <section style={card} aria-label="Payment">
          <h2 style={h2}>Payment</h2>
          {/* The server's processing line is shown once, in the summary, so the picker's own copy is held back. */}
          <PaymentMethodPicker value={payMethod} onChange={(m) => { setPaymentMethod(m); setCheckoutError(null); }} amount={shownTotal} quoteWaits />
          {walletChecking && <div data-testid="checkout-wallet-checking" style={{ ...note, marginTop: 8 }}>Checking payment options{"…"}</div>}
          {walletOff && <div data-testid="checkout-wallet-off" style={{ ...note, marginTop: 8 }}>{walletMessage(walletError).text}</div>}
          {walletFailed && (
            <div data-testid="checkout-wallet-failed" role="alert" style={{ ...alertBox, marginTop: 8 }}>
              {walletMessage(walletError).text}{" "}
              <button type="button" onClick={() => refetchWallet()} style={{ background: "none", border: "none", color: C.errInk, textDecoration: "underline", cursor: "pointer", fontSize: "0.8rem", fontFamily: "inherit" }}>Try again</button>
            </div>
          )}
          {momoWithPicker && !quotable && <div style={{ ...note, marginTop: 8 }}>There is nothing to pay by mobile money. Choose your AshantiHub wallet.</div>}
          {feeLoading && (
            <div data-testid="checkout-fee-checking" style={{ ...note, marginTop: 8 }}>
              {previewFailed ? "We couldn't check the delivery fee. " : "Checking the delivery fee…"}
              {previewFailed && <button type="button" onClick={() => refetchPreview()} style={{ background: "none", border: "none", color: C.errInk, textDecoration: "underline", cursor: "pointer", fontSize: "0.8rem", fontFamily: "inherit" }}>Try again</button>}
            </div>
          )}
          {processingPending && <div data-testid="checkout-processing-checking" style={{ ...note, marginTop: 8 }}>Getting the payment processing charge{"…"}</div>}
          {momoWithPicker && quotable && processingFailed && (
            <div role="alert" style={{ ...alertBox, marginTop: 8 }}>
              {apiErrorMessage(processingError, "We couldn't get the payment processing charge.")}{" "}
              <button type="button" onClick={() => refetchProcessing()} style={{ background: "none", border: "none", color: C.errInk, textDecoration: "underline", cursor: "pointer", fontSize: "0.8rem", fontFamily: "inherit" }}>Try again</button>
            </div>
          )}
          <p style={{ ...note, margin: "12px 0 0" }}>Your default payment method is not saved {"—"} you choose at checkout.</p>
        </section>

        <section style={card} aria-label="Review items" data-testid="checkout-review">
          <h2 style={h2}>Review items</h2>
          {cartError && <div role="alert" style={{ ...alertBox, marginBottom: 8 }}>{cartError}</div>}
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((line) => {
              const busy = pendingId === line.id;
              return (
                <li key={line.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "12px 0", borderTop: `1px solid ${C.line}` }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{line.listing_name}</div>
                    {line.variant_label && <div style={note}>{line.variant_label}</div>}
                    {line.seller_name && <div style={note}>{`Sold by ${line.seller_name}`}</div>}
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                      <button type="button" disabled={busy || Number(line.quantity) <= 1} aria-label={`Decrease quantity of ${line.listing_name}`} onClick={() => updateQuantity(line, Number(line.quantity) - 1)} style={stepBtn(busy || Number(line.quantity) <= 1)}>{"−"}</button>
                      <span aria-live="polite" style={{ minWidth: 20, textAlign: "center", fontWeight: 700, ...TABULAR }}>{line.quantity}</span>
                      <button type="button" disabled={busy} aria-label={`Increase quantity of ${line.listing_name}`} onClick={() => updateQuantity(line, Number(line.quantity) + 1)} style={stepBtn(busy)}>+</button>
                    </div>
                  </div>
                  <div style={{ ...amount, fontWeight: 700 }}>{formatGhs(line.line_total)}</div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <aside style={{ ...card, position: phoneLayout ? "static" : "sticky", top: 16 }} aria-label="Order summary" data-testid="checkout-summary">
        <h2 style={h2}>Order summary</h2>
        <div style={row}><span>Items</span><span data-testid="summary-items" style={amount}>{formatGhs(itemsGross)}</span></div>
        <div style={row}><span>Delivery fee</span><span data-testid="summary-delivery" style={{ ...amount, color: typeof deliveryLine === "string" && !deliveryLine.startsWith("GH") ? C.inkDim : C.price }}>{deliveryLine}</span></div>
        {delivery?.route?.stops > 1 && delivery.lines && (
          <div style={{ ...note, marginBottom: 4 }}>
            <div>{delivery.waived ? "Delivery value (not charged):" : "Delivery breakdown:"}</div>
            <ul aria-label="Delivery fee breakdown" style={{ margin: "2px 0 0", paddingLeft: 16 }}>
              {delivery.lines.map((l) => <li key={l.label}>{l.label}: {formatGhs(l.amount)}</li>)}
            </ul>
            {delivery.route.planned === false && <div>These shops are not on one planned route yet, so the distance is a straight-line estimate.</div>}
          </div>
        )}
        {delivery?.mixed_note && <div style={{ ...note, marginBottom: 4 }}>{delivery.mixed_note}</div>}
        {discount && <div style={row}><span>Discount</span><span data-testid="summary-discount" style={amount}>{"−"}{formatGhs(discount)}</span></div>}
        {promoBlock}
        <div style={{ ...row, fontWeight: 800, borderTop: `1px solid ${C.line}`, marginTop: 6, paddingTop: 10 }}>
          <span>Order total</span><span data-testid="summary-total" style={amount}>{formatGhs(shownTotal)}</span>
        </div>
        {!feeWait && <ProcessingLine amount={shownTotal} tone="light" method={payMethod} />}

        <button type="button" disabled={!ready} onClick={placeOrder} style={{ ...s.button, width: "100%", marginTop: 16, borderRadius: 24, background: ready ? C.gold : C.surface3, color: ready ? C.darkBrown : C.inkDim, cursor: ready ? "pointer" : "not-allowed", fontWeight: 900 }}>
          Place your order in GHS
        </button>
        {reason && <div data-testid="checkout-reason" style={{ ...note, marginTop: 10, fontWeight: 600 }}>{reason}</div>}
        {placedNext && (
          <div data-testid="checkout-default-note" role="status" style={{ ...note, marginTop: 10 }}>
            <div>Your order is placed, but we could not make this your default address.</div>
            <button type="button" style={linkBtn} onClick={() => go(placedNext)}>Continue to your order</button>
          </div>
        )}
        {checkoutError && (
          <div data-testid="checkout-error" role="alert" style={{ ...alertBox, marginTop: 10 }}>
            <div>{checkoutError.text}</div>
            {checkoutError.ref && <div>Your order was not placed. Payment reference: {checkoutError.ref}.</div>}
          </div>
        )}
      </aside>
    </div>,
  );
}

import { useState } from "react";
import { C, tint } from "../../theme.js";
import { useOtherSellers } from "../../hooks/useOtherSellers.js";
import { useAddresses } from "../../hooks/useAddresses.js";
import { useCanBuy } from "../../hooks/useCanBuy.js";
import { useCartGuard } from "../../hooks/useCartGuard.js";
import { useStaffGate } from "../../hooks/useStaffGate.js";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";
import { CONDITION_LABEL, PRICE_BASIS_LABEL, formatPrice } from "../catalogue/catalogueFormat.js";
import StaffGateNotice from "../StaffGateNotice.jsx";
import VerifiedMark from "../VerifiedMark.jsx";
import { OPENS_SOON } from "./shopCopy.js";

const SHOWN = 5;

// Other businesses' offers of the same catalogue product. Each offer is its own cart line at its own price; nothing is
// added without a click. There is no way to contact a business and no distance is shown. The saved default address's
// pin (customers only, never the device location) is sent only so the server can order by nearness.
// Props: `listingId` (the listing on the page), `user`, `onAddToCart(item, qty)` (App-owned, may throw),
// `onOpenListing(id)`.
export default function OtherSellersPanel({ listingId, user, onAddToCart, onOpenListing }) {
  const isCustomer = user?.accountType === "customer";
  const addresses = useAddresses(isCustomer);
  const home = isCustomer && Array.isArray(addresses.data) ? addresses.data.find((a) => a.is_default) : null;
  const position = home && home.lat != null && home.lng != null ? { lat: home.lat, lng: home.lng } : null;
  const [ordering, setOrdering] = useState("price");
  const [all, setAll] = useState(false);
  const { data } = useOtherSellers(listingId, { ordering, position, enabled: !isCustomer || addresses.isFetched });
  const offers = Array.isArray(data?.offers) ? data.offers : [];
  if (!offers.length) return null;

  const product = data.catalogue_product;
  const featuredId = data.featured_offer_id;
  const rows = all ? offers : offers.slice(0, SHOWN);
  const pill = (key, label) => (
    <button key={key} type="button" aria-pressed={ordering === key} onClick={() => setOrdering(key)}
      style={{ border: `1px solid ${C.line}`, borderRadius: 20, padding: "5px 12px", fontSize: "0.78rem", fontWeight: 700, fontFamily: "inherit", cursor: "pointer",
        background: ordering === key ? C.surface3 : C.surface, color: C.ink }}>{label}</button>
  );

  return (
    <div data-testid="other-sellers" style={{ marginTop: 18, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
      <h2 style={{ margin: 0, fontSize: "1rem", fontWeight: 900, color: C.ink }}>Other sellers</h2>
      {product && <div style={{ fontSize: "0.82rem", color: C.inkDim, marginTop: 2 }}>{[product.brand, product.name].filter(Boolean).join(" ")}</div>}
      {featuredId === listingId && (
        <div style={{ marginTop: 8, fontSize: "0.82rem", fontWeight: 700, color: C.ink }}>This seller has the best price from a verified business.</div>
      )}
      <p style={{ margin: "8px 0 0", fontSize: "0.78rem", color: C.inkDim, lineHeight: 1.5 }}>Each seller's offer is its own cart line at its own price.</p>
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {pill("price", "Lowest price")}
        {pill("availability", "Most in stock")}
      </div>
      <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((row) => (
          <OfferRow key={row.listing_id} row={row} featured={featuredId != null && row.listing_id === featuredId && featuredId !== listingId}
            user={user} isCustomer={isCustomer} onAddToCart={onAddToCart} onOpenListing={onOpenListing} />
        ))}
      </ul>
      {!all && offers.length > SHOWN && (
        <button type="button" onClick={() => setAll(true)}
          style={{ marginTop: 10, background: "none", border: "none", padding: 0, color: C.info, fontWeight: 700, fontSize: "0.82rem", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>
          Show all {offers.length}
        </button>
      )}
    </div>
  );
}

function OfferRow({ row, featured, user, isCustomer, onAddToCart, onOpenListing }) {
  const { canBuy, label: opensLabel } = useCanBuy();
  const staffGate = useStaffGate(user);
  const guard = useCartGuard(row.listing_id, { enabled: isCustomer });
  const blocked = guard.data?.listing?.blocked || null;
  const max = row.available_quantity;
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  // The same reason chain as BuyBox's Add to cart (a staff session is not a business account: its click shows the notice).
  const isBusinessAccount = !!user && !staffGate.isStaff && !isCustomer;
  let reason = null;
  if (isBusinessAccount) reason = "Customer accounts only";
  else if (!canBuy) reason = opensLabel || OPENS_SOON;
  else if (blocked) reason = blocked.detail;
  const disabled = busy || Boolean(reason);

  async function add() {
    setNote(null);
    if (staffGate.blocked()) return;
    if (disabled || !onAddToCart) return;
    setBusy(true);
    try {
      await onAddToCart({ id: row.listing_id }, qty);
      setNote({ ok: true, text: "Added to your cart." });
    } catch (err) {
      setNote({ ok: false, text: apiErrorMessage(err, err?.message || "We couldn't add this to your cart.") });
    } finally {
      setBusy(false);
    }
  }

  const step = { width: 32, height: 32, borderRadius: 8, border: `1px solid ${C.line}`, background: C.surface, color: C.ink, fontSize: "1rem", fontWeight: 800, fontFamily: "inherit", cursor: "pointer" };
  const basis = PRICE_BASIS_LABEL[row.price_basis];
  return (
    <li style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 12, padding: 12 }}>
      {featured && <div style={{ fontSize: "0.74rem", fontWeight: 800, color: C.inkDim, marginBottom: 4 }}>Best price from a verified business</div>}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <strong style={{ color: C.ink, fontSize: "0.9rem" }}>{row.business_name || "Business name not given"}</strong>
        <VerifiedMark verified={row.verified} compact />
      </div>
      <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
        <span style={{ color: C.price, fontWeight: 900, fontSize: "1rem", fontVariantNumeric: "tabular-nums" }}>{formatPrice(row.price_now)}</span>
        {row.price_unit && <span style={{ fontSize: "0.78rem", color: C.inkDim }}>{row.price_unit}</span>}
        {basis && <span style={{ fontSize: "0.74rem", color: C.inkDim }}>{basis}</span>}
      </div>
      <div style={{ marginTop: 4, fontSize: "0.78rem", color: C.inkDim, display: "flex", flexWrap: "wrap", gap: 10 }}>
        {CONDITION_LABEL[row.condition] && <span>{CONDITION_LABEL[row.condition]}</span>}
        {row.zone && <span>{row.zone}</span>}
        {max != null && <span>{max} available</span>}
      </div>
      <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" aria-label={`Fewer from ${row.business_name || "this seller"}`} disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))} style={step}>−</button>
          <span aria-live="polite" style={{ minWidth: 24, textAlign: "center", fontWeight: 800, color: C.ink, fontVariantNumeric: "tabular-nums" }}>{qty}</span>
          <button type="button" aria-label={`More from ${row.business_name || "this seller"}`} disabled={max != null && qty >= max} onClick={() => setQty((q) => (max != null ? Math.min(max, q + 1) : q + 1))} style={step}>+</button>
        </div>
        <button type="button" disabled={disabled} onClick={add}
          style={{ minHeight: 38, borderRadius: 20, padding: "0 16px", fontFamily: "inherit", fontWeight: 900, fontSize: "0.82rem",
            background: disabled ? C.surface3 : C.surface2, color: disabled ? C.inkFaint : C.ink, border: `1px solid ${C.line}`,
            cursor: disabled ? "not-allowed" : "pointer" }}>
          {busy ? "Adding…" : "Add to cart"}
        </button>
        {onOpenListing && (
          <button type="button" onClick={() => onOpenListing(row.listing_id)}
            style={{ background: "none", border: "none", padding: 0, color: C.info, fontWeight: 700, fontSize: "0.8rem", textDecoration: "underline", cursor: "pointer", fontFamily: "inherit" }}>See this offer</button>
        )}
      </div>
      {reason && <div role="status" style={{ marginTop: 8, fontSize: "0.78rem", color: C.warnInk, lineHeight: 1.5 }}>{reason}</div>}
      {staffGate.shownFor && <StaffGateNotice style={{ marginTop: 8 }} />}
      {note && <div role={note.ok ? "status" : "alert"} style={{ marginTop: 8, fontSize: "0.78rem", lineHeight: 1.5, color: note.ok ? C.okInk : C.errInk, background: note.ok ? tint(C.trust, "11") : C.errBg, borderRadius: 8, padding: "6px 8px" }}>{note.text}</div>}
    </li>
  );
}

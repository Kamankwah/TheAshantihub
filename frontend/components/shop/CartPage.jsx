import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { C } from "../../theme.js";
import { apiDelete, apiPatch } from "../../apiClient.js";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";
import { useWishlist } from "../../hooks/useWishlist.js";
import { useCart } from "../../hooks/useCart.js";
import { useCartGuard } from "../../hooks/useCartGuard.js";
import { useCanBuy } from "../../hooks/useCanBuy.js";
import { useStaffGate } from "../../hooks/useStaffGate.js";
import { useSponsored } from "../../hooks/useSponsored.js";
import useBreakpoint from "../../hooks/useBreakpoint.js";
import StaffGateNotice from "../StaffGateNotice.jsx";
import { BODY_FONT, HEADING_FONT, TABULAR } from "../storefront/storefrontType.js";
import PriceTag from "./PriceTag.jsx";
import { LOW_STOCK_AT, OPENS_SOON, atStockCap, guardUncheckedText } from "./shopCopy.js";
import ProductCarousel, { AlsoViewedCarousel } from "./ProductCarousel.jsx";

function stockText(line) {
  if (line.in_stock === false || line.stock_quantity === 0) return { text: "Out of stock", bad: true };
  if (line.stock_quantity != null && line.stock_quantity <= LOW_STOCK_AT) return { text: `Only ${line.stock_quantity} left`, bad: false };
  return { text: "In stock", bad: false };
}

// The full cart at /cart. One row per line (photo, name, variant, seller, stock, quantity stepper, Delete, Save for
// later), the server's subtotal and the one gold action, Proceed to checkout, which navigates to /checkout via
// `onNavigate`. Everything shown comes from GET /api/cart/ (and the cart guard); nothing is computed here but the
// item count. `onSignIn` is offered to a signed-out visitor. Mutations are plain api calls with a per-line message.
// Cart money is always GHS (what is charged, Ruling P26); `currency` only reaches the carousels.
export default function CartPage({ user, currency = "GHS", onNavigate, onSignIn, authLoading = false }) {
  const queryClient = useQueryClient();
  const phone = useBreakpoint() === "phone";
  const staffGate = useStaffGate(user);
  const isCustomer = user?.accountType === "customer";
  const cartQuery = useCart(!!user);
  const wishlist = useWishlist({ enabled: isCustomer });
  const guardQuery = useCartGuard(null, { enabled: isCustomer });
  const { canBuy, label: opensLabel } = useCanBuy();
  const sponsoredQuery = useSponsored({ all: true });
  const [busyId, setBusyId] = useState(null);
  const [lineErrors, setLineErrors] = useState({});

  const go = (path) => { if (onNavigate) onNavigate(path); };
  const items = Array.isArray(cartQuery.data?.items) ? cartQuery.data.items : [];
  const sponsored = Array.isArray(sponsoredQuery.data) ? sponsoredQuery.data : [];
  const count = items.reduce((n, l) => n + (Number(l.quantity) || 0), 0);

  const setLineError = (id, text) => setLineErrors((prev) => ({ ...prev, [id]: text }));
  const refresh = async () => {
    await cartQuery.refetch();
    queryClient.invalidateQueries({ queryKey: ["cart-guard"] });
  };

  async function run(line, work, fallback) {
    if (busyId != null) return;
    setLineError(line.id, "");
    setBusyId(line.id);
    try {
      await work();
      await refresh();
    } catch (err) {
      setLineError(line.id, apiErrorMessage(err, fallback));
    } finally {
      setBusyId(null);
    }
  }
  const setQuantity = (line, quantity) => run(line, () => apiPatch(`/api/cart/items/${line.id}/`, { quantity }), "Could not change the quantity.");
  const remove = (line) => run(line, () => apiDelete(`/api/cart/items/${line.id}/`), "Could not remove this item.");
  // Save for later = Your Lists first; the line goes only once the list accepted it, so a refusal never loses the item.
  const saveForLater = (line) => run(line, async () => {
    await wishlist.add(line.listing);
    await apiDelete(`/api/cart/items/${line.id}/`);
  }, "Could not save this for later.");

  const guard = guardQuery.data;
  const guardBlock = guard?.checkout?.any || null;
  const doorBlock = !guardBlock ? guard?.checkout?.door_to_door || null : null;
  const guardUnchecked = isCustomer && (guardQuery.isPending || guardQuery.isError);
  let reason = null;
  if (!canBuy) reason = opensLabel || OPENS_SOON;
  else if (guardBlock) reason = guardBlock.detail;
  else if (guardUnchecked) reason = guardUncheckedText(guardQuery.isError);

  const proceedToCheckout = () => {
    if (reason) return;
    if (staffGate.blocked()) return;
    go("/checkout");
  };

  const openProduct = (e, id) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    go(`/business/${id}`);
  };

  const shell = { maxWidth: 1120, margin: "0 auto", padding: phone ? "20px 16px 40px" : "28px 16px 56px", boxSizing: "border-box", fontFamily: BODY_FONT, color: C.ink, minHeight: "60vh" };
  const h1 = { margin: 0, fontFamily: HEADING_FONT, fontWeight: 600, fontSize: phone ? "1.6rem" : "2rem", lineHeight: 1.15, letterSpacing: "-0.02em", color: C.ink };
  const linkBtn = { background: "none", border: "none", padding: "6px 0", color: C.trust, fontSize: "0.8rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", minHeight: 32 };
  const goldBtn = (disabled) => ({
    width: "100%", background: disabled ? C.surface3 : C.gold, color: disabled ? C.inkDim : C.darkBrown, border: "none", borderRadius: 24,
    padding: "12px", fontWeight: 900, fontSize: "0.9rem", cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
  });

  const sponsoredRow = <ProductCarousel title="Sponsored products" items={sponsored} sponsored currency={currency} onOpen={(id) => go(`/business/${id}`)} />;

  if (!user && authLoading) {
    return <main style={shell}><h1 style={h1}>Shopping Cart</h1><p style={{ color: C.inkDim }}>Loading your cart{"…"}</p></main>;
  }
  if (!user) {
    return (
      <main style={shell}>
        <h1 style={h1}>Shopping Cart</h1>
        <p style={{ color: C.inkDim, margin: "12px 0 16px" }}>Sign in to see your cart.</p>
        {onSignIn && <button type="button" onClick={onSignIn} style={{ ...goldBtn(false), width: "auto", padding: "10px 24px" }}>Sign in</button>}
      </main>
    );
  }

  if (cartQuery.isPending) {
    return <main style={shell}><h1 style={h1}>Shopping Cart</h1><p style={{ color: C.inkDim }}>Loading your cart{"…"}</p></main>;
  }
  if (cartQuery.isError) {
    // Only the server's 403 for a non-customer account means "not for you"; any other failure is just a failed read.
    const notCustomer = !isCustomer && cartQuery.error?.status === 403;
    return (
      <main style={shell}>
        <h1 style={h1}>Shopping Cart</h1>
        {notCustomer ? (
          <p role="alert" style={{ color: C.errInk }}>Carts are for customer accounts.</p>
        ) : (
          <>
            <p role="alert" style={{ color: C.errInk }}>{"We couldn't load your cart. Try again."}</p>
            <button type="button" onClick={() => cartQuery.refetch()} style={linkBtn}>Try again</button>
          </>
        )}
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main style={shell}>
        <h1 style={h1}>Shopping Cart</h1>
        <p style={{ color: C.inkDim, margin: "12px 0 16px" }}>Your cart is empty.</p>
        <button type="button" onClick={() => go("/")} style={{ ...goldBtn(false), width: "auto", padding: "10px 24px", marginBottom: 32 }}>Continue shopping</button>
        {sponsoredRow}
      </main>
    );
  }

  const stepBtn = (disabled) => ({
    width: 32, height: 32, borderRadius: "50%", border: `1px solid ${C.line}`, background: C.surface, color: C.ink,
    fontSize: "1rem", fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit", lineHeight: 1, opacity: disabled ? 0.5 : 1,
  });

  return (
    <main style={shell}>
      <div style={{ display: "grid", gridTemplateColumns: phone ? "minmax(0, 1fr)" : "minmax(0, 1fr) 300px", gap: 24, alignItems: "start" }}>
        <section aria-label="Cart items" style={{ minWidth: 0 }}>
          <h1 style={{ ...h1, paddingBottom: 12, borderBottom: `1px solid ${C.line}` }}>Shopping Cart</h1>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((line) => {
              const stock = stockText(line);
              const busy = busyId === line.id;
              const name = line.listing_name;
              return (
                <li key={line.id} data-testid={`cart-line-${line.id}`} style={{ display: "flex", gap: 14, padding: "16px 0", borderBottom: `1px solid ${C.line}` }}>
                  <a href={`/business/${line.listing}`} onClick={(e) => openProduct(e, line.listing)} aria-hidden="true" tabIndex={-1} style={{ flex: "0 0 auto" }}>
                    <span style={{ display: "block", width: phone ? 84 : 120, height: phone ? 84 : 120, background: C.surface2, border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
                      {line.listing_photo && <img src={line.listing_photo} alt="" style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />}
                    </span>
                  </a>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <div style={{ minWidth: 0 }}>
                        <a href={`/business/${line.listing}`} onClick={(e) => openProduct(e, line.listing)} style={{ color: C.ink, fontWeight: 700, fontSize: "1rem", lineHeight: 1.35, textDecoration: "none" }}>{name}</a>
                        {line.variant_label && <div style={{ fontSize: "0.82rem", color: C.inkDim, marginTop: 2 }}>{line.variant_label}</div>}
                        <div style={{ fontSize: "0.8rem", color: C.inkDim, marginTop: 2 }}>{`Sold by ${line.seller_name}`}</div>
                        <div style={{ fontSize: "0.8rem", marginTop: 2, fontWeight: 600, color: stock.bad ? C.errInk : C.trust }}>{stock.text}</div>
                      </div>
                      <div style={{ textAlign: "right", flex: "0 0 auto" }}>
                        <PriceTag price={line.line_total} currency="GHS" size="1.15rem" />
                        {Number(line.quantity) > 1 && <div style={{ fontSize: "0.75rem", color: C.price, marginTop: 2, ...TABULAR }}>{`GHS ${line.unit_price_snapshot} each`}</div>}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "4px 16px", marginTop: 10 }}>
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                        {Number(line.quantity) <= 1 ? (
                          <button type="button" disabled={busy} aria-label={`Remove ${name} from cart`} onClick={() => remove(line)} style={stepBtn(busy)}>{"\u{1F5D1}"}</button>
                        ) : (
                          <button type="button" disabled={busy} aria-label={`Decrease quantity of ${name}`} onClick={() => setQuantity(line, Number(line.quantity) - 1)} style={stepBtn(busy)}>{"−"}</button>
                        )}
                        <span aria-live="polite" style={{ minWidth: 20, textAlign: "center", fontWeight: 700, ...TABULAR }}>{line.quantity}</span>
                        <button type="button" disabled={busy || atStockCap(line)} aria-label={`Increase quantity of ${name}`} onClick={() => setQuantity(line, Number(line.quantity) + 1)} style={stepBtn(busy || atStockCap(line))}>+</button>
                      </div>
                      <button type="button" disabled={busy} aria-label={`Delete ${name}`} onClick={() => remove(line)} style={linkBtn}>Delete</button>
                      <button type="button" disabled={busy} aria-label={`Save ${name} for later`} onClick={() => saveForLater(line)} style={linkBtn}>Save for later</button>
                    </div>
                    {lineErrors[line.id] && <div role="alert" style={{ marginTop: 6, fontSize: "0.8rem", color: C.errInk }}>{lineErrors[line.id]}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
          <p style={{ margin: "14px 0 0", fontSize: "0.78rem", color: C.inkDim, lineHeight: 1.5 }}>
            Prices and availability can change. Each line keeps the price from when you added it; changing the quantity updates it to today{"’"}s price.
          </p>
        </section>

        <aside data-testid="cart-subtotal" style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
          <div style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: 4 }}>{`Subtotal (${count} ${count === 1 ? "item" : "items"})`}</div>
          <PriceTag price={cartQuery.data.total} currency="GHS" />
          <p style={{ margin: "10px 0 14px", fontSize: "0.78rem", color: C.inkDim, lineHeight: 1.5 }}>Delivery fee is worked out at checkout from your delivery pin.</p>
          <button type="button" disabled={!!reason} aria-describedby={reason ? "cart-proceed-reason" : undefined} onClick={proceedToCheckout} style={goldBtn(!!reason)}>Proceed to checkout</button>
          {reason && <div id="cart-proceed-reason" data-testid="cart-proceed-reason" style={{ marginTop: 10, fontSize: "0.8rem", fontWeight: 600, color: C.inkDim, lineHeight: 1.5 }}>{reason}</div>}
          {!reason && doorBlock && <div data-testid="cart-guard-note" style={{ marginTop: 10, fontSize: "0.78rem", color: C.inkDim, lineHeight: 1.5 }}>{`${doorBlock.detail}${doorBlock.code === "not_deliverable" ? "" : " Store pickup is still available."}`}</div>}
          {staffGate.shownFor && <StaffGateNotice style={{ marginTop: 10 }} />}
        </aside>
      </div>

      <div style={{ marginTop: 36 }}>
        {sponsoredRow}
        <AlsoViewedCarousel listingId={items[0].listing} fallbackTitle="More like the first item in your cart" currency={currency} onOpen={(id) => go(`/business/${id}`)} />
      </div>
    </main>
  );
}

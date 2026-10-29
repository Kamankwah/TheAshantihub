import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../apiClient.js";
import { bulkErrorMessage } from "../../hooks/useAddToCartBulk.js";
import { useOrders } from "../../hooks/useOrders.js";
import { useCanBuy } from "../../hooks/useCanBuy.js";
import { useStaffGate } from "../../hooks/useStaffGate.js";
import { formatAccraDayTime } from "../../lib/accraTime.js";
import { D, glassCard, tint } from "../dashboard/theme.js";
import DeliveryCodeBox from "../DeliveryCodeBox.jsx";
import OrderTrackingMap from "../OrderTrackingMap.jsx";
import PickupCollectionNote from "../PickupCollectionNote.jsx";
import RaiseDisputeForm from "../RaiseDisputeForm.jsx";
import { ReviewWriteForm } from "../ReviewComponents.jsx";
import StaffGateNotice from "../StaffGateNotice.jsx";

const ORDER_STATUS_META = {
  pending: { label: "Pending", color: D.amber },
  paid: { label: "Paid", color: D.green },
  cancelled: { label: "Cancelled", color: D.red },
};

const DELIVERY_STEPS = [
  { id: "processing", label: "Processing" },
  { id: "shipped", label: "Shipped" },
  { id: "out_for_delivery", label: "Out for Delivery" },
  { id: "delivered", label: "Delivered" },
];

function DeliveryStepper({ status }) {
  const activeIndex = DELIVERY_STEPS.findIndex((s) => s.id === status);
  return <div style={{ display: "flex", alignItems: "flex-start", marginTop: 12 }}>
    {DELIVERY_STEPS.map((step, i) => (
      <div key={step.id} style={{ display: "flex", alignItems: "center", flex: i < DELIVERY_STEPS.length - 1 ? 1 : "none" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 60 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: i <= activeIndex ? D.gold : D.divider, flexShrink: 0 }} />
          <span style={{ fontSize: "0.6rem", color: i <= activeIndex ? D.text : D.textFaint, fontWeight: i <= activeIndex ? 800 : 600, textAlign: "center" }}>{step.label}</span>
        </div>
        {i < DELIVERY_STEPS.length - 1 && <div style={{ flex: 1, height: 2, background: i < activeIndex ? D.gold : D.divider, margin: "5px 4px 0" }} />}
      </div>
    ))}
  </div>;
}

const TABULAR = { fontVariantNumeric: "tabular-nums", fontFeatureSettings: '"tnum" 1' };
const smallLabel = { fontSize: "0.62rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: D.textFaint };
const pill = (primary) => ({ background: primary ? D.gold : "none", color: primary ? D.darkBrown : D.text, border: primary ? "none" : `1px solid ${D.cardBorderStrong}`, borderRadius: 20, padding: "8px 16px", fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit" });

const placedOn = (iso) => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Accra" });
};

const RANGES = [
  { id: "all", label: "All orders" },
  { id: "3", label: "Past 3 months" },
  { id: "6", label: "Past 6 months" },
];

function withinMonths(iso, months) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - Number(months));
  return t >= cutoff.getTime();
}

// A 400 that names a bad/hidden listing or a version that is gone means "no longer available"; every other refusal
// (stock caps, cart guard, sign-in) is the server's own message, never relabelled.
function isUnavailable(err) {
  const body = err?.body;
  if (err?.status === 400 && body) {
    if (body.listing) return true;
    if (Array.isArray(body.lines)) return body.lines.some((l) => /not available/i.test(typeof l === "string" ? l : l?.detail || ""));
  }
  return err?.status === 404;
}
const refusalText = (err) => bulkErrorMessage(err);

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The customer's orders (moved here from App.jsx's OrdersDeliveryTab; same tracking, confirm-receipt and dispute
// behaviour). Order cards carry the placed date, total, "Ship to", order number and (when present) the GhanaPost
// code and landmark, then "Track package", "View order", "Write a product review" and "Buy it again". The
// date filter and "Search all orders" work client-side over the loaded array (GET /api/orders/ is not paginated).
// `user` gates the buy action and the review form; nothing here imports App.jsx.
export default function OrdersPanel({ user }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useOrders();
  const { canBuy, label: opensLabel } = useCanBuy();
  const gate = useStaffGate(user);
  const [confirmError, setConfirmError] = useState(null);
  const [range, setRange] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState({}); // `${id}:track|view|review` -> true
  const [again, setAgain] = useState({}); // order id -> { busy, added, missing, failed }
  const orders = data || [];

  const toggle = (key) => setOpen((cur) => ({ ...cur, [key]: !cur[key] }));
  const confirmReceipt = async (orderId) => {
    setConfirmError(null);
    try { await apiPost(`/api/orders/${orderId}/confirm-receipt/`, {}); refetch(); }
    catch { setConfirmError("Could not confirm receipt. Please try again."); }
  };

  // Re-add the order's lines: variant lines go to the bulk endpoint grouped per listing, plain lines to the single
  // endpoint. A listing that is gone or unavailable is reported by name and the rest are still added.
  const buyAgain = async (o) => {
    if (gate.blocked(o.id)) return;
    if (again[o.id]?.busy) return;
    setAgain((cur) => ({ ...cur, [o.id]: { busy: true, added: 0, missing: [], refused: [], partial: [] } }));
    const groups = new Map();
    for (const it of o.items || []) {
      if (it.listing == null) { groups.set(`gone-${it.id}`, { gone: true, name: it.listing_name }); continue; }
      const g = groups.get(it.listing) || { listing: it.listing, name: it.listing_name, variants: [], plain: 0 };
      if (it.variant != null) g.variants.push({ variant: it.variant, quantity: it.quantity });
      else g.plain += it.quantity;
      groups.set(it.listing, g);
    }
    let added = 0;
    const missing = [];
    const refused = []; // server refusals shown in the server's own words (stock caps, cart guard, ...)
    const partial = []; // a listing whose variant lines were added but whose plain lines were refused
    for (const g of groups.values()) {
      if (g.gone) { missing.push(g.name); continue; }
      let didVariants = false;
      try {
        if (g.variants.length > 0) { await apiPost("/api/cart/items/bulk/", { listing: g.listing, lines: g.variants }); didVariants = true; }
        if (g.plain > 0) await apiPost("/api/cart/items/", { listing: g.listing, quantity: g.plain });
        added += 1;
      } catch (err) {
        if (didVariants) { added += 1; partial.push(`${g.name}: the versions were added, the rest was not. ${refusalText(err)}`); }
        else if (isUnavailable(err)) missing.push(g.name);
        else refused.push(`${g.name}: ${refusalText(err)}`);
      }
    }
    if (added > 0) {
      queryClient.invalidateQueries({ queryKey: ["cart"] });
      queryClient.invalidateQueries({ queryKey: ["cart-guard"] });
    }
    setAgain((cur) => ({ ...cur, [o.id]: { busy: false, added, missing, refused, partial } }));
  };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your orders.</div>;
  if (orders.length === 0) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No orders yet.</div>;

  const q = query.trim().toLowerCase();
  const filtered = orders.filter((o) => (range === "all" || withinMonths(o.placed_at, range))
    && (!q || String(o.id).includes(q) || (o.items || []).some((it) => it.listing_name?.toLowerCase().includes(q))));

  return <div>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search all orders" aria-label="Search all orders"
        style={{ flex: "1 1 220px", maxWidth: 320, background: D.panelBg2, border: `1px solid ${D.divider}`, borderRadius: 10, padding: "8px 12px", fontSize: "0.8rem", color: D.text, fontFamily: "inherit" }} />
      <select value={range} onChange={(e) => setRange(e.target.value)} aria-label="Show orders from"
        style={{ background: D.panelBg2, border: `1px solid ${D.divider}`, borderRadius: 10, padding: "8px 12px", fontSize: "0.8rem", color: D.text, fontFamily: "inherit" }}>
        {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
    </div>
    {filtered.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No orders match your search or filter.</div>}
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {filtered.map((o) => {
        const statusMeta = ORDER_STATUS_META[o.status] || { label: o.status, color: D.textDim };
        const result = again[o.id];
        const reviewable = o.status === "paid" ? (o.items || []).filter((it, i, all) => it.listing != null && all.findIndex((x) => x.listing === it.listing) === i) : [];
        const door = o.delivery_method === "door_to_door";
        return (
          <div key={o.id} data-testid="order-card" style={{ ...glassCard, padding: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", gap: "10px 28px", flexWrap: "wrap", padding: "12px 18px", background: D.panelBg2, borderBottom: `1px solid ${D.divider}` }}>
              <div><div style={smallLabel}>Order placed</div><div style={{ color: D.text, fontSize: "0.8rem", fontWeight: 700 }}>{placedOn(o.placed_at) || "—"}</div></div>
              <div><div style={smallLabel}>Total</div><div style={{ color: D.price, fontSize: "0.8rem", fontWeight: 800, ...TABULAR }}>GHS {o.total_amount}</div></div>
              {o.delivery_method && (
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <div style={smallLabel}>Ship to</div>
                  <div style={{ color: D.text, fontSize: "0.8rem", fontWeight: 600 }}>{door ? `🚚 Door-to-door${o.delivery_address ? ` — ${o.delivery_address}` : ""}` : "🏬 Store pickup"}</div>
                  {door && o.delivery_gps_address && <div style={{ color: D.textDim, fontSize: "0.72rem", ...TABULAR }}>GhanaPost address: {o.delivery_gps_address}</div>}
                  {door && o.delivery_landmark && <div style={{ color: D.textDim, fontSize: "0.72rem" }}>Landmark: {o.delivery_landmark}</div>}
                </div>
              )}
              <div style={{ marginLeft: "auto", textAlign: "right" }}>
                <div style={{ color: D.text, fontWeight: 800, fontSize: "0.82rem" }}>Order #{o.id}</div>
                <span style={{ background: tint(statusMeta.color, "22"), color: statusMeta.color, borderRadius: 20, padding: "2px 10px", fontSize: "0.65rem", fontWeight: 700, display: "inline-block", marginTop: 3 }}>{statusMeta.label}</span>
              </div>
            </div>
            <div style={{ padding: 18 }}>
              <div>
                {(o.items || []).map((it) => (
                  <div key={it.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.76rem", color: D.textDim, padding: "3px 0" }}>
                    <span>{it.listing_name}{it.variant_label ? ` (${it.variant_label})` : ""} × {it.quantity}</span>
                    <span style={TABULAR}>GHS {it.line_total}</span>
                  </div>
                ))}
              </div>
              {o.delivery_method === "store_pickup" && o.collection_code && <div style={{ marginTop: 8 }}><PickupCollectionNote code={o.collection_code ?? null} collectBy={o.collect_by ?? null} tone="dark" /></div>}
              {o.status === "paid" && door && o.ready_not_before && new Date(o.ready_not_before) > new Date() && !["delivered", "confirmed"].includes(o.delivery_assignment_status) && o.delivery_status !== "delivered" && formatAccraDayTime(o.ready_not_before) && (
                <div data-testid="order-scheduled-start" style={{ marginTop: 6, color: D.textDim, fontSize: "0.72rem", fontWeight: 700 }}>Delivery scheduled to start {formatAccraDayTime(o.ready_not_before)}</div>
              )}
              {o.status === "paid" && door && <DeliveryStepper status={o.delivery_status} />}
              {o.status === "paid" && door && open[`${o.id}:track`] && <OrderTrackingMap orderId={o.id} assignmentStatus={o.delivery_assignment_status ?? null} deliveryStatus={o.delivery_status} stops={o.delivery_stops ?? null} redelivery={o.redelivery ?? null} />}
              {o.status === "paid" && door && <DeliveryCodeBox code={o.delivery_code} assignmentStatus={o.delivery_assignment_status ?? null} />}
              {o.delivery_assignment_status === "delivered" && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ color: D.textDim, fontSize: "0.72rem", marginBottom: 6 }}>Your courier marked this delivered. Please confirm you received it.</div>
                  <button onClick={() => confirmReceipt(o.id)} style={{ background: D.green, color: D.darkBrown, border: "none", borderRadius: 20, padding: "8px 16px", fontWeight: 800, fontSize: "0.76rem", cursor: "pointer", fontFamily: "inherit" }}>✓ Confirm receipt</button>
                  {confirmError && <div style={{ color: D.red, fontSize: "0.72rem", marginTop: 6 }}>{confirmError}</div>}
                </div>
              )}
              {o.delivery_assignment_status === "confirmed" && (
                <div style={{ marginTop: 8, color: D.green, fontSize: "0.72rem", fontWeight: 700 }}>✓ Receipt confirmed</div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 14 }}>
                {o.status === "paid" && door && <button type="button" aria-expanded={!!open[`${o.id}:track`]} onClick={() => toggle(`${o.id}:track`)} style={pill(false)}>Track package</button>}
                <button type="button" aria-expanded={!!open[`${o.id}:view`]} onClick={() => toggle(`${o.id}:view`)} style={pill(false)}>View order</button>
                {reviewable.length > 0 && <button type="button" aria-expanded={!!open[`${o.id}:review`]} onClick={() => toggle(`${o.id}:review`)} style={pill(false)}>Write a product review</button>}
                <button type="button" onClick={() => buyAgain(o)} disabled={!canBuy || result?.busy} style={{ ...pill(true), opacity: !canBuy || result?.busy ? 0.6 : 1, cursor: !canBuy || result?.busy ? "not-allowed" : "pointer" }}>Buy it again</button>
                {!canBuy && opensLabel && <span style={{ color: D.textDim, fontSize: "0.72rem", fontWeight: 700 }}>{opensLabel}</span>}
              </div>
              {gate.shownFor === o.id && <StaffGateNotice style={{ marginTop: 10 }} />}
              {result && !result.busy && (
                <div role="status" style={{ marginTop: 10, fontSize: "0.76rem", display: "grid", gap: 3 }}>
                  {result.added > 0 && <div style={{ color: D.green, fontWeight: 700 }}>Added {plural(result.added, "product")} to your cart.</div>}
                  {result.missing.map((name) => <div key={`m-${name}`} style={{ color: D.red }}>{name} is no longer available</div>)}
                  {result.partial.map((t) => <div key={`p-${t}`} style={{ color: D.red }}>{t}</div>)}
                  {result.refused.map((t) => <div key={`f-${t}`} style={{ color: D.red }}>{t}</div>)}
                </div>
              )}

              {open[`${o.id}:view`] && (
                <div style={{ marginTop: 12, background: D.panelBg2, borderRadius: 12, padding: 12, fontSize: "0.76rem", color: D.textDim, display: "grid", gap: 4 }}>
                  <div>Placed: {formatAccraDayTime(o.placed_at) || placedOn(o.placed_at)}</div>
                  {o.delivery_fee != null && o.delivery_fee !== "" && <div style={TABULAR}>Delivery fee: GHS {o.delivery_fee}</div>}
                  {o.discount_amount != null && <div style={TABULAR}>Discount: GHS {o.discount_amount}{o.coupon_code ? ` (code ${o.coupon_code})` : ""}</div>}
                  {o.delivery_phone && <div>Delivery phone: {o.delivery_phone}</div>}
                  <div style={{ color: D.text, fontWeight: 700, ...TABULAR }}>Order total: GHS {o.total_amount}</div>
                </div>
              )}
              {open[`${o.id}:review`] && (
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {reviewable.map((it) => (
                    <ReviewWriteForm key={it.listing} targetType="listing" targetId={it.listing} user={user} label={`Review ${it.listing_name}`} tone="theme" />
                  ))}
                </div>
              )}
              <RaiseDisputeForm orderId={o.id} />
            </div>
          </div>
        );
      })}
    </div>
  </div>;
}

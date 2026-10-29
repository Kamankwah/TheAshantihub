import { useState } from "react";
import { useOwnerOrders } from "../../../hooks/useOwnerOrders.js";
import { useOwnerOrderTracking } from "../../../hooks/useTracking.js";
import TrackMap from "../../maps/TrackMap.jsx";
import EtaLine from "../../maps/EtaLine.jsx";
import { D, glassCard, tint } from "../theme.js";

// ─── Deliveries panel — the owner's fulfilment view (pre-prod bug fix 5) ──────
// Wired to the real owner-orders spine (Wave F/G). GET /api/orders/owner/
// returns the owner's PAID orders (only their own line items) with the delivery
// method the customer chose and the current delivery_status. This is a
// READ-ONLY status view for the owner: the actual courier hand-off/advancement
// is run by staff (item 11's Delivery Manager + Dispatch roles), so the owner
// watches progress here rather than driving it.

const STATUS_META = {
  processing: { label: "Processing", icon: "🧾", color: D.textDim },
  shipped: { label: "Shipped", icon: "📦", color: D.blue },
  out_for_delivery: { label: "Out for delivery", icon: "🛵", color: D.purple },
  delivered: { label: "Delivered", icon: "✅", color: D.green },
};
const PIPELINE = ["processing", "shipped", "out_for_delivery", "delivered"];

// "Rider on the way": the owner's view of the rider heading to THEIR shop (OwnerOrderTrackingView).
// Nothing is requested until it is opened. The server sends the rider only while heading to the
// pickup business, so once the order is collected this is a plain line, never an empty map. It
// shows the shop pin and the rider only - never the customer's address or location.
function RiderOnTheWay({ orderId }) {
  const [open, setOpen] = useState(false);
  const { data, isError } = useOwnerOrderTracking(orderId, { enabled: open });
  const rider = data?.rider;
  const hasFix = rider && rider.lat != null && rider.lng != null && Number.isFinite(Number(rider.lat)) && Number.isFinite(Number(rider.lng));
  const COLLECTED = ["picked_up", "at_customer", "delivered", "confirmed"];
  const line = { margin: "8px 0 0", color: D.textDim, fontSize: "0.72rem" };
  let body = null;
  if (open) {
    if (isError) body = <p style={line}>Could not load the rider's location.</p>;
    else if (!data) body = <p style={line}>Loading…</p>;
    else if (data.stage === "not_assigned") body = <p style={line}>A rider has not been assigned yet.</p>;
    else if (data.stage === "failed") body = <p style={line}>This delivery did not go ahead.</p>;
    // The job's stage is not this shop's: read this shop's own stop and rider_elsewhere before it.
    else if (data.stop?.status === "collected") body = <p style={line}>The rider has collected your items.</p>;
    else if (data.stop?.status === "skipped") body = <p style={line}>The rider could not collect from your shop.</p>;
    else if (data.rider_elsewhere) body = <p style={line}>The rider is collecting from another shop first.</p>;
    else if (COLLECTED.includes(data.stage)) body = <p style={line}>The rider has collected the order.</p>;
    else if (data.rider_busy) body = <p style={line}>The rider is finishing another delivery first.</p>;
    else if (!hasFix) body = <p style={line}>The rider's location is not available right now.</p>;
    else {
      const markers = [
        data.pickup ? { id: "shop", kind: "pickup", lat: data.pickup.lat, lng: data.pickup.lng, label: data.pickup.name || "Your shop" } : null,
        { id: "rider", kind: rider.stale ? "stale" : "rider", lat: rider.lat, lng: rider.lng, label: [rider.first_name, rider.vehicle_type].filter(Boolean).join(" · ") || "Rider" },
      ].filter(Boolean);
      body = (
        <div style={{ marginTop: 8 }}>
          <TrackMap markers={markers} route={data.route ?? null} height={220} label="Map of the rider heading to your shop" />
          <div style={{ color: D.textFaint, fontSize: "0.66rem", marginTop: 4 }}>{data.pickup ? "Gold pin: your shop. " : ""}Dark pin: rider{rider.first_name ? ` (${rider.first_name})` : ""}.</div>
          {!data.pickup && <p style={line}>Your shop has no map pin, so the arrival time can't be shown.</p>}
          {data.stop?.late && <p style={line}>The rider is running late.</p>}
          <div style={{ marginTop: 6 }}><EtaLine leg={data.leg} stale={!!rider.stale} ageS={rider.age_s ?? null} /></div>
        </div>
      );
    }
  }
  return (
    <div data-testid="rider-disclosure" style={{ marginTop: 10 }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        style={{ background: "none", border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "5px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", color: D.text }}>
        🛵 Rider on the way {open ? "▴" : "▾"}
      </button>
      {body}
    </div>
  );
}

// The code the rider asks this shop for at the counter. The server sends it only while this rider is
// heading to this owner's shop, so null means render nothing. It is never the customer's delivery code.
function PickupCodeBox({ code, orderId }) {
  if (!code) return null;
  const spaced = String(code).split("").join(" ");
  return (
    <div data-testid="pickup-code-box" style={{ marginTop: 10, padding: "12px 14px", borderRadius: 12, background: `${D.gold}1e`, border: `1.5px solid ${D.gold}` }}>
      <div style={{ fontSize: "0.7rem", fontWeight: 800, color: D.deepGold, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pickup code</div>
      <div aria-label={`Pickup code ${spaced}`} style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: "2rem", fontWeight: 700, letterSpacing: "0.3em", color: D.text, margin: "4px 0" }}>{spaced}</div>
      <div style={{ fontSize: "0.72rem", color: D.text, lineHeight: 1.5 }}>
        Read this to the rider when they collect order #{orderId}. Only give it to the rider who is at your shop.
      </div>
    </div>
  );
}

function OrderRow({ order }) {
  const doorToDoor = order.delivery_method === "door_to_door";
  const meta = STATUS_META[order.delivery_status] || { label: order.delivery_status, color: D.textDim, icon: "•" };
  const stepIndex = PIPELINE.indexOf(order.delivery_status);

  return (
    <div style={{ ...glassCard, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem" }}>Order #{order.id} · {order.customer_name}</div>
          <div style={{ color: D.textDim, fontSize: "0.72rem", marginTop: 2 }}>
            {order.placed_at?.slice(0, 10)} · {doorToDoor ? "🛵 Door-to-door" : "🏬 Store pickup"} · GHS {order.owner_subtotal}
          </div>
        </div>
        <span style={{ background: tint(meta.color, "22"), color: meta.color, borderRadius: 20, padding: "3px 11px", fontSize: "0.66rem", fontWeight: 800 }}>{meta.icon} {meta.label}</span>
      </div>

      <div style={{ color: D.textFaint, fontSize: "0.72rem", marginTop: 8 }}>
        {(order.items || []).map(i => `${i.quantity}× ${i.listing_name || i.name || "item"}${i.variant_label ? ` (${i.variant_label})` : ""}`).join(", ")}
      </div>

      {!doorToDoor && (
        <div role="note" style={{ color: D.textDim, fontSize: "0.7rem", marginTop: 6 }}>
          The customer collects this order at the AshantiHub pickup office, not at your shop.
        </div>
      )}

      {doorToDoor && order.delivery_address && (
        <div style={{ color: D.textDim, fontSize: "0.7rem", marginTop: 6 }}>
          📍 {order.delivery_address}
        </div>
      )}

      {doorToDoor && order.rider_report?.text && <div role="note" style={{ color: D.text, fontSize: "0.74rem", fontWeight: 700, marginTop: 8 }}>{order.rider_report.text}</div>}
      {doorToDoor && order.pickup_eta && (
        <div style={{ color: D.text, fontSize: "0.74rem", fontWeight: 700, marginTop: 8 }}>
          {order.pickup_eta_late
            ? "🛵 The rider is running late"
            : `🛵 Rider arrives about ${new Date(order.pickup_eta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`}
          <span style={{ color: D.textDim, fontWeight: 400 }}> · an estimate from the planned route; it moves if the rider is held up.</span>
        </div>
      )}
      {doorToDoor && <PickupCodeBox code={order.pickup_code} orderId={order.id} />}
      {doorToDoor && order.rider_heading_here === true && <RiderOnTheWay orderId={order.id} />}

      {/* Progress track — only meaningful for door-to-door delivery */}
      {doorToDoor && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 12, flexWrap: "wrap" }}>
          {PIPELINE.map((key, i) => {
            const done = stepIndex >= i;
            const c = STATUS_META[key].color;
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 4, flex: "1 1 auto", minWidth: 0 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 62 }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", background: done ? tint(c, "1e") : tint(D.divider, "22"), border: `1.5px solid ${done ? tint(c, "88") : D.divider}`, opacity: done ? 1 : 0.5 }}>
                    {STATUS_META[key].icon}
                  </div>
                  <div style={{ fontSize: "0.56rem", fontWeight: 700, color: done ? c : D.textFaint, textAlign: "center" }}>{STATUS_META[key].label}</div>
                </div>
                {i < PIPELINE.length - 1 && <div style={{ flex: 1, height: 2, minWidth: 8, background: stepIndex > i ? tint(STATUS_META[key].color, "88") : D.divider, borderRadius: 2 }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function DeliveriesPanel() {
  const { data, isLoading, isError } = useOwnerOrders();
  const orders = data?.results || [];

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <h2 style={{ margin: 0, color: D.text, fontWeight: 900, fontSize: "0.98rem" }}>🚚 Deliveries</h2>
      </div>
      <div style={{ color: D.textFaint, fontSize: "0.72rem", marginBottom: 14 }}>
        Paid orders for your listings. Our delivery team handles door-to-door fulfilment — track each order's progress here. Store-pickup orders are ready for the customer to collect.
      </div>

      {isLoading && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading your orders…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your orders.</div>}
      {!isLoading && !isError && orders.length === 0 && (
        <div style={{ ...glassCard, padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: "2.4rem", marginBottom: 10 }}>🚚</div>
          <div style={{ fontWeight: 900, color: D.text, fontSize: "1rem", marginBottom: 8 }}>No orders yet</div>
          <div style={{ color: D.textDim, fontSize: "0.8rem", lineHeight: 1.7, maxWidth: 460, margin: "0 auto" }}>
            When a customer buys one of your listings, the order appears here with its delivery method and live fulfilment status.
          </div>
        </div>
      )}
      {orders.map(o => <OrderRow key={o.id} order={o} />)}
    </div>
  );
}

import { useOwnerOrders } from "../../../hooks/useOwnerOrders.js";
import { D, glassCard } from "../theme.js";

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
        <span style={{ background: `${meta.color}22`, color: meta.color, borderRadius: 20, padding: "3px 11px", fontSize: "0.66rem", fontWeight: 800 }}>{meta.icon} {meta.label}</span>
      </div>

      <div style={{ color: D.textFaint, fontSize: "0.72rem", marginTop: 8 }}>
        {(order.items || []).map(i => `${i.quantity}× ${i.listing_name || i.name || "item"}`).join(", ")}
      </div>

      {doorToDoor && order.delivery_address && (
        <div style={{ color: D.textDim, fontSize: "0.7rem", marginTop: 6 }}>
          📍 {order.delivery_address}{order.delivery_phone ? ` · ${order.delivery_phone}` : ""}
        </div>
      )}

      {/* Progress track — only meaningful for door-to-door delivery */}
      {doorToDoor && (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 12, flexWrap: "wrap" }}>
          {PIPELINE.map((key, i) => {
            const done = stepIndex >= i;
            const c = STATUS_META[key].color;
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 4, flex: "1 1 auto", minWidth: 0 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 62 }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", background: done ? `${c}1e` : `${D.divider}22`, border: `1.5px solid ${done ? `${c}88` : D.divider}`, opacity: done ? 1 : 0.5 }}>
                    {STATUS_META[key].icon}
                  </div>
                  <div style={{ fontSize: "0.56rem", fontWeight: 700, color: done ? c : D.textFaint, textAlign: "center" }}>{STATUS_META[key].label}</div>
                </div>
                {i < PIPELINE.length - 1 && <div style={{ flex: 1, height: 2, minWidth: 8, background: stepIndex > i ? STATUS_META[key].color + "88" : D.divider, borderRadius: 2 }} />}
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

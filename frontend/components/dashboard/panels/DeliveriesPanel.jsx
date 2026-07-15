import { D, glassCard } from "../theme.js";

// ─── Deliveries panel — scaffold (docs/superpowers/specs task 3) ─────────────
// Delivery Status is a NEW feature with NO backing data yet. Deliberately NOT
// faked (the app's real-derived-only convention; a past mockDeliveryOrders /
// mockRiders UI was deleted for being fictional). This renders the intended
// status-pipeline design plus an honest "coming soon / no orders yet" state.
//
// FUTURE BACKEND (not built this task — see the design spec):
//   • owner-scoped endpoint  GET /api/orders/received/  filtering
//     OrderItem.objects.filter(listing__business_owner=request.user)
//     (the OrderItem → listing.business_owner join already exists in the schema;
//      nothing queries it yet, and Order is customer-scoped + payment-status only)
//   • an OrderItem.fulfillment_status field advancing through the pipeline below
//     (owner PATCH), since one Order can span multiple sellers
//   • an optional delivery address captured at checkout (Order has none today)
//   • a matching frontend hook, e.g. useReceivedOrders()
// Courier / GPS tracking is explicitly out of scope even for that later build.

const PIPELINE = [
  { key: "pending", label: "Pending", icon: "🧾", color: D.textDim },
  { key: "preparing", label: "Preparing", icon: "👩🏾‍🍳", color: D.amber },
  { key: "dispatched", label: "Dispatched", icon: "📦", color: D.blue },
  { key: "out", label: "Out for delivery", icon: "🛵", color: D.purple },
  { key: "delivered", label: "Delivered", icon: "✅", color: D.green },
];

export default function DeliveriesPanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0, color: D.text, fontWeight: 900, fontSize: "0.98rem" }}>🚚 Delivery Status</h2>
        <span style={{ background: D.goldSoft, color: D.gold, borderRadius: 20, padding: "3px 11px", fontSize: "0.62rem", fontWeight: 800, letterSpacing: "0.03em" }}>COMING SOON</span>
      </div>

      {/* Pipeline preview — the board deliveries will flow through */}
      <div style={{ ...glassCard, padding: "20px 18px" }}>
        <div style={{ fontSize: "0.72rem", color: D.textDim, marginBottom: 16 }}>
          When order delivery goes live, each order for your listings will move along this pipeline — you&apos;ll advance the status as you fulfil it.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "space-between" }}>
          {PIPELINE.map((step, i) => (
            <div key={step.key} style={{ display: "flex", alignItems: "center", gap: 6, flex: "1 1 auto", minWidth: 0 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 84 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "1.25rem", background: `${step.color}1e`, border: `1.5px solid ${step.color}55`,
                }}>{step.icon}</div>
                <div style={{ fontSize: "0.62rem", fontWeight: 700, color: D.textDim, textAlign: "center" }}>{step.label}</div>
              </div>
              {i < PIPELINE.length - 1 && (
                <div style={{ flex: 1, height: 2, minWidth: 12, background: `linear-gradient(90deg, ${step.color}66, ${PIPELINE[i + 1].color}66)`, borderRadius: 2 }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Honest empty state */}
      <div style={{ ...glassCard, padding: "40px 24px", textAlign: "center" }}>
        <div style={{ fontSize: "2.4rem", marginBottom: 10 }}>🚚</div>
        <div style={{ fontWeight: 900, color: D.text, fontSize: "1rem", marginBottom: 8 }}>Delivery tracking is coming soon</div>
        <div style={{ color: D.textDim, fontSize: "0.8rem", lineHeight: 1.7, maxWidth: 460, margin: "0 auto" }}>
          You&apos;ll manage fulfilment for orders of your listings here once order delivery goes live — marking each one preparing, dispatched, out for delivery and delivered. There are no orders to show yet.
        </div>
      </div>
    </div>
  );
}

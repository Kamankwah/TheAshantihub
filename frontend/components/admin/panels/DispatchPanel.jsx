import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useMyDeliveries } from "../../../hooks/useMyDeliveries.js";
import DeliveryRouteMap from "../../DeliveryRouteMap.jsx";
import { D, glassCard } from "../theme.js";

// A Dispatch's assigned deliveries (punch-list item 11, delivery.dispatch).
// Each shows the pickup(s) and drop-off with a route map, and the two actions
// that move it along: confirm pickup at the business, then confirm delivery to
// the customer (the customer confirms receipt separately in their account).
// Single-column, big buttons, map toggle — built to use on a phone in the field.
const bigBtn = { border: "none", borderRadius: 20, padding: "11px 16px", fontSize: "0.82rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit", width: "100%" };

const STATUS_META = {
  assigned: { label: "Awaiting pickup", color: D.amber },
  picked_up: { label: "Out for delivery", color: D.blue },
  delivered: { label: "Delivered — awaiting customer", color: D.green },
  confirmed: { label: "Confirmed by customer", color: D.green },
};

function DeliveryCard({ delivery, onDone }) {
  const [showMap, setShowMap] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const meta = STATUS_META[delivery.status] || { label: delivery.status, color: D.textDim };

  const act = async (verb) => {
    setActionError(null);
    setBusy(true);
    try { await apiPost(`/api/orders/delivery/${delivery.id}/${verb}/`, {}); onDone(); }
    catch { setActionError(`Could not confirm ${verb === "pickup" ? "pickup" : "delivery"}. Please try again.`); }
    finally { setBusy(false); }
  };

  const dropoff = {
    lat: delivery.delivery_lat, lng: delivery.delivery_lng, address: delivery.delivery_address,
  };

  return (
    <div style={{ ...glassCard, padding: 16, marginBottom: 14, maxWidth: 560 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem" }}>Order #{delivery.order_id}</div>
        <span style={{ background: `${meta.color}22`, color: meta.color, borderRadius: 20, padding: "3px 11px", fontSize: "0.66rem", fontWeight: 800 }}>{meta.label}</span>
      </div>

      {/* Pickups */}
      <div style={{ marginTop: 10 }}>
        <div style={{ color: D.gold, fontWeight: 800, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Pickup</div>
        {(delivery.pickups || []).map((p, i) => (
          <div key={i} style={{ color: D.text, fontSize: "0.76rem", marginBottom: 3 }}>
            📦 {p.business_name} · 📞 {p.phone}
            <div style={{ color: D.textDim, fontSize: "0.68rem" }}>{p.items.join(", ")}</div>
          </div>
        ))}
      </div>

      {/* Drop-off */}
      <div style={{ marginTop: 8 }}>
        <div style={{ color: D.green, fontWeight: 800, fontSize: "0.68rem", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Drop-off</div>
        <div style={{ color: D.text, fontSize: "0.76rem" }}>🏠 {delivery.customer_name} · 📞 {delivery.delivery_phone}</div>
        <div style={{ color: D.textDim, fontSize: "0.72rem" }}>{delivery.delivery_address}</div>
      </div>

      <button onClick={() => setShowMap(s => !s)} style={{ background: "none", border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "6px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit", color: D.text, marginTop: 10 }}>
        {showMap ? "Hide map" : "🗺️ Show route map"}
      </button>
      {showMap && (
        <div style={{ marginTop: 10 }}>
          <DeliveryRouteMap pickups={delivery.pickups || []} dropoff={dropoff} />
        </div>
      )}

      {actionError && <div style={{ color: D.red, fontSize: "0.76rem", marginTop: 8 }}>{actionError}</div>}

      <div style={{ marginTop: 12 }}>
        {delivery.status === "assigned" && (
          <button onClick={() => act("pickup")} disabled={busy} style={{ ...bigBtn, background: D.gold, color: "#1a1205", opacity: busy ? 0.6 : 1 }}>📦 Confirm pickup</button>
        )}
        {delivery.status === "picked_up" && (
          <button onClick={() => act("deliver")} disabled={busy} style={{ ...bigBtn, background: D.green, color: "#fff", opacity: busy ? 0.6 : 1 }}>✓ Confirm delivered</button>
        )}
        {delivery.status === "delivered" && (
          <div style={{ color: D.textDim, fontSize: "0.74rem", textAlign: "center" }}>Waiting for the customer to confirm receipt.</div>
        )}
        {delivery.status === "confirmed" && (
          <div style={{ color: D.green, fontSize: "0.74rem", textAlign: "center", fontWeight: 700 }}>✓ Complete — customer confirmed receipt.</div>
        )}
      </div>
    </div>
  );
}

export default function DispatchPanel() {
  const { data, isLoading, isError, refetch } = useMyDeliveries();
  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading your deliveries…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your deliveries.</div>;
  const deliveries = data?.results || [];
  const active = deliveries.filter(d => d.status !== "confirmed");

  return (
    <div>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem", marginBottom: 4 }}>My deliveries</div>
      <div style={{ color: D.textFaint, fontSize: "0.72rem", marginBottom: 14 }}>{active.length} active.</div>
      {deliveries.length === 0 && <div style={{ color: D.textDim, fontSize: "0.82rem" }}>No deliveries assigned to you yet.</div>}
      {deliveries.map(d => <DeliveryCard key={d.id} delivery={d} onDone={refetch} />)}
    </div>
  );
}

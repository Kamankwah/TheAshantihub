import { useEffect, useState } from "react";
import { apiFetch, apiPost } from "../../../apiClient.js";
import { useDeliveryManagerOrders } from "../../../hooks/useDeliveryManagerOrders.js";
import { D, glassCard } from "../theme.js";

// Delivery Manager (punch-list item 11, delivery.manage): sees paid
// door-to-door orders and assigns a dispatch to each. Store-pickup orders
// never reach here (they're collected, not delivered).
const pillBtn = { border: "none", borderRadius: 20, padding: "6px 13px", fontSize: "0.74rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const inputStyle = { padding: "7px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.76rem", fontFamily: "inherit", background: D.panelBg2, color: D.text };

function OrderCard({ order, dispatches, onDone }) {
  const [dispatchId, setDispatchId] = useState(order.delivery_assignment?.dispatch || "");
  const [actionError, setActionError] = useState(null);
  const assignment = order.delivery_assignment;

  const assign = async () => {
    if (!dispatchId) return;
    setActionError(null);
    try {
      await apiPost(`/api/orders/${order.id}/assign-dispatch/`, { dispatch: Number(dispatchId) });
      onDone();
    } catch { setActionError("Could not assign this dispatch. Please try again."); }
  };

  return (
    <div style={{ ...glassCard, padding: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>Order #{order.id} · {order.customer_name}</div>
          <div style={{ color: D.textDim, fontSize: "0.72rem", marginTop: 2 }}>🏠 {order.delivery_address} · 📞 {order.delivery_phone}</div>
        </div>
        {assignment && (
          <span style={{ background: `${D.blue}22`, color: D.blue, borderRadius: 20, padding: "2px 10px", fontSize: "0.64rem", fontWeight: 800 }}>{assignment.status}</span>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        {(order.items || []).map(it => (
          <div key={it.id} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: D.textDim, padding: "2px 0" }}>
            <span>{it.listing_name} × {it.quantity}</span>
            <span>GHS {it.line_total}</span>
          </div>
        ))}
      </div>

      {actionError && <div style={{ color: D.red, fontSize: "0.74rem", marginTop: 6 }}>{actionError}</div>}

      <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select value={dispatchId} onChange={e => setDispatchId(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 140 }}>
          <option value="">Choose a dispatch…</option>
          {dispatches.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
        </select>
        <button onClick={assign} disabled={!dispatchId} style={{ ...pillBtn, background: dispatchId ? D.gold : D.panelBg2, color: dispatchId ? "#1a1205" : D.textFaint, cursor: dispatchId ? "pointer" : "default" }}>
          {assignment ? "Reassign" : "Assign"}
        </button>
      </div>
      {assignment?.dispatch_name && <div style={{ color: D.textFaint, fontSize: "0.68rem", marginTop: 6 }}>Currently: {assignment.dispatch_name}</div>}
    </div>
  );
}

export default function DeliveryManagerPanel() {
  const { data, isLoading, isError, refetch } = useDeliveryManagerOrders();
  const [dispatches, setDispatches] = useState([]);

  useEffect(() => {
    // Only ever needed here; a plain fetch, not a hook (same "self-fetch"
    // convention as MessagingPanel's thread fetch).
    apiFetch("/api/orders/dispatches/").then(setDispatches).catch(() => setDispatches([]));
  }, []);

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading deliveries…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load door-to-door orders.</div>;
  const orders = data?.results || [];

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem", marginBottom: 4 }}>Door-to-door deliveries</div>
      <div style={{ color: D.textFaint, fontSize: "0.72rem", marginBottom: 14 }}>{data?.count ?? orders.length} order{(data?.count ?? orders.length) === 1 ? "" : "s"} to coordinate.</div>
      {orders.length === 0 && <div style={{ color: D.textDim, fontSize: "0.82rem" }}>No door-to-door orders to deliver right now.</div>}
      {orders.map(o => <OrderCard key={o.id} order={o} dispatches={dispatches} onDone={refetch} />)}
    </div>
  );
}

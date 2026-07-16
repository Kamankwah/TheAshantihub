import { useState } from "react";
import { apiPatch } from "../../../apiClient.js";
import { useDeliveryQueue } from "../../../hooks/useDeliveryQueue.js";
import { D, glassCard } from "../theme.js";

const DELIVERY_STATUS_OPTIONS = [
  { value: "processing", label: "Processing" },
  { value: "shipped", label: "Shipped" },
  { value: "out_for_delivery", label: "Out for Delivery" },
  { value: "delivered", label: "Delivered" },
];

// Clones ReviewsModerationPanel's exact shape: useDeliveryQueue() is
// paginated ({count, next, previous, results}), so items reads data?.results
// (not data||[]). Only paid orders get the delivery-status <select> — a
// pending/cancelled order has nothing to ship yet.
export default function DeliveryManagementPanel() {
  const { data, isLoading, isError, refetch } = useDeliveryQueue();
  const [updatingId, setUpdatingId] = useState(null);
  const [actionError, setActionError] = useState(null);

  const updateStatus = async (id, delivery_status) => {
    setActionError(null);
    setUpdatingId(id);
    try {
      await apiPatch(`/api/orders/${id}/delivery-status/`, { delivery_status });
      refetch();
    } catch (err) {
      setActionError("Could not update this order's delivery status.");
    } finally {
      setUpdatingId(null);
    }
  };

  if (isLoading) return <div style={{ color: D.textDim, fontSize: "0.8rem" }}>Loading…</div>;
  if (isError) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the orders queue.</div>;
  const items = data?.results || [];

  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.88rem", marginBottom: 14 }}>Orders ({data?.count ?? items.length})</div>
      {actionError && <div style={{ color: D.red, fontSize: "0.8rem", marginBottom: 10 }}>{actionError}</div>}
      {items.length === 0 && <div style={{ color: D.textDim, fontSize: "0.8rem" }}>No orders yet.</div>}
      {items.map(o => (
        <div key={o.id} style={{ padding: "12px 0", borderBottom: `1px solid ${D.divider}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{o.customer_name}</div>
              <div style={{ color: D.textDim, fontSize: "0.68rem" }}>Order #{o.id} • {o.status} • GHS {o.total_amount} • {o.placed_at?.slice(0, 10)}</div>
            </div>
            {o.status === "paid" && (
              <select
                value={o.delivery_status}
                disabled={updatingId === o.id}
                onChange={e => updateStatus(o.id, e.target.value)}
                style={{ padding: "5px 10px", borderRadius: 10, border: `1.5px solid ${D.cardBorder}`, fontSize: "0.72rem", fontFamily: "inherit", background: D.panelBg2, color: D.text }}
              >
                {DELIVERY_STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useBusinessOrders } from "../../../hooks/useBusinessOrders.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { shortDay } from "../../../lib/followUp.js";
import { D } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { card, errorStyle, h3 } from "./portfolioParts.jsx";

const SHOWN = 2;
const ALL = 20;
const DELIVERY = { processing: "Processing", shipped: "Shipped", out_for_delivery: "Out for delivery", delivered: "Delivered" };
const row = { padding: "8px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.8rem", color: D.text };
const figures = { fontVariantNumeric: "tabular-nums" };

const itemText = (order) => order.items.map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name)).join(", ") || "Order";

// The status chips of one order, in the canvas's words: "Return open · wrong size"
// becomes "<Reason> open" here, from the open dispute's reason; "Delivered 2 Oct".
export function statusChips(order) {
  const chips = [];
  if (order.dispute) {
    chips.push([`${order.dispute.reason_label} ${order.dispute.status === "investigating" ? "being looked at" : "open"}`, D.amber]);
  }
  if (order.delivery_status === "delivered") {
    chips.push([order.delivered_at ? `Delivered ${shortDay(order.delivered_at).replace(/^\w+ /, "")}` : "Delivered", D.green]);
  } else {
    chips.push([DELIVERY[order.delivery_status] || order.delivery_status, D.blue]);
  }
  if (order.problem_flagged) chips.push(["Reported to the Delivery Manager", D.gold]);
  return chips;
}

// 03 Business page: "Orders & deliveries · Read-only". Customers are never
// shown: an order is its number, this business's own lines and its status.
export default function OrdersSection({ businessId, canFlag }) {
  const [showAll, setShowAll] = useState(false);
  const { data, isLoading, isError, refetch } = useBusinessOrders(businessId, showAll ? ALL : SHOWN);
  const orders = data?.results || [];
  const hidden = Math.max(0, (data?.count || 0) - orders.length);

  return (
    <section aria-label="Orders and deliveries" style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h3 style={h3}>Orders &amp; deliveries</h3>
        <span style={{ ...dim, fontWeight: 600 }}>Read-only</span>
      </div>
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && (
        <div role="alert" style={errorStyle}>
          Couldn't load the orders.{" "}
          <button type="button" onClick={() => refetch()} style={{ ...button(D.panelBg, D.text), padding: "4px 10px" }}>Try again</button>
        </div>
      )}
      {!isLoading && !isError && orders.length === 0 && <div style={dim}>No paid orders yet.</div>}
      {orders.map((order) => (
        <div key={order.id} style={{ ...row, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span><span style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontWeight: 500 }}>{order.number}</span>{` · ${itemText(order)}`}</span>
          <span style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {statusChips(order).map(([label, color]) => <span key={label} style={{ ...chip(color), ...figures }}>{label}</span>)}
          </span>
        </div>
      ))}
      {(hidden > 0 || showAll) && (
        <button type="button" onClick={() => setShowAll((v) => !v)} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start", marginTop: 6 }}>
          {showAll ? "Show fewer" : `See all ${data.count}`}
        </button>
      )}
      {canFlag && <div style={dim}>Customers aren't shown, and neither you nor the business contacts them. Use "Flag a delivery problem" above if one went wrong.</div>}
    </section>
  );
}

export function FlagForm({ businessId, onCancel, onDone }) {
  const queryClient = useQueryClient();
  const { data } = useBusinessOrders(businessId, ALL);
  const orders = data?.results || [];
  const [orderId, setOrderId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const chosen = orderId || String(orders[0]?.id || "");
  if (data && orders.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={dim}>There are no paid orders for this business to flag yet.</div>
        <button type="button" onClick={onCancel} style={{ ...button(D.panelBg, D.text), alignSelf: "flex-start" }}>Close</button>
      </div>
    );
  }

  const send = async (e) => {
    e.preventDefault();
    setError(null);
    if (!chosen) { setError("Pick the order."); return; }
    if (!note.trim()) { setError("Say what went wrong, in a sentence."); return; }
    setBusy(true);
    try {
      const result = await apiPost(`/api/portfolio/businesses/${businessId}/orders/${chosen}/delivery-problem/`, { note: note.trim() });
      queryClient.invalidateQueries({ queryKey: ["business-orders"] });
      queryClient.invalidateQueries({ queryKey: ["my-tasks"] });
      onDone(result?.already
        ? "This order was already reported. The Delivery Manager has it."
        : "The Delivery Manager is told and takes it from here.");
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't send that. Try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={send} aria-label="Flag a delivery problem" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text }}>Which order
        <select value={chosen} onChange={(e) => setOrderId(e.target.value)} style={{ ...field, minHeight: 44 }}>
          {orders.map((o) => <option key={o.id} value={o.id}>{`${o.number} · ${itemText(o)}`}</option>)}
        </select>
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.72rem", fontWeight: 700, color: D.text }}>What went wrong
        <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} style={field} />
      </label>
      <div style={callout(D.gold)}>The Delivery Manager is told and takes it from here.</div>
      {error && <div role="alert" style={errorStyle}>{error}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" disabled={busy} style={{ ...button(D.gold, D.text, busy), minHeight: 44 }}>{busy ? "Sending…" : "Tell the Delivery Manager"}</button>
        <button type="button" onClick={onCancel} style={{ ...button(D.panelBg, D.text), minHeight: 44 }}>Cancel</button>
      </div>
    </form>
  );
}

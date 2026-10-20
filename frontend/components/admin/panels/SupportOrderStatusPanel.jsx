import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useOrderRedeliveries } from "../../../hooks/useRedeliveries.js";
import { useSupportOrder, useSupportOrderSearch } from "../../../hooks/useSupportOrders.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { button, callout, chip, dim, field } from "./panelStyles.js";
import { formatDateTime, labelStyle, money } from "./portfolioParts.jsx";

// 11 Order status (Support). Find an order, read where it really is, and take the two actions Support is
// allowed: mark it running late (a note and the new expected time, typed as text) or cancelled at the
// customer's request (only before pickup). Delivered is never offered; only the courier's confirmation sets
// it. Check-ins, wait timers, codes and the rider's last location are recorded by the Delivery phase and show
// here as a plain note until then. The payments banner comes from the server's payments provider.
const ACTION_LABEL = { running_late: "Running late", cancelled_by_customer: "Cancelled by customer" };
const STATUS_LABEL = { pending: "Payment pending", paid: "Paid", cancelled: "Cancelled" };
const DELIVERY_LABEL = { processing: "Processing", shipped: "Shipped", out_for_delivery: "Out for delivery", delivered: "Delivered" };
const METHOD_LABEL = { door_to_door: "Door-to-door", store_pickup: "Pickup" };

function orderFromUrl() {
  try { return new URLSearchParams(window.location.search).get("order") || ""; } catch { return ""; }
}

export function customerMessage(kind, orderId, expected) {
  if (kind === "running_late") return `Your order #${orderId} is running late. New expected time: ${expected || "…"}. Sorry for the wait.`;
  return `Your order #${orderId} was cancelled at your request. Contact AshantiHub Support with any question.`;
}

function UpdateForm({ order, onDone }) {
  const [kind, setKind] = useState(order.actions[0]);
  const [expected, setExpected] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const queryClient = useQueryClient();
  const late = kind === "running_late";
  const ready = reason.trim() && (!late || expected.trim());
  const save = async () => {
    setError(null); setNotice(null);
    try {
      await apiPost(`/api/orders/${order.id}/support-status/`, { status: kind, reason, expected_time: late ? expected : "" });
      setReason(""); setExpected(""); setConfirming(false);
      setNotice("Saved. The customer has been told in-app and by email.");
      queryClient.invalidateQueries({ queryKey: ["support-orders"] });
      onDone();
    } catch (err) { setConfirming(false); setError(apiErrorMessage(err, "Could not save the change.")); }
  };
  return (
    <section aria-label="Update the status" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ color: D.text, fontWeight: 800 }}>Update the status</div>
      <label style={labelStyle}>New status
        <select value={kind} onChange={(e) => { setKind(e.target.value); setConfirming(false); }} style={field}>
          {order.actions.map((a) => <option key={a} value={a}>{ACTION_LABEL[a]}</option>)}
        </select>
      </label>
      {late && <label style={labelStyle}>New expected time<input value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="for example about 12:15" style={field} /></label>}
      <label style={labelStyle}>Reason (kept on the order)<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} style={field} /></label>
      <div style={{ ...dim, color: D.text }}><strong>{`${order.customer} will see: `}</strong>{customerMessage(kind, order.id, expected)}</div>
      <div style={dim}>The customer is told in-app and by email. SMS is not connected.</div>
      {!late && <div style={callout(D.amber)}>Cancelling does not refund anything. No money moves from this screen.</div>}
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
      {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      {late || confirming ? (
        <button type="button" disabled={!ready} onClick={save} style={{ ...button(late ? D.text : D.red, late ? D.panelBg : "#fff", !ready), alignSelf: "flex-start" }}>{late ? "Save and notify" : "Confirm cancel and notify"}</button>
      ) : (
        <button type="button" disabled={!ready} onClick={() => setConfirming(true)} style={{ ...button(D.red, "#fff", !ready), alignSelf: "flex-start" }}>Cancel the order…</button>
      )}
      <div style={dim}>Support cannot mark an order Delivered; that happens when the delivery is confirmed. Your change is recorded with your name and reason.</div>
    </section>
  );
}

// Re-delivery at the customer's request (Plan 7F-E Task 7). Only for staff holding orders.redeliver, and only
// when the server says the order qualifies (the rider reached the address and could not reach the customer).
// The fee is the governed setting the server copies onto the request; giving the second trip to a rider stays
// with the Dispatch / Delivery Manager.
const REDELIVERY_STATE = {
  awaiting_payment: (fee) => `Waiting for the customer to pay GH₵ ${fee}.`,
  paid: (fee) => `The customer paid GH₵ ${fee}. Waiting for Dispatch to give it to a rider.`,
  assigned: () => "Given to a rider for the second trip.",
  completed: () => "The second trip is done.",
  cancelled: () => "Cancelled. No money moved.",
  refunded: (fee) => `Cancelled. GH₵ ${fee} went back to the customer's AshantiHub wallet.`,
};

function RedeliverySection({ order }) {
  const { data, refetch } = useOrderRedeliveries(order.id);
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const latest = data?.results?.[0] || null;
  const open = latest && ["awaiting_payment", "paid", "assigned"].includes(latest.status);
  if (!order.redeliverable && !latest) return null;
  const ask = async () => {
    setError(null); setBusy(true);
    try {
      await apiPost("/api/delivery/redeliveries/", { order: order.id, reason });
      setReason("");
      refetch();
    } catch (err) { setError(apiErrorMessage(err, "Could not ask for the re-delivery.")); }
    setBusy(false);
  };
  const cancel = async () => {
    setError(null); setBusy(true);
    try { await apiPost(`/api/delivery/redeliveries/${latest.id}/cancel/`, {}); refetch(); }
    catch (err) { setError(apiErrorMessage(err, "Could not cancel the re-delivery.")); }
    setBusy(false);
  };
  return (
    <section aria-label="Re-deliver at the customer's request" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ color: D.text, fontWeight: 800 }}>Re-deliver at the customer's request</div>
      {latest && (
        <div role="status" style={callout(open ? D.amber : D.textFaint)}>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{(REDELIVERY_STATE[latest.status] || (() => latest.status_label))(latest.fee)}</span>
        </div>
      )}
      {latest && ["awaiting_payment", "paid"].includes(latest.status) && (
        <button type="button" disabled={busy} onClick={cancel} style={{ ...button(D.panelBg, D.text, busy), alignSelf: "flex-start" }}>
          {latest.status === "paid" ? "Cancel and return the fee" : "Cancel the re-delivery"}
        </button>
      )}
      {!open && order.redeliverable && (
        <>
          <div style={dim}>
            The rider reached the address and could not reach the customer, and the goods came back. If the customer asks
            for it again, they pay a re-delivery fee of <strong style={{ color: D.text, fontVariantNumeric: "tabular-nums" }}>{`GH₵ ${order.redelivery_fee}`}</strong> first.
            The original delivery fee stays with the first rider.
          </div>
          <label style={labelStyle}>Reason (kept on the order)<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} style={field} /></label>
          <button type="button" disabled={busy || !reason.trim()} onClick={ask} style={{ ...button(D.text, D.panelBg, busy || !reason.trim()), alignSelf: "flex-start" }}>Ask the customer to pay and deliver again</button>
        </>
      )}
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
    </section>
  );
}

function Detail({ id, canRedeliver }) {
  const { data: order, isLoading, isError, refetch } = useSupportOrder(id);
  if (isLoading) return <div style={dim}>Loading…</div>;
  if (isError || !order) return <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not load that order.</div>;
  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "1.05rem" }}>{`Order #${order.id}`}</div>
        <div style={dim}>{`${order.customer} · from ${order.businesses.join(", ") || "—"} · ordered ${formatDateTime(order.placed_at)}`}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          <span style={chip(D.blue)}>{METHOD_LABEL[order.delivery_method] || order.delivery_method}</span>
          <span style={chip(order.status === "cancelled" ? D.red : D.green)}>{STATUS_LABEL[order.status] || order.status}</span>
          <span style={chip(D.amber)}>{DELIVERY_LABEL[order.delivery_status] || order.delivery_status}</span>
        </div>
      </div>
      {order.payments?.text && <div style={callout(D.gold)}>{order.payments.text}</div>}
      <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, margin: 0 }}>
        <div><dt style={dim}>Order total</dt><dd style={{ margin: 0, color: D.text, fontWeight: 800 }}>{money(order.total)}</dd></div>
        {order.rider && <div><dt style={dim}>Rider</dt><dd style={{ margin: 0, color: D.text, fontWeight: 800 }}>{order.rider}</dd></div>}
        {order.delivery_method === "door_to_door" && <div><dt style={dim}>Deliver to</dt><dd style={{ margin: 0, color: D.text, fontWeight: 800 }}>{order.delivery_address || "No address on file"}</dd><div style={dim}>{order.delivery_phone ? `Delivery phone ${order.delivery_phone}` : ""}</div></div>}
        <div><dt style={dim}>Items</dt><dd style={{ margin: 0, color: D.text }}>{order.lines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}</dd></div>
      </dl>
      <ol aria-label="Timeline" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {order.timeline.map((e, i) => (
          <li key={`${e.key}-${i}`} style={{ display: "flex", gap: 8 }}>
            <span aria-hidden="true" style={{ color: D.green }}>●</span>
            <div><div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{e.label}</div><div style={dim}>{[formatDateTime(e.at), e.detail].filter(Boolean).join(" · ")}</div></div>
          </li>
        ))}
      </ol>
      <div style={dim}>{order.delivery_note}</div>
      {canRedeliver && <RedeliverySection order={order} />}
      {order.actions.length > 0 ? <UpdateForm key={`${order.id}-${order.timeline.length}`} order={order} onDone={refetch} /> : <div style={callout(D.textFaint)}>No Support change is available for this order now.</div>}
      <section aria-label="Door-to-door or pickup" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ color: D.text, fontWeight: 800 }}>Door-to-door or pickup</div>
        <div style={dim}>Support can mark a door-to-door order running late, or cancelled by the customer before it is picked up. Can't-deliver outcomes, arrival stamps and codes arrive with Delivery. A pickup order can be marked running late or cancelled the same way.</div>
      </section>
    </div>
  );
}

export default function SupportOrderStatusPanel({ orderId: orderProp, auth = null }) {
  const canRedeliver = Boolean(auth?.hasPermission?.("orders.redeliver"));
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [selected, setSelected] = useState(orderProp ? String(orderProp) : orderFromUrl());
  const search = useSupportOrderSearch(term);
  const rows = search.data?.results || [];
  const recent = search.data?.recent || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "1.05rem" }}>Order status</div>
        <form onSubmit={(e) => { e.preventDefault(); setTerm(q); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ ...labelStyle, flex: "1 1 260px" }}>Find an order
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order number, customer name or phone" style={field} />
          </label>
          <button type="submit" style={button(D.text, D.panelBg)}>Find</button>
        </form>
        {recent.length > 0 && (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={dim}>Recent:</span>
            {recent.map((id) => <button key={id} type="button" onClick={() => setSelected(String(id))} style={button(D.panelBg, D.text)}>{`#${id}`}</button>)}
          </div>
        )}
        {search.isError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>Could not search orders.</div>}
        {!search.isLoading && rows.length === 0 && <div style={{ color: D.textDim, fontSize: "0.85rem" }}>{term ? "No order matches that." : "No orders yet."}</div>}
        <div role="list" aria-label="Orders" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.map((r) => (
            <button key={r.id} type="button" role="listitem" aria-current={String(r.id) === selected ? "true" : undefined} onClick={() => setSelected(String(r.id))}
              style={{ textAlign: "left", background: String(r.id) === selected ? D.panelBg2 : D.panelBg, border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 12px", cursor: "pointer", fontFamily: "inherit", color: D.text }}>
              <strong>{`#${r.id}`}</strong>{` · ${r.customer}${r.customer_phone ? ` · ${r.customer_phone}` : ""} · ${r.businesses.join(", ")} · ${money(r.total)} · ${DELIVERY_LABEL[r.delivery_status] || r.delivery_status}`}
            </button>
          ))}
        </div>
      </div>
      {selected && <Detail id={selected} canRedeliver={canRedeliver} />}
    </div>
  );
}

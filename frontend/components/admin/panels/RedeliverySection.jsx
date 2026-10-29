import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useOrderRedeliveries } from "../../../hooks/useRedeliveries.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, callout, dim, field } from "./panelStyles.js";
import { labelStyle } from "./portfolioParts.jsx";

// Re-delivery at the customer's request (Plan 7F-E Task 7). Only for staff holding orders.redeliver, and only
// when the server says the order qualifies (the rider reached the address and the customer did not answer or refused it).
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

export default function RedeliverySection({ order }) {
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
            The rider reached the address and the customer did not answer or refused the order, and the goods came back. If the customer asks
            for it again, they pay a re-delivery fee of <strong style={{ color: D.text, fontVariantNumeric: "tabular-nums" }}>{`GH₵ ${order.redelivery_fee}`}</strong> first.
            The original delivery fee is settled for the first trip.
          </div>
          <label style={labelStyle}>Reason (kept on the order)<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="What the customer asked for (no phone numbers)" style={field} /></label>
          <button type="button" disabled={busy || !reason.trim()} onClick={ask} style={{ ...button(D.text, D.panelBg, busy || !reason.trim()), alignSelf: "flex-start" }}>Ask the customer to pay and deliver again</button>
        </>
      )}
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{error}</div>}
    </section>
  );
}

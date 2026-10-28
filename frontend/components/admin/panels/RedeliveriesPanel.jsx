import { useState } from "react";
import { useOrderRedeliveries } from "../../../hooks/useRedeliveries.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { formatGhs } from "../../wallet/walletMoney.js";
import { D } from "../theme.js";
import RedeliverySection from "./RedeliverySection.jsx";
import { button, callout, dim, field } from "./panelStyles.js";
import { card, errorStyle, h2, h3, labelStyle } from "./portfolioParts.jsx";

// Re-deliveries (wallet 5F Task 9, Director ruling 8): the Super Admin and the Pickup Desk (orders.redeliver) ask for an
// order to be delivered again at the customer's request. The order number is all that is typed; the server says whether the
// order qualifies, the fee in force and, when it does not, why. Everything shown comes from that answer. It carries no
// customer phone, email or address, because the Pickup Desk must not see them (spec section 4.3). Giving the second trip to a
// rider stays with Dispatch and the Delivery Manager.
const OPEN = ["awaiting_payment", "paid", "assigned"];
const PAID_THROUGH = {
  payroll: "Owed to the rider through payroll",
  wallet: "Paid to the rider's AshantiHub wallet",
};

function orderNumber(text) {
  const match = /^#?\s*(\d+)$/.exec(text.trim());
  return match ? String(Number(match[1])) : null;
}

function Attempts({ rows }) {
  if (!rows.length) return null;
  return (
    <section aria-label="Earlier attempts" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h3 style={h3}>Earlier attempts</h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => (
          <li key={r.id} style={{ ...callout(D.textFaint), display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ color: D.text, fontWeight: 800 }}>{`Attempt ${r.attempt} · ${r.status_label}`}</span>
            <span style={{ ...dim, fontVariantNumeric: "tabular-nums" }}>{`Fee ${formatGhs(r.fee)}`}</span>
            {r.reason && <span style={dim}>{`Reason: ${r.reason}`}</span>}
            {r.requested_by && <span style={dim}>{`Asked for by ${r.requested_by}`}</span>}
            {r.rider && <span style={dim}>{`Rider: ${r.rider}`}</span>}
            {PAID_THROUGH[r.paid_through] && <span style={dim}>{PAID_THROUGH[r.paid_through]}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Result({ orderId }) {
  const { data, isLoading, isError, error } = useOrderRedeliveries(orderId);
  if (isLoading) return <div style={dim}>Loading…</div>;
  if (isError || !data) return <div role="alert" style={errorStyle}>{apiErrorMessage(error, "Could not load that order's re-deliveries.")}</div>;
  const rows = data.results || [];
  const latest = rows[0] || null;
  const open = Boolean(latest && OPEN.includes(latest.status));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={h3}>{`Order #${orderId}`}</h3>
      {!latest && !data.redeliverable && data.not_redeliverable_reason && (
        <div role="status" style={callout(D.amber)}>{data.not_redeliverable_reason}</div>
      )}
      <RedeliverySection order={{ id: Number(orderId), redeliverable: Boolean(data.redeliverable), redelivery_fee: data.redelivery_fee }} />
      <Attempts rows={open ? rows.slice(1) : rows} />
    </div>
  );
}

export default function RedeliveriesPanel() {
  const [text, setText] = useState("");
  const [orderId, setOrderId] = useState(null);
  const [bad, setBad] = useState(false);
  const find = (e) => {
    e.preventDefault();
    const id = orderNumber(text);
    setBad(!id);
    if (id) setOrderId(id);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section aria-label="Re-deliveries" style={card}>
        <h2 style={h2}>Re-deliveries</h2>
        <div style={dim}>
          Ask for an order to be delivered again at the customer's request. The customer pays the re-delivery fee first. Dispatch gives
          the second trip to one of AshantiHub's own riders, or to a third-party rider when none of them is available.
        </div>
        <form onSubmit={find} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ ...labelStyle, flex: "1 1 220px" }}>Order number
            <input value={text} onChange={(e) => setText(e.target.value)} inputMode="numeric" placeholder="For example 1042" style={field} />
          </label>
          <button type="submit" style={button(D.text, D.panelBg)}>Find</button>
        </form>
        {bad && <div role="alert" style={errorStyle}>Type the order number, digits only.</div>}
      </section>
      {orderId && <div style={{ ...card }}><Result key={orderId} orderId={orderId} /></div>}
    </div>
  );
}

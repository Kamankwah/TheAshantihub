import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBookingsAwaitingCall, useOrdersAwaitingCall } from "../../../hooks/useVerificationCalls.js";
import { walletMessage } from "../../wallet/walletErrors.js";
import { D, glassCard } from "../theme.js";
import BookingCancelTab from "./BookingCancelTab.jsx";
import CallOutcomeForm from "./CallOutcomeForm.jsx";
import { button, callout, chip, dim, pill } from "./panelStyles.js";
import { Title, page } from "./insightsParts.jsx";

// ─── Verification calls ──────────────────────────────────────────────────────
// What Support rings the customer about before money goes to a business. Both queues are PAGINATED (DRF envelope,
// 20 a page: data.results and count) and carry the customer's full phone, which is why this screen needs
// orders.verify. Businesses are never contacted: Support calls the customer. Every time shown comes from the row.
const PAGE_SIZE = 20;
const when = (iso) => (iso ? new Date(iso).toLocaleString("en-GH") : "—");
const figures = { fontVariantNumeric: "tabular-nums" };
const OUTCOME_WORDS = { matches: "matched", does_not_match: "did not match", unreachable: "could not reach the customer" };

export function CustomerLine({ name, phone }) {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", color: D.text, fontSize: "0.85rem" }}>
      <span>{name}</span>
      <a href={`tel:${phone}`} style={{ color: D.text, fontWeight: 700, ...figures }}>Call {phone}</a>
    </div>
  );
}

export function LastCall({ outcome, note }) {
  if (!outcome) return null;
  return <div style={dim}>Last call: {OUTCOME_WORDS[outcome] || outcome}{note ? `, ${note}` : ""}</div>;
}

function OrderRow({ order, onNavigate, open, onToggle, onDone }) {
  const title = `Order #${order.order_id}`;
  return (
    <li style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 8, listStyle: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {onNavigate
          ? <button type="button" onClick={() => onNavigate("support-order-status", { order: order.order_id })} style={{ ...button(D.panelBg, D.text, false), fontWeight: 800 }}>{title}</button>
          : <div style={{ color: D.text, fontWeight: 800 }}>{title}</div>}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {order.overdue && <span style={chip(D.amber)}>Overdue</span>}
          {order.customer_confirmed && <span style={chip(D.green)}>Customer confirmed receipt</span>}
        </div>
      </div>
      <CustomerLine name={order.customer_name} phone={order.customer_phone} />
      <div style={{ color: D.text, fontSize: "0.82rem" }}>{order.delivery_method === "store_pickup" ? "Collected at the office" : "Delivered"}</div>
      <div style={{ ...dim, ...figures, display: "flex", gap: 10, flexWrap: "wrap" }}><span>Placed {when(order.placed_at)}</span><span>Due by {when(order.due_by)}</span></div>
      <ul style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {order.items.map((item, i) => <li key={i} style={{ listStyle: "none", color: D.text, fontSize: "0.82rem" }}>{item.quantity} × {item.name}, {item.business}</li>)}
      </ul>
      <LastCall outcome={order.outcome} note={order.outcome_note} />
      <div><button type="button" onClick={onToggle} aria-expanded={open} style={button(D.panelBg, D.text, false)}>Record the call</button></div>
      {open && <CallOutcomeForm subject="order" id={order.order_id} customerConfirmed={order.customer_confirmed} onDone={onDone} />}
    </li>
  );
}

const KIND_WORDS = { service: "Service", stay: "Stay", tickets: "Tickets" };
const SCAN_NOTE = "Scanned at the door (the organiser's scan)";

function BookingRow({ sale, open, onToggle, onDone }) {
  const scanned = sale.kind === "tickets" && sale.customer_confirmed;
  return (
    <li style={{ ...glassCard, padding: 14, display: "flex", flexDirection: "column", gap: 8, listStyle: "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={chip(D.textDim)}>{KIND_WORDS[sale.kind] || sale.kind}</span>
          <span style={{ color: D.text, fontWeight: 800 }}>{sale.what}</span>
        </div>
        <span data-amount style={{ color: D.text, fontWeight: 800, ...figures }}>GH₵{sale.amount}</span>
      </div>
      <div style={{ color: D.text, fontSize: "0.85rem" }}>{sale.business}</div>
      <CustomerLine name={sale.customer_name} phone={sale.customer_phone} />
      <div style={{ ...dim, ...figures, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <span>Paid {when(sale.paid_at)}</span>
        <span>Received {when(sale.handed_over_at)}</span>
        {!sale.overdue && sale.due_by && <span>Releases by itself {when(sale.due_by)}</span>}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {sale.overdue && <span style={chip(D.amber)}>Not released: past its release time</span>}
        {sale.dispute_id && <span style={chip(D.red)}>Dispute #{sale.dispute_id}</span>}
        {sale.customer_confirmed && <span style={chip(D.green)}>{scanned ? SCAN_NOTE : "Customer confirmed"}</span>}
      </div>
      <LastCall outcome={sale.outcome} note={sale.outcome_note} />
      <div><button type="button" onClick={onToggle} aria-expanded={open} style={button(D.panelBg, D.text, false)}>Record the call</button></div>
      {open && <CallOutcomeForm subject="booking" id={sale.sale_id} customerConfirmed={sale.customer_confirmed} confirmedByScan={scanned} onDone={onDone} />}
    </li>
  );
}

export function Paging({ pageNo, setPageNo, count }) {
  if (count <= PAGE_SIZE) return null;
  const first = pageNo <= 1;
  const last = pageNo * PAGE_SIZE >= count;
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <button type="button" onClick={() => setPageNo((n) => n - 1)} disabled={first} style={button(D.panelBg, D.text, first)}>Previous</button>
      <button type="button" onClick={() => setPageNo((n) => n + 1)} disabled={last} style={button(D.panelBg, D.text, last)}>Next</button>
    </div>
  );
}

// One queue's body: loading, the off line, an error, empty, or the list, then paging.
export function QueueBody({ query, emptyText, label, renderRow, pageNo, setPageNo }) {
  const off = query.error && walletMessage(query.error).kind === "off";
  const rows = query.data?.results || [];
  const count = query.data?.count ?? 0;
  return (
    <>
      {off ? <div role="status" style={dim}>Verification calls open when the ledger is switched on.</div>
        : query.error ? <div role="alert" style={callout(D.red)}>{walletMessage(query.error).text}</div>
        : !query.data ? <div role="status" style={dim}>Loading…</div>
        : !rows.length ? <div style={dim}>{emptyText}</div>
        : <ul aria-label={label} style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>{rows.map(renderRow)}</ul>}
      <Paging pageNo={pageNo} setPageNo={setPageNo} count={count} />
    </>
  );
}

// Each tab owns its hook, page and open form, so only the visible queue is fetched; switching tabs remounts it.
function OrdersTab({ onNavigate, onNotice }) {
  const [pageNo, setPageNo] = useState(1);
  const [openId, setOpenId] = useState(null);
  const query = useOrdersAwaitingCall({ page: pageNo });
  return (
    <>
      <div style={dim}>A product order is paid to the business only after this call.</div>
      <QueueBody query={query} emptyText="No order is waiting for a call." label="Orders waiting for a call" pageNo={pageNo} setPageNo={setPageNo}
        renderRow={(order) => (
          <OrderRow key={order.order_id} order={order} onNavigate={onNavigate} open={openId === order.order_id}
            onToggle={() => { onNotice(""); setOpenId(openId === order.order_id ? null : order.order_id); }}
            onDone={(text) => { setOpenId(null); onNotice(text); }} />
        )} />
    </>
  );
}

function BookingsTab({ onNotice }) {
  const [pageNo, setPageNo] = useState(1);
  const [openId, setOpenId] = useState(null);
  const query = useBookingsAwaitingCall({ page: pageNo });
  return (
    <>
      <div style={dim}>Services, stays and tickets are paid to the business by themselves at the time shown, unless a dispute is open. A call can release one earlier (Matches), open a dispute (Does not match) or note that you could not reach the customer.</div>
      <QueueBody query={query} emptyText="No booking is waiting for a call." label="Bookings waiting for a call" pageNo={pageNo} setPageNo={setPageNo}
        renderRow={(sale) => (
          <BookingRow key={sale.sale_id} sale={sale} open={openId === sale.sale_id}
            onToggle={() => { onNotice(""); setOpenId(openId === sale.sale_id ? null : sale.sale_id); }}
            onDone={(text) => { setOpenId(null); onNotice(text); }} />
        )} />
    </>
  );
}

export default function VerificationCallsPanel({ auth, onNavigate }) {
  const canCancel = Boolean(auth?.hasPermission?.("orders.support_update"));
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("orders");
  const [notice, setNotice] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ledger-verification"] });
  const switchTab = (next) => { setTab(next); setNotice(""); };
  return (
    <div style={page}>
      <Title right={<button type="button" onClick={refresh} style={button(D.panelBg, D.text, false)}>Refresh</button>}>Verification calls</Title>
      <div role="group" aria-label="Queues" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" aria-pressed={tab === "orders"} onClick={() => switchTab("orders")} style={pill(tab === "orders")}>Orders</button>
        <button type="button" aria-pressed={tab === "bookings"} onClick={() => switchTab("bookings")} style={pill(tab === "bookings")}>Bookings</button>
        {canCancel && <button type="button" aria-pressed={tab === "cancel"} onClick={() => switchTab("cancel")} style={pill(tab === "cancel")}>Cancel a booking</button>}
      </div>
      {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      {tab === "orders" && <OrdersTab onNavigate={onNavigate} onNotice={setNotice} />}
      {tab === "bookings" && <BookingsTab onNotice={setNotice} />}
      {tab === "cancel" && canCancel && <BookingCancelTab />}
    </div>
  );
}

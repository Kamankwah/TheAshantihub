import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrdersAwaitingCall } from "../../../hooks/useVerificationCalls.js";
import { walletMessage } from "../../wallet/walletErrors.js";
import { D, glassCard } from "../theme.js";
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

export default function VerificationCallsPanel({ auth, onNavigate }) {
  void auth;
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("orders");
  const [pageNo, setPageNo] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [notice, setNotice] = useState("");
  const orders = useOrdersAwaitingCall({ page: pageNo });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["ledger-verification"] });
  const switchTab = (next) => { setTab(next); setPageNo(1); setOpenId(null); setNotice(""); };
  const done = (text) => { setOpenId(null); setNotice(text); };
  return (
    <div style={page}>
      <Title right={<button type="button" onClick={refresh} style={button(D.panelBg, D.text, false)}>Refresh</button>}>Verification calls</Title>
      <div role="group" aria-label="Queues" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" aria-pressed={tab === "orders"} onClick={() => switchTab("orders")} style={pill(tab === "orders")}>Orders</button>
      </div>
      {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      {tab === "orders" && (
        <>
          <div style={dim}>A product order is paid to the business only after this call.</div>
          <QueueBody query={orders} emptyText="No order is waiting for a call." label="Orders waiting for a call" pageNo={pageNo} setPageNo={setPageNo}
            renderRow={(order) => (
              <OrderRow key={order.order_id} order={order} onNavigate={onNavigate} open={openId === order.order_id}
                onToggle={() => { setNotice(""); setOpenId(openId === order.order_id ? null : order.order_id); }} onDone={done} />
            )} />
        </>
      )}
    </div>
  );
}

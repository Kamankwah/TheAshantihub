import { useState } from "react";
import { useSaOrder, useSaOrderCounts, useSaOrders } from "../../../hooks/useMarketplace.js";
import { D } from "../theme.js";
import { button, callout, dim } from "./panelStyles.js";
import { Chip, ExportButton, FilterBar, KpiStrip, LoadState, Pager, ScreenHeader, SimulatedBanner, col, dateOnly, dateTime, showing, tableStyle, td, th } from "./marketplaceParts.jsx";
import { card, errorStyle, h3, money, useDebounced } from "./portfolioParts.jsx";

// Super Admin > Orders & deliveries (screen 20). Only what an order records:
// its items and businesses, the (simulated) payment status, the delivery status
// and the rider who was assigned, with the times the courier recorded.
// Delivery fees, rider pay, cash on delivery and check-in codes are not
// recorded on orders yet, so there is no column or tile for them.

const PAYMENT = { pending: ["Not paid", D.textFaint], paid: ["Paid", D.green], cancelled: ["Cancelled", D.red] };
const DELIVERY = { processing: "Preparing", shipped: "Shipped", out_for_delivery: "On the way", delivered: "Delivered" };
const METHOD = { door_to_door: "Delivery", store_pickup: "Store pickup" };

function OrderSide({ id, onClose }) {
  const { data: o, isLoading, isError } = useSaOrder(id);
  return (
    <section aria-label={`Order ${id}`} style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <h3 style={h3}>{`Order #${id}`}</h3>
        <button type="button" onClick={onClose} style={button(D.panelBg, D.text)}>Close</button>
      </div>
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Could not load this order.</div>}
      {o && (
        <>
          <div style={dim}>{[`to ${o.customer}`, METHOD[o.delivery_method], o.delivery_address].filter(Boolean).join(" · ")}</div>
          <h3 style={h3}>Items</h3>
          {o.lines.map((l, i) => <div key={i} style={{ fontSize: "0.8rem", color: D.text }}>{`${l.quantity} × ${l.name} · ${l.business} · ${money(l.line_total)}`}</div>)}
          <h3 style={h3}>What the records show</h3>
          {o.steps.map((s, i) => <div key={i} style={{ fontSize: "0.8rem", color: D.text }}><span style={dim}>{dateTime(s.at)}</span>{` · ${s.text}`}</div>)}
          {o.delivery_method === "door_to_door" && !o.rider && o.status === "paid" && <div style={dim}>No rider has been assigned yet.</div>}
          {o.notes && <div style={dim}>{`Courier's note: ${o.notes}`}</div>}
        </>
      )}
    </section>
  );
}

export default function SaOrdersPanel() {
  const [filters, setFilters] = useState({ payment: "", delivery: "", case: "", rider: "", day: "", from: "", to: "" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [exportError, setExportError] = useState(null);
  const q = useDebounced(search.trim());
  const params = { ...filters, q };
  const list = useSaOrders({ ...params, page });
  const { data: counts } = useSaOrderCounts();
  const rows = list.data?.results || [];
  const change = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };

  const filterDefs = [
    { key: "payment", label: "Payment", options: [["", "Any"], ["pending", "Not paid"], ["paid", "Paid"], ["cancelled", "Cancelled"]] },
    { key: "delivery", label: "Delivery", options: [["", "Any"], ["waiting_for_rider", "Waiting for a rider"], ["processing", "Preparing"], ["shipped", "Shipped"], ["out_for_delivery", "On the way"], ["delivered", "Delivered"]] },
    { key: "case", label: "Open case", options: [["", "Any"], ["1", "Has an open case"]] },
    { key: "rider", label: "Rider", options: [["", "Any rider"], ...(counts?.riders || []).map((r) => [String(r.id), r.name])] },
    { key: "day", label: "Day", options: [["", "Any day"], ["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["range", "Pick dates"]] },
  ];
  const tiles = counts ? [
    { label: "Orders today", value: counts.orders_today, sub: `${money(counts.items_value_today)} in items` },
    { label: "In flight", value: counts.in_flight, sub: `${counts.waiting_for_rider} waiting for a rider`, tone: counts.waiting_for_rider ? D.amber : undefined },
    { label: "Delivered today", value: counts.delivered_today, sub: "From the couriers' recorded times" },
    { label: "With an open case", value: counts.with_open_case, sub: "Disputes", tone: counts.with_open_case ? D.amber : undefined },
  ] : [];

  return (
    <div style={col}>
      <ScreenHeader title="Orders & deliveries" note="Every order and where its delivery stands.">
        <ExportButton path="/api/marketplace/orders/export/" params={params} filename="orders.csv" label="Export (CSV)" onError={setExportError} />
      </ScreenHeader>
      <SimulatedBanner>“Paid” means the order went through the simulated checkout. Delivery fees, rider pay and cash on delivery are not recorded on orders yet, so they are not shown.</SimulatedBanner>
      {exportError && <div role="alert" style={callout(D.red)}>{exportError}</div>}
      <KpiStrip tiles={tiles} label="Orders summary" />
      <div style={card}>
        <h3 style={h3}>All orders</h3>
        <FilterBar filters={filterDefs} values={filters} onChange={change} search={search} onSearch={(v) => { setSearch(v); setPage(1); }} searchLabel="Order, customer or business" />
        {filters.day === "range" && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label style={{ fontSize: "0.72rem", fontWeight: 700, color: D.text }}>From <input type="date" value={filters.from} onChange={(e) => change("from", e.target.value)} /></label>
            <label style={{ fontSize: "0.72rem", fontWeight: 700, color: D.text }}>To <input type="date" value={filters.to} onChange={(e) => change("to", e.target.value)} /></label>
          </div>
        )}
      </div>
      {openId != null && <OrderSide id={openId} onClose={() => setOpenId(null)} />}
      <div style={card}>
        <LoadState query={list} what="the orders" />
        {!list.isLoading && !list.isError && rows.length === 0 && <div style={dim}>No order matches these filters.</div>}
        {rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Orders" style={{ ...tableStyle, minWidth: 900 }}>
              <thead><tr><th style={th}>Order</th><th style={th}>Items</th><th style={th}>Payment</th><th style={th}>Delivery</th><th style={th}>Rider</th><th style={th}>Placed</th><th style={th} /></tr></thead>
              <tbody>
                {rows.map((o) => {
                  const [pay, payColor] = PAYMENT[o.status] || [o.status, D.textFaint];
                  return (
                    <tr key={o.id}>
                      <td style={td}><div style={{ fontWeight: 800 }}>{`#${o.id} · ${o.businesses.join(", ")}`}</div><div style={dim}>{`to ${o.customer}`}</div></td>
                      <td style={td}>{o.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}<div style={dim}>{money(o.total)}</div></td>
                      <td style={td}><Chip color={payColor}>{pay}</Chip>{o.open_case && <div style={{ color: D.amber, fontWeight: 800, fontSize: "0.7rem" }}>Open case</div>}</td>
                      <td style={td}>{DELIVERY[o.delivery_status] || o.delivery_status}<div style={dim}>{METHOD[o.delivery_method]}</div>{o.waiting_for_rider && <Chip color={D.amber}>Waiting for a rider</Chip>}</td>
                      <td style={td}>{o.rider || "—"}</td>
                      <td style={td}>{dateOnly(o.placed_at)}</td>
                      <td style={td}><button type="button" aria-label={`Open order ${o.id}`} onClick={() => setOpenId(o.id)} style={button(D.panelBg, D.text)}>Open</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && <div style={dim}>{`${showing(list.data, rows)} · newest first.`}</div>}
      </div>
      <Pager data={list.data} page={page} setPage={setPage} />
    </div>
  );
}

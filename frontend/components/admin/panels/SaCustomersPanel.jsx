import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiPost } from "../../../apiClient.js";
import { useCustomer, useCustomerCounts, useCustomers } from "../../../hooks/useMarketplace.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";
import { button, callout, dim } from "./panelStyles.js";
import SuspendSheet from "./SuspendSheet.jsx";
import { Chip, ExportButton, FilterBar, KpiStrip, LoadState, Pager, ScreenHeader, col, dateOnly, dateTime, showing, tableStyle, td, th } from "./marketplaceParts.jsx";
import { card, errorStyle, h3, money, useDebounced } from "./portfolioParts.jsx";

// Super Admin > Customers (screen 18). Phones are masked; showing one in full
// asks for the password and is recorded. Suspend / lift needs a reason and the
// password. There is no marketing-SMS consent record, so there is no consent
// column, tile or filter (it arrives with the Marketing phase).

const FILTERS = [
  { key: "status", label: "Status", options: [["", "Any"], ["active", "Active"], ["suspended", "Suspended"]] },
  { key: "case", label: "Open case", options: [["", "Any"], ["open", "Has an open case"], ["none", "No open case"]] },
];
const ORDER_STATE = { pending: "Not paid", paid: "Paid", cancelled: "Cancelled" };

function CustomerSide({ id, onClose }) {
  const { data: c, isLoading, isError } = useCustomer(id);
  return (
    <section aria-label="Customer" style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <h3 style={h3}>{c ? c.name : "Customer"}</h3>
        <button type="button" onClick={onClose} style={button(D.panelBg, D.text)}>Close</button>
      </div>
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div role="alert" style={errorStyle}>Could not load this customer.</div>}
      {c && (
        <>
          <div style={dim}>{[c.email, `joined ${dateOnly(c.joined_at)}`, `${c.orders} paid ${c.orders === 1 ? "order" : "orders"}, ${money(c.spend)}`].filter(Boolean).join(" · ")}</div>
          <h3 style={h3}>Recent orders</h3>
          {c.orders_recent.length === 0 && <div style={dim}>No orders yet.</div>}
          {c.orders_recent.map((o) => <div key={o.id} style={{ fontSize: "0.8rem", color: D.text }}>{`#${o.id} · ${(o.businesses || []).join(", ")} · ${money(o.total)} · ${ORDER_STATE[o.status] || o.status} · ${dateOnly(o.placed_at)}`}</div>)}
          <h3 style={h3}>Disputes</h3>
          {c.disputes_recent.length === 0 && <div style={dim}>None.</div>}
          {c.disputes_recent.map((d) => <div key={d.id} style={{ fontSize: "0.8rem", color: D.text }}>{`#${d.id} · order #${d.order || "—"} · ${d.reason} · ${d.status} · ${dateTime(d.created_at)}`}</div>)}
        </>
      )}
    </section>
  );
}

export default function SaCustomersPanel({ auth }) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState({ status: "", case: "" });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [suspending, setSuspending] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [revealed, setRevealed] = useState({}); // id -> full phone, for this session only
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const q = useDebounced(search.trim());
  const params = { ...filters, q };
  const list = useCustomers({ ...params, page });
  const { data: counts } = useCustomerCounts();
  const rows = list.data?.results || [];
  const canManage = Boolean(auth?.hasPermission?.("users.manage"));

  const change = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["sa-customers"] });
  const reveal = async (id) => {
    setActionError(null);
    try {
      const { phone } = await apiPost(`/api/marketplace/customers/${id}/reveal-phone/`, {});
      setRevealed((r) => ({ ...r, [id]: phone || "No phone on file" }));
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not show the phone number."));
    }
  };

  const tiles = counts ? [
    { label: "Customers", value: counts.total.toLocaleString("en-GH"), sub: `${counts.joined_this_month} joined this month` },
    { label: "Ordered in 90 days", value: counts.ordered_90_days.toLocaleString("en-GH"), sub: counts.total ? `${Math.round((counts.ordered_90_days / counts.total) * 100)}% of customers` : "" },
    { label: "With an open case", value: counts.with_open_case, sub: "Disputes", tone: D.amber },
    { label: "Suspended", value: counts.suspended, sub: "Told why in the app" },
  ] : [];

  return (
    <div style={col}>
      <ScreenHeader title="Customers" note="Everyone who has an account to buy, book and review.">
        {canManage && <ExportButton path="/api/marketplace/customers/export/" params={params} filename="customers.csv" label="Export (CSV) · asks for your password" onError={setActionError} />}
      </ScreenHeader>
      <KpiStrip tiles={tiles} label="Customers summary" />
      <div style={card}>
        <h3 style={h3}>All customers</h3>
        <FilterBar filters={FILTERS} values={filters} onChange={change} search={search} onSearch={(v) => { setSearch(v); setPage(1); }} searchLabel="Name, phone or order number" />
      </div>
      {notice && <div role="status" style={callout(D.green)}>{notice}</div>}
      {actionError && <div role="alert" style={errorStyle}>{actionError}</div>}
      {suspending && (
        <SuspendSheet kind="customer" id={suspending.id} name={suspending.name} suspended={suspending.is_suspended}
          onCancel={() => setSuspending(null)} onDone={(message) => { setSuspending(null); setNotice(message); refresh(); }} />
      )}
      {openId != null && <CustomerSide id={openId} onClose={() => setOpenId(null)} />}
      <div style={card}>
        <LoadState query={list} what="the customers" />
        {!list.isLoading && !list.isError && rows.length === 0 && <div style={dim}>No customer matches these filters.</div>}
        {rows.length > 0 && (
          <div style={{ overflowX: "auto" }}>
            <table aria-label="Customers" style={{ ...tableStyle, minWidth: 860 }}>
              <thead><tr><th style={th}>Customer</th><th style={th}>Phone</th><th style={th}>Orders</th><th style={th}>Disputes</th><th style={th}>Last order</th><th style={th}>Status</th><th style={th}>Actions</th></tr></thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td style={td}><div style={{ fontWeight: 800 }}>{c.name}</div><div style={dim}>{`since ${dateOnly(c.joined_at)}`}</div></td>
                    <td style={td}>
                      {revealed[c.id] ? revealed[c.id] : (c.phone || "No phone")}
                      {c.phone && !revealed[c.id] && <button type="button" aria-label={`Show full phone of ${c.name}`} onClick={() => reveal(c.id)} style={{ ...button(D.panelBg, D.text), marginLeft: 6, padding: "2px 8px" }}>Show</button>}
                    </td>
                    <td style={td}>{c.orders}<div style={dim}>{money(c.spend)}</div></td>
                    <td style={td}>{c.disputes}{c.open_disputes > 0 && <div style={{ color: D.amber, fontWeight: 800, fontSize: "0.7rem" }}>{`${c.open_disputes} open`}</div>}</td>
                    <td style={td}>{c.last_order_at ? dateOnly(c.last_order_at) : "No orders yet"}</td>
                    <td style={td}>{c.is_suspended ? <><Chip color={D.red}>Suspended</Chip><div style={dim}>{c.suspension_reason}</div></> : <Chip color={D.green}>Active</Chip>}</td>
                    <td style={td}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" aria-label={`Open ${c.name}`} onClick={() => setOpenId(c.id)} style={button(D.panelBg, D.text)}>Open</button>
                        {canManage && <button type="button" aria-label={`${c.is_suspended ? "Lift suspension of" : "Suspend"} ${c.name}`} onClick={() => { setNotice(null); setSuspending(c); }} style={button(c.is_suspended ? D.gold : D.panelBg, c.is_suspended ? D.text : D.red)}>{c.is_suspended ? "Lift suspension" : "Suspend"}</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={dim}>{`${rows.length ? `${showing(list.data, rows)} · sorted by name. ` : ""}Phone numbers are masked; showing one in full asks for your password and is recorded in the audit log. Whether a customer agreed to marketing texts is not recorded yet, so it is not shown.`}</div>
      </div>
      <Pager data={list.data} page={page} setPage={setPage} />
    </div>
  );
}

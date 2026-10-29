import { useState } from "react";
import { D } from "../dashboard/theme.js";
import { ORDER_TABS } from "./accountNav.js";
import TabBar from "./TabBar.jsx";

// Your Orders: Orders · Bookings · Service requests · Tickets · My events. Every tab body is
// App-owned and arrives in `render` (components/** never import App.jsx); the Orders tab
// carries its own filter and "Search all orders" box, so only Tickets keeps a search here.
export default function YourOrders({ render }) {
  const [tab, setTab] = useState("orders");
  const [query, setQuery] = useState("");
  const pick = (id) => { setTab(id); setQuery(""); };
  return (
    <div>
      <TabBar label="Your Orders" tabs={ORDER_TABS} current={tab} onPick={pick} />
      {tab === "tickets" && (
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tickets…" aria-label="Search tickets"
          style={{ width: "100%", maxWidth: 320, marginBottom: 14, background: D.panelBg2, border: `1px solid ${D.divider}`, borderRadius: 10, padding: "8px 12px", fontSize: "0.8rem", color: D.text, fontFamily: "inherit" }} />
      )}
      <div role="tabpanel">
        {tab === "orders" && render.orders?.()}
        {tab === "bookings" && render.bookings?.()}
        {tab === "requests" && render.requests?.()}
        {tab === "tickets" && render.tickets?.(query)}
        {tab === "events" && render.events?.()}
      </div>
    </div>
  );
}

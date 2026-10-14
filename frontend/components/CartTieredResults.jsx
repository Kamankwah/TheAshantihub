import { useState } from "react";
import { C } from "../theme.js";

// Search results for a customer whose cart already holds something (GET /api/listings/?cart_tiers=1, backend
// cart/guard.py). The server orders and labels every row; this only groups them: shops in the cart, shops near them
// (each labelled "1.2 km from Shop A"), services and stays (services and events are requested or booked separately, never tiered or limited),
// and everyone else behind an always-available "See other shops too". A shop the cart cannot take now stays visible
// with the server's reason.
const heading = { margin: "18px 0 8px", color: C.lightGold, fontSize: "0.82rem", fontWeight: 900 };
const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(215px,1fr))", gap: 14 };
const tag = { marginTop: 6, fontSize: "0.7rem", fontWeight: 700, color: C.lightGold };

function Row({ item, renderCard }) {
  const blocked = item.cart_blocked;
  return (
    <div>
      {renderCard(item)}
      {item.cart_label && <div style={tag}>{item.cart_label}</div>}
      {blocked && (
        <div role="note" style={{ ...tag, color: C.kente1 }}>
          {blocked.code === "not_deliverable" ? null : blocked.code === "food_far" || blocked.code === "food_unlocated" ? "Too far for this delivery" : "Delivery limit reached"}
          <div style={{ fontWeight: 400 }}>{blocked.detail}</div>
        </div>
      )}
    </div>
  );
}

function Group({ title, rows, renderCard }) {
  if (!rows.length) return null;
  return (
    <section aria-label={title}>
      <h3 style={heading}>{title}</h3>
      <div style={grid}>{rows.map((item) => <Row key={item.id} item={item} renderCard={renderCard} />)}</div>
    </section>
  );
}

export default function CartTieredResults({ listings, renderCard }) {
  const [showOthers, setShowOthers] = useState(false);
  const inCart = listings.filter((l) => l.cart_tier === 1);
  const near = listings.filter((l) => l.cart_tier === 2);
  const others = listings.filter((l) => l.cart_tier === 3);
  const separate = listings.filter((l) => l.cart_tier == null);
  return (
    <div>
      <Group title="From shops in your cart" rows={inCart} renderCard={renderCard} />
      <Group title="Near the shops in your cart" rows={near} renderCard={renderCard} />
      {!inCart.length && !near.length && <div style={{ color: "#aaa", fontSize: "0.8rem", margin: "12px 0" }}>Nothing in these results from the shops in your cart or shops near them.</div>}
      <Group title="Services, stays and events" rows={separate} renderCard={renderCard} />
      <button type="button" aria-expanded={showOthers} onClick={() => setShowOthers((v) => !v)}
        style={{ marginTop: 16, background: "none", border: `1px solid ${C.gold}`, color: C.lightGold, borderRadius: 20, padding: "7px 16px", fontWeight: 800, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}>
        {showOthers ? "Hide other shops" : `See other shops too${others.length ? ` (${others.length})` : ""}`}
      </button>
      {showOthers && (others.length === 0
        ? <div style={{ color: "#aaa", fontSize: "0.8rem", marginTop: 10 }}>No other shops in these results.</div>
        : <div style={{ ...grid, marginTop: 12 }}>{others.map((item) => <Row key={item.id} item={item} renderCard={renderCard} />)}</div>)}
      <div style={{ color: "#999", fontSize: "0.7rem", marginTop: 10 }}>One rider collects from every shop in your cart on one trip, so shops near each other come first.</div>
    </div>
  );
}

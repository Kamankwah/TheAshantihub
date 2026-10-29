import { useState } from "react";
import { C } from "../theme.js";
import EventCard from "./EventCard.jsx";
import { useSeller, useSellerListings, useSellerEvents } from "../hooks/useSeller.js";

// ─── SellerPage ─────────────────────────────────────────────────────────────
// The public page of one business: its name, when it joined, and what it has live now, in a tab per kind
// (Products, Services, Stays, Events — a tab only for a kind with something live). There is deliberately no
// contact action of any kind: businesses are reached through AshantiHub Support only (CLAUDE.md product rules).
//
// `CardComponent` is handed down by App.jsx (components/** never import App.jsx), like ListingDetailPage.
const KINDS = [
  { id: "products", label: "Products" },
  { id: "services", label: "Services" },
  { id: "stays", label: "Stays" },
  { id: "events", label: "Events" },
];

// The same split the server counts by (listings/views_sellers.py).
function kindOfListing(item) {
  if (item.category?.is_accommodation) return "stays";
  return item.category?.kind === "service" ? "services" : "products";
}

function joinedText(since) {
  const d = since ? new Date(since) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return `On AshantiHub since ${d.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`;
}

export default function SellerPage({ id, onBack, user, favourites = [], onFavourite, currency, onMessage, onOpenListing, onOpenEvent, CardComponent }) {
  const { data: seller, isLoading, isError } = useSeller(id);
  const counts = seller?.counts || {};
  const hasListings = (counts.products || 0) + (counts.services || 0) + (counts.stays || 0) > 0;
  const { data: listings, isLoading: listingsLoading } = useSellerListings(id, !!seller && hasListings);
  const { data: events, isLoading: eventsLoading } = useSellerEvents(id, !!seller && (counts.events || 0) > 0);
  const [picked, setPicked] = useState(null);

  const shell = { maxWidth: 1280, margin: "0 auto", padding: "16px 14px 40px", background: C.void, borderRadius: 20, color: "white" };
  const back = <button onClick={onBack} style={backBtnStyle}>‹ Back</button>;

  if (isLoading) return <div style={shell}>Loading…</div>;
  if (isError || !seller) {
    return (
      <div style={{ ...shell, textAlign: "center", padding: "40px 14px" }}>
        <div style={{ marginBottom: 12 }}>This seller isn't available.</div>
        {back}
      </div>
    );
  }

  const tabs = KINDS.filter((k) => (counts[k.id] || 0) > 0);
  const active = tabs.find((t) => t.id === picked) || tabs[0] || null;
  const joined = joinedText(seller.since);
  const rows = active && active.id !== "events" ? (listings || []).filter((l) => kindOfListing(l) === active.id) : [];
  const loadingRows = active && (active.id === "events" ? eventsLoading : listingsLoading);

  return (
    <div style={shell}>
      {back}
      <h1 style={{ color: C.gold, fontSize: "1.5rem", fontWeight: 900, margin: "16px 0 4px" }}>{seller.name}</h1>
      {joined && <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.8rem" }}>{joined}</div>}

      {!active ? (
        <p style={{ marginTop: 24, color: "rgba(255,255,255,0.7)" }}>No live listings right now.</p>
      ) : (
        <>
          <div role="tablist" aria-label="What this seller has" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "20px 0 16px" }}>
            {tabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={t.id === active.id}
                onClick={() => setPicked(t.id)}
                style={{
                  background: t.id === active.id ? C.gold : "rgba(255,255,255,0.08)",
                  color: t.id === active.id ? C.darkBrown : "white",
                  border: "none", borderRadius: 20, padding: "9px 16px", minHeight: 44, fontWeight: 800,
                  fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {t.label} ({counts[t.id]})
              </button>
            ))}
          </div>
          {loadingRows ? (
            <div style={{ color: "rgba(255,255,255,0.7)" }}>Loading…</div>
          ) : (
            <div role="tabpanel" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 14 }}>
              {active.id === "events"
                ? (events || []).map((e) => <EventCard key={e.id} item={e} onOpen={onOpenEvent} />)
                : rows.map((r) => (
                    <CardComponent
                      key={r.id}
                      item={r}
                      accentColor={r.category?.color || C.gold}
                      user={user}
                      favourites={favourites}
                      onFavourite={onFavourite}
                      currency={currency}
                      onMessage={onMessage}
                      onOpen={onOpenListing}
                    />
                  ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const backBtnStyle = { background: "rgba(255,255,255,0.1)", color: "white", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 20, padding: "8px 16px", minHeight: 44, cursor: "pointer", fontFamily: "inherit", fontWeight: 700, fontSize: "0.8rem" };

import { useState } from "react";
import { C } from "../theme.js";
import { useListing } from "../hooks/useListing.js";
import { useRelatedListings } from "../hooks/useRelatedListings.js";

// ─── ListingDetailPage ──────────────────────────────────────────────────────
// Product/service detail page (PDP) for the Business tab redesign
// (docs/BUSINESS_EVENTS_ROADMAP.md Phase 3). Follows this app's no-router
// convention: AshantiHub holds a `selectedListingId` state and swaps this in
// for the Sidebar+grid area (rather than a top-level early return like
// StaffDashboard/BusinessDashboard) so the surrounding hero/banner/search/
// category tabs/CTA stay mounted around it.
//
// `useListing(id)` — previously only consumed by the favourites drawer's
// FavDrawerItem — is promoted to this page's primary data source, per the
// roadmap brief.
//
// Real backend-contract gap: the real `Listing` model
// (backend/listings/models.py) has no `specs`/`terms` JSON field — only
// name/description/price_amount/price_unit/tag/contact_phone/lat/lng/
// main_photo/photos. So there is no "specs"/"terms" block rendered here;
// inventing one would mean showing fake data. If a future phase adds a real
// `specs` field to `Listing`, render it here rather than reintroducing mock
// data.
//
// "Add to Cart" (docs/BUSINESS_EVENTS_ROADMAP.md Phase 4) calls the
// `onAddToCart` prop — same "AshantiHub owns the mutation (auth-gating +
// apiPost + cart refetch), this component just calls the callback and owns
// its own local adding/added/error UI state" convention as onWhatsApp/
// onMessage above. Disabled when the listing has no price (the backend
// rejects POST /api/cart/items/ for a listing with no price_amount — see
// apiClient/App.jsx's handleAddToCart) or while a request is in flight.
//
// `CardComponent` is passed in as a prop (rather than imported directly from
// App.jsx) so this component under frontend/components/ doesn't create an
// App.jsx <-> components/ circular import — App.jsx already owns Card and
// simply hands it down, same as it hands down every other callback/prop.
export default function ListingDetailPage({
  id,
  onBack,
  onWhatsApp,
  user,
  favourites,
  onFavourite,
  currency,
  onMessage,
  onOpenListing,
  onAddToCart,
  CardComponent,
}) {
  const { data: item, isLoading, isError, refetch } = useListing(id);
  const { data: related } = useRelatedListings(id);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [addingToCart, setAddingToCart] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);
  const [cartError, setCartError] = useState(null);

  if (isLoading) {
    return (
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 14px", color: C.lightGold, background: C.void, borderRadius: 20 }}>
        Loading…
      </div>
    );
  }

  if (isError || !item) {
    return (
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 14px", textAlign: "center", background: C.void, borderRadius: 20 }}>
        <div style={{ color: "white", marginBottom: 12 }}>Could not load this listing.</div>
        <button onClick={() => refetch()} style={backBtnStyle}>Retry</button>{" "}
        <button onClick={onBack} style={backBtnStyle}>‹ Back to results</button>
      </div>
    );
  }

  const accentColor = item.category?.color || C.gold;
  const gallery = item.photos?.length > 0 ? item.photos.map((p) => p.image) : item.main_photo ? [item.main_photo] : [];
  const isFav = favourites?.includes(item.id);

  const displayPrice = () => {
    if (item.price_amount == null) return null;
    return `GHS ${item.price_amount}${item.price_unit || ""}`;
  };

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "16px 14px 40px", background: C.void, borderRadius: 20 }}>
      <button onClick={onBack} style={backBtnStyle}>‹ Back to results</button>

      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginTop: 16 }}>
        {/* Gallery */}
        <div style={{ flex: "1 1 380px", minWidth: 300 }}>
          <div style={{ height: 340, borderRadius: 16, overflow: "hidden", position: "relative", background: `linear-gradient(135deg,${accentColor}22,${accentColor}44)` }}>
            {gallery.length > 0 ? (
              <img src={gallery[galleryIndex]} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "3.5rem" }}>
                {item.category?.icon}
              </div>
            )}
          </div>
          {gallery.length > 1 && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {gallery.map((src, i) => (
                <button
                  key={src + i}
                  onClick={() => setGalleryIndex(i)}
                  aria-label={`View photo ${i + 1}`}
                  style={{
                    padding: 0,
                    width: 60,
                    height: 60,
                    borderRadius: 10,
                    overflow: "hidden",
                    border: i === galleryIndex ? `2px solid ${C.gold}` : "2px solid transparent",
                    cursor: "pointer",
                    background: "none",
                  }}
                >
                  <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div style={{ flex: "1 1 320px", minWidth: 280 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <h1 style={{ color: "white", fontSize: "1.4rem", fontWeight: 900, margin: "0 0 4px" }}>{item.name}</h1>
            {onFavourite && (
              <button
                onClick={() => onFavourite(item.id)}
                aria-label={isFav ? "Remove from saved" : "Save this business"}
                style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.25)", borderRadius: "50%", width: 40, height: 40, cursor: "pointer", fontSize: "1rem", flexShrink: 0 }}
              >
                {isFav ? "❤️" : "🤍"}
              </button>
            )}
          </div>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.8rem", marginBottom: 10 }}>
            {item.category?.icon} {item.category?.label} · 📍 {item.zone?.name}
          </div>
          {item.tag && (
            <span style={{ display: "inline-block", background: accentColor, color: "white", fontSize: "0.65rem", fontWeight: 700, padding: "3px 10px", borderRadius: 20, marginBottom: 12 }}>
              {item.tag}
            </span>
          )}
          {displayPrice() && (
            <div style={{ color: accentColor, fontWeight: 900, fontSize: "1.15rem", marginBottom: 14 }}>{displayPrice()}</div>
          )}
          <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.88rem", lineHeight: 1.7, marginBottom: 20 }}>{item.description}</p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => onMessage && onMessage(item)}
              style={{ background: `${C.kente3}15`, color: C.kente3, border: `1px solid ${C.kente3}33`, borderRadius: 20, padding: "10px 16px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", minHeight: 44 }}
            >
              💬 Message
            </button>
            <button
              onClick={() => onWhatsApp && onWhatsApp({ phone: item.contact_phone, name: item.name })}
              style={{ background: C.whatsapp, color: "white", border: "none", borderRadius: 20, padding: "10px 16px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", minHeight: 44 }}
            >
              📱 WhatsApp
            </button>
          </div>

          {/* Add to Cart (docs/BUSINESS_EVENTS_ROADMAP.md Phase 4) — disabled
              when the listing has no price (nothing for the backend to
              charge) or while a request is in flight. onAddToCart throws on
              failure (unauthenticated, non-customer account, or a server
              error), caught here so the message shows next to the button
              rather than crashing the page. */}
          <button
            disabled={addingToCart || item.price_amount == null || !onAddToCart}
            title={item.price_amount == null ? "This listing has no price set" : undefined}
            onClick={async () => {
              if (!onAddToCart) return;
              setCartError(null);
              setAddingToCart(true);
              try {
                await onAddToCart(item, 1);
                setAddedToCart(true);
                setTimeout(() => setAddedToCart(false), 2000);
              } catch (err) {
                setCartError(err?.message || "Could not add this item to your cart.");
              } finally {
                setAddingToCart(false);
              }
            }}
            style={{
              marginTop: 16,
              width: "100%",
              minHeight: 44,
              background: item.price_amount == null ? "rgba(255,255,255,0.08)" : addedToCart ? C.kente2 : C.gold,
              color: item.price_amount == null ? "rgba(255,255,255,0.45)" : addedToCart ? "white" : C.darkBrown,
              border: item.price_amount == null ? "1px solid rgba(255,255,255,0.15)" : "none",
              borderRadius: 20,
              fontSize: "0.82rem",
              fontWeight: 900,
              cursor: item.price_amount == null ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            {addingToCart ? "Adding…" : addedToCart ? "Added to Cart ✓" : item.price_amount == null ? "No Price Set" : "Add to Cart"}
          </button>
          {cartError && (
            <div style={{ marginTop: 8, color: "#ffb4b4", fontSize: "0.72rem" }}>{cartError}</div>
          )}
        </div>
      </div>

      {/* Related */}
      {Array.isArray(related) && related.length > 0 && CardComponent && (
        <div style={{ marginTop: 40 }}>
          <h2 style={{ color: C.gold, fontSize: "0.95rem", fontWeight: 900, margin: "0 0 14px" }}>Related</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 14 }}>
            {related.map((r) => (
              <CardComponent
                key={r.id}
                item={r}
                accentColor={r.category?.color || accentColor}
                onWhatsApp={onWhatsApp}
                user={user}
                favourites={favourites}
                onFavourite={onFavourite}
                currency={currency}
                onMessage={onMessage}
                onOpen={onOpenListing}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const backBtnStyle = {
  background: "rgba(255,255,255,0.1)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.25)",
  borderRadius: 20,
  padding: "9px 16px",
  fontSize: "0.78rem",
  fontWeight: 700,
  cursor: "pointer",
  minHeight: 44,
  fontFamily: "inherit",
};

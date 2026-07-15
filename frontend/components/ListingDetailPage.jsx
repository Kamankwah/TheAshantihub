import { useState } from "react";
import { C } from "../theme.js";
import { apiPost } from "../apiClient.js";
import { useListing } from "../hooks/useListing.js";
import { useRelatedListings } from "../hooks/useRelatedListings.js";
import { useListingReviews } from "../hooks/useListingReviews.js";
import { useReviewEligibility } from "../hooks/useReviewEligibility.js";
import { useListingQuestions } from "../hooks/useListingQuestions.js";
import { useOwnerReviews } from "../hooks/useOwnerReviews.js";
import { useSiteSettings } from "../hooks/useSiteSettings.js";
import ScrollSpyTabs from "./ScrollSpyTabs.jsx";

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
// Reviews/ratings/Q&A/tabbed-PDP Phase 5: below the persistent gallery +
// buy-box header, this page renders a seller-rating badge (about the
// business owner, not the listing) and a `ScrollSpyTabs` shell whose tab
// set branches on `item.category?.kind` — Overview/Specs/Reviews/Q&As/
// Compare Products/Warranty & Returns/More buying options for a product,
// the service-flavored equivalents for a service. `item.specs`/
// `service_duration`/`avg_rating`/`review_count`/`business_owner` are real
// fields on `GET /api/listings/{id}/` as of Phase 2 of that work — there is
// no more "no specs field on the real Listing model" gap.
//
// Businesses can no longer be contacted directly (fraud-prevention —
// docs/UI_MODERNIZATION_ROADMAP.md Phase F): there is no WhatsApp button
// here any more, and "Message" opens MessagingCenter framed as an
// AshantiHub Support conversation about this listing rather than a direct
// line to the business owner.
//
// "Add to Cart" (docs/BUSINESS_EVENTS_ROADMAP.md Phase 4) calls the
// `onAddToCart` prop — same "AshantiHub owns the mutation (auth-gating +
// apiPost + cart refetch), this component just calls the callback and owns
// its own local adding/added/error UI state" convention as onMessage above.
// Disabled when the listing has no price (the backend
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
  const isService = item.category?.kind === "service";
  const tabs = isService ? SERVICE_TABS : PRODUCT_TABS;

  const displayPrice = () => {
    if (item.price_amount == null) return null;
    return `GHS ${item.price_amount}${item.price_unit || ""}`;
  };

  const renderSection = (tabId) => {
    switch (tabId) {
      case "overview":
        return <OverviewSection description={item.description} />;
      case "specs":
        return <SpecsSection specs={item.specs} />;
      case "duration":
        return <DurationSection duration={item.service_duration} />;
      case "reviews":
        return <ReviewsSection listingId={id} item={item} user={user} />;
      case "qanda":
        return <QASection id={id} item={item} user={user} />;
      case "compare":
        return <CompareSection related={related} label={isService ? "Compare Services" : "Compare Products"} />;
      case "more-buying":
        return <MoreOptionsSection related={related} onOpenListing={onOpenListing} label="More buying options" />;
      case "more-service":
        return <MoreOptionsSection related={related} onOpenListing={onOpenListing} label="More Service options" />;
      case "warranty":
        return <PolicySection label="Warranty & Returns" fieldKey="warranty_returns_policy" />;
      case "dispute":
        return <PolicySection label="Service satisfaction & dispute" fieldKey="service_dispute_policy" />;
      default:
        return null;
    }
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

        {/* Details (persistent buy-box) */}
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

          {/* Businesses can no longer be contacted directly (fraud-prevention —
              docs/UI_MODERNIZATION_ROADMAP.md Phase F). This opens
              MessagingCenter framed as an AshantiHub Support conversation
              about this listing, not a direct line to the business. */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={() => onMessage && onMessage(item)}
              style={{ background: `${C.kente3}15`, color: C.kente3, border: `1px solid ${C.kente3}33`, borderRadius: 20, padding: "10px 16px", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer", minHeight: 44 }}
            >
              🎧 Contact Support
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

      {/* Seller-rating badge — about the business owner, not the listing, so
          it sits outside the tab shell rather than inside a "Seller" tab. */}
      <SellerRatingBadge businessOwner={item.business_owner} user={user} />

      {/* Tabbed content */}
      <ScrollSpyTabs tabs={tabs} renderSection={renderSection} />

      {/* Related. data-testid disambiguates this rail from the Compare/More-
          options tabs below, which intentionally render the same
          useRelatedListings(id) data elsewhere on the page (same fetch,
          different views) — tests need a way to scope queries to just this
          rail when a related item's name also appears in those tabs. */}
      {Array.isArray(related) && related.length > 0 && CardComponent && (
        <div data-testid="related-rail" style={{ marginTop: 40 }}>
          <h2 style={{ color: C.gold, fontSize: "0.95rem", fontWeight: 900, margin: "0 0 14px" }}>Related</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 14 }}>
            {related.map((r) => (
              <CardComponent
                key={r.id}
                item={r}
                accentColor={r.category?.color || accentColor}
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

// ─── Tab sets ───────────────────────────────────────────────────────────────
const PRODUCT_TABS = [
  { id: "overview", label: "Overview" },
  { id: "specs", label: "Specs" },
  { id: "reviews", label: "Reviews" },
  { id: "qanda", label: "Q&As" },
  { id: "compare", label: "Compare Products" },
  { id: "warranty", label: "Warranty & Returns" },
  { id: "more-buying", label: "More buying options" },
];

const SERVICE_TABS = [
  { id: "overview", label: "Overview" },
  { id: "duration", label: "Service Duration" },
  { id: "reviews", label: "Reviews" },
  { id: "qanda", label: "Q&As" },
  { id: "compare", label: "Compare Services" },
  { id: "dispute", label: "Service satisfaction & dispute" },
  { id: "more-service", label: "More Service options" },
];

// ─── starString ─────────────────────────────────────────────────────────────
// This file can't import App.jsx's `Stars` component — the established
// convention is that frontend/components/* never imports from App.jsx (see
// CLAUDE.md's "avoid an App.jsx <-> components/ circular import" note). Same
// small local helper EventCard.jsx already wrote for the same reason.
function starString(rating) {
  const full = Math.floor(rating || 0);
  return "★".repeat(full) + "☆".repeat(Math.max(0, 5 - full));
}

// ─── OverviewSection ────────────────────────────────────────────────────────
function OverviewSection({ description }) {
  return (
    <div>
      <h2 style={sectionHeadingStyle}>Overview</h2>
      <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.88rem", lineHeight: 1.7 }}>{description}</p>
    </div>
  );
}

// ─── SpecsSection ───────────────────────────────────────────────────────────
function SpecsSection({ specs }) {
  const list = Array.isArray(specs) ? specs : [];
  return (
    <div>
      <h2 style={sectionHeadingStyle}>Specs</h2>
      {list.length === 0 ? (
        <EmptyNote text="No specs listed yet." />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: "6px 24px" }}>
          {list.map((spec, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "8px 0", fontSize: "0.8rem" }}>
              <span style={{ color: "rgba(255,255,255,0.55)" }}>{spec.label}</span>
              <span style={{ color: "white", fontWeight: 600, textAlign: "right" }}>{spec.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DurationSection ────────────────────────────────────────────────────────
function DurationSection({ duration }) {
  return (
    <div>
      <h2 style={sectionHeadingStyle}>Service Duration</h2>
      {duration ? (
        <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.88rem", lineHeight: 1.7 }}>{duration}</p>
      ) : (
        <EmptyNote text="Duration not specified" />
      )}
    </div>
  );
}

// ─── PolicySection ──────────────────────────────────────────────────────────
// Static platform-wide policy text (no per-item fulfillment/dispute system
// exists to source per-listing promises from) — sourced from
// `useSiteSettings()`'s two new fields. Self-contained (calls its own
// useSiteSettings()) same "own your own data source" convention as
// ListingDetailPage's siblings elsewhere in this codebase; React Query
// dedupes the two tab instances (warranty/dispute) sharing the same query
// key so this isn't a second network round trip.
function PolicySection({ label, fieldKey }) {
  const settingsQuery = useSiteSettings();
  const text = settingsQuery.data?.[fieldKey];
  return (
    <div>
      <h2 style={sectionHeadingStyle}>{label}</h2>
      {settingsQuery.isLoading ? (
        <EmptyNote text="Loading…" />
      ) : text ? (
        <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.88rem", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{text}</p>
      ) : (
        <EmptyNote text="No policy has been published yet." />
      )}
    </div>
  );
}

// ─── ReviewsList ────────────────────────────────────────────────────────────
// Shared list-rendering for both the listing Reviews tab and the seller-
// rating badge's expanded seller-review list, so this page doesn't grow two
// separate review-list renderers.
function ReviewsList({ reviews, emptyLabel = "No reviews yet." }) {
  if (!reviews || reviews.length === 0) {
    return <EmptyNote text={emptyLabel} />;
  }
  return (
    <div>
      {reviews.map((r) => (
        <div key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", padding: "12px 0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: `${C.gold}22`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, color: C.gold, fontSize: "0.75rem", flexShrink: 0 }}>
                {r.author_name?.[0]?.toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.78rem", color: "white" }}>{r.author_name}</div>
                <span style={{ color: C.gold, fontSize: "0.75rem" }}>{starString(r.rating)}</span>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.62rem", color: "rgba(255,255,255,0.5)" }}>
              {r.created_at?.slice(0, 10)}
              {r.verified && (
                <span style={{ background: "#22c55e22", color: "#22c55e", borderRadius: 20, padding: "2px 7px", fontWeight: 700 }}>✓ Verified</span>
              )}
            </div>
          </div>
          {r.comment && <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.78)", lineHeight: 1.6 }}>{r.comment}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── ReviewWriteForm ────────────────────────────────────────────────────────
// The exact "eligibility-gated write form across 4 states" pattern App.jsx's
// ReviewsModal already implements (not signed in / checking / eligible /
// already-reviewed-or-ineligible), laid out inline in a tab section instead
// of inside a modal shell. Reused for both the listing Reviews tab
// (targetType "listing") and the seller-rating badge's write flow
// (targetType "seller") — same POST /api/reviews/ endpoint, disambiguated
// by target_type/target_id, same as ReviewsModal's own submit call.
function ReviewWriteForm({ targetType, targetId, user, onReviewSubmitted, label = "Write a Review" }) {
  const [newRating, setNewRating] = useState(0);
  const [newText, setNewText] = useState("");
  const [hover, setHover] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [actionError, setActionError] = useState(null);
  const eligibility = useReviewEligibility(user ? { targetType, targetId } : {});

  const handleSubmit = async () => {
    if (!user || !newRating || !newText.trim()) return;
    setActionError(null);
    try {
      await apiPost("/api/reviews/", { target_type: targetType, target_id: targetId, rating: newRating, comment: newText });
      setSubmitted(true);
      eligibility.refetch();
      onReviewSubmitted && onReviewSubmitted();
    } catch (err) {
      setActionError("Could not submit your review. Please try again.");
    }
  };

  if (submitted) {
    return (
      <div style={{ background: "rgba(34,197,94,0.1)", border: "1.5px solid rgba(34,197,94,0.35)", borderRadius: 14, padding: 16, textAlign: "center" }}>
        <div style={{ fontSize: "1.6rem", marginBottom: 6 }}>🎉</div>
        <div style={{ fontWeight: 800, color: "#4ade80" }}>Review submitted! Thank you.</div>
      </div>
    );
  }

  return (
    <div style={{ background: `${C.gold}12`, border: `1.5px solid ${C.gold}33`, borderRadius: 14, padding: 16 }}>
      <div style={{ fontWeight: 800, color: C.gold, marginBottom: 10, fontSize: "0.82rem" }}>✍️ {label}</div>
      {!user ? (
        <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.55)", textAlign: "center" }}>Sign in to leave a review</div>
      ) : eligibility.isLoading ? (
        <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.55)", textAlign: "center" }}>Checking your eligibility…</div>
      ) : eligibility.data?.eligible ? (
        <>
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <span
                key={s}
                onClick={() => setNewRating(s)}
                onMouseEnter={() => setHover(s)}
                onMouseLeave={() => setHover(0)}
                style={{ fontSize: "1.6rem", cursor: "pointer", color: (hover || newRating) >= s ? C.gold : "rgba(255,255,255,0.25)" }}
              >
                ★
              </span>
            ))}
          </div>
          <textarea value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="Share your experience..." style={textareaStyle} />
          {actionError && <div style={{ color: "#ffb4b4", fontSize: "0.72rem", marginBottom: 8 }}>{actionError}</div>}
          <button onClick={handleSubmit} disabled={!newRating || newText.trim().length < 10} style={submitBtnStyle(!!newRating && newText.trim().length >= 10)}>
            Submit Review
          </button>
        </>
      ) : eligibility.data?.already_reviewed ? (
        <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.55)", textAlign: "center" }}>You've already reviewed this.</div>
      ) : (
        <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.55)", textAlign: "center" }}>You can review this after a completed purchase.</div>
      )}
    </div>
  );
}

// ─── ReviewsSection ─────────────────────────────────────────────────────────
function ReviewsSection({ listingId, item, user }) {
  const reviewsQuery = useListingReviews(listingId);
  const reviews = reviewsQuery.data?.results || [];
  const avgRating = reviewsQuery.data?.avg_rating ?? item.avg_rating;
  const reviewCount = reviewsQuery.data?.review_count ?? item.review_count ?? 0;

  return (
    <div>
      <h2 style={sectionHeadingStyle}>Reviews</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
        {reviewCount > 0 ? (
          <>
            <span style={{ color: C.gold, fontSize: "1.1rem" }}>{starString(avgRating)}</span>
            <span style={{ color: "white", fontWeight: 800 }}>{avgRating}</span>
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.8rem" }}>({reviewCount} reviews)</span>
          </>
        ) : (
          <span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.8rem" }}>No reviews yet.</span>
        )}
      </div>
      <div style={{ marginBottom: 22 }}>
        <ReviewWriteForm targetType="listing" targetId={listingId} user={user} onReviewSubmitted={() => reviewsQuery.refetch()} />
      </div>
      {reviewsQuery.isLoading ? (
        <EmptyNote text="Loading reviews…" />
      ) : (
        <ReviewsList reviews={reviews} />
      )}
    </div>
  );
}

// ─── SellerRatingBadge ──────────────────────────────────────────────────────
// About the seller, not the listing — reads useOwnerReviews(business_owner
// id) for the seller's own rating (an Airbnb-host-style rating, not an
// aggregate of their listings' reviews). Hides the rating portion entirely
// when review_count is 0, same "no fabricated 0.0" rule Card/EventCard use.
// Expandable to the seller's review list + a "write a seller review"
// affordance, reusing the same ReviewsList/ReviewWriteForm this file's
// Reviews tab uses (targeting "seller" instead of "listing").
function SellerRatingBadge({ businessOwner, user }) {
  const [expanded, setExpanded] = useState(false);
  const ownerReviewsQuery = useOwnerReviews(businessOwner?.id);

  if (!businessOwner) return null;

  const avgRating = ownerReviewsQuery.data?.avg_rating ?? 0;
  const reviewCount = ownerReviewsQuery.data?.review_count ?? 0;
  const reviews = ownerReviewsQuery.data?.results || [];

  return (
    <div style={{ marginTop: 24, borderTop: "1px solid rgba(255,255,255,0.1)", borderBottom: "1px solid rgba(255,255,255,0.1)", padding: "14px 2px" }}>
      <button
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={{ background: "none", border: "none", color: "white", fontSize: "0.82rem", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 8, fontFamily: "inherit" }}
      >
        {reviewCount > 0 ? (
          <span>⭐ {avgRating} · Sold by {businessOwner.full_name} · {reviewCount} seller review{reviewCount === 1 ? "" : "s"}</span>
        ) : (
          <span>Sold by {businessOwner.full_name}</span>
        )}
        <span style={{ color: C.gold }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div style={{ marginTop: 14 }}>
          <div style={{ marginBottom: 16 }}>
            <ReviewWriteForm
              targetType="seller"
              targetId={businessOwner.id}
              user={user}
              onReviewSubmitted={() => ownerReviewsQuery.refetch()}
              label="Write a Seller Review"
            />
          </div>
          {ownerReviewsQuery.isLoading ? (
            <EmptyNote text="Loading seller reviews…" />
          ) : (
            <ReviewsList reviews={reviews} emptyLabel="No seller reviews yet." />
          )}
        </div>
      )}
    </div>
  );
}

// ─── QASection ──────────────────────────────────────────────────────────────
// List (question + its answer, or "Not yet answered") + an ask-a-question
// form for any signed-in customer + — only when the signed-in user is this
// listing's own business owner (a business owner can genuinely be browsing
// the Business tab like anyone else) — an inline "Answer" action per
// unanswered question, via QuestionRow below.
function QASection({ id, item, user }) {
  const questionsQuery = useListingQuestions(id);
  const questions = questionsQuery.data?.results || [];
  const [questionText, setQuestionText] = useState("");
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState(null);
  const isCustomer = user?.accountType === "customer";
  const isOwner = user != null && user.id === item.business_owner?.id;

  const handleAsk = async () => {
    if (!questionText.trim()) return;
    setAskError(null);
    setAsking(true);
    try {
      await apiPost("/api/qa/questions/", { target_type: "listing", target_id: id, question_text: questionText.trim() });
      setQuestionText("");
      questionsQuery.refetch();
    } catch (err) {
      setAskError("Could not submit your question. Please try again.");
    } finally {
      setAsking(false);
    }
  };

  return (
    <div>
      <h2 style={sectionHeadingStyle}>Q&As</h2>
      {isCustomer ? (
        <div style={{ marginBottom: 20 }}>
          <textarea
            value={questionText}
            onChange={(e) => setQuestionText(e.target.value)}
            placeholder="Ask a question about this listing…"
            style={textareaStyle}
          />
          {askError && <div style={{ color: "#ffb4b4", fontSize: "0.72rem", marginBottom: 8 }}>{askError}</div>}
          <button onClick={handleAsk} disabled={asking || !questionText.trim()} style={submitBtnStyle(!asking && !!questionText.trim())}>
            {asking ? "Submitting…" : "Ask a Question"}
          </button>
        </div>
      ) : !user ? (
        <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.78rem", marginBottom: 20 }}>Sign in as a customer to ask a question.</div>
      ) : null}
      {questionsQuery.isLoading ? (
        <EmptyNote text="Loading questions…" />
      ) : questions.length === 0 ? (
        <EmptyNote text="No questions yet. Be the first to ask!" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {questions.map((q) => (
            <QuestionRow key={q.id} question={q} isOwner={isOwner} onAnswered={() => questionsQuery.refetch()} />
          ))}
        </div>
      )}
    </div>
  );
}

function QuestionRow({ question, isOwner, onAnswered }) {
  const [answering, setAnswering] = useState(false);
  const [answerText, setAnswerText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [answerError, setAnswerError] = useState(null);

  const handleAnswer = async () => {
    if (!answerText.trim()) return;
    setAnswerError(null);
    setSubmitting(true);
    try {
      await apiPost(`/api/qa/questions/${question.id}/answer/`, { answer_text: answerText.trim() });
      setAnswering(false);
      setAnswerText("");
      onAnswered && onAnswered();
    } catch (err) {
      setAnswerError("Could not submit your answer. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: 14 }}>
      <div style={{ color: "white", fontWeight: 700, fontSize: "0.82rem", marginBottom: 6 }}>Q: {question.question_text}</div>
      {question.answer_text ? (
        <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.8rem", lineHeight: 1.6 }}>A: {question.answer_text}</div>
      ) : (
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.76rem", fontStyle: "italic" }}>Not yet answered</div>
      )}
      {isOwner && !question.answer_text && (
        answering ? (
          <div style={{ marginTop: 10 }}>
            <textarea value={answerText} onChange={(e) => setAnswerText(e.target.value)} placeholder="Write your answer…" style={{ ...textareaStyle, minHeight: 60 }} />
            {answerError && <div style={{ color: "#ffb4b4", fontSize: "0.7rem", marginBottom: 8 }}>{answerError}</div>}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleAnswer} disabled={submitting || !answerText.trim()} style={submitBtnStyle(!submitting && !!answerText.trim())}>
                {submitting ? "Submitting…" : "Submit Answer"}
              </button>
              <button onClick={() => { setAnswering(false); setAnswerText(""); }} style={cancelBtnStyle}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAnswering(true)} style={{ ...cancelBtnStyle, marginTop: 10 }}>Answer</button>
        )
      )}
    </div>
  );
}

// ─── CompareSection ─────────────────────────────────────────────────────────
// Reuses the already-fetched useRelatedListings(id) data — no new endpoint —
// a checkbox-driven "pick 2" UI (further checkboxes disable once 2 are
// selected) rendering a side-by-side comparison table for the two selected.
function CompareSection({ related, label }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const list = Array.isArray(related) ? related : [];

  const toggle = (itemId) => {
    setSelectedIds((prev) => {
      if (prev.includes(itemId)) return prev.filter((x) => x !== itemId);
      if (prev.length >= 2) return prev;
      return [...prev, itemId];
    });
  };

  const selected = list.filter((r) => selectedIds.includes(r.id));
  const rows = [
    ["Name", (r) => r.name],
    ["Price", (r) => (r.price_amount != null ? `GHS ${r.price_amount}${r.price_unit || ""}` : "—")],
    ["Rating", (r) => (r.review_count > 0 ? `${starString(r.avg_rating)} ${r.avg_rating} (${r.review_count})` : "No reviews")],
    ["Zone", (r) => r.zone?.name || "—"],
    ["Category", (r) => r.category?.label || "—"],
  ];

  return (
    <div>
      <h2 style={sectionHeadingStyle}>{label}</h2>
      {list.length === 0 ? (
        <EmptyNote text="No similar listings to compare yet." />
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
            {list.map((r) => (
              <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, color: "white", fontSize: "0.82rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(r.id)}
                  disabled={!selectedIds.includes(r.id) && selectedIds.length >= 2}
                  onChange={() => toggle(r.id)}
                />
                {r.name}
              </label>
            ))}
          </div>
          {selected.length < 2 ? (
            <EmptyNote text="Select two listings to compare." />
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", color: "white", fontSize: "0.8rem" }}>
                <tbody>
                  {rows.map(([rowLabel, get]) => (
                    <tr key={rowLabel} style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: C.gold, width: 110 }}>{rowLabel}</td>
                      {selected.map((r) => (
                        <td key={r.id} style={{ padding: "8px 10px" }}>{get(r)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── MoreOptionsSection ─────────────────────────────────────────────────────
// Same useRelatedListings(id) data as the Related rail and Compare tab, just
// a denser list-row treatment — one fetch, multiple views, no second
// endpoint invented for a "more buying options"/"more service options"
// concept that doesn't exist server-side (no multi-seller-per-item/variant
// model, per the plan's scope decision).
function MoreOptionsSection({ related, onOpenListing, label }) {
  const list = Array.isArray(related) ? related : [];
  return (
    <div>
      <h2 style={sectionHeadingStyle}>{label}</h2>
      {list.length === 0 ? (
        <EmptyNote text="No other options right now." />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "10px 14px" }}>
              <div>
                <div style={{ color: "white", fontWeight: 700, fontSize: "0.85rem" }}>{r.name}</div>
                <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.7rem" }}>{r.zone?.name}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {r.price_amount != null && <span style={{ color: C.gold, fontWeight: 800, fontSize: "0.82rem" }}>GHS {r.price_amount}{r.price_unit || ""}</span>}
                <button onClick={() => onOpenListing && onOpenListing(r.id)} style={viewBtnStyle}>View</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyNote({ text }) {
  return <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.8rem" }}>{text}</div>;
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

const sectionHeadingStyle = { color: C.gold, fontSize: "1rem", fontWeight: 900, margin: "0 0 16px" };

const textareaStyle = {
  width: "100%",
  minHeight: 80,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1.5px solid rgba(255,255,255,0.25)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  fontSize: "0.82rem",
  fontFamily: "inherit",
  resize: "vertical",
  outline: "none",
  boxSizing: "border-box",
  marginBottom: 10,
};

const submitBtnStyle = (active) => ({
  background: active ? C.gold : "rgba(255,255,255,0.12)",
  color: active ? C.darkBrown : "rgba(255,255,255,0.4)",
  border: "none",
  borderRadius: 20,
  padding: "9px 18px",
  fontWeight: 900,
  fontSize: "0.8rem",
  cursor: active ? "pointer" : "default",
  fontFamily: "inherit",
});

const cancelBtnStyle = {
  background: "rgba(255,255,255,0.08)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 20,
  padding: "9px 18px",
  fontWeight: 700,
  fontSize: "0.78rem",
  cursor: "pointer",
  fontFamily: "inherit",
};

const viewBtnStyle = {
  background: "rgba(255,255,255,0.1)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.25)",
  borderRadius: 16,
  padding: "6px 14px",
  fontSize: "0.72rem",
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

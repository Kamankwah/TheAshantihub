import VerifiedMark from "./VerifiedMark.jsx";
import { useState } from "react";
import { C } from "../theme.js";
import { useOwnerReviews } from "../hooks/useOwnerReviews.js";
import { ReviewsList, ReviewWriteForm } from "./ReviewComponents.jsx";

// ─── SellerRatingBadge ──────────────────────────────────────────────────────
// About the seller, not the listing — reads useOwnerReviews(business_owner
// id) for the seller's own rating (an Airbnb-host-style rating, not an
// aggregate of their listings' reviews). Hides the rating portion entirely
// when review_count is 0, same "no fabricated 0.0" rule Card/EventCard use.
// Expandable to the seller's review list + a "write a seller review"
// affordance, reusing the same ReviewsList/ReviewWriteForm the listing
// Reviews tab uses (targeting "seller" instead of "listing").
//
// Moved out of ListingDetailPage.jsx (unchanged) so the product page can show
// it too without importing the page that renders it. `tone`: "dark" (default,
// the service/stay page's band) or "theme" (the product page's seller line).
const TONES = {
  dark: {
    box: { marginTop: 24, borderTop: "1px solid rgba(255,255,255,0.1)", borderBottom: "1px solid rgba(255,255,255,0.1)", padding: "14px 2px" },
    ink: "white", mark: C.gold, faint: "rgba(255,255,255,0.5)", align: undefined,
  },
  theme: {
    box: { margin: "4px 0 6px" },
    ink: C.ink, mark: C.inkDim, faint: C.inkDim, align: "left",
  },
};

export default function SellerRatingBadge({ businessOwner, user, tone = "dark" }) {
  const [expanded, setExpanded] = useState(false);
  const ownerReviewsQuery = useOwnerReviews(businessOwner?.id);

  if (!businessOwner) return null;

  const t = TONES[tone] || TONES.dark;
  const avgRating = ownerReviewsQuery.data?.avg_rating ?? 0;
  const reviewCount = ownerReviewsQuery.data?.review_count ?? 0;
  const reviews = ownerReviewsQuery.data?.results || [];

  return (
    <div style={t.box}>
      <button
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={{ background: "none", border: "none", color: t.ink, fontSize: "0.82rem", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 8, fontFamily: "inherit", textAlign: t.align }}
      >
        {reviewCount > 0 ? (
          <span>⭐ {Number(avgRating).toFixed(1)} · Sold by {businessOwner.name || businessOwner.full_name} · {reviewCount} seller review{reviewCount === 1 ? "" : "s"}</span>
        ) : (
          <span>Sold by {businessOwner.name || businessOwner.full_name}</span>
        )}
        <VerifiedMark verified={businessOwner.identity_verified} />
        <span style={{ color: t.mark }}>{expanded ? "▲" : "▼"}</span>
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
              tone={tone}
            />
          </div>
          {ownerReviewsQuery.isLoading ? (
            <div style={{ color: t.faint, fontSize: "0.8rem" }}>Loading seller reviews…</div>
          ) : (
            <ReviewsList reviews={reviews} emptyLabel="No seller reviews yet." tone={tone} />
          )}
        </div>
      )}
    </div>
  );
}

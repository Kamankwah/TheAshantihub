import { useState } from "react";
import { C } from "../theme.js";
import { apiPost } from "../apiClient.js";
import { useReviewEligibility } from "../hooks/useReviewEligibility.js";

// ─── ReviewComponents ───────────────────────────────────────────────────────
// Shared review-rendering/write-flow primitives (reviews/ratings/Q&A/tabbed-
// PDP plan, Phase 6). Originally defined privately inside
// ListingDetailPage.jsx during Phase 5 (listing Reviews tab + seller-rating
// badge). Extracted here once EventDetailPage.jsx (Phase 6) needed the exact
// same 4-state eligibility-gated write flow and review-list rendering for
// event reviews AND organizer reviews — four call sites total (listing,
// seller, event, organizer) made this a real duplication cost, not a
// premature abstraction. Pure move for ListingDetailPage's existing usage —
// no behavior change there.

// ─── starString ─────────────────────────────────────────────────────────────
// This module can't import App.jsx's `Stars` component — the established
// convention is that frontend/components/* never imports from App.jsx (see
// CLAUDE.md's "avoid an App.jsx <-> components/ circular import" note).
// `EventCard.jsx` has its own tiny near-identical copy for the same reason
// (predates this extraction) — left as-is rather than pointed at this file:
// it's two lines, and EventCard.jsx importing from a "reviews" module for a
// generic star-formatting helper would be an awkward dependency direction
// that doesn't clearly pay for itself.
export function starString(rating) {
  const full = Math.floor(rating || 0);
  return "★".repeat(full) + "☆".repeat(Math.max(0, 5 - full));
}

// ─── ReviewsList ────────────────────────────────────────────────────────────
// List-rendering shared by every review surface: the listing Reviews tab,
// the seller-rating badge's expanded list, the event Reviews section, and
// the organizer-rating section's expanded list.
export function ReviewsList({ reviews, emptyLabel = "No reviews yet." }) {
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
// (now-retired) ReviewsModal originally implemented (not signed in /
// checking / eligible / already-reviewed-or-ineligible), laid out inline in
// a page section rather than inside a modal shell. `targetType` is
// "listing" | "seller" | "event" | "organizer".
//
// `organizerKind` ("business" | "customer") is Phase 6's one behavior change
// to this shared component: it's only meaningful when targetType==="organizer"
// (an event organizer can be either a BusinessOwner or a Customer, per
// EventDetailSerializer's `organizer: {kind, id, full_name}` field), and is
// forwarded to both useReviewEligibility and the POST /api/reviews/ body as
// organizer_kind — both already support this per the Phase 2 backend
// contract. It's optional and backwards compatible: the listing/seller call
// sites never pass it, so they're unaffected.
export function ReviewWriteForm({ targetType, targetId, organizerKind, user, onReviewSubmitted, label = "Write a Review" }) {
  const [newRating, setNewRating] = useState(0);
  const [newText, setNewText] = useState("");
  const [hover, setHover] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [actionError, setActionError] = useState(null);
  const eligibility = useReviewEligibility(user ? { targetType, targetId, organizerKind } : {});

  const handleSubmit = async () => {
    if (!user || !newRating || !newText.trim()) return;
    setActionError(null);
    try {
      await apiPost("/api/reviews/", {
        target_type: targetType,
        target_id: targetId,
        rating: newRating,
        comment: newText,
        ...(organizerKind ? { organizer_kind: organizerKind } : {}),
      });
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
        <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.55)", textAlign: "center" }}>
          {targetType === "event" || targetType === "organizer"
            ? "You can review this after RSVPing as ‘going’ to the event."
            : "You can review this after a completed purchase."}
        </div>
      )}
    </div>
  );
}

function EmptyNote({ text }) {
  return <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.8rem" }}>{text}</div>;
}

// Exported so ListingDetailPage.jsx's Q&A form (a separate, non-review
// input) can reuse the exact same textarea/button chrome instead of a second
// copy of these style objects.
export const textareaStyle = {
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

export const submitBtnStyle = (active) => ({
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

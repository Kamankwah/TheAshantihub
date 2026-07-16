import { useEffect, useState } from "react";
import { C } from "../theme.js";
import { useEvent } from "../hooks/useEvent.js";
import { useEventReviews } from "../hooks/useEventReviews.js";
import { useOrganizerReviews } from "../hooks/useOrganizerReviews.js";
import { useEventTicketTypes } from "../hooks/useEventTicketTypes.js";
import { apiDelete, apiPost } from "../apiClient.js";
import { formatEventDate } from "./EventCard.jsx";
import { ReviewsList, ReviewWriteForm, starString } from "./ReviewComponents.jsx";

// ─── EventDetailPage ────────────────────────────────────────────────────────
// Event detail page for the Events tab (docs/BUSINESS_EVENTS_ROADMAP.md
// Phase 6). Follows the same no-router "AshantiHub holds a
// selectedEventId state and swaps this in" convention as ListingDetailPage,
// scoped inside the page==="events" block.
//
// **Handling "the detail response might just be a teaser":** GET
// /api/events/{id}/ (useEvent) returns the full EventDetailSerializer shape
// immediately for a public event, but for a private event without a valid
// code it silently falls back to the same safe teaser subset the list
// endpoint uses (EventTeaserSerializer) — never a 403, never a partial leak
// (see events/views.py's EventDetailView). The two shapes are told apart by
// presence of the `address` key: EventTeaserSerializer's field list never
// includes it at all (not just null), while EventDetailSerializer always
// does once a caller is allowed to see it — so `"address" in detail` is a
// reliable, single-field discriminator without needing a dedicated
// `is_locked` flag from the backend. A wrong/missing code always re-renders
// this same locked state rather than an error, matching the backend's own
// "never a partial leak" contract.
//
// A successful unlock (POST /api/events/{id}/unlock/) is kept in local
// `unlocked` state and rendered directly — simpler than re-querying
// useEvent with a `?code=` param, and avoids a second network round trip.
//
// ─── RSVP (docs/BUSINESS_EVENTS_ROADMAP.md Phase 7) ────────────────────────
// `user` (same shape App.jsx builds elsewhere: {accountType, ...}) gates the
// "I'm Going"/"Can't Go" toggle to signed-in customer accounts only — POST
// /api/events/{id}/rsvp/ 403s for business owners server-side (RSVP is an
// attendee concept, distinct from the "either account type may submit an
// event" rule used for event submission), so this component mirrors that
// role split in the UI rather than letting a business owner hit a 403.
//
// **No "what's my current RSVP status" read endpoint exists in this phase's
// backend scope** — only POST/DELETE to *set* the caller's status, and GET
// /rsvps/ which is organizer-only (the attendee list), not a per-caller
// self-check. So `rsvpStatus` is tracked purely optimistically in local
// state, seeded from the `status` field of the POST/DELETE response, and
// always starts at "not going" on page load/refresh — even if the signed-in
// user already RSVP'd in a previous session. This is a known, documented
// limitation (not a bug) rather than a reason to invent a backend endpoint
// that isn't part of this phase's contract.
//
// Because this app has no router, switching accounts (sign out then sign
// back in as someone else) does not necessarily remount this component —
// `AshantiHub`'s `selectedEventId` is untouched by auth state, so if the
// user never navigates away from the currently-open event, React reuses the
// same component instance across the account switch. Without the effect
// below (see the `useEffect` right after this component's `useState` calls),
// the *previous* account's optimistic `rsvpStatus`/`rsvpFull` would stay
// visible to the newly signed-in account, which is worse than the documented
// "always starts at not going" limitation — it would actively show the
// wrong person's status. That effect resets on `user?.id` change (covers
// both sign-out, where it becomes undefined, and switching to a different
// account) so the state matches the "start fresh" contract in all cases,
// not just a full page reload.
//
// For a private event, RSVP-ing reuses whatever `code` was already entered
// to unlock the detail page above (the backend requires the same code on
// POST /rsvp/ as on /unlock/, since Phase 6 is deliberately stateless with
// no server-side "already unlocked" session) — never prompts for it again.
//
// A 400 response from POST /rsvp/ means "this event is at capacity"
// (events/views.py's EventRSVPView is the only way this endpoint 400s) —
// surfaced generically off the error's `status`/`body.detail` rather than
// computed from any capacity number, since capacity isn't part of
// EventDetailSerializer's exposed fields.
//
// ─── Reviews + Organizer rating (reviews/ratings/Q&A plan, Phase 6) ────────
// Not the full 7-tab treatment ListingDetailPage.jsx got in Phase 5 — the
// original ask was tabs for the product/service PDP only; events just get
// plain sections. Below the RSVP block: a Reviews section (aggregate +
// useEventReviews(id) list + an inline eligibility-gated ReviewWriteForm
// targeting {targetType:"event"}) and an Organizer section ("Organized by
// {full_name}" from EventDetailSerializer's `organizer` field, an
// avg_rating/review_count badge sourced from
// useOrganizerReviews(organizer.kind, organizer.id) — hidden entirely when
// review_count is 0, same "no fabricated 0.0" rule as
// ListingDetailPage.jsx's SellerRatingBadge — expandable to the organizer's
// review list plus a ReviewWriteForm targeting
// {targetType:"organizer", organizerKind: organizer.kind}). Both sections
// reuse ReviewsList/ReviewWriteForm from ./ReviewComponents.jsx rather than
// re-implementing the write-flow state machine a third time. Both are
// placed after the early `if (isLocked) return ...` above, so they're
// already structurally unreachable for a locked, un-unlocked private event
// — no redundant extra gate needed here.
export default function EventDetailPage({ id, onBack, user, PaymentComponent }) {
  const { data: event, isLoading, isError, refetch } = useEvent(id);
  const [unlocked, setUnlocked] = useState(null);
  const [code, setCode] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  const [rsvpStatus, setRsvpStatus] = useState(null); // null ("not going") | "going" | "cancelled"
  const [rsvpBusy, setRsvpBusy] = useState(false);
  const [rsvpError, setRsvpError] = useState(null);
  const [rsvpFull, setRsvpFull] = useState(false);
  const [goingCountOverride, setGoingCountOverride] = useState(null);

  // See the RSVP doc-comment above the component for why this is needed:
  // without it, switching signed-in accounts while this same event stays
  // open would leak the previous account's optimistic RSVP state into the
  // new one.
  useEffect(() => {
    setRsvpStatus(null);
    setRsvpFull(false);
    setRsvpError(null);
    setGoingCountOverride(null);
  }, [user?.id]);

  if (isLoading) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 14px", color: C.lightGold, background: C.void, borderRadius: 20 }}>
        Loading…
      </div>
    );
  }

  if (isError || !event) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 14px", textAlign: "center", background: C.void, borderRadius: 20 }}>
        <div style={{ color: "white", marginBottom: 12 }}>Could not load this event.</div>
        <button onClick={() => refetch()} style={backBtnStyle}>Retry</button>{" "}
        <button onClick={onBack} style={backBtnStyle}>‹ Back to events</button>
      </div>
    );
  }

  const detail = unlocked || event;
  const isLocked = !("address" in detail);
  const accentColor = detail.category?.color || C.gold;
  const isCustomer = user?.accountType === "customer";
  const isBusinessOwner = user?.accountType === "business_owner";

  const handleUnlock = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setUnlocking(true);
    setUnlockError(null);
    try {
      const result = await apiPost(`/api/events/${id}/unlock/`, { code: code.trim() });
      setUnlocked(result);
    } catch (err) {
      setUnlockError("Incorrect code. Please check it and try again.");
    } finally {
      setUnlocking(false);
    }
  };

  const handleRSVPGoing = async () => {
    setRsvpError(null);
    setRsvpFull(false);
    setRsvpBusy(true);
    try {
      const body = detail.access_level === "private" ? { code: code.trim() } : {};
      const result = await apiPost(`/api/events/${id}/rsvp/`, body);
      setRsvpStatus(result?.status || "going");
      if (result?.going_count != null) setGoingCountOverride(result.going_count);
    } catch (err) {
      if (err?.status === 400 && /capacity/i.test(err?.body?.detail || "")) {
        setRsvpFull(true);
      } else {
        setRsvpError("Could not RSVP to this event right now. Please try again.");
      }
    } finally {
      setRsvpBusy(false);
    }
  };

  const handleRSVPCancel = async () => {
    setRsvpError(null);
    setRsvpBusy(true);
    try {
      await apiDelete(`/api/events/${id}/rsvp/`);
      setRsvpStatus("cancelled");
      setGoingCountOverride((current) => {
        const base = current != null ? current : detail.going_count;
        return base != null ? Math.max(0, base - 1) : base;
      });
    } catch (err) {
      setRsvpError("Could not cancel your RSVP right now. Please try again.");
    } finally {
      setRsvpBusy(false);
    }
  };

  if (isLocked) {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 14px 40px", background: C.void, borderRadius: 20 }}>
        <button onClick={onBack} style={backBtnStyle}>‹ Back to events</button>
        <div style={{ marginTop: 20, textAlign: "center", padding: "36px 20px", background: "rgba(255,255,255,0.04)", borderRadius: 16, border: `1.5px solid ${accentColor}55` }}>
          <div style={{ fontSize: "2.2rem", marginBottom: 10 }}>🔒</div>
          <h1 style={{ color: "white", fontSize: "1.2rem", fontWeight: 900, margin: "0 0 4px" }}>{detail.name}</h1>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.8rem", marginBottom: 6 }}>
            {detail.category?.icon} {detail.category?.label}{detail.zone?.name ? ` · 📍 ${detail.zone.name}` : ""}
          </div>
          {formatEventDate(detail.event_date) && (
            <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.8rem", marginBottom: 18 }}>{formatEventDate(detail.event_date)}</div>
          )}
          <div style={{ color: C.lightGold, fontSize: "0.85rem", fontWeight: 700, marginBottom: 14 }}>
            This event is private — enter the code to view details.
          </div>
          <form onSubmit={handleUnlock} style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", maxWidth: 320, margin: "0 auto" }}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Access code"
              aria-label="Access code"
              style={{ flex: 1, minWidth: 160, padding: "10px 14px", borderRadius: 20, border: "1.5px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.08)", color: "white", fontFamily: "inherit", fontSize: "0.82rem" }}
            />
            <button
              type="submit"
              disabled={unlocking || !code.trim()}
              style={{ background: C.gold, color: C.darkBrown, border: "none", borderRadius: 20, padding: "10px 20px", fontWeight: 900, fontSize: "0.8rem", cursor: unlocking ? "wait" : "pointer", fontFamily: "inherit" }}
            >
              {unlocking ? "Checking…" : "Unlock"}
            </button>
          </form>
          {unlockError && <div style={{ marginTop: 10, color: "#ffb4b4", fontSize: "0.76rem" }}>{unlockError}</div>}
        </div>
      </div>
    );
  }

  const gallery = detail.media?.length > 0 ? detail.media.map((m) => m.media) : [];
  const directionsUrl = detail.lat != null && detail.lng != null ? `https://www.google.com/maps?q=${detail.lat},${detail.lng}` : null;
  // "Live" going_count badge (Phase 7): starts at whatever the detail
  // response reported, then reflects the caller's own RSVP/cancel
  // immediately off that request's response — no polling/websocket, which
  // would be over-engineering for a single-viewer detail page.
  const displayedGoingCount = goingCountOverride != null ? goingCountOverride : detail.going_count;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "16px 14px 40px", background: C.void, borderRadius: 20 }}>
      <button onClick={onBack} style={backBtnStyle}>‹ Back to events</button>

      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", marginTop: 16 }}>
        <div style={{ flex: "1 1 380px", minWidth: 300 }}>
          <div style={{ height: 320, borderRadius: 16, overflow: "hidden", position: "relative", background: `linear-gradient(135deg,${accentColor}22,${accentColor}44)` }}>
            {gallery.length > 0 ? (
              <img src={gallery[galleryIndex]} alt={detail.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "3.5rem" }}>
                {detail.category?.icon}
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
                  style={{ padding: 0, width: 60, height: 60, borderRadius: 10, overflow: "hidden", border: i === galleryIndex ? `2px solid ${C.gold}` : "2px solid transparent", cursor: "pointer", background: "none" }}
                >
                  <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: "1 1 320px", minWidth: 280 }}>
          {detail.access_level === "private" && (
            <span style={{ display: "inline-block", background: `${C.kente1}22`, color: C.kente1, fontSize: "0.62rem", fontWeight: 700, padding: "3px 9px", borderRadius: 20, marginBottom: 8 }}>
              🔒 Private Event — unlocked
            </span>
          )}
          <h1 style={{ color: "white", fontSize: "1.4rem", fontWeight: 900, margin: "0 0 4px" }}>{detail.name}</h1>
          <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "0.8rem", marginBottom: 10 }}>
            {detail.category?.icon} {detail.category?.label}{detail.zone?.name ? ` · 📍 ${detail.zone.name}` : ""}
          </div>
          {formatEventDate(detail.event_date) && (
            <div style={{ color: accentColor, fontWeight: 900, fontSize: "0.95rem", marginBottom: 14 }}>📅 {formatEventDate(detail.event_date)}</div>
          )}
          {detail.description && (
            <p style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.88rem", lineHeight: 1.7, marginBottom: 16 }}>{detail.description}</p>
          )}
          {detail.address && (
            <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.82rem", marginBottom: 10 }}>📍 {detail.address}</div>
          )}
          {displayedGoingCount != null && (
            <div style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.82rem", marginBottom: 16 }}>
              🎉 {displayedGoingCount} going
            </div>
          )}
          {directionsUrl && (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noreferrer"
              style={{ display: "inline-block", background: C.whatsapp, color: "white", border: "none", borderRadius: 20, padding: "10px 18px", fontSize: "0.8rem", fontWeight: 700, textDecoration: "none", minHeight: 44, lineHeight: "24px" }}
            >
              🧭 Get Directions
            </a>
          )}

          {/* RSVP toggle (docs/BUSINESS_EVENTS_ROADMAP.md Phase 7) — see the
              block comment above the component for the role-gating and
              "no self-status endpoint" rationale. */}
          <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
            {!user ? (
              <div style={{ color: C.lightGold, fontSize: "0.8rem" }}>Sign in to RSVP to this event.</div>
            ) : isBusinessOwner ? (
              <div>
                <button
                  disabled
                  title="RSVP is a customer-account action"
                  style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 20, padding: "10px 18px", fontSize: "0.8rem", fontWeight: 700, cursor: "not-allowed", minHeight: 44, fontFamily: "inherit" }}
                >
                  🎉 I'm Going
                </button>
                <div style={{ marginTop: 8, color: "rgba(255,255,255,0.5)", fontSize: "0.72rem" }}>
                  RSVPs are for customer accounts — business accounts can submit and manage events but can't RSVP to them.
                </div>
              </div>
            ) : isCustomer ? (
              <div>
                {rsvpFull ? (
                  <div style={{ color: "#ffb4b4", fontSize: "0.82rem", fontWeight: 700 }}>🚫 This event is at capacity.</div>
                ) : (
                  <button
                    onClick={rsvpStatus === "going" ? handleRSVPCancel : handleRSVPGoing}
                    disabled={rsvpBusy}
                    style={{
                      background: rsvpStatus === "going" ? "rgba(255,255,255,0.1)" : C.gold,
                      color: rsvpStatus === "going" ? "white" : C.darkBrown,
                      border: rsvpStatus === "going" ? "1.5px solid rgba(255,255,255,0.3)" : "none",
                      borderRadius: 20,
                      padding: "10px 18px",
                      fontSize: "0.8rem",
                      fontWeight: 900,
                      cursor: rsvpBusy ? "wait" : "pointer",
                      minHeight: 44,
                      fontFamily: "inherit",
                    }}
                  >
                    {rsvpBusy ? "…" : rsvpStatus === "going" ? "✓ Going — Can't Go?" : "🎉 I'm Going"}
                  </button>
                )}
                {rsvpError && <div style={{ marginTop: 8, color: "#ffb4b4", fontSize: "0.74rem" }}>{rsvpError}</div>}
              </div>
            ) : (
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.78rem" }}>Only customer accounts can RSVP to events.</div>
            )}
          </div>
        </div>
      </div>

      {/* Tickets section (event ticketing + escrow work) — sits after the
          RSVP block and before Reviews/Organizer, same "full-width block
          below the gallery+details flex row" placement. */}
      <EventTicketsSection eventId={id} hasTickets={detail.has_tickets} user={user} PaymentComponent={PaymentComponent} />

      {/* Reviews + Organizer sections (reviews/ratings/Q&A plan, Phase 6) —
          see the block comment above the component for the full rationale.
          Full-width blocks below the gallery+details flex row, same
          convention ListingDetailPage.jsx uses for its seller-rating badge
          sitting outside its two-column layout. */}
      <EventReviewsSection eventId={id} detail={detail} user={user} />
      <OrganizerRatingSection organizer={detail.organizer} user={user} />
    </div>
  );
}

// ─── EventTicketsSection ────────────────────────────────────────────────────
// Event ticketing + escrow work. Self-fetches useEventTicketTypes(eventId)
// (same "self-fetches, doesn't receive data as a prop" convention as
// EventReviewsSection/OrganizerRatingSection above). Renders nothing at all
// when the event has no active ticket types — either because hasTickets is
// false (EventDetailSerializer's has_tickets field, avoids ever firing the
// fetch for an event that was never ticketed) or because the list resolved
// empty, mirroring OrganizerRatingSection's "hide rather than show an empty
// state" convention.
//
// Buy flow follows the same **pay-first** convention as
// EventSubmissionPanel's openPay/confirmPay (not ListingDetailPage's
// promotions apiPost-first pattern) — PaymentComponent (App.jsx's
// MoMoPayment) opens immediately on "Buy" with a locally snapshotted
// amount/quantity, and the actual
// POST /api/events/{id}/tickets/purchase/ only fires from its onSuccess.
function EventTicketsSection({ eventId, hasTickets, user, PaymentComponent }) {
  const ticketTypesQuery = useEventTicketTypes(hasTickets ? eventId : null);
  const ticketTypes = ticketTypesQuery.data || [];

  const [quantities, setQuantities] = useState({});
  const [payTarget, setPayTarget] = useState(null); // {ticketType, quantity, amount}
  const [payError, setPayError] = useState(null);
  const [purchasedByType, setPurchasedByType] = useState({}); // ticketTypeId -> Ticket[]

  const isCustomer = user?.accountType === "customer";

  if (!hasTickets) return null;
  if (!ticketTypesQuery.isLoading && !ticketTypesQuery.isError && ticketTypes.length === 0) return null;

  const maxQtyFor = (tt) => (tt.quantity_remaining != null ? Math.min(tt.quantity_remaining, 10) : 10);

  const setQty = (ttId, value, max) => {
    const clamped = Math.min(Math.max(1, Number(value) || 1), max);
    setQuantities((q) => ({ ...q, [ttId]: clamped }));
  };

  const openPay = (tt) => {
    const qty = quantities[tt.id] || 1;
    setPayError(null);
    setPayTarget({ ticketType: tt, quantity: qty, amount: Number(tt.price) * qty });
  };

  const confirmPurchase = async () => {
    if (!payTarget) return;
    setPayError(null);
    try {
      const response = await apiPost(`/api/events/${eventId}/tickets/purchase/`, {
        ticket_type: payTarget.ticketType.id,
        quantity: payTarget.quantity,
      });
      // Hubtel integration (docs/HUBTEL_INTEGRATION.md) — once
      // payments_provider is "hubtel", TicketPurchaseView returns
      // {mode:"redirect", checkout_url} instead of the purchased tickets
      // (inventory is reserved optimistically, but no Ticket rows/codes
      // exist yet). Redirect rather than showing a purchase confirmation —
      // the actual ticket code(s) are only created once the webhook
      // confirms payment (see "My Tickets" for them afterward).
      if (response?.mode === "redirect") {
        window.location.href = response.checkout_url;
        return;
      }
      setPurchasedByType((p) => ({ ...p, [payTarget.ticketType.id]: response }));
      setPayTarget(null);
      ticketTypesQuery.refetch();
    } catch (err) {
      setPayError("Payment was confirmed but we couldn't complete your ticket purchase. Please contact support.");
    } finally {
      setPayTarget(null);
    }
  };

  return (
    <div style={{ marginTop: 24, borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 20 }}>
      <h2 style={{ color: C.gold, fontSize: "1rem", fontWeight: 900, margin: "0 0 16px" }}>Tickets</h2>

      {ticketTypesQuery.isLoading && <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.8rem" }}>Loading ticket types…</div>}
      {ticketTypesQuery.isError && (
        <div style={{ color: "#ffb4b4", fontSize: "0.8rem" }}>
          Could not load ticket types.{" "}
          <button onClick={() => ticketTypesQuery.refetch()} style={{ background: "none", border: `1px solid ${C.kente1}`, color: C.kente1, borderRadius: 20, padding: "2px 10px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer" }}>Retry</button>
        </div>
      )}
      {payError && <div style={{ marginBottom: 12, color: "#ffb4b4", fontSize: "0.76rem" }}>{payError}</div>}

      {ticketTypes.map((tt) => {
        const soldOut = tt.quantity_remaining != null && tt.quantity_remaining <= 0;
        const max = maxQtyFor(tt);
        const qty = quantities[tt.id] || 1;
        const purchased = purchasedByType[tt.id];

        return (
          <div key={tt.id} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 12, padding: "14px 16px", marginBottom: 12, border: `1px solid ${C.gold}22` }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <div style={{ color: "white", fontWeight: 800, fontSize: "0.86rem" }}>{tt.name}</div>
                {tt.description && <div style={{ color: "rgba(255,255,255,0.65)", fontSize: "0.76rem", marginTop: 2, maxWidth: 420 }}>{tt.description}</div>}
                <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.72rem", marginTop: 4 }}>
                  {soldOut ? "Sold out" : tt.quantity_remaining != null ? `${tt.quantity_remaining} remaining` : "Available"}
                </div>
              </div>
              <div style={{ color: C.gold, fontWeight: 900, fontSize: "0.95rem", whiteSpace: "nowrap" }}>GHS {tt.price}</div>
            </div>

            {!soldOut && (
              <div style={{ marginTop: 12 }}>
                {!user ? (
                  <div style={{ color: C.lightGold, fontSize: "0.76rem" }}>Sign in as a customer to buy tickets.</div>
                ) : !isCustomer ? (
                  <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.76rem" }}>Only customer accounts can buy tickets.</div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <input
                      type="number"
                      min={1}
                      max={max}
                      value={qty}
                      onChange={(e) => setQty(tt.id, e.target.value, max)}
                      aria-label={`Quantity for ${tt.name}`}
                      style={{ width: 60, padding: "8px 10px", borderRadius: 10, border: "1.5px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.08)", color: "white", fontFamily: "inherit", fontSize: "0.8rem" }}
                    />
                    <button
                      onClick={() => openPay(tt)}
                      style={{ background: C.gold, color: C.darkBrown, border: "none", borderRadius: 20, padding: "9px 18px", fontWeight: 900, fontSize: "0.78rem", cursor: "pointer", fontFamily: "inherit" }}
                    >
                      Buy
                    </button>
                  </div>
                )}
              </div>
            )}

            {purchased && (
              <div style={{ marginTop: 12, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ color: C.kente2, fontWeight: 800, fontSize: "0.8rem", marginBottom: 4 }}>✅ Purchased!</div>
                <div style={{ color: "white", fontSize: "0.78rem", marginBottom: 4 }}>
                  Your ticket code{purchased.length > 1 ? "s" : ""}: <strong>{purchased.map((t) => t.code).join(", ")}</strong>
                </div>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.74rem" }}>
                  {tt.delivery_method === "digital"
                    ? "Show this code at check-in."
                    : "Present this code to collect your physical ticket."}
                </div>
                <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.7rem", marginTop: 4 }}>
                  You can also find all your tickets later under "My Tickets".
                </div>
              </div>
            )}
          </div>
        );
      })}

      {payTarget && PaymentComponent && (
        <PaymentComponent
          amount={payTarget.amount}
          purpose={`${payTarget.quantity}x '${payTarget.ticketType.name}' ticket(s)`}
          businessName={user?.fullName || ""}
          onSuccess={confirmPurchase}
          onClose={() => setPayTarget(null)}
        />
      )}
    </div>
  );
}

// ─── EventReviewsSection ────────────────────────────────────────────────────
function EventReviewsSection({ eventId, detail, user }) {
  const reviewsQuery = useEventReviews(eventId);
  const reviews = reviewsQuery.data?.results || [];
  const avgRating = reviewsQuery.data?.avg_rating ?? detail.avg_rating;
  const reviewCount = reviewsQuery.data?.review_count ?? detail.review_count ?? 0;

  return (
    <div style={{ marginTop: 24, borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 20 }}>
      <h2 style={{ color: C.gold, fontSize: "1rem", fontWeight: 900, margin: "0 0 16px" }}>Reviews</h2>
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
        <ReviewWriteForm targetType="event" targetId={eventId} user={user} onReviewSubmitted={() => reviewsQuery.refetch()} />
      </div>
      {reviewsQuery.isLoading ? (
        <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.8rem" }}>Loading reviews…</div>
      ) : (
        <ReviewsList reviews={reviews} />
      )}
    </div>
  );
}

// ─── OrganizerRatingSection ─────────────────────────────────────────────────
// About the event's organizer, not the event itself — an Airbnb-host-style
// rating, not an aggregate of the organizer's events' reviews. `organizer`
// is EventDetailSerializer's `{kind: "business"|"customer", id, full_name}`
// field. Hides the rating portion entirely when review_count is 0, same
// "no fabricated 0.0" rule ListingDetailPage.jsx's SellerRatingBadge uses —
// that's this section's reference pattern, including the expand/collapse-
// to-reviews-plus-write-form behavior.
function OrganizerRatingSection({ organizer, user }) {
  const [expanded, setExpanded] = useState(false);
  const organizerReviewsQuery = useOrganizerReviews(organizer?.kind, organizer?.id);

  if (!organizer) return null;

  const avgRating = organizerReviewsQuery.data?.avg_rating ?? 0;
  const reviewCount = organizerReviewsQuery.data?.review_count ?? 0;
  const reviews = organizerReviewsQuery.data?.results || [];

  return (
    <div style={{ marginTop: 24, borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 20 }}>
      <button
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        style={{ background: "none", border: "none", color: "white", fontSize: "0.82rem", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 8, fontFamily: "inherit" }}
      >
        {reviewCount > 0 ? (
          <span>⭐ {avgRating} · Organized by {organizer.full_name} · {reviewCount} organizer review{reviewCount === 1 ? "" : "s"}</span>
        ) : (
          <span>Organized by {organizer.full_name}</span>
        )}
        <span style={{ color: C.gold }}>{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div style={{ marginTop: 14 }}>
          <div style={{ marginBottom: 16 }}>
            <ReviewWriteForm
              targetType="organizer"
              targetId={organizer.id}
              organizerKind={organizer.kind}
              user={user}
              onReviewSubmitted={() => organizerReviewsQuery.refetch()}
              label="Write an Organizer Review"
            />
          </div>
          {organizerReviewsQuery.isLoading ? (
            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.8rem" }}>Loading organizer reviews…</div>
          ) : (
            <ReviewsList reviews={reviews} emptyLabel="No organizer reviews yet." />
          )}
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

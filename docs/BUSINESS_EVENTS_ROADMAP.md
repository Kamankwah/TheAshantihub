# Business Tab Redesign & Events Platform — Phased Roadmap

**Status:** Planning only — no code has been written for anything in this document. It builds on the live `Listing`/`Category`/`Zone` models, the `accounts` Role/Permission system, and the existing simulated `billing.Transaction` payment pattern (`MoMoModal`/`MoMoPayment`). Real Hubtel wiring (`docs/HUBTEL_INTEGRATION.md`) is the eventual swap-in for every "simulated payment" step below — it is not a blocker for any phase here.

## 0. Starting point (as-is, verified against the codebase)

- **Business tab already exists and is live** at `page==="business"` in `frontend/App.jsx` (~lines 3199-3414): real `useCategories()`/`useListings()` data, debounced search, a collapsible **top-panel** filter bar (currency/sort/zone/min-max price), a horizontal category-tab strip, and a `Card` grid with a simulated "💳 Pay" button (`MoMoModal`). It has **no** listing detail page (`useListing(id)` exists but is only used inside the favourites drawer), **no** cart/basket anywhere in the codebase, and **no** promoted/boosted listing concept (only a placeholder "Promotions" `ComingSoonPanel` tab in `StaffDashboard`, plus an already-seeded `"promotions.manage"` RBAC permission string with nothing behind it).
- **Events tab is 100% static** (`frontend/App.jsx` ~lines 3417-3447): one fixed hero image and a hardcoded array of 3 fake events. No `Event` model exists anywhere in the backend.
- **The role system this roadmap needs already exists**: `backend/accounts/models.py` has a real `Role`/`Permission` model (`super_admin, admin, accountant, marketing, support`), consumed via `HasRolePermission`. No new role system is needed — only new permission codenames seeded onto the existing roles.
- **A reusable approval-queue pattern already exists**: `listings/views.py`'s `ModerationPendingQueueView` / `ModerationApproveView` / `ModerationRejectView` triad (backing `StaffDashboard`'s listing moderation panel) is the template the new hero-media and event approval queues should clone rather than reinvent.
- **No `Cart`, `Order`, `Promotion`, `Boost`, `HeroSlot`, or `Event` model exists anywhere in the backend.** All are net-new. Payments are entirely simulated today (`MoMoModal`/`MoMoPayment` + a naive `billing.Transaction` ledger with a free-text `purpose` field); real Hubtel integration is spec'd (`docs/HUBTEL_INTEGRATION.md`) but not built.

**Scope decisions already made for this roadmap:**
1. Every phase below builds on the existing simulated-payment pattern. Swapping in real Hubtel Checkout is a separate, later cutover (mirrors `docs/PROJECT_SCOPE.md` §5b's `MoMoPayment`/`MoMoModal` cutover days) applied once across all of these flows at once, not per-phase.
2. The Business tab work is a **redesign of the existing live page in place**, not a second parallel marketplace page.

---

## Phase 1 — Data Foundations

**Goal:** land the schema/permission groundwork every later phase depends on, so no downstream phase forces a migration re-do.

- **Backend:**
  - `listings.Category`: add a `kind` field (choices `product` / `service` / `event`, default `product`) + a data migration classifying the existing seeded categories (electronics/food stuff → `product`; hotels/accommodation/decorations/mechanic/tours/crafts/transport → `service`; new event categories added in Phase 6 → `event`).
  - `billing.SubscriptionPlan`: add structured entitlement fields alongside the existing loose `features` JSONField — `max_active_listings` (int), `hero_days` (int, default hero-slot visibility window per tier), `boost_credits_per_month` (int). `features` stays as marketing copy only; it stops being the source of truth for gating.
  - `accounts`: new `Permission` rows `hero_media.approve` and `event.approve`, seeded onto `admin` and `marketing` roles via a migration matching the existing `0002_seed_roles_permissions.py` / `0006_seed_zones_manage_permission.py` pattern. `super_admin`'s "all permissions" matrix picks these up automatically — satisfies "approved by marketing, admin, or super_admin, any one of the three."
- **Frontend:** none.
- **Dependency:** none — do this first.

**Needs sketching before coding:** the `SubscriptionPlan` entitlement migration must backfill real values for the three existing seeded tiers (`basic`/`standard`/`premium`), and decide whether `boost_credits_per_month` rolls over unused credits or resets monthly.

---

## Phase 2 — Hero Media Submission & Approval

**Goal:** a business can submit one gallery item + a one-sentence caption for hero consideration; any one of marketing/admin/super_admin approves; the business's subscription tier drives how long it stays live.

- **Backend:** new `HeroMediaSubmission` model (either its own small app or living under `listings`): `business_owner` FK, `media` (Image/FileField, same content-type validation as `ListingPhoto`), `media_type` (`image`/`video`), `caption` (≤140 chars), `status` (`pending`/`approved`/`rejected`, mirrors `Listing.STATUS_CHOICES`), `rejection_reason`, `submitted_at`, `approved_at`, `expires_at` (computed on approval as `approved_at + plan.hero_days`), `extended_days` (running total of paid extensions). Clone the moderation-queue shape exactly: `HeroPendingQueueView` / `HeroApproveView` / `HeroRejectView`, gated by `HasRolePermission("hero_media.approve")`. A `GET /api/hero/active/` endpoint returns non-expired approved rows for the public hero slider. A `POST /api/hero/{id}/extend/` endpoint bumps `expires_at` on simulated-payment success.
- **Frontend:** Business dashboard gets a "Submit for Hero" action on an existing gallery photo (reuses the `ListingPhoto` gallery that already exists on the `Listing` model), with a caption field. `StaffDashboard` gets a new `HeroApprovalPanel` tab (new hook `useHeroModerationQueue()`, same shape as `useModerationQueue`). The extension payment reuses `MoMoModal`'s simulated flow.
- **Dependency:** Phase 1 (entitlement fields, permission seeds).

---

## Phase 3 — Business Tab Redesign (Sidebar, Grid, PDP)

**Goal:** replace the current top-panel Business tab in place with the sidebar/grid/PDP layout from the brief. This is the largest single UI phase.

- **Backend:** extend the listings-list endpoint's filters to accept `kind` (product/service) alongside the existing `category`/`zone`/`search`/price/`ordering` params; add a `verified` filter reading off `BusinessOwner.kyc_status` (no new model — "verified" = KYC-verified). New `GET /api/listings/{id}/related/` (same category/zone, excluding self, limited count) for the PDP's related-items rail. If the brief's "specs" block is required, add a `specs` JSONField to `Listing`.
- **Frontend:**
  - New reusable `Sidebar` filter component: area/zone dropdown, price range, verified/KYC badge toggle, sort, distance-from-zone. Built reusable now because the Events tab (Phase 6) reuses it as-is.
  - Category strip splits into Products / Services, driven by `Category.kind`.
  - Grid becomes a 4x5 tile layout with infinite scroll (extends the existing `useListings` infinite query — no new hook needed).
  - New timer-based hero carousel component, adapted from `Hero.jsx`'s crossfade/Ken-Burns/`usePrefersReducedMotion` pattern but auto-rotating on an interval rather than scroll-pinned, consuming Phase 2's `GET /api/hero/active/`.
  - New PDP route (gallery via `ListingPhoto`, name, description, specs, terms, related items, "Add to Cart" wired up in Phase 4). `useListing(id)` is promoted from favourites-drawer-only use to the PDP's primary data source.
- **Dependency:** Phase 1 (`kind`), Phase 2 (hero API). Replaces the live Business tab in place, per the confirmed scope decision — no parallel page.

---

## Phase 4 — Cart & Checkout

**Goal:** add-to-cart → checkout → simulated GHS payment, end to end.

- **Backend:** new `Cart` (one-to-one `Customer`), `CartItem` (`cart` FK, `listing` FK, `quantity`, `unit_price_snapshot`), `Order` (`customer` FK, `status`: pending/paid/cancelled, `total_amount`, `placed_at`), `OrderItem` (`order` FK, `listing` FK, `quantity`, `unit_price`, `line_total`). `billing.Transaction` today FKs only to `BusinessOwner`, so it can't represent a customer's order payment as-is — add a nullable `customer` FK to the existing `Transaction` model (one ledger table) rather than introducing a parallel payment table. The checkout endpoint mirrors the existing "simulated success POST persists state" pattern already used by subscription purchase.
- **Frontend:** Navbar gets a cart icon (utility action-row group, badge = item count) opening a `CartDrawer` — same visual pattern as the existing favourites drawer, but backed by a real `useCart()` hook (not local `useState`, since a cart should survive a refresh/device switch). New checkout page: review → payment method select → `MoMoModal`-style simulated pay → order confirmation.
- **Dependency:** Phase 3 (PDP's "Add to Cart" button, redesigned grid to shop from).

---

## Phase 5 — Promotion / Boost & Search Ranking

**Goal:** a business can pay to promote a listing (always shows first) or boost it (keyword-priority in search) — a purchase distinct from subscription tier.

- **Backend:** new `Promotion` model: `listing` FK, `kind` (`featured`/`boost`), `starts_at`/`ends_at`, `keywords` (CharField, boost-only), `amount_paid`, `status`. The listing list/search endpoint annotates `is_promoted` from active `Promotion` rows and orders `-is_promoted` first (existing ordering unchanged after that); boost matches get priority when a row's `keywords` overlap the search query. The purchase flow reuses the extended `Transaction` ledger from Phase 4 via the same simulated-pay pattern.
- **Frontend:** a "Promote this listing" action in the business dashboard's listing management. Finally retires the `StaffDashboard` "Promotions" `ComingSoonPanel` placeholder, replacing it with real purchase records.
- **Dependency:** Phase 3 (grid/search), Phase 4 (payment ledger shape). Can run in parallel with Phase 6.

---

## Phase 6 — Events Platform

**Goal:** a full Events tab — submission, approval, paid day-based visibility, auto-expiry, public/private access control, detail page with directions.

- **Backend:** new `events` app:
  - `Event`: `category` FK (reuses `Category` with `kind=event`), `submitted_by_customer` / `submitted_by_business` (nullable FKs, exactly one set — validated at the app level), `name`, `description`, `address`, `lat`/`lng`, `event_date`, `visibility_days` (7-90), `status` (pending/approved/rejected/expired), `paid_at`, `expires_at` (`paid_at + visibility_days`), `approved_by` FK to `StaffUser`, **`access_level`** (`public`/`private`, default `public`), **`access_code`** (short unique alphanumeric string, auto-generated on creation — e.g. via `secrets.token_urlsafe` truncated/formatted, only meaningfully enforced when `access_level=private`; kept on public events too so nothing breaks if an organizer switches an event to private later), plus a denormalized `going_count` (kept in sync by the new `EventRSVP` model in Phase 7 — see below) used as the live "RSVP number."
  - **Public vs. private enforcement is server-side, not just a frontend gate**, since address/RSVP-count/exact location must not leak in the API response for a private event without the code:
    - The list/search endpoint (`GET /api/events/`) always returns a "teaser" subset for every event regardless of access level — name, category, hero media, event date, general area (zone, not exact address/lat-lng) — so private events still appear in the grid and are discoverable, just without sensitive fields.
    - The detail endpoint (`GET /api/events/{id}/`) returns the full record immediately for `access_level=public` events. For `access_level=private` events it returns only the teaser subset **unless** a valid code is supplied — either as a `?code=` query param or via a separate `POST /api/events/{id}/unlock/` that accepts `{code}` and, on match, returns (or unlocks) the full serialized detail (address, lat/lng, `going_count`, any other restricted fields). A wrong/missing code returns the teaser only (or 403 for the unlock endpoint), never a partial leak.
    - The organizer always sees their own event's `access_code` and full detail on their own "my events" view, regardless of `access_level`, so they have something to actually share.
  - `EventMedia` (`event` FK, file, `media_type`, `order`) — event media approval folds into the single event-approval step (no separate submission queue like hero media has), since the whole event record is already gated.
  - Approval queue clones the same moderation pattern, gated by `event.approve`.
  - **Auto-expiry mechanism:** there is no Celery/Redis in `backend/requirements.txt` today, and Redis is already deferred to the later real-time-messaging phase per `docs/PROJECT_SCOPE.md` §3/§6 — so ship a `manage.py expire_events` management command run via system cron on the VPS (same class of mechanism as the project's existing "basic cron backup" precedent in `docs/PROJECT_SCOPE.md` §7), not Celery beat. Note Celery beat as the future swap-in once Channels/Redis lands for Phase 2 messaging.
- **Frontend:** Events tab rebuilt on Phase 3's `Sidebar` + grid components; full-page hero slider reusing Phase 3's hero carousel, sourced from approved `EventMedia`; event detail page with a "Get Directions" button deep-linking to `https://www.google.com/maps?q={lat},{lng}`; a submission flow (customer or business) using the same simulated one-time-payment pattern, priced by `visibility_days`, with an `access_level` toggle (public/private) at creation time. Private-event tiles in the grid show a lock indicator instead of the normal preview and, on click, prompt a code-entry step (simple input + submit against the unlock endpoint) before routing to the full detail page; the organizer's own dashboard/"my events" view surfaces the `access_code` prominently (copy-to-share) next to any private event they created.
- **Dependency:** Phase 1 (`kind=event`), Phase 2's pattern (approval queue shape), Phase 3 (`Sidebar`/hero components), Phase 4/5's payment ledger pattern.

**Needs sketching before coding:**
- The brief says events "automatically hide or delete" once paid days elapse — ambiguous between a hard delete and a soft-hide (`status=expired`). This decision must be made before writing `expire_events`, since it determines whether `EventMedia` files get cleaned up from disk at the same time or retained for records/appeals.
- `access_code` lifecycle: is it fixed for the event's lifetime, or can the organizer regenerate it (e.g. to revoke a previously-shared code)? Regeneration is the safer default (matches how invite-links/API-keys are normally handled) but needs an explicit "regenerate code" action if so.

---

## Phase 7 — RSVP / Attendee System

**Goal:** real attendee registration on events — logged-in users can RSVP, organizers see a live attendee list and count. This is the confirmed source of the "RSVP number" that Phase 6's public/private gating already treats as a restricted field on private events.

- **Backend:** new `EventRSVP` model: `event` FK, `customer` FK (the marketplace end-user account — the same `Customer` referenced by Phase 4's `Cart`), `status` (`going`/`cancelled`, default `going` — start binary, see open question below on whether an `interested` tier is worth the extra complexity), `rsvp_at`, `updated_at`; `unique_together (event, customer)` so a user has one row per event and toggling status updates it in place rather than duplicating rows. `Event` gets an optional organizer-set `capacity` (nullable = unlimited) — RSVP creation is rejected once `going` count hits `capacity` (no waitlist in this phase). `Event.going_count` (introduced in Phase 6) is kept in sync on every RSVP create/cancel, inside the same transaction, so the list/teaser endpoint can show a live count without a `COUNT()` per row. New endpoints: `POST /api/events/{id}/rsvp/` (create-or-update the caller's own row), `DELETE /api/events/{id}/rsvp/` (cancel), `GET /api/events/{id}/rsvps/` (organizer/staff-only, paginated attendee list with contact info). For `access_level=private` events, `POST /rsvp/` requires the same unlocked-via-code state as viewing the detail page — no RSVP-ing to an event you haven't unlocked. RSVP-ing requires a logged-in customer account, which assumes Phase 1 of `docs/PROJECT_SCOPE.md`'s real auth is already live; there is no anonymous RSVP.
- **Frontend:** event detail page gets an RSVP section ("I'm Going" / "Can't Go" toggle reflecting the caller's current status, live attendee-count badge, a "this event is full" state once `capacity` is hit). The organizer's event-management view gets an "Attendees" tab — live list by status, same access the organizer already has to `access_code`/full detail regardless of `access_level`. New hooks: `useEventRSVP(eventId)` (current user's status + mutate) and `useEventAttendees(eventId)` (organizer-only list), following the existing `hooks/` plain-mutation-in-handler convention (no `useMutation` wrapper, per `CLAUDE.md`'s documented pattern).
- **Dependency:** Phase 6 (the `Event` model, approval flow, and public/private gating must exist first — RSVP is additive on top of a working event record and reuses its access-code gating for private events).

**Needs sketching before coding:** whether v1 needs an `interested` status distinct from `going`/`cancelled` (recommend starting binary — simpler UI, easy to extend later without a migration that breaks existing rows), and whether `capacity` needs a waitlist in v1 or can just hard-stop at the limit (recommend hard-stop first, waitlist as a later refinement if organizers ask for it).

---

## Summary sequencing

```
Phase 1 (data foundations)
     │
     ▼
Phase 2 (hero media approval) ──────────────┐
     │                                       │
     ▼                                       │
Phase 3 (business tab redesign) ─────────────┤
     │                    │                  │
     ▼                    ▼                  ▼
Phase 4 (cart/checkout)  Phase 6 (events platform, also needs Phase 1/2/3 patterns)
     │                                       │
     ▼                                       ▼
Phase 5 (promotion/boost) —              Phase 7 (RSVP / attendee system)
can run parallel with Phase 6
once Phase 4's ledger lands
```

Real Hubtel payment integration (`docs/HUBTEL_INTEGRATION.md`) can be cut over at any point after Phase 4 exists, replacing every simulated-pay step above (hero extensions, checkout, promotion/boost purchase, event submission fee) in one pass, the same way `docs/PROJECT_SCOPE.md` §5b already plans to swap `MoMoPayment`/`MoMoModal` from simulated to real. RSVP (Phase 7) is free/unpaid in this roadmap and untouched by that cutover.

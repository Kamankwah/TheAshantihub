# Design: Listing Model & Marketplace Content Backend

**Date:** 2026-07-09
**Status:** Approved, not yet implemented
**Sub-project:** Backend Phase 1 remainder (`docs/PROJECT_SCOPE.md` §5a Days 3-4: Business/Listing models + admin approval queue), scoped and brainstormed as a standalone unit after the roles/registration/KYC sub-project (`docs/superpowers/specs/2026-07-09-roles-registration-kyc-design.md`) landed.

## 1. Background & scope

The frontend (`App.jsx`) currently renders the entire marketplace from two hardcoded constants: `CATEGORIES` (15 fixed categories with id/icon/label/color) and `LISTINGS` (an object keyed by category id, each holding an array of business entries — name, rating, price, description, phone, lat/lng, zone, photos). This spec defines the backend data model and API that will eventually replace that mock data, continuing directly from the `BusinessOwner`/`BusinessOwnerProfile`/RBAC foundation the KYC sub-project built.

**Out of scope for this spec** (deliberately deferred, each to its own future sub-project):
- Phone-OTP authentication (orthogonal to listings; a separate backend sub-project).
- Actually wiring `App.jsx` to call these new endpoints instead of reading `LISTINGS`/`CATEGORIES` (frontend work, may coordinate with the separate `docs/FRONTEND_MODERNIZATION.md` track).
- Reviews (`MOCK_REVIEWS`, ratings, review submission) — belongs to `docs/PROJECT_SCOPE.md` §5a Day 5 ("in-app inbox + reviews"), not Day 3-4.
- Escrow/payment logic — sub-project 2 of the dashboards/RBAC/escrow initiative, unaffected by this spec.

## 2. Data model

A new `listings` Django app (sibling to `core` and `accounts`), matching the existing one-app-per-domain pattern.

```
Category
  id
  slug                # e.g. "hotels" — matches current CATEGORIES ids, used in URLs/filters, unique
  icon                # emoji, e.g. "🏨"
  label               # "Hotels"
  color               # hex string, e.g. "#C9A227"

Zone
  id
  name                # e.g. "Manhyia", "Citywide" — unique. No "All Zones" row; that stays a
                       # frontend-only filter option meaning "no zone filter applied", not a real zone.

Listing
  id
  business_owner       # FK -> accounts.BusinessOwner (many listings per owner)
  category             # FK -> Category
  zone                 # FK -> Zone
  name
  description
  price_amount         # decimal, nullable (some listings are "Open 24hrs"/"Market Rate" — no numeric price)
  price_unit           # e.g. "/night", "/person", nullable
  tag                  # short badge string, e.g. "Featured", "Popular" — free text
  contact_phone        # defaults to business_owner.profile.business_contact_phone at creation, editable per listing
  lat, lng             # decimal, nullable
  main_photo           # ImageField, nullable until owner uploads
  status               # draft | pending_review | published | rejected
  rejection_reason     # nullable, set when status = rejected
  created_at, updated_at

ListingPhoto           # gallery, additional to main_photo
  id
  listing              # FK -> Listing
  image                # ImageField
  order                # small int, for gallery ordering
```

**Constraints:**
- `Listing.status` starts at `draft`. Owner may freely edit while `draft`, `pending_review`, or `rejected`. Editing is blocked (400) once `published` — matches the existing "no self-service edit of a verified/live record" principle used for KYC profiles.
- Submitting a listing (`draft → pending_review`) is **not** gated on the owner's `kyc_status` — moderation content review can proceed in parallel with KYC review.
- **Approving a listing (`pending_review → published`) is blocked (400) unless `business_owner.kyc_status == "verified"`** — nothing goes live before both the identity and the content have cleared, but neither blocks the other from *starting*.
- Rejecting requires a non-blank `reason` (server-side validated — the KYC-reject endpoint from the prior sub-project allows a blank reason; this spec closes that gap for listings from the start rather than carrying it forward).
- `main_photo` is not required to submit for review — a listing can move `draft → pending_review` with no photo at all. A moderator who considers a photo-less listing unacceptable rejects it with a reason (e.g. "add a photo") like any other content judgment call, rather than the system hard-blocking submission.
- The public browsing endpoint only ever returns `status == "published"` listings — draft/pending_review/rejected listings 404 even by direct ID guess from an unauthenticated or non-owning caller.
- `Category`/`Zone` creation/editing requires the matching permission (see §3); reads are public.

## 3. RBAC additions

Reuses the existing `HasRolePermission` class and the already-seeded `listings.moderate` permission (granted to `admin`/`super_admin`) for moderation — no new machinery there.

One new permission is added to the seed data:
- **`zones.manage`** — granted to `admin` and `marketing` (super_admin has it automatically, as with every permission). Mirrors the existing `categories.manage` permission (which stays granted to `marketing` only, unchanged from the prior sub-project's seed — `admin` was deliberately *not* added to `categories.manage`, only to `zones.manage`, per an explicit choice made during brainstorming).

## 4. API endpoints

**Public (no auth):**
- `GET /api/listings/categories/` → list of categories
- `GET /api/listings/zones/` → list of zones
- `GET /api/listings/` → published listings only; supports `?category=<slug>`, `?zone=<name>`, `?search=` (name/description), `?min_price=`/`?max_price=`, `?ordering=price_amount`
- `GET /api/listings/<id>/` → published listing detail (404 if not published)

**Business owner (authenticated, must own the listing):**
- `POST /api/listings/mine/` → create a draft listing
- `GET /api/listings/mine/` → list own listings (any status)
- `PATCH /api/listings/mine/<id>/` → edit own listing (blocked once `published`)
- `POST /api/listings/mine/<id>/submit/` → `draft`/`rejected` → `pending_review`
- `POST /api/listings/mine/<id>/photos/` → add a gallery photo
- `DELETE /api/listings/mine/<id>/photos/<photo_id>/` → remove a gallery photo

**Staff (requires `listings.moderate`):**
- `GET /api/listings/moderation/pending/` → `pending_review` queue
- `GET /api/listings/moderation/<id>/` → full detail for review (any status)
- `POST /api/listings/moderation/<id>/approve/` → `published` (400 if owner not KYC-verified)
- `POST /api/listings/moderation/<id>/reject/` with `{"reason": "..."}` → `rejected` (400 if reason blank)

**Staff (requires `categories.manage` / `zones.manage` respectively):**
- `POST /api/listings/categories/` → create a category
- `POST /api/listings/zones/` → create a zone

## 5. Implementation notes

- **Filtering:** no new dependency. DRF's built-in `SearchFilter`/`OrderingFilter` plus a few manual query-param lines in `get_queryset()` handle all four filter types (category, zone, search, price range/sort) — the filter surface is small enough that `django-filter` would be more machinery than the problem needs.
- **Ownership enforcement:** a new `IsListingOwner` permission class, shaped exactly like the existing `IsBusinessOwner` (`accounts/views.py`) — checks `request.user == listing.business_owner` server-side on every `mine/` endpoint.
- **Photo storage:** reuses the existing Pillow + local `MEDIA_ROOT` pattern already established for `BusinessOwnerProfile`'s Ghana Card images — no new infrastructure.

## 6. Testing considerations

Following the same TDD pattern as the RBAC/KYC sub-project — one test file per concern:
- `test_listing_models.py` — status defaults, field constraints.
- `test_listing_crud.py` — owner create/edit/submit, ownership enforcement (one owner can't touch another's listing), edit-blocked-once-published.
- `test_listing_moderation.py` — pending queue, approve (including the KYC-verified gate), reject (including the non-blank-reason requirement), resubmission after rejection.
- `test_listing_photos.py` — gallery add/remove, ordering.
- `test_category_zone_management.py` — permission checks for `categories.manage`/`zones.manage`, including that `admin` can manage zones but not categories.
- `test_public_browsing.py` — published-only visibility, all four filter types, 404 on non-published direct ID access.

Run via the existing `docker compose run --rm web python manage.py test listings`.

## 7. Open questions

None — all decisions in this spec were confirmed during brainstorming (2026-07-09).

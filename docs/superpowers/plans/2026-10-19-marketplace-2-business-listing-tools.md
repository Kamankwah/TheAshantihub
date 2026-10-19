# Marketplace Plan 2 — Business Listing Tools and Ashanti Direct — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A business can give a product variants (flavour, size, each with its own price and stock; a shopper buys several variants with a quantity each in one purchase), attach up to 9 images and 2 videos, edit an approved listing while the approved version stays live (only price and stock go live at once, everything else waits for staff approval), Drop (reversible hide) or Discontinue (permanent, old orders still show it) a listing, put a listing on discount, and request sponsored ads from one promotion hub (hero-ad submission is Plan 1's). Public business, product, service, stay and event pages show only what the listing really offers. Ashanti Direct, a normal company-owned business run by Operations, uses the same tools, the same fee, wallet and payout rules, and is filterable as "Sold by Ashanti Direct".

**Architecture:** `Listing.status` gains `dropped` and `discontinued`, so every existing `status=PUBLISHED` public query drops those listings with no new filter. A new `ListingVariant` row owns price and stock; the listing keeps a derived `stock_quantity` (sum of its tracked variants) and a "from" `price_amount`, so every existing reader (sold-out hiding, catalogue stock cover, search, ledger) keeps working. Cart and order lines gain a nullable `variant`; checkout reserves variant stock under row locks and `_fail_order_checkout` returns it. Editing an approved listing creates a `ListingRevision` (a moderated queue that follows backend/CLAUDE.md's contract) holding the proposed changes, staged media and variant structure; the listing row is untouched until approval, and `apply_revision` copies it over in one transaction. Price and stock (listing and variant) are the only live edits and go through narrow endpoints. Discounts are `ListingDiscount` rows with an append-only `ListingPriceHistory` for the honest 7-day "was" price. Ashanti Direct is a `BusinessOwner` with `is_company=True` (one row), served by the existing owner views mounted a second time under `/api/direct/` and gated by a new staff permission `direct.operate`; no ledger, fee or wallet code branches on it.

**Tech Stack:** Django 5.2, DRF, Postgres, Celery (eager under `manage.py test`), ffmpeg/ffprobe in the backend image, React (flat layout, inline `C`/`D` palette), React Query, Vitest + MSW.

**Spec:** `docs/superpowers/specs/2026-10-19-marketplace-rebrand-design.md` — "Plan 2", Constraints, "Decisions from the builder check" (price history from now; discount is a sale price; departments seen by a lister are the full tree). Deviations and builder's calls are in section 0.

**Depends on:**
- **Plan 1 (opening-day storefront):** (a) the opening gate: checkout is already refused for shoppers before 6 Nov and this plan must not bypass it (Task 3 changes `OrderCheckoutView` but keeps the gate call Plan 1 adds, first); (b) business hero-ad submission and video-in-hero. Plan 2 reuses it: the promotion hub (Task 9) only links to Plan 1's submit screen and adds no second hero endpoint. If Plan 1 created a video conversion helper (look for `backend/core/video.py`), Task 5 reuses it and writes only the listing glue; if not, Task 5 creates it and Plan 1's hero video then reuses ours; (c) Plan 1's Deals strip and 7-day "was" rule read `listings/pricing.py`. If Plan 1 shipped a stub there, Task 8 extends it; it does not replace it. (d) the new departments and categories: Plan 2 never edits categories, and the lister's "full tree" is whatever `CategoryListView` returns after Plan 1.
- **Plan 3 (staff listing pipeline):** Plan 3 generalises "never approved by the person who created it" and the owner-confirmation link. Task 4 adds the one guard Plan 2 needs (`created_by_staff` cannot approve) so Ashanti Direct is safe on its own; Plan 3 must call the same helper, `listings.revisions.cannot_decide`. Plan 3's Super Admin purchase-count columns read `OrderItem` (paid/refunded) and are unaffected by the new `variant` column. Plan 3's scouts list for clients through the same `listings.services` functions this plan extracts in Task 2; nothing here blocks Plan 3.
- **Plan 4 (product, cart, checkout and account pages):** Plan 4 restyles the product page and owns the shopper variant picker and its gallery, zoom and video playback. Plan 2 ships only a plain functional version (Task 10: variant rows with a quantity stepper, a plain image/video strip) so variants and media are usable before Plan 4 and Plan 4 replaces the markup, not the API. Plan 4's cart and checkout screens read `variant_label` and `variant` from the cart and order serializers this plan adds (Task 3).

## 0. Decisions and reconciliation with the code

| # | Question | Decision | Why (grounded in the code) |
|---|---|---|---|
| V1 | Where variant price and stock live | New `listings.ListingVariant` (`listing`, `label`, `attributes` JSON, `price_amount`, `stock_quantity` null = untracked, `position`, `is_active`). `Listing.price_amount` becomes the lowest active variant price and `Listing.stock_quantity` the sum of tracked variant stocks (None if any active variant is untracked), both rewritten by `listings.variants.sync_listing()` after any variant change. | `sold_out_q()`, `catalogue/stock.py`, `marketplace/listings.py`, `ledger/escrow._vendor_groups` and search all read the listing's own price and stock. Deriving them keeps every reader correct without touching it. A listing with variants has no price of its own to edit. |
| V2 | Removing a variant | Never deleted once any cart or order line points at it: set `is_active=False`. A variant a shopper already bought still shows on the old order through `OrderItem.variant_label`. | `OrderItem.listing` is `PROTECT`; old orders must show what was bought. |
| V3 | Cart line identity | `CartItem.variant` nullable. `unique_listing_per_cart` is replaced by two conditional constraints: one line per (cart, listing) where `variant` is null, one per (cart, variant) where it is not. A variant listing refuses a line without a variant (400). | The existing constraint would let a shopper hold only one variant per listing, which the spec forbids. |
| V4 | Flash sales on variant listings | Not eligible in this plan: `marketing.flash_sales.eligibility_problem` returns "Has variants: choose a single-price listing." Discounts (Task 8) work on variants. | A flash sale row stores one `normal_price`/`sale_price` per listing; applying it to variants with different prices would invent prices. |
| V5 | Edit approved listing: what is live at once | Only `price_amount`/`price_unit` and stock (listing `stock_quantity` for a no-variant listing; a variant's `price_amount` and `stock_quantity`). Everything else goes through a `ListingRevision`, **including fields today's `PATCH /mine/<id>/manage/` lets through** (`tag`, `contact_phone`, `specs`, `service_duration`, the warranty/expiry/return/brand/condition/dimensions/weight/barcode fields). This is a deliberate narrowing of `OwnerListingManageSerializer`; `test_listing_manage.py` is updated and says why. | Spec: "Price and stock changes go live at once; every other change needs approval again." `contact_phone` and the decision fields are in `PublicListingSerializer`, so a shopper sees them. |
| V6 | Revision shape | `ListingRevision` (status `draft`, `pending`, `approved`, `rejected`) with `changes` JSON (scalar fields), `variants` JSON (structure ops), `remove_photo_ids`, `remove_video_ids`, `new_main_photo`; staged `ListingPhoto`/`ListingVideo` rows carry a `revision` FK and are hidden from the public until approval. One open (draft or pending) revision per listing (partial unique constraint). `draft` is outside the queue so an owner can add several images before sending; `pending`/`approved`/`rejected` follow the moderated-queue contract. A rejected revision is edited again in place (back to draft). | backend/CLAUDE.md "Moderated-queue contract". `Listing` itself has the same draft-then-submit shape (`ListingSubmitView`). |
| V7 | Revision never touches price or stock of rows that exist | On apply, existing variants' price and stock are ignored; only variants the revision creates take their initial price and stock from it. | Otherwise a stale revision could overwrite a live price or stock edit made while it waited. |
| V8 | Image and video limits | A listing holds at most 9 images in total (main photo + gallery), 5 MB each, and at most 2 videos in total (uploaded or YouTube). Counts include staged rows and exclude ones queued for removal. Upload video: at most 100 MB and 60 s (checked by `ffprobe` before accepting), converted by ffmpeg to H.264/AAC MP4 (`faststart`, 720p cap) in a Celery task. YouTube: only the 11-character id is stored. | Spec "Media". The conversion tool is left to the builder; ffmpeg is the standard choice and must be added to `Dockerfile` and `Dockerfile.prod`. |
| V9 | Drop and Discontinue | New `Listing.status` values `dropped` (restore returns to `published`, no re-approval, because nothing about the content changed) and `discontinued` (final; no way back). Only a published or dropped listing can be dropped, only a published, dropped, draft or rejected one discontinued. Discontinue deletes any open revision. Both free the plan's active-listing slot (it counts `PUBLISHED`). Checkout refuses any cart line whose listing is not `PUBLISHED` or whose business is hidden (`hidden_business_q`), rolling nothing back. | Every public query already filters `status=PUBLISHED` (grep: `listings/views.py`, `marketplace/`, `catalogue/`, `messaging/`, `credit/scoring.py`), so no query needs a new `exclude`. `marketplace/listings.py` `state_of()` has no label for the new statuses and would call them "draft"; Task 1 fixes it. |
| V10 | Discount | `ListingDiscount` (`listing`, optional `variant`, `sale_price`, `regular_price`, `starts_at`, `ends_at` nullable, `ended_at`). Goes live at once (no approval; spec: "Discounts go live at once"). The seller funds it; no platform subsidy, so `Order.discount_amount` (coupons) is not used. The cart snapshot takes the effective price at add time, as today (carts already keep their add-time price). `ListingPriceHistory` records every regular-price change from now. The struck-through "was" price shows only when the regular price was held for the 7 days before the discount started (`pricing.was_price`). | Spec: "a discount is a sale price on the listing", "honest discounts", CLAUDE.md "No fabricated data". |
| V11 | Sponsored ads and "free until priced" | `ListingPromoteView` currently charges a simulated `Transaction` (`PROMOTION_DAILY_RATES`). A new `settings.PROMOTION_PRICING_ENABLED` (env, default **off**) makes the amount 0 and writes no `Transaction` while off. Approval stays the existing `PromotionApproveView` (`promotions.manage`). The hub also shows existing owner tools (free-delivery promos, flash-sale invitations) read-only-linked, not rebuilt. | `listings/views.py` `ListingPromoteView`, `marketing/urls_promos.py` `owner/flash-sales/`, `DeliveryPromosPanel.jsx`. |
| V12 | Ashanti Direct identity | `BusinessOwner.is_company` (default False; at most one True: unique partial index). Created by the idempotent command `ensure_ashanti_direct`: KYC-verified, a real company phone and email, a random password hash that **Operations never holds** (a Super Admin sets and keeps it), so wallet withdrawals follow the normal holder flow (step-up codes go to the company phone) and no one gets a payout shortcut. Business kind: `product` (the registered kind is not a restriction for Direct: see V14). | `BusinessOwner` has no company concept; the ledger posts per owner (`posting.account_for(Account.VENDOR_PENDING, owner)`), fee snapshots per owner and category (`ledger/escrow.py`), so a plain owner row gets identical money behaviour. |
| V13 | How Operations operates it | One new staff permission `direct.operate` (seeded to `operations` and `super_admin`; effective permissions already honour role + extra − revoked). The owner views (`OwnerListingCreateListView`, manage, restock, variants, revision, media, discounts, promote, drop) take a `scope` init kwarg; `listings/urls_direct.py` mounts them at `/api/direct/listings/...` with `scope="direct"`, whose actor is a staff user and whose owner is `accounts.direct.ashanti_direct()`. Writes by staff are recorded by `StaffActivityMiddleware` with no extra work. | backend/CLAUDE.md: "a new staff endpoint is covered automatically"; `Listing.created_by_staff` already exists for staff-made listings. |
| V14 | Business-kind and subscription checks for Direct | `validate_listing_for_owner` skips the `business_kind` restriction and the subscription/plan-cap checks when `owner.is_company`. This is not a fee or payout exemption: Direct sells across kinds and does not subscribe. | Those checks read `profile.business_kind` and `owner.subscription`, which a company seller has no reason to hold. |
| V15 | Maker-checker | A staff member cannot approve a listing or a revision whose `created_by_staff` is themselves (403). Applied in `ModerationApproveView` and the new revision approve. Direct listings are therefore approved by a different Operations user, the GM or a Super Admin. | Spec anti-goal "a staff member approving their own listing"; Plan 3 generalises. |
| V16 | Dashboard "page designs" | Delivered as kind-aware sections, not four new templates: a listing/seller/event page renders a section only when the listing really has it (variants, media, specs, warranty, what's-included, units, tickets), and an empty section renders nothing. The "business page" is a new public seller page `/seller/:id` (Task 10). | `ListingDetailPage.jsx` already switches on `category.kind` (PRODUCT_TABS / SERVICE_TABS). CLAUDE.md "honest empty state". Plan 4 restyles the product page. |

## Global Constraints

- Commands: backend `docker compose run --rm web python manage.py test <label> --noinput` (the service is `web`); frontend from `frontend/`: `npx vitest run <file>`. Never run Vitest from the repo root. Never two docker commands at once. No deploy and no promotion; staging only, on the owner's say (CLAUDE.md GOLDEN RULE).
- Migrations are generated (`makemigrations`), one per model task, numbered after the newest in each app at build time: `listings` (after `0021`), `cart` and `orders` (Task 3), `accounts` (`is_company`, `direct.operate` seed, after the newest, `0054` today).
- **Moderated-queue contract** (backend/CLAUDE.md): `ListingRevision` keeps `.../pending/`, a module-level `REVISION_STATUS_MAP`, `?status=` defaulting to `pending` and falling back to pending on an unknown value, pending oldest-first, history `-reviewed_at` with `-created_at` fallback, approve and reject set `reviewed_by`/`reviewed_at`, `.../<pk>/re-review/` 400s unless rejected and clears the reason and reviewer pair.
- **Stock is reserved at checkout, not at payment** (backend/CLAUDE.md). Variant stock follows the same rule, locks the listing row first and then its variant rows in primary-key order, and `_fail_order_checkout` returns it. A `None` stock is untracked and never decremented.
- **Owner-scoped isolation:** every owner endpoint resolves the owner (`request.user` for a business, the company owner for `direct`) and 404/403s on another business's listing, variant, revision, photo, video or discount. `GET /api/orders/owner/` must still show only the caller's own lines; a variant line is the caller's line.
- Money: `Decimal` with 2 places in the API (as `price_amount` today); fees and ledger are untouched and read `OrderItem.line_total`. **No code outside `accounts/direct.py` and the permission seed may mention `is_company`** other than the serializer badge field and the `sold_by` filter; a test greps the `ledger/`, `wallets/`, `payments/` and `billing/` packages for it.
- Public data: the public serializers never show staged media, a pending revision, a dropped or discontinued listing, or an inactive variant. No direct business-to-customer contact is added anywhere (CLAUDE.md Product rules); a seller page shows the business name and listings only, no phone, WhatsApp or chat.
- Honest UI: a "was" price, a rating, a stock count or a "Sold by" appears only when the backend really has it; empty states say so. Read `DESIGN.md` before any visual decision; palette from `theme.js` `C` and `components/dashboard/theme.js` `D`, inline styles, `components/**` never import `App.jsx`, mutations are plain `apiPost`/`apiPatch`/`apiDelete` + `refetch()` (frontend/CLAUDE.md).
- `BusinessDashboard.test.jsx` is a behavioural contract: change only the assertions Task 7 names, and say why in the commit message.
- Style: module docstrings, plain words in user-facing text, tests under each app's `tests/`, new backend modules small and named for what they do.

## Review Focus

1. **The approved version stays live during an edit.** A published listing with a pending revision still serves its old name, description, photos and variants publicly; only price and stock edits change it at once; approval swaps everything in one transaction. Pinned in Task 4 (`test_review_focus_public_detail_is_unchanged_while_a_revision_is_pending`, `test_review_focus_only_price_and_stock_are_live_edits`) and Task 5 (`test_review_focus_staged_media_is_not_public`).
2. **A stale revision cannot overwrite a live price or stock edit** (Task 4 `test_review_focus_apply_never_touches_price_or_stock_of_existing_rows`).
3. **Variant stock never oversells and always comes back.** Two checkouts of the last unit at once: one wins; a failed payment returns the variant stock; the derived listing stock matches. Pinned in Task 3.
4. **Fees and money are identical for variant lines and for Ashanti Direct.** The fee snapshot for a two-variant order equals one for the same total as a single line; a Direct order gets the same snapshot as a partner's; no money package mentions `is_company` (Tasks 3 and 11).
5. **Drop and Discontinue.** A dropped listing vanishes from every public surface and cart checkout but returns on restore without re-approval; a discontinued one never returns and old orders still show it; a cart line for either is refused at checkout (Task 1).
6. **A business can touch only its own rows**, and a Direct operator only Ashanti Direct's (Tasks 2, 4, 5, 8, 11).
7. **Maker-checker:** the staff member who created a listing or revision cannot approve it (Task 4, repeated for Direct in Task 11).
8. **Media limits are enforced on the server:** 9 images, 5 MB, 2 videos, 100 MB, 60 s, YouTube id shape; a failed conversion ends `failed` with fixed text and the listing is never stuck (Task 5).
9. **Honest discounts:** "was" shows only after 7 held days; a discount ending stops affecting new carts; a variant discount prices only that variant (Task 8).
10. **Switches-off regression:** with `PROMOTION_PRICING_ENABLED` off a promotion costs 0 and writes no `Transaction`; with Plan 1's opening gate closed, shopper checkout is still refused (Tasks 3 and 9).

## Assumptions made (builder's calls, cheap to change; owner may overrule)

- **B1** The 9 images include the main photo.
- **B2** `contact_phone` and the decision fields need re-approval (V5), although today they do not.
- **B3** Ashanti Direct hero ads are Marketing's own day-one slides (Plan 1); Operations does not submit hero ads for Direct.
- **B4** A discount needs no end date (optional), at least 1% and at most 90% off, and only one live discount per listing (or per variant).
- **B5** A listing with variants cannot join a flash sale (V4).

---

## Task 1: Drop and Discontinue (backend)

**Files:**
- Modify: `backend/listings/models.py` (`Listing.STATUS_CHOICES`: add `DROPPED = "dropped"`, `DISCONTINUED = "discontinued"`; fields `dropped_at`, `discontinued_at`); migration generated.
- Create: `backend/listings/lifecycle.py` (`drop`, `restore`, `discontinue`, `LifecycleError`).
- Modify: `backend/listings/views.py` (create `ListingDropView`, `ListingRestoreView`, `ListingDiscontinueView`), `backend/listings/urls.py` (`mine/<pk>/drop/`, `restore/`, `discontinue/`).
- Modify: `backend/marketplace/listings.py` (`STATUSES`, `state_of` labels "dropped" / "discontinued"), `backend/orders/views.py` (`OrderCheckoutView`: refuse unavailable lines), `backend/listings/serializers.py` (`OwnerListingSerializer` exposes `dropped_at`, `discontinued_at`; `validate_listing_for_owner` refuses edits to a dropped or discontinued listing).
- Test: `backend/listings/tests/test_listing_lifecycle.py`, `backend/orders/tests/test_checkout_unavailable_lines.py`, extend `backend/marketplace/tests/` listings state test.

**Interfaces:**
- `lifecycle.drop(listing)`, `restore(listing)`, `discontinue(listing)` — each runs under `select_for_update`, raises `LifecycleError(message)` (view answers 400 `{"status": message}`); `discontinue` deletes the listing's open `ListingRevision` (Task 4; guard the import so Task 1 stands alone: `getattr` on the related manager).
- `POST /api/listings/mine/<pk>/drop|restore|discontinue/`, owner only (`IsListingOwner`), empty body, answers `{"id", "status"}`.
- `OrderCheckoutView` answers 400 `{"detail": "“<name>” is no longer available. Remove it from your cart.", "code": "listing_unavailable"}` for any line whose listing is not `PUBLISHED` or whose business is hidden, before reserving stock.

- [ ] **Step 1: Write failing tests** in `test_listing_lifecycle.py`: `test_drop_hides_a_published_listing_from_every_public_view` (list, detail, related, cart add all exclude it), `test_restore_returns_it_without_re_approval` (status back to `published`, `reviewed_by` unchanged), `test_only_published_can_be_dropped`, `test_discontinue_is_permanent_and_cannot_be_restored`, `test_discontinue_a_draft_or_rejected_listing_is_allowed`, `test_another_owner_cannot_drop` (404/403), `test_a_dropped_listing_refuses_edits_and_submit`, `test_review_focus_old_orders_still_show_a_discontinued_listing` (create a paid order with the listing, discontinue, `GET /api/orders/<id>/` still lists the line and `listing_name`), `test_dropped_listing_does_not_count_against_the_plan_limit`. In `test_checkout_unavailable_lines.py`: `test_checkout_refuses_a_dropped_line_with_listing_unavailable_and_reserves_no_stock`, `test_checkout_refuses_a_hidden_business_line`. In the marketplace test: `test_state_of_labels_dropped_and_discontinued` (note the existing helper is `state_of`).
- [ ] **Step 2: Run to see failures:** `docker compose run --rm web python manage.py test listings.tests.test_listing_lifecycle orders.tests.test_checkout_unavailable_lines marketplace --noinput`.
- [ ] **Step 3: Implement** the model change, `makemigrations listings`, `lifecycle.py`, views and URLs, the `state_of` labels, the checkout guard (placed after Plan 1's opening-gate check and before the stock loop), and the serializer/validator edits.
- [ ] **Step 4: Run to pass**, then the neighbours: `... test listings orders marketplace cart --noinput`.
- [ ] **Step 5: Commit** `feat(listings): drop (reversible) and discontinue (permanent) a listing`.

---

## Task 2: Variants — model, owner API, live price and stock, public read

**Files:**
- Modify: `backend/listings/models.py` (create `ListingVariant`), migration generated.
- Create: `backend/listings/variants.py` (`sync_listing`, `set_live`, `VariantError`), `backend/listings/services.py` (the owner-side create/update helpers extracted from `OwnerListingCreateListView`/`OwnerListingSerializer` so Plan 3's scouts and Task 11 reuse them; thin, no behaviour change).
- Modify: `backend/listings/serializers.py` (create `ListingVariantSerializer`; `OwnerListingSerializer` and `PublicListingSerializer` gain `variants` and `has_variants`; `PublicListingSerializer` lists only active variants), `backend/listings/views.py` (create `ListingVariantListCreateView`, `ListingVariantLiveView`; `ListingManageView` / `ListingRestockView` refuse a variant listing with 400 `{"detail": "Edit each variant's price and stock."}`), `backend/listings/urls.py`.
- Test: `backend/listings/tests/test_listing_variants.py`.

**Interfaces:**
- `ListingVariant(listing FK related_name="variants", label CharField(100), attributes JSONField(default=dict), price_amount Decimal(10,2), stock_quantity PositiveInteger null, position, is_active, created_at)`; `label` unique per listing among active rows; at most 40 variants per listing; `attributes` is `{"flavour": "Vanilla", "size": "500 g"}` with at most 4 keys, string values (the label is built from it when blank).
- `variants.sync_listing(listing)` — sets `price_amount = min(active prices)`, `stock_quantity = sum(...)` or `None` if any active variant is untracked or there are none; also writes `ListingPriceHistory` once Task 8 exists (call site is already here: `pricing.record_price` is imported lazily).
- `POST/GET /api/listings/mine/<pk>/variants/` (create on a **draft or rejected** listing, owner only; on a published listing structure changes go through a revision, Task 4, and this endpoint answers 400 `{"detail": "Changes to a live listing are sent for approval."}`); `PATCH /api/listings/mine/<pk>/variants/<vid>/live/` body `{"price_amount"?, "stock_quantity"?, "add"?}` for a published listing: the only live variant edit (price and stock).

- [ ] **Step 1: Write failing tests**: `test_owner_adds_variants_to_a_draft_listing`, `test_listing_price_and_stock_are_derived_from_variants` (from-price, summed stock, `None` when one variant is untracked), `test_variant_price_must_be_positive_and_labels_unique`, `test_at_most_forty_variants`, `test_public_detail_lists_only_active_variants_and_hides_none_staged`, `test_review_focus_live_edit_changes_only_price_and_stock_and_resyncs_the_listing`, `test_live_edit_refuses_any_other_field` (a `label` in the body is a 400), `test_manage_and_restock_refuse_a_variant_listing`, `test_another_owner_cannot_touch_a_variant` (404), `test_sold_out_hiding_uses_the_derived_stock` (all variants at 0, `SOLD_OUT_HIDDEN_ENABLED` on: listing leaves search).
- [ ] **Step 2: Run to see failures:** `docker compose run --rm web python manage.py test listings.tests.test_listing_variants --noinput`.
- [ ] **Step 3: Implement** the model and migration, `variants.py`, `services.py` extraction (existing `test_listing_crud.py` must stay green untouched), serializers, views, URLs.
- [ ] **Step 4: Run to pass** the new tests, then `... test listings catalogue marketplace --noinput`.
- [ ] **Step 5: Commit** `feat(listings): product variants with their own price and stock`.

---

## Task 3: Variants in the cart, checkout, orders and promotions

**Files:**
- Modify: `backend/cart/models.py` (`CartItem.variant` FK null; replace `unique_listing_per_cart` with `unique_novariant_listing_per_cart` and `unique_variant_per_cart`), `backend/cart/serializers.py` (`CartItemSerializer` adds `variant`, `variant_label`; `CartItemCreateSerializer` accepts `variant` or `lines: [{variant, quantity}]`), `backend/cart/views.py` (`CartItemCreateView.post`), migration generated.
- Modify: `backend/orders/models.py` (`OrderItem.variant` FK null `PROTECT`, `variant_label` CharField blank), `backend/orders/serializers.py` (items show `variant_label`; `OwnerOrderSerializer` lines too), `backend/orders/views.py` (`OrderCheckoutView`: reserve variant stock; copy variant onto `OrderItem`), migration generated.
- Modify: `backend/payments/services.py` (`_fail_order_checkout`: also return variant stock from `reservation["variant_id"]`; old sessions without the key behave as before), `backend/marketing/checkout.py` (`Line` gains `variant`; `_flash_lines` passes it through; `create_lines` writes it), `backend/marketing/flash_sales.py` (`eligibility_problem`: variant listings refused, V4).
- Test: `backend/cart/tests/test_variant_cart.py`, `backend/orders/tests/test_variant_checkout.py`, extend `backend/marketing/tests/` flash-sale eligibility.

**Interfaces:**
- `POST /api/cart/items/` with `{"listing": id, "lines": [{"variant": id, "quantity": n}, ...]}` adds all lines or none (one transaction under the existing cart lock; `guard.check_add` runs once per listing as today); each line's `unit_price_snapshot` is `listings.pricing.effective_price(listing, variant)` once Task 8 exists, the variant's `price_amount` until then. A variant listing without `variant`/`lines`, a variant of another listing, or an inactive one: 400. Cart responses return each line with `variant` and `variant_label`.
- Stock reservation block in `OrderCheckoutView`: for a variant line lock `Listing` then `ListingVariant` rows in primary-key order; 400 `Only N of “<name> (<label>)” left in stock.`; decrement the variant; `variants.sync_listing(listing)`; `reservations.append({"listing_id", "variant_id", "quantity"})`.

- [ ] **Step 1: Write failing tests**: cart: `test_add_several_variants_of_one_listing_in_one_request`, `test_adding_the_same_variant_again_increments_its_line`, `test_a_variant_listing_requires_a_variant`, `test_a_variant_of_another_listing_is_refused`, `test_all_lines_or_none` (second line invalid: no cart rows written). Checkout: `test_checkout_splits_stock_per_variant_and_snapshots_the_label` (`OrderItem.variant_label == "Vanilla / 500 g"`), `test_oversell_guard_names_the_variant`, `test_review_focus_two_checkouts_of_the_last_unit_one_wins` (`TransactionTestCase`, two threads or the established concurrency pattern in `wallets/tests`), `test_failed_payment_returns_variant_stock_and_the_listing_total` (drive `_fail_order_checkout` with a `stock_reservations` entry holding `variant_id`), `test_old_reservation_without_variant_id_still_rolls_back`, `test_review_focus_fee_snapshot_for_two_variants_equals_one_line_of_the_same_total` (`OrderFeeSnapshot.base_pesewas` summed per vendor and category matches), `test_owner_orders_show_only_the_callers_variant_lines` (two businesses in one order), `test_promo_pricing_keeps_the_variant_on_the_order_line` (`MARKETING_PROMOS_ENABLED` on), `test_flash_sale_refuses_a_variant_listing`, `test_review_focus_the_opening_gate_still_refuses_shoppers` (Plan 1's gate on: checkout 4xx; skip with a clear reason if Plan 1 is not yet merged).
- [ ] **Step 2: Run to see failures:** `docker compose run --rm web python manage.py test cart orders.tests.test_variant_checkout --noinput`.
- [ ] **Step 3: Implement** models, `makemigrations cart orders`, serializers, views, `payments/services.py`, `marketing/` edits.
- [ ] **Step 4: Run to pass**, then `... test cart orders payments marketing ledger --noinput`.
- [ ] **Step 5: Commit** `feat(orders): buy several variants in one order; reserve and roll back variant stock`.

---

## Task 4: Editing an approved listing — pending revisions (backend)

**Files:**
- Modify: `backend/listings/models.py` (create `ListingRevision`), migration generated.
- Create: `backend/listings/revisions.py` (`LIVE_FIELDS`, `REVISABLE_FIELDS`, `save_draft`, `submit`, `apply_revision`, `discard`, `cannot_decide`, `diff`), `backend/listings/views_revisions.py` (owner and staff views), `backend/listings/serializers_revisions.py`.
- Modify: `backend/listings/serializers.py` (`validate_listing_for_owner(..., revising=False)`: when `revising` skip the "Cannot edit a published listing" check; `OwnerListingManageSerializer.Meta.fields` narrowed to `price_amount`, `price_unit`, V5), `backend/listings/views.py` (`ModerationApproveView` calls `cannot_decide`), `backend/listings/urls.py`, `backend/realtime/publish.py` (`QUEUE_INVALIDATIONS`: `(("listing-revision-",), ("listings.moderate",), ("listing-revisions-queue",))`).
- Test: `backend/listings/tests/test_listing_revisions.py`; update `backend/listings/tests/test_listing_manage.py` (the narrowed fields, and why).

**Interfaces:**
- `ListingRevision(listing FK related_name="revisions", status, changes JSON, variants JSON, remove_photo_ids JSON, remove_video_ids JSON, new_main_photo ImageField null, created_by FK BusinessOwner null, created_by_staff FK StaffUser null, rejection_reason, reviewed_by, reviewed_at, submitted_at, created_at, updated_at)`; partial unique constraint on `listing` where `status in (draft, pending)`.
- `revisions.REVISABLE_FIELDS` = every field of `OwnerListingSerializer` except `price_amount`, `price_unit`, `stock_quantity`, `status`, `rejection_reason` and the read-only ones; `LIVE_FIELDS = {"price_amount", "price_unit", "stock_quantity"}`.
- Owner (scope-aware): `GET/PUT/DELETE /api/listings/mine/<pk>/revision/`, `POST .../revision/submit/` (400 unless the listing is `published` or `dropped`; submit notifies staff holding `listings.moderate` as `ListingSubmitView` does).
- Staff queue (contract): `GET /api/listings/revisions/pending/?status=pending|approved|rejected`, `GET .../revisions/<pk>/` (full diff: `{field: {"old", "new"}}`, staged media, variant ops), `POST .../approve/`, `POST .../reject/` (reason required), `POST .../re-review/`; permission `HasRolePermission("listings.moderate")`; `REVISION_STATUS_MAP`.
- `apply_revision(revision, staff)` — one `transaction.atomic()`: lock the listing, copy `changes`, swap `new_main_photo`, go-live staged photos/videos (`revision=None`), delete queued removals, apply variant ops (create with initial price/stock, update label/attributes/position, deactivate removed; never touch price/stock of an existing row, V7), `variants.sync_listing`, set `reviewed_by/at`, notify the owner (`notify_business_owner`, "Changes published"). The listing stays `published` throughout.
- `cannot_decide(staff, obj)` is true when `obj.created_by_staff_id == staff.id`; both approve views answer 403 `{"detail": "You made this, so someone else must approve it."}`.

- [ ] **Step 1: Write failing tests**: `test_owner_saves_a_draft_revision_on_a_published_listing`, `test_review_focus_public_detail_is_unchanged_while_a_revision_is_pending`, `test_review_focus_only_price_and_stock_are_live_edits` (price and stock go live via `manage`/`restock`; a `name` in `manage` is a 400 and the test asserts it is now a revision field), `test_submit_puts_it_in_the_queue_and_notifies_staff`, `test_one_open_revision_per_listing` (second PUT updates the same row), `test_queue_defaults_to_pending_and_falls_back_on_an_unknown_status`, `test_pending_oldest_first_history_by_reviewed_at`, `test_approve_applies_changes_and_stamps_reviewer`, `test_review_focus_apply_never_touches_price_or_stock_of_existing_rows` (owner changes price after submit; approve keeps the new price), `test_apply_creates_new_variants_with_initial_price_and_stock_and_deactivates_removed`, `test_reject_needs_a_reason_and_owner_can_edit_and_resubmit`, `test_re_review_400s_unless_rejected_and_clears_the_pair`, `test_review_focus_the_creator_cannot_approve` (revision and listing, `created_by_staff`), `test_revision_validates_like_a_new_listing` (category kind, barcode), `test_another_owner_gets_404`, `test_discard_deletes_the_revision_and_staged_rows`, `test_approving_a_revision_for_a_dropped_listing_keeps_it_dropped`.
- [ ] **Step 2: Run to see failures:** `docker compose run --rm web python manage.py test listings.tests.test_listing_revisions --noinput`.
- [ ] **Step 3: Implement** model, `makemigrations listings`, `revisions.py`, serializers, views, URLs, the `validate_listing_for_owner` flag, the narrowed manage fields, `QUEUE_INVALIDATIONS`.
- [ ] **Step 4: Run to pass**, then `... test listings realtime --noinput`.
- [ ] **Step 5: Commit** `feat(listings): edit an approved listing through approved-before-live revisions`.

---

## Task 5: Media — 9 images, 2 videos, upload conversion, YouTube

**Files:**
- Modify: `backend/Dockerfile`, `backend/Dockerfile.prod` (install `ffmpeg`); `backend/listings/models.py` (`ListingPhoto.revision` FK null; create `ListingVideo`), migration generated.
- Create: `backend/core/video.py` (reuse if Plan 1 made it: `probe`, `convert_to_web_mp4`, `poster_frame`), `backend/listings/media.py` (`image_count`, `video_count`, `check_image`, `add_image`, `add_youtube`, `add_video_upload`, `parse_youtube`, `MediaError`), `backend/listings/tasks.py` (`convert_listing_video`, `reap_stuck_videos`), `backend/listings/validators.py` (`validate_image_size`, `validate_video_content_type`).
- Modify: `backend/listings/views.py` (`ListingPhotoCreateView`/`ListingPhotoDeleteView` stage into the open revision when the listing is published; create `ListingVideoCreateView`, `ListingVideoDeleteView`), `backend/listings/serializers.py` (`photos` and `videos` public lists filter `revision__isnull=True`; owner serializers show staged ones flagged `staged`), `backend/listings/urls.py`, the beat schedule where other reapers are registered (follow `reap_stuck_exports`).
- Test: `backend/listings/tests/test_listing_media.py`.

**Interfaces:**
- `ListingVideo(listing, revision FK null, kind "upload"|"youtube", source FileField null, web_file FileField null, poster ImageField null, youtube_id CharField(11) blank, status "processing"|"ready"|"failed", duration_seconds, position, created_at)`.
- `POST /api/listings/mine/<pk>/photos/` (multipart `image`) — on a draft/rejected listing it adds a live row; on a published one it stages into the open or a newly created draft revision (Task 4). `POST .../videos/` multipart `file` **or** JSON `{"youtube_url"}`. `DELETE .../videos/<vid>/`. Limits: images 9 total (main included, B1) and 5 MB (`5 * 1024 * 1024`) each, JPEG/PNG sniffed by `validate_image_content_type`; videos 2 total, upload at most 100 MB and 60 s by `ffprobe` before the row is created (400 with the limit in plain words), YouTube id from `watch?v=`, `youtu.be/`, `/shorts/`, `/embed/` forms, regex `^[A-Za-z0-9_-]{11}$`, anything else 400. Public serializer exposes `{"id", "kind", "url" (web_file) | "youtube_id", "poster", "position"}` only for `ready`/youtube rows.
- `convert_listing_video(video_id)` claims the row (processing → converting guard, exactly once), runs ffmpeg outside any transaction, sets `ready` or `failed`; a failure never shows the tool's own output to the owner (fixed text "We could not process this video. Try another file.").

- [ ] **Step 1: Write failing tests**: `test_review_focus_nine_images_five_megabytes`, `test_main_photo_counts_toward_the_nine`, `test_a_tenth_image_is_refused`, `test_an_oversize_image_is_refused` (5 MB + 1 byte), `test_third_video_refused_whatever_the_kind`, `test_video_over_sixty_seconds_is_refused_before_saving` (stub `core.video.probe`), `test_video_over_one_hundred_megabytes_is_refused`, `test_upload_is_converted_to_a_web_format` (stub the ffmpeg call; asserts `status == "ready"`, `web_file` set), `test_conversion_failure_marks_failed_with_fixed_text`, `test_a_redelivered_task_converts_once`, `test_reaper_fails_rows_stuck_processing`, `test_youtube_forms_parse_and_bad_urls_are_refused` (`https://evil.example/watch?v=...`, `javascript:` refused), `test_review_focus_staged_media_is_not_public` (published listing: new image and video are staged and absent from public detail; present after `apply_revision`), `test_removal_is_queued_until_approval`, `test_images_can_be_added_while_editing_an_approved_listing` (spec), `test_owner_cannot_delete_another_owners_media`.
- [ ] **Step 2: Run to see failures:** `docker compose run --rm web python manage.py test listings.tests.test_listing_media --noinput`.
- [ ] **Step 3: Implement** Dockerfile lines, models, `makemigrations listings`, `core/video.py` (or reuse), `media.py`, tasks, views, serializers, URLs, beat entry. Note in the commit: rebuild `web` and `worker` images (`docker compose build web worker`).
- [ ] **Step 4: Run to pass**, then `... test listings --noinput`.
- [ ] **Step 5: Commit** `feat(listings): up to 9 images and 2 videos per listing, uploads converted for the web`.

---

## Task 6: Staff review of listing changes (admin panel)

**Files:**
- Create: `frontend/hooks/useListingRevisionsQueue.js` (paginated or plain: check the backing view and read accordingly, per frontend/CLAUDE.md; the queue view uses the moderation pagination, so read `data?.results` and say so in the hook's comment), `frontend/components/admin/panels/ListingRevisionsPanel.jsx`, `frontend/components/admin/panels/ListingRevisionsPanel.test.jsx`.
- Modify: `frontend/components/admin/panels/ListingsModerationPanel.jsx` (add a "Changes to live listings" sub-view or tab that renders `ListingRevisionsPanel`), `frontend/components/admin/shell/navModel.js` (badge count only if the existing moderation entry has one; no new nav id), `frontend/mocks/handlers.js` (revision queue handlers).
- Test: `ListingRevisionsPanel.test.jsx`.

**Interfaces:** Panel uses `components/admin/ModerationQueueTabs.jsx` with `itemsOf()`; copy the preamble from `KYCQueuePanel`. Each row shows the listing name, the business name, and a before/after table from the `diff` response (changed fields only; staged images as thumbnails, removed ones struck through, video status, variant adds/removals), Approve / Reject (reason textarea required) / Re-review, using plain `apiPost` + `refetch()`. A 403 from the maker-checker guard shows the server's message in the panel's `actionError`. A row the staff user created shows Approve disabled with "You made this".

- [ ] **Step 1: Write failing tests**: `renders pending changes with a before and after for each changed field`, `shows nothing for an unchanged field`, `approve posts and refetches`, `reject requires a reason`, `shows the server message when approval is refused because you made it`, `empty state says there are no changes waiting`.
- [ ] **Step 2: Run to see failures:** from `frontend/`: `npx vitest run components/admin/panels/ListingRevisionsPanel.test.jsx`.
- [ ] **Step 3: Implement** hook, panel, tab wiring, MSW handlers.
- [ ] **Step 4: Run to pass**, then `npx vitest run components/admin` and `npx vitest run StaffDashboard.test.jsx` (a behavioural contract: no assertion may change).
- [ ] **Step 5: Commit** `feat(admin): review changes to live listings in the moderation panel`.

---

## Task 7: Business dashboard — listing editor (variants, media, edit approved, drop, discontinue)

**Files:**
- Create: `frontend/components/dashboard/panels/VariantEditor.jsx`, `frontend/components/dashboard/panels/MediaManager.jsx`, `frontend/components/dashboard/panels/ListingChangesBanner.jsx`, `frontend/hooks/useListingRevision.js`, matching `*.test.jsx` beside each.
- Modify: `frontend/components/dashboard/panels/OwnerListingCard.jsx` (live price and stock only on the card; "Edit details" opens the revision editor; Drop / Restore / Discontinue buttons with a confirm that says what each does), `frontend/components/dashboard/panels/ProductsPanel.jsx` and `ServicesPanel.jsx` (list `published`, `dropped` and awaiting-change listings; copy no longer says "without re-approval"), `frontend/components/dashboard/panels/ListingsPanel.jsx` (create form gains `VariantEditor` and `MediaManager`; status chips for `dropped` and `discontinued`), `frontend/mocks/handlers.js`, `frontend/BusinessDashboard.test.jsx` (only the assertion on the old "changes go live without re-approval" copy, with the reason in the commit body).
- Test: the new component tests, `OwnerListingCard.test.jsx` (extend).

**Interfaces:** Every panel takes an optional `basePath` prop, default `"/api/listings/mine"`, so Task 12 mounts the same panels on `/api/direct/listings` without copies. `VariantEditor`: rows of attribute pairs + price + stock; on a draft listing saves with `POST .../variants/`; on a published listing, price and stock cells call `PATCH .../variants/<id>/live/` (labelled "Live now") and attribute, add and remove changes go into the revision with a "Needs approval" note. `MediaManager`: shows count against 9 and 2, a YouTube link field, an upload with video size and length limits stated, a "Converting…" state polled by refetch, staged items labelled "Waiting for approval". `ListingChangesBanner`: "Your approved version is live. Your changes are waiting for approval" with Submit / Discard, or the rejection reason with "Edit and resubmit". No contact action is added.

- [ ] **Step 1: Write failing tests**: `VariantEditor adds a row and posts the variant`, `a published listing's price and stock cells patch live`, `attribute changes on a published listing go to the revision, not live`, `MediaManager blocks a tenth image and a third video before posting`, `MediaManager rejects a file over the stated size client-side and still trusts the server error`, `shows a YouTube link as a ready video`, `banner shows awaiting approval with discard`, `banner shows the rejection reason and lets the owner resubmit`, `Drop asks for confirmation and says it can be reversed`, `Discontinue confirmation says it is permanent and old orders still show it`, `a dropped listing shows Restore`.
- [ ] **Step 2: Run to see failures:** from `frontend/`: `npx vitest run components/dashboard/panels`.
- [ ] **Step 3: Implement** components, hook, card/panel edits, MSW handlers.
- [ ] **Step 4: Run to pass**, then `npx vitest run BusinessDashboard.test.jsx components/dashboard`.
- [ ] **Step 5: Commit** `feat(dashboard): variants, media, edit-with-approval, drop and discontinue`.

---

## Task 8: Discounts and price history

**Files:**
- Modify: `backend/listings/models.py` (create `ListingDiscount`, `ListingPriceHistory`), migration generated, `backend/listings/variants.py` and `backend/listings/views.py` `ListingManageView` (call `pricing.record_price` on a regular-price change), `backend/cart/views.py` (price snapshot via `pricing.effective_price`), `backend/listings/serializers.py` (public and owner serializers gain `display_price`: `{"price", "was_price"|null, "discount_pct"|null, "ends_at"|null}`), `backend/listings/urls.py`.
- Create: `backend/listings/pricing.py` (`record_price`, `effective_price`, `live_discount_q`, `was_price`, `start_discount`, `end_discount`, `PricingError`), `backend/listings/views_discounts.py`, `frontend/components/dashboard/panels/DiscountsPanel.jsx`, `frontend/components/dashboard/panels/DiscountsPanel.test.jsx`, `frontend/hooks/useListingDiscounts.js`.
- Test: `backend/listings/tests/test_listing_discounts.py`.

**Interfaces:**
- `ListingDiscount(listing, variant null, sale_price, regular_price, starts_at, ends_at null, ended_at null, created_by BusinessOwner null, created_by_staff null)`; live when `starts_at <= now`, `ended_at` null and (`ends_at` null or `> now`). `ListingPriceHistory(listing, variant null, price, effective_from)` append-only (no update or delete in code; a test pins that no view or service updates a row).
- `POST/GET /api/listings/mine/<pk>/discounts/` body `{"variant"?, "sale_price" | "percent_off", "starts_at"?, "ends_at"?}`; `POST .../discounts/<id>/end/`. Rules (B4): published listing only, sale price below the regular price and at least 10% of it, at most 90% off, one live discount per listing or variant (409 otherwise); live at once (no approval).
- `pricing.was_price(discount)` returns the regular price only when price history shows it unchanged for the 7 days before `starts_at` and a history row covers the start of that window; otherwise `None`. History is recorded from the first deploy, so an older listing has no "was" for 7 days (spec).
- Reuse: if Plan 1 shipped `listings/pricing.py`, extend it and keep its function names.

- [ ] **Step 1: Write failing tests**: `test_discount_goes_live_at_once_and_shows_in_display_price`, `test_review_focus_was_price_needs_seven_held_days`, `test_review_focus_was_price_absent_when_price_changed_inside_the_window`, `test_was_price_absent_without_history_for_the_full_window`, `test_percent_off_computes_the_sale_price_to_the_cent`, `test_sale_price_must_be_below_regular_and_within_ninety_percent`, `test_one_live_discount_per_listing_and_per_variant`, `test_a_variant_discount_prices_only_that_variant`, `test_ending_a_discount_stops_new_carts_but_not_existing_lines` (cart snapshot semantics), `test_price_history_is_append_only`, `test_regular_price_edit_writes_history`, `test_a_discount_is_a_live_discount_for_the_deals_helper` (`live_discount_q`), `test_another_owner_cannot_discount_my_listing`, `test_cannot_discount_a_dropped_listing`.
- [ ] **Step 2: Run to see failures:** `docker compose run --rm web python manage.py test listings.tests.test_listing_discounts --noinput`.
- [ ] **Step 3: Implement** backend, `makemigrations listings`; then `DiscountsPanel` (pick listing or variant, percent or price, dates, "Live now" list with End; shows the price shoppers will see and says "Struck-through original price shows only after 7 days of the same price").
- [ ] **Step 4: Run to pass:** backend as above plus `... test cart listings --noinput`; frontend `npx vitest run components/dashboard/panels/DiscountsPanel.test.jsx` (tests: `creates a percent discount`, `shows the conflict message from the server`, `end posts and refetches`, `explains the 7-day rule honestly`).
- [ ] **Step 5: Commit** `feat(listings): discounts as sale prices, with honest price history`.

---

## Task 9: Promotion hub — free sponsored ads and one place for every tool

**Files:**
- Modify: `backend/ashantihub/settings.py` (`PROMOTION_PRICING_ENABLED`, env, default False), `backend/listings/views.py` (`ListingPromoteView`: amount 0 and no `Transaction` while pricing is off; the response says `"free": true`), `backend/listings/serializers.py` (`PromotionSerializer` adds `free`).
- Create: `frontend/components/dashboard/panels/PromotionsHubPanel.jsx`, `PromotionsHubPanel.test.jsx`.
- Modify: `frontend/components/dashboard/BusinessCommandCenter.jsx` (`buildTabs`: a "Promote" tab; remove nothing), `frontend/components/dashboard/panels/ListingsPanel.jsx` (the Promote button now opens the hub scoped to that listing; the `PaymentComponent`/MoMo step is skipped when `res.free`), `frontend/mocks/handlers.js`.
- Test: `backend/listings/tests/test_promotion_purchase.py` (extend; existing tests keep their paid-path assertions with `PROMOTION_PRICING_ENABLED=True` via `override_settings`), `backend/listings/tests/test_promotion_free.py` (new).

**Interfaces:** Hub sections, each a card that opens an existing or new tool: **Discount** (Task 8 `DiscountsPanel`), **Hero ad** (a link to Plan 1's submit screen; the card is hidden with a note if Plan 1's endpoint is absent from the build, never a second endpoint), **Sponsored ad** (the featured/boost request: `POST /api/listings/<id>/promote/`, pending until staff approve), **Free-delivery promo** (existing `DeliveryPromosPanel`), **Flash-sale invitations** (existing owner invitations). A line states "Free for now. Prices will be announced before any charge." only while pricing is off (read from a `GET /api/listings/promotions/pricing/` `{"enabled": bool}`; no invented prices).

- [ ] **Step 1: Write failing tests**: backend `test_promotion_is_free_while_pricing_is_off` (amount 0, no `Transaction`), `test_review_focus_pricing_on_keeps_the_paid_path` (existing behaviour), `test_free_promotion_still_waits_for_staff_approval`, `test_pricing_flag_endpoint_reports_the_setting`; frontend `hub lists every tool`, `sponsored request skips payment when free`, `hero card links to the Plan 1 screen`, `discount card opens the discounts panel`, `shows no price text when pricing is on and none is configured` (fabrication guard).
- [ ] **Step 2: Run to see failures:** `docker compose run --rm web python manage.py test listings.tests.test_promotion_free --noinput`; `cd frontend && npx vitest run components/dashboard/panels/PromotionsHubPanel.test.jsx`.
- [ ] **Step 3: Implement** the setting, view change, hub and tab.
- [ ] **Step 4: Run to pass**, then `... test listings --noinput` and `npx vitest run BusinessDashboard.test.jsx`.
- [ ] **Step 5: Commit** `feat(promotions): sponsored ads are free until priced; one promotion hub`.

---

## Task 10: Public pages that show only what a listing offers

**Files:**
- Create: `backend/listings/views_sellers.py` (`SellerDetailView`: `GET /api/listings/sellers/<id>/` public: `{"id", "name", "is_ashanti_direct", "since", "counts": {"products","services","stays","events"}}`, live and not-hidden listings only, no contact fields), `frontend/components/SellerPage.jsx`, `frontend/components/SellerPage.test.jsx`.
- Modify: `backend/listings/urls.py` (before `<int:pk>/`), `backend/listings/serializers.py` (`BusinessOwnerMiniSerializer` adds `id` already there; add `is_ashanti_direct` only through Task 11), `frontend/components/ListingDetailPage.jsx` (plain variant picker: one row per variant with price, "Out of stock" from `stock_quantity == 0`, quantity stepper, and "Add to cart" posting `lines`; a media strip of images and ready videos with a YouTube `https://www.youtube-nocookie.com/embed/<id>` iframe; discounted price with the struck-through original only when `display_price.was_price`; a "Sold by <business>" link to `/seller/<id>`; sections rendered only when the listing has them), `frontend/components/EventDetailPage.jsx` (no change unless a section renders empty: verify and hide empty ones), `frontend/App.jsx` (route `/seller/:id`, threaded the same way `/business/:id` is), `frontend/components/ListingDetailPage.test.jsx`, `frontend/mocks/handlers.js`.
- Test: `backend/listings/tests/test_seller_page.py`, `SellerPage.test.jsx`, `ListingDetailPage.test.jsx` (extend).

**Interfaces:** Seller page tabs appear only for kinds with live listings (Products, Services, Stays, Events), each a grid of the existing `Card`; a seller with nothing live says "No live listings right now."; a hidden (suspended or paused) business 404s via `hidden_business_q`. The product page keeps its existing look; Plan 4 replaces the markup, not these data fields.

- [ ] **Step 1: Write failing tests**: backend `test_seller_counts_only_live_listings`, `test_hidden_business_is_a_404`, `test_seller_payload_has_no_phone_email_or_whatsapp` (key allowlist), `test_dropped_and_discontinued_never_count`; frontend `variant rows show price and out-of-stock honestly`, `adds several variants with quantities in one request`, `shows the was price only when the API sends it`, `shows no media section when there is no media`, `youtube video renders the nocookie embed and never an arbitrary URL`, `seller page shows a tab only for kinds that exist`, `seller page empty state`.
- [ ] **Step 2: Run to see failures:** `docker compose run --rm web python manage.py test listings.tests.test_seller_page --noinput`; `cd frontend && npx vitest run components/SellerPage.test.jsx components/ListingDetailPage.test.jsx`.
- [ ] **Step 3: Implement** seller endpoint, page, route, detail-page additions.
- [ ] **Step 4: Run to pass**, then `npx vitest run App.routing.test.jsx ListingDetailPage.test.jsx`.
- [ ] **Step 5: Commit** `feat(web): seller page and variant, media and discount sections on listing pages`.

---

## Task 11: Ashanti Direct — the company business and Operations' staff access

**Files:**
- Modify: `backend/accounts/models.py` (`BusinessOwner.is_company`, unique partial index), `accounts` migration generated, plus a data migration seeding permission `direct.operate` to `operations` and `super_admin` (copy `accounts/migrations/0054_seed_wallet_permissions.py`, new next number), `backend/listings/permissions.py` (`IsListingOwnerOrDirectOperator`), `backend/listings/views.py` and the view modules of Tasks 1, 2, 4, 5, 8, 9 (every owner view gets `scope = "mine"` and `acting_owner(request)`), `backend/listings/serializers.py` (`validate_listing_for_owner` skips the kind and subscription checks for `owner.is_company`, V14; `OwnerListingSerializer.create` sets `created_by_staff` when the actor is staff), `backend/listings/views.py` (`PublicListingListView` accepts `?sold_by=direct`; public serializers add `is_ashanti_direct` to `business_owner`), `backend/ashantihub/urls.py`.
- Create: `backend/accounts/direct.py` (`ashanti_direct()`, `is_operator(staff)`), `backend/accounts/management/commands/ensure_ashanti_direct.py`, `backend/listings/urls_direct.py` (the same views, `as_view(scope="direct")`, under `/api/direct/listings/`).
- Test: `backend/accounts/tests/test_ashanti_direct.py`, `backend/listings/tests/test_direct_listings.py`.

**Interfaces:**
- `ashanti_direct()` returns the one company owner or raises `LookupError`; `ensure_ashanti_direct` creates it idempotently (name "Ashanti Direct", KYC verified with a system reason, unusable password until a Super Admin sets one with the existing password flow, company phone/email from settings `ASHANTI_DIRECT_PHONE`/`ASHANTI_DIRECT_EMAIL`).
- `/api/direct/listings/...` mirrors `/api/listings/mine/...` (list/create, variants, revision, media, manage, restock, drop/restore/discontinue, discounts, promote), gated by `HasRolePermission("direct.operate")`; the owner is always `ashanti_direct()`, never a client-supplied id; a listing of any other business 404s. Created rows carry `created_by_staff`. No new money paths: Direct orders flow through `OrderCheckoutView` and `ledger.escrow.record_order_payment` unchanged.

- [ ] **Step 1: Write failing tests**: `test_command_creates_ashanti_direct_once` (idempotent, one row, KYC verified), `test_only_one_company_owner_can_exist`, `test_operations_holds_direct_operate_and_support_does_not` (effective permissions), `test_operator_creates_and_lists_only_direct_listings`, `test_operator_cannot_touch_a_partner_listing` (404), `test_partner_owner_cannot_use_the_direct_urls` (403), `test_review_focus_creator_of_a_direct_listing_cannot_approve_it` (403; a second moderator can), `test_direct_listing_skips_kind_and_subscription_checks`, `test_sold_by_direct_filter_returns_only_direct_listings_and_partners_stay_visible`, `test_public_listing_marks_is_ashanti_direct`, `test_review_focus_direct_order_gets_the_same_fee_snapshot_as_a_partner` (same category and base: identical `rule_set`, `charged_pesewas`), `test_direct_vendor_balance_follows_the_normal_wallet_account` (`posting.account_for(VENDOR_PENDING, owner)` credited), `test_no_money_package_mentions_is_company` (reads source of `ledger`, `wallets`, `payments`, `billing`), `test_direct_writes_are_recorded_in_the_activity_log`.
- [ ] **Step 2: Run to see failures:** `docker compose run --rm web python manage.py test accounts.tests.test_ashanti_direct listings.tests.test_direct_listings --noinput`.
- [ ] **Step 3: Implement** model flag and migrations, `accounts/direct.py`, command, permission, scoped views and `urls_direct.py`, filter and serializer field.
- [ ] **Step 4: Run to pass**, then `... test accounts listings ledger wallets payments --noinput`.
- [ ] **Step 5: Commit** `feat(direct): Ashanti Direct as a normal company business run by Operations`.

---

## Task 12: Ashanti Direct in the staff dashboard and the shopper sidebar

**Files:**
- Create: `frontend/components/admin/panels/AshantiDirectPanel.jsx`, `AshantiDirectPanel.test.jsx`.
- Modify: `frontend/components/admin/shell/navModel.js` (an "Ashanti Direct" entry shown when `auth.hasPermission("direct.operate")`, in Operations' group beside moderation), `frontend/components/Sidebar.jsx` (a "Sold by Ashanti Direct" checkbox setting `filters.directOnly`; shown on the Business tab grid), `frontend/App.jsx` (pass `directOnly` as `sold_by=direct` where the Business tab builds its listing query), `frontend/components/ListingDetailPage.jsx` (an "Ashanti Direct" badge on "Sold by" only when `business_owner.is_ashanti_direct`), `frontend/Sidebar.test.jsx` (extend), `frontend/mocks/handlers.js`.
- Test: `AshantiDirectPanel.test.jsx`, `Sidebar.test.jsx`, `ListingDetailPage.test.jsx`.

**Interfaces:** `AshantiDirectPanel` is tabs (Products, Services, Discounts, Promote) reusing Task 7 and 8 panels with `basePath="/api/direct/listings"`, preceded by a plain header "You are working in Ashanti Direct. Money follows the normal fee, wallet and payout rules." A new listing created here shows "Needs a second person to approve". No payout or wallet controls are exposed: the company's withdrawals stay with its holder login (V12).

- [ ] **Step 1: Write failing tests**: `panel shows only to staff holding direct.operate` (nav), `panel creates a listing through the direct base path`, `a new direct listing says a second person must approve`, `sidebar checkbox sets directOnly and clears with Clear filters`, `product page shows the Ashanti Direct badge only when the API says so`, `no badge for a partner`.
- [ ] **Step 2: Run to see failures:** from `frontend/`: `npx vitest run components/admin/panels/AshantiDirectPanel.test.jsx Sidebar.test.jsx`.
- [ ] **Step 3: Implement** panel, nav entry, sidebar filter, query wiring, badge.
- [ ] **Step 4: Run to pass**, then `npx vitest run StaffDashboard.test.jsx Sidebar.test.jsx ListingDetailPage.test.jsx App.routing.test.jsx`.
- [ ] **Step 5: Commit** `feat(web): Ashanti Direct panel for Operations and the Sold-by filter for shoppers`.

---

## Task 13: Contract notes and full regression

**Files:**
- Modify: `backend/CLAUDE.md` (add: the pending-revision contract and "revision never touches price or stock"; variant stock reservation order; Drop/Discontinue status semantics; Ashanti Direct has no money special-case), `docs/superpowers/specs/2026-10-19-marketplace-rebrand-design.md` (record V5's narrowing of `manage`, B1 to B5 and the `contact_phone` decision under "Decisions from the builder check"), `docs/IMPLEMENTATION_INSTRUCTIONS.md` (mark Plan 2 built, pending staging), `frontend/CLAUDE.md` only if a new gotcha appeared (for example the `basePath` panel convention).
- Test: whole suites.

- [ ] **Step 1: Write the notes** (no code), keeping each to the failure contract a future session could not read from the code.
- [ ] **Step 2: Run the full backend suite:** `docker compose run --rm web python manage.py test --noinput`; every failure must be a Plan 2 regression or a documented pre-existing one.
- [ ] **Step 3: Run the full frontend suite** from `frontend/`: `npx vitest run`.
- [ ] **Step 4: Manual staging checklist for the owner (written into the PR body, not executed here):** create a variant product, approve it, buy two variants in one order with simulated MoMo and a wallet, edit the description and see the old one live, approve the change, add a discount and see "was" absent, drop and restore, discontinue and open the old order, run `ensure_ashanti_direct`, list a Direct item as one Operations user and approve as another, and rebuild `web` and `worker` for ffmpeg. No production promotion without the owner's explicit say.
- [ ] **Step 5: Commit** `docs: record the listing-tools contracts and Plan 2 decisions`.

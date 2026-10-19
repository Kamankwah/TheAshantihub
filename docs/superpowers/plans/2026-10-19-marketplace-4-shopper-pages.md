# Marketplace Plan 4 — Product, Cart, Checkout and Account Pages (incl. shopper wallet screens) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A shopper gets Amazon-shaped pages in AshantiHub's own theme: a product page (hover-zoom gallery, full gallery of images and video, phone full-screen pinch-zoom, variant picker with a quantity per variant, "Customers also viewed" and "Sponsored products" carousels, reviews, a "Sold by" line with the Ashanti Direct filter, no questions-and-answers), a cart page, a checkout that **requires a GhanaPost digital address** (format `AK-039-5028`, map pin, landmark, address book), a payment-verification page, and a **Your Account** hub with a four-tab money-only shopper wallet (Overview / Wallet / Transactions / Settings) built on the wallet API that already exists.

**Architecture:** Backend: small additions only — a GhanaPost address and landmark on `Order`, an address book (`accounts.CustomerAddress`), listing-view recording for "also viewed", a review histogram, an atomic variant bulk add, and richer cart-line and checkout-status read models. Frontend: new flat component folders `frontend/components/shop/` (product, cart, checkout, verify) and `frontend/components/account/` (hub, orders, addresses, lists, sell, wallet); `ListingDetailPage` keeps its props and becomes a thin chooser (goods → new `ProductPage`; services and stays → the old body, minus Q&A). All data comes from the owning component's own hook; mutations are plain `apiPost`/`apiPatch`/`apiDelete` in handlers (no `useMutation`); styling is inline off `C` / `D`. Wallet screens use `GET/POST /api/wallet/*` as built in wallet Plans 3a and 3b and answer `409 ledger_off` with an honest "Wallets aren't switched on yet" state.

**Tech Stack:** Django 5.2 / DRF / Postgres (`accounts`, `orders`, `listings`, `cart`, `reviews`, `payments` apps); React 19, TanStack Query, MSW, Vitest + Testing Library, `react-leaflet` (stubbed in jsdom), pointer events for gestures (no new dependency).

**Spec:** `docs/superpowers/specs/2026-10-19-marketplace-rebrand-design.md` — "Plan 4", "Constraints", "Decisions from the builder check" (shopper wallet screens show only what exists in the backend today). Screens designed from `docs/Screenshot_main_product_page_*` (search-results cards: the card pattern only), `Screenshot_product_preview_1–10`, `Screenshot_amazon_image_preview`, `Screenshot_shopping_cart*`, `Screenshot_checkout`, `Screenshot_payment_verification screen`, `Screenshot_user_account_*`. Visual language: `DESIGN.md` (gold `#D4A017` for every primary action instead of Amazon yellow, cream canvas, Fraunces headings, Plus Jakarta Sans, tabular figures on every price).

**Base:** branch from `righteoushack` after Marketplace Plans 1, 2 and 3 have merged (see "Dependencies"). Run the frontend suite from `frontend/` only.

**Commit trailers:** every commit message in this plan ends with a blank line and exactly these two lines:

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XFGWCBi9roL1jB5Yhycjq5
```

## Dependencies (stated explicitly)

Naming: "Plan 4" here is **Marketplace Plan 4**. The wallet plans' own frontend plans are written "Plan 1F … 6F" and "Plan 4F" there is the vendor money screens, not this plan.

| From | What this plan consumes (assumed contract; Task 1 of each frontend area re-checks it against the merged code and adapts the MSW handler, not the screen) |
|---|---|
| **Marketplace Plan 1** | **A1** opening gate: a hook returning `{open, opensAt, allowlisted}` (from the server's governed opening time). Before opening every buy action (Add to cart, Proceed to checkout, Place order) is visible but disabled with "Opens 6 Nov"; the server also refuses. **A2** sponsored products: `GET /api/listings/sponsored/?category=<id>&exclude=<id>&limit=12` → card rows. **A3** wishlist: `GET /api/wishlist/` → `[{id, listing:{card fields}, added_at}]`, `POST /api/wishlist/ {listing}`, `DELETE /api/wishlist/<listing_id>/` (if absent when Task 13 starts, Task 13 Step 0 builds exactly this). **A4** category breadcrumb: `category.ancestors` on the listing detail (absent → a single crumb, never a guess). Header cart/wishlist links, fonts and the theme toggle are Plan 1's. |
| **Marketplace Plan 2** | **B1** variants on `GET /api/listings/{id}/`: `variant_axes:[{name, values:[…]}]`, `variants:[{id, label, attributes:{axis:value}, price_amount, was_price|null, stock_quantity|null, available, image|null}]`. **B2** `media:[{id, kind:"image"\|"video"\|"youtube", url, thumb_url, youtube_id|null, position}]` (max 9 images, 2 videos). **B3** `CartItem.variant` (FK, nullable) with uniqueness `(cart, listing, variant)`, and cart lines carry `variant:{id,label,attributes}|null`. **B4** `seller:{id, display_name, is_ashanti_direct}` on listing detail and cards, and `?seller=ashanti_direct` on `GET /api/listings/`. **B5** `was_price` and `discount_percent` only when the listing really held that price for the previous 7 days (spec "Deals"); otherwise null. |
| **Marketplace Plan 3** | None functional: a listing a scout or Operations created for a client reaches the shopper pages only once approved and owner-confirmed. The "Sell on AshantiHub" tile (Task 13) must keep working against whatever Plan 3 changed in the registration flow; Task 13 has a test that pins the self-registration path. |
| **Wallet Plans 2 (OTP), 3a, 3b** | `/api/wallet/` (`{kind:"customer", balance}`), `transactions/` (20 a page: `id, at, account, kind, label, direction in\|out, amount, order, reference`), `processing/?amount=`, `top-up/` (201 `mode:"immediate"` + summary, or 200 `mode:"redirect"` + `checkout_url`), `destinations/` (`{results:[…masked…], cooling_hours}`; POST needs `X-Step-Up-Token`), `destinations/<id>/remove/`, `withdrawals/` (GET page; POST `{destination, amount, request_id}` + step-up), `withdrawals/<id>/cancel/`; checkout `payment_method` ∈ `momo`/`wallet`; step-up via `POST /api/otp/step-up/verify/ {action, code}` → `{step_up_token}`. All behind `LEDGER_ENABLED`; every call answers `409 {"code":"ledger_off"}` while off. |
| **Wallet Plan 2F** | The **step-up prompt** (a shared component that, on `403 step_up_required`, asks for the code and retries once with `X-Step-Up-Token`). Task 15 imports it. If it is not merged when Task 15 starts, Task 15 stops at Step 0 and 2F's step-up piece ships first; Plan 4 never builds a second prompt. |

**Not in this plan:** services/stays/events pages (Plan 2), search/home/header (Plan 1), staff screens, real Hubtel processing, card payments, gift cards, points, Prime, Q&A, any contact path to a business.

## Pending wallet frontends (read, listed, not rewritten)

From the last table of each wallet plan (`2026-10-15-ledger-fees-foundation.md`, `2026-10-16-*.md`). The wallet tabs here are the **shopper** half of 3F; everything else stays where it is.

| Plan | Its screens | Plan 4 absorbs | Stays in that plan |
|---|---|---|---|
| **1F** (ledger-fees foundation + 1b) | Accounting fee/settings; Support "awaiting verification"; Pickup Desk; registration "business type" step replacing "pick a plan" (must ship before `SUBSCRIPTIONS_ENABLED` goes off); Support's booking queue, call, cancel; `payment_method` + "payment processing" on the service-request, ticket and booking pay screens; Accountant ticket screen | Nothing. Plan 4 builds the **product-checkout** version of the payment-method picker and processing line as reusable `PaymentMethodPicker` / `ProcessingLine` (Task 10) that 1F's three pay screens may reuse | All of it. "Sell on AshantiHub" (Task 13) opens the registration flow unchanged, so it inherits 1F's business-type step when 1F lands |
| **2F** (OTP) | Sign-in code screen, channel chooser, trusted-device box, **step-up prompt**, authenticator settings, device list, Super Admin OTP numbers, Support recovery form | Nothing built. Plan 4 **consumes** the step-up prompt (Task 15) and links "Login & security" to 2F's authenticator/device screens when they exist | All of it |
| **3F** (3a row) | Wallet screen (balance, statement, top-up with processing line), pay-from-wallet at checkout, refund notices, staff wallet list | Balance, statement, top-up + processing line (Task 14); pay-from-wallet at **product** checkout (Task 10) | Refund notices (they arrive through the existing notification bell), the **staff wallet list**, pay-from-wallet on 1F's three screens |
| **3F** (3b row) | Payout destinations (add with step-up, masked list, "can receive money from"), withdrawal form with the charge and "you receive", withdrawal history, staff withdrawals queue, reconciliation screen | Destinations, withdrawal form and history for the shopper (Task 15). Built holder-agnostic (`DestinationsList`, `WithdrawForm`) so 3F's owner use and 5F's riders can mount them | Staff withdrawals queue + force-fail, reconciliation screen, the vendor mounting of these components |
| **4F** (vendor money) | Overview with cap meter, sales, daily summary, export, fee page, texts settings | Nothing. `useWallet*` hooks are holder-agnostic so 4F may reuse `useWalletTransactions` | All of it |
| **5F** (riders) | Rider wallet, reserve, per-delivery earnings, daily commission, withdrawals, Delivery Manager "works for", Accountant rider screens | Nothing | All of it (may mount Plan 4's `WithdrawForm`) |
| **6F** (catalogue) | Barcode/grouping UI, "Needs restocking", the product page's **Other sellers** panel with the featured offer, staff catalogue queue | One item from 6F's gate (ci): the product page **disables Add at 0 stock** (Task 6). Plan 4 leaves an empty anchored section `id="other-sellers"` under the buy box for 6F | The Other sellers panel and everything else |

## Global Constraints

- **No business contact, ever.** No phone, WhatsApp or chat link to a business. "Sold by" shows `display_name` only; "Report an issue with this item" and "Contact Support" open `MessagingCenter` framed as AshantiHub Support about the listing (existing `onMessage`). Messages never show a "from sellers" tab.
- **No fabricated data.** A rating row is hidden at `review_count` 0; "was" prices only from Plan 2's 7-day rule (`was_price` null → show only the price); **no delivery dates** (we have no ETA source) — the buy box says "Delivery fee is worked out at checkout from your GhanaPost address"; no "AI review summary", no "helpful" votes, no review photos, no "bought in past month" (no field exists); a carousel heading says "Customers also viewed" **only** when the server's `basis` is `co_viewed`, otherwise "More in this category".
- **Opening gate (A1)** disables buy actions pre-opening; the screens still render (browse, wishlist, account).
- **Wallet is money only:** balance, top-up, transactions, withdrawals, saved mobile-money numbers (these are **payout destinations for withdrawals**, labelled so — checkout collects the paying number each time), default delivery address. **No** saved cards, gift cards, points, offers, or "default payment method" (no model; CLAUDE.md). The Settings tab says so in one plain line. The destination list carries no "default" mark because the backend has no such flag. No top-up hold is shown: the backend has none today; the UI relays the server's `detail`/`code` text and never recomputes limits, cooling or charges (withdrawal `charge` / `you_receive` are shown from the created withdrawal row, never estimated).
- **GhanaPost address** reuses `accounts.gps.GPS_FORMAT` (`^[A-Z]{2}-\d{3,4}-\d{4}$`), `normalize_gps` and `validate_ashanti_gps` (Ashanti region letter `A`; delivery is Ashanti-only, matching `routing.region.in_service_area`). Never a second regex. **Builder's call (owner may overrule):** required for door-to-door delivery; store pickup needs none.
- **`components/**` never import `App.jsx`**; App-owned pieces arrive as props (`MoMoPayment` as `PaymentComponent`, `Card` as `CardComponent`). Staff sessions are gated by `useStaffGate` on every buy action.
- `Order` rows from before this plan have blank GhanaPost fields; serializers and screens must tolerate that.
- Contract-test files (`ListingDetailPage.test.jsx`, `CartDrawer.test.jsx`, `UserPanel.test.jsx`, `App.cartTiers.test.jsx`) change only where this plan changes the behaviour, and each such edit says why in its commit message.
- Staging first; no production promotion without the owner's explicit say.

## Review Focus

1. **GhanaPost is enforced server-side, not only in the form** — a malformed code, a non-Ashanti code (`GA-…`), lower-case input, a door-to-door order without code or landmark, and a pickup order are each pinned (Task 1); the address book normalises the same way (Task 2).
2. **Another customer's rows** — addresses, wishlist, wallet destinations and orders: reading, editing, deleting or defaulting another customer's returns 404 and changes nothing (Tasks 2, 3, 13).
3. **Variants with a quantity each** — one bulk add is atomic (a sold-out variant rejects the whole add and writes nothing), quantities merge into the existing `(listing, variant)` line, stock caps come from the server, and the cart guard still applies (Task 3, Task 6).
4. **Nothing invented** — hidden rating rows, absent was-prices, honest carousel headings, no delivery dates, empty states for every list, wallet `ledger_off` state (Tasks 6, 7, 8, 14, 15).
5. **Money screens** — top-up shows the processing line from the server before paying; withdrawals send one `request_id` per submit (a double click never withdraws twice), always carry the step-up token, and show the server's reason on refusal (Tasks 14, 15).
6. **Phone gestures** — pinch-zoom, double-tap, swipe and back-button close behave on a touch device; pure maths is unit-tested (jsdom cannot test touch rendering) and the manual check list is run on a real phone (Tasks 4, 5, 16).

---

## Task 1: GhanaPost digital address and landmark on delivery orders

**Files:**
- Modify: `backend/orders/models.py` (`Order`: add `delivery_gps_address` CharField(max_length=20, blank=True), `delivery_landmark` CharField(max_length=200, blank=True)), `backend/orders/serializers.py` (`DELIVERY_FIELDS` gains both; `OWNER_DELIVERY_FIELDS` keeps address fields — businesses already see the address — but never the phone), `backend/orders/views.py` (`OrderCheckoutView.post`, after the existing door-to-door address/phone check)
- Create: `backend/orders/migrations/00XX_order_gps_address.py` (generated), `backend/orders/tests/test_checkout_gps_address.py`

**Interfaces:**
- Consumes: `accounts.gps.normalize_gps`, `validate_ashanti_gps` (raises `serializers.ValidationError`), `Order.DOOR_TO_DOOR`, `Order.STORE_PICKUP`.
- Produces: `POST /api/orders/checkout/` accepts `delivery_gps_address`, `delivery_landmark`; door-to-door → 400 `{"delivery_gps_address": [...]}` / `{"delivery_landmark": [...]}` when missing or invalid; stored normalised (upper-case, trimmed). Order JSON includes both fields.

- [ ] **Step 1: Write the failing tests** — `test_checkout_gps_address.py`. Names: `test_door_to_door_without_a_gps_address_is_refused_and_nothing_is_created`, `test_malformed_code_is_refused` (`"AK-39-5028"`, `"AK0395028"`), `test_a_code_outside_ashanti_is_refused` (`GA-123-4567`, message mentions the Ashanti Region), `test_a_lower_case_code_is_stored_upper_case` (`ak-039-5028` → `AK-039-5028`), `test_door_to_door_without_a_landmark_is_refused`, `test_landmark_longer_than_200_is_refused`, `test_store_pickup_needs_neither_and_stores_blank`, `test_order_json_carries_both_fields`, `test_old_orders_with_blank_fields_still_serialize`, `test_owner_order_list_shows_the_address_but_still_no_phone`. Assert no `Order`, no `OrderItem` rows and no stock change after each refusal; cart left as it was.
- [ ] **Step 2: Run to see them fail** — `docker compose run --rm web python manage.py test orders.tests.test_checkout_gps_address`. Expected: failures (unknown field / 201 instead of 400).
- [ ] **Step 3: Implement** — fields, migration, validation placed **before** the planner/routing calls (no network round trip for a refusal), serializer fields.
- [ ] **Step 4: Run to pass**, then `docker compose run --rm web python manage.py test orders cart accounts.tests.test_payout_details` (the rest of checkout stays green) and `makemigrations --check --dry-run` (`No changes detected`).
- [ ] **Step 5: Commit** — `feat(orders): require a GhanaPost digital address and landmark for door-to-door`.

## Task 2: Customer address book (default address)

**Files:**
- Modify: `backend/accounts/models.py` (append `CustomerAddress`), `backend/accounts/urls.py`, `backend/accounts/views.py` (new views near the other `IsCustomer` views), `backend/accounts/serializers.py`
- Create: `backend/accounts/migrations/00XX_customer_address.py` (generated), `backend/accounts/tests/test_customer_addresses.py`

**Interfaces:**
- Produces: `accounts.models.CustomerAddress(customer FK related_name="addresses", label CharField(60), recipient_name, phone, gps_address CharField(20), landmark CharField(200), address_text CharField(255, blank), lat/lng nullable, is_default Bool, created_at)`; partial unique constraint `one_default_per_customer` on `(customer)` where `is_default`; max **10** per customer. `GET/POST /api/accounts/addresses/`, `PATCH/DELETE /api/accounts/addresses/<id>/`, `POST /api/accounts/addresses/<id>/set-default/`. gps validated by `validate_ashanti_gps`; the first address saved becomes the default; deleting the default promotes the most recent remaining; `GET /api/accounts/me/`-style profile untouched (the old free-text `Customer.address` stays).

- [ ] **Step 1: Write the failing tests** — `test_customer_addresses.py`: `test_first_address_becomes_default`, `test_set_default_moves_the_flag_and_only_one_is_default` (threaded variant under `TransactionTestCase`: two simultaneous set-defaults leave exactly one), `test_gps_is_validated_and_normalised`, `test_non_ashanti_code_refused`, `test_landmark_required`, `test_eleventh_address_refused_400`, `test_delete_default_promotes_the_newest_other`, `test_another_customers_address_is_404_for_get_patch_delete_and_default` (and unchanged afterwards), `test_staff_and_business_owner_get_403`, `test_anonymous_401`.
- [ ] **Step 2: Run to see them fail** — `docker compose run --rm web python manage.py test accounts.tests.test_customer_addresses`.
- [ ] **Step 3: Implement** with `select_for_update` on the customer's address rows for default changes.
- [ ] **Step 4: Run to pass** + `makemigrations --check --dry-run`.
- [ ] **Step 5: Commit** — `feat(accounts): customer address book with a default delivery address`.

## Task 3: Storefront read models (also-viewed, review histogram, bulk variant add, cart lines, checkout status)

**Files:**
- Modify: `backend/listings/models.py` (append `ListingView(listing FK, viewer_key CharField(64), viewed_at)`; index `(viewer_key, viewed_at)`), `backend/listings/views.py` + `urls.py` (`POST /api/listings/<id>/view/`, `GET /api/listings/<id>/also-viewed/`), `backend/reviews/views.py` (`TargetReviewListView` adds `distribution`), `backend/cart/serializers.py` (`CartItemSerializer` adds `listing_photo`, `seller_name`, `is_ashanti_direct`, `in_stock`, `stock_quantity`), `backend/cart/views.py` + `urls.py` (`POST /api/cart/items/bulk/`), `backend/payments/serializers.py` (`CheckoutSessionStatusSerializer` adds `processing_fee`, `wallet` bool, `order_id` int|null)
- Create: `backend/listings/tests/test_also_viewed.py`, `backend/reviews/tests/test_review_distribution.py`, `backend/cart/tests/test_bulk_add.py`, `backend/payments/tests/test_session_status_fields.py`, migration (generated)

**Interfaces:**
- `viewer_key` = `c:<customer id>` for a signed-in customer, else a client-chosen anonymous id sent as `{"viewer":"<uuid>"}` (hashed with the Django secret before storage; never returned). Views older than 30 days are ignored by reads. Recording is idempotent per `(viewer_key, listing, day)` and rate-limited (60/min per IP).
- `GET /api/listings/<id>/also-viewed/?limit=12` → `{"basis":"co_viewed"|"same_category","results":[card rows]}`. `co_viewed` = listings viewed by the same viewers within 30 days, ranked by distinct viewers, **at least 3 co-viewers per row** else dropped; if fewer than 4 rows qualify the endpoint answers `same_category` rows (published, not hidden via `hidden_business_q()`, excludes the anchor). Never includes drafts, hidden businesses or the anchor.
- `GET /api/reviews/listing/<id>/` gains `distribution:{"5":n,"4":n,"3":n,"2":n,"1":n}` over **published** reviews.
- `POST /api/cart/items/bulk/ {listing, lines:[{variant, quantity}]}` → 201 cart; **all-or-nothing** in one `transaction.atomic()` under the cart row lock; each line refused if the variant is not this listing's, not available, or `quantity` exceeds a counted `stock_quantity` (400 `{"lines":[{"index":n,"detail":...}]}`); merges into an existing `(cart, listing, variant)` line; runs `cart.guard.check_add` on the locked cart; listing without variants → 400.
- Checkout-status fields only expose what the owner of the session already may see (no metadata).

- [ ] **Step 1: Write the failing tests.** `test_also_viewed.py`: `test_records_one_view_per_viewer_listing_day`, `test_anonymous_viewer_id_is_hashed_not_stored_raw`, `test_co_viewed_needs_three_distinct_viewers_per_row`, `test_fewer_than_four_qualifying_rows_falls_back_to_same_category_with_basis_flag`, `test_views_older_than_30_days_are_ignored`, `test_hidden_business_and_draft_listings_never_appear`, `test_anchor_is_excluded`, `test_recording_is_throttled`. `test_review_distribution.py`: `test_counts_only_published_reviews`, `test_empty_listing_returns_all_zero_counts`. `test_bulk_add.py`: `test_adds_several_variants_in_one_call`, `test_one_sold_out_variant_rejects_everything_and_writes_nothing`, `test_quantity_over_counted_stock_is_refused_per_line`, `test_untracked_stock_has_no_cap`, `test_merges_into_the_existing_variant_line`, `test_variant_of_another_listing_refused`, `test_cart_guard_refusal_writes_nothing` (5th shop / 3 km rule), `test_staff_forbidden`, `test_two_simultaneous_bulk_adds_do_not_exceed_stock_or_duplicate_lines` (threaded). `test_session_status_fields.py`: `test_owner_sees_processing_fee_wallet_flag_and_order_id`, `test_another_customers_session_is_404`.
- [ ] **Step 2: Run to see them fail** — one command per module, e.g. `docker compose run --rm web python manage.py test cart.tests.test_bulk_add`.
- [ ] **Step 3: Implement.** Reuse `listings.visibility.hidden_business_q()` for every public list (backend/CLAUDE.md). If Plan 1 already records listing/category visits, reuse its table instead of `ListingView` (adapt names in Step 1 and delete the model step).
- [ ] **Step 4: Run to pass** — the four new modules plus `listings`, `reviews`, `cart`, `payments` apps; `makemigrations --check --dry-run`.
- [ ] **Step 5: Commit** — `feat(storefront): also-viewed, review histogram, atomic variant add and richer cart and checkout-status reads`.

## Task 4: Product gallery — hover-zoom side pane and the image/video lightbox

**Files:**
- Create: `frontend/components/shop/ProductGallery.jsx`, `frontend/components/shop/GalleryLightbox.jsx`, `frontend/lib/zoomMath.js`, `frontend/components/__tests__/ProductGallery.test.jsx`, `frontend/lib/zoomMath.test.js`
- Modify: `frontend/mocks/handlers.js` (default `media` fixture helper only if needed)

**Interfaces:**
- `ProductGallery({ media, title, activeVariantImage, onOpen })` — `media` per Plan 2 B2. Main image (square, `object-fit: contain`), a vertical thumbnail rail (up to 9 images + a video tile `▶ Videos (n)` when any), "Click to see full view" caption, hover-zoom: on `(hover: hover) and (pointer: fine)` a lens follows the cursor and a **side pane over the buy-box column** shows the region at **2.5×**; the pane appears on `mouseenter`, hides on `mouseleave`, never on touch. Selecting a variant with an image swaps the main image (`activeVariantImage`).
- `lib/zoomMath.js`: `lensRect(box, cursor, zoom, pane) -> {x,y,w,h}` clamped inside the box; `paneOffset(lens, box, zoom) -> {x,y}`.
- `GalleryLightbox({ media, startIndex, title, onClose })` — modal (`role="dialog" aria-modal`, focus trapped, Esc and backdrop close, returns focus), tabs **Images | Videos** (a tab hidden when empty), large slide with prev/next buttons and ArrowLeft/ArrowRight, the thumbnail grid on the right (desktop) selecting the slide, slide transition off under `usePrefersReducedMotion()`. Uploaded video: `<video controls playsInline preload="metadata" poster={thumb_url}>`, one plays at a time (changing slide pauses). YouTube: an `<iframe>` on `https://www.youtube-nocookie.com/embed/<youtube_id>` rendered **only** when `youtube_id` matches `^[\w-]{11}$`.

- [ ] **Step 1: Write the failing tests.** `zoomMath.test.js`: `test_lens_is_clamped_to_the_image_box`, `test_pane_offset_scales_by_zoom`. `ProductGallery.test.jsx`: `test_renders_main_image_and_one_thumbnail_per_image`, `test_hover_shows_the_zoom_pane_and_leave_hides_it`, `test_no_zoom_pane_when_hover_is_unavailable` (stub `matchMedia` via `test/matchMedia.js`), `test_clicking_a_thumbnail_changes_the_main_image`, `test_variant_image_replaces_the_main_image`, `test_click_opens_the_lightbox_at_that_image`, `test_lightbox_arrows_and_keyboard_move_between_slides`, `test_escape_closes_and_returns_focus`, `test_videos_tab_lists_uploaded_and_youtube_and_is_hidden_when_none`, `test_changing_slide_pauses_the_playing_video` (spy on `HTMLMediaElement.prototype.pause`), `test_bad_youtube_id_renders_no_iframe`, `test_empty_media_renders_a_placeholder_not_a_broken_image`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/__tests__/ProductGallery.test.jsx lib/zoomMath.test.js`.
- [ ] **Step 3: Implement** (inline `C` styles; a component-local `<style>` only for the lightbox `@media` rules).
- [ ] **Step 4: Run to pass**, then `npx vitest run` (full, from `frontend/`).
- [ ] **Step 5: Commit** — `feat(product): hover-zoom gallery and image/video lightbox`.

## Task 5: Phone full-screen gallery with pinch-zoom

**Files:**
- Create: `frontend/components/shop/MobileGallery.jsx`, `frontend/lib/pinchMath.js`, `frontend/lib/pinchMath.test.js`, `frontend/components/__tests__/MobileGallery.test.jsx`
- Modify: `frontend/components/shop/ProductGallery.jsx` (below the phone breakpoint `useBreakpoint()` ≤760 a tap opens `MobileGallery` instead of the lightbox; swipeable strip replaces the thumbnail rail)

**Interfaces:**
- `lib/pinchMath.js`: `distance(p1, p2)`, `nextScale(startScale, startDistance, currentDistance, {min:1, max:4})`, `clampPan(pan, scale, box)`, `isSwipe(dx, dy, {minDx:50})` (horizontal dominance and only at scale 1).
- `MobileGallery({ media, startIndex, onClose })` — full-screen (`100dvh`), pointer-events based (no library): two-finger pinch zooms 1–4×, drag pans when zoomed, **double-tap toggles 2×**, horizontal swipe changes slide at scale 1, a counter "3 / 9", close button; opens a history entry so the **Back button closes it** (`history.pushState` + `popstate`), restores body scroll on close; videos get native controls.

- [ ] **Step 1: Write the failing tests.** `pinchMath.test.js`: `test_scale_follows_the_finger_distance_ratio`, `test_scale_is_clamped_between_1_and_4`, `test_pan_cannot_move_the_image_off_its_box`, `test_swipe_needs_50px_and_horizontal_dominance`, `test_no_swipe_while_zoomed`. `MobileGallery.test.jsx`: `test_tap_on_phone_opens_the_full_screen_gallery` (breakpoint stubbed via `useBreakpoint` mock), `test_double_tap_toggles_zoom` (fire two `pointerdown`s within 300 ms; assert transform `scale(2)`), `test_swipe_left_goes_to_the_next_slide`, `test_back_button_closes_the_gallery` (dispatch `popstate`), `test_close_button_restores_scroll`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run lib/pinchMath.test.js components/__tests__/MobileGallery.test.jsx`.
- [ ] **Step 3: Implement.** Use `touch-action: none` on the zoom surface; never `preventDefault` on passive listeners.
- [ ] **Step 4: Run to pass**, then the full suite.
- [ ] **Step 5: Commit** — `feat(product): phone full-screen gallery with pinch-zoom`.
- Manual (recorded in the PR, not Vitest — jsdom has no touch): on a real phone, pinch, double-tap, swipe, Back, rotate.

## Task 6: Variant picker with a quantity per variant, and the buy box

**Files:**
- Create: `frontend/components/shop/VariantPicker.jsx`, `frontend/components/shop/BuyBox.jsx`, `frontend/components/shop/PriceTag.jsx`, `frontend/hooks/useAddToCartBulk.js`, `frontend/components/__tests__/VariantPicker.test.jsx`, `frontend/components/__tests__/BuyBox.test.jsx`
- Modify: `frontend/mocks/handlers.js` (default `POST /api/cart/items/bulk/`)

**Interfaces:**
- `PriceTag({ price, wasPrice, discountPercent })` — "GHS" small, whole part large, pesewas superscript, tabular figures; strikethrough "was" and `-NN%` only when `wasPrice` is non-null.
- `VariantPicker({ axes, variants, onPreview, selection, onChange })` — one chip row per axis (Colour/Size…); a combination with no variant, or `available: false`, renders dashed and not selectable (as the screenshot); picking a full combination adds that variant to **Your selection**: a list of rows (image, label, `PriceTag`, quantity stepper, remove). Stepper bounds `0..stock_quantity` when counted, unbounded when `null`; at the bound "Only N left". Choosing an option previews its image/price (`onPreview`) without adding it. `selection` is `{[variantId]: quantity}`.
- `BuyBox({ item, user, selection, ..., onMessage, onSaveToList })` — price (or "Choose options" when variants exist and none selected), subtotal of the selection, "Sold by **{seller.display_name}**" with an **Ashanti Direct** badge when `is_ashanti_direct` and a link "More from Ashanti Direct" that sets the browse filter `seller=ashanti_direct`; "Delivery fee is worked out at checkout from your GhanaPost address"; stock line from the server only ("In stock" / "Only N left" / "Out of stock"); payment line "Pay with mobile money or your AshantiHub wallet"; **Add to cart** (gold; disabled with the exact reason: out of stock, no price, opening gate "Opens 6 Nov", staff gate via `useStaffGate`, or the cart-guard message from `useCartGuard`); "Add to list"; "Report an issue with this item" and "Contact Support" both call `onMessage`. Empty `<section id="other-sellers" />` reserved for Plan 6F. Returns/warranty rows only from the listing's own policy fields when non-blank.
- `useAddToCartBulk()` — returns `add(listingId, selection)`; posts to `/api/cart/items/bulk/` (listings without variants post `/api/cart/items/`), sets local `actionError` from the server's per-line message, invalidates `['cart']` and `['cart-guard']`.

- [ ] **Step 1: Write the failing tests.** `VariantPicker.test.jsx`: `test_unavailable_combinations_are_dashed_and_cannot_be_chosen`, `test_choosing_a_combination_adds_a_selection_row_with_quantity_1`, `test_several_variants_each_keep_their_own_quantity`, `test_stepper_stops_at_counted_stock_and_says_only_n_left`, `test_untracked_stock_has_no_upper_bound`, `test_removing_a_row_clears_it`, `test_preview_shows_image_without_adding`. `BuyBox.test.jsx`: `test_price_has_no_was_price_when_the_server_sends_none`, `test_was_price_and_percent_render_when_sent`, `test_no_delivery_date_is_shown`, `test_add_is_disabled_with_opens_6_nov_before_opening`, `test_add_is_disabled_at_zero_stock_with_out_of_stock`, `test_add_posts_one_bulk_request_with_every_selected_variant`, `test_server_line_error_is_shown_and_cart_not_refetched_as_changed`, `test_staff_session_sees_the_staff_notice_instead_of_adding`, `test_cart_guard_block_message_disables_add`, `test_sold_by_shows_display_name_and_ashanti_direct_badge`, `test_there_is_no_business_phone_or_whatsapp_link` (query by `href^="tel:"`, `wa.me`), `test_report_issue_calls_onMessage`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/__tests__/VariantPicker.test.jsx components/__tests__/BuyBox.test.jsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then the full suite.
- [ ] **Step 5: Commit** — `feat(product): variant picker with per-variant quantities and the buy box`.

## Task 7: Product page assembly, carousels and reviews (no Q&A)

**Files:**
- Create: `frontend/components/shop/ProductPage.jsx`, `frontend/components/shop/ProductCarousel.jsx`, `frontend/components/shop/ReviewHistogram.jsx`, `frontend/hooks/useAlsoViewed.js`, `frontend/hooks/useSponsored.js`, `frontend/hooks/useRecordView.js`, `frontend/components/__tests__/ProductPage.test.jsx`, `frontend/components/__tests__/ProductCarousel.test.jsx`
- Modify: `frontend/components/ListingDetailPage.jsx` (default export becomes the chooser: `useListing(id)` → goods (`category.kind` `product` or `food`) render `ProductPage`; others render the existing body renamed `ServiceListingDetail`; remove `QASection`, `QuestionRow`, the `qanda` tabs from `PRODUCT_TABS` and `SERVICE_TABS`, and the `useListingQuestions` import), `frontend/components/ScrollSpyTabs.jsx` (optional `trailing` prop, rendered at the bar's right: the mini title + price once scrolled), `frontend/ListingDetailPage.test.jsx` (Q&A assertions removed; reason in commit), `frontend/mocks/handlers.js` (defaults: also-viewed, sponsored, wishlist, bulk add — contract shapes from Dependencies)

**Interfaces:**
- `ProductPage({ id, onBack, user, favourites, onFavourite, currency, onMessage, onOpenListing, onAddToCart, CardComponent })` — same props as today so `App.jsx` (~line 3257) is unchanged. Layout (desktop): breadcrumb (A4) · `ProductGallery` | title, seller line, rating row (hidden at `review_count` 0), `VariantPicker`, key facts, **About this item** bullets (description split on newlines; empty → section omitted) | `BuyBox` + one Sponsored card; phone: single column, gallery first, buy box before details. Sticky `ScrollSpyTabs` sections: Top · About this item · Similar · Product information · Reviews (screenshot 10), mini title + price on the right. **Product information** is a collapsible group (Item details from `item.specs`, Warranty & returns from the listing's own fields); a group with no data is not rendered. `useRecordView(id)` posts one view after 3 s on screen.
- `ProductCarousel({ title, subtitle, items, sponsored, CardComponent, pageSize })` — "Page n of m" + prev/next buttons, scroll-snap on touch, hides itself when `items` is empty, a "Sponsored" label only when `sponsored`.
- Carousels: **Customers also viewed** (`useAlsoViewed(id)`; heading "Customers also viewed" iff `basis === "co_viewed"`, else "More in this category") and **Sponsored products** (`useSponsored({category, exclude})`).
- Reviews: `ReviewHistogram({ distribution, total, average })` (bars per star, percentage, nothing when total 0) + existing `ReviewsList` + `ReviewWriteForm` behind `useReviewEligibility` ("Write a customer review"). **No** AI summary, topics, helpful votes or review photos.

- [ ] **Step 1: Write the failing tests.** `ProductPage.test.jsx`: `test_goods_render_the_product_page_and_services_the_service_page`, `test_no_questions_and_answers_anywhere` (no "Q&A", no `/api/qa/` request), `test_breadcrumb_uses_ancestors_when_present_and_one_crumb_otherwise`, `test_rating_row_is_hidden_when_review_count_is_zero`, `test_histogram_renders_percentages_from_the_server_counts`, `test_sticky_strip_has_the_five_sections`, `test_empty_about_and_empty_info_groups_are_not_rendered`, `test_other_sellers_anchor_exists_and_is_empty`, `test_records_a_view_once_after_three_seconds` (fake timers), `test_a_sold_out_listing_still_renders_but_cannot_be_added`, `test_phone_layout_puts_gallery_then_buy_box_then_details`. `ProductCarousel.test.jsx`: `test_heading_says_customers_also_viewed_only_for_co_viewed_basis`, `test_same_category_basis_uses_the_honest_heading`, `test_sponsored_label_only_when_sponsored`, `test_hides_when_empty`, `test_page_counter_and_arrows_move_pages`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/__tests__/ProductPage.test.jsx components/__tests__/ProductCarousel.test.jsx ListingDetailPage.test.jsx`.
- [ ] **Step 3: Implement.** Moving `ListingDetailPage` internals: keep `OverviewSection`, `SpecsSection`, `WarrantySection`, `PolicySection`, `ReviewsSection`, `SellerRatingBadge`, `CompareSection`, `MoreOptionsSection` where they are, exported for `ProductPage` reuse rather than copied.
- [ ] **Step 4: Run to pass**, then the full suite (`App.routing.test.jsx` and `EventDetailPage.test.jsx` must stay green untouched).
- [ ] **Step 5: Commit** — `feat(product): Amazon-style product page, carousels and review histogram; drop Q&A`.

## Task 8: Cart page

**Files:**
- Create: `frontend/components/shop/CartPage.jsx`, `frontend/components/__tests__/CartPage.test.jsx`
- Modify: `frontend/App.jsx` (`PATH_TO_PAGE`/`PAGE_TO_PATH` add `cart: "/cart"` — the existing two-map convention; render `CartPage` for `page === "cart"`; the Navbar cart icon navigates to `/cart` instead of opening the drawer), `frontend/components/CartDrawer.jsx` (becomes the slim mini-cart: lines, subtotal, "Go to cart"; the whole checkout step moves to Task 10), `frontend/CartDrawer.test.jsx` and `frontend/App.cartTiers.test.jsx` (only where the drawer's checkout assertions move; reason in commit)

**Interfaces:**
- `CartPage({ user, currency, CardComponent })` — owns `useCart()`, `useCartGuard()`, `useOpeningGate()`. Left: "Shopping Cart" with one row per line (photo, name linked to the product, **variant label**, "Sold by …", stock line, quantity stepper where the minus becomes a trash icon at 1, **Delete**, **Save for later** = add to Your Lists via the wishlist API then delete the line), price column (tabular). Right: "Subtotal (n items): GHS x" and gold **Proceed to checkout** (navigates `/checkout`; disabled with the exact reason: empty cart, opening gate "Opens 6 Nov", cart-guard block text, staff gate). Under the lines: one plain line "Prices and availability are subject to change; the cart shows each item's latest price." No gift tickboxes, no compare, no share. Carousels below: **Sponsored products** and **Customers also viewed** (anchored on the first line's listing, honest heading rule from Task 7). Empty cart: heading, "Continue shopping", no fabricated suggestions beyond the Sponsored carousel.

- [ ] **Step 1: Write the failing tests.** `CartPage.test.jsx`: `test_lists_each_line_with_variant_label_and_sold_by`, `test_quantity_plus_minus_patch_the_line_and_refetch`, `test_minus_at_one_shows_a_trash_that_deletes`, `test_save_for_later_adds_to_the_wishlist_then_deletes_the_line`, `test_save_for_later_failure_keeps_the_line`, `test_subtotal_matches_the_server_total`, `test_proceed_is_disabled_before_opening_with_the_reason`, `test_proceed_is_disabled_with_a_guard_message`, `test_empty_cart_state_and_no_checkout_button`, `test_stock_refusal_message_from_the_server_is_shown_on_the_line`, `test_no_gift_or_compare_controls`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/__tests__/CartPage.test.jsx`.
- [ ] **Step 3: Implement** (and move nothing else out of the drawer yet; Task 10 completes the move).
- [ ] **Step 4: Run to pass**, then the full suite.
- [ ] **Step 5: Commit** — `feat(cart): cart page; the drawer becomes a mini-cart`.

## Task 9: Address picker — GhanaPost field, map pin, landmark, address book UI

**Files:**
- Create: `frontend/lib/ghanaPost.js`, `frontend/lib/ghanaPost.test.js`, `frontend/hooks/useAddresses.js`, `frontend/components/account/GhanaPostField.jsx`, `frontend/components/account/AddressForm.jsx`, `frontend/components/account/AddressPicker.jsx`, `frontend/components/account/YourAddresses.jsx`, `frontend/components/__tests__/AddressForms.test.jsx`

**Interfaces:**
- `lib/ghanaPost.js`: `normalizeGhanaPost(raw) -> string` (trim, upper-case), `ghanaPostError(raw) -> string|null` using the same pattern as the backend `^[A-Z]{2}-\d{3,4}-\d{4}$` and the first-letter `A` rule, with the backend's wording ("Enter a valid Ghana Post GPS address, e.g. AK-039-5028." / Ashanti-only message); a test pins that this regex string equals the one documented in `accounts/gps.py` (copy-check comment, not an import).
- `GhanaPostField({ value, onChange, error })` — auto-inserts hyphens as typed (`AK039` → `AK-039-`), helper text "Find yours in the GhanaPost GPS app", inline error.
- `AddressForm({ initial, onSave, onCancel })` — recipient name, phone, GhanaPost code, **landmark** (required, ≤200), optional street text, map pin via `LocationPicker` (existing; reverse-geocode fills the street text but never the GhanaPost code), "Make this my default". Saves with `apiPost`/`apiPatch` to `/api/accounts/addresses/`; server field errors shown beside their fields.
- `AddressPicker({ value, onChange })` — cards for the saved addresses with the default first and the chosen one ringed; "Add a new address" opens `AddressForm` inline; used by checkout.
- `YourAddresses()` — the screenshot's grid: dashed "Add address" tile, cards with name, GhanaPost code, landmark, phone, **Default** tag, Edit · Remove · Set as default. Remove asks to confirm. Empty state: only the Add tile.

- [ ] **Step 1: Write the failing tests.** `ghanaPost.test.js`: `test_accepts_AK_039_5028_and_four_digit_district_codes`, `test_rejects_wrong_shapes`, `test_rejects_non_ashanti_prefix_with_the_region_message`, `test_normalises_case_and_whitespace`. `AddressForms.test.jsx`: `test_field_inserts_hyphens_while_typing`, `test_form_requires_gps_and_landmark_and_shows_server_errors`, `test_pin_from_the_map_fills_lat_lng_and_street_but_not_the_gps_code`, `test_save_posts_normalised_values`, `test_picker_marks_default_and_selects_on_click`, `test_set_default_and_remove_call_the_api_and_refetch`, `test_remove_needs_confirmation`, `test_empty_state_shows_only_the_add_tile`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run lib/ghanaPost.test.js components/__tests__/AddressForms.test.jsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then the full suite.
- [ ] **Step 5: Commit** — `feat(account): GhanaPost address field, address picker and Your Addresses`.

## Task 10: Checkout page

**Files:**
- Create: `frontend/components/shop/CheckoutPage.jsx`, `frontend/components/shop/PaymentMethodPicker.jsx`, `frontend/components/shop/ProcessingLine.jsx`, `frontend/hooks/useWalletProcessing.js`, `frontend/components/__tests__/CheckoutPage.test.jsx`
- Modify: `frontend/App.jsx` (`checkout: "/checkout"`; passes `PaymentComponent={MoMoPayment}`), `frontend/components/CartDrawer.jsx` (delete its checkout step, address state and quote logic — they now live here)

**Interfaces:**
- `CheckoutPage({ user, currency, PaymentComponent })` — slim "Secure checkout" header (logo, link back to the cart). Left column, in order: **Delivering to** (the default address from `AddressPicker`, a Change link; a new door-to-door delivery cannot proceed until `GhanaPostField` + landmark + phone are valid — same client rule as Task 1); **Delivery method** (door-to-door / store pickup, existing `cart.guard` messages from `useCartGuard`; pickup hides the address block); **Payment** via `PaymentMethodPicker` (mobile money, or AshantiHub wallet showing the balance from `GET /api/wallet/`; wallet disabled with the server's reason when `ledger_off` or the balance is short; a one-line note "Your default payment method is not saved — you choose at checkout"); tickbox **"Default to this address"** (sets the default through `set-default`); **Review items** (read-only lines with the variant label and a quantity stepper). Right column: gold **Place your order in GHS** and the summary: Items · Delivery fee (existing `quoteCart`; "Choose a delivery point" until pinned; out-of-area message) · Discount (coupon, existing) · **Payment processing** (`ProcessingLine`: from `GET /api/wallet/processing/?amount=` for mobile money only; omitted on `ledger_off`; none for wallet) · **Order total**. No currency converter, no tax or import-charge lines (none exist).
- Place order: wallet → `POST /api/orders/checkout/ {payment_method:"wallet", …delivery fields}`; mobile money → existing `PaymentComponent` modal collects the paying number, then the same POST (`payment_method:"momo"`); a `redirect` answer goes to `checkout_url`; a 201 goes to `/checkout/verify?order=<id>`. Refusals (`out_of_area`, guard, "Only N left", `wallet_not_accepted`, `insufficient_funds`) show the server's `detail` and leave the cart untouched. The button is disabled pre-opening ("Opens 6 Nov"), for a staff session (`useStaffGate`), and while a request is in flight (a double click posts once).

- [ ] **Step 1: Write the failing tests.** `CheckoutPage.test.jsx`: `test_door_to_door_needs_a_valid_ghanapost_code_and_a_landmark_before_the_button_enables`, `test_pickup_needs_no_address`, `test_default_address_is_preselected`, `test_default_to_this_address_calls_set_default`, `test_wallet_option_shows_balance_and_is_disabled_when_short_or_ledger_off`, `test_processing_line_comes_from_the_server_for_momo_only`, `test_total_is_items_plus_delivery_plus_processing_minus_discount`, `test_wallet_order_posts_payment_method_wallet_with_gps_and_landmark`, `test_momo_order_opens_the_payment_component_then_posts`, `test_redirect_answer_navigates_to_checkout_url`, `test_201_navigates_to_verify_with_the_order_id`, `test_server_refusal_keeps_the_cart_and_shows_the_detail`, `test_double_click_posts_once`, `test_disabled_before_opening_with_opens_6_nov`, `test_staff_session_gets_the_staff_notice`, `test_out_of_area_pin_disables_the_button`, `test_no_card_digits_or_gift_card_fields_anywhere`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/__tests__/CheckoutPage.test.jsx`.
- [ ] **Step 3: Implement.** `LocationPicker` is globally stubbed in jsdom; the pin is verified manually in a browser.
- [ ] **Step 4: Run to pass**, then the full suite (`CartDrawer.test.jsx` updated in Task 8 must still pass).
- [ ] **Step 5: Commit** — `feat(checkout): secure checkout with a required GhanaPost address and wallet or mobile money`.

## Task 11: Payment verification page

**Files:**
- Create: `frontend/components/shop/PaymentVerifyPage.jsx`, `frontend/components/__tests__/PaymentVerifyPage.test.jsx`
- Modify: `frontend/App.jsx` (`"checkout-verify": "/checkout/verify"`; `PaymentReturnPage` is replaced by this component for both `/payment/return` and `/checkout/verify`, keeping the 2 s poll and 60 s timeout constants), `frontend/App.routing.test.jsx` only if its `/payment/return` assertions change copy (reason in commit)

**Interfaces:**
- `PaymentVerifyPage()` — reads `?reference=` (Hubtel return or session) and/or `?order=`. With a reference it polls `GET /api/payments/checkout-sessions/{reference}/` until `status !== "pending"` (the redirect URL is never trusted as proof); with only an order it reads `GET /api/orders/{id}/`. Layout follows the screenshot: centred card titled **Verify payment**, a "Transaction details" table — Merchant **AshantiHub**, Amount **GHS x** (`amount`), Payment processing (`processing_fee`, hidden at 0), Method (**AshantiHub wallet** when `wallet`, else **Mobile money**; the number is **never** shown), Reference, Order #. Pending state: "Approve the payment prompt on your phone" for mobile money (no code box: there is no card OTP in this product, so none is drawn); success → "Payment confirmed" with **View your order** (`/my-account/orders`) and **Continue shopping**; failed/expired → the reason and **Try again** (back to `/checkout`) and **Exit** (cart). Timeout copy: "We are still waiting for the provider — check Your Orders for the latest status." Never claims success from the URL alone.

- [ ] **Step 1: Write the failing tests.** `PaymentVerifyPage.test.jsx`: `test_polls_until_the_status_leaves_pending_then_stops`, `test_success_shows_confirmed_with_the_amount_processing_fee_and_method`, `test_wallet_payment_says_wallet_and_shows_no_phone_number`, `test_failed_shows_try_again_and_exit`, `test_timeout_after_60_seconds_shows_the_honest_wait_message` (fake timers), `test_the_return_url_alone_never_shows_success`, `test_order_only_link_reads_the_order_and_shows_its_status`, `test_missing_reference_and_order_shows_an_error`, `test_another_customers_reference_404_shows_the_error_state`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/__tests__/PaymentVerifyPage.test.jsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then the full suite.
- [ ] **Step 5: Commit** — `feat(checkout): payment verification page`.

## Task 12: Your Account hub and its sections

**Files:**
- Create: `frontend/components/account/AccountHub.jsx`, `frontend/components/account/accountNav.js`, `frontend/components/account/YourOrders.jsx`, `frontend/components/account/OrdersPanel.jsx` (moved from `OrdersDeliveryTab` in `App.jsx` ~line 2115, same behaviour: tracking map, confirm receipt, dispute — App-owned pieces arrive as props), `frontend/components/account/LoginSecurity.jsx`, `frontend/components/account/CustomerService.jsx`, `frontend/components/__tests__/AccountHub.test.jsx`
- Modify: `frontend/App.jsx` (`UserPanel` keeps its export and props but renders `AccountHub`; `ACCOUNT_NAV_ITEMS`/`ACCOUNT_NAV_GROUPS` replaced by `accountNav.js`; sub-routes `/my-account/:section` and `/my-account/payments/:tab` read through `useMatch` and added to `KNOWN_PATHS` handling so they are never a 404), `frontend/UserPanel.test.jsx` (sidebar-tab assertions replaced by tile and section assertions; reason in commit)

**Interfaces:**
- Hub at `/my-account`: a 3-column tile grid on desktop, 1 column on phones, in this order — **Your Orders** · **Login & security** · **Your Addresses** · **Your Payments** · **Your Lists** · **Customer Service** · **Your Messages** · **Sell on AshantiHub** (Task 13). **Dropped** vs Amazon: Prime, Gift cards, Amazon Family, Digital Services and every "Manage…" link list.
- Sections (URL-addressable, Back steps between them, breadcrumb "Your Account › …"): `orders`, `security`, `addresses`, `payments/{overview|wallet|transactions|settings}`, `lists`, `messages`, `help`, `sell`.
- **Your Orders** keeps everything the old tabs held, as tabs: *Orders* (screenshot layout: placed date, total, "Ship to", order #, "Track package" (existing map), "View order", "Write a product review" (existing `ReviewWriteForm`), "Buy it again" (re-adds the lines via the bulk add; a line that is gone says so), a "past 3 months / 6 months / all" filter and "Search all orders" done client-side over the loaded page) · *Bookings* (`MyBookingsTab`) · *Service requests* (`ServiceRequestsTab`) · *Tickets* · *My events*. Order cards show the GhanaPost code and landmark when the order has them.
- **Login & security:** rows for what the backend supports today — Name, Email, Primary mobile number, secondary email/phone verification (existing `AccountProfileCard`/`auth` calls), Password ("Reset by email or phone" using the existing reset flow), and 2-step verification only when Plan 2F's screens exist (otherwise the row is omitted, not stubbed); no passkey row.
- **Your Messages:** `MessagingCenter embedded`, titled "Your Messages", with "Messages with AshantiHub Support" only (no third-party sellers tab, no email/text/phone-call tabs).
- **Customer Service:** "Contact Support" (opens a new Support conversation), links to the existing About FAQ and Contact page, and "Report a problem with an order" (→ Orders). No phone numbers.
- Customer-only gate and loading gate from today's `UserPanel` are kept verbatim.

- [ ] **Step 1: Write the failing tests.** `AccountHub.test.jsx`: `test_hub_shows_exactly_the_eight_tiles_in_order`, `test_no_prime_gift_card_family_or_digital_tiles`, `test_each_tile_navigates_to_its_section_url`, `test_signed_out_and_business_owner_see_the_customer_gate`, `test_orders_tab_shows_order_header_fields_and_gps_and_landmark`, `test_buy_it_again_adds_the_lines_and_reports_a_missing_one`, `test_orders_search_filters_loaded_orders`, `test_orders_tabs_still_reach_bookings_requests_tickets_events`, `test_login_security_has_no_passkey_row_and_hides_two_step_until_available`, `test_messages_has_no_third_party_sellers_tab`, `test_customer_service_has_no_phone_numbers`, `test_deep_link_to_payments_wallet_opens_that_tab`, `test_back_button_returns_to_the_previous_section`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/__tests__/AccountHub.test.jsx UserPanel.test.jsx`.
- [ ] **Step 3: Implement** (move `OrdersDeliveryTab`, do not rewrite it; `YourAddresses` from Task 9 mounts at `addresses`).
- [ ] **Step 4: Run to pass**, then the full suite (`App.routing.test.jsx` `/my-account` cases must stay green).
- [ ] **Step 5: Commit** — `feat(account): Your Account hub with orders, security, messages and customer service`.

## Task 13: Your Lists (wishlist) and Sell on AshantiHub

**Files:**
- Create: `frontend/hooks/useWishlist.js`, `frontend/components/account/YourLists.jsx`, `frontend/components/account/SellOnAshantiHub.jsx`, `frontend/components/__tests__/YourLists.test.jsx`, `frontend/components/__tests__/SellOnAshantiHub.test.jsx`
- Modify: `frontend/App.jsx` (`favourites`/`toggleFav` read and write the server wishlist for a signed-in customer; the old local-only state remains for signed-out visitors), `frontend/components/BusinessRegistrationFlow.jsx` (seed the personal-info fields from `prefill.full_name`, `prefill.phone`, `prefill.email`; nothing else changes), `frontend/BusinessRegistrationFlow.test.jsx` (add cases only)
- Step 0 (conditional backend): if Plan 1 shipped no wishlist API, create it exactly per contract A3 — `listings.WishlistItem(customer, listing, added_at)` unique `(customer, listing)`, hidden-business listings excluded from `GET`, tests `backend/listings/tests/test_wishlist.py` (`test_add_is_idempotent`, `test_another_customers_item_is_not_visible_or_deletable`, `test_hidden_business_item_is_not_listed`, `test_staff_forbidden`); commit separately.

**Interfaces:**
- `useWishlist({ enabled })` → `{items, add(listingId), remove(listingId)}` (plain `apiPost`/`apiDelete`, refetch on success).
- `YourLists()` — a single private list "Shopping List" (default list, labelled Private): search this list, sort (most recently added / name / price), grid or list toggle, per item: image, name, price (`PriceTag`), "Item added {date}", **Add to cart** (variant listings send the shopper to the product page to choose options), **Remove**. Empty state "Nothing saved yet — tap the heart on any item." No multiple lists, invite, gift finder, baby registry or friends tab (not built, not drawn).
- `SellOnAshantiHub({ user, auth, onStart })` — left card (screenshot "Welcome, {name}"): the customer's name, email and phone, buttons **Use my details** (`prefill` = name/phone/email) and **Start with different details**; right panel "Why sell on AshantiHub" with only real features: shoppers across the Ashanti region, a Verified business badge after KYC, payouts to mobile money or bank through your AshantiHub wallet. One plain disclosure line: "This creates a separate business login." A customer whose contact is already used by a business account sees the server's registration message, never a silent failure.

- [ ] **Step 1: Write the failing tests.** `YourLists.test.jsx`: `test_lists_server_items_newest_first`, `test_remove_calls_delete_and_refetches`, `test_add_to_cart_posts_for_a_simple_product_and_links_to_the_page_for_variants`, `test_search_and_sort_work_on_the_loaded_items`, `test_empty_state`, `test_heart_on_a_card_adds_and_removes_through_the_api_when_signed_in`, `test_signed_out_heart_keeps_the_local_behaviour`, `test_no_multi_list_or_registry_controls`. `SellOnAshantiHub.test.jsx`: `test_welcome_shows_the_customers_name_email_and_phone`, `test_use_my_details_opens_registration_prefilled`, `test_start_fresh_opens_registration_empty`, `test_separate_login_line_is_shown`, `test_duplicate_contact_server_message_is_displayed`, `test_self_registration_path_still_reaches_the_personal_info_step` (guards Plan 3's registration changes).
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/__tests__/YourLists.test.jsx components/__tests__/SellOnAshantiHub.test.jsx BusinessRegistrationFlow.test.jsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then the full suite.
- [ ] **Step 5: Commit** — `feat(account): Your Lists on the server wishlist and Sell on AshantiHub`.

## Task 14: Shopper wallet — Overview, Transactions and top-up

**Files:**
- Create: `frontend/hooks/useWallet.js`, `frontend/hooks/useWalletTransactions.js`, `frontend/hooks/useTopUp.js`, `frontend/components/account/wallet/WalletTabs.jsx`, `frontend/components/account/wallet/WalletOverview.jsx`, `frontend/components/account/wallet/WalletTransactions.jsx`, `frontend/components/account/wallet/TopUpDialog.jsx`, `frontend/components/account/wallet/walletErrors.js`, `frontend/components/__tests__/WalletOverview.test.jsx`, `frontend/components/__tests__/WalletTransactions.test.jsx`
- Modify: `frontend/mocks/handlers.js` (defaults for `/api/wallet/*`: ledger on, balance `"0.00"`, empty lists)

**Interfaces:**
- Hooks are **holder-agnostic** (`useWallet()` returns the server summary as is; a vendor shape is passed through untouched) so 3F/4F/5F can reuse them. `useWalletTransactions(page)` reads the DRF envelope (`data.results`, `next`) — note the paginated-hook rule in `frontend/CLAUDE.md`.
- `walletErrors.js`: `walletMessage(error) -> {text, kind}` — `409 ledger_off` → "Wallets aren't switched on yet." (kind `off`); otherwise the server's `detail`; never a client-made reason.
- `WalletTabs` — the underlined tab bar **Overview · Wallet · Transactions · Settings** at `/my-account/payments/<tab>` with the breadcrumb "Your Account › Your Payments › …".
- `WalletOverview` — a balance card "AshantiHub wallet · GHS {balance}" with **Top up** and **Withdraw** (the latter jumps to the Wallet tab's withdraw form), and **Recent activity** (the last 5 transactions, "See all" → Transactions). No gift-card, rewards or offers blocks.
- `TopUpDialog` — amount input validated like the server (digits, ≤2 decimals, > 0); on a valid amount asks `GET /api/wallet/processing/?amount=` and shows "You pay GHS {you_pay} (includes GHS {payment_processing} payment processing); GHS {amount} reaches your wallet"; **Top up** posts `/api/wallet/top-up/`; `mode:"immediate"` refetches the balance; `mode:"redirect"` goes to `checkout_url` (returns through `/payment/return`).
- `WalletTransactions` — a table/list of `label`, signed `amount` (in green / out red with an arrow, not colour alone), date, and a link to the order when `order` is set; "Load more" follows `next`; empty state "You don't have any transactions yet." + Continue shopping. Filter chips Top-ups · Purchases · Refunds · Withdrawals map to `kind` groups **only if the server's `kind` values allow it** (read `wallets/services.py` `LABELS`); otherwise no chips.

- [ ] **Step 1: Write the failing tests.** `WalletOverview.test.jsx`: `test_shows_the_balance_from_the_server_with_two_decimals`, `test_ledger_off_shows_the_not_switched_on_state_on_every_wallet_tab`, `test_top_up_shows_the_processing_line_before_paying`, `test_top_up_rejects_bad_amounts_without_a_request` (`"", "0", "1.234", "abc", "-5"`), `test_immediate_top_up_refreshes_the_balance`, `test_redirect_top_up_navigates_to_checkout_url`, `test_server_refusal_text_is_shown_verbatim`, `test_no_gift_card_points_or_offer_blocks`, `test_recent_activity_shows_five_rows_and_see_all`. `WalletTransactions.test.jsx`: `test_in_and_out_rows_carry_a_sign_and_an_arrow_not_just_colour`, `test_order_rows_link_to_the_order`, `test_load_more_follows_next_and_appends`, `test_empty_state_text`, `test_ledger_off_state`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/__tests__/WalletOverview.test.jsx components/__tests__/WalletTransactions.test.jsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then the full suite.
- [ ] **Step 5: Commit** — `feat(wallet): shopper wallet overview, transactions and top-up`.

## Task 15: Shopper wallet — Wallet tab (payout numbers, withdrawals) and Settings

**Files:**
- Create: `frontend/hooks/useWalletDestinations.js`, `frontend/hooks/useWithdrawals.js`, `frontend/components/account/wallet/DestinationsList.jsx`, `frontend/components/account/wallet/AddDestinationForm.jsx`, `frontend/components/account/wallet/WithdrawForm.jsx`, `frontend/components/account/wallet/WithdrawalHistory.jsx`, `frontend/components/account/wallet/WalletSettings.jsx`, `frontend/components/__tests__/WalletAccounts.test.jsx`, `frontend/components/__tests__/WalletSettings.test.jsx`
- Step 0 (dependency check): confirm Plan 2F's step-up prompt exists (grep `step_up_required` in `frontend/apiClient.js` / `frontend/components`). If it does not, **stop**: 2F's step-up piece ships first (Dependencies).

**Interfaces:**
- `useWalletDestinations()` → `{results, cooling_hours}` (masked as the server sends; the page never has an unmasked number to show). `useWithdrawals()` is the DRF envelope (`data.results`, `next`).
- **Wallet tab** — title "Mobile money numbers for withdrawals" with the line "These numbers receive withdrawals. You pay with mobile money at checkout by entering the number each time." Card per destination: network, masked number, verified account name, and "can receive money from {usable_from}" while cooling (`cooling_hours` explained: "A new number can receive money after {n} hours"). **Add a mobile money number** → `AddDestinationForm` (rail `momo`, network, number) posts `/api/wallet/destinations/` through the step-up prompt, shows the server's name-match result and refusal text; **Remove** posts `…/remove/` through step-up and confirms first. No card forms, no "Edit".
- `WithdrawForm({ destinations, balance })` — pick a destination, amount (same validation as top-up), one `request_id` (UUID) generated **when the form opens** and reused for retries of the same submit, regenerated only after a success or a deliberate amount/destination change; POST `/api/wallet/withdrawals/` through the step-up prompt; on 201/200 shows the created row's `charge` and **you_receive** and `status_label`; refusal codes from `wallets/withdrawals.py` render their server `detail` (`destination_cooling`, `insufficient_funds`, `over_limit`, `daily_limit`, `below_charge`, `name_mismatch`, `id_required`, `payouts_unavailable`, `suspended`, `duplicate_request`); no client-side limit maths and no pre-estimate of the charge.
- `WithdrawalHistory` — the withdrawal rows (amount, charge, you receive, status label, date, masked destination); **Cancel** (`…/cancel/`) only while `status` is still cancellable per the server's `not_pending` answer (the button always tries and shows the server's reply).
- **Settings tab** — "Your default purchase preference" card: **Default delivery address** (the default `CustomerAddress` from Task 2 with Update → `YourAddresses`; none → "No default address yet — add one"), and **Payment method**: "Not saved: you choose mobile money or your wallet at checkout." A link to "Login & security". No back-up payment method, no "edit payment method for an order".

- [ ] **Step 1: Write the failing tests.** `WalletAccounts.test.jsx`: `test_lists_masked_numbers_only_and_never_a_full_number`, `test_cooling_destination_shows_can_receive_from`, `test_add_number_goes_through_the_step_up_prompt_and_retries_once_with_the_token`, `test_add_refusal_text_is_shown`, `test_remove_confirms_then_posts_with_step_up`, `test_withdraw_sends_one_request_id_across_a_double_click`, `test_withdraw_retry_after_a_network_error_reuses_the_request_id`, `test_request_id_changes_after_a_successful_withdrawal`, `test_success_shows_charge_you_receive_and_status`, `test_each_refusal_code_shows_the_server_detail` (table-driven over the ten codes above), `test_no_charge_is_estimated_before_submitting`, `test_history_lists_rows_and_cancel_shows_the_servers_reply`, `test_ledger_off_state`, `test_no_card_fields_exist`. `WalletSettings.test.jsx`: `test_shows_the_default_address_or_the_add_prompt`, `test_payment_method_line_says_it_is_chosen_at_checkout`, `test_no_default_payment_method_control`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/__tests__/WalletAccounts.test.jsx components/__tests__/WalletSettings.test.jsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then the full suite.
- [ ] **Step 5: Commit** — `feat(wallet): shopper payout numbers, withdrawals and wallet settings`.

## Task 16: Closeout — conformance sweep, responsive audit, docs

**Files:**
- Modify: `frontend/CLAUDE.md` (the `components/shop` and `components/account` folders, the `ListingDetailPage` chooser, "the cart lives at /cart; CartDrawer is a mini-cart", the holder-agnostic wallet hooks, "never build a second step-up prompt"), `CLAUDE.md` (Product rules: add "no delivery dates, no payment-method model → no default payment method, GhanaPost required for door-to-door"), `docs/UI_MODERNIZATION_ROADMAP.md` or `docs/IMPLEMENTATION_INSTRUCTIONS.md` (mark Plan 4 built), `docs/superpowers/specs/2026-10-19-marketplace-rebrand-design.md` (Plan 4 status line; record the three builder's calls: GhanaPost required for door-to-door only, payout numbers are not payment methods, Your Orders carries the service/booking/ticket/event tabs)
- Create: `frontend/components/__tests__/ShopperNoInventionSweep.test.jsx`

- [ ] **Step 1: Write the failing sweep test** — renders ProductPage (rating 0, no was-price, no co-view data), CartPage, CheckoutPage, PaymentVerifyPage, AccountHub and each wallet tab with default MSW data and asserts across all of them: no `a[href^="tel:"]`, no `wa.me`, no text matching `/Prime|Gift card|reward points|Q&A|bought in past month|Arriving|delivery on (Mon|Tue|Wed|Thu|Fri|Sat|Sun)/i`, no "0.0" rating text, and that every price element uses `font-variant-numeric: tabular-nums`.
- [ ] **Step 2: Run to see it fail** (or pass after fixing real findings) — `cd frontend && npx vitest run components/__tests__/ShopperNoInventionSweep.test.jsx`.
- [ ] **Step 3: Fix findings, then run the checks** — full frontend suite from `frontend/`; `npm run build`; `docker compose run --rm web python manage.py test orders cart accounts listings reviews payments wallets`; `scripts/staff-layout-audit.js` is staff-only, so instead check each new page at 360, 768 and 1280 px in a browser for horizontal overflow and `DESIGN.md` conformance (gold only on actions and prices, cream canvas, Fraunces headings, tabular figures); record the real-phone gesture check from Task 5.
- [ ] **Step 4: Commit** — `docs(shopper): Plan 4 closeout, conventions and conformance sweep`.
- [ ] **Step 5: Stop.** Deploy to staging only on the user's go-ahead via the `deploy` skill; production only on an explicit "promote to production".

## Assumptions made (decided here, cheap to change — for the owner to confirm)

- **S1** GhanaPost code and landmark are required for **door-to-door**; store pickup needs neither. Ashanti-only, reusing `validate_ashanti_gps`.
- **S2** "Customers also viewed" needs 3 co-viewers per row and at least 4 qualifying rows, else the carousel says "More in this category". Views are kept 30 days.
- **S3** The wallet's "saved mobile money numbers" are the existing payout destinations (for withdrawals only); there are no saved cards, no default payment method and no "default" mark on a number.
- **S4** Your Orders also holds Bookings, Service requests, Tickets and My events as tabs so no existing feature is lost when the sidebar goes.
- **S5** Cart "Save for later" means "move to Your Lists"; there is no separate saved-for-later list.
- **S6** No delivery dates anywhere until a real ETA source exists; the buy box and checkout say the delivery fee is worked out from the GhanaPost address.

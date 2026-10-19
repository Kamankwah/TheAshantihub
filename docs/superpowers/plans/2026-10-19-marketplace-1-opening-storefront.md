# Marketplace Plan 1 — Opening-Day Storefront Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship, before 6 Nov 2026 06:00 Africa/Accra, a read-only Amazon-style marketplace home under a server-timed countdown that opens by itself, with Notify-me, hero slider, flash banner, Deals, most-visited categories, the Amazon department tree, footer, form-only Contact page, a working light/dark toggle and a Support-only chatbot intake.

**Architecture:** A new Django app `storefront` owns the opening time, the test-account allowlist, Notify-me and the public home feeds. The gate is one function (`storefront.opening.is_open`) read by one DRF permission (`storefront.permissions.MarketplaceOpen`) added to the shopper purchase views. Existing models are extended rather than duplicated: `listings.Category` gets a parent tree, `listings.HeroMediaSubmission` gets video, dates and staff-made slides, `marketing.Banner` gets a direct-publish `flash` slot, `listings.Listing` gets `sale_price` and `sponsored`, and `messaging.Conversation` gets contact details and a `chatbot` source. The frontend adds a `StorefrontHome` page at `/` plus small hooks, in the flat inline-`C` style.

**Tech Stack:** Django 5.2 / DRF / Postgres / Celery beat (eager under tests); React + React Query + Vitest + MSW (flat `frontend/`, no `src/`); SMS and email only through `otp.senders.send_sms` / `send_email`.

**Spec:** `docs/superpowers/specs/2026-10-19-marketplace-rebrand-design.md` — "Plan 1 — Opening-day storefront" and "Decisions from the builder check". Also read `CLAUDE.md` (Product rules), `backend/CLAUDE.md` (moderated-queue contract, hidden businesses, approvals), `frontend/CLAUDE.md` and `DESIGN.md` (gold/cream/brown, Fraunces + Plus Jakarta Sans; only layout follows Amazon).

**Depends on / feeds:** Standalone (first plan). **Plan 2** later builds the business discount tools, hero-ad authoring screens and variants on top of `Listing.sale_price`, `ListingPriceHistory` and the hero submission fields created here, and must edit price only through `listings.pricing.record_price` (Task 6). **Plan 3** adds scout/Operations listing on behalf of clients and relies on Task 4's category tree. **Plan 4** redesigns product/cart/checkout pages and reuses `MarketplaceOpen` and the `useOpening` hook (Task 9) for the disabled buy state. Nothing in Plans 2-4 is needed to ship this plan.

## Global Constraints

- Opening time: `2026-11-06 06:00 Africa/Accra`, a governed setting; the marketplace opens by itself when reached; a Super Admin can delay it (sets a new opening time).
- Before opening: browse, search, wishlist, create account and sign in work for shoppers; cart, checkout and every buy action are disabled (visible, greyed, text "Opens 6 Nov"); the server refuses order, checkout and booking creation by shoppers. Businesses and staff are unaffected. "Shopper" = a `Customer` account; a Super Admin allowlist of named test customers is exempt.
- Countdown (days, hours, minutes, seconds) is computed from the server's time, never the device clock; "Notify me" button; takeover disappears after opening and the hero slider is first.
- Notify me: phone number or email, either is enough; one text and/or email at opening; idempotent, rate-limited, no duplicates, opt-out honoured; batched SMS through the existing provider path.
- Hero slider: unlimited slides, images and video (direct upload or YouTube link); created by businesses; approved by Marketing, Operations or Super Admin; business picks start and end dates; maximum run 30 days; free; Marketing adds the day-one slides.
- Flash banner: created and published directly by Marketing (promotions, countdowns for promotions and events).
- Deals: any live discount qualifies, plus products flagged sponsored; discounts go live at once; struck-through "was" price only if the listing really held that price for the previous 7 days, otherwise sale price only; price history recorded from now.
- Most visited categories: automatic, last 30 days; fallback to seed order until there is enough data.
- Footer: Support, About us, Contact. Contact page is a message form only; contact details are removed from that page and nowhere in the footer.
- Header toggle works on every page; first visit follows the device setting. English only.
- Chatbot: asks name, email, phone, welcomes, asks the issue, records it, hands to Support via an existing `messaging.Conversation` (no business attached, no automated answers); Support sees contact details and can call, text, email or reply.
- Departments: all Amazon.com departments and sub-categories except Prime Video, Amazon Music, Kindle E-readers & Books, Amazon Appstore; existing service, stay and event categories stay; old product categories mapped by a documented table in the migration; shoppers see only categories that have listings; a business listing sees the full tree.
- No direct business-to-customer contact; no fabricated data (empty states say so; hide a rating row at 0 reviews; no invented "was" price, countdown or counts). Read `DESIGN.md`; reuse `C`; mutations are plain `apiPost`/`apiPatch` in handlers (no `useMutation`); `components/**` never imports `App.jsx`.
- Never deploy or promote. Staging only after the owner says so; production only on explicit instruction (CLAUDE.md golden rule).
- Commands: backend `docker compose run --rm web python manage.py test <app> --noinput` (never two docker commands at once); frontend `cd frontend && npx vitest run <file>`. Each commit ends with trailers `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01XFGWCBi9roL1jB5Yhycjq5` (an executing session with its own attribution uses that instead).
- Migrations: check `ls backend/<app>/migrations` for the leaf before generating; one generated migration per task that changes models.

## Review Focus

1. A shopper at 05:59:59 vs 06:00:00 Accra: the gate flips on the server clock only; a skewed device clock must change nothing (Task 1, 9).
2. A Super Admin delays the opening after Notify-me texts were already queued/sent: no text may go out before the new time, and none may go out twice (Task 3).
3. Same phone typed three ways (`0244…`, `+233244…`, `233 24 4…`) or the same email in different case: one request, one text (Task 3).
4. A department with zero live listings, a hidden/suspended business's listings, a sold-out product: none may make a category visible to shoppers or appear in Deals (Task 4, 6).
5. A "was" price after the price was raised, then a sale started: the strike-through must not appear until the current regular price has stood 7 full days (Task 6).

---

## File Structure

Backend (create `backend/storefront/`: `apps.py`, `models.py`, `opening.py`, `permissions.py`, `notify.py`, `tasks.py`, `search.py`, `feeds.py`, `views.py`, `urls.py`, `tests/`). Modify `backend/ashantihub/settings.py` (INSTALLED_APPS, throttle rates, beat entry), `backend/ashantihub/urls.py` (`api/storefront/`), `backend/listings/{models,views,serializers}.py`, `backend/marketing/{models_banners,banners,views_banners,urls_banners}.py`, `backend/messaging/{models,serializers,views,desk}.py`, `backend/orders/views.py`, `backend/bookings/views.py`, `backend/events/views.py`. Frontend: create `frontend/components/storefront/*`, `frontend/hooks/{useOpening,useStorefront,useNotifyMe,useCategoryTree,useChatIntake}.js`; modify `frontend/App.jsx`, `components/Navbar.jsx`, `components/ui/{footer-2,contact-page}.tsx`, `components/ChatLauncher.jsx`, `hooks/useTheme.js`, `mocks/handlers.js`.

---

### Task 1: Opening time, test-account allowlist and the gate service

**Files:**
- Create: `backend/storefront/{__init__,apps,models,opening,views,urls}.py`, `backend/storefront/tests/{__init__,test_opening.py}`, migration `0001_initial` (generated; seeds the first `OpeningTime` row)
- Modify: `backend/ashantihub/settings.py` (INSTALLED_APPS `"storefront"`), `backend/ashantihub/urls.py`
- Create (data migration step inside 0001 or `0002_seed_opening`): seeds `OpeningTime(opens_at=2026-11-06 06:00 Africa/Accra)`

**Interfaces:**
- Produces: models `OpeningTime(opens_at DateTime, set_by FK StaffUser null, reason CharField, created_at)` (append-only; the latest row by `-created_at,-id` governs, same shape as `ledger.MoneySetting`) and `TestAccount(customer FK Customer unique, added_by FK StaffUser, created_at)`.
- Produces: `opening.opens_at() -> datetime`, `opening.is_open(now=None) -> bool`, `opening.can_buy(user, now=None) -> bool` (true if open, or user is not a `Customer`, or user is allowlisted), `opening.delay(staff, new_opens_at, reason) -> OpeningTime` (must be later than now and later than the current time; raises `OpeningError`), `opening.snapshot(now=None) -> {"opens_at": iso, "server_now": iso, "is_open": bool}`.
- Produces endpoints: `GET /api/storefront/opening/` (public, `Cache-Control: no-store`) returns `snapshot`; `POST /api/storefront/opening/delay/` and `GET|POST|DELETE /api/storefront/test-accounts/` — Super Admin only (`HasRolePermission("opening.manage")`, `RequiresSudo()` on delay; permission `opening.manage` seeded to `super_admin` only via an accounts data migration copying the 0047 pattern).

- [ ] **Step 1: Write failing tests** in `test_opening.py`: `test_default_opening_is_6_nov_0600_accra` (`opens_at().isoformat()` is `2026-11-06T06:00:00+00:00` in UTC, Accra = UTC); `test_is_open_flips_on_server_clock` (`is_open(2026-11-06 05:59:59Z)` False, `06:00:00Z` True); `test_can_buy_customer_before_opening_false`, `test_can_buy_business_owner_and_staff_true`, `test_can_buy_allowlisted_customer_true`; `test_delay_sets_later_time_and_records_staff`; `test_delay_refuses_earlier_time` and `test_delay_after_open_refused` (once open it cannot be "delayed"); `test_public_endpoint_returns_server_now_and_no_store`; `test_only_super_admin_can_delay_or_manage_allowlist` (marketing 403, anonymous 401); `test_allowlist_add_remove_records_activity` (the `StaffActivityMiddleware` covers it; assert an `ActivityEvent` exists).
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test storefront.tests.test_opening --noinput` — Expected: FAIL (no module `storefront`).
- [ ] **Step 3: Implement** the app, models, migration (with the seeded row), `opening.py` and the views/urls above. `OPENING_DEFAULT` constant lives in `opening.py` and is used only by the seed.
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(storefront): governed opening time, delay switch and test-account allowlist`.

### Task 2: Server refuses shopper purchases before opening

**Files:**
- Create: `backend/storefront/permissions.py`, `backend/storefront/tests/test_gate.py`
- Modify: `backend/orders/views.py` (`OrderCheckoutView.permission_classes`), `backend/bookings/views.py` (`BookingCreateView`), `backend/events/views.py` (`TicketPurchaseView`), the payment-initiation view(s) in `backend/payments/` that start a charge for a customer order (find with `grep -n "class .*View" backend/payments/views.py`; gate the ones a `Customer` calls to pay)

**Interfaces:**
- Consumes: `opening.can_buy`.
- Produces: `class MarketplaceOpen(BasePermission)` — `has_permission` returns `can_buy(request.user)`; `message = "The marketplace opens on 6 Nov 2026 at 06:00."` and a `code = "not_open"`; the 403 body is `{"detail": ..., "code": "not_open", "opens_at": iso}` (override `permission_denied` through a small exception handler hook or raise a `PermissionDenied` subclass `MarketplaceNotOpen`).

- [ ] **Step 1: Failing tests** in `test_gate.py` (freeze time with `unittest.mock.patch("storefront.opening.timezone.now")`): `test_customer_checkout_refused_before_opening` (POST `/api/orders/checkout/` with a valid cart → 403, `code == "not_open"`, no `Order` and no stock decrement); `test_customer_booking_refused_before_opening`; `test_customer_ticket_purchase_refused_before_opening`; `test_cart_add_still_allowed_before_opening` (wishlist/cart add is browse state, not a purchase); `test_allowlisted_customer_can_checkout_before_opening`; `test_business_owner_and_staff_unaffected`; `test_customer_checkout_works_after_opening`; `test_existing_order_suites_still_pass` is Step 4's command (below).
- [ ] **Step 2: Run** `... test storefront.tests.test_gate --noinput` — Expected: FAIL.
- [ ] **Step 3: Implement** `MarketplaceOpen` and append it **after** `IsCustomer` in each view's `permission_classes` so an unauthenticated caller still gets 401 first. Existing suites freeze before opening, so add an autouse-style `override` in a shared test base: set `OpeningTime` to the past in `setUpTestData` of `orders`, `bookings`, `events`, `payments`, `cart` tests only if they fail (use a helper `storefront.testing.open_marketplace()` — create it).
- [ ] **Step 4: Run** `... test storefront orders bookings events payments cart --noinput` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(storefront): refuse shopper checkout, booking and ticket purchase before opening`.

### Task 3: Notify me (capture, idempotency, opt-out, batched opening send)

**Files:**
- Create: `backend/storefront/notify.py`, `backend/storefront/tasks.py`, `backend/storefront/tests/test_notify.py`
- Modify: `backend/storefront/{models,views,urls}.py`, `backend/ashantihub/settings.py` (throttle rate `"notify_me": "5/hour"`, beat entry `storefront-send-opening-notices` every 60 s, task `storefront.tasks.send_opening_notices`)

**Interfaces:**
- Consumes: `opening.is_open`, `accounts.phones.normalize_gh_phone`, `accounts.phones.phone_key`, `otp.senders.send_sms(to, body)`, `otp.senders.send_email(to, subject, body)`.
- Produces: model `NotifyRequest(phone_key CharField(9, null, unique), phone E164, email_lower EmailField null unique, sms_sent_at, email_sent_at, opted_out_at, token CharField unique, created_at)`; `notify.subscribe(phone=None, email=None) -> NotifyRequest` (at least one required else `ValueError`; merges into an existing row matched by `phone_key` or lowercased email); `notify.opt_out(token) -> bool`; `notify.send_batch(now=None, limit=NOTIFY_BATCH=100) -> int` (claims rows with `select_for_update(skip_locked=True)`, sets `sms_sent_at`/`email_sent_at` **before** the provider call outcome is recorded per row, skips opted-out, does nothing unless `is_open(now)`); text body plain GSM-7, at most 160 chars, contains the stop link `…/notify/stop/<token>`.
- Produces endpoints: `POST /api/storefront/notify-me/` (public, scope `notify_me`; body `{phone?, email?}`; always answers 200 `{"status": "saved"}` whether new or duplicate, so it cannot be used to probe), `POST /api/storefront/notify-me/stop/` body `{token}`.

- [ ] **Step 1: Failing tests:** `test_phone_or_email_alone_is_enough`; `test_neither_rejected_400`; `test_same_phone_three_formats_one_row` (`0244123456`, `+233244123456`, `233 244 123 456`); `test_same_email_different_case_one_row`; `test_duplicate_submit_answers_200_and_creates_nothing`; `test_throttled_after_five_per_hour`; `test_nothing_sent_before_opening`; `test_send_batch_sends_once_and_marks` (after opening, `otp.senders.sms_outbox` has 1 text, a second `send_batch` sends 0); `test_batch_limit_respected` (250 rows → 100, 100, 50 over three calls); `test_opted_out_never_sent`; `test_delay_after_partial_send_waits` (delay moves opening later → `send_batch` sends nothing until the new time; already-sent rows stay sent); `test_provider_failure_leaves_row_unsent_for_retry_but_not_duplicated`; `test_stop_link_sets_opted_out`.
- [ ] **Step 2: Run** `... test storefront.tests.test_notify --noinput` — Expected: FAIL.
- [ ] **Step 3: Implement.** Texts go only through `send_sms`; no `OtpEvent`; do not call a provider inside an open DB transaction (claim rows, commit, then send, then stamp). The sender name and volume cap come from the SMS provider setup (owner task, Task 13 checklist).
- [ ] **Step 4: Run** the same command — Expected: PASS.
- [ ] **Step 5: Commit** `feat(storefront): notify-me capture and batched opening notices`.

### Task 4: Amazon department tree, mapping of old categories, visits, shopper filtering

**Files:**
- Modify: `backend/listings/models.py` (`Category`: add `parent = FK("self", null, blank, related_name="children")`, `sort_order = PositiveIntegerField(default=0)`, `is_department` derived as `parent_id is None and kind == "product"` — no stored flag)
- Create: `backend/listings/department_seed.py` (the `DEPARTMENTS` data: list of `(department, [subcategories])` for Amazon.com departments excluding Prime Video, Amazon Music, Kindle E-readers & Books and Amazon Appstore; and `OLD_TO_DEPARTMENT` mapping `{old_slug: department_slug}`), migrations `0022_category_tree` (schema) and `0023_seed_departments_and_map` (data; reversible), model `CategoryVisit(category FK, day Date, count PositiveInt; unique(category, day))` in `listings/models.py`
- Create: `backend/listings/tests/test_category_tree.py`
- Modify: `backend/listings/views.py` (`CategoryListView`/new `CategoryTreeView`), `backend/listings/urls.py` (`categories/tree/`, `categories/<int:pk>/visit/`), `backend/listings/serializers.py`

**Interfaces:**
- Produces: `GET /api/listings/categories/tree/` public → `[{"id","slug","label","icon","kind","children":[...]}]`; default is the shopper view (only nodes having at least one live listing or event in the node or its descendants, using `listings.visibility.hidden_business_q` and `catalogue.offers.live_q`; service/stay/event nodes shown the same way); `?full=1` returns the whole tree and requires an authenticated `BusinessOwner` or staff (used when listing). `POST /api/listings/categories/<id>/visit/` (public, throttle scope `category_visit` "60/min", increments `CategoryVisit(day=today Accra)` via `F()` upsert, answers 204). `listings.visits.most_visited(limit=8, days=30) -> list[Category]` (top-level departments by summed count in the last 30 days; any department with no visits and the shortfall filled in `sort_order`; with fewer than `MIN_VISITS_FOR_RANKING = 50` total visits in the window the whole list is seed order).
- The migration docstring carries the documented mapping table (old slug → department); existing `Listing.category` rows are re-pointed by `0023` (old categories remain as children so no listing becomes uncategorised and `PROTECT` is never violated). Existing service, stay (`is_accommodation`) and event categories are untouched and appear under their own kind roots.

- [ ] **Step 1: Failing tests:** `test_seed_contains_amazon_departments_and_excludes_digital` (no label in `{"Prime Video","Amazon Music","Kindle E-readers & Books","Amazon Appstore"}`; includes "Electronics", "Home & Kitchen", "Beauty & Personal Care"); `test_existing_service_stay_event_categories_survive`; `test_every_old_product_category_has_a_mapping_and_listing_is_repointed`; `test_shopper_tree_hides_empty_departments`; `test_shopper_tree_ignores_suspended_business_and_sold_out` (with `SOLD_OUT_HIDDEN_ENABLED`); `test_full_tree_requires_business_or_staff` (anonymous/customer 403 on `?full=1`); `test_business_full_tree_includes_empty`; `test_visit_beacon_increments_once_per_call_and_204`; `test_most_visited_orders_by_last_30_days_and_ignores_older`; `test_most_visited_falls_back_to_seed_order_below_threshold`.
- [ ] **Step 2: Run** `... test listings.tests.test_category_tree --noinput` — Expected: FAIL.
- [ ] **Step 3: Implement** schema, seed data, views, `visits.py`. Seed idempotent via `get_or_create(slug=…)`. Keep `GET /api/listings/categories/` flat and unchanged (staff panels and mocks use it).
- [ ] **Step 4: Run** `... test listings --noinput` — Expected: PASS (the existing `groupCategoriesByKind` frontend contract is unaffected).
- [ ] **Step 5: Commit** `feat(listings): department tree, documented category mapping, visit counts`.

### Task 5: Search across products, services, stays and events

**Files:**
- Create: `backend/storefront/search.py`, `backend/storefront/tests/test_search.py`
- Modify: `backend/storefront/{views,urls}.py`

**Interfaces:**
- Consumes: `listings.visibility.hidden_business_q`, `Listing`, `events.models.Event` (approved, unexpired, as `EventListView` filters), `Category` tree from Task 4.
- Produces: `search.run(q, department=None, kind=None, limit=20) -> {"products": [...], "services": [...], "stays": [...], "events": [...]}` and `GET /api/storefront/search/?q=&category=<slug|id>&kind=` public. Rows carry only `id, kind, name, price, photo, category_label` (no phone, no business contact). `q` shorter than 2 chars returns empty lists; `category` matches the node and its descendants. Stays = published `Listing` with `category.is_accommodation`; services = other `kind=service`; products = `kind=product`.

- [ ] **Step 1: Failing tests:** `test_finds_each_of_the_four_kinds_by_name`; `test_category_picker_limits_to_department_and_children`; `test_unpublished_hidden_and_pending_event_excluded`; `test_short_query_returns_empty`; `test_rows_have_no_contact_fields` (assert keys); `test_case_insensitive_and_description_match`.
- [ ] **Step 2: Run** `... test storefront.tests.test_search --noinput` — Expected: FAIL.
- [ ] **Step 3: Implement** with `icontains` on name/description (Postgres trigram not required at opening scale); union four capped querysets.
- [ ] **Step 4: Run** same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(storefront): search across products, services, stays and events`.

### Task 6: Deals — sale price, 7-day "was" rule, price history, sponsored flag

**Files:**
- Modify: `backend/listings/models.py` (`Listing`: `sale_price DecimalField(10,2,null)`, `sponsored BooleanField(default=False)`, `sponsored_by FK StaffUser null`; new `ListingPriceHistory(listing FK, price Decimal, started_at, ended_at null)`; `Listing.save` calls `pricing.record_price` on create and on `price_amount` change), `backend/listings/serializers.py` (owner serializer accepts `sale_price`, validated `0 < sale_price < price_amount`; public serializer adds `sale_price`, `was_price`)
- Create: `backend/listings/pricing.py`, `backend/listings/tests/test_deals.py`, migrations (schema + data migration that opens one `ListingPriceHistory(started_at=migration time)` per published product, so "was" appears no earlier than 7 days after deploy), `backend/storefront/feeds.py` (`deals(limit)`), view `GET /api/storefront/deals/`, staff endpoint `POST /api/listings/<id>/sponsored/` body `{"sponsored": bool}` (`HasRolePermission("deals.manage")`, seeded to marketing, operations, super_admin)

**Interfaces:**
- Produces: `pricing.record_price(listing, now=None)` (closes the open row if the regular price differs, opens a new one; no-op if unchanged); `pricing.was_price(listing, now=None) -> Decimal | None` (returns `price_amount` only when `sale_price` is set and an open history row for the current `price_amount` has `started_at <= now - 7 days`; otherwise None); `feeds.deals(limit=24)` returns live (`catalogue.offers.live_q`) product listings with `sale_price` set **or** `sponsored=True`, sponsored flagged `"sponsored": true` and labelled so, discount-percent only when computed from a real `was_price`, newest first.
- Plan 2 dependency: its discount and price-edit tools must go through `Listing.save`/`record_price`.

- [ ] **Step 1: Failing tests:** `test_sale_price_must_be_below_price`; `test_new_listing_opens_history_row`; `test_price_change_closes_and_reopens_history`; `test_unchanged_price_does_not_add_rows`; `test_was_price_none_when_regular_price_held_less_than_7_days`; `test_was_price_returned_when_held_7_days` (`started_at` 8 days ago); `test_raising_price_then_sale_has_no_was_price_for_7_days`; `test_no_was_price_without_sale_price`; `test_deals_include_sale_and_sponsored_only`; `test_deals_exclude_hidden_business_sold_out_unpublished`; `test_sale_goes_live_immediately_no_approval`; `test_only_marketing_operations_super_admin_can_flag_sponsored` (support/scout 403); `test_checkout_charges_sale_price` (add to `orders` tests: order line price equals `sale_price`; cart/checkout code reads the effective price — update `cart`/`orders` price reads to use `Listing.effective_price` property, returning `sale_price or price_amount`).
- [ ] **Step 2: Run** `... test listings.tests.test_deals --noinput` — Expected: FAIL.
- [ ] **Step 3: Implement.** `Listing.effective_price` is the single price read by cart totals, `OrderCheckoutView` and `catalogue.offers` ordering (replace direct `price_amount` reads there with it; grep `price_amount` in `cart/`, `orders/`, `catalogue/offers.py`).
- [ ] **Step 4: Run** `... test listings storefront orders cart catalogue --noinput` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(listings): sale prices, honest 7-day was-price rule, price history, sponsored flag`.

### Task 7: Hero slider (images/video, business submission, staff slides) and Marketing flash banner

**Files:**
- Modify: `backend/listings/models.py` (`HeroMediaSubmission`: `business_owner` nullable, add `created_by_staff FK StaffUser null`, `title CharField(140, blank)`, `video_file FileField(upload_to="hero_media/video/", null)`, `youtube_url URLField(blank)`, `starts_at`, `ends_at`, `link_path CharField(200, blank)`; `media` becomes `null/blank`), `backend/listings/views.py` (`HeroSubmitView`, `HeroApproveView`, `HeroActiveListView` at `/api/hero/active/`), `backend/listings/serializers.py`
- Create: `backend/listings/hero_rules.py` (validators), `backend/listings/validators.py` addition `validate_video_content_type` (mp4/webm sniffed via python-magic; 100 MB cap), tests `backend/listings/tests/test_hero_slides.py`
- Modify: `backend/marketing/models_banners.py` (`Banner`: new slot `FLASH = "flash"`, `message CharField(200, blank)`, `countdown_ends_at DateTime null`), `backend/marketing/banners.py` (`publish_direct(banner_id, staff)`), `backend/marketing/views_banners.py` + `urls_banners.py` (`POST /api/marketing/banners/<id>/publish/`; public `GET /api/marketing/banners/public/?slot=flash` already exists via `usePublicBanners` — extend its slot validation), test `backend/marketing/tests/test_flash_banner.py`

**Interfaces:**
- Produces: `hero_rules.validate_window(starts_at, ends_at)` (ends after starts, `ends_at - starts_at <= timedelta(days=30)`, start not in the past by more than a day) raising `ValidationError("A hero slide can run for at most 30 days.")`; `hero_rules.validate_media(media_type, media, video_file, youtube_url)` (image needs `media`; video needs exactly one of `video_file` or a `youtube.com`/`youtu.be` URL, stored as the normalised watch id); `hero_rules.is_live(sub, now)` (approved and `starts_at <= now < ends_at`). A staff-created slide (Marketing, `hero_media.approve`) is stored `approved` with `reviewed_by` set at creation; a business submission stays `pending`. `HeroActiveListView` returns live slides ordered by `starts_at`, each `{id, media_type, image, video_url|youtube_id, title, caption, link_path, listing_id}`; `expires_at` is set to `ends_at` (replaces the plan-`hero_days` calculation for new rows; old rows keep theirs). Existing moderated-queue contract (pending/approve/reject/re-review, `reviewed_by`/`reviewed_at`) is preserved. Approvers: marketing, operations, super_admin hold `hero_media.approve` (verify in a test; add a data migration granting it to `operations` if missing). The subscription-tier `hero_slots` rule is not applied to the free slider.
- `Banner(slot="flash")`: Marketing (`site_promo.manage`) publishes directly (`state` goes `draft → approved` without `marketing.banner` approval); `countdown_ends_at` drives the strip's countdown; `is_live` and `phase` unchanged.

- [ ] **Step 1: Failing tests:** `test_business_submits_image_slide_pending`; `test_business_submits_youtube_slide_normalises_id`; `test_business_uploads_video_file_validated` (rejects a `.exe` renamed `.mp4`); `test_video_needs_exactly_one_source`; `test_non_youtube_url_rejected`; `test_window_longer_than_30_days_rejected` and `test_exactly_30_days_accepted`; `test_marketing_operations_super_admin_can_approve`; `test_support_cannot_approve`; `test_maker_never_approves_own_slide_when_staff_created_by_other_role` is NOT required (spec exempts Marketing day-one slides) — instead `test_marketing_created_slide_is_live_in_window`; `test_slide_not_active_before_start_or_after_end`; `test_unlimited_slides_returned_in_start_order`; `test_active_feed_has_no_contact_fields`; `test_rejected_slide_can_be_re_reviewed` (contract); flash: `test_marketing_publishes_flash_banner_without_approval`; `test_other_slots_still_need_super_admin_approval`; `test_flash_countdown_ends_at_exposed_publicly_only_while_live`; `test_non_marketing_cannot_publish_flash`.
- [ ] **Step 2: Run** `... test listings.tests.test_hero_slides marketing.tests.test_flash_banner --noinput` — Expected: FAIL.
- [ ] **Step 3: Implement** models + migrations (one per app), validators, view changes. Video conversion to a web format is Plan 2; here only mp4/webm are accepted, so no transcoder is needed.
- [ ] **Step 4: Run** `... test listings marketing --noinput` — Expected: PASS (existing `test_banners.py` and hero moderation tests unchanged).
- [ ] **Step 5: Commit** `feat: hero slides with video and dates, direct-published flash banner`.

### Task 8: Chatbot intake handed to Support

**Files:**
- Modify: `backend/messaging/models.py` (`Conversation`: `contact_name CharField(120, blank)`, `contact_email EmailField(blank)`, `contact_phone CharField(30, blank)`; `SOURCE_CHOICES` gains `("chatbot", "Chat assistant")`), `backend/messaging/serializers.py` (`ConversationCreateSerializer`: optional `contact_name/email/phone`, required together when `source == "chatbot"`; phone passed through `accounts.phones.normalize_gh_phone`), `backend/messaging/views.py` (`create`: store contacts, keep guest scope), `backend/messaging/desk.py` (`person(conversation)` and `row`/`thread` expose `contact: {name, email, phone}` for staff only)
- Create: `backend/messaging/tests/test_chatbot_intake.py`; migration

**Interfaces:**
- Produces: `POST /api/messaging/conversations/` with `{"subject": "...", "body": "<issue>", "source": "chatbot", "contact_name", "contact_email", "contact_phone", "guest_token"?}` — no `about_business`; a signed-in customer or business owner uses their account scope and the same contact fields. The welcome and "what is your issue?" prompts are client-rendered, not stored. `desk.person()` adds `contact` so the Support thread shows call/text/email actions; no automated reply is created; `services.auto_assign` and `notify_assignee` run as for any new conversation.

- [ ] **Step 1: Failing tests:** `test_guest_chat_stores_contact_and_first_message`; `test_missing_email_or_phone_or_name_400_for_chatbot_source`; `test_invalid_email_rejected`; `test_phone_normalised_to_plus233`; `test_business_owner_chat_has_no_business_link_and_stays_support_only`; `test_conversation_is_auto_assigned_or_queued_like_any_other`; `test_staff_thread_shows_contact` and `test_customer_serializer_does_not_echo_other_parties` (customer sees own thread; no staff contact leak); `test_no_automated_message_created` (Message count == 1).
- [ ] **Step 2: Run** `... test messaging.tests.test_chatbot_intake --noinput` — Expected: FAIL.
- [ ] **Step 3: Implement.** Throttle remains `messaging` scope.
- [ ] **Step 4: Run** `... test messaging --noinput` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(messaging): chatbot intake with contact details handed to Support`.

### Task 9: Frontend foundations — opening hook, root redirect, theme fix, disabled buy state

**Files:**
- Create: `frontend/hooks/useOpening.js`, `frontend/hooks/useNotifyMe.js`, `frontend/components/storefront/{CountdownTakeover,NotifyMeForm}.jsx`, tests `frontend/components/storefront/__tests__/{CountdownTakeover,useOpening}.test.jsx`, `frontend/hooks/__tests__/useTheme.test.js`
- Modify: `frontend/hooks/useTheme.js`, `frontend/App.jsx` (`PATH_TO_PAGE["/"]` stays `"home"` but renders `StorefrontHome`; `"/business"` remains the browse page; the `Hero` landing is retired from `/`), `frontend/components/CartDrawer.jsx` and the Card/Listing detail buy buttons (`Buy`, `Add to cart`, `Book`, ticket buy), `frontend/mocks/handlers.js` (`/api/storefront/opening/`, `/notify-me/`)

**Interfaces:**
- Produces: `useOpening()` → `{ isOpen, opensAt, remainingMs, loading }` using React Query on `/api/storefront/opening/`; offset = `server_now - Date.now()` captured at fetch so the ticking clock never trusts the device; refetch every 60 s and at zero; `isOpen` flips when `server_now_estimate >= opens_at`. `CountdownTakeover({ onNotify })` shows days/hours/minutes/seconds (Fraunces numerals, gold on dark brown per `DESIGN.md`) and a "Notify me" button; renders nothing when open. `NotifyMeForm` collects phone or email (one is enough), posts through `apiPost("/api/storefront/notify-me/")`, shows "We will tell you when we open" or the server error. `useTheme`: when nothing is stored, follow `matchMedia("(prefers-color-scheme: dark)")` and keep following it until the user toggles (store only on toggle); `data-theme` and the `dark` class set on `<html>`; the Navbar toggle must also restyle inline-`C` surfaces on every page — add CSS variables in `index.css` consumed by the header/home wrappers and make `Navbar`'s `theme` prop drive them; dashboards stay always-light (DESIGN.md).
- Buy actions take `disabled` + label "Opens 6 Nov" while `!isOpen && !allowlisted`; `GET /api/accounts/me/` is extended (Task 2 test addition) with `can_buy: bool` from `opening.can_buy` so allowlisted testers see live buttons.

- [ ] **Step 1: Failing tests:** `useOpening` — `ignores_device_clock` (mock `Date.now` 2 days ahead; remaining time still derived from `server_now`); `flips_open_at_zero`; `CountdownTakeover` — `shows_four_units`, `hidden_when_open`, `notify_button_opens_form`; `NotifyMeForm` — `accepts_phone_only`, `accepts_email_only`, `rejects_both_empty_with_message`; `useTheme` — `follows_device_on_first_visit`, `toggle_persists_and_overrides_device`, `toggle_updates_html_class_and_data_theme`; routing — `App.routing.test.jsx` gains `root_renders_storefront_home`; buy buttons — `buy_disabled_with_opens_label_before_opening`, `enabled_when_can_buy_true`. Existing `App.routing.test.jsx`, `Navbar.test.jsx`, `CartDrawer.test.jsx`, `Hero.test.jsx` changes are intentional and stated in the commit body.
- [ ] **Step 2: Run** `cd frontend && npx vitest run components/storefront hooks/__tests__/useTheme.test.js App.routing.test.jsx` — Expected: FAIL.
- [ ] **Step 3: Implement** the hook/components/route and wire disabled states via a prop-free hook call in each buy surface (a component owns its data source).
- [ ] **Step 4: Run** the same plus `npx vitest run Navbar.test.jsx CartDrawer.test.jsx` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): server-timed countdown, notify-me, root to marketplace, theme toggle fix`.

### Task 10: Frontend — Amazon-style header, search with category picker, home sections

**Files:**
- Create: `frontend/components/storefront/{StorefrontHeader,SearchBar,StorefrontHome,HeroSlider,FlashStrip,DealsRow,MostVisitedCategories,CtaBlock}.jsx`, `frontend/hooks/{useStorefront,useCategoryTree}.js` and a `__tests__` file per component
- Modify: `frontend/components/Navbar.jsx` (the new header replaces the visible bar on `home`; other pages keep Navbar but get the fixed toggle), `frontend/App.jsx` (`page==="home"` block renders `StorefrontHome`; remove `Hero`, `FeaturedRow`, `HomeCtaBand` from home), `frontend/mocks/handlers.js`, `frontend/components/SiteBanner.jsx` (add `flash` slot height)

**Interfaces:**
- Consumes: `useOpening`, `/api/storefront/search/`, `/api/listings/categories/tree/`, `/api/hero/active/` (`useActiveHero`), `usePublicBanners("flash")`, `/api/storefront/deals/`, most-visited from `GET /api/storefront/home/` (`{most_visited: [...]}` — create `storefront.views.HomeFeedView` returning `listings.visits.most_visited()`; test `test_home_feed_most_visited_shape`), `POST /api/listings/categories/<id>/visit/` beacon on category click.
- Produces: `StorefrontHeader` — logo, delivery location (reads the saved default address when signed in; otherwise "Deliver to Ghana", no invented address), search with category `<select>` (shopper tree) and debounced results dropdown (products, services, stays, events), Sign in, Wishlist, Cart, secondary nav strip (departments from the tree); `HeroSlider` autoplays images, plays direct video (`<video controls muted playsInline>`) or YouTube (`youtube-nocookie.com/embed/<id>`), respects `usePrefersReducedMotion`, renders nothing when no live slides; `FlashStrip` shows the message and a countdown to `countdown_ends_at` computed from the server offset in `useOpening`; `DealsRow` cards show sale price, strike-through only when `was_price` present, a "Sponsored" label for flagged items, hide the row when empty; `MostVisitedCategories` tiles from the feed (empty state hides the section); `CtaBlock` — AshantiHub-specific copy in the spirit of `Screenshot_amazon_call_to_action.png` ("Sell on AshantiHub" → business registration, "Sign in for the best experience" → auth modal). Order on the page: `CountdownTakeover` (only before opening) → `StorefrontHeader` → `HeroSlider` → `FlashStrip` → `DealsRow` → `MostVisitedCategories` → `CtaBlock`. Inline `C` styling; section order and sizes follow `screenshot_amazon_home.png`, colours and type follow `DESIGN.md`.

- [ ] **Step 1: Failing tests:** `SearchBar` — `debounces_and_groups_four_kinds`, `category_picker_filters_request`, `empty_results_say_nothing_found`; `HeroSlider` — `renders_image_video_and_youtube_slides`, `hidden_when_no_slides`, `no_autoplay_with_reduced_motion`; `FlashStrip` — `counts_down_from_server_time`, `hidden_when_no_live_banner`; `DealsRow` — `shows_was_price_only_when_present`, `labels_sponsored`, `hidden_when_empty`; `MostVisitedCategories` — `click_sends_visit_beacon_and_navigates`; `StorefrontHome` — `takeover_first_before_opening`, `slider_first_after_opening`, `no_contact_details_anywhere`; `StorefrontHeader` — `wishlist_and_cart_present_cart_greyed_before_opening`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run components/storefront` — Expected: FAIL.
- [ ] **Step 3: Implement** the components and the `HomeFeedView`/URL; wire into `App.jsx` threading `navigate`, `setAuthModal`, `openRegister` as props (no `App.jsx` import).
- [ ] **Step 4: Run** `npx vitest run` from `frontend/` — Expected: PASS (full suite).
- [ ] **Step 5: Commit** `feat(frontend): marketplace home — header, search, slider, flash, deals, categories, call to action`.

### Task 11: Frontend — footer, form-only Contact page, chatbot, Support contact actions

**Files:**
- Modify: `frontend/components/ui/footer-2.tsx` (links: Support, About us, Contact; remove any phone, email, address, WhatsApp-to-business text), `frontend/components/ui/contact-page.tsx` (remove `contact-info-panel`; keep `contact-enquiry-form`; WhatsApp support button stays only as AshantiHub's own per CLAUDE.md), `frontend/components/ChatLauncher.jsx` (opens the intake), `frontend/App.jsx` (footer on every page including home)
- Create: `frontend/components/storefront/ChatIntake.jsx`, `frontend/hooks/useChatIntake.js`, tests `Footer2.test.jsx` (modify), `ContactEnquiryForm.test.jsx` (unchanged), `ChatIntake.test.jsx`, `ContactPage.test.jsx`
- Modify (Support side): the Support thread header component under `frontend/components/admin/` that renders the conversation (find with `grep -rn "useStaffMessagingQueue\|thread(" frontend/components/admin | head`) to show `contact` with `tel:`, `sms:`, `mailto:` actions plus the existing reply box

**Interfaces:**
- Consumes: Task 8's `POST /api/messaging/conversations/` (`source: "chatbot"`), guest token as `MessagingCenter` already creates.
- Produces: `ChatIntake` steps: name → email → phone (validated: email shape, Ghana phone) → "Welcome, {name}. What can we help you with?" → issue textarea → confirmation "Support has your message and will contact you". No automated answers. After submit it continues in the existing `MessagingCenter` thread so Support replies appear there. `useChatIntake()` returns `{ submit({name, email, phone, issue}), error, busy }` using plain `apiPost`.

- [ ] **Step 1: Failing tests:** `Footer2` — `has_support_about_contact_links_only` and `shows_no_phone_email_address`; `ContactPage` — `renders_form_and_no_details_block` (no element with the `SiteSettings` phone/email/address); `ChatIntake` — `asks_name_email_phone_in_order`, `rejects_bad_email_and_phone`, `welcomes_by_name_then_asks_issue`, `posts_chatbot_source_without_business_link`, `shows_no_bot_answer`; Support thread — `shows_call_text_email_links_for_contact`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run Footer2.test.jsx components/storefront/__tests__/ChatIntake.test.jsx` — Expected: FAIL.
- [ ] **Step 3: Implement.** `Footer2.test.jsx` and `ContactCtaBand.test.jsx` changes are intentional (stated in commit body); `StaffDashboard.test.jsx` is not touched except by the Support thread assertion above if it already covers that component.
- [ ] **Step 4: Run** `npx vitest run` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(frontend): footer, form-only contact page, chatbot intake, Support contact actions`.

### Task 12: Staff and business screens for the new controls

**Files:**
- Create: `frontend/components/admin/panels/OpeningPanel.jsx` (Super Admin: current opening time, "Delay opening" with reason and sudo, test-account allowlist add/remove), `frontend/hooks/useOpeningAdmin.js`, `frontend/components/dashboard/HeroSlideForm.jsx` (business: image or video upload or YouTube link, start/end dates capped at 30 days, shows pending/approved/rejected), tests for each
- Modify: `frontend/components/admin/shell/navModel.js` (`NAV_ITEMS` entry `opening` + id in `super_admin` `ROLE_MENUS` "settings" group; Marketing menu: flash banner publish uses the existing banners panel, add a "Flash banner" action and a "Sponsored" toggle in the deals list), `frontend/components/admin/panels/HeroApprovalPanel.jsx` (show video/YouTube preview, dates, 30-day note; reuse `ModerationQueueTabs`), Marketing day-one slide creation form (staff-created slide, auto-approved), the business dashboard hero tab that uses `useMyHeroSubmission`

**Interfaces:**
- Consumes: Tasks 1, 6, 7 endpoints. Produces: panels gated by `opening.manage`, `deals.manage`, `hero_media.approve`, `site_promo.manage`; menu items arrive with their screens (frontend/CLAUDE.md).

- [ ] **Step 1: Failing tests:** `OpeningPanel` — `shows_opening_time_and_delay_requires_reason`, `sudo_prompt_flow_retries_once`, `adds_and_removes_test_account`, `hidden_for_non_super_admin`; `HeroSlideForm` — `blocks_range_over_30_days`, `requires_one_video_source`; `HeroApprovalPanel` — `approve_reject_for_marketing_and_operations` (keeps the paginated-vs-array handling via `ModerationQueueTabs`); navModel — `opening_only_in_super_admin_menu`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run components/admin components/dashboard` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run` — Expected: PASS (`StaffDashboard.test.jsx` and `BusinessDashboard.test.jsx` unchanged unless a menu assertion intentionally changes; say why in the commit).
- [ ] **Step 5: Commit** `feat(frontend): opening controls, hero slide submission and approval, flash and sponsored controls`.

### Task 13: Release readiness (staging only) and docs

**Files:**
- Modify: `docs/IMPLEMENTATION_INSTRUCTIONS.md` (mark marketplace Plan 1), `docs/superpowers/specs/2026-10-19-marketplace-rebrand-design.md` (status: Plan 1 built), `CLAUDE.md` Product rules only if the allowlist/chatbot wording needs a line (no change expected)
- Create: `backend/storefront/tests/test_launch_flow.py`

- [ ] **Step 1: Write the end-to-end test** `test_launch_flow`: seeded opening at 2026-11-06 06:00 Accra; at 05:59 a customer's checkout is 403 `not_open`; an allowlisted customer's succeeds; Notify-me subscriber receives nothing; at 06:00 `send_opening_notices` sends once; a customer's checkout now succeeds; second tick sends nothing.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test storefront --noinput` — Expected: FAIL until Tasks 1-3 are in; then PASS.
- [ ] **Step 3: Full verification:** `docker compose run --rm web python manage.py test --noinput` and `cd frontend && npm run test && npm run build` — Expected: all PASS, build succeeds.
- [ ] **Step 4: Owner checklist (do not do, report):** set the SMS sender name and any volume cap with the provider before 6 Nov; Marketing creates the day-one slides and a flash banner on staging; Super Admin adds test accounts and rehearses a full purchase; confirm the "was"-price note (appears about 7 days after launch); confirm `OTP_SMS_PROVIDER=hubtel` and the beat container (`beat` + `worker`) are running on the target environment so `storefront-send-opening-notices` fires.
- [ ] **Step 5: Commit** `docs: mark marketplace plan 1 built; add launch-flow test`. Then stop: deploy to staging only on the owner's instruction, and production only when the owner says "promote to production".

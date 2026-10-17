# Catalogue, Offers, Stock Cover and Low-Stock Alerts — Implementation Plan (Stage 6, backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Branded and barcoded products can be grouped, by staff decision, under a shared catalogue entry so customers see every business's offer of the same product (cheapest first, a featured offer, no contact details) and businesses can look up the same product elsewhere; each business sees which of its offers need restocking from a days-of-cover measure, and is told once, in-app, when an offer runs low or sells out — without changing the cart or the checkout stock reservation; search and the related list stop showing a counted product at 0 only once `SOLD_OUT_HIDDEN_ENABLED` is on.

**Architecture:** A new `catalogue` app. Each `Listing` stays the offer and gains `barcode` (a 14-digit GTIN key) and an optional `catalogue_product` foreign key; a `CatalogueProduct` is made only when a member of staff with `listings.moderate` approves a business's `CatalogueAttachRequest` through the moderated-queue contract. Read models (`catalogue.offers`) answer "other sellers" and the business's catalogue lookup. `catalogue.stock` measures days of cover from paid order lines over a governed window; `catalogue.alerts`, run hourly by Celery beat behind `STOCK_ALERTS_ENABLED` (default off), moves a per-offer `StockAlertState` with conditional UPDATEs so each crossing is told once. The three stock numbers are governed settings in `ledger.settings_store` (Accounting proposes, Super Admin approves).

**Tech Stack:** Django 5.2, DRF, Postgres, Celery beat (eager under tests); the repo's `listings`, `cart` (`cart.guard`), `orders`, `ledger` (`settings_store`, `approval_kinds`), `notifications`, `field` (`business_pin`, `haversine_m`), `accounts` apps.

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` — §1 rows 7 (stock sourcing: separate offers, the customer chooses), 8 (hybrid grouping), 15 (low stock), 16 (governance); §3.3 (governed settings); §10 (stock offers and alerts — the brief calls it "§7"; §7 in the file is third-party dispatch); §11 step 6; §13. Deviations and decisions are in §0 below; Task 1 records them in the spec and Task 9 adds the gate items (ci) onward.

**Base:** branch `feature/catalogue-offers-6` from `origin/righteoushack` at `d26dd54` (ledger, OTP and wallet stages merged, all behind switches that default off). Work only in `/home/righteoushack/projects/TheAshantihub/.worktrees/catalog6`.

**Commit trailers:** every commit message in this plan ends with a blank line and exactly these two lines:

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
```

## 0. Decisions and reconciliation with the code

| # | Question | Decision | Why (grounded in the code) |
|---|---|---|---|
| C1 | What is an "offer"? | **The existing `Listing` is the offer.** It gains `barcode` (CharField, 14 digits or "") and `catalogue_product` (nullable FK to `catalogue.CatalogueProduct`, `SET_NULL`, `related_name="offers"`; deleting an entry leaves its offers standing alone, and the ungroup flow need not null the FK before a delete). Null means the listing stands alone. No new Offer model. | `Listing` is already the priced, stocked, carted, ordered and fee-snapshotted unit: `CartItem.listing`, `OrderItem.listing` (`PROTECT`), the stock reservation in `OrderCheckoutView` (`select_for_update` on `Listing.stock_quantity`), `_fail_order_checkout` and `orders.support.return_stock`, the per-vendor `OrderFeeSnapshot`. A separate Offer model would mean re-pointing every one of those, inside the correctness cores. One nullable FK changes nothing for existing rows, carts or orders; "each offer is its own cart line" (§10) is already true. |
| C2 | Where the code lives | New app `catalogue`: `identity.py` (barcode and name keys), `models.py`, `errors.py`, `attach.py` (grouping requests, staff decisions, barcode matcher), `offers.py` (other sellers, featured offer, catalogue lookup), `stock.py` (days of cover), `alerts.py` + `tasks.py`, `views.py` (businesses and customers), `views_staff.py`, `urls.py` at `/api/catalogue/`, command `propose_catalogue_matches`. | Keeps `listings/views.py` (1,263 lines) and the checkout untouched except one browse filter (C9). PR #152 (Plan 1b) and PR #153 (Plan 4) touch `payments/services.py`, `orders/alerts.py`, `bookings/`, `events/`, `services/`, `wallets/`; Plan 5 touches `delivery/` and `wallets/`: none of those is edited here. Plan 5 also adds a beat entry (`ledger-post-rider-commission`, a different anchor from this plan's) and §13 items (xci)-(c); PR #153 adds `wallets-send-vendor-texts` and `wallets-vendor-digests` at the same `CELERY_BEAT_SCHEDULE` anchor as this plan's entry (keep all three). |
| C3 | The catalogue entry | `CatalogueProduct(brand, name, normalised_name, barcode, created_by, created_at)`. A non-blank barcode belongs to one entry (partial unique constraint); an entry needs a brand or a barcode (check constraint). Made only inside a staff approval. No category on the entry (offers keep their own). | Spec §1 row 8: "staff-approved catalogue entry". The brief: "CatalogueProduct with brand/barcode/normalised name". |
| C4 | Barcode key | `catalogue.identity.clean_barcode`: digits only (spaces and hyphens ignored), 8/12/13/14 digits, GS1 check digit verified, all-zero refused, stored zero-padded to 14 digits — so UPC-A `036000291452` and EAN-13 `0036000291452` are one key. A store's own code (GS1 restricted-circulation prefixes 020–029, 040–049, 200–299; GTIN-8 starting 0 or 2) is accepted on a listing but **never groups** and is never matched. | Barcode matches drive grouping proposals: a mistyped digit or an in-store number shared by two shops for different goods would group unrelated products. |
| C5 | What may be grouped | Only listings whose `cart.guard.kind_of` is in `cart.guard.DELIVERABLE` (products and food). Services, stays (`is_accommodation`) and events never — events are not `Listing` rows at all. | Spec §1 row 8 ("services, events and stays are never grouped"); `cart.guard` is the existing single definition of "goods" (`kind_of`, `deliverable_q`). |
| C6 | Attach flow | A business asks on its own listing (`POST /api/catalogue/mine/<id>/requests/`): an existing entry, or a new one by brand and name (defaults: the listing's own). One request waits per listing (row lock + partial unique constraint). Staff with `listings.moderate` decide through the **moderated-queue contract** (backend/CLAUDE.md): `staff/requests/pending/?status=`, unknown status falls back to pending, pending oldest first, history `-reviewed_at` then `-created_at`/`-id`, approve/reject set `reviewed_by`/`reviewed_at`, `re-review` 400s unless rejected and clears the reason and reviewer pair. Approval re-checks under lock (request row, then listing row); a barcode already in the catalogue joins that entry. **Only staff ungroup** (`staff/listings/<id>/detach/`, reason required); a business may withdraw a request it filed itself while it waits, but not a barcode match AshantiHub filed (`source=backfill`): it cannot opt out of one. | Spec §1 row 8 (staff-approved). Reusing `listings.moderate` (Operations and Super Admin today, accounts migration 0002) needs no permission migration. Letting a business ungroup itself, or withdraw a barcode match AshantiHub filed, would let it leave a price comparison it dislikes; the owner confirmed in the preflight (2026-10-16) that a business cannot opt out of a barcode match (G6). |
| C7 | Other sellers (customers) | `GET /api/catalogue/listings/<id>/other-sellers/?ordering=price\|availability&lat=&lng=` (public, read-only): the other **live** offers of the same entry — published, business not hidden (`listings.visibility`), priced, in stock (uncounted counts as in stock) — cheapest first (or most available first), plus `featured_offer_id`: lowest price among live offers of KYC-verified businesses, ties to the shop nearest the customer's position when sent (straight-line from the business pin, used only to order, never shown), then the oldest offer. Rows carry no phone, email, address, pin or `contact_phone`; the business shows by `display_name`. An ungrouped listing answers an empty list. | Spec §10 ("featured offer … ties go to the nearest vendor", "other sellers … nothing is added without them"); CLAUDE.md "Businesses cannot be contacted directly" and "No fabricated data". backend/CLAUDE.md allows the straight-line estimate only for ordering, never for a figure shown (`delivery.dispatching.rank` precedent). |
| C8 | Sourcing helper (businesses) | `GET /api/catalogue/products/?q=` or `?barcode=` (entries with live offer count and lowest live price, null when none) and `GET /api/catalogue/products/<id>/offers/` (other businesses' live offers, cheapest first, plus the caller's own grouped listing ids). Business owners only; read-only (no ordering between businesses, no contact). | The brief's "sourcing helper for vendors (read-only)". Prices and counted stock are already public (`PublicListingSerializer` exposes `stock_quantity`). |
| C9 | Zero stock hides the offer | `PublicListingListView` and `RelatedListingsView` exclude counted goods at `stock_quantity=0` (`listings.visibility.sold_out_q`) **only while `SOLD_OUT_HIDDEN_ENABLED` is on** (env, default off until the Plan 6F screens tell a business to leave the count empty when it does not count stock). Never a service, stay or event: only products and food are offers with a stock count. The listing's own page (`PublicListingDetailView`) still answers (links and carts keep working, it shows 0); other-sellers rows (a new endpoint) always exclude it, whatever the switch says. | Spec §1 row 15 and §10 ("Zero stock hides the offer"); the switch decides only when, so deploying this plan changes no search result. `marketing/featured.py` and `marketing/flash_sales.py` already refuse a 0-stock listing. |
| C10 | Days of cover | `catalogue.stock`: units on `OrderItem` lines of `Order.PAID` orders placed inside the governed window (default 28 days), over whole days on sale inside the window (since `Listing.reviewed_at`, else `created_at`; at least 1). Low: the business's own line for that offer if set (stock ≤ line); else, with sales, fewer than `low_stock_cover_days` (default 7) days left (`stock × days_on_sale < cover_days × units`, integers); else (no sales) stock ≤ `low_stock_fallback_units` (default 5). Sold out = 0 (always low). Only counted (`stock_quantity` set) product/food offers are measured; uncounted stock is never guessed. | Spec §1 row 15 ("per-offer threshold with sales-based default (<7 days cover), fallback 5 units"). `Order.placed_at` and `Order.status` exist; PENDING orders already hold their reservation, CANCELLED orders gave it back. |
| C11 | Alert state and "once on crossing" | `StockAlertState` (one per offer): `threshold_units` (the business's own line), `low_alerted_at`, `low_alerted_stock`, `sold_out_alerted_at`. Sold out and not told → one sold-out notice (the low alert counts as told at stock 0). Low and not told → one low notice (remember the stock). The low alert is **re-armed only by a restock**: not low any more **and** stock above the stock it was told at; a new own line re-arms it too. Sold-out re-arms once stock > 0. Every move is a conditional `UPDATE … WHERE …_alerted_at IS NULL`. | The brief: "alerted flag reset when stock recovers above threshold" and "idempotent". Re-arming on "not low" alone would repeat alerts whenever old sales leave the 28-day window and the cover drifts over 7 days with no restock. |
| C12 | Alert delivery | In-app only now (`notify_business_owner`, kinds `stock_low` and `stock_sold_out`, plain strings like `wallets` uses — no notifications migration), one notice per business per run per kind naming up to five offers. `catalogue.alerts.tell` is the single hook for texts and emails. | Stage 4's business text outbox (`wallets.vendor_texts`, `VendorPreference`) is on PR #153, **not** on `origin/righteoushack`; spec §10 "SMS/email by preference" becomes gate item (cii). |
| C13 | Governed thresholds | Three settings in `ledger.settings_store.DEFINITIONS`: `low_stock_cover_days` (7, 1–90), `low_stock_fallback_units` (5, 0–100,000), `stock_cover_window_days` (28, 7–180), changed only through the existing `ledger.setting` approval (Accounting proposes, Super Admin approves; `GET /api/ledger/settings/` lists them, there is no money-settings screen yet). The approval says they apply to the hourly stock check, not to orders (`STOCK_SETTING_KEYS`). | Spec §3.3 and §1 row 16 govern editable numbers this way; Plan 3b set the pattern (`WALLET_SETTING_KEYS`). |
| C14 | Switch and job | `STOCK_ALERTS_ENABLED` (env, default **False**) gates measuring and sending in the job only, and `SOLD_OUT_HIDDEN_ENABLED` (env, default **False**) gates only the sold-out hiding in browse (C9); `catalogue.tasks.check_stock_alerts` hourly at :35 in `CELERY_BEAT_SCHEDULE` (so `core.jobs` keeps its `JobRun` heartbeat and the System health page lists it). The needs-restocking list and the own-line endpoint work whatever the switch says. | Every stage so far ships behind a default-off switch; on the first run every offer already low is told once (gate (cvi)). |
| C15 | Stock reservation | **Unchanged.** Reserve at checkout, decrement under row lock, roll back on payment failure — a correctness core. The spec's "short window" release of an abandoned Hubtel checkout is not built here. | In simulated mode a checkout pays or rolls back in one transaction, so nothing is ever left reserved; in Hubtel mode the only release is the failure webhook in `payments/services.py`, which PR #152 is editing. Gate item (ciii), before Plan 7. |
| C16 | Migrations and backfill | `catalogue/0001_catalogue_product` → `listings/0021_listing_barcode_catalogue_product` → `catalogue/0002_attach_requests` → `catalogue/0003_stock_alert_state` → `catalogue/0004_request_ungrouped` (explicit `ungrouped_at`/`ungrouped_by` on a request, so the matcher honours a staff ungroup), all generated. **No data migration:** every existing listing starts standalone (`catalogue_product` null, `barcode` ""). The backfill is `manage.py propose_catalogue_matches [--apply] [--batch-size N]` (a DRY RUN unless `--apply`; chunks of 500 by pk; prints filed/skipped/raced/failed): it files `source=backfill` requests for ungrouped, published product/food listings of unsuspended owners whose barcode equals an entry's (store codes never), skipping listings with a request waiting, one turned down (rejected, withdrawn) or undone by staff (ungrouped) for that entry or that barcode; it locks each listing first (as `propose` does), re-checks, and files in a tiny transaction; it never groups. The approve hook runs on commit (`robust=True`, failures logged, never failing the approval), synchronously for now (a Celery job later). A nightly beat entry `catalogue-propose-matches` (03:10 Accra) runs it only while `CATALOGUE_MATCHER_ENABLED` (default off) is on. A newly approved barcoded entry runs the same matcher for its barcode once the approval has committed. | The brief: "nothing grouped automatically; barcode matches proposed not auto-applied". Real leaves checked: `listings` 0020, `accounts` 0054, `ledger` 0007, `notifications` 0002; neither PR #152 nor #153 adds a `listings` migration. |
| C17 | Activity log and notices | Staff POSTs are recorded by `StaffActivityMiddleware` (body included). A business's request notifies `listings.moderate` holders (`catalogue_needs_review`); approve, reject and ungroup notify the business (`catalogue_grouped`, `catalogue_not_grouped`, `catalogue_ungrouped`). | backend/CLAUDE.md: "a new staff endpoint is covered automatically". |
| C18 | Owner isolation | Every business endpoint reads the listing through `business_owner=request.user`: another business's listing or request answers **404** and changes nothing. | backend/CLAUDE.md owner-scoped isolation (`GET /api/orders/owner/`). |

## Global Constraints

- Backend only. No frontend file changes; screens are Plan 6F (gate (ci)).
- **The stock reservation at checkout is a correctness core and is not touched:** do not edit `orders/views.py`, `payments/services.py`, `orders/support.py`, `cart/`, `ledger/escrow.py`, `ledger/refunds.py`, `wallets/` or `delivery/`.
- **No existing response changes shape:** the public listing serializers gain nothing; the owner listing serializers gain only `barcode` (additive). Cart and checkout bodies are unchanged. The owner edit forms save only the fields they were sent (`listings.serializers.save_sent_fields`), so a form never writes back a grouping or a stock count it read before staff or a checkout changed it.
- **Businesses cannot be contacted directly:** no catalogue response carries a phone number, email, address, map pin, `contact_phone` or `login_phone`; a business shows by `BusinessOwner.display_name`.
- **No fabricated data:** an uncounted stock is `null` (never 0 or a guess), no sales history is `days_of_cover: null` with `basis: "fallback"`, a product nobody offers now has `lowest_price: null`, an ungrouped listing has `offers: []`.
- **Nothing is grouped automatically.** `Listing.catalogue_product` is written only by `catalogue.attach.approve` (set) and `catalogue.attach.detach` (cleared).
- Owner-scoped: every business endpoint filters `business_owner=request.user`; others' rows are 404.
- Defaults (owner may change through `ledger.setting`): fewer than **7** days of cover is low; with no sales in the window, **5** units or fewer; sales window **28** days. Sold out at 0.
- `STOCK_ALERTS_ENABLED` (env, default False) gates the alert job only; `SOLD_OUT_HIDDEN_ENABLED` (env, default False) gates the sold-out hiding in search and the related list only. Never turn either on in production without the owner's instruction.
- Commands, from `/home/righteoushack/projects/TheAshantihub/.worktrees/catalog6` (copy of `backend/.env` and `docker-compose.override.yml` already in place): tests `docker compose -p cat1 run --rm web python manage.py test <label> --noinput`; migrations `docker compose -p cat1 run --rm --user "$(id -u):$(id -g)" web python manage.py makemigrations <app> --name <name>` (so the file is not root-owned; if the container refuses to run as your user, drop `--user` and run `sudo chown "$(id -u):$(id -g)" <the new file>`). Never two docker commands at once.
- Migrations, in order, all generated: `catalogue/0001_catalogue_product.py` and `listings/0021_listing_barcode_catalogue_product.py` (Task 1), `catalogue/0002_attach_requests.py` (Task 2), `catalogue/0003_stock_alert_state.py` (Task 6), `catalogue/0004_request_ungrouped.py` (Task 8). No `accounts`, `ledger` or `notifications` migration.
- Shared files also edited by other open work — append, never reorder, and on a merge conflict keep both sides: `ledger/settings_store.py` (PR #152 relabels `verification_overdue_hours`), `ashantihub/settings.py` (`CELERY_BEAT_SCHEDULE` and `DEFAULT_THROTTLE_RATES`, PR #153), `backend/CLAUDE.md`, `CLAUDE.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md`, the spec header and §13 (PRs #152/#153 add §13 items up to (xc) and Plan 5 (dispatch-wallets-5) takes (xci)–(c); this plan numbers from (ci)).
- Never deploy, never touch the server or production. Pushing and PRs follow the `deploy` skill's flow only when the user asks.
- Style: module docstrings, plain words in user-facing messages, no type annotations outside dataclasses, tests in `backend/catalogue/tests/`, `“…”` quotes around listing names in notices (as `listings/views.py` does).

## Review Focus

1. **The same barcode typed different ways, and codes that must never group** — UPC-A vs EAN-13 with its leading zero, an 8-digit UPC-E and the UPC-A it stands for, spaces and hyphens, all one key; a wrong check digit, letters or Arabic-Indic digits refused; a store's own code (prefix 200, 021, 041, GTIN-8 starting 2) accepted on a listing but never carried into a request or a barcode match. Pinned in Task 1 (`test_review_focus_one_product_typed_three_ways_is_one_key`, `test_review_focus_store_codes_never_group`, `test_a_upc_e_is_the_same_product_as_its_upc_a`), Task 2 (`test_review_focus_store_codes_never_group`) and Task 8 (`test_what_is_never_matched`).
2. **Days of cover on thin or odd history** — an offer two days old is measured over two days, not 28, and a re-approval does not shrink the days already sold; no sales in the window falls back to the units line; sales older than the window, cancelled and unpaid orders are not sales; the business's own line replaces the default; 0 is sold out. Pinned in Task 6 (`test_review_focus_a_new_offer_is_not_diluted_by_days_it_did_not_exist`, `test_review_focus_no_sales_uses_the_fallback_line`, `test_old_cancelled_and_unpaid_orders_are_not_sales`, `test_the_business_own_line_replaces_the_default`, `test_sold_out_is_low_and_sold_out`, `test_a_re_approval_does_not_shrink_the_days_already_sold`).
3. **One alert per crossing** — repeated hourly runs, a sales rate drifting over the line with no restock, a partial restock still below the line, selling to zero twice, two runs at once (a stale state row), a run that dies part-way, saving the same own line again, the switch off. Pinned in Task 6 (`test_saving_the_same_line_again_does_not_re_arm`) and Task 7 (`test_a_run_that_dies_part_way_leaves_every_state_as_it_was`, `test_review_focus_low_is_told_once_until_restocked`, `test_review_focus_a_drifting_sales_rate_never_repeats_the_alert`, `test_sold_out_is_told_once_and_a_partial_restock_says_nothing`, `test_review_focus_two_runs_at_once_tell_once`, `test_nothing_is_measured_or_sent_while_switched_off`).
4. **Other sellers must neither leak nor invent** — suspended businesses, drafts, sold-out and unpriced offers never show; no contact field in any row; an uncounted stock is null; an unverified business is never featured; an ungrouped listing or a service answers an honest empty list; a listing customers cannot see is 404. Pinned in Task 4 (`test_review_focus_hidden_unpublished_sold_out_and_unpriced_offers_never_show`, `test_review_focus_no_contact_details_in_any_offer`, `test_review_focus_an_ungrouped_listing_answers_an_honest_empty_list`, `test_an_unverified_business_is_never_featured_even_when_cheapest`, `test_a_listing_customers_cannot_see_is_404`).
5. **Another business's rows and moderation races** — a business proposing on, reading, withdrawing for, or setting a line on another business's listing gets 404 and nothing changes; approving a request whose listing was grouped meanwhile, deciding a request twice, or re-reviewing while another request waits answers 409 (never an IntegrityError 500: the barcode matcher files requests without the listing lock, so `propose` and `re_review` catch the constraint's error). Pinned in Task 2 (`test_review_focus_another_business_listing_is_404_and_nothing_changes`, `test_another_businesses_request_is_404`), Task 3 (`test_review_focus_approving_after_the_listing_was_grouped_is_409`, `test_a_request_is_decided_once`, `test_review_focus_re_review_with_another_request_waiting_is_409`) and Task 6 (`test_review_focus_another_business_listing_is_404_and_nothing_changes`).

## Assumptions made (decided here, cheap to change — for the owner to confirm)

- **G1** Low means fewer than 7 days of sales left (strictly fewer); with no sales in the window, 5 units **or fewer**; sold out at 0. All three numbers editable through the money-settings approval. Once there is any sale in the window the units fallback stops applying: 1 left of something that sold once in 28 days is 28 days of cover and not low, while 5 left with no sales is low (owner to confirm; the alternative is to treat the fallback as a floor).
- **G2** The sales window is 28 days; a sale is a line of a paid order (a cancelled order is not a sale); a new offer is measured over the days it has been live.
- **G3** A business may set its own low-stock line (in units) per offer; it replaces the default for that offer, and changing it re-arms the low alert.
- **G4** Alerts are in-app only until Stage 4's text outbox merges; one notice per business per hourly run per kind (low, sold out), naming up to five offers.
- **G5** An offer is told again only after a restock above the stock it was told at (a drifting sales rate alone never repeats it).
- **G6** Only staff (`listings.moderate`: Operations and Super Admin) group and ungroup; a business asks and may withdraw a request it asked for, but not a barcode match AshantiHub filed, and cannot ungroup by itself. Owner-confirmed (preflight, 2026-10-16): a business cannot opt out of a barcode match AshantiHub filed. A branded listing without a barcode is grouped only if its business asks, because the matcher files barcode matches only (owner question: also file exact normalised brand-and-name matches, still decided by staff?).
- **G7** Barcodes are compared as 14-digit GTINs; store-internal codes never group; names are only offered as exact normalised matches (no fuzzy matching).
- **G8** The featured offer is the cheapest live offer from a KYC-verified business; a tie goes to the shop nearest the customer when the app sends a position, else the oldest offer. No distance is shown.
- **G9** A sold-out offer (counted goods at 0) drops out of search and the related list once `SOLD_OUT_HIDDEN_ENABLED` is on (default off); its own page stays reachable and shows 0.
- **G10** Businesses may see other businesses' prices and counted stock for the same product (both are already public).
- **G11** Stock alerts stay off (`STOCK_ALERTS_ENABLED`) until the Plan 6F screens ship; at switch-on every offer already low is told once.
- **G12** Suspended businesses get no stock alerts and their offers never show to customers.
- **G13** (owner question) Unverified (not KYC-verified) businesses stay listed among other sellers, as in public search, with `verified: false`; only the featured offer requires a KYC-verified business. Confirm this, or hide unverified rows.
- **G14** Other-sellers rows show the profile business name only (null when blank, never the owner's personal name), never include the asking listing's own business, and read at most 50 offers. Tie-break distance uses a listing's own public lat/lng only, never the staff-only business pin. Gate for Task 9's spec §13 items: `Listing.price_amount` has no floor (a 0 or negative price is possible); offers require price above 0 here, but a model/serializer floor is still owed. Frontend hand-off (Plan 6F): round or format `price_amount` for display.

## File Structure

Create:
- `backend/catalogue/__init__.py`, `apps.py`, `identity.py` (Task 1), `models.py` (Task 1: `CatalogueProduct`, `product_row`; Task 2: `CatalogueAttachRequest`; Task 6: `StockAlertState`), `errors.py` (Task 2), `attach.py` (Tasks 2, 3, 8), `views.py` (Tasks 2, 4, 5, 6), `views_staff.py` (Task 3), `urls.py` (Task 2, grown in 3–6), `offers.py` (Tasks 4, 5), `stock.py` (Task 6), `alerts.py`, `tasks.py` (Task 7), `management/__init__.py`, `management/commands/__init__.py`, `management/commands/propose_catalogue_matches.py` (Task 8)
- `backend/catalogue/migrations/__init__.py`, `0001_catalogue_product.py`, `0002_attach_requests.py`, `0003_stock_alert_state.py` (generated)
- `backend/listings/migrations/0021_listing_barcode_catalogue_product.py` (generated)
- `backend/catalogue/tests/__init__.py`, `helpers.py`, `test_identity.py`, `test_attach.py`, `test_attach_queue.py`, `test_other_sellers.py`, `test_sourcing.py`, `test_stock_cover.py`, `test_stock_alerts.py`, `test_backfill.py`

Modify:
- `backend/listings/models.py` (`barcode`, `catalogue_product`), `backend/listings/serializers.py` (`barcode` and `save_sent_fields` on the two owner serializers), `backend/listings/views.py` (browse hides sold-out offers while `SOLD_OUT_HIDDEN_ENABLED` is on), `backend/listings/visibility.py` (`sold_out_q`)
- `backend/ashantihub/settings.py` (`INSTALLED_APPS`, `STOCK_ALERTS_ENABLED`, `SOLD_OUT_HIDDEN_ENABLED`, beat entry), `backend/ashantihub/urls.py` (`api/catalogue/`)
- `backend/ledger/settings_store.py` (three settings), `backend/ledger/approval_kinds.py` (`STOCK_SETTING_KEYS`, consequences text)
- `backend/CLAUDE.md`, `CLAUDE.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`

API added or changed:

| Method + path | Who | Body → answer |
|---|---|---|
| `GET /api/catalogue/mine/<listing_id>/` | business owner (own listing) | → `{listing, groupable, barcode, store_code, catalogue_product, request}`; 404 for another business's listing |
| `POST /api/catalogue/mine/<listing_id>/requests/` | business owner | `{catalogue_product}` or `{brand?, name?}` → 201 the state above. 400 `not_groupable` / `name_required` / `brand_or_barcode_required` / `unknown_product`; 409 `already_grouped` / `request_pending` / `barcode_mismatch`; 404 |
| `POST /api/catalogue/mine/requests/<id>/withdraw/` | business owner | → 200 request row; 409 `not_pending` / `not_withdrawable`; 404 |
| `GET /api/catalogue/staff/requests/pending/?status=pending\|approved\|rejected` | `listings.moderate` | → paginated `{count, next, previous, results: [staff row]}` |
| `GET /api/catalogue/staff/requests/<id>/` | `listings.moderate` | → staff row (`listing`, the ask, `matches` while pending) |
| `POST /api/catalogue/staff/requests/<id>/approve/` | `listings.moderate` | `{}` or `{catalogue_product}` or `{brand?, name?}` → 200 `{request, catalogue_product}`; 409 `not_pending` / `already_grouped` / `barcode_mismatch` / `not_groupable`; 400 `unknown_product` / `name_required` / `brand_or_barcode_required`; 404 |
| `POST /api/catalogue/staff/requests/<id>/reject/` | `listings.moderate` | `{reason}` → 200; 400 `{"reason": ...}`; 409 `not_pending` |
| `POST /api/catalogue/staff/requests/<id>/re-review/` | `listings.moderate` | → 200; 400 `not_rejected`; 409 `request_pending` |
| `POST /api/catalogue/staff/listings/<listing_id>/detach/` | `listings.moderate` | `{reason}` → 200; 400 `{"reason": ...}`; 409 `not_grouped`; 404 |
| `GET /api/catalogue/listings/<listing_id>/other-sellers/?ordering=price\|availability&lat=&lng=` | anyone | → `{catalogue_product, featured_offer_id, ordering, offers: [{listing_id, name, price_amount, price_unit, condition, business_name, verified, zone, available_quantity}]}`; 404 for a listing customers cannot see |
| `GET /api/catalogue/products/?q=` or `?barcode=` | business owner | → `{results: [{id, brand, name, barcode, offer_count, lowest_price}]}`; 400 `query_required` / `invalid_barcode` |
| `GET /api/catalogue/products/<id>/offers/` | business owner | → `{catalogue_product, your_listings, offers}`; 404 |
| `GET /api/catalogue/stock/?page=` | business owner | paginated (page size 20; sold out first, then fewest days of cover, then id) → `{count, next, previous, results: [{listing_id, name, stock, units_sold, days_on_sale, days_of_cover, basis, line, low, sold_out}], tracked_offers, untracked_offers, settings}` |
| `PUT /api/catalogue/stock/<listing_id>/line/` | business owner | `{units: n \| null}` → 200 `{listing_id, line, cover}`; 400 `{"units": ...}` / `not_a_product`; 409 `not_counted`; 404 |
| `PATCH /api/listings/mine/<id>/manage/`, `POST`/`PATCH /api/listings/mine/...` | changed (additive) | accept and return `barcode` (any spelling in, 14-digit key out); 400 on a bad check digit or on changing a grouped listing to another barcode; the forms save only the fields sent |
| `GET /api/listings/`, `GET /api/listings/<id>/related/` | changed | while `SOLD_OUT_HIDDEN_ENABLED` is on (default off), a product or food listing with `stock_quantity` 0 does not appear; with it off nothing changes; the detail always answers |

---

### Task 1: The catalogue app, barcode and name keys, `Listing.barcode` and `Listing.catalogue_product`, spec reconciliation

**Files:**
- Create: `backend/catalogue/__init__.py`, `backend/catalogue/apps.py`, `backend/catalogue/identity.py`, `backend/catalogue/models.py`, `backend/catalogue/migrations/__init__.py`, `backend/catalogue/migrations/0001_catalogue_product.py` (generated), `backend/listings/migrations/0021_listing_barcode_catalogue_product.py` (generated), `backend/catalogue/tests/__init__.py`, `backend/catalogue/tests/helpers.py`, `backend/catalogue/tests/test_identity.py`
- Modify: `backend/listings/models.py` (after `stock_quantity`), `backend/listings/serializers.py` (`OwnerListingManageSerializer`, `OwnerListingSerializer`), `backend/ashantihub/settings.py` (`INSTALLED_APPS`), `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (append)

**Interfaces:**
- Consumes: `listings.models.Listing`, `Category`, `Zone`; `accounts.models.BusinessOwner`, `BusinessOwnerProfile`, `Customer`; `accounts.authentication.issue_token(account, kind)`; `accounts.testing.make_staff(role, email)`, `staff_token(staff)`; `orders.models.Order`, `OrderItem`.
- Produces:
  - `catalogue.identity.clean_barcode(raw) -> str` (14 digits, or "" for blank; raises `BarcodeError`), `BARCODE_MESSAGE`, `CHECK_DIGIT_MESSAGE`, `is_store_code(key) -> bool`, `normalise_name(*parts) -> str`
  - `catalogue.models.CatalogueProduct` (`brand`, `name`, `normalised_name` set on every save, `barcode`, `created_by`, `created_at`), `catalogue.models.product_row(product) -> dict | None` (`{id, brand, name, barcode}`)
  - `Listing.barcode` (`""` or a 14-digit key), `Listing.catalogue_product` (nullable FK; `CatalogueProduct.offers`)
  - `listings.serializers.clean_listing_barcode(value, instance=None) -> str`, `GROUPED_BARCODE_MESSAGE`, `save_sent_fields(instance, validated_data)` (the owner forms write only the fields they were sent)
  - test helpers in `catalogue.tests.helpers`: `BARCODE`, `OTHER_BARCODE`, `STORE_CODE`, `business(name="Adepa Ventures", *, verified=True, lat=None, lng=None, suspended=False)`, `product(owner, name="Milo 400g", *, price="25.00", stock=10, status=Listing.PUBLISHED, barcode="", brand="Nestle", category="grocery", catalogue_product=None)`, `service(owner, name="Haircut")`, `stay(owner, name="Garden Room")`, `buyer()`, `sell(listing, quantity, *, days_ago=0, status=Order.PAID)`, `go_live(listing, days_ago)`, `as_account(client, account, kind)`, `as_staff(client, role, email) -> StaffUser`

- [ ] **Step 1: The test helpers** — create `backend/catalogue/tests/__init__.py` (empty) and `backend/catalogue/tests/helpers.py`:

```python
"""Shared fixtures for the catalogue tests (catalogue plan 6)."""
import itertools
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, BusinessOwnerProfile, Customer
from accounts.testing import make_staff, staff_token
from listings.models import Category, Listing, Zone
from orders.models import Order, OrderItem

BARCODE = "04006381333931"          # EAN-13 4006381333931, kept as its 14-digit key
OTHER_BARCODE = "05000112637922"    # EAN-13 5000112637922
STORE_CODE = "02000000000015"       # EAN-13 2000000000015: a store's own number (GS1 prefix 200)

_seq = itertools.count(1)


def business(name="Adepa Ventures", *, verified=True, lat=None, lng=None, suspended=False):
    n = next(_seq)
    owner = BusinessOwner.objects.create(
        full_name=f"Owner {n}", login_phone=f"+23320{n:07d}", password_hash="x", is_suspended=suspended,
        kyc_status=BusinessOwner.VERIFIED if verified else BusinessOwner.PENDING,
    )
    BusinessOwnerProfile.objects.create(business_owner=owner, business_name=name, lat=lat, lng=lng)
    return owner


def product(owner, name="Milo 400g", *, price="25.00", stock=10, status=Listing.PUBLISHED, barcode="", brand="Nestle",
            category="grocery", catalogue_product=None):
    return Listing.objects.create(
        business_owner=owner, category=Category.objects.get(slug=category), zone=Zone.objects.get(name="Manhyia"),
        name=name, description="A tin.", contact_phone="+233209999999",
        price_amount=None if price is None else Decimal(price), stock_quantity=stock, status=status,
        barcode=barcode, brand=brand, catalogue_product=catalogue_product,
    )


def service(owner, name="Haircut"):
    return Listing.objects.create(
        business_owner=owner, category=Category.objects.get(slug="lifestyle"), zone=Zone.objects.get(name="Manhyia"),
        name=name, description="A cut.", contact_phone="+233209999999", price_amount=Decimal("30.00"),
        status=Listing.PUBLISHED,
    )


def stay(owner, name="Garden Room"):
    category, _ = Category.objects.get_or_create(
        slug="stays-test",
        defaults={"icon": "🛏", "label": "Stays", "color": "#000000", "kind": Category.SERVICE, "is_accommodation": True},
    )
    return Listing.objects.create(
        business_owner=owner, category=category, zone=Zone.objects.get(name="Manhyia"), name=name,
        description="A room.", contact_phone="+233209999999", price_amount=Decimal("300.00"), status=Listing.PUBLISHED,
    )


def buyer():
    n = next(_seq)
    return Customer.objects.create(full_name=f"Customer {n}", phone=f"+23324{n:07d}", password_hash="x")


def sell(listing, quantity, *, days_ago=0, status=Order.PAID):
    """One order line for `listing` placed `days_ago` days back (placed_at is set on create, so it is moved after)."""
    total = listing.price_amount * quantity
    order = Order.objects.create(customer=buyer(), status=status, total_amount=total)
    OrderItem.objects.create(order=order, listing=listing, quantity=quantity, unit_price=listing.price_amount, line_total=total)
    if days_ago:
        Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(days=days_ago))
    return order


def go_live(listing, days_ago):
    """Make `listing` look approved `days_ago` days back (days on sale count from approval)."""
    when = timezone.now() - timedelta(days=days_ago)
    Listing.objects.filter(pk=listing.pk).update(reviewed_at=when, created_at=when)
    listing.refresh_from_db()
    return listing


def as_account(client, account, kind):
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")


def as_staff(client, role, email):
    staff = make_staff(role, email)
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
    return staff
```

- [ ] **Step 2: Write the failing test** — `backend/catalogue/tests/test_identity.py`

```python
"""Catalogue plan 6, Task 1: what makes two listings the same product, the catalogue entry, and a listing's barcode
(spec §1 row 8). Review Focus 1 (one barcode typed different ways; store codes)."""
from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.test import APIClient

from catalogue import identity
from catalogue.models import CatalogueProduct, product_row
from catalogue.tests.helpers import BARCODE, STORE_CODE, as_account, business, product
from listings.models import Category, Listing, Zone
from listings.serializers import GROUPED_BARCODE_MESSAGE


class BarcodeTests(SimpleTestCase):
    def test_review_focus_one_product_typed_three_ways_is_one_key(self):
        # The UPC-A on a tin, the same code as an EAN-13 with its leading zero, and with the gaps printed on the pack.
        self.assertEqual(identity.clean_barcode("036000291452"), "00036000291452")
        self.assertEqual(identity.clean_barcode("0036000291452"), "00036000291452")
        self.assertEqual(identity.clean_barcode(" 0 36000 29145 2 "), "00036000291452")
        self.assertEqual(identity.clean_barcode("4006-3813-3393-1"), BARCODE)

    def test_eight_and_fourteen_digit_codes(self):
        self.assertEqual(identity.clean_barcode("73513537"), "00000073513537")
        self.assertEqual(identity.clean_barcode("00012345600012"), "00012345600012")

    def test_a_upc_e_is_the_same_product_as_its_upc_a(self):
        # An 8-digit code starting 0 or 1 whose check digit holds over its UPC-A expansion is a UPC-E (small packs and cans).
        self.assertEqual(identity.clean_barcode("01234565"), identity.clean_barcode("012345000065"))
        self.assertEqual(identity.clean_barcode("01234565"), "00012345000065")

    def test_blank_is_no_barcode(self):
        for raw in ("", "   ", None):
            self.assertEqual(identity.clean_barcode(raw), "")

    def test_a_wrong_check_digit_letters_wrong_length_or_all_zeros_are_refused(self):
        for raw in ("4006381333932", "40063813339X1", "123456789", "١٢٣٤٥٦٧٨", "00000000"):
            with self.subTest(raw=raw), self.assertRaises(identity.BarcodeError):
                identity.clean_barcode(raw)
        with self.assertRaisesMessage(identity.BarcodeError, identity.CHECK_DIGIT_MESSAGE):
            identity.clean_barcode("4006381333932")

    def test_review_focus_store_codes_never_group(self):
        self.assertTrue(identity.is_store_code(STORE_CODE))                                  # EAN-13 prefix 200
        self.assertTrue(identity.is_store_code(identity.clean_barcode("0212345678909")))      # EAN-13 prefix 021
        self.assertTrue(identity.is_store_code(identity.clean_barcode("412345678903")))       # UPC-A number system 4
        self.assertTrue(identity.is_store_code(identity.clean_barcode("20000004")))           # GTIN-8 starting 2
        for key in (BARCODE, "00036000291452", "00000073513537", ""):
            self.assertFalse(identity.is_store_code(key), key)


class NameTests(SimpleTestCase):
    def test_accents_case_and_punctuation_do_not_matter(self):
        self.assertEqual(identity.normalise_name("Nestlé", "MILO  Activ-Go, 400g"), "nestle milo activ go 400g")
        self.assertEqual(identity.normalise_name("", "Milo"), "milo")
        self.assertEqual(identity.normalise_name(None, "  "), "")

    def test_akan_and_ewe_letters_are_kept(self):
        self.assertEqual(identity.normalise_name("", "Kɔkɔɔ Ɛnam"), "kɔkɔɔ ɛnam")


class CatalogueProductTests(TestCase):
    def test_the_normalised_name_is_kept_on_save(self):
        entry = CatalogueProduct.objects.create(brand="Nestlé", name="Milo 400g", barcode=BARCODE)
        self.assertEqual(entry.normalised_name, "nestle milo 400g")
        self.assertEqual(product_row(entry), {"id": entry.pk, "brand": "Nestlé", "name": "Milo 400g", "barcode": BARCODE})
        self.assertIsNone(product_row(None))

    def test_a_barcode_belongs_to_one_entry(self):
        CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        with self.assertRaises(IntegrityError), transaction.atomic():
            CatalogueProduct.objects.create(brand="Nestle", name="Milo tin", barcode=BARCODE)
        CatalogueProduct.objects.create(brand="Nestle", name="Nido")                      # many entries may have none
        CatalogueProduct.objects.create(brand="Nestle", name="Nescafe")

    def test_an_entry_needs_a_brand_or_a_barcode(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            CatalogueProduct.objects.create(name="Tomatoes")


class ListingBarcodeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = business()
        self.listing = product(self.owner)
        as_account(self.client, self.owner, "business_owner")

    def manage(self, barcode):
        return self.client.patch(f"/api/listings/mine/{self.listing.pk}/manage/", {"barcode": barcode}, format="json")

    def test_the_barcode_is_kept_as_its_fourteen_digit_key(self):
        response = self.manage("0 36000 29145 2")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["barcode"], "00036000291452")
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.barcode, "00036000291452")

    def test_a_mistyped_barcode_is_refused(self):
        response = self.manage("4006381333932")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["barcode"], [identity.CHECK_DIGIT_MESSAGE])

    def test_a_grouped_listing_keeps_its_products_barcode(self):
        entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.listing.barcode, self.listing.catalogue_product = BARCODE, entry
        self.listing.save(update_fields=["barcode", "catalogue_product"])
        refused = self.manage("5000112637922")
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.json()["barcode"], [GROUPED_BARCODE_MESSAGE])
        self.assertEqual(self.manage("4006381333931").status_code, 200)

    def test_a_grouped_listing_without_a_barcode_can_send_its_form_unchanged(self):
        self.listing.catalogue_product = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.listing.save(update_fields=["catalogue_product"])
        self.assertEqual(self.manage("").status_code, 200)
        self.assertEqual(self.manage("5000112637922").status_code, 400)

    def test_an_owner_edit_never_writes_back_a_grouping_or_a_stock_count_it_read(self):
        from listings.serializers import OwnerListingManageSerializer
        entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        stale = Listing.objects.get(pk=self.listing.pk)
        Listing.objects.filter(pk=self.listing.pk).update(catalogue_product=entry, stock_quantity=3)  # staff; a checkout
        serializer = OwnerListingManageSerializer(stale, data={"price_amount": "26.00"}, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        self.listing.refresh_from_db()
        self.assertEqual(
            (self.listing.catalogue_product, self.listing.stock_quantity, str(self.listing.price_amount)), (entry, 3, "26.00"),
        )

    @override_settings(SUBSCRIPTIONS_ENABLED=False)
    def test_a_new_listing_can_carry_a_barcode(self):
        response = self.client.post("/api/listings/mine/", {
            "category": Category.objects.get(slug="grocery").pk, "zone": Zone.objects.get(name="Manhyia").pk,
            "name": "Milo 400g", "description": "A tin.", "price_amount": "25.00", "contact_phone": "+233209999999",
            "has_warranty": False, "has_expiry": False, "return_policy": "Unopened, within 7 days.",
            "barcode": "4006381333931",
        }, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["barcode"], BARCODE)

    def test_the_public_listing_shape_is_unchanged(self):
        self.client.credentials()
        body = self.client.get(f"/api/listings/{self.listing.pk}/").json()
        self.assertNotIn("barcode", body)
        self.assertNotIn("catalogue_product", body)
```

- [ ] **Step 3: Run it to see it fail**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue.tests.test_identity --noinput`
Expected: ERROR — `ImportError: cannot import name 'identity' from 'catalogue'` (or `Field 'barcode' does not exist` from the helpers): the app does not exist yet.

- [ ] **Step 4: The app and the keys** — create `backend/catalogue/__init__.py` (empty), `backend/catalogue/migrations/__init__.py` (empty), and `backend/catalogue/apps.py`:

```python
from django.apps import AppConfig


class CatalogueConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "catalogue"
    verbose_name = "Catalogue"
```

`backend/catalogue/identity.py`:

```python
"""What makes two listings the same product (catalogue plan 6; spec §1 row 8, §10).

* A barcode is kept as its 14-digit GTIN: digits only, zero-padded on the left, so the UPC-A 036000291452 and the
  EAN-13 0036000291452 are one key. An 8-digit code starting 0 or 1 that checks as a UPC-E (printed on small packs and
  cans) is read as the UPC-A it stands for. Spaces and hyphens may be typed. The check digit must be right (a mistyped digit
  must never group two different goods) and an all-zero code is refused.
* A store's own code (a GS1 restricted-circulation number: a GTIN-13 prefix 020-029, 040-049 or 200-299, or a GTIN-8
  starting 0 or 2) is accepted on a listing but never groups anything: two shops may print the same in-store number on
  different goods. A key starting with six zeros is read as a padded GTIN-8 (GS1 keeps that GTIN-13 range for them).
  Coupon and refund-receipt prefixes (GS1 050-059, 980-984, 99x) are not special-cased, and typed GS1-128 strings
  (`(01)...`) and EAN add-ons (15 or 18 digits) are refused as malformed.
* A name is compared by its normalised form: accents dropped, lower case, and every run of anything but a letter or a
  digit (any script, so the Akan and Ewe letters ɛ ɔ ŋ stay) turned into one space. Only exact normalised names are offered as matches; nothing is fuzzy."""
import re
import unicodedata

GTIN_LENGTHS = (8, 12, 13, 14)
BARCODE_MESSAGE = "Enter the barcode's 8, 12, 13 or 14 digits exactly as printed."
CHECK_DIGIT_MESSAGE = "This barcode's last digit does not match the others. Check it against the pack."


class BarcodeError(ValueError):
    pass


def _check_digit(body):
    total = sum(int(digit) * (3 if i % 2 == 0 else 1) for i, digit in enumerate(reversed(body)))
    return (10 - total % 10) % 10


def _upc_e_to_a(code):
    """The 12-digit UPC-A an 8-digit UPC-E (number system 0 or 1) stands for, or None."""
    system, d, check = code[0], code[1:7], code[7]
    if system not in "01":
        return None
    if d[5] in "012":
        body = d[0:2] + d[5] + "0000" + d[2:5]
    elif d[5] == "3":
        body = d[0:3] + "00000" + d[3:5]
    elif d[5] == "4":
        body = d[0:4] + "00000" + d[4]
    else:
        body = d[0:5] + "0000" + d[5]
    return system + body + check


def clean_barcode(raw):
    """The 14-digit GTIN key for `raw`, or "" for a blank one. Raises BarcodeError."""
    text = re.sub(r"[\s-]", "", str(raw or ""))
    if not text:
        return ""
    if not re.fullmatch(r"[0-9]+", text) or len(text) not in GTIN_LENGTHS:
        raise BarcodeError(BARCODE_MESSAGE)
    if len(text) == 8:
        upc_a = _upc_e_to_a(text)
        if upc_a is not None and _check_digit(upc_a[:-1]) == int(upc_a[-1]):
            text = upc_a  # a UPC-E printed on small packs: the same product as its UPC-A
    if _check_digit(text[:-1]) != int(text[-1]):
        raise BarcodeError(CHECK_DIGIT_MESSAGE)
    key = text.zfill(14)
    if int(key) == 0:
        raise BarcodeError(BARCODE_MESSAGE)
    return key


def is_store_code(key):
    """True for a store's own code (see the module text). `key` is a clean_barcode result; "" is not one."""
    if not key:
        return False
    if key.startswith("000000"):
        return key[6] in "02"
    prefix = int(key[1:4])
    return 20 <= prefix <= 29 or 40 <= prefix <= 49 or 200 <= prefix <= 299


def normalise_name(*parts):
    """The comparable form of a product's words (brand first, then name)."""
    text = unicodedata.normalize("NFKD", " ".join(str(part) for part in parts if part))
    text = "".join(char for char in text if not unicodedata.combining(char)).lower()
    return " ".join(re.sub(r"[\W_]+", " ", text).split())[:300]
```

`backend/catalogue/models.py`:

```python
"""Catalogue entries, grouping requests and stock-alert state (catalogue plan 6; spec §1 rows 7, 8 and 15, §10).

Every Listing is an offer (its own price, stock, cart line, fee and pickup). A branded or barcoded product may be grouped
with a CatalogueProduct so customers see every business selling it; unbranded goods, services, stays and events stand
alone (Listing.catalogue_product null)."""
from django.db import models

from . import identity


class CatalogueProduct(models.Model):
    """One branded or barcoded product several businesses sell. Made only when staff approve a grouping request
    (catalogue.attach.approve); a barcode belongs to one entry, and an entry needs a brand or a barcode."""

    brand = models.CharField(max_length=100, blank=True, default="")
    name = models.CharField(max_length=150)
    normalised_name = models.CharField(max_length=300, db_index=True, editable=False)
    barcode = models.CharField(max_length=14, blank=True, default="")
    created_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["normalised_name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["barcode"], condition=~models.Q(barcode=""), name="catalogue_product_barcode_unique",
            ),
            models.CheckConstraint(
                condition=~models.Q(brand="") | ~models.Q(barcode=""), name="catalogue_product_brand_or_barcode",
            ),
        ]

    def save(self, *args, **kwargs):
        self.normalised_name = identity.normalise_name(self.brand, self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return " ".join(part for part in (self.brand, self.name) if part)


def product_row(product):
    """A catalogue entry as the API shows it; None for no entry."""
    if product is None:
        return None
    return {"id": product.pk, "brand": product.brand, "name": product.name, "barcode": product.barcode}
```

- [ ] **Step 5: Install the app** — in `backend/ashantihub/settings.py` replace

```python
    "listings",
    "billing",
```

with

```python
    "listings",
    "catalogue",
    "billing",
```

- [ ] **Step 6: The listing's barcode and catalogue entry** — in `backend/listings/models.py` replace

```python
    weight = models.CharField(max_length=50, blank=True)
    stock_quantity = models.PositiveIntegerField(null=True, blank=True)
```

with

```python
    weight = models.CharField(max_length=50, blank=True)
    stock_quantity = models.PositiveIntegerField(null=True, blank=True)
    # Catalogue plan 6 (spec §1 rows 7-8, §10): the product's barcode as its 14-digit GTIN (catalogue.identity), "" when
    # none; and the shared catalogue entry this offer belongs to, set only when staff approve a grouping request
    # (catalogue.attach). Null: the listing stands alone (unbranded goods, services, stays, and every listing made before
    # plan 6). Neither is in the public serializers.
    barcode = models.CharField(max_length=14, blank=True, default="", db_index=True)
    catalogue_product = models.ForeignKey(
        "catalogue.CatalogueProduct", on_delete=models.SET_NULL, null=True, blank=True, related_name="offers",
    )
```

- [ ] **Step 7: The owner serializers take a barcode** — in `backend/listings/serializers.py`, (a) replace

```python
class OwnerListingManageSerializer(serializers.ModelSerializer):
```

with

```python
GROUPED_BARCODE_MESSAGE = (
    "This listing is grouped with a catalogue product that has a different barcode. Ask AshantiHub Support to ungroup "
    "it first."
)


def clean_listing_barcode(value, instance=None):
    """A listing's barcode as its 14-digit GTIN (catalogue plan 6; spaces and hyphens may be typed). A grouped listing
    keeps its own barcode or takes its catalogue product's; it cannot change to another."""
    from catalogue.identity import BarcodeError, clean_barcode

    try:
        key = clean_barcode(value)
    except BarcodeError as exc:
        raise serializers.ValidationError(str(exc)) from None
    product = getattr(instance, "catalogue_product", None)
    if product is not None and product.barcode and key not in (product.barcode, instance.barcode):
        raise serializers.ValidationError(GROUPED_BARCODE_MESSAGE)
    return key


def save_sent_fields(instance, validated_data):
    """Write only the fields this request sent (catalogue plan 6). ModelSerializer.update saves the whole row, which would
    write back the catalogue_product and stock_quantity this request read over a staff grouping decision or a
    checkout's decrement that committed meanwhile."""
    for attr, value in validated_data.items():
        setattr(instance, attr, value)
    instance.save(update_fields=[*validated_data, "updated_at"])
    return instance


class OwnerListingManageSerializer(serializers.ModelSerializer):
```

(b) in `OwnerListingManageSerializer` replace

```python
    class Meta:
        model = Listing
        fields = [
            "id", "price_amount", "price_unit", "tag", "contact_phone",
            "specs", "service_duration", *LISTING_DECISION_FIELDS,
        ]
```

with

```python
    # The product's barcode (catalogue plan 6): typed with spaces or hyphens, kept as its 14-digit GTIN.
    barcode = serializers.CharField(required=False, allow_blank=True, max_length=40)

    class Meta:
        model = Listing
        fields = [
            "id", "price_amount", "price_unit", "tag", "contact_phone",
            "specs", "service_duration", *LISTING_DECISION_FIELDS, "barcode",
        ]

    def validate_barcode(self, value):
        return clean_listing_barcode(value, self.instance)

    def update(self, instance, validated_data):
        return save_sent_fields(instance, validated_data)
```

(c) in `OwnerListingSerializer` replace

```python
    class Meta:
        model = Listing
        fields = [
            "id", "category", "zone", "name", "description", "price_amount", "price_unit",
            "tag", "contact_phone", "lat", "lng", "main_photo", "photos", "specs",
            "service_duration", "units_total", *LISTING_DECISION_FIELDS,
            "status", "rejection_reason", "created_at", "updated_at",
        ]
```

with

```python
    # The product's barcode (catalogue plan 6): typed with spaces or hyphens, kept as its 14-digit GTIN.
    barcode = serializers.CharField(required=False, allow_blank=True, max_length=40)

    class Meta:
        model = Listing
        fields = [
            "id", "category", "zone", "name", "description", "price_amount", "price_unit",
            "tag", "contact_phone", "lat", "lng", "main_photo", "photos", "specs",
            "service_duration", "units_total", *LISTING_DECISION_FIELDS, "barcode",
            "status", "rejection_reason", "created_at", "updated_at",
        ]
```

and (d) replace

```python
    def validate(self, data):
        return validate_listing_for_owner(
            self.context["request"].user, data, instance=self.instance, initial_data=self.initial_data,
        )
```

with

```python
    def validate_barcode(self, value):
        return clean_listing_barcode(value, self.instance)

    def validate(self, data):
        return validate_listing_for_owner(
            self.context["request"].user, data, instance=self.instance, initial_data=self.initial_data,
        )

    def update(self, instance, validated_data):
        return save_sent_fields(instance, validated_data)
```

(`barcode` is not added to `LISTING_DECISION_FIELDS`, which `PublicListingSerializer` also reads: the public shape stays as it is. Both `update` methods save only the fields sent, so a PATCH never writes back a grouping or a stock count it read; a PATCH that sends `stock_quantity` itself still races, gate (civ).)

- [ ] **Step 8: Generate the migrations**

Run: `docker compose -p cat1 run --rm --user "$(id -u):$(id -g)" web python manage.py makemigrations catalogue --name catalogue_product`
Expected: `catalogue/migrations/0001_catalogue_product.py` — `Create model CatalogueProduct` (with its two constraints).

Run: `docker compose -p cat1 run --rm --user "$(id -u):$(id -g)" web python manage.py makemigrations listings --name listing_barcode_catalogue_product`
Expected: `listings/migrations/0021_listing_barcode_catalogue_product.py` — `Add field barcode to listing`, `Add field catalogue_product to listing`; its dependencies are `("catalogue", "0001_catalogue_product")` and `("listings", "0020_category_is_food")`. No data migration: every existing listing gets `barcode=""` and `catalogue_product=NULL` (it stands alone).

- [ ] **Step 9: Run the tests**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue.tests.test_identity listings --noinput`
Expected: PASS (18 new tests; the `listings` suite unchanged).

- [ ] **Step 10: Record the reconciliation in the spec** — append to the end of `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`:

```markdown

### Stage 6 (catalogue, offers and stock alerts, backend) reconciliation (2026-10-16)

Found while writing `docs/superpowers/plans/2026-10-16-catalogue-offers-stock-6.md` (§0 there; its C1–C18). The items
below are numbered K1–K8 so they do not clash with those. "Stock offers and alerts" is §10 of this spec.

- **K1 The offer is the Listing.** A listing already is the priced, stocked, carted and ordered unit (`CartItem`,
  `OrderItem` with PROTECT, the fee snapshots, the stock reserved at checkout), so it stays the offer and gains an
  optional `catalogue_product` (null = stands alone: unbranded goods, services, stays, and every listing made before
  Stage 6) and a `barcode`. No listing, cart or checkout response changes shape; the owner listing forms gain `barcode`.
- **K2 Catalogue entries** (`catalogue.CatalogueProduct`: brand, name, normalised name, barcode) are made only when staff
  approve a business's grouping request; a barcode belongs to one entry, and an entry needs a brand or a barcode.
- **K3 Barcodes** are compared as 14-digit GTINs with the check digit verified (an 8-digit code starting 0 or 1 that
  checks as a UPC-E is read as its UPC-A); a store's own code (GS1
  restricted-circulation prefixes) may sit on a listing but never groups. Names are compared normalised, exact only.
- **K4 Grouping** is asked for by the business on its own product or food listing (services, stays and events never)
  and decided by staff with `listings.moderate` through the moderated-queue contract; only staff ungroup. The barcode
  matcher (`manage.py propose_catalogue_matches`, and every newly approved barcoded entry) only files requests; nothing
  is grouped automatically.
- **K5 Other sellers** (`GET /api/catalogue/listings/<id>/other-sellers/`) lists the live offers of the same entry,
  cheapest (or most available) first, with the featured offer of §10; no contact details. A sold-out offer (counted goods at 0)
  drops out of search and related lists once `SOLD_OUT_HIDDEN_ENABLED` is on (default off); its own page stays reachable. Businesses may look a product up (`/api/catalogue/products/`),
  read-only.
- **K6 Days of cover** = stock ÷ the sales rate over a governed window (default 28 days), counted over the days the offer
  was on sale. Low: the business's own line if set, else fewer than 7 days of cover, else (no sales) 5 units or fewer;
  sold out at 0. The three numbers are governed settings (`ledger.setting`: Accounting proposes, Super Admin approves).
- **K7 Alerts** are told once per crossing (a conditional update per offer), re-armed only by a restock, one in-app
  notice per business per hourly run and kind, behind `STOCK_ALERTS_ENABLED` (default off). Texts and emails "by
  preference" (§10) wait for Stage 4's outbox.
- **K8 Not changed:** the stock reservation at checkout (a correctness core). The timed release of an abandoned Hubtel
  checkout's reservation ("for a short window", §10) is a gate item before Plan 7.
```

- [ ] **Step 11: Commit**

```bash
git add backend/catalogue backend/listings/models.py backend/listings/serializers.py backend/listings/migrations/0021_listing_barcode_catalogue_product.py backend/ashantihub/settings.py docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md
git commit -F - <<'EOF'
feat(catalogue): catalogue entries, GTIN barcode keys and Listing.barcode/catalogue_product (plan 6)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 2: A business asks to group its listing (requests, withdraw, state)

**Files:**
- Create: `backend/catalogue/errors.py`, `backend/catalogue/attach.py`, `backend/catalogue/views.py`, `backend/catalogue/urls.py`, `backend/catalogue/migrations/0002_attach_requests.py` (generated), `backend/catalogue/tests/test_attach.py`
- Modify: `backend/catalogue/models.py` (append `CatalogueAttachRequest`), `backend/ashantihub/urls.py`

**Interfaces:**
- Consumes: `catalogue.identity.is_store_code`, `catalogue.models.CatalogueProduct`, `product_row` (Task 1); `cart.guard.kind_of(listing)`, `cart.guard.DELIVERABLE`; `notifications.services.notify_staff_role(permission, kind, title, body, link, icon)`; `accounts.views.IsBusinessOwner`; test helpers (Task 1).
- Produces:
  - `catalogue.models.CatalogueAttachRequest` (`listing`, `catalogue_product`, `brand`, `name`, `barcode`, `source` ∈ `VENDOR`/`BACKFILL`, `status` ∈ `PENDING`/`APPROVED`/`REJECTED`/`WITHDRAWN`, `rejection_reason`, `reviewed_by`, `reviewed_at`, `created_at`; at most one PENDING per listing; `Listing.catalogue_requests`)
  - `catalogue.errors.CatalogueError(message, code, status_code=400)` with `.message`, `.code`, `.status_code`, `.body() -> {"detail", "code"}`
  - `catalogue.attach.groupable(listing) -> bool`, `grouping_barcode(listing) -> str`, `describe(request) -> str`, `propose(listing, data) -> CatalogueAttachRequest`, `withdraw(owner, request_id) -> CatalogueAttachRequest`, `request_row(request) -> dict`, `state(listing) -> dict`; constants `NEEDS_REVIEW = "catalogue_needs_review"`, `NOT_GROUPABLE`, `ALREADY_GROUPED`, `REQUEST_PENDING`, `NEEDS_BRAND`, `NEEDS_NAME`, `UNKNOWN_PRODUCT`, `BARCODE_MISMATCH`, `NOT_PENDING`, `NOT_WITHDRAWABLE`, `NOT_FOUND`
  - `catalogue.views._own_listing(request, listing_id) -> Listing` (404 unless the caller's), `MineGroupingView`, `MineRequestView`, `MineWithdrawView`; URLs under `/api/catalogue/`

- [ ] **Step 1: Write the failing test** — `backend/catalogue/tests/test_attach.py`

```python
"""Catalogue plan 6, Task 2: a business asks to group its listing with a catalogue product (spec §1 row 8). Nothing is
grouped until staff decide (Task 3). Review Focus 1 (store codes) and 5 (another business's listing)."""
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.testing import make_staff
from catalogue import attach
from catalogue.models import CatalogueAttachRequest, CatalogueProduct
from catalogue.tests.helpers import BARCODE, OTHER_BARCODE, STORE_CODE, as_account, business, buyer, product, service, stay
from notifications.models import Notification


class ProposeTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = business()
        self.listing = product(self.owner, barcode=BARCODE)
        self.moderator = make_staff("operations", "ops@example.com")
        as_account(self.client, self.owner, "business_owner")

    def propose(self, listing=None, **body):
        return self.client.post(f"/api/catalogue/mine/{(listing or self.listing).pk}/requests/", body, format="json")

    def test_a_new_product_is_asked_for_from_the_listings_own_brand_and_name(self):
        response = self.propose()
        self.assertEqual(response.status_code, 201, response.content)
        request = CatalogueAttachRequest.objects.get()
        self.assertEqual(
            (request.status, request.source, request.brand, request.name, request.barcode, request.catalogue_product),
            (CatalogueAttachRequest.PENDING, CatalogueAttachRequest.VENDOR, "Nestle", "Milo 400g", BARCODE, None),
        )
        self.assertEqual(response.json()["request"]["status"], "pending")
        self.listing.refresh_from_db()
        self.assertIsNone(self.listing.catalogue_product)                        # nothing grouped until staff decide
        self.assertTrue(Notification.objects.filter(staff=self.moderator, kind=attach.NEEDS_REVIEW).exists())

    def test_an_existing_product_can_be_named(self):
        entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        response = self.propose(catalogue_product=entry.pk)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(CatalogueAttachRequest.objects.get().catalogue_product, entry)

    def test_a_barcode_alone_is_enough(self):
        listing = product(self.owner, name="Tin", brand="", barcode=OTHER_BARCODE)
        self.assertEqual(self.propose(listing).status_code, 201)

    def test_review_focus_store_codes_never_group(self):
        listing = product(self.owner, name="Kenkey", brand="", barcode=STORE_CODE)
        response = self.propose(listing)
        self.assertEqual((response.status_code, response.json()["code"]), (400, "brand_or_barcode_required"))
        response = self.propose(listing, brand="Auntie Ama")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(CatalogueAttachRequest.objects.get(listing=listing).barcode, "")   # the store code is not carried

    def test_services_and_stays_never_group(self):
        for listing in (service(self.owner), stay(self.owner)):
            response = self.propose(listing, brand="Any")
            self.assertEqual((response.status_code, response.json()["code"]), (400, "not_groupable"))
        self.assertFalse(CatalogueAttachRequest.objects.exists())

    def test_one_request_waits_at_a_time(self):
        self.assertEqual(self.propose().status_code, 201)
        response = self.propose()
        self.assertEqual((response.status_code, response.json()["code"]), (409, "request_pending"))

    def test_a_grouped_listing_cannot_ask_again(self):
        self.listing.catalogue_product = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.listing.save(update_fields=["catalogue_product"])
        response = self.propose()
        self.assertEqual((response.status_code, response.json()["code"]), (409, "already_grouped"))

    def test_an_unknown_product_or_one_with_another_barcode_is_refused(self):
        response = self.propose(catalogue_product=999999)
        self.assertEqual((response.status_code, response.json()["code"]), (400, "unknown_product"))
        other = CatalogueProduct.objects.create(brand="Cadbury", name="Bournvita", barcode=OTHER_BARCODE)
        response = self.propose(catalogue_product=other.pk)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "barcode_mismatch"))
        self.assertFalse(CatalogueAttachRequest.objects.exists())

    def test_a_blank_name_is_refused(self):
        response = self.propose(name="  ")
        self.assertEqual((response.status_code, response.json()["code"]), (400, "name_required"))

    def test_review_focus_another_business_listing_is_404_and_nothing_changes(self):
        rival = product(business("Rival Mart"), barcode=BARCODE)
        self.assertEqual(self.propose(rival).status_code, 404)
        self.assertEqual(self.client.get(f"/api/catalogue/mine/{rival.pk}/").status_code, 404)
        self.assertFalse(CatalogueAttachRequest.objects.exists())

    def test_only_business_owners(self):
        as_account(self.client, buyer(), "customer")
        self.assertEqual(self.propose().status_code, 403)


class StateAndWithdrawTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = business()
        self.listing = product(self.owner, barcode=BARCODE)
        as_account(self.client, self.owner, "business_owner")

    def test_the_state_says_what_the_listing_can_do(self):
        body = self.client.get(f"/api/catalogue/mine/{self.listing.pk}/").json()
        self.assertEqual(body, {
            "listing": self.listing.pk, "groupable": True, "barcode": BARCODE, "store_code": False,
            "catalogue_product": None, "request": None,
        })
        self.assertFalse(self.client.get(f"/api/catalogue/mine/{stay(self.owner).pk}/").json()["groupable"])

    def test_a_waiting_request_can_be_withdrawn_and_asked_again(self):
        request = attach.propose(self.listing, {})
        response = self.client.post(f"/api/catalogue/mine/requests/{request.pk}/withdraw/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "withdrawn")
        request.refresh_from_db()
        self.assertEqual(request.status, CatalogueAttachRequest.WITHDRAWN)
        again = self.client.post(f"/api/catalogue/mine/{self.listing.pk}/requests/", {}, format="json")
        self.assertEqual(again.status_code, 201, again.content)

    def test_a_decided_request_cannot_be_withdrawn(self):
        request = attach.propose(self.listing, {})
        CatalogueAttachRequest.objects.filter(pk=request.pk).update(status=CatalogueAttachRequest.REJECTED)
        response = self.client.post(f"/api/catalogue/mine/requests/{request.pk}/withdraw/")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "not_pending"))

    def test_a_barcode_match_filed_by_ashantihub_cannot_be_withdrawn(self):
        request = CatalogueAttachRequest.objects.create(
            listing=self.listing, barcode=BARCODE, source=CatalogueAttachRequest.BACKFILL,
            catalogue_product=CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE),
        )
        response = self.client.post(f"/api/catalogue/mine/requests/{request.pk}/withdraw/")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "not_withdrawable"))

    def test_another_businesses_request_is_404(self):
        request = attach.propose(product(business("Rival Mart"), barcode=BARCODE), {})
        self.assertEqual(self.client.post(f"/api/catalogue/mine/requests/{request.pk}/withdraw/").status_code, 404)
        request.refresh_from_db()
        self.assertEqual(request.status, CatalogueAttachRequest.PENDING)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue.tests.test_attach --noinput`
Expected: ERROR — `ImportError: cannot import name 'attach' from 'catalogue'`.

- [ ] **Step 3: The request model** — append to `backend/catalogue/models.py`:

```python


class CatalogueAttachRequest(models.Model):
    """A request to group one listing with a catalogue product (spec §1 row 8): an existing entry (`catalogue_product`)
    or a new one described by `brand` and `name`. Staff with listings.moderate decide it through the moderated-queue
    contract (backend/CLAUDE.md). `barcode` is the listing's own barcode when it was asked (never a store's own code). A
    backfill request (`source=backfill`) was filed by the barcode matcher; it is decided the same way and never applied
    by itself. At most one request waits per listing."""

    PENDING, APPROVED, REJECTED, WITHDRAWN = "pending", "approved", "rejected", "withdrawn"
    STATUS_CHOICES = [(PENDING, "Pending"), (APPROVED, "Approved"), (REJECTED, "Rejected"), (WITHDRAWN, "Withdrawn")]
    VENDOR, BACKFILL = "vendor", "backfill"
    SOURCE_CHOICES = [(VENDOR, "Asked by the business"), (BACKFILL, "Matched by barcode")]

    listing = models.ForeignKey("listings.Listing", on_delete=models.CASCADE, related_name="catalogue_requests")
    catalogue_product = models.ForeignKey(
        CatalogueProduct, on_delete=models.PROTECT, null=True, blank=True, related_name="requests",
    )
    brand = models.CharField(max_length=100, blank=True, default="")
    name = models.CharField(max_length=150, blank=True, default="")
    barcode = models.CharField(max_length=14, blank=True, default="")
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default=VENDOR)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    rejection_reason = models.CharField(max_length=500, null=True, blank=True)
    reviewed_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="reviewed_catalogue_requests",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["listing"], condition=models.Q(status="pending"), name="catalogue_request_one_pending_per_listing",
            ),
        ]

    def __str__(self):
        return f"Catalogue request {self.pk} for listing {self.listing_id} ({self.status})"
```

- [ ] **Step 4: The refusal shape** — `backend/catalogue/errors.py`:

```python
"""The one refusal shape of the catalogue API: {"detail", "code"} with an HTTP status."""


class CatalogueError(Exception):
    def __init__(self, message, code, status_code=400):
        super().__init__(message)
        self.message, self.code, self.status_code = message, code, status_code

    def body(self):
        return {"detail": self.message, "code": self.code}
```

- [ ] **Step 5: Asking and withdrawing** — `backend/catalogue/attach.py`:

```python
"""Grouping a business's listing with a catalogue product (catalogue plan 6; spec §1 row 8, §10).

A listing is an offer; grouping sets `Listing.catalogue_product` so customers see the other businesses selling the same
product. The business asks (`propose`) and may take back a request still waiting (`withdraw`); staff with
listings.moderate decide it and may ungroup a listing (the moderated-queue contract in backend/CLAUDE.md). Nothing is
grouped without a staff decision.

* Only products and food group (cart.guard DELIVERABLE); services, stays and events always stand alone (events are not
  listings at all).
* A request names an existing entry, or describes a new one by brand and name (each defaults to the listing's own). A
  new entry needs a brand or the listing's barcode; a store's own code (catalogue.identity.is_store_code) never counts.
* One request waits per listing: the check runs under the listing's row lock and a database constraint backs it.
* Lock order: a request row before its listing row (approve, reject, re-review); propose locks only the listing.
* The barcode matcher (Task 8) files requests without the listing lock, so `propose` and `re_review` catch the
  constraint's IntegrityError and answer 409 request_pending.
* A business may withdraw only a request it filed itself; a barcode match AshantiHub filed (source=backfill) is decided
  by staff alone (owner-confirmed: a business cannot opt out of one)."""
from django.db import IntegrityError, transaction

from cart import guard
from listings.models import Listing
from notifications.services import notify_staff_role

from . import identity
from .errors import CatalogueError
from .models import CatalogueAttachRequest, CatalogueProduct, product_row

NEEDS_REVIEW = "catalogue_needs_review"
NOT_GROUPABLE = "Only products can be grouped with other businesses' offers. Services, stays and events always stand alone."
ALREADY_GROUPED = "This listing is already grouped with a catalogue product."
REQUEST_PENDING = "A grouping request for this listing is already waiting for AshantiHub."
NEEDS_BRAND = "Give the product's brand, or add the barcode printed on the pack to the listing. Unbranded goods stand alone."
NEEDS_NAME = "Give the product's name."
UNKNOWN_PRODUCT = "That catalogue product does not exist."
BARCODE_MISMATCH = "That catalogue product has a different barcode from this listing."
NOT_PENDING = "Only a request still waiting can be changed."
NOT_WITHDRAWABLE = "AshantiHub matched this listing by its barcode; AshantiHub decides it."
NOT_FOUND = "Request not found."


def groupable(listing):
    """True for a product or food listing (cart.guard DELIVERABLE). Reads listing.category."""
    return guard.kind_of(listing) in guard.DELIVERABLE


def grouping_barcode(listing):
    """The listing's barcode when it may group (never a store's own code), else ""."""
    return "" if identity.is_store_code(listing.barcode) else listing.barcode


def _text(data, key, default, length):
    value = data.get(key)
    return str(default if value is None else value).strip()[:length]


def describe(request):
    """What a request asks to join, in words: the entry's brand and name, or the new entry's."""
    product = request.catalogue_product
    parts = (product.brand, product.name) if product is not None else (request.brand, request.name)
    return " ".join(part for part in parts if part)


def propose(listing, data):
    """File the business's request to group `listing` (the caller checked it is theirs). `data`: {"catalogue_product":
    id} for an existing entry, or {"brand", "name"} for a new one. Returns the request; raises CatalogueError."""
    with transaction.atomic():
        listing = Listing.objects.select_for_update(of=("self",)).select_related("category").get(pk=listing.pk)
        if not groupable(listing):
            raise CatalogueError(NOT_GROUPABLE, "not_groupable")
        if listing.catalogue_product_id is not None:
            raise CatalogueError(ALREADY_GROUPED, "already_grouped", 409)
        if CatalogueAttachRequest.objects.filter(listing=listing, status=CatalogueAttachRequest.PENDING).exists():
            raise CatalogueError(REQUEST_PENDING, "request_pending", 409)
        barcode = grouping_barcode(listing)
        product, brand, name = None, "", ""
        if data.get("catalogue_product") not in (None, ""):
            try:
                product = CatalogueProduct.objects.get(pk=int(data["catalogue_product"]))
            except (CatalogueProduct.DoesNotExist, TypeError, ValueError):
                raise CatalogueError(UNKNOWN_PRODUCT, "unknown_product") from None
            if product.barcode and barcode and product.barcode != barcode:
                raise CatalogueError(BARCODE_MISMATCH, "barcode_mismatch", 409)
        else:
            brand = _text(data, "brand", listing.brand, 100)
            name = _text(data, "name", listing.name, 150)
            if not name:
                raise CatalogueError(NEEDS_NAME, "name_required")
            if not brand and not barcode:
                raise CatalogueError(NEEDS_BRAND, "brand_or_barcode_required")
        try:
            with transaction.atomic():
                request = CatalogueAttachRequest.objects.create(
                    listing=listing, catalogue_product=product, brand=brand, name=name, barcode=barcode,
                )
        except IntegrityError:
            # The barcode matcher (it takes no listing lock) filed one meanwhile: one request waits per listing.
            raise CatalogueError(REQUEST_PENDING, "request_pending", 409) from None
    notify_staff_role(
        "listings.moderate", NEEDS_REVIEW, "Catalogue grouping to review",
        body=f"“{listing.name}” asks to be grouped with {describe(request)}.", link="catalogue", icon="🏷️",
    )
    return request


def withdraw(owner, request_id):
    """The business takes back a request it filed itself while it still waits (not a barcode match AshantiHub filed).
    Returns it; raises CatalogueError (404 for a request on another business's listing)."""
    with transaction.atomic():
        request = (
            CatalogueAttachRequest.objects.select_for_update(of=("self",))
            .filter(pk=request_id, listing__business_owner=owner)
            .first()
        )
        if request is None:
            raise CatalogueError(NOT_FOUND, "not_found", 404)
        if request.status != CatalogueAttachRequest.PENDING:
            raise CatalogueError(NOT_PENDING, "not_pending", 409)
        if request.source != CatalogueAttachRequest.VENDOR:
            raise CatalogueError(NOT_WITHDRAWABLE, "not_withdrawable", 409)
        request.status = CatalogueAttachRequest.WITHDRAWN
        request.save(update_fields=["status"])
    return request


def request_row(request):
    """A request as its business sees it (no staff names)."""
    return {
        "id": request.pk, "status": request.status, "source": request.source,
        "catalogue_product": product_row(request.catalogue_product),
        "brand": request.brand, "name": request.name, "barcode": request.barcode,
        "rejection_reason": request.rejection_reason, "created_at": request.created_at, "reviewed_at": request.reviewed_at,
    }


def state(listing):
    """What the business's listing can do and where its grouping stands (its latest request, if any)."""
    latest = listing.catalogue_requests.select_related("catalogue_product").order_by("-created_at", "-id").first()
    return {
        "listing": listing.pk, "groupable": groupable(listing), "barcode": listing.barcode,
        "store_code": identity.is_store_code(listing.barcode),
        "catalogue_product": product_row(listing.catalogue_product),
        "request": None if latest is None else request_row(latest),
    }
```

- [ ] **Step 6: The business endpoints** — `backend/catalogue/views.py`:

```python
"""Catalogue API for businesses and customers (catalogue plan 6). Every business endpoint reads the listing through
`business_owner=request.user`, so another business's listing is a 404 and nothing changes."""
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsBusinessOwner
from listings.models import Listing

from . import attach
from .errors import CatalogueError


def _own_listing(request, listing_id):
    return generics.get_object_or_404(
        Listing.objects.select_related("category", "catalogue_product"), pk=listing_id, business_owner=request.user,
    )


def _body(request):
    return request.data if isinstance(request.data, dict) else {}


class MineGroupingView(APIView):
    """GET mine/<listing_id>/ — what the business's listing can do and where its grouping stands."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get(self, request, listing_id):
        return Response(attach.state(_own_listing(request, listing_id)))


class MineRequestView(APIView):
    """POST mine/<listing_id>/requests/ {catalogue_product} or {brand?, name?} — ask AshantiHub to group the listing.
    Answers 201 with the listing's state; nothing is grouped until staff decide."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def post(self, request, listing_id):
        listing = _own_listing(request, listing_id)
        try:
            attach.propose(listing, _body(request))
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(attach.state(listing), status=201)


class MineWithdrawView(APIView):
    """POST mine/requests/<id>/withdraw/ — take back a request still waiting."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def post(self, request, pk):
        try:
            withdrawn = attach.withdraw(request.user, pk)
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(attach.request_row(withdrawn))
```

- [ ] **Step 7: The URLs** — `backend/catalogue/urls.py`:

```python
from django.urls import path

from . import views

urlpatterns = [
    path("mine/<int:listing_id>/", views.MineGroupingView.as_view(), name="catalogue-mine"),
    path("mine/<int:listing_id>/requests/", views.MineRequestView.as_view(), name="catalogue-mine-request"),
    path("mine/requests/<int:pk>/withdraw/", views.MineWithdrawView.as_view(), name="catalogue-mine-withdraw"),
]
```

and in `backend/ashantihub/urls.py` replace

```python
    path("api/listings/", include("listings.urls")),
```

with

```python
    path("api/listings/", include("listings.urls")),
    path("api/catalogue/", include("catalogue.urls")),
```

- [ ] **Step 8: Generate the migration**

Run: `docker compose -p cat1 run --rm --user "$(id -u):$(id -g)" web python manage.py makemigrations catalogue --name attach_requests`
Expected: `catalogue/migrations/0002_attach_requests.py` — `Create model CatalogueAttachRequest` with the constraint `catalogue_request_one_pending_per_listing`; it depends on `("listings", "0021_listing_barcode_catalogue_product")`.

- [ ] **Step 9: Run the tests**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue --noinput`
Expected: PASS (16 new tests in `test_attach`; `test_identity` still passing).

- [ ] **Step 10: Commit**

```bash
git add backend/catalogue backend/ashantihub/urls.py
git commit -F - <<'EOF'
feat(catalogue): a business asks to group its listing; one request waits per listing; store codes never group (plan 6)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 3: Staff decide grouping requests (moderated-queue contract) and may ungroup a listing

**Files:**
- Create: `backend/catalogue/views_staff.py`, `backend/catalogue/tests/test_attach_queue.py`
- Modify: `backend/catalogue/attach.py` (imports; append the staff decisions), `backend/catalogue/urls.py`

**Interfaces:**
- Consumes: Task 2's `attach` (`groupable`, `grouping_barcode`, `describe`, `_text`, `propose`, the message constants), `CatalogueError`, `CatalogueAttachRequest`, `CatalogueProduct`, `product_row`; `accounts.permissions.HasRolePermission`; `notifications.services.notify_business_owner`, `notify_staff_role`.
- Produces:
  - `catalogue.attach.approve(request_id, staff, data=None) -> (CatalogueAttachRequest, CatalogueProduct)`, `reject(request_id, staff, reason) -> CatalogueAttachRequest`, `re_review(request_id) -> CatalogueAttachRequest`, `detach(listing_id, reason) -> Listing`, `matches(request, limit=5) -> list[CatalogueProduct]`, `matches_for(requests, limit=5) -> dict[int, list[CatalogueProduct]]` (one query for a page), `staff_row(request, found=None) -> dict`; `_product_for(request, listing, staff, data) -> (CatalogueProduct, created: bool)` (Task 8 hooks the matcher on `created`)
  - constants `GROUPED = "catalogue_grouped"`, `NOT_GROUPED = "catalogue_not_grouped"`, `UNGROUPED = "catalogue_ungrouped"`, `REASON_REQUIRED`, `NOT_REJECTED`, `NOT_GROUPED_MESSAGE`, `LISTING_NOT_FOUND`
  - `catalogue.views_staff.PERMISSION = "listings.moderate"`, `ATTACH_STATUS_MAP`, `RequestQueueView`, `RequestDetailView`, `RequestApproveView`, `RequestRejectView`, `RequestReReviewView`, `ListingDetachView`

- [ ] **Step 1: Write the failing test** — `backend/catalogue/tests/test_attach_queue.py`

```python
"""Catalogue plan 6, Task 3: staff decide grouping requests through the moderated-queue contract (backend/CLAUDE.md)
and may ungroup a listing. Review Focus 5 (grouped meanwhile, decided twice, re-review with another request waiting)."""
from datetime import timedelta

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from catalogue import attach
from catalogue.models import CatalogueAttachRequest, CatalogueProduct
from catalogue.tests.helpers import BARCODE, OTHER_BARCODE, as_account, as_staff, business, product
from notifications.models import Notification

QUEUE = "/api/catalogue/staff/requests/pending/"


def url(request, action=""):
    return f"/api/catalogue/staff/requests/{request.pk}/{action + '/' if action else ''}"


class QueueTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff = as_staff(self.client, "operations", "ops@example.com")
        self.owner = business()
        self.first = attach.propose(product(self.owner, "Milo 400g", barcode=BARCODE), {})
        self.second = attach.propose(product(self.owner, "Milo 900g", brand="Nestle"), {})
        CatalogueAttachRequest.objects.filter(pk=self.first.pk).update(created_at=timezone.now() - timedelta(hours=2))

    def ids(self, query=""):
        response = self.client.get(QUEUE + query)
        self.assertEqual(response.status_code, 200, response.content)
        return [row["id"] for row in response.json()["results"]]

    def test_pending_is_the_default_oldest_first(self):
        self.assertEqual(self.ids(), [self.first.pk, self.second.pk])
        self.assertEqual(self.ids("?status=nonsense"), [self.first.pk, self.second.pk])   # unknown falls back to pending

    def test_history_tabs_newest_decision_first(self):
        attach.reject(self.first.pk, self.staff, "Not a branded product.")
        attach.reject(self.second.pk, self.staff, "Duplicate.")
        CatalogueAttachRequest.objects.filter(pk=self.first.pk).update(reviewed_at=timezone.now() - timedelta(hours=1))
        self.assertEqual(self.ids("?status=rejected"), [self.second.pk, self.first.pk])
        self.assertEqual(self.ids("?status=approved"), [])
        self.assertEqual(self.ids(), [])

    def test_only_listing_moderators(self):
        as_staff(self.client, "accountant", "acc@example.com")
        self.assertEqual(self.client.get(QUEUE).status_code, 403)
        self.assertEqual(self.client.post(url(self.first, "approve"), {}, format="json").status_code, 403)

    def test_a_row_shows_the_listing_the_ask_and_existing_matches(self):
        CatalogueProduct.objects.create(brand="Nestle", name="Milo 900g")
        row = self.client.get(url(self.second)).json()
        self.assertEqual(row["listing"]["name"], "Milo 900g")
        self.assertEqual(row["listing"]["business_name"], "Adepa Ventures")
        self.assertEqual((row["brand"], row["name"], row["status"]), ("Nestle", "Milo 900g", "pending"))
        self.assertEqual([m["name"] for m in row["matches"]], ["Milo 900g"])

    def test_the_queue_costs_the_same_queries_whatever_its_length(self):
        def queries():
            with CaptureQueriesContext(connection) as captured:
                self.assertEqual(self.client.get(QUEUE).status_code, 200)
            return len(captured)

        before = queries()
        for n in range(4):
            attach.propose(product(self.owner, f"Tin {n}", brand="Nestle"), {})
        self.assertEqual(queries(), before)


class DecisionTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff = as_staff(self.client, "operations", "ops@example.com")
        self.owner = business()
        self.listing = product(self.owner, barcode=BARCODE)
        self.request = attach.propose(self.listing, {})

    def approve(self, request=None, **body):
        return self.client.post(url(request or self.request, "approve"), body, format="json")

    def test_approving_makes_the_product_and_groups_the_listing(self):
        response = self.approve()
        self.assertEqual(response.status_code, 200, response.content)
        entry = CatalogueProduct.objects.get()
        self.assertEqual(
            (entry.brand, entry.name, entry.barcode, entry.normalised_name, entry.created_by),
            ("Nestle", "Milo 400g", BARCODE, "nestle milo 400g", self.staff),
        )
        self.assertEqual(response.json()["catalogue_product"]["id"], entry.pk)
        self.listing.refresh_from_db()
        self.request.refresh_from_db()
        self.assertEqual(self.listing.catalogue_product, entry)
        self.assertEqual(
            (self.request.status, self.request.catalogue_product, self.request.reviewed_by),
            (CatalogueAttachRequest.APPROVED, entry, self.staff),
        )
        self.assertIsNotNone(self.request.reviewed_at)
        self.assertTrue(Notification.objects.filter(business_owner=self.owner, kind=attach.GROUPED).exists())

    def test_a_barcode_already_in_the_catalogue_joins_that_product(self):
        entry = CatalogueProduct.objects.create(brand="Nestlé", name="Milo Tin 400 g", barcode=BARCODE)
        self.assertEqual(self.approve().status_code, 200)
        self.listing.refresh_from_db()
        self.assertEqual((self.listing.catalogue_product, CatalogueProduct.objects.count()), (entry, 1))

    def test_staff_may_correct_the_name_or_point_it_at_another_product(self):
        sachet = attach.propose(product(self.owner, "Milo sachet", brand="Nestle"), {})
        response = self.approve(sachet, brand="Nestlé", name="Milo Sachet 20 g")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(CatalogueProduct.objects.get(name="Milo Sachet 20 g").brand, "Nestlé")
        target = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g")
        response = self.approve(catalogue_product=target.pk)
        self.assertEqual(response.status_code, 200, response.content)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.catalogue_product, target)

    def test_a_product_with_another_barcode_is_refused(self):
        other = CatalogueProduct.objects.create(brand="Cadbury", name="Bournvita", barcode=OTHER_BARCODE)
        response = self.approve(catalogue_product=other.pk)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "barcode_mismatch"))
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, CatalogueAttachRequest.PENDING)

    def test_review_focus_approving_after_the_listing_was_grouped_is_409(self):
        self.listing.catalogue_product = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g")
        self.listing.save(update_fields=["catalogue_product"])
        response = self.approve()
        self.assertEqual((response.status_code, response.json()["code"]), (409, "already_grouped"))
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, CatalogueAttachRequest.PENDING)

    def test_a_request_is_decided_once(self):
        self.assertEqual(self.approve().status_code, 200)
        for action in ("approve", "reject"):
            response = self.client.post(url(self.request, action), {"reason": "x"}, format="json")
            self.assertEqual((response.status_code, response.json()["code"]), (409, "not_pending"), action)
        self.assertEqual(CatalogueProduct.objects.count(), 1)

    def test_rejecting_needs_a_reason_and_tells_the_business(self):
        response = self.client.post(url(self.request, "reject"), {"reason": "  "}, format="json")
        self.assertEqual((response.status_code, response.json()), (400, {"reason": attach.REASON_REQUIRED}))
        response = self.client.post(url(self.request, "reject"), {"reason": "Not a branded product."}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.request.refresh_from_db()
        self.assertEqual(
            (self.request.status, self.request.rejection_reason, self.request.reviewed_by),
            (CatalogueAttachRequest.REJECTED, "Not a branded product.", self.staff),
        )
        notice = Notification.objects.get(business_owner=self.owner, kind=attach.NOT_GROUPED)
        self.assertIn("Not a branded product.", notice.body)

    def test_re_review_only_from_rejected_and_it_clears_the_decision(self):
        response = self.client.post(url(self.request, "re-review"))
        self.assertEqual((response.status_code, response.json()["code"]), (400, "not_rejected"))
        attach.reject(self.request.pk, self.staff, "Blurry.")
        response = self.client.post(url(self.request, "re-review"))
        self.assertEqual(response.status_code, 200, response.content)
        self.request.refresh_from_db()
        self.assertEqual(
            (self.request.status, self.request.rejection_reason, self.request.reviewed_by, self.request.reviewed_at),
            (CatalogueAttachRequest.PENDING, None, None, None),
        )

    def test_review_focus_re_review_with_another_request_waiting_is_409(self):
        attach.reject(self.request.pk, self.staff, "Blurry.")
        attach.propose(self.listing, {"brand": "Nestle", "name": "Milo 400 g"})
        response = self.client.post(url(self.request, "re-review"))
        self.assertEqual((response.status_code, response.json()["code"]), (409, "request_pending"))


class DetachTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.staff = as_staff(self.client, "operations", "ops@example.com")
        self.owner = business()
        self.entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.listing = product(self.owner, barcode=BARCODE, catalogue_product=self.entry)

    def detach(self, listing_id, reason="Wrong product."):
        return self.client.post(f"/api/catalogue/staff/listings/{listing_id}/detach/", {"reason": reason}, format="json")

    def test_staff_ungroup_with_a_reason_and_the_business_is_told(self):
        response = self.detach(self.listing.pk)
        self.assertEqual(response.status_code, 200, response.content)
        self.listing.refresh_from_db()
        self.assertIsNone(self.listing.catalogue_product)
        self.assertTrue(CatalogueProduct.objects.filter(pk=self.entry.pk).exists())         # the entry stays for others
        notice = Notification.objects.get(business_owner=self.owner, kind=attach.UNGROUPED)
        self.assertIn("Wrong product.", notice.body)

    def test_a_reason_is_needed_an_ungrouped_listing_is_409_and_an_unknown_one_404(self):
        self.assertEqual(self.detach(self.listing.pk, " ").json(), {"reason": attach.REASON_REQUIRED})
        self.assertEqual(self.detach(self.listing.pk).status_code, 200)
        response = self.detach(self.listing.pk)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "not_grouped"))
        self.assertEqual(self.detach(999999).status_code, 404)

    def test_a_business_cannot_ungroup_itself(self):
        as_account(self.client, self.owner, "business_owner")
        self.assertEqual(self.detach(self.listing.pk).status_code, 403)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.catalogue_product, self.entry)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue.tests.test_attach_queue --noinput`
Expected: FAIL/ERROR — `404 != 200` on the staff URLs and `AttributeError: module 'catalogue.attach' has no attribute 'reject'`.

- [ ] **Step 3: The staff decisions** — in `backend/catalogue/attach.py`, (a) replace

```python
from django.db import IntegrityError, transaction

from cart import guard
from listings.models import Listing
from notifications.services import notify_staff_role
```

with

```python
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from cart import guard
from listings.models import Listing
from notifications.services import notify_business_owner, notify_staff_role
```

and (b) append to the end of the file:

```python


# --- Staff decisions (listings.moderate; the moderated-queue contract) ----------------------------------------------

GROUPED, NOT_GROUPED, UNGROUPED = "catalogue_grouped", "catalogue_not_grouped", "catalogue_ungrouped"
REASON_REQUIRED = "A reason is required."
NOT_REJECTED = "Only a rejected request can be sent back for re-review."
NOT_GROUPED_MESSAGE = "This listing is not grouped."
LISTING_NOT_FOUND = "Listing not found."
MATCH_LIMIT = 5


def _locked_request(request_id):
    request = CatalogueAttachRequest.objects.select_for_update().filter(pk=request_id).first()
    if request is None:
        raise CatalogueError(NOT_FOUND, "not_found", 404)
    return request


def _product_for(request, listing, staff, data):
    """The entry the listing joins, and whether it was made now: the one staff name, else the one asked for, else the
    one already holding the listing's barcode, else a new one from the request (staff may correct its brand and name).
    The listing's barcode is read now, not from the request: it may have changed since."""
    barcode = grouping_barcode(listing)
    product = request.catalogue_product
    if data.get("catalogue_product") not in (None, ""):
        try:
            product = CatalogueProduct.objects.get(pk=int(data["catalogue_product"]))
        except (CatalogueProduct.DoesNotExist, TypeError, ValueError):
            raise CatalogueError(UNKNOWN_PRODUCT, "unknown_product") from None
    if product is None and barcode:
        product = CatalogueProduct.objects.filter(barcode=barcode).first()
    if product is not None:
        if product.barcode and barcode and product.barcode != barcode:
            raise CatalogueError(BARCODE_MISMATCH, "barcode_mismatch", 409)
        return product, False
    brand = _text(data, "brand", request.brand, 100)
    name = _text(data, "name", request.name, 150)
    if not name:
        raise CatalogueError(NEEDS_NAME, "name_required")
    if not brand and not barcode:
        raise CatalogueError(NEEDS_BRAND, "brand_or_barcode_required")
    if barcode:
        # get_or_create: two approvals racing on one new barcode make one entry (the unique constraint decides).
        return CatalogueProduct.objects.get_or_create(
            barcode=barcode, defaults={"brand": brand, "name": name, "created_by": staff},
        )
    return CatalogueProduct.objects.create(brand=brand, name=name, created_by=staff), True


def approve(request_id, staff, data=None):
    """Group the request's listing. Locks the request, then the listing; re-checks both. Returns (request, product);
    raises CatalogueError (409 when it was decided already or the listing was grouped meanwhile)."""
    data = data or {}
    with transaction.atomic():
        request = _locked_request(request_id)
        if request.status != CatalogueAttachRequest.PENDING:
            raise CatalogueError(NOT_PENDING, "not_pending", 409)
        listing = (
            Listing.objects.select_for_update(of=("self",)).select_related("category", "business_owner")
            .get(pk=request.listing_id)
        )
        if listing.catalogue_product_id is not None:
            raise CatalogueError(ALREADY_GROUPED, "already_grouped", 409)
        if not groupable(listing):
            raise CatalogueError(NOT_GROUPABLE, "not_groupable", 409)
        product, created = _product_for(request, listing, staff, data)
        listing.catalogue_product = product
        listing.save(update_fields=["catalogue_product"])
        request.catalogue_product = product
        request.status = CatalogueAttachRequest.APPROVED
        request.rejection_reason = None
        request.reviewed_by = staff
        request.reviewed_at = timezone.now()
        request.save(update_fields=["catalogue_product", "status", "rejection_reason", "reviewed_by", "reviewed_at"])
    notify_business_owner(
        listing.business_owner, GROUPED, "Listing grouped with other sellers",
        body=f"“{listing.name}” now shows with other businesses' offers of {describe(request)}. Customers compare offers "
             "by price.",
        link="/business-dashboard", icon="🏷️",
    )
    return request, product


def reject(request_id, staff, reason):
    """Turn a waiting request down with a reason the business is told. Raises CatalogueError."""
    reason = (reason or "").strip()
    if not reason:
        raise CatalogueError(REASON_REQUIRED, "reason_required")
    with transaction.atomic():
        request = _locked_request(request_id)
        if request.status != CatalogueAttachRequest.PENDING:
            raise CatalogueError(NOT_PENDING, "not_pending", 409)
        request.status = CatalogueAttachRequest.REJECTED
        request.rejection_reason = reason[:500]
        request.reviewed_by = staff
        request.reviewed_at = timezone.now()
        request.save(update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at"])
    listing = request.listing
    notify_business_owner(
        listing.business_owner, NOT_GROUPED, "Grouping not approved",
        body=f"“{listing.name}” stays on its own: {request.rejection_reason}", link="/business-dashboard", icon="⚠️",
    )
    return request


def re_review(request_id):
    """Send a rejected request back to pending, clearing the reason and the reviewer pair. Refused (409) while another
    request for the listing waits: one waits per listing. Locks the request, then the listing (as approve does)."""
    with transaction.atomic():
        request = _locked_request(request_id)
        if request.status != CatalogueAttachRequest.REJECTED:
            raise CatalogueError(NOT_REJECTED, "not_rejected")
        Listing.objects.select_for_update(of=("self",)).get(pk=request.listing_id)
        if CatalogueAttachRequest.objects.filter(
            listing_id=request.listing_id, status=CatalogueAttachRequest.PENDING,
        ).exists():
            raise CatalogueError(REQUEST_PENDING, "request_pending", 409)
        request.status = CatalogueAttachRequest.PENDING
        request.rejection_reason = None
        request.reviewed_by = None
        request.reviewed_at = None
        try:
            with transaction.atomic():
                request.save(update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at"])
        except IntegrityError:
            # The barcode matcher (it takes no listing lock) filed one meanwhile: one request waits per listing.
            raise CatalogueError(REQUEST_PENDING, "request_pending", 409) from None
    notify_staff_role(
        "listings.moderate", NEEDS_REVIEW, "Catalogue grouping re-opened",
        body=f"“{request.listing.name}” is waiting for a decision again.", link="catalogue", icon="🏷️",
    )
    return request


def detach(listing_id, reason):
    """Ungroup a listing (staff only); the entry stays for the other offers. Raises CatalogueError."""
    reason = (reason or "").strip()
    if not reason:
        raise CatalogueError(REASON_REQUIRED, "reason_required")
    with transaction.atomic():
        listing = (
            Listing.objects.select_for_update(of=("self",)).select_related("catalogue_product", "business_owner")
            .filter(pk=listing_id).first()
        )
        if listing is None:
            raise CatalogueError(LISTING_NOT_FOUND, "not_found", 404)
        product = listing.catalogue_product
        if product is None:
            raise CatalogueError(NOT_GROUPED_MESSAGE, "not_grouped", 409)
        listing.catalogue_product = None
        listing.save(update_fields=["catalogue_product"])
    notify_business_owner(
        listing.business_owner, UNGROUPED, "Listing ungrouped",
        body=f"“{listing.name}” no longer shows with other sellers of {product}: {reason[:500]}",
        link="/business-dashboard", icon="🏷️",
    )
    return listing


def matches(request, limit=MATCH_LIMIT):
    """Entries a reviewer should see before a new one is made: the same barcode, or the same normalised brand and name
    (exact only), apart from the entry the request already names."""
    name = identity.normalise_name(request.brand, request.name)
    condition = Q(normalised_name=name) if name else Q(pk__in=[])
    if request.barcode:
        condition |= Q(barcode=request.barcode)
    queryset = CatalogueProduct.objects.filter(condition)
    if request.catalogue_product_id:
        queryset = queryset.exclude(pk=request.catalogue_product_id)
    return list(queryset.order_by("pk")[:limit])


def matches_for(requests, limit=MATCH_LIMIT):
    """{request id: entries} for a page of pending requests in one query (the staff queue); as `matches`."""
    keys = {r.pk: (identity.normalise_name(r.brand, r.name), r.barcode)
            for r in requests if r.status == CatalogueAttachRequest.PENDING}
    names = sorted({name for name, _ in keys.values() if name})
    codes = sorted({code for _, code in keys.values() if code})
    if not names and not codes:
        return {}
    entries = list(CatalogueProduct.objects.filter(Q(normalised_name__in=names) | Q(barcode__in=codes)).order_by("pk"))
    found = {}
    for request in requests:
        if request.pk in keys:
            name, code = keys[request.pk]
            found[request.pk] = [
                e for e in entries if e.pk != request.catalogue_product_id
                and ((name and e.normalised_name == name) or (code and e.barcode == code))
            ][:limit]
    return found


def staff_row(request, found=None):
    """A request as the staff queue shows it: the listing (no contact details), the ask, and matches while pending
    (`found`: the entries `matches_for` worked out for a whole page; else looked up for this one request)."""
    listing = request.listing
    return {
        "id": request.pk, "status": request.status, "source": request.source,
        "brand": request.brand, "name": request.name, "barcode": request.barcode,
        "catalogue_product": product_row(request.catalogue_product),
        "rejection_reason": request.rejection_reason, "created_at": request.created_at,
        "reviewed_at": request.reviewed_at,
        "reviewed_by_name": request.reviewed_by.full_name if request.reviewed_by_id else None,
        "listing": {
            "id": listing.pk, "name": listing.name, "brand": listing.brand, "barcode": listing.barcode,
            "status": listing.status,
            "price_amount": None if listing.price_amount is None else str(listing.price_amount),
            "business_name": listing.business_owner.display_name,
            "grouped_with": product_row(listing.catalogue_product),
        },
        "matches": (
            [product_row(p) for p in (found if found is not None else matches(request))]
            if request.status == CatalogueAttachRequest.PENDING else []
        ),
    }
```

- [ ] **Step 4: The staff endpoints** — `backend/catalogue/views_staff.py`:

```python
"""Staff side of catalogue grouping (catalogue plan 6): the queue of grouping requests and ungrouping a listing.

Follows the moderated-queue contract (backend/CLAUDE.md): the historical .../pending/ URL with
?status=pending|approved|rejected (an unknown value falls back to pending), pending oldest first, history newest decision
first with a -created_at/-id fallback, approve and reject set reviewed_by/reviewed_at, re-review only from rejected.
Every action needs listings.moderate (the listing moderators). StaffActivityMiddleware records every POST here, the
reason included."""
from django.db.models import F
from rest_framework import generics
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission

from . import attach
from .errors import CatalogueError
from .models import CatalogueAttachRequest, product_row

PERMISSION = "listings.moderate"
ATTACH_STATUS_MAP = {
    "pending": CatalogueAttachRequest.PENDING,
    "approved": CatalogueAttachRequest.APPROVED,
    "rejected": CatalogueAttachRequest.REJECTED,
}
ROW_RELATED = ("listing__business_owner__profile", "listing__catalogue_product", "catalogue_product", "reviewed_by")


class Pagination(PageNumberPagination):
    page_size = 50


def _body(request):
    return request.data if isinstance(request.data, dict) else {}


def _reason(request):
    return str(_body(request).get("reason") or "").strip()


class ModeratorView(APIView):
    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]


class RequestQueueView(generics.ListAPIView):
    """GET staff/requests/pending/?status=pending|approved|rejected&page=N."""

    pagination_class = Pagination

    def get_permissions(self):
        return [HasRolePermission(PERMISSION)]

    def get_queryset(self):
        status = ATTACH_STATUS_MAP.get(self.request.query_params.get("status", "pending"), CatalogueAttachRequest.PENDING)
        queryset = CatalogueAttachRequest.objects.filter(status=status).select_related(*ROW_RELATED)
        if status == CatalogueAttachRequest.PENDING:
            return queryset.order_by("created_at", "id")
        return queryset.order_by(F("reviewed_at").desc(nulls_last=True), "-created_at", "-id")

    def list(self, request, *args, **kwargs):
        page = self.paginate_queryset(self.get_queryset())
        found = attach.matches_for(page)  # one query for the whole page, not one per row
        return self.get_paginated_response([attach.staff_row(row, found.get(row.pk, [])) for row in page])


class RequestDetailView(ModeratorView):
    """GET staff/requests/<id>/."""

    def get(self, request, pk):
        row = CatalogueAttachRequest.objects.select_related(*ROW_RELATED).filter(pk=pk).first()
        if row is None:
            return Response({"detail": attach.NOT_FOUND, "code": "not_found"}, status=404)
        return Response(attach.staff_row(row))


class RequestApproveView(ModeratorView):
    """POST staff/requests/<id>/approve/ {} or {catalogue_product} or {brand?, name?}."""

    def post(self, request, pk):
        try:
            decided, product = attach.approve(pk, request.user, _body(request))
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response({"request": attach.staff_row(decided), "catalogue_product": product_row(product)})


class RequestRejectView(ModeratorView):
    """POST staff/requests/<id>/reject/ {reason}."""

    def post(self, request, pk):
        reason = _reason(request)
        if not reason:
            return Response({"reason": attach.REASON_REQUIRED}, status=400)
        try:
            decided = attach.reject(pk, request.user, reason)
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(attach.staff_row(decided))


class RequestReReviewView(ModeratorView):
    """POST staff/requests/<id>/re-review/ — a rejected request back to pending."""

    def post(self, request, pk):
        try:
            reopened = attach.re_review(pk)
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response(attach.staff_row(reopened))


class ListingDetachView(ModeratorView):
    """POST staff/listings/<listing_id>/detach/ {reason} — ungroup a listing; the business is told why."""

    def post(self, request, listing_id):
        reason = _reason(request)
        if not reason:
            return Response({"reason": attach.REASON_REQUIRED}, status=400)
        try:
            listing = attach.detach(listing_id, reason)
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response({"listing": listing.pk, "catalogue_product": None})
```

- [ ] **Step 5: The URLs** — replace the whole of `backend/catalogue/urls.py` with:

```python
from django.urls import path

from . import views, views_staff

urlpatterns = [
    path("mine/<int:listing_id>/", views.MineGroupingView.as_view(), name="catalogue-mine"),
    path("mine/<int:listing_id>/requests/", views.MineRequestView.as_view(), name="catalogue-mine-request"),
    path("mine/requests/<int:pk>/withdraw/", views.MineWithdrawView.as_view(), name="catalogue-mine-withdraw"),
    path("staff/requests/pending/", views_staff.RequestQueueView.as_view(), name="catalogue-staff-queue"),
    path("staff/requests/<int:pk>/", views_staff.RequestDetailView.as_view(), name="catalogue-staff-request"),
    path("staff/requests/<int:pk>/approve/", views_staff.RequestApproveView.as_view(), name="catalogue-staff-approve"),
    path("staff/requests/<int:pk>/reject/", views_staff.RequestRejectView.as_view(), name="catalogue-staff-reject"),
    path("staff/requests/<int:pk>/re-review/", views_staff.RequestReReviewView.as_view(), name="catalogue-staff-re-review"),
    path("staff/listings/<int:listing_id>/detach/", views_staff.ListingDetachView.as_view(), name="catalogue-staff-detach"),
]
```

- [ ] **Step 6: Run the tests**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue --noinput`
Expected: PASS (17 new tests in `test_attach_queue`).

- [ ] **Step 7: Commit**

```bash
git add backend/catalogue
git commit -F - <<'EOF'
feat(catalogue): staff grouping queue on the moderated-queue contract; approve under lock, reject, re-review, ungroup (plan 6)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 4: Other sellers for customers, the featured offer, and sold-out offers leaving search

**Files:**
- Create: `backend/catalogue/offers.py`, `backend/catalogue/tests/test_other_sellers.py`
- Modify: `backend/catalogue/views.py` (imports; append `OtherSellersView`), `backend/catalogue/urls.py`, `backend/listings/visibility.py` (`sold_out_q`; docstring), `backend/listings/views.py` (import; `PublicListingListView.get_queryset`, `RelatedListingsView.get_queryset`)

**Interfaces:**
- Consumes: `catalogue.models.product_row`; `listings.visibility.hidden_business_q(prefix)`; `field.services.business_pin(owner) -> (lat, lng) | None`, `haversine_m(lat1, lng1, lat2, lng2) -> float`; `BusinessOwner.display_name`, `BusinessOwner.VERIFIED`.
- Produces:
  - `catalogue.offers.PRICE = "price"`, `AVAILABILITY = "availability"`, `in_stock_q(prefix="")`, `live_q(prefix="")`, `live_offers(product_id) -> QuerySet[Listing]`, `position_from(params) -> (lat, lng) | None`, `featured(offers, position=None) -> Listing | None`, `ordered(offers, ordering=PRICE, position=None) -> list[Listing]`, `offer_row(listing) -> dict` (`{listing_id, name, price_amount, price_unit, condition, business_name, verified, zone, available_quantity}`), `other_sellers(listing, params) -> dict`
  - `catalogue.views.OtherSellersView` at `listings/<int:listing_id>/other-sellers/`
  - `listings.visibility.sold_out_q(prefix="") -> Q` (counted goods at 0 while `settings.SOLD_OUT_HIDDEN_ENABLED` is on; matches nothing while it is off)
  - public browse (`GET /api/listings/`, `GET /api/listings/<id>/related/`) excludes `sold_out_q()` (nothing changes while the switch is off)

- [ ] **Step 1: Write the failing test** — `backend/catalogue/tests/test_other_sellers.py`

```python
"""Catalogue plan 6, Task 4: other sellers of the same product for customers (spec §10), and sold-out offers leaving
search (spec §1 row 15). Read-only. Review Focus 4 (no leaks, nothing made up)."""
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from catalogue.models import CatalogueProduct
from catalogue.tests.helpers import BARCODE, business, product, service
from listings.models import Listing


def sellers_url(listing, query=""):
    return f"/api/catalogue/listings/{listing.pk}/other-sellers/{query}"


class OtherSellersTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.mine = product(business("Adepa Ventures"), price="26.00", stock=4, catalogue_product=self.entry)
        self.cheap = product(business("Kumasi Mart"), price="24.00", stock=2, catalogue_product=self.entry)
        self.plenty = product(business("Bantama Stores"), price="25.00", stock=40, catalogue_product=self.entry)

    def body(self, listing=None, query=""):
        response = self.client.get(sellers_url(listing or self.mine, query))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_other_offers_cheapest_first_with_the_featured_offer(self):
        body = self.body()
        self.assertEqual(
            body["catalogue_product"], {"id": self.entry.pk, "brand": "Nestle", "name": "Milo 400g", "barcode": BARCODE},
        )
        self.assertEqual([o["listing_id"] for o in body["offers"]], [self.cheap.pk, self.plenty.pk])   # not the one asked
        self.assertEqual(body["featured_offer_id"], self.cheap.pk)
        self.assertEqual(
            (body["offers"][0]["price_amount"], body["offers"][0]["business_name"], body["offers"][0]["available_quantity"]),
            ("24.00", "Kumasi Mart", 2),
        )

    def test_the_featured_offer_may_be_the_listing_itself(self):
        self.assertEqual(self.body(self.cheap)["featured_offer_id"], self.cheap.pk)

    def test_ordering_by_availability(self):
        body = self.body(query="?ordering=availability")
        self.assertEqual([o["listing_id"] for o in body["offers"]], [self.plenty.pk, self.cheap.pk])
        self.assertEqual(self.body(query="?ordering=nonsense")["ordering"], "price")

    def test_review_focus_hidden_unpublished_sold_out_and_unpriced_offers_never_show(self):
        product(business("Suspended Shop", suspended=True), price="1.00", catalogue_product=self.entry)
        product(business("Draft Shop"), price="1.00", status=Listing.DRAFT, catalogue_product=self.entry)
        product(business("Empty Shop"), price="1.00", stock=0, catalogue_product=self.entry)
        product(business("No Price Shop"), price=None, catalogue_product=self.entry)
        uncounted = product(business("Uncounted Shop"), price="30.00", stock=None, catalogue_product=self.entry)
        body = self.body()
        self.assertEqual([o["listing_id"] for o in body["offers"]], [self.cheap.pk, self.plenty.pk, uncounted.pk])
        self.assertIsNone(body["offers"][-1]["available_quantity"])            # not counted: said, never guessed
        self.assertEqual(body["featured_offer_id"], self.cheap.pk)

    def test_review_focus_no_contact_details_in_any_offer(self):
        body = self.body()
        self.assertEqual(set(body["offers"][0]), {
            "listing_id", "name", "price_amount", "price_unit", "condition", "business_name", "verified", "zone",
            "available_quantity",
        })
        self.assertNotIn("+233", self.client.get(sellers_url(self.mine)).content.decode())

    def test_review_focus_an_ungrouped_listing_answers_an_honest_empty_list(self):
        empty = {"catalogue_product": None, "featured_offer_id": None, "ordering": "price", "offers": []}
        self.assertEqual(self.body(product(business("Solo Shop"))), empty)
        self.assertEqual(self.body(service(business("Salon"))), empty)

    def test_a_listing_customers_cannot_see_is_404(self):
        draft = product(business("Draft"), status=Listing.DRAFT, catalogue_product=self.entry)
        hidden = product(business("Hidden", suspended=True), catalogue_product=self.entry)
        for listing in (draft, hidden):
            self.assertEqual(self.client.get(sellers_url(listing)).status_code, 404)


class FeaturedOfferTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.anchor = product(business("Adepa Ventures"), price="30.00", catalogue_product=self.entry)

    def featured(self, query=""):
        return self.client.get(sellers_url(self.anchor, query)).json()["featured_offer_id"]

    def test_an_unverified_business_is_never_featured_even_when_cheapest(self):
        product(business("New Shop", verified=False), price="10.00", catalogue_product=self.entry)
        verified = product(business("Old Shop"), price="20.00", catalogue_product=self.entry)
        self.assertEqual(self.featured(), verified.pk)

    def test_a_tie_goes_to_the_shop_nearest_the_customer(self):
        far = product(business("Far Shop", lat="6.700000", lng="-1.600000"), price="20.00", catalogue_product=self.entry)
        near = product(business("Near Shop", lat="6.690000", lng="-1.620000"), price="20.00", catalogue_product=self.entry)
        self.assertEqual(self.featured("?lat=6.6885&lng=-1.6244"), near.pk)
        self.assertEqual(self.featured(), far.pk)                            # no position: the oldest offer
        self.assertEqual(self.featured("?lat=abc&lng=-1.62"), far.pk)       # a position that is not one is ignored


@override_settings(SOLD_OUT_HIDDEN_ENABLED=True)
class SoldOutBrowseTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        owner = business()
        self.counted = product(owner, "Counted", stock=3)
        self.uncounted = product(owner, "Uncounted", stock=None)
        self.empty = product(owner, "Empty", stock=0)

    def test_search_and_related_lists_hide_sold_out_offers(self):
        ids = {row["id"] for row in self.client.get("/api/listings/").json()["results"]}
        self.assertEqual(ids, {self.counted.pk, self.uncounted.pk})
        related = {row["id"] for row in self.client.get(f"/api/listings/{self.counted.pk}/related/").json()}
        self.assertEqual(related, {self.uncounted.pk})

    def test_a_sold_out_offers_own_page_still_opens(self):
        response = self.client.get(f"/api/listings/{self.empty.pk}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["stock_quantity"], 0)

    @override_settings(SOLD_OUT_HIDDEN_ENABLED=False)
    def test_with_the_switch_off_search_is_as_before(self):
        ids = {row["id"] for row in self.client.get("/api/listings/").json()["results"]}
        self.assertEqual(ids, {self.counted.pk, self.uncounted.pk, self.empty.pk})

    def test_a_service_at_zero_is_never_hidden(self):
        salon = service(business("Salon"))
        Listing.objects.filter(pk=salon.pk).update(stock_quantity=0)
        self.assertIn(salon.pk, {row["id"] for row in self.client.get("/api/listings/").json()["results"]})
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue.tests.test_other_sellers --noinput`
Expected: FAIL — `404 != 200` for the other-sellers URL, and `{… self.empty.pk …} != {…}` (the sold-out listing still in search).

- [ ] **Step 3: The offers read model** — `backend/catalogue/offers.py`:

```python
"""Offers of one catalogue product (catalogue plan 6; spec §10). Each business's listing is its own offer (own price,
stock, cart line, fee and pickup); nothing here adds anything to a cart.

* A live offer is published, from a business public browse shows (listings.visibility), priced, and in stock: an
  uncounted stock (null) counts as in stock, zero hides the offer (spec §1 row 15).
* The featured offer is the lowest price among live offers from KYC-verified businesses. A tie goes to the shop nearest
  the customer when the app sends the customer's position (?lat=&lng=; a straight-line measure from the business pin,
  used only to order and never shown), then to the oldest offer.
* An offer row never carries a phone number, email, address, map pin or the listing's contact_phone: businesses are
  never contacted directly (CLAUDE.md). The business shows by its display name only. A stock the business does not
  count is null, never a guess."""
from django.db.models import Q

from accounts.models import BusinessOwner
from field.services import business_pin, haversine_m
from listings.models import Listing
from listings.visibility import hidden_business_q

from .models import product_row

PRICE, AVAILABILITY = "price", "availability"


def in_stock_q(prefix=""):
    """Listings with something left. `prefix` is the path to the Listing, ending "__", or ""."""
    return Q(**{f"{prefix}stock_quantity__isnull": True}) | Q(**{f"{prefix}stock_quantity__gt": 0})


def live_q(prefix=""):
    """Listings a customer may see and buy now (see the module text)."""
    return (
        Q(**{f"{prefix}status": Listing.PUBLISHED, f"{prefix}price_amount__isnull": False})
        & in_stock_q(prefix)
        & ~hidden_business_q(f"{prefix}business_owner__")
    )


def live_offers(product_id):
    return (
        Listing.objects.filter(live_q(), catalogue_product_id=product_id)
        .select_related("business_owner__profile", "zone")
        .order_by("pk")
    )


def position_from(params):
    """(lat, lng) from ?lat=&lng=, or None when either is missing, not a number, or out of range."""
    try:
        lat, lng = float(params.get("lat")), float(params.get("lng"))
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return lat, lng


def _tie(listing, position):
    pin = business_pin(listing.business_owner) if position is not None else None
    distance = None if pin is None else haversine_m(position[0], position[1], pin[0], pin[1])
    return (distance is None, distance or 0.0, listing.pk)


def featured(offers, position=None):
    """The featured offer among live `offers`, or None when no verified business offers it."""
    verified = [offer for offer in offers if offer.business_owner.kyc_status == BusinessOwner.VERIFIED]
    if not verified:
        return None
    return min(verified, key=lambda offer: (offer.price_amount, *_tie(offer, position)))


def ordered(offers, ordering=PRICE, position=None):
    """Cheapest first, or most available first (an uncounted stock after every counted one); ties as in `featured`."""
    if ordering == AVAILABILITY:
        return sorted(offers, key=lambda offer: (
            offer.stock_quantity is None, -(offer.stock_quantity or 0), offer.price_amount, *_tie(offer, position),
        ))
    return sorted(offers, key=lambda offer: (offer.price_amount, *_tie(offer, position)))


def offer_row(listing):
    return {
        "listing_id": listing.pk, "name": listing.name, "price_amount": str(listing.price_amount),
        "price_unit": listing.price_unit, "condition": listing.condition,
        "business_name": listing.business_owner.display_name,
        "verified": listing.business_owner.kyc_status == BusinessOwner.VERIFIED,
        "zone": listing.zone.name, "available_quantity": listing.stock_quantity,
    }


def other_sellers(listing, params):
    """GET listings/<id>/other-sellers/: the other live offers of `listing`'s product and the featured offer (which may
    be `listing` itself). An ungrouped listing answers an empty list."""
    ordering = AVAILABILITY if params.get("ordering") == AVAILABILITY else PRICE
    product = listing.catalogue_product
    if product is None:
        return {"catalogue_product": None, "featured_offer_id": None, "ordering": ordering, "offers": []}
    position = position_from(params)
    offers = list(live_offers(product.pk))
    best = featured(offers, position)
    return {
        "catalogue_product": product_row(product),
        "featured_offer_id": None if best is None else best.pk,
        "ordering": ordering,
        "offers": [offer_row(offer) for offer in ordered(offers, ordering, position) if offer.pk != listing.pk],
    }
```

- [ ] **Step 4: The public endpoint** — in `backend/catalogue/views.py`, (a) replace

```python
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsBusinessOwner
from listings.models import Listing

from . import attach
from .errors import CatalogueError
```

with

```python
from rest_framework import generics
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsBusinessOwner
from listings.models import Listing
from listings.visibility import hidden_business_q

from . import attach, offers
from .errors import CatalogueError
```

and (b) append to the end of the file:

```python


class OtherSellersView(APIView):
    """GET listings/<listing_id>/other-sellers/?ordering=price|availability&lat=&lng= — public: the other businesses'
    live offers of the same catalogue product, and the featured offer. An ungrouped listing answers an empty list; a
    listing customers cannot see is a 404."""

    permission_classes = [AllowAny]

    def get(self, request, listing_id):
        listing = generics.get_object_or_404(
            Listing.objects.filter(status=Listing.PUBLISHED).exclude(hidden_business_q()).select_related("catalogue_product"),
            pk=listing_id,
        )
        return Response(offers.other_sellers(listing, request.query_params))
```

- [ ] **Step 5: The URL** — in `backend/catalogue/urls.py` replace

```python
    path("staff/listings/<int:listing_id>/detach/", views_staff.ListingDetachView.as_view(), name="catalogue-staff-detach"),
]
```

with

```python
    path("staff/listings/<int:listing_id>/detach/", views_staff.ListingDetachView.as_view(), name="catalogue-staff-detach"),
    path("listings/<int:listing_id>/other-sellers/", views.OtherSellersView.as_view(), name="catalogue-other-sellers"),
]
```

- [ ] **Step 6: Sold-out offers leave search and the related list (behind a switch)** — (a) append to `backend/listings/visibility.py` (it already imports `settings` and `Q`), and extend the "Used by" docstring lines to name `catalogue.offers` (other sellers), `catalogue.views.OtherSellersView` and `catalogue.alerts` as users of `hidden_business_q`:

```python


def sold_out_q(prefix=""):
    """A Q matching counted goods with nothing left (catalogue plan 6; spec §1 row 15, §10 "zero stock hides the
    offer"). Public search and the related list leave them out while settings.SOLD_OUT_HIDDEN_ENABLED is on (env,
    default off until the Plan 6F screens tell a business to leave the count empty when it does not count stock).
    Matches nothing while it is off, and never a service, stay or event: only products and food are offers with a stock
    count. (Read with getattr: the setting itself is added with the alert switch in Task 7.)"""
    if not getattr(settings, "SOLD_OUT_HIDDEN_ENABLED", False):
        return Q(pk__in=[])
    from cart.guard import deliverable_q  # cart.guard imports this module

    return Q(**{f"{prefix}stock_quantity": 0}) & deliverable_q(prefix)
```

(b) in `backend/listings/views.py` replace `from .visibility import hidden_business_q` with `from .visibility import hidden_business_q, sold_out_q`; (c) in `PublicListingListView.get_queryset` replace

```python
        # Suspended and paused businesses' listings drop out of public browse
        # (listings.visibility) — enforced here rather than at suspend/pause
        # time, so unsuspending or paying reverses it at once.
        queryset = (
            Listing.objects.filter(status=Listing.PUBLISHED)
            .exclude(hidden_business_q())
            .select_related("category", "zone", "business_owner__profile")
```

with

```python
        # Suspended and paused businesses' listings drop out of public browse
        # (listings.visibility) — enforced here rather than at suspend/pause
        # time, so unsuspending or paying reverses it at once. While
        # SOLD_OUT_HIDDEN_ENABLED is on, counted goods with nothing left drop
        # out too (spec §1 row 15, catalogue plan 6); an uncounted one
        # (stock_quantity null) and any service or stay stay, and the
        # listing's own page still opens.
        queryset = (
            Listing.objects.filter(status=Listing.PUBLISHED)
            .exclude(hidden_business_q())
            .exclude(sold_out_q())
            .select_related("category", "zone", "business_owner__profile")
```

and (d) in `RelatedListingsView.get_queryset` replace

```python
            Listing.objects.filter(status=Listing.PUBLISHED)
            .exclude(hidden_business_q())
            .filter(Q(category=anchor.category) | Q(zone=anchor.zone))
```

with

```python
            Listing.objects.filter(status=Listing.PUBLISHED)
            .exclude(hidden_business_q())
            .exclude(sold_out_q())  # sold out: hidden like search while the switch is on (catalogue plan 6)
            .filter(Q(category=anchor.category) | Q(zone=anchor.zone))
```

(Django writes `exclude()` on a nullable column as `NOT (stock_quantity = 0 AND stock_quantity IS NOT NULL)`, so uncounted listings stay; the test pins it. With the switch off, `sold_out_q()` is an empty `pk__in`, which `exclude` turns into no filter at all. `PublicListingDetailView` is left as it is.)

- [ ] **Step 7: Run the tests**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue.tests.test_other_sellers listings cart marketplace --noinput`
Expected: PASS (13 new tests; the `listings`, `cart` and `marketplace` suites unchanged).

- [ ] **Step 8: Commit**

```bash
git add backend/catalogue backend/listings/views.py backend/listings/visibility.py
git commit -F - <<'EOF'
feat(catalogue): other sellers of a product with the featured offer, no contact details; sold-out offers leave search (plan 6)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 5: A business looks up the same product from other businesses (read-only)

**Files:**
- Create: `backend/catalogue/tests/test_sourcing.py`
- Modify: `backend/catalogue/offers.py` (imports; append `search`, `sourcing`), `backend/catalogue/views.py` (imports; append two views), `backend/catalogue/urls.py`

**Interfaces:**
- Consumes: `offers.live_q`, `live_offers`, `ordered`, `offer_row` (Task 4); `identity.clean_barcode`, `BarcodeError`, `normalise_name` (Task 1); `CatalogueError` (Task 2); `CatalogueProduct.offers` (Task 1).
- Produces: `catalogue.offers.search(params) -> list[dict]` (`{id, brand, name, barcode, offer_count, lowest_price}`; raises `CatalogueError` `query_required` / `invalid_barcode`), `sourcing(product, owner) -> dict` (`{catalogue_product, your_listings, offers}`), `QUERY_REQUIRED`, `SEARCH_LIMIT = 20`; `views.ProductSearchView` (`products/`), `views.ProductOffersView` (`products/<int:pk>/offers/`).

- [ ] **Step 1: Write the failing test** — `backend/catalogue/tests/test_sourcing.py`

```python
"""Catalogue plan 6, Task 5: a business looks up a product other businesses sell. Read-only: no contact details and no
ordering between businesses."""
from django.test import TestCase
from rest_framework.test import APIClient

from catalogue.models import CatalogueProduct
from catalogue.tests.helpers import BARCODE, as_account, business, buyer, product


class SearchTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        as_account(self.client, business("Adepa Ventures"), "business_owner")
        self.milo = CatalogueProduct.objects.create(brand="Nestlé", name="Milo 400g", barcode=BARCODE)
        self.bournvita = CatalogueProduct.objects.create(brand="Cadbury", name="Bournvita 500g")
        product(business("Kumasi Mart"), price="24.00", catalogue_product=self.milo)
        product(business("Bantama Stores"), price="25.00", catalogue_product=self.milo)
        product(business("Empty Shop"), price="1.00", stock=0, catalogue_product=self.milo)
        product(business("Suspended Shop", suspended=True), price="2.00", catalogue_product=self.milo)

    def search(self, query):
        return self.client.get(f"/api/catalogue/products/{query}")

    def test_by_barcode_in_any_spelling(self):
        response = self.search("?barcode=4006-3813-3393-1")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["results"], [{
            "id": self.milo.pk, "brand": "Nestlé", "name": "Milo 400g", "barcode": BARCODE,
            "offer_count": 2, "lowest_price": "24.00",
        }])

    def test_by_every_word_in_any_case_or_accent(self):
        self.assertEqual([row["id"] for row in self.search("?q=NESTLE milo").json()["results"]], [self.milo.pk])
        self.assertEqual(self.search("?q=milo bournvita").json()["results"], [])

    def test_review_focus_a_product_nobody_sells_now_has_no_price(self):
        row = self.search("?q=bournvita").json()["results"][0]
        self.assertEqual((row["id"], row["offer_count"], row["lowest_price"]), (self.bournvita.pk, 0, None))

    def test_a_query_or_a_valid_barcode_is_needed(self):
        for query, code in (("", "query_required"), ("?q=m", "query_required"), ("?barcode=123", "invalid_barcode")):
            response = self.search(query)
            self.assertEqual((response.status_code, response.json()["code"]), (400, code), query)

    def test_only_business_owners(self):
        as_account(self.client, buyer(), "customer")
        self.assertEqual(self.search("?q=milo").status_code, 403)


class SourcingOffersTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = business("Adepa Ventures")
        as_account(self.client, self.owner, "business_owner")
        self.milo = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.mine = product(self.owner, price="26.00", catalogue_product=self.milo)
        self.dearer = product(business("Bantama Stores"), price="27.00", catalogue_product=self.milo)
        self.rival = product(business("Kumasi Mart"), price="24.00", catalogue_product=self.milo)

    def test_other_businesses_offers_cheapest_first_never_mine_no_contact(self):
        response = self.client.get(f"/api/catalogue/products/{self.milo.pk}/offers/")
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual([offer["listing_id"] for offer in body["offers"]], [self.rival.pk, self.dearer.pk])
        self.assertEqual(body["your_listings"], [self.mine.pk])
        self.assertEqual(body["catalogue_product"]["id"], self.milo.pk)
        self.assertNotIn("+233", response.content.decode())

    def test_read_only_and_an_unknown_product_is_404(self):
        self.assertEqual(self.client.post(f"/api/catalogue/products/{self.milo.pk}/offers/").status_code, 405)
        self.assertEqual(self.client.get("/api/catalogue/products/999999/offers/").status_code, 404)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue.tests.test_sourcing --noinput`
Expected: FAIL — `404 != 200` (no `products/` URLs yet).

- [ ] **Step 3: The lookup** — in `backend/catalogue/offers.py`, (a) replace

```python
from django.db.models import Q

from accounts.models import BusinessOwner
from field.services import business_pin, haversine_m
from listings.models import Listing
from listings.visibility import hidden_business_q

from .models import product_row
```

with

```python
from django.db.models import Count, Min, Q

from accounts.models import BusinessOwner
from field.services import business_pin, haversine_m
from listings.models import Listing
from listings.visibility import hidden_business_q

from . import identity
from .errors import CatalogueError
from .models import CatalogueProduct, product_row
```

and (b) append to the end of the file:

```python


# --- A business's lookup (read-only) ---------------------------------------------------------------------------------

QUERY_REQUIRED = "Type at least two letters of the product's name, or its barcode."
SEARCH_LIMIT = 20


def search(params):
    """GET products/: catalogue entries by barcode (any spelling) or by every word of ?q= (normalised), with how many
    live offers each has now and the lowest live price (null when nobody offers it now). Raises CatalogueError."""
    raw_barcode = str(params.get("barcode") or "").strip()
    if raw_barcode:
        try:
            key = identity.clean_barcode(raw_barcode)
        except identity.BarcodeError as exc:
            raise CatalogueError(str(exc), "invalid_barcode") from None
        queryset = CatalogueProduct.objects.filter(barcode=key)
    else:
        words = identity.normalise_name(params.get("q") or "").split()
        if len("".join(words)) < 2:
            raise CatalogueError(QUERY_REQUIRED, "query_required")
        queryset = CatalogueProduct.objects.all()
        for word in words:
            queryset = queryset.filter(normalised_name__contains=word)
    rows = queryset.annotate(
        offer_count=Count("offers", filter=live_q("offers__")),
        lowest_price=Min("offers__price_amount", filter=live_q("offers__")),
    ).order_by("normalised_name", "pk")[:SEARCH_LIMIT]
    return [
        {**product_row(row), "offer_count": row.offer_count,
         "lowest_price": None if row.lowest_price is None else str(row.lowest_price)}
        for row in rows
    ]


def sourcing(product, owner):
    """GET products/<id>/offers/: other businesses' live offers of `product`, cheapest first, and the owner's own
    listings grouped with it. Read-only: the rows carry no contact details and nothing here orders anything."""
    mine = list(
        Listing.objects.filter(catalogue_product=product, business_owner=owner).order_by("pk").values_list("pk", flat=True)
    )
    others = [offer for offer in live_offers(product.pk) if offer.business_owner_id != owner.pk]
    return {
        "catalogue_product": product_row(product), "your_listings": mine,
        "offers": [offer_row(offer) for offer in ordered(others)],
    }
```

- [ ] **Step 4: The endpoints** — in `backend/catalogue/views.py`, (a) replace

```python
from . import attach, offers
from .errors import CatalogueError
```

with

```python
from . import attach, offers
from .errors import CatalogueError
from .models import CatalogueProduct
```

and (b) append to the end of the file:

```python


class ProductSearchView(APIView):
    """GET products/?q=words or ?barcode=digits — catalogue products, how many live offers each has, and the lowest live
    price (null when nobody offers it now). Business owners only."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get(self, request):
        try:
            results = offers.search(request.query_params)
        except CatalogueError as exc:
            return Response(exc.body(), status=exc.status_code)
        return Response({"results": results})


class ProductOffersView(APIView):
    """GET products/<id>/offers/ — other businesses' live offers of one product, cheapest first. Read-only; business
    owners only."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get(self, request, pk):
        product = generics.get_object_or_404(CatalogueProduct, pk=pk)
        return Response(offers.sourcing(product, request.user))
```

- [ ] **Step 5: The URLs** — in `backend/catalogue/urls.py` replace

```python
    path("listings/<int:listing_id>/other-sellers/", views.OtherSellersView.as_view(), name="catalogue-other-sellers"),
]
```

with

```python
    path("listings/<int:listing_id>/other-sellers/", views.OtherSellersView.as_view(), name="catalogue-other-sellers"),
    path("products/", views.ProductSearchView.as_view(), name="catalogue-products"),
    path("products/<int:pk>/offers/", views.ProductOffersView.as_view(), name="catalogue-product-offers"),
]
```

- [ ] **Step 6: Run the tests**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue --noinput`
Expected: PASS (7 new tests in `test_sourcing`).

- [ ] **Step 7: Commit**

```bash
git add backend/catalogue
git commit -F - <<'EOF'
feat(catalogue): a business looks up a product by barcode or words and sees other businesses' live offers, read-only (plan 6)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 6: Days of cover, the governed stock numbers, "needs restocking" and the business's own line

**Files:**
- Create: `backend/catalogue/stock.py`, `backend/catalogue/migrations/0003_stock_alert_state.py` (generated), `backend/catalogue/tests/test_stock_cover.py`
- Modify: `backend/catalogue/models.py` (append `StockAlertState`), `backend/ledger/settings_store.py` (`DEFINITIONS`), `backend/ledger/approval_kinds.py` (`STOCK_SETTING_KEYS`, `setting_consequences`), `backend/catalogue/views.py` (imports; append two views), `backend/catalogue/urls.py`

**Interfaces:**
- Consumes: `ledger.settings_store.current(key, at)`, `Definition`, `SettingError`, `clean`; `ledger.approval_kinds.WALLET_SETTING_KEYS`; `cart.guard.deliverable_q()`; `orders.models.Order.PAID`, `OrderItem`; `attach.groupable` (Task 2); `views._own_listing`, `_body` (Task 2).
- Produces:
  - `catalogue.models.StockAlertState` (`listing` one-to-one, `threshold_units`, `low_alerted_at`, `low_alerted_stock`, `sold_out_alerted_at`, `updated_at`; `Listing.stock_alert`)
  - money settings `low_stock_cover_days` (7, 1–90), `low_stock_fallback_units` (5, 0–100,000), `stock_cover_window_days` (28, 7–180); `ledger.approval_kinds.STOCK_SETTING_KEYS`
  - `catalogue.stock`: `COVER_DAYS`, `FALLBACK_UNITS`, `WINDOW_DAYS` (the setting keys), `SALES = "sales"`, `FALLBACK = "fallback"`, `OWN = "own_threshold"`, `MAX_LINE`, `LINE_MESSAGE`, `NOT_A_PRODUCT`, `NOT_COUNTED`; `Limits(cover_days, fallback_units, window_days)`; `Cover(stock, units_sold, days_on_sale, days_of_cover, basis, line, low, sold_out)`; `limits_at(now=None) -> Limits`; `tracked(queryset) -> QuerySet`; `days_on_sale(listing, window_days, now, first_sale=None) -> int`; `units_sold(listing_ids, window_days, now) -> {listing id: (units, first sale time)}`; `measure(listing, sold, limits, *, own_line=None, now=None, first_sale=None) -> Cover`; `own_lines(listing_ids) -> dict`; `measure_many(listings, now=None, limits=None, lines=None) -> dict[int, Cover]`; `cover_of(listing, now=None) -> Cover`; `row(listing, cover) -> dict`; `needs_restocking(owner, now=None) -> dict`; `parse_line(raw) -> int | None` (raises `ValueError`); `set_own_line(listing, units)`
  - `views.StockView` (`stock/`), `views.StockLineView` (`stock/<int:listing_id>/line/`)

- [ ] **Step 1: Write the failing test** — `backend/catalogue/tests/test_stock_cover.py`

```python
"""Catalogue plan 6, Task 6: days of stock left, the low-stock line, the governed numbers, the business's "needs
restocking" list and its own line per offer (spec §1 row 15, §3.3, §10). Review Focus 2 (thin or odd history) and 5
(another business's listing)."""
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from catalogue import stock
from catalogue.models import StockAlertState
from catalogue.tests.helpers import as_account, as_staff, business, buyer, go_live, product, sell, service
from ledger import approval_kinds, settings_store
from ledger.models import MoneySetting
from listings.models import Listing
from orders.models import Order


class StockSettingsTests(TestCase):
    def test_defaults_and_bounds(self):
        self.assertEqual(
            [settings_store.current(key) for key in (stock.COVER_DAYS, stock.FALLBACK_UNITS, stock.WINDOW_DAYS)],
            [7, 5, 28],
        )
        for key, raw in (
            (stock.COVER_DAYS, 0), (stock.COVER_DAYS, 91), (stock.WINDOW_DAYS, 6), (stock.FALLBACK_UNITS, -1),
            (stock.FALLBACK_UNITS, None),
        ):
            with self.subTest(key=key, raw=raw), self.assertRaises(settings_store.SettingError):
                settings_store.clean(key, raw)

    def test_they_change_only_through_the_money_setting_approval(self):
        client = APIClient()
        as_staff(client, "accountant", "kofi@example.com")
        response = client.post("/api/ledger/settings/", {"key": stock.COVER_DAYS, "value": 10}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(settings_store.current(stock.COVER_DAYS), 7)                    # waits for a Super Admin

    def test_the_approval_says_what_a_stock_setting_applies_to(self):
        said = approval_kinds.setting_consequences(SimpleNamespace(payload={"key": stock.FALLBACK_UNITS}))
        self.assertIn("low-stock", said[0])
        self.assertNotIn("orders", said[0])
        self.assertEqual(
            approval_kinds.setting_consequences(SimpleNamespace(payload={"key": "rider_commission_bp"})),
            ["Applies only to orders paid after it starts."],
        )


class CoverTests(TestCase):
    def setUp(self):
        self.owner = business()

    def established(self, stock_left, sold):
        listing = go_live(product(self.owner, stock=stock_left), 60)
        if sold:
            sell(listing, sold, days_ago=10)
        return listing

    def test_with_sales_fewer_than_seven_days_left_is_low(self):
        seven = stock.cover_of(self.established(7, 28))                                 # 28 sold in 28 days: 1 a day
        self.assertEqual(
            (seven.basis, seven.days_on_sale, seven.units_sold, seven.days_of_cover, seven.line, seven.low),
            (stock.SALES, 28, 28, Decimal("7.0"), None, False),
        )
        six = stock.cover_of(self.established(6, 28))
        self.assertEqual((six.days_of_cover, six.low), (Decimal("6.0"), True))

    def test_review_focus_a_new_offer_is_not_diluted_by_days_it_did_not_exist(self):
        listing = go_live(product(self.owner, stock=13), 2)
        sell(listing, 4, days_ago=1)                                                      # 2 a day over its 2 days
        cover = stock.cover_of(listing)
        self.assertEqual((cover.days_on_sale, cover.days_of_cover, cover.low), (2, Decimal("6.5"), True))

    def test_a_re_approval_does_not_shrink_the_days_already_sold(self):
        listing = go_live(product(self.owner, stock=20), 60)
        sell(listing, 28, days_ago=20)
        Listing.objects.filter(pk=listing.pk).update(reviewed_at=timezone.now())      # approved again today
        listing.refresh_from_db()
        cover = stock.cover_of(listing)
        self.assertEqual((cover.days_on_sale, cover.low), (20, False))

    def test_review_focus_no_sales_uses_the_fallback_line(self):
        five = stock.cover_of(product(self.owner, stock=5))
        self.assertEqual((five.basis, five.line, five.days_of_cover, five.low), (stock.FALLBACK, 5, None, True))
        self.assertFalse(stock.cover_of(product(self.owner, stock=6)).low)

    def test_old_cancelled_and_unpaid_orders_are_not_sales(self):
        listing = self.established(6, 0)
        sell(listing, 100, days_ago=40)
        sell(listing, 50, days_ago=3, status=Order.CANCELLED)
        sell(listing, 50, days_ago=3, status=Order.PENDING)
        cover = stock.cover_of(listing)
        self.assertEqual((cover.units_sold, cover.basis, cover.low), (0, stock.FALLBACK, False))

    def test_the_business_own_line_replaces_the_default(self):
        above = product(self.owner, stock=20)
        stock.set_own_line(above, 25)
        below = product(self.owner, stock=4)
        stock.set_own_line(below, 3)
        cover = stock.cover_of(above)
        self.assertEqual((cover.basis, cover.line, cover.low), (stock.OWN, 25, True))
        self.assertFalse(stock.cover_of(below).low)                                     # 4 > 3, though 4 <= 5

    def test_sold_out_is_low_and_sold_out(self):
        cover = stock.cover_of(product(self.owner, stock=0))
        self.assertEqual((cover.low, cover.sold_out), (True, True))

    def test_a_governed_change_moves_the_line(self):
        MoneySetting.objects.create(key=stock.FALLBACK_UNITS, value=10, effective_from=timezone.now() - timedelta(days=1))
        cover = stock.cover_of(product(self.owner, stock=8))
        self.assertEqual((cover.line, cover.low), (10, True))


class NeedsRestockingTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = business()
        as_account(self.client, self.owner, "business_owner")
        self.low = product(self.owner, "Low", stock=3)
        self.empty = product(self.owner, "Empty", stock=0)
        product(self.owner, "Fine", stock=50)
        product(self.owner, "Uncounted", stock=None)
        service(self.owner)
        product(business("Rival Mart"), "Rival low", stock=1)

    def test_my_low_offers_sold_out_first_with_the_numbers_behind_them(self):
        body = self.client.get("/api/catalogue/stock/").json()
        self.assertEqual([row["listing_id"] for row in body["results"]], [self.empty.pk, self.low.pk])
        self.assertEqual(body["results"][1], {
            "listing_id": self.low.pk, "name": "Low", "stock": 3, "units_sold": 0, "days_on_sale": 1,
            "days_of_cover": None, "basis": "fallback", "line": 5, "low": True, "sold_out": False,
        })
        self.assertEqual((body["tracked_offers"], body["untracked_offers"]), (3, 1))
        self.assertEqual(body["settings"], {"cover_days": 7, "fallback_units": 5, "window_days": 28})

    def test_nothing_low_is_an_empty_list_said_plainly(self):
        calm = business("Calm Shop")
        product(calm, stock=50)
        as_account(self.client, calm, "business_owner")
        body = self.client.get("/api/catalogue/stock/").json()
        self.assertEqual((body["results"], body["tracked_offers"], body["untracked_offers"]), ([], 1, 0))

    def test_only_business_owners(self):
        as_account(self.client, buyer(), "customer")
        self.assertEqual(self.client.get("/api/catalogue/stock/").status_code, 403)


class OwnLineTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = business()
        self.listing = product(self.owner, stock=20)
        as_account(self.client, self.owner, "business_owner")

    def put(self, listing, units):
        return self.client.put(f"/api/catalogue/stock/{listing.pk}/line/", {"units": units}, format="json")

    def test_a_business_sets_and_clears_its_own_line(self):
        response = self.put(self.listing, 25)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual((body["line"], body["cover"]["basis"], body["cover"]["low"]), (25, "own_threshold", True))
        body = self.put(self.listing, None).json()
        self.assertEqual((body["line"], body["cover"]["basis"], body["cover"]["low"]), (None, "fallback", False))

    def test_bad_values_are_refused(self):
        for units in (-1, "five", True, 100001, 2.5):
            response = self.put(self.listing, units)
            self.assertEqual((response.status_code, response.json()), (400, {"units": stock.LINE_MESSAGE}), units)

    def test_review_focus_another_business_listing_is_404_and_nothing_changes(self):
        rival = product(business("Rival Mart"), stock=20)
        self.assertEqual(self.put(rival, 25).status_code, 404)
        self.assertFalse(StockAlertState.objects.filter(listing=rival).exists())

    def test_an_uncounted_listing_or_a_service_has_no_line(self):
        response = self.put(product(self.owner, "Uncounted", stock=None), 5)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "not_counted"))
        response = self.put(service(self.owner), 5)
        self.assertEqual((response.status_code, response.json()["code"]), (400, "not_a_product"))

    def test_saving_the_same_line_again_does_not_re_arm(self):
        self.put(self.listing, 10)
        StockAlertState.objects.filter(listing=self.listing).update(low_alerted_at=timezone.now(), low_alerted_stock=9)
        self.put(self.listing, 10)
        self.assertIsNotNone(StockAlertState.objects.get(listing=self.listing).low_alerted_at)

    def test_changing_the_line_re_arms_the_low_alert(self):
        StockAlertState.objects.create(listing=self.listing, low_alerted_at=timezone.now(), low_alerted_stock=20)
        self.put(self.listing, 10)
        state = StockAlertState.objects.get(listing=self.listing)
        self.assertEqual((state.threshold_units, state.low_alerted_at, state.low_alerted_stock), (10, None, None))
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue.tests.test_stock_cover --noinput`
Expected: ERROR — `ImportError: cannot import name 'stock' from 'catalogue'`.

- [ ] **Step 3: The alert-state model** — append to `backend/catalogue/models.py`:

```python


class StockAlertState(models.Model):
    """Where one offer's low-stock and sold-out alerts stand (catalogue.alerts) and the business's own low-stock line for
    it (catalogue.stock). One row per offer, made the first time it is measured or given a line. Moved only by
    conditional UPDATEs, so two runs at once never tell a business twice."""

    listing = models.OneToOneField("listings.Listing", on_delete=models.CASCADE, related_name="stock_alert")
    # The business's own line in units for this offer; null = AshantiHub's default (days of cover, else units).
    threshold_units = models.PositiveIntegerField(null=True, blank=True)
    low_alerted_at = models.DateTimeField(null=True, blank=True)
    # The stock when the low alert was told: the alert re-arms only once stock is back above it (a restock).
    low_alerted_stock = models.PositiveIntegerField(null=True, blank=True)
    sold_out_alerted_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Stock alerts for listing {self.listing_id}"
```

- [ ] **Step 4: The governed numbers** — in `backend/ledger/settings_store.py` replace

```python
    "payout_cooling_hours": Definition("Hours a new payout destination waits before it can receive money", 24, False, 1, 720),
}
```

with

```python
    "payout_cooling_hours": Definition("Hours a new payout destination waits before it can receive money", 24, False, 1, 720),
    # Low-stock alerts (catalogue plan 6; spec §1 row 15, §10). Not money, but governed the same way (§3.3): Accounting
    # proposes, a Super Admin approves.
    "low_stock_cover_days": Definition("Low stock: alert when an offer has fewer than this many days of sales left", 7, False, 1, 90),
    "low_stock_fallback_units": Definition("Low stock with no sales in the window: alert at this many units or fewer", 5, False, 0, 100_000),
    "stock_cover_window_days": Definition("Days of past sales used to work out days of stock left", 28, False, 7, 180),
}
```

and in `backend/ledger/approval_kinds.py` replace

```python
WALLET_SETTING_KEYS = ("withdrawal_per_tx_limit_pesewas", "withdrawal_daily_limit_pesewas", "payout_cooling_hours")


def setting_consequences(request):
    """What the approver is told the change touches: withdrawal settings never touch an order (wallets plan 3b)."""
    if request.payload.get("key") in WALLET_SETTING_KEYS:
        return ["Applies to withdrawals asked for, and payout destinations added, after it starts. Destinations already "
                "added keep the waiting time they were given."]
    return ["Applies only to orders paid after it starts."]
```

with

```python
WALLET_SETTING_KEYS = ("withdrawal_per_tx_limit_pesewas", "withdrawal_daily_limit_pesewas", "payout_cooling_hours")
# Low-stock alerts (catalogue plan 6): they never touch an order or any money.
STOCK_SETTING_KEYS = ("low_stock_cover_days", "low_stock_fallback_units", "stock_cover_window_days")


def setting_consequences(request):
    """What the approver is told the change touches: withdrawal settings never touch an order (wallets plan 3b), and
    stock settings neither (catalogue plan 6)."""
    key = request.payload.get("key")
    if key in WALLET_SETTING_KEYS:
        return ["Applies to withdrawals asked for, and payout destinations added, after it starts. Destinations already "
                "added keep the waiting time they were given."]
    if key in STOCK_SETTING_KEYS:
        return ["Applies to the hourly low-stock check from when it starts. Offers already told they are low are not "
                "told again until they are restocked."]
    return ["Applies only to orders paid after it starts."]
```

- [ ] **Step 5: Days of cover** — `backend/catalogue/stock.py`:

```python
"""Days of stock left and the low-stock line (catalogue plan 6; spec §1 row 15, §10).

* Sales are the units on paid order lines (Order.PAID; a cancelled or unpaid order is not a sale) placed inside the
  window (the governed `stock_cover_window_days`, default 28), spread over the whole days the offer has been on sale
  inside that window (since its approval, Listing.reviewed_at, else its creation, or since its first counted sale if
  that is earlier: a re-approval moves reviewed_at forward but earlier sales still count; at least 1). A new offer is
  not diluted by days it did not exist.
* An offer is low when the business set its own line for it (StockAlertState.threshold_units) and stock is at or below
  it; otherwise, with sales in the window, when it has fewer than `low_stock_cover_days` (default 7) days of sales left;
  otherwise (no sales in the window) when stock is at or below `low_stock_fallback_units` (default 5). Sold out is 0,
  which is always low.
* Only counted offers (stock_quantity set) of products and food (cart.guard DELIVERABLE) are measured: an uncounted
  stock has no cover and is never guessed.
* Integer arithmetic decides (stock x days on sale < cover days x units sold); `days_of_cover` (one decimal, half up)
  is only for display."""
import re
from dataclasses import dataclass
from datetime import timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from django.db.models import Min, Sum
from django.utils import timezone

from cart import guard
from ledger import settings_store
from listings.models import Listing
from orders.models import Order, OrderItem

from .models import StockAlertState

COVER_DAYS, FALLBACK_UNITS, WINDOW_DAYS = "low_stock_cover_days", "low_stock_fallback_units", "stock_cover_window_days"
SALES, FALLBACK, OWN = "sales", "fallback", "own_threshold"
MAX_LINE = 100_000
LINE_MESSAGE = f"Enter a whole number of units from 0 to {MAX_LINE:,}, or leave it empty to use AshantiHub's default."
NOT_A_PRODUCT = "Only products and food have a stock line."
NOT_COUNTED = "Count this listing's stock first: a low-stock line needs a stock count."
DAY_SECONDS = 86400


@dataclass(frozen=True)
class Limits:
    cover_days: int
    fallback_units: int
    window_days: int


@dataclass(frozen=True)
class Cover:
    stock: int
    units_sold: int
    days_on_sale: int
    days_of_cover: Optional[Decimal]
    basis: str
    line: Optional[int]
    low: bool
    sold_out: bool


def limits_at(now=None):
    """The governed numbers in force at `now`."""
    now = now or timezone.now()
    return Limits(
        settings_store.current(COVER_DAYS, now), settings_store.current(FALLBACK_UNITS, now),
        settings_store.current(WINDOW_DAYS, now),
    )


def tracked(queryset):
    """The published, counted product and food offers in `queryset`."""
    return queryset.filter(status=Listing.PUBLISHED, stock_quantity__isnull=False).filter(guard.deliverable_q())


def days_on_sale(listing, window_days, now, first_sale=None):
    """Whole days on sale inside the window: since approval (else creation), or since its first counted sale if that is
    earlier (a re-approval moves reviewed_at forward, but earlier sales still count); at least 1."""
    since = listing.reviewed_at or listing.created_at
    if first_sale is not None and (since is None or first_sale < since):
        since = first_sale
    days = int((now - since).total_seconds() // DAY_SECONDS) if since else window_days
    return max(1, min(window_days, days))


def units_sold(listing_ids, window_days, now):
    """{listing id: (units, first sale time)} on paid order lines placed inside the window; a listing with none is absent."""
    rows = (
        OrderItem.objects.filter(
            listing_id__in=listing_ids, order__status=Order.PAID,
            order__placed_at__gte=now - timedelta(days=window_days),
        )
        .values("listing_id")
        .annotate(units=Sum("quantity"), first=Min("order__placed_at"))
    )
    return {row["listing_id"]: (row["units"], row["first"]) for row in rows}


def measure(listing, sold, limits, *, own_line=None, now=None, first_sale=None):
    """The Cover of one counted listing that sold `sold` units inside the window (`first_sale`: when the first of them
    was placed, so days on sale never start after a sale it counts)."""
    now = now or timezone.now()
    stock = listing.stock_quantity
    on_sale = days_on_sale(listing, limits.window_days, now, first_sale)
    cover = None
    if sold:
        cover = (Decimal(stock * on_sale) / Decimal(sold)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    if own_line is not None:
        basis, line, low = OWN, own_line, stock <= own_line
    elif sold:
        basis, line, low = SALES, None, stock * on_sale < limits.cover_days * sold
    else:
        basis, line, low = FALLBACK, limits.fallback_units, stock <= limits.fallback_units
    return Cover(stock, sold, on_sale, cover, basis, line, low or stock == 0, stock == 0)


def own_lines(listing_ids):
    return dict(
        StockAlertState.objects.filter(listing_id__in=listing_ids, threshold_units__isnull=False)
        .values_list("listing_id", "threshold_units")
    )


def measure_many(listings, now=None, limits=None, lines=None):
    """{listing id: Cover} for counted listings: one sales query for the lot, and one for the own lines unless given."""
    now = now or timezone.now()
    limits = limits or limits_at(now)
    listings = list(listings)
    ids = [listing.pk for listing in listings]
    sold = units_sold(ids, limits.window_days, now)
    lines = own_lines(ids) if lines is None else lines
    covers = {}
    for listing in listings:
        units, first = sold.get(listing.pk, (0, None))
        covers[listing.pk] = measure(
            listing, units, limits, own_line=lines.get(listing.pk), now=now, first_sale=first,
        )
    return covers


def cover_of(listing, now=None):
    return measure_many([listing], now)[listing.pk]


def row(listing, cover):
    return {
        "listing_id": listing.pk, "name": listing.name, "stock": cover.stock, "units_sold": cover.units_sold,
        "days_on_sale": cover.days_on_sale,
        "days_of_cover": None if cover.days_of_cover is None else str(cover.days_of_cover),
        "basis": cover.basis, "line": cover.line, "low": cover.low, "sold_out": cover.sold_out,
    }


def needs_restocking(owner, now=None):
    """GET stock/: the owner's low offers (sold out first, then fewest days left, then least stock), the numbers behind
    each, how many of its offers are counted and not counted, and the defaults in force."""
    now = now or timezone.now()
    current = limits_at(now)
    mine = Listing.objects.filter(business_owner=owner)
    listings = list(tracked(mine).order_by("pk"))
    covers = measure_many(listings, now, current)
    low = sorted(
        ((listing, covers[listing.pk]) for listing in listings if covers[listing.pk].low),
        key=lambda pair: (
            not pair[1].sold_out, pair[1].days_of_cover is None, pair[1].days_of_cover or 0, pair[1].stock, pair[0].pk,
        ),
    )
    untracked = mine.filter(status=Listing.PUBLISHED, stock_quantity__isnull=True).filter(guard.deliverable_q()).count()
    return {
        "results": [row(listing, cover) for listing, cover in low],
        "tracked_offers": len(listings), "untracked_offers": untracked,
        "settings": {
            "cover_days": current.cover_days, "fallback_units": current.fallback_units, "window_days": current.window_days,
        },
    }


def parse_line(raw):
    """A business's own low-stock line: None (use the default) or a whole number 0..MAX_LINE. Raises ValueError."""
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool) or not isinstance(raw, (int, str)):
        raise ValueError(raw)
    text = str(raw).strip()
    if not re.fullmatch(r"[0-9]+", text) or int(text) > MAX_LINE:
        raise ValueError(raw)
    return int(text)


def set_own_line(listing, units):
    """Set (or clear, with None) the business's own low-stock line for one offer. A changed line re-arms the low alert,
    so the offer is measured against it from the next run; saving the same line again changes nothing; the sold-out
    alert is left as it is."""
    state, _ = StockAlertState.objects.get_or_create(listing=listing)
    if state.threshold_units == units:
        return
    StockAlertState.objects.filter(pk=state.pk).update(
        threshold_units=units, low_alerted_at=None, low_alerted_stock=None, updated_at=timezone.now(),
    )
```

- [ ] **Step 6: The endpoints** — in `backend/catalogue/views.py`, (a) replace

```python
from . import attach, offers
from .errors import CatalogueError
from .models import CatalogueProduct
```

with

```python
from . import attach, offers, stock
from .errors import CatalogueError
from .models import CatalogueProduct
```

and (b) append to the end of the file:

```python


class StockView(APIView):
    """GET stock/ — the business's offers that need restocking (sold out first), the numbers behind each, and how many
    of its offers are counted and not counted. Works whatever STOCK_ALERTS_ENABLED says."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def get(self, request):
        return Response(stock.needs_restocking(request.user))


class StockLineView(APIView):
    """PUT stock/<listing_id>/line/ {"units": n or null} — the business's own low-stock line for one offer (null: the
    default). Changing it re-arms the low alert."""

    permission_classes = [IsAuthenticated, IsBusinessOwner]

    def put(self, request, listing_id):
        listing = _own_listing(request, listing_id)
        try:
            units = stock.parse_line(_body(request).get("units"))
        except ValueError:
            return Response({"units": stock.LINE_MESSAGE}, status=400)
        if not attach.groupable(listing):
            return Response({"detail": stock.NOT_A_PRODUCT, "code": "not_a_product"}, status=400)
        if listing.stock_quantity is None:
            return Response({"detail": stock.NOT_COUNTED, "code": "not_counted"}, status=409)
        stock.set_own_line(listing, units)
        return Response({"listing_id": listing.pk, "line": units, "cover": stock.row(listing, stock.cover_of(listing))})
```

(`attach.groupable` is the one "product or food" rule, `cart.guard.DELIVERABLE`.)

- [ ] **Step 7: The URLs** — in `backend/catalogue/urls.py` replace

```python
    path("products/<int:pk>/offers/", views.ProductOffersView.as_view(), name="catalogue-product-offers"),
]
```

with

```python
    path("products/<int:pk>/offers/", views.ProductOffersView.as_view(), name="catalogue-product-offers"),
    path("stock/", views.StockView.as_view(), name="catalogue-stock"),
    path("stock/<int:listing_id>/line/", views.StockLineView.as_view(), name="catalogue-stock-line"),
]
```

- [ ] **Step 8: Generate the migration**

Run: `docker compose -p cat1 run --rm --user "$(id -u):$(id -g)" web python manage.py makemigrations catalogue --name stock_alert_state`
Expected: `catalogue/migrations/0003_stock_alert_state.py` — `Create model StockAlertState`. No `ledger` migration (the settings are code, read through `MoneySetting` rows).

- [ ] **Step 9: Run the tests**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue ledger approvals wallets.tests.test_guards --noinput`
Expected: PASS (20 new tests in `test_stock_cover`; `wallets.tests.test_guards` still sees its withdrawal wording and "Applies only to orders paid after it starts." for `rider_commission_bp`).

- [ ] **Step 10: Commit**

```bash
git add backend/catalogue backend/ledger/settings_store.py backend/ledger/approval_kinds.py
git commit -F - <<'EOF'
feat(catalogue): days of cover from paid sales, governed low-stock numbers, needs-restocking list and own line per offer (plan 6)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 7: Low-stock and sold-out alerts, once per crossing, hourly, behind `STOCK_ALERTS_ENABLED`

> Task 6 review note: the alert's conditional UPDATE must also match the `threshold_units` the run measured against (`WHERE threshold_units IS NOT DISTINCT FROM <measured line>`), so an own-line change made mid-run does not swallow the re-armed alert. `stock.measure` also answers `None` for an uncounted listing; `alerts.run` only measures `tracked(...)` rows.

**Files:**
- Create: `backend/catalogue/alerts.py`, `backend/catalogue/tasks.py`, `backend/catalogue/tests/test_stock_alerts.py`
- Modify: `backend/ashantihub/settings.py` (`STOCK_ALERTS_ENABLED`; `CELERY_BEAT_SCHEDULE`)

**Interfaces:**
- Consumes: `catalogue.stock.limits_at`, `tracked`, `measure_many(listings, now, limits, lines)`, `cover_of`, `set_own_line`, `Cover` (Task 6); `StockAlertState` (Task 6); `listings.visibility.hidden_business_q`; `notifications.services.notify_business_owner`; `core.jobs` (heartbeat for every beat entry).
- Produces: `catalogue.alerts.LOW = "stock_low"`, `SOLD_OUT = "stock_sold_out"`, `CHUNK = 500`, `NAMED = 5`, `enabled() -> bool`, `tell(owner, kind, names) -> Notification | None`, `move_state(state, cover, now) -> str | None`, `run(now=None) -> int` (offers told; one transaction); `catalogue.tasks.check_stock_alerts()`; `settings.STOCK_ALERTS_ENABLED` and `settings.SOLD_OUT_HIDDEN_ENABLED` (env, default False); beat entry `catalogue-stock-alerts` (`crontab(minute=35)`).

- [ ] **Step 1: Write the failing test** — `backend/catalogue/tests/test_stock_alerts.py`

```python
"""Catalogue plan 6, Task 7: low-stock and sold-out alerts, told once per crossing and re-armed only by a restock
(spec §1 row 15). Review Focus 3."""
from datetime import timedelta

from unittest import mock

from django.conf import settings
from django.test import TestCase, override_settings
from django.utils import timezone

from catalogue import alerts, stock, tasks
from catalogue.models import StockAlertState
from catalogue.tests.helpers import business, go_live, product, sell, service
from listings.models import Listing
from notifications.models import Notification
from orders.models import Order


def set_stock(listing, value):
    Listing.objects.filter(pk=listing.pk).update(stock_quantity=value)


@override_settings(STOCK_ALERTS_ENABLED=True)
class AlertTests(TestCase):
    def setUp(self):
        self.owner = business()

    def notices(self, kind):
        return list(Notification.objects.filter(business_owner=self.owner, kind=kind))

    def test_review_focus_low_is_told_once_until_restocked(self):
        listing = product(self.owner, "Milo 400g", stock=5)
        self.assertEqual(alerts.run(), 1)
        self.assertEqual(alerts.run(), 0)                                          # still low: nothing more
        [notice] = self.notices(alerts.LOW)
        self.assertEqual(notice.title, "Running low")
        self.assertIn("“Milo 400g”", notice.body)
        set_stock(listing, 30)
        self.assertEqual(alerts.run(), 0)                                          # restocked: re-armed, nothing sent
        set_stock(listing, 4)
        self.assertEqual(alerts.run(), 1)
        self.assertEqual(len(self.notices(alerts.LOW)), 2)

    def test_sold_out_is_told_once_and_a_partial_restock_says_nothing(self):
        listing = product(self.owner, "Milo 400g", stock=0)
        self.assertEqual(alerts.run(), 1)
        self.assertEqual((len(self.notices(alerts.SOLD_OUT)), self.notices(alerts.LOW)), (1, []))   # sold out says it all
        set_stock(listing, 2)
        self.assertEqual(alerts.run(), 0)                                          # still low, already told at 0
        set_stock(listing, 0)
        self.assertEqual(alerts.run(), 1)                                          # sold out again
        self.assertEqual(len(self.notices(alerts.SOLD_OUT)), 2)

    def test_review_focus_a_drifting_sales_rate_never_repeats_the_alert(self):
        listing = go_live(product(self.owner, "Nido", stock=6), 60)
        order = sell(listing, 28, days_ago=10)                                     # 1 a day: 6 days left, low
        self.assertEqual(alerts.run(), 1)
        Order.objects.filter(pk=order.pk).update(placed_at=timezone.now() - timedelta(days=40))
        self.assertEqual(alerts.run(), 0)                                          # no sales now: 6 > 5, not restocked
        set_stock(listing, 5)
        self.assertEqual(alerts.run(), 0)                                          # low again, already told
        set_stock(listing, 20)
        self.assertEqual(alerts.run(), 0)                                          # a restock re-arms it
        set_stock(listing, 5)
        self.assertEqual(alerts.run(), 1)

    def test_review_focus_two_runs_at_once_tell_once(self):
        listing = product(self.owner, "Milo", stock=3)
        StockAlertState.objects.create(listing=listing)
        stale = StockAlertState.objects.get(listing=listing)                       # both runs read it before either moved
        cover, now = stock.cover_of(listing), timezone.now()
        self.assertEqual(alerts.move_state(stale, cover, now), alerts.LOW)
        self.assertIsNone(alerts.move_state(stale, cover, now))                    # the conditional update finds it moved

    def test_one_notice_per_business_naming_its_offers(self):
        for n in range(7):
            product(self.owner, f"Item {n}", stock=1)
        rival = business("Rival Mart")
        product(rival, "Rival item", stock=1)
        self.assertEqual(alerts.run(), 8)
        [notice] = self.notices(alerts.LOW)
        self.assertEqual(notice.title, "7 products running low")
        self.assertIn("and 2 more", notice.body)
        self.assertEqual(Notification.objects.filter(business_owner=rival, kind=alerts.LOW).count(), 1)

    def test_a_run_that_dies_part_way_leaves_every_state_as_it_was(self):
        product(self.owner, "Milo", stock=3)
        with mock.patch("catalogue.alerts.tell", side_effect=RuntimeError("worker killed")), self.assertRaises(RuntimeError):
            alerts.run()
        self.assertFalse(StockAlertState.objects.filter(low_alerted_at__isnull=False).exists())   # nothing marked told
        self.assertEqual(alerts.run(), 1)                                          # the next run tells it

    def test_the_sold_out_notice_claims_hiding_only_while_hiding_is_on(self):
        product(self.owner, "Milo 400g", stock=0)
        with override_settings(SOLD_OUT_HIDDEN_ENABLED=False):
            alerts.run()
        [notice] = self.notices(alerts.SOLD_OUT)
        self.assertEqual(notice.body, "“Milo 400g” has sold out. Restock to keep selling.")
        Notification.objects.all().delete()
        StockAlertState.objects.all().delete()
        with override_settings(SOLD_OUT_HIDDEN_ENABLED=True):
            alerts.run()
        [notice] = self.notices(alerts.SOLD_OUT)
        self.assertIn("no longer shows in search", notice.body)

    def test_changing_the_own_line_re_arms_the_low_alert(self):
        listing = product(self.owner, "Milo", stock=4)
        self.assertEqual(alerts.run(), 1)
        stock.set_own_line(listing, 10)
        self.assertEqual(alerts.run(), 1)                                          # 4 <= 10: told against the new line

    def test_offers_that_are_never_measured(self):
        product(business("Suspended", suspended=True), stock=0)
        product(self.owner, "Draft", stock=0, status=Listing.DRAFT)
        product(self.owner, "Uncounted", stock=None)
        set_stock(service(self.owner), 0)
        self.assertEqual(alerts.run(), 0)
        self.assertFalse(Notification.objects.exists())


class SwitchedOffTests(TestCase):
    def test_nothing_is_measured_or_sent_while_switched_off(self):
        product(business(), stock=0)
        self.assertEqual(alerts.run(), 0)
        self.assertFalse(Notification.objects.exists())
        self.assertFalse(StockAlertState.objects.exists())


class JobTests(TestCase):
    def test_the_hourly_job_is_scheduled(self):
        entry = settings.CELERY_BEAT_SCHEDULE["catalogue-stock-alerts"]
        self.assertEqual(entry["task"], "catalogue.tasks.check_stock_alerts")
        self.assertEqual(str(entry["schedule"]._orig_minute), "35")

    @override_settings(STOCK_ALERTS_ENABLED=True)
    def test_the_task_runs_the_check(self):
        product(business(), stock=0)
        self.assertEqual(tasks.check_stock_alerts(), 1)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue.tests.test_stock_alerts --noinput`
Expected: ERROR — `ImportError: cannot import name 'alerts' from 'catalogue'`.

- [ ] **Step 3: The alerts** — `backend/catalogue/alerts.py`:

```python
"""Low-stock and sold-out alerts (catalogue plan 6; spec §1 row 15, §10): each offer is told about once per crossing.

* `run` (hourly: catalogue.tasks.check_stock_alerts) measures every counted, published product and food offer of a
  business public browse shows (catalogue.stock) and moves its StockAlertState (`move_state`):
  - sold out (0) and not yet told: one "sold out" notice; the low alert counts as told too (at stock 0), so a partial
    restock that is still low says nothing more;
  - low and not yet told: one "running low" notice, remembering the stock it was told at;
  - the low alert is re-armed only by a restock: once the offer is no longer low and holds more than when it was told
    (a sales rate drifting over the line never repeats it), or when the business changes its own line
    (catalogue.stock.set_own_line); the sold-out alert once stock is above 0.
* Every move is one conditional UPDATE (`... IS NULL`), so two runs at once tell a business once. The whole run is one
  transaction: the state moves and their notices commit together, so a run that dies part-way leaves every state as it
  was and the next run tells those offers.
* One notice per business per run for each kind, naming up to five offers (`tell`).
* In-app only. Texts and emails by the business's preference wait for Stage 4's outbox (spec §13 (cii)): `tell` is the
  one place to add them.
* Nothing is measured or sent while STOCK_ALERTS_ENABLED is off (the default). A notice that fails to save
  (notifications never raise) while its state moved is not retried until the next restock (spec §13 (cxii)); a run that
  dies part-way is not that case: the run is one transaction, so nothing is marked told without its notice."""
from django.conf import settings
from django.db import transaction
from django.utils import timezone

from listings.models import Listing
from listings.visibility import hidden_business_q
from notifications.services import notify_business_owner

from . import stock
from .models import StockAlertState

LOW, SOLD_OUT = "stock_low", "stock_sold_out"
CHUNK = 500
NAMED = 5


def enabled():
    return bool(getattr(settings, "STOCK_ALERTS_ENABLED", False))


def _names(names):
    shown = ", ".join(f"“{name}”" for name in names[:NAMED])
    more = len(names) - NAMED
    return shown if more <= 0 else f"{shown} and {more} more"


def tell(owner, kind, names):
    """The business's in-app notice for one kind, naming its offers. The texts-and-emails hook goes here (cii)."""
    one = len(names) == 1
    if kind == SOLD_OUT:
        title = "Sold out" if one else f"{len(names)} products sold out"
        body = f"{_names(names)} {'has' if one else 'have'} sold out. Restock to keep selling."
        if getattr(settings, "SOLD_OUT_HIDDEN_ENABLED", False):
            body = (f"{_names(names)} {'has' if one else 'have'} sold out and no longer {'shows' if one else 'show'} in "
                    f"search. Restock to show {'it' if one else 'them'} again.")
        icon = "📭"
    else:
        title = "Running low" if one else f"{len(names)} products running low"
        body = f"{_names(names)} {'is' if one else 'are'} running low. See Needs restocking on your dashboard."
        icon = "📦"
    return notify_business_owner(owner, kind, title, body=body, link="/business-dashboard", icon=icon)


def move_state(state, cover, now):
    """Apply one offer's measurement to its alert state; the kind of notice it earns now (LOW, SOLD_OUT) or None.
    `state` may be stale: every move is conditional on the row being as the move expects."""
    rows = StockAlertState.objects.filter(pk=state.pk)
    if cover.sold_out:
        if state.sold_out_alerted_at is None and rows.filter(sold_out_alerted_at__isnull=True).update(
            sold_out_alerted_at=now, updated_at=now,
        ):
            rows.filter(low_alerted_at__isnull=True).update(low_alerted_at=now, low_alerted_stock=0)
            return SOLD_OUT
        return None
    if state.sold_out_alerted_at is not None:
        rows.update(sold_out_alerted_at=None, updated_at=now)
    if cover.low:
        if state.low_alerted_at is None and rows.filter(low_alerted_at__isnull=True).update(
            low_alerted_at=now, low_alerted_stock=cover.stock, updated_at=now,
        ):
            return LOW
        return None
    if state.low_alerted_at is not None and cover.stock > (state.low_alerted_stock or 0):
        rows.filter(low_alerted_at=state.low_alerted_at).update(low_alerted_at=None, low_alerted_stock=None, updated_at=now)
    return None


def run(now=None):
    """Measure every offer and send what is due. Returns how many offers were told about (0 while switched off). One
    transaction: the state moves and their notices commit together, so a run that dies part-way (a deploy, a timeout)
    leaves every state as it was and the next run tells those offers. A second run at the same time waits on the rows the
    first moved, then finds them moved: still told once."""
    if not enabled():
        return 0
    now = now or timezone.now()
    current = stock.limits_at(now)
    ids = list(stock.tracked(Listing.objects.exclude(hidden_business_q())).order_by("pk").values_list("pk", flat=True))
    notices = {}
    with transaction.atomic():
        for start in range(0, len(ids), CHUNK):
            _run_chunk(ids[start:start + CHUNK], current, now, notices)
        for (_, kind), (owner, names) in sorted(notices.items(), key=lambda item: item[0]):
            tell(owner, kind, names)
    return sum(len(names) for _, names in notices.values())


def _run_chunk(ids, current, now, notices):
    """Measure one chunk of offers and collect the notices they earn, by (business, kind), into `notices`."""
    listings = list(stock.tracked(Listing.objects.filter(pk__in=ids)).select_related("business_owner").order_by("pk"))
    StockAlertState.objects.bulk_create([StockAlertState(listing_id=pk) for pk in ids], ignore_conflicts=True)
    states = {state.listing_id: state for state in StockAlertState.objects.filter(listing_id__in=ids)}
    lines = {pk: state.threshold_units for pk, state in states.items() if state.threshold_units is not None}
    covers = stock.measure_many(listings, now, current, lines)
    for listing in listings:
        kind = move_state(states[listing.pk], covers[listing.pk], now)
        if kind is not None:
            notices.setdefault((listing.business_owner_id, kind), (listing.business_owner, []))[1].append(listing.name)
```

- [ ] **Step 4: The job** — `backend/catalogue/tasks.py`:

```python
from celery import shared_task

from . import alerts


@shared_task
def check_stock_alerts():
    """Hourly: tell businesses about offers that ran low or sold out (once per crossing; a no-op while
    STOCK_ALERTS_ENABLED is off). The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    return alerts.run()
```

- [ ] **Step 5: The switch and the schedule** — in `backend/ashantihub/settings.py`, (a) replace

```python
DELIVERY_FEE_ENABLED = env.bool("DELIVERY_FEE_ENABLED", default=False)
```

with

```python
DELIVERY_FEE_ENABLED = env.bool("DELIVERY_FEE_ENABLED", default=False)

# Low-stock and sold-out alerts to businesses (catalogue plan 6; spec §1 row 15). Off until the owner decides: with it off
# the hourly job measures and sends nothing. The "needs restocking" list does not depend on it. On the first run after it
# is turned on, every offer already low is told once.
STOCK_ALERTS_ENABLED = env.bool("STOCK_ALERTS_ENABLED", default=False)

# Search and the related list stop showing counted goods at 0 stock (catalogue plan 6; spec §1 row 15, §10 "zero stock
# hides the offer"). Off until the Plan 6F screens tell a business to leave the count empty when it does not count stock;
# the listing's own page and the other-sellers list are not affected by it (see listings.visibility.sold_out_q).
SOLD_OUT_HIDDEN_ENABLED = env.bool("SOLD_OUT_HIDDEN_ENABLED", default=False)
```

and (b) replace

```python
    "wallets-reconcile": {
        "task": "wallets.tasks.reconcile_yesterday",
        "schedule": crontab(hour=2, minute=30),  # the day before; read-only; a no-op while the ledger is off
    },
}
```

with

```python
    "wallets-reconcile": {
        "task": "wallets.tasks.reconcile_yesterday",
        "schedule": crontab(hour=2, minute=30),  # the day before; read-only; a no-op while the ledger is off
    },
    "catalogue-stock-alerts": {
        "task": "catalogue.tasks.check_stock_alerts",
        "schedule": crontab(minute=35),  # hourly, at twenty-five to: a no-op while STOCK_ALERTS_ENABLED is off
    },
}
```

- [ ] **Step 6: Run the tests**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue core.tests.test_background_jobs --noinput`
Expected: PASS (12 new tests in `test_stock_alerts`; `test_every_scheduled_job_names_a_registered_task` finds `catalogue.tasks.check_stock_alerts`).

- [ ] **Step 7: Commit**

```bash
git add backend/catalogue backend/ashantihub/settings.py
git commit -F - <<'EOF'
feat(catalogue): hourly low-stock and sold-out alerts, once per crossing, re-armed by a restock, behind STOCK_ALERTS_ENABLED (plan 6)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 8: The barcode matcher — backfill command and new barcoded entries (requests only, never grouping)

> TODO (Task 3 review): staff ungrouping a listing leaves its request APPROVED, so the matcher would re-file it. Record `ungrouped_at`/`ungrouped_by` on the request (or a state) in `detach`, and make the matcher skip listings staff ungrouped.

**Files:**
- Create: `backend/catalogue/management/__init__.py`, `backend/catalogue/management/commands/__init__.py`, `backend/catalogue/management/commands/propose_catalogue_matches.py`, `backend/catalogue/tests/test_backfill.py`
- Modify: `backend/catalogue/attach.py` (`approve`; append the matcher)

**Interfaces:**
- Consumes: `attach.approve`, `_product_for` (`created`), `NEEDS_REVIEW` (Tasks 2–3); `identity.is_store_code`; `cart.guard.deliverable_q()`; `notify_staff_role`.
- Produces: `catalogue.attach.propose_barcode_matches(product=None, *, dry_run=False) -> int`, `TURNED_DOWN`; `approve` files matches for a newly made barcoded entry once its transaction has committed (`transaction.on_commit`); `manage.py propose_catalogue_matches [--apply] [--batch-size N]` (dry run by default). Gates (Task 9): listings that gain a barcode, or are created or published after the entry exists, are filed only by a manual run or the nightly `catalogue-propose-matches` beat (switch `CATALOGUE_MATCHER_ENABLED`, default off); approve's on-commit hook is synchronous.

- [ ] **Step 1: Write the failing test** — `backend/catalogue/tests/test_backfill.py`

```python
"""Catalogue plan 6, Task 8: the barcode matcher files grouping requests and never groups: the backfill for existing
listings, and every newly approved barcoded entry. Review Focus 1 (store codes never match)."""
from io import StringIO

from django.core.management import call_command
from django.test import TestCase

from accounts.testing import make_staff
from catalogue import attach
from catalogue.models import CatalogueAttachRequest, CatalogueProduct
from catalogue.tests.helpers import BARCODE, STORE_CODE, business, product, service
from listings.models import Listing
from notifications.models import Notification

BACKFILL, PENDING = CatalogueAttachRequest.BACKFILL, CatalogueAttachRequest.PENDING


class BarcodeMatcherTests(TestCase):
    def setUp(self):
        self.moderator = make_staff("operations", "ops@example.com")
        self.entry = CatalogueProduct.objects.create(brand="Nestle", name="Milo 400g", barcode=BARCODE)
        self.match = product(business("Kumasi Mart"), barcode=BARCODE)

    def test_a_matching_listing_gets_a_request_and_stays_ungrouped(self):
        self.assertEqual(attach.propose_barcode_matches(), 1)
        request = CatalogueAttachRequest.objects.get()
        self.assertEqual(
            (request.listing, request.catalogue_product, request.source, request.status, request.barcode),
            (self.match, self.entry, BACKFILL, PENDING, BARCODE),
        )
        self.match.refresh_from_db()
        self.assertIsNone(self.match.catalogue_product)
        self.assertEqual(Notification.objects.filter(staff=self.moderator, kind=attach.NEEDS_REVIEW).count(), 1)

    def test_running_twice_files_once(self):
        self.assertEqual(attach.propose_barcode_matches(), 1)
        self.assertEqual(attach.propose_barcode_matches(), 0)

    def test_what_is_never_matched(self):
        product(business("Grouped"), barcode=BARCODE, catalogue_product=CatalogueProduct.objects.create(brand="X", name="Y"))
        turned_down = product(business("Turned Down"), barcode=BARCODE)
        CatalogueAttachRequest.objects.create(
            listing=turned_down, catalogue_product=self.entry, barcode=BARCODE, status=CatalogueAttachRequest.REJECTED,
        )
        withdrawn = product(business("Withdrawn"), barcode=BARCODE)
        CatalogueAttachRequest.objects.create(
            listing=withdrawn, catalogue_product=self.entry, barcode=BARCODE, status=CatalogueAttachRequest.WITHDRAWN,
        )
        product(business("No Barcode"))
        salon = service(business("Salon"))
        Listing.objects.filter(pk=salon.pk).update(barcode=BARCODE)
        CatalogueProduct.objects.create(brand="Corner Shop", name="Kenkey", barcode=STORE_CODE)
        product(business("Store Code"), barcode=STORE_CODE)
        self.assertEqual(attach.propose_barcode_matches(), 1)
        self.assertEqual(CatalogueAttachRequest.objects.get(source=BACKFILL).listing, self.match)

    def test_a_listing_with_a_request_waiting_is_left_alone(self):
        attach.propose(self.match, {})
        self.assertEqual(attach.propose_barcode_matches(), 0)

    def test_a_dry_run_files_nothing(self):
        self.assertEqual(attach.propose_barcode_matches(dry_run=True), 1)
        self.assertFalse(CatalogueAttachRequest.objects.exists())
        self.assertFalse(Notification.objects.exists())

    def test_the_command(self):
        out = StringIO()
        call_command("propose_catalogue_matches", "--dry-run", stdout=out)
        self.assertIn("1 grouping request would be filed.", out.getvalue())
        call_command("propose_catalogue_matches", stdout=out)
        self.assertIn("1 grouping request filed.", out.getvalue())
        self.assertEqual(CatalogueAttachRequest.objects.filter(source=BACKFILL).count(), 1)


class ApprovalMatchesTests(TestCase):
    def test_a_new_barcoded_product_files_requests_for_its_other_listings(self):
        staff = make_staff("operations", "ops@example.com")
        first = product(business("Adepa Ventures"), barcode=BARCODE)
        second = product(business("Kumasi Mart"), barcode=BARCODE)
        request = attach.propose(first, {})
        with self.captureOnCommitCallbacks(execute=True):   # the matcher runs once the approval has committed
            _, entry = attach.approve(request.pk, staff)
        filed = CatalogueAttachRequest.objects.get(source=BACKFILL)
        self.assertEqual((filed.listing, filed.catalogue_product, filed.status), (second, entry, PENDING))
        second.refresh_from_db()
        self.assertIsNone(second.catalogue_product)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue.tests.test_backfill --noinput`
Expected: ERROR — `AttributeError: module 'catalogue.attach' has no attribute 'propose_barcode_matches'` and `CommandError: Unknown command: 'propose_catalogue_matches'`.

- [ ] **Step 3: The matcher** — in `backend/catalogue/attach.py`, (`IntegrityError` is already imported by Task 2.) (a) in `approve` replace

```python
        request.save(update_fields=["catalogue_product", "status", "rejection_reason", "reviewed_by", "reviewed_at"])
    notify_business_owner(
        listing.business_owner, GROUPED, "Listing grouped with other sellers",
```

with

```python
        request.save(update_fields=["catalogue_product", "status", "rejection_reason", "reviewed_by", "reviewed_at"])
        if created and product.barcode:
            # A new barcoded entry: other ungrouped listings carrying that barcode get a request to review (staff decide
            # each one; nothing is grouped here). Only after the whole approval has committed (the staff request's own
            # transaction included): filing a request key-share-locks that listing, which must never wait on a checkout
            # or another approval while this one still holds its own listing row.
            transaction.on_commit(lambda: propose_barcode_matches(product))
    notify_business_owner(
        listing.business_owner, GROUPED, "Listing grouped with other sellers",
```

and (b) append to the end of the file:

```python


# --- The barcode matcher (backfill; never groups) --------------------------------------------------------------------

TURNED_DOWN = (CatalogueAttachRequest.REJECTED, CatalogueAttachRequest.WITHDRAWN)


def propose_barcode_matches(product=None, *, dry_run=False):
    """File a backfill request for every ungrouped product or food listing whose barcode equals an entry's (every
    barcoded entry, or just `product`). Skipped: a store's own code, a listing with a request waiting, and a listing
    whose request for that entry was rejected or withdrawn. Never groups anything. Returns how many were filed (or would
    be, with dry_run); tells listings.moderate holders once when any were filed."""
    entries = CatalogueProduct.objects.exclude(barcode="")
    if product is not None:
        entries = entries.filter(pk=product.pk)
    by_barcode = {entry.barcode: entry for entry in entries if not identity.is_store_code(entry.barcode)}
    if not by_barcode:
        return 0
    candidates = (
        Listing.objects.filter(barcode__in=sorted(by_barcode), catalogue_product__isnull=True)
        .filter(guard.deliverable_q())
        .exclude(catalogue_requests__status=CatalogueAttachRequest.PENDING)
        .order_by("pk")
    )
    filed = 0
    for listing in candidates:
        entry = by_barcode[listing.barcode]
        if CatalogueAttachRequest.objects.filter(listing=listing, catalogue_product=entry, status__in=TURNED_DOWN).exists():
            continue
        if not dry_run:
            try:
                with transaction.atomic():
                    CatalogueAttachRequest.objects.create(
                        listing=listing, catalogue_product=entry, barcode=listing.barcode,
                        source=CatalogueAttachRequest.BACKFILL,
                    )
            except IntegrityError:
                continue  # the business asked for this listing meanwhile: one request waits per listing
        filed += 1
    if filed and not dry_run:
        notify_staff_role(
            "listings.moderate", NEEDS_REVIEW, "Barcode matches to review",
            body=f"{filed} listing{'' if filed == 1 else 's'} share a barcode with a catalogue product.",
            link="catalogue", icon="🏷️",
        )
    return filed
```

- [ ] **Step 4: The command** — create `backend/catalogue/management/__init__.py` and `backend/catalogue/management/commands/__init__.py` (both empty) and `backend/catalogue/management/commands/propose_catalogue_matches.py`:

```python
"""manage.py propose_catalogue_matches [--dry-run] — the catalogue backfill (catalogue plan 6): file a grouping request
for every ungrouped product or food listing whose barcode equals a catalogue entry's. Staff decide each request in the
catalogue queue; this never groups anything. Safe to run again."""
from django.core.management.base import BaseCommand

from catalogue import attach


class Command(BaseCommand):
    help = "File grouping requests for listings whose barcode matches a catalogue product. Never groups anything."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Count the requests without filing them.")

    def handle(self, *args, **options):
        dry_run = options["dry_run"]
        filed = attach.propose_barcode_matches(dry_run=dry_run)
        self.stdout.write(
            f"{filed} grouping request{'' if filed == 1 else 's'} {'would be filed' if dry_run else 'filed'}."
        )
```

- [ ] **Step 5: Run the tests**

Run: `docker compose -p cat1 run --rm web python manage.py test catalogue --noinput`
Expected: PASS (7 new tests in `test_backfill`; Task 3's approval tests unchanged: no other listing shares their barcode, and a `TestCase` never runs on-commit callbacks).

- [ ] **Step 6: Commit**

```bash
git add backend/catalogue
git commit -F - <<'EOF'
feat(catalogue): barcode matcher and propose_catalogue_matches backfill file requests only; new barcoded entries file theirs (plan 6)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 9: Correctness core, stage index, spec gate items (ci) onward, full suite

**Files:**
- Modify: `backend/CLAUDE.md`, `CLAUDE.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (Status, Scope, append the gate section)

**Interfaces:**
- Consumes: every name from Tasks 1–8.
- Produces: documentation only.

- [ ] **Step 1: The correctness core** — in `backend/CLAUDE.md` replace

```markdown
    `otp.senders.sms_outbox`). Codes and device/step-up tokens are never stored or logged in clear; add any new
    secret field or local-variable name to `ashantihub/sentry.py`.

## Test-fixture gotcha
```

with

```markdown
    `otp.senders.sms_outbox`). Codes and device/step-up tokens are never stored or logged in clear; add any new
    secret field or local-variable name to `ashantihub/sentry.py`.
- **Catalogue, offers and stock alerts (`catalogue/`, Stage 6).** A `Listing` is the offer. `Listing.catalogue_product`
  (null = stands alone) is set only by `catalogue.attach.approve` (staff with `listings.moderate`, moderated-queue
  contract, request row then listing row locked) and cleared only by `attach.detach`; nothing groups automatically (the
  barcode matcher, `propose_catalogue_matches`, only files requests). Services, stays and events never group
  (`cart.guard.DELIVERABLE`). Barcodes are stored as 14-digit GTINs through `catalogue.identity.clean_barcode`, and a
  store's own code never groups. Offer rows (`catalogue.offers.offer_row`) never carry a phone, email, address, pin or
  `contact_phone`; an uncounted stock is null. Days of cover and the low line live in `catalogue.stock` (three governed
  settings in `ledger.settings_store`); alerts move `StockAlertState` with conditional UPDATEs (once per crossing,
  re-armed only by a restock or a new own line), in-app only, behind `STOCK_ALERTS_ENABLED` (default off). Search and
  related lists hide counted goods at `stock_quantity=0` only while `SOLD_OUT_HIDDEN_ENABLED` is on (default off); the detail
  page never does. The owner listing forms save only the fields sent (`listings.serializers.save_sent_fields`). The
  featured-offer tie uses the straight-line pin distance only to order, never shown (as `delivery.dispatching.rank`). The checkout stock reservation above is unchanged.
  Follow-ups before the alerts go on or the screens ship are in the spec's §13 (ci) onward.

## Test-fixture gotcha
```

- [ ] **Step 2: The stage index** — (a) in the root `CLAUDE.md` replace

```markdown
- `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` — wallet, escrow, platform fees,
  OTP; Stage 1 (ledger), Stage 2 (OTP, backend) and Stage 3 (wallets, withdrawals, reconciliation, backend) are
  implemented behind switches that default off, later stages are specs only; §13 lists what must be done before each
  switch is turned on
```

with

```markdown
- `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` — wallet, escrow, platform fees,
  OTP, catalogue and stock; Stage 1 (ledger), Stage 2 (OTP, backend), Stage 3 (wallets, withdrawals, reconciliation,
  backend) and Stage 6 (catalogue, offers, stock alerts, backend) are implemented behind switches that default off,
  later stages are specs only; §13 lists what must be done before each switch is turned on
```

and (b) in `docs/IMPLEMENTATION_INSTRUCTIONS.md` replace

```markdown
| **6** Offers and stock | Catalogue entries, offers, "other sellers", stock reservation upgrade, low-stock alerts. |
```

with

```markdown
| **6** Offers and stock | Catalogue entries, offers, "other sellers", stock reservation upgrade, low-stock alerts. Backend: docs/superpowers/plans/2026-10-16-catalogue-offers-stock-6.md, built (grouping by staff approval, other sellers, the business's product lookup, days of cover, alerts behind `STOCK_ALERTS_ENABLED` and sold-out hiding behind `SOLD_OUT_HIDDEN_ENABLED`, both default off); the reservation upgrade is a gate before Plan 7 (spec §13 (ciii)); the screens are Plan 6F. |
```

- [ ] **Step 3: The spec header** — in `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`, (a) replace

```markdown
and docs/superpowers/plans/2026-10-16-withdrawals-3b.md (payout destinations, withdrawals, reconciliation).
```

with

```markdown
and docs/superpowers/plans/2026-10-16-withdrawals-3b.md (payout destinations, withdrawals, reconciliation). Stage 6 (catalogue, offers and stock alerts, backend) plan: docs/superpowers/plans/2026-10-16-catalogue-offers-stock-6.md.
```

and (b) replace

```markdown
payments, refunds, withdrawals and reconciliation, backend) are implemented behind switches that default off (branches
feature/ledger-stage1, feature/otp-security and feature/wallets; see section 13); later stages are specs only.
```

with

```markdown
payments, refunds, withdrawals and reconciliation, backend) are implemented behind switches that default off (branches
feature/ledger-stage1, feature/otp-security and feature/wallets; see section 13); Stage 6 backend (catalogue entries,
offers, other sellers, stock cover and low-stock alerts; branch feature/catalogue-offers-6) is implemented with its
alerts behind `STOCK_ALERTS_ENABLED` and its sold-out hiding behind `SOLD_OUT_HIDDEN_ENABLED` (both default off); later stages
are specs only.
```

(When this branch meets Plans 1b and 4, which rewrite the same two lines, keep every stage named.)

- [ ] **Step 4: The gate items** — append to the end of the spec (after the Stage 6 reconciliation from Task 1):

```markdown

### Before stock alerts are switched on and the catalogue screens ship (Stage 6)

`STOCK_ALERTS_ENABLED` and `SOLD_OUT_HIDDEN_ENABLED` default off. The catalogue endpoints answer as soon as this is
deployed, but nothing is grouped until staff approve a request, and sold-out listings leave search (§10) only once
`SOLD_OUT_HIDDEN_ENABLED` is on (gate (cx)).

- (ci) **Frontend (Plan 6F).** The listing form's barcode field (show the 14-digit key without its leading zeros) and
  "group with a catalogue product" (look it up at `/api/catalogue/products/`, ask, see the request, withdraw it);
  "Needs restocking" and the per-offer line (replace the hard-coded `stock_quantity <= 3` badge in
  `frontend/components/dashboard/panels/OwnerListingCard.jsx` with the server's `low` / `sold_out`); the product page's
  "Other sellers" panel with the featured offer and the shortfall prompt (each offer added by the customer, never
  automatically); the staff catalogue queue and ungroup action (add a `catalogue` row to `realtime`
  `QUEUE_INVALIDATIONS` so it refreshes live, and a staff `catalogue` tab: the `catalogue_needs_review` notices link to
  it); the business's lookup screen. Until then no business can ask and nothing is grouped. Also for 6F: each Other
  sellers "add" must respect the cart guard (`cart.guard.blocked_reason`: 4 shops, 2 food places, 3 km; the API does not
  say whether the customer's cart can take an offer); a sold-out listing's own page still lets a customer add it (the
  cart does not check stock; checkout answers "Only 0 left"), so the product page should disable Add at 0; the staff
  Marketplace screen counts a sold-out listing as live (`marketplace/listings.py:59`) while customers cannot find it;
  promos are on, and Other sellers and the featured offer order by `price_amount`, not `marketing.checkout`'s live
  flash-sale price, so "cheapest first" can be wrong during a flash sale: order by the price the customer would pay
  before the panel ships. The shortfall prompt invites carts holding several offers of one product, which raises the
  odds of the pre-existing checkout lock-order deadlock (spec (xvii)): fix that first.
- (cii) **Texts and emails "by preference" (§10).** Stock alerts are in-app only. Once Stage 4's outbox
  (`wallets.vendor_texts.queue`, `VendorPreference`) is on `righteoushack`, queue a stock text from
  `catalogue.alerts.tell` (a new `VendorText` kind, a key per offer and alert time, a GSM-7 body naming offers only),
  honour the business's preference, and decide email.
- (ciii) **The reservation window (§10 "for a short window").** An abandoned Hubtel checkout (no webhook ever arrives)
  keeps its stock reserved for good: only `_fail_order_checkout` gives it back. It also makes the offer look low or
  sold out to the alerts and hides it from search. Add a timed release of PENDING order sessions (with the lock order of
  (xv) and (xvii)) before Plan 7 turns Hubtel on.
- (civ) **Owner stock writes do not lock the listing row (pre-existing).** `ListingRestockView` reads and saves
  `stock_quantity` without `select_for_update`, so a restock racing a checkout can lose the checkout's decrement (an
  oversell) or the restock. Before Stage 6 the owner edit forms (`ListingManageView`, `OwnerListingUpdateView`) saved
  every column, so any PATCH, even a price change, wrote back the stock it had read; Stage 6 saves only the sent fields
  (`listings.serializers.save_sent_fields`), but a PATCH that sends `stock_quantity` still races. Lock the row for the
  read-modify-write; the alerts' re-arm rule reads the same number.
- (cv) **The public listing serializer still carries `contact_phone` (pre-existing).** `PublicListingSerializer`
  exposes the listing's `contact_phone` to anyone, against "businesses cannot be contacted directly". The catalogue rows
  leave it out; decide whether to drop it from the public shape (check the frontend first).
- (cvi) **The first switch-on tells every offer already low,** one notice per business and kind. Run it once on staging
  with realistic data and read the notices before production.
- (cvii) **Catalogue entries cannot be edited, merged or retired.** A duplicate entry for one unbarcoded product, or a
  typo in an entry's name, can only be worked around by ungrouping and asking again. A barcoded listing can also join a
  brand-only entry that staff named, and a later approval for the same barcode then makes a second, barcoded entry,
  splitting one product in two. Add a staff edit and merge (with the activity log) before grouping is used at volume.
- (cviii) **Grouping is one person's decision.** One `listings.moderate` holder groups or ungroups a business's
  listing with no second check. Revisit if grouping ever affects fees, ranking or promotions.
- (cix) **Hourly cost.** The job measures every counted, published product each hour (one sales query and one bulk
  insert per 500 offers). Watch its duration on System health; if it grows, measure only offers whose stock changed or
  that sold since the last run. A restock followed by a sell-down within the same hour is never told, because a run
  re-arms an offer only when it sees it not low and above the stock it was told at; consider re-arming in
  `ListingRestockView`.
- (cx) **Sold-out hiding is off until the screens say how to use it.** Turn `SOLD_OUT_HIDDEN_ENABLED` on with the Plan
  6F screens, which must tell a business to leave the count empty if it does not count stock: with the switch on, a
  made-to-order product kept at 0 disappears from search. Counted goods only; a service or stay at 0 is never hidden.
- (cxi) **Owner questions (G1–G12 in the plan):** the 7-day, 5-unit and 28-day defaults and their edges (fewer than 7
  days; 5 or fewer units) and the single-sale edge of the units fallback (G1), staff-only ungrouping (owner-confirmed on
  2026-10-16: a business also cannot withdraw a barcode match AshantiHub filed), whether the matcher should also file
  exact brand-and-name matches for branded listings without a barcode (they are grouped today only if their business
  asks), businesses seeing each other's prices and counts, the featured-offer tie rule, sold-out hiding.
- (cxii) **A lost notice is not retried.** If the in-app notice fails to save while its state moved
  (`notifications.services` never raises), that crossing is not told again until the next restock. A run that dies
  part-way is not this case: the run is one transaction, so the next run tells those offers. Acceptable in-app;
  revisit with texts (cii).
```

- [ ] **Step 5: Commit**

```bash
git add backend/CLAUDE.md CLAUDE.md docs/IMPLEMENTATION_INSTRUCTIONS.md docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md
git commit -F - <<'EOF'
docs(catalogue): correctness core, stage index, spec scope and gate items (ci)-(cxii) for Stage 6

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

- [ ] **Step 6: Run the whole backend suite**

Run: `docker compose -p cat1 run --rm web python manage.py test --noinput`
Expected: PASS. If a failure is unrelated to this work, confirm it on the base commit (`d26dd54`, "docs(regulatory): BoG request pack - letter, submission v0.2, technical summary, terms"; `git switch --detach d26dd54`, re-run the failing label, `git switch feature/catalogue-offers-6`) and report it rather than fixing it here.

- [ ] **Step 7: Migrations check**

Run: `docker compose -p cat1 run --rm web python manage.py makemigrations --check --dry-run`
Expected: `No changes detected`.

---

## What this plan deliberately does not do (later plans)

| Plan | Scope | Why separate |
|---|---|---|
| **6F** Frontend | Barcode field and grouping request on the listing form, "Needs restocking" with the own line, the product page's "Other sellers" panel with the featured offer and shortfall prompt, the staff catalogue queue, the business's lookup screen (gate (ci)). | No screen ships in a backend plan; every endpoint answers honestly without one. |
| **4** follow-up | Stock texts and emails by the business's preference through the Stage 4 outbox (gate (cii)). | The outbox is on PR #153, not on `righteoushack`. |
| **7** Hubtel live | The timed release of an abandoned Hubtel checkout's reservation (gate (ciii)). | Only reachable with a real provider; `payments/services.py` is being edited by PR #152. |
| Catalogue curation | Editing, merging and retiring entries; entry photos and descriptions (gate (cvii)). | Not needed to group; staff can ungroup and re-ask meanwhile. |
| Multi-offer cart helpers | Splitting a quantity across several offers for the customer. | Spec §10: "nothing is added without them"; the customer adds each offer. |
| Fuzzy matching | Name similarity beyond exact normalised names. | Wrong groupings show a customer another product; exact barcode and exact names only. |

## Self-review

**Spec coverage:**

| Requirement | Task(s) |
|---|---|
| §1 row 7 / §10: every listing is an offer (own price, quantity, cart line); the customer chooses other sellers' offers, nothing added for them | C1 (Listing is the offer; carts and checkout unchanged), 4 (read-only other sellers, `available_quantity` for the shortfall prompt) |
| §1 row 8 / §10: branded/barcoded products attach to a staff-approved entry; unbranded stand alone; services, events, stays never | 1 (keys, entry), 2 (ask; `not_groupable`, `brand_or_barcode_required`), 3 (staff decide), 8 (matcher files requests only) |
| §10: featured offer = lowest price, in stock, verified; ties nearest; "other sellers" | 4 |
| §1 row 15 / §10: per-offer threshold, default < 7 days cover, fallback 5 units, once on crossing, sold-out alert at zero, zero-stock offers hidden, "needs restocking" list | 4 (hidden), 6 (cover, own line, list), 7 (alerts) |
| §10: SMS/email by preference | 7 (`tell` hook, in-app now), gate (cii) |
| §10: stock reservation at checkout, decrement, restore | C15 (unchanged), gate (ciii) for the timed window |
| §1 row 16 / §3.3: governed, maker-checker settings | 6 (three settings through `ledger.setting`, approval wording) |
| §11 step 6 | Tasks 1–9 |
| §13 | 1 (K1–K8), 9 ((ci)–(cxii)) |
| Brief: sourcing helper for businesses, read-only, no contact | 5 |
| Brief: Celery beat hourly with the core job registry | 7 (`catalogue-stock-alerts`, `core.jobs` heartbeat, `test_background_jobs`) |
| Brief: migrations plan; backfill (nothing grouped automatically, barcode matches proposed) | 1, 2, 6 (migrations), 8 (backfill) |
| Brief: owner-scoped isolation; honest empty states | 2, 5, 6 (404 for others' rows), 4, 5, 6 (nulls and empty lists) |

**Placeholder scan:** every code step carries complete code and every test step complete test code; edits quote the exact text replaced; no "TBD", "similar to" or undefined names.

**Name consistency:** `identity.clean_barcode/is_store_code/normalise_name/BarcodeError/BARCODE_MESSAGE/CHECK_DIGIT_MESSAGE` (1, 2, 5, 8); `models.CatalogueProduct`, `product_row` (1–5), `CatalogueAttachRequest.PENDING/APPROVED/REJECTED/WITHDRAWN/VENDOR/BACKFILL` (2, 3, 8), `StockAlertState` (6, 7); `errors.CatalogueError(message, code, status_code=400).body()` (2–5); `attach.groupable/grouping_barcode/describe/_text/propose(listing, data)/withdraw(owner, request_id)/request_row/state` (2), `approve(request_id, staff, data=None)/reject(request_id, staff, reason)/re_review(request_id)/detach(listing_id, reason)/matches/matches_for/staff_row(request, found=None)/_product_for` (3, 8), `propose_barcode_matches(product=None, *, dry_run=False)/TURNED_DOWN` (8), kinds `NEEDS_REVIEW/GROUPED/NOT_GROUPED/UNGROUPED`, `REASON_REQUIRED`, `NOT_WITHDRAWABLE` (2, 3, 8); `offers.in_stock_q/live_q/live_offers/position_from/featured/ordered/offer_row/other_sellers/PRICE/AVAILABILITY` (4, 5), `search/sourcing/QUERY_REQUIRED` (5); `stock.COVER_DAYS/FALLBACK_UNITS/WINDOW_DAYS/SALES/FALLBACK/OWN/LINE_MESSAGE/NOT_A_PRODUCT/NOT_COUNTED/Limits/Cover/limits_at/tracked/days_on_sale(…, first_sale)/units_sold (units, first sale)/measure(…, first_sale)/own_lines/measure_many/cover_of/row/needs_restocking/parse_line/set_own_line` (6, 7); `alerts.LOW/SOLD_OUT/enabled/tell/move_state/run` (7); `tasks.check_stock_alerts` (7); `views._own_listing/_body` (2, 6); `views_staff.PERMISSION/ATTACH_STATUS_MAP` (3); `approval_kinds.STOCK_SETTING_KEYS` (6); `listings.serializers.clean_listing_barcode/GROUPED_BARCODE_MESSAGE/save_sent_fields` (1); `listings.visibility.sold_out_q` (4); settings `STOCK_ALERTS_ENABLED`, `SOLD_OUT_HIDDEN_ENABLED` (7); test helpers `BARCODE/OTHER_BARCODE/STORE_CODE/business/product/service/stay/buyer/sell/go_live/as_account/as_staff` (1–8).

**Test counts:** Task 1 — 18 (`test_identity`: 6 + 2 + 3 + 7); Task 2 — 16 (`test_attach`: 11 + 5); Task 3 — 17 (`test_attach_queue`: 5 + 9 + 3); Task 4 — 13 (`test_other_sellers`: 7 + 2 + 4); Task 5 — 7 (`test_sourcing`: 5 + 2); Task 6 — 20 (`test_stock_cover`: 3 + 8 + 3 + 6); Task 7 — 12 (`test_stock_alerts`: 9 + 1 + 2); Task 8 — 7 (`test_backfill`: 6 + 1). 110 new tests in all.

**Review Focus pins:** each of the five lines above names the task and the tests that pin it; all of those tests are written out in their tasks.


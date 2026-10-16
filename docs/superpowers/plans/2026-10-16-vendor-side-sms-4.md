# Vendor Wallet, Fees and Order Texts — Implementation Plan (Stage 4, backend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a business its own money as its dashboard needs it — Pending and Available, the lifetime fee cap used and left, one row per sale (item subtotal, platform fee, what is due, "awaiting Support's call" / "released" / "refunded"), a daily summary, a CSV statement and the platform fees in force — and text it on every paid order and every release (plus an optional daily digest) through the existing SMS door and spend alert, without a text ever stopping a payment or a release. All behind `LEDGER_ENABLED` (default off), backend only.

**Architecture:** Read-only views over the ledger in a new `wallets/vendor.py` (sale rows from the fee snapshots, the daily summary from the business's own journal lines, balances from its accounts) served at `/api/wallet/vendor/` by `wallets/views_vendor.py`, business owners only. Texts go through a small outbox, `wallets.VendorText`: queued inside the payment's or the release's own transaction (in a savepoint that never raises), sent after commit through `otp.senders`, claimed with a lease so they are never sent twice at once, retried by a 5-minute job, and counted by `otp.spend`'s daily SMS alert. Two hooks: `orders/alerts.py` (paid) and `ledger.escrow.release_verified` (release).

**Tech Stack:** Django 5.2, DRF, Postgres, Celery beat (eager under tests), the repo's `ledger`, `wallets`, `orders`, `otp`, `notifications`, `marketing` apps.

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` — §1 rows 2, 3, 6, 17; §2.1 (Vendor Pending / Available); §2.2 steps 1, 2, 4; §3.1 (tiers), §3.2 (base, cap, snapshot; "Platform fees are never shown to the customer"), §3.3 (changes apply only to later orders); §4.1 (release follows Support's call); **§6 Vendor wallets** (the two views, SMS on every paid order and on release, optional daily digest, in-app copy always kept, SMS failure never blocks payment, the transactions page with cap and export); §9 (the SMS-spend alert); §11 step 4; §12 (digest thresholds owed by the owner); §13. Deviations are in §0 below; Task 8 records them in the spec.

**Depends on:** Stage 1 (ledger), Stage 2 (OTP), Stage 3a (wallets, payments, refunds) and Stage 3b (destinations, withdrawals, reconciliation), all on `origin/righteoushack` (this branch, `feature/vendor-side-4`, starts at `d26dd54`). Uses from them: `ledger.posting` (`balance_of`, `account_for`, `post`), `ledger.fees` (`quote`, `rule_set_in_force`, `charged_to_date`, `FeeError`), `ledger.settings_store.current`, `ledger.escrow` (`enabled`, `pay_key`, `release_key`, `waiver_key`, `record_order_payment`, `release_verified`), `ledger.verification` (`handed_over`, `record`), `ledger.refunds.refund_order`, `wallets.services.money`, `wallets.views` (`ledger_off`, `Pagination`, `parse_amount`, `AmountError`), `wallets.models.Withdrawal`, `otp.senders` (`deliver`, `Delivery`, `sms_outbox`), `otp.spend` (`check_quietly`, `texts_sent_on`, `ALERT_KIND`), `otp.identity` (`contacts`, `ref`), `accounts.phones.mask_phone`, `accounts.views.IsBusinessOwner`, `notifications.services.notify_business_owner`. **Plan 1b** (services, events and stays; branch `feature/ledger-services-1b`) is planned in parallel and is **not** needed: this plan reads and texts product orders only, and lists where booking sales slot in (§0 V15; spec gate (lxxi)).

**Commits:** every commit step ends with the two attribution trailers shown (`git commit ... --trailer ...`, git 2.32 or later):
`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j`. An executing session that was given its own attribution lines uses those instead.

## 0. Decisions and reconciliation with the code

How the vendor side works today (surveyed 2026-10-16):

- A business already sees `GET /api/wallet/` (`wallets.services.summary`: Pending and Available) and `GET /api/wallet/transactions/` (every ledger line on its accounts). It has no per-sale view of fees, no cap meter, no daily summary and no ledger export; `GET /api/orders/owner/report/export/` is a sales CSV of `line_total`s with the customer's name, unrelated to the ledger.
- A paid order runs `payments.services._finalize_order_checkout` → `escrow.record_order_payment` (fee snapshots per business and category) → `orders.alerts.alert_owners_of_paid_order` (one in-app `NEW_ORDER` notice per business, its own lines only, plus an email after commit). Nothing is texted to a business.
- Release has one door: `ledger.verification.record(..., "matches")` → `escrow.release_verified`, which posts `order-release-<id>` (Pending debited, fee to platform income, the rest to Available) and then `charge_waiver` (`order-waiver-<id>`: the business's free-delivery promo from its Available).
- Texts have one door: `otp.senders.deliver` / `send_sms` (`OTP_SMS_PROVIDER`: `simulated` default sends nothing, `locmem` under tests keeps `sms_outbox`, `hubtel` through the unverified marketing client). The SMS-spend alert (`otp.spend`) counts `OtpEvent` SENT texts per day against `staffsecurity.policy.otp_sms_daily_alert` (default 500) and tells `security.manage` once a day; it blocks nothing. `OtpEvent` send rows are also what the OTP hourly send limits count (`otp.service._over_hourly_limits`: 5 per account and phone, **20 per phone across all accounts**, 10 per account).

| # | Question | Decision | Why (grounded in the code) |
|---|---|---|---|
| V1 | Spec sections | The vendor dashboard and texts are **spec §6** (the brief's "§9" is the OTP section; what Stage 4 takes from §9 is its SMS-spend alert). §6's "Transactions page" is the sale rows plus withdrawals; its "cap used and remaining" is in the overview and the fee endpoint. | Spec §6 and §9 as written. |
| V2 | Where the code lives | `wallets/vendor.py` (read model), `wallets/vendor_texts.py` (text outbox), `wallets/views_vendor.py` at `/api/wallet/vendor/`; models `VendorText` and `VendorPreference` appended to `wallets/models.py` (migration `0005_vendor_texts`). Hooks: `orders/alerts.py` (paid) and `ledger/escrow.release_verified` (release). | `/api/wallet/` is the holder's money API (3a). The paid alert and the release each have one door. Plan 1b edits `wallets/services.py`, `payments/services.py`, `ledger/fees.py` and `wallets/reconciliation.py`; this plan edits none of them, so the two branches merge cleanly. |
| V3 | Where the figures come from | Sale rows: the business's `OrderFeeSnapshot`s summed per order (base, fee charged, refunded base and fee, released / reversed stamps) and its owed `WaivedFeeCharge`. Daily summary: `JournalLine`s on the business's own Pending and Available accounts, folded by journal kind. Balances: the accounts. Never today's fee rules. | §3.2 step 4 ("release reads the snapshot"); §6 "ledger-backed statement". The snapshot already carries `refunded_base_pesewas` / `refunded_fee_pesewas` (3a W4). |
| V4 | Sale status | `awaiting_call` while any of the business's snapshots on the order is neither released nor reversed (its label says "Waiting for delivery or collection", "Waiting for Support's call to the customer", or "On hold while AshantiHub checks the order" while a dispute is open); `released` once every snapshot left was released; `refunded` once every snapshot is reversed. A partial refund keeps the status and shows `refunded`; the fee and `net` show what is left. Export words: Pending / Available / Refunded, and Withdrawn / Withdrawal in progress / Returned to Available for withdrawals. | §4.1 (no timer; release only on Support's call), §6 status words; refunds as 3a W4 (`fee_share`, `reversed_at` when whole). |
| V5 | Privacy | No customer name, phone or address in any sale row, daily summary, export or text. Rows list the business's own item lines only; the export holds no free text at all. An open dispute shows only "On hold while AshantiHub checks the order". | `GET /api/orders/owner/` already gives the name and address needed for fulfilment, never the phone (backend/CLAUDE.md owner-scoped isolation); a money screen needs neither. |
| V6 | Who sees fees | Business owners only (`IsBusinessOwner`): a customer, whatever their id, and a staff member get 403. The customer's checkout answer, order detail and notices are unchanged. Staff already have `/api/ledger/fees/`. | §3.2 "Platform fees are never shown to the customer." |
| V7 | Texts: outbox and channel | One `VendorText` per (order, business) paid, per (order, business) released, per (business, day) digest, keyed so it is written once. Queued inside the money transaction in a savepoint that never raises; sent after commit (`transaction.on_commit(..., robust=True)` → Celery) through `otp.senders.deliver`; claimed by one conditional UPDATE that pushes `next_attempt_at` out by a 10-minute lease (never sent twice at once; a crash mid-send is retried after the lease); retried after 5 min, 15 min, 1 h and 4 h, then `failed`; no usable Ghana mobile number → `no_phone`. **Never an `OtpEvent`.** | §6 "SMS failure never blocks payment (queued, retried)". An `OtpEvent` SENT row counts toward the 20-an-hour per-phone code ceiling: a busy shop's order texts would lock the business out of its own sign-in codes. |
| V8 | Spend guard | `otp.spend.texts_sent_on` counts code texts plus sent business texts, so the one daily alert watches all SMS spend; its wording and the policy label say so. Nothing is blocked; no throttle, no quiet hours. | §9 "an SMS-spend alert"; §6 names no throttle or quiet hours (brief: only if the spec says). |
| V9 | Text wording | Plain GSM-7 characters and "GHS" (never "GH₵"), at most 306 characters (two parts). Paid: order reference, item subtotal, platform fee, any free-delivery promo, amount due. Release: what reached Available, the fee taken, any promo taken after. Digest: orders, items sold, released, fees, refunds, balances now. | §6 "reference, item subtotal, platform fee, amount due". "₵" is not GSM-7: one in a text turns it into UCS-2 (70 characters a part), about three times the cost. |
| V10 | In-app copy | Paid: the existing "New order #N" notice also carries the fee line and is the text's copy (one notice per order, not two). Release and digest: a `vendor_money` notice. The copy is written even when the text cannot be queued or sent. | §6 "in-app copy always kept". `Notification.kind` is a free-form slug (its model docstring), so no migration. |
| V11 | Digest | Optional, off by default, per business (`VendorPreference.daily_digest`); queued at 07:00 Accra for the day before, only when money moved that day, once per day (keyed). | §6 "Optional daily digest"; §12 leaves "SMS digest thresholds" to the owner (A5). |
| V12 | Not built | No low-balance, negative-Available, refund or withdrawal text (3b's in-app withdrawal notices stay); no staff outbox screen. | The spec names none (§6, §9); brief: "low-balance per spec". Owner question (A6; gate (lxix)). |
| V13 | Fee transparency | `GET vendor/fees/`: the approved tiers in force per category with their start, the next approved change with its start (never a proposal still waiting), `charged` (true only for product orders today), how the fee base works, the cap used and left, and an optional server-side quote (`?amount=&category=`, cap counted). | §3.1 tiers; §3.2 base and cap; §3.3 changes apply only later. A server quote means no screen re-implements the band maths (and its half-up rounding). |
| V14 | Export | Synchronous CSV at `vendor/statement/export/` (no `?format=`, DRF's renderer override, backend/CLAUDE.md), the last 30 days by default, at most 366. | Same shape as `OwnerSalesReportExportView`; no free text, so no spreadsheet-formula risk. |
| V15 | Bookings | Product orders only. Slot-in points once Plan 1b records bookings: a second row source with `kind: "booking"` in `vendor.sale_groups` / `rows` / `statement`, the `booking_*` journal kinds in `vendor.FOLD`, services and events in `vendor.CHARGED`, booking texts in `vendor_texts`. Until then booking journals land in the daily summary's `other` column, so its columns still add up. | Brief; Plan 1b's `ledger.BookingSale` is a separate model (its S1). Gate (lxxi). |
| V16 | Ledger off | Every vendor endpoint answers `409 ledger_off`; no text is queued; the new-order notice is exactly as before; the send job still sends texts already queued (it never queues one); the digest job is a no-op. | 3a/3b switch rule; a text exists only if the ledger was on when it was queued. |

## Global Constraints

- Everything in Plan 3a's and 3b's Global Constraints applies: integer pesewas, converted only through `ledger.money` (`to_pesewas`; `wallets.services.money` for GH₵ strings); a balance changes only inside `ledger.posting.post`; `LEDGER_ENABLED` (default off) gates everything; simulated rails; nothing moves real money.
- **Stage 4 never posts a journal or changes a balance.** Its only writes are `VendorText`, `VendorPreference` and `Notification` rows. The paid and release texts are queued inside the payment's / release's own transaction **after** its postings, so the 3a lock order (order row → fee snapshots → ledger accounts in one sorted `posting.lock` pass) is unchanged: they lock no ledger row and nothing else locks theirs. A send claims only its own `VendorText` row.
- Every `/api/wallet/vendor/*` endpoint: business owners only (`IsBusinessOwner`; a customer — whatever their id — and staff get 403); `409 {"code": "ledger_off"}` while `LEDGER_ENABLED` is off; only the caller's own snapshots, journal lines, accounts, withdrawals and texts are read (an order can span several businesses).
- **No customer name, phone or address** in any vendor money response, export or text. **The platform fee never reaches a customer** (response, notice or text).
- Texts: through `otp.senders.deliver` only; plain GSM-7 characters, "GHS", at most 306 characters, no code or token; never an `OtpEvent`; counted by `otp.spend`; queued in a savepoint that never raises; sent only after commit; **no provider call inside a database transaction**.
- A day is the calendar day in Africa/Accra (`settings.TIME_ZONE`). Daily summary: at most 92 days a request (default the last 30); export: at most 366 (default the last 30).
- **Never deploy and never touch production or staging.** No frontend: the screens are a later Plan 4F.
- Commands, from `/home/righteoushack/projects/TheAshantihub/.worktrees/vendor4`: `docker compose -p vend1 run --rm web python manage.py test <label> --noinput`. Never two docker commands at once.
- Migrations (check with `ls backend/wallets/migrations`): today's wallets leaf is `0004_reconciliation_unavailable`. This plan adds one generated migration, `wallets/0005_vendor_texts.py` (Task 5). No `ledger`, `accounts` or `notifications` migration.
- Doc edits stay merge-safe with Plan 1b: append only; this plan's spec §13 items are numbered from **(lxvi)**; do not edit the spec's Status / Scope lines or the root `CLAUDE.md` (Plan 1b rewrites those).
- Style: module docstrings, no type annotations, tests in `wallets/tests/`, plain words in user-facing messages, GH₵ in API messages and GHS in texts.

## Review Focus

1. **Another business's money or a customer's details reaching a business, or the fee reaching a customer** — a shared order shows each business only its own lines, fee and texts; no customer name, phone or address in any vendor row, summary, export or text; a customer whose id equals the business's id gets 403 and their wallet never counts in the business's summary; the checkout answer, order detail and customer notices never say "platform". Pinned in Task 1 (`test_review_focus_a_shared_order_shows_each_business_only_its_own_lines`, `test_review_focus_no_customer_detail_reaches_a_business`, `test_review_focus_a_customer_with_the_same_id_or_staff_are_refused`), Task 2 (`test_review_focus_only_the_businesss_own_accounts_count`), Task 3 (`test_review_focus_only_the_businesss_own_rows_and_no_free_text`), Task 4 (`test_review_focus_customers_and_staff_never_see_the_fees`), Task 6 (`test_review_focus_each_business_is_texted_its_own_subtotal_fee_and_amount_due`, `test_review_focus_the_customer_never_sees_the_platform_fee`, `test_review_focus_a_shared_order_texts_each_business_its_own_release`) and Task 7 (`test_review_focus_a_customer_with_the_same_id_cannot_read_or_change_them`).
2. **A text that cannot be sent** — the queue failing, the provider down, no usable phone, two workers at once, a worker dying mid-send — never stops the payment or the release, keeps the in-app copy, is retried with backoff and then given up, is never sent twice at once, and never uses up the business's own code send limits. Pinned in Task 5 (`test_review_focus_a_text_that_cannot_be_queued_never_raises`, `test_review_focus_a_failed_send_is_retried_with_backoff_then_given_up`, `test_review_focus_no_usable_phone_is_final_and_the_in_app_copy_stays`, `test_review_focus_a_send_in_progress_is_not_picked_up_again`, `test_review_focus_business_texts_never_use_up_the_code_send_limits`), Task 6 (`test_review_focus_a_text_that_cannot_be_queued_never_stops_the_payment`, `test_review_focus_a_provider_that_is_down_leaves_the_text_queued_for_a_retry`, `test_review_focus_a_text_that_cannot_be_queued_never_stops_a_release`) and Task 7 (`test_review_focus_a_business_with_no_ghana_mobile_is_told_plainly`).
3. **Partial and late refunds** — a sale refunded in part before or after release shows the refunded amount and the fee and net left; a whole refund shows `refunded` with nothing due; a late refund can leave Available negative with nothing withdrawable; Pending equals the sum of the waiting rows; the daily columns add up to the change in the balances. Pinned in Task 1 (`test_review_focus_a_partial_refund_after_release_shows_what_is_left`, `test_review_focus_a_whole_refund_shows_refunded_with_nothing_due`, `test_review_focus_pending_is_the_sum_of_the_rows_still_waiting`, `test_a_late_refund_can_leave_available_negative_and_nothing_withdrawable`) and Task 2 (`test_review_focus_the_columns_add_up_to_the_change_in_the_balances`).
4. **Day boundaries and ranges** — a sale at 23:59 and its release at 00:00 Accra time fall on their own days; a digest covers exactly yesterday; a malformed, reversed or too-long range is a 400. Pinned in Task 2 (`test_review_focus_a_sale_before_midnight_and_its_release_after_fall_on_their_own_days`, `test_review_focus_bad_or_too_long_ranges_are_refused`), Task 3 (`test_review_focus_bad_ranges_are_refused`) and Task 7 (`test_review_focus_yesterdays_digest_goes_once_to_a_business_that_asked`).
5. **Switches-off regression** — with the ledger off every new endpoint answers `ledger_off`, nothing is texted, the new-order notice is exactly as before, and the digest job does nothing. Pinned in Tasks 1–4 and 7 (`LedgerOffTests`), Task 6 (`test_review_focus_with_the_ledger_off_nothing_is_texted_and_the_notice_is_as_before`) and Task 7 (`test_the_digest_job_is_a_no_op_with_the_ledger_off_and_both_jobs_are_scheduled`).

## Assumptions made (decided here, cheap to change — for the owner to confirm)

- **A1** Order and release texts go to every business with a ledger-recorded sale and cannot be turned off (§6: "every paid order"); the daily digest is opt-in, off by default.
- **A2** Texts go to the business's login phone (where its sign-in codes go). A business whose login phone is not a Ghana mobile gets none; its in-app copy is kept and its texts screen says so.
- **A3** Texts use "GHS" and plain characters, at most two SMS parts, never "GH₵" (cost).
- **A4** No quiet hours and no per-business throttle; business texts count toward the existing daily SMS-spend alert (default 500 texts a day) together with code texts; nothing is ever blocked.
- **A5** The digest goes at 07:00 Accra for the day before, only when money moved that day (the "digest thresholds" §12 leaves to the owner: none).
- **A6** No text on refunds, a negative Available, withdrawals or a low balance (the spec names none).
- **A7** A failed text is retried after 5 min, 15 min, 1 h and 4 h, then given up; a worker crash mid-send may send it twice (at least once, never lost).
- **A8** Vendor money screens show no customer details at all; an open dispute shows only "On hold while AshantiHub checks the order".
- **A9** The fee page shows the approved tiers in force and the next approved change with its start, never a proposal waiting for approval; services and events tables are shown marked not charged yet (only product orders are charged until bookings are recorded).
- **A10** The paid order's "New order #N" notice carries the platform fee and amount due instead of a second notice.
- **A11** A suspended business still gets money texts (its money still moves).

## File Structure

Create:
- `backend/wallets/vendor.py` — the business's read model: sale rows and the overview (Task 1), the daily summary (Task 2), the statement (Task 3), the fee schedule and quote (Task 4)
- `backend/wallets/views_vendor.py` — `/api/wallet/vendor/*` (Tasks 1–4, 7)
- `backend/wallets/vendor_texts.py` — the text outbox (Task 5), paid and release texts (Task 6), the digest (Task 7)
- `backend/wallets/migrations/0005_vendor_texts.py` (generated, Task 5)
- `backend/wallets/tests/vendor_helpers.py` (fixtures), `test_vendor_sales.py`, `test_vendor_daily.py`, `test_vendor_statement.py`, `test_vendor_fees.py`, `test_vendor_texts.py`, `test_vendor_text_wiring.py`, `test_vendor_digest.py`

Modify:
- `backend/wallets/models.py` (`VendorText`, `VendorPreference`), `backend/wallets/urls.py`, `backend/wallets/tasks.py`
- `backend/orders/alerts.py` (paid texts and the in-app copy), `backend/ledger/escrow.py` (`release_verified`: release texts)
- `backend/otp/spend.py` (count business texts), `backend/staffsecurity/policy.py` (the alert's label)
- `backend/ashantihub/settings.py` (two beat entries)
- `backend/CLAUDE.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (Task 8)

API added or changed:

| Method + path | Who | Body → answer |
|---|---|---|
| `GET /api/wallet/vendor/` | owner | → `{pending, available, withdrawable, negative, awaiting_call, fee_cap: {limit, used, remaining}}` (`limit`/`remaining` null when there is no cap) |
| `GET /api/wallet/vendor/sales/?status=all\|awaiting_call\|released\|refunded&date_from=&date_to=` | owner | → paginated (20) `{kind: "order", order, reference, placed_at, items: [{name, quantity, line_total}], item_subtotal, refunded, platform_fee, free_delivery_promo, net, status, status_label, handed_over, on_hold, released_at}`, newest first; 400 `{status}` / `{date_from}` / `{date_to}` |
| `GET /api/wallet/vendor/daily/?date_from=&date_to=` | owner | → `{from, to, days: [{day, orders, sold, fees, released, refunded, free_delivery_promo, withdrawn, other, net_change}], totals: {...}}`, newest first, only days with movement; 400 |
| `GET /api/wallet/vendor/statement/export/?date_from=&date_to=` | owner | → `text/csv` attachment `ashantihub-statement-<from>-to-<to>.csv`; 400 |
| `GET /api/wallet/vendor/fees/?amount=&category=` | owner | → `{categories: [{category, label, applies_to, charged, in_force_from, bands: [{from, to, percent, flat, fee}], next: {from, bands} \| null}], fee_base, fee_cap, quote?: {category, amount, fee, you_receive, charged}}`; 400 `{amount}` / `{category}` |
| `GET /api/wallet/vendor/texts/` | owner | → `{order_texts: true, daily_digest, phone: "020 *** 0001" \| null, recent: [{id, kind, order, day, body, status, status_label, to, created_at, sent_at}]}` |
| `PATCH /api/wallet/vendor/texts/` | owner | `{daily_digest: true\|false}` → as GET; 400 `{daily_digest}` |
| all of the above | customer, staff | 403; with the ledger off `409 {"code": "ledger_off"}` |
| paid order (checkout, Hubtel webhook) | changed | ledger on: each business's "New order #N" notice also says the platform fee and the amount due, and a text is queued to it |
| Support's "matches" (release) | changed | ledger on: each business paid gets a `vendor_money` notice and a text |

---

### Task 1: The business's sale rows and overview

**Files:**
- Create: `backend/wallets/vendor.py`, `backend/wallets/views_vendor.py`, `backend/wallets/tests/vendor_helpers.py`, `backend/wallets/tests/test_vendor_sales.py`
- Modify: `backend/wallets/urls.py`

**Interfaces:**
- Consumes: `ledger.posting.balance_of(kind, owner)`, `ledger.fees.charged_to_date(owner)`, `ledger.settings_store.current("fee_cap_pesewas", at)`, `ledger.verification.handed_over(order, check)`, `ledger.models.OrderFeeSnapshot` / `FulfilmentCheck` / `Account`, `marketing.models_waivers.WaivedFeeCharge` (`OWED`), `disputes.models.Dispute.FINAL_STATUSES`, `wallets.services.money(pesewas) -> str`, `wallets.views.ledger_off()` / `Pagination`, `accounts.views.IsBusinessOwner`.
- Produces:
  - `wallets.vendor.AWAITING = "awaiting_call"`, `RELEASED = "released"`, `REFUNDED = "refunded"`, `STATUSES`
  - `vendor.RangeError(field, message)` with `.body() -> {field: message}`; `vendor.optional_dates(params) -> (date | None, date | None)`
  - `vendor.sale_groups(owner, *, status=None, date_from=None, date_to=None)` → a `values()` queryset of dicts `{order_id, placed_at, base, fee, refunded_base, refunded_fee, parts, reversed_parts, open_parts, last_released}` (pesewas), newest first
  - `vendor.status_of(group) -> str`; `vendor.rows(owner, groups) -> list[dict]` (the API row shape in the table above)
  - `vendor.fee_cap(owner, now=None) -> {limit, used, remaining}`; `vendor.overview(owner, now=None) -> dict`
  - `wallets.views_vendor.VendorOverviewView`, `VendorSalesView`; URLs `wallet-vendor`, `wallet-vendor-sales`
  - test fixtures `wallets.tests.vendor_helpers`: `VendorBase` (`self.kofi`, `self.esi`: `Shop`; `self.buyer`; `twin()`), `Shop(name, phone)` (`.owner`, `.client`, `.listing(price)`, `.get(url, params=None)`), `signed_in(account, kind)`, `customer(phone=..., name=...)`, `paid_order(buyer, lines, *, delivery=None, record=True)`, `deliver(order)`, `release(order)`, `waived(owner, order, amount)`, `hold(owner, pesewas, key)`

- [ ] **Step 1: Write the fixtures** — `backend/wallets/tests/vendor_helpers.py`

```python
"""Fixtures for the vendor-side tests (not test cases themselves): businesses, and product orders paid, delivered,
released and refunded through the real ledger paths."""
from datetime import timedelta
from decimal import Decimal

from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.authentication import issue_token
from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff
from ledger import escrow, posting, verification
from ledger.models import Account
from listings.models import Category, Listing, Zone
from marketing.models_waivers import DeliveryWaiver, WaivedFeeCharge
from orders.models import DeliveryAssignment, Order, OrderItem
from otp import senders


def signed_in(account, kind):
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(account, kind)}")
    return client


class Shop:
    """A business with its own listings and a signed-in API client."""

    def __init__(self, name, phone):
        self.owner = BusinessOwner.objects.create(full_name=name, login_phone=phone, password_hash="x")
        self.client = signed_in(self.owner, "business_owner")
        self.count = 0

    def listing(self, price):
        self.count += 1
        return Listing.objects.create(
            business_owner=self.owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name=f"{self.owner.full_name} item {self.count}", description="D.", contact_phone=self.owner.login_phone,
            price_amount=Decimal(price), status=Listing.PUBLISHED,
        )

    def get(self, url, params=None):
        return self.client.get(url, params or {})


def customer(phone="+233241110001", name="Ama Buyer"):
    return Customer.objects.create(full_name=name, phone=phone, password_hash="x")


def paid_order(buyer, lines, *, delivery=None, record=True):
    """A paid door-to-door order of [(listing, quantity)], its payment recorded in the ledger as checkout records it
    (record=False: an order paid before the ledger was on)."""
    items = sum((listing.price_amount * quantity for listing, quantity in lines), Decimal("0.00"))
    order = Order.objects.create(
        customer=buyer, status=Order.PAID, total_amount=items + Decimal(delivery or "0.00"), delivery_fee=delivery,
        delivery_method=Order.DOOR_TO_DOOR, delivery_address="12 Kejetia Road", delivery_phone=buyer.phone,
    )
    for listing, quantity in lines:
        OrderItem.objects.create(
            order=order, listing=listing, quantity=quantity, unit_price=listing.price_amount,
            line_total=listing.price_amount * quantity,
        )
    if record:
        escrow.record_order_payment(order)
    return order


def deliver(order):
    """The rider delivered it and the customer confirmed receipt."""
    now = timezone.now()
    DeliveryAssignment.objects.create(
        order=order, status=DeliveryAssignment.CONFIRMED, delivered_at=now - timedelta(minutes=30), confirmed_at=now,
    )


def release(order):
    """Delivered, confirmed, and Support's call says it matches: the money is released (ledger.verification.record)."""
    deliver(order)
    verification.record(order, make_staff("support", f"support-{order.pk}@example.com"), "matches")


def waived(owner, order, amount):
    """The business's free-delivery promo covered this order's delivery (owed; charged from Available at release)."""
    now = timezone.now()
    waiver = DeliveryWaiver.objects.create(
        business_owner=owner, name="Free delivery week", starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=1),
        status=DeliveryWaiver.ACTIVE,
    )
    return WaivedFeeCharge.objects.create(order=order, waiver=waiver, business_owner=owner, amount=Decimal(amount))


def hold(owner, pesewas, key):
    """A withdrawal held from the business's Available, in the shape wallets.withdrawals posts it."""
    posting.post(key=key, kind="withdrawal_hold", lines=[
        posting.debit(posting.account_for(Account.VENDOR_AVAILABLE, owner), pesewas),
        posting.credit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), pesewas),
    ])


class VendorBase(TestCase):
    """Two businesses (Kofi, Esi) and a customer; the text outbox emptied."""

    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.kofi = Shop("Kofi Mensah", "+233201110001")
        self.esi = Shop("Esi Boateng", "+233201110002")
        self.buyer = customer()

    def twin(self):
        """A customer whose id is the same number as Kofi's business id (a different account kind). Call it last in a
        test: a row made with an explicit id does not move the id sequence."""
        pk = self.kofi.owner.pk
        return Customer.objects.filter(pk=pk).first() or Customer.objects.create(
            pk=pk, full_name="Twin Buyer", phone="+233241119999", password_hash="x",
        )
```

- [ ] **Step 2: Write the failing test** — `backend/wallets/tests/test_vendor_sales.py`

```python
"""The business's own money for its dashboard (vendor plan 4, Task 1): the overview and one row per sale. Review Focus 1
(isolation, privacy, the fee never shown to a customer), 3 (refunds) and 5 (ledger off)."""
from datetime import timedelta
from decimal import Decimal

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from disputes.models import Dispute
from ledger import refunds
from ledger.models import MoneySetting
from orders.models import Order

from .vendor_helpers import VendorBase, deliver, hold, paid_order, release, signed_in, waived

OVERVIEW, SALES = "/api/wallet/vendor/", "/api/wallet/vendor/sales/"


class LedgerOffTests(VendorBase):
    def test_review_focus_the_overview_and_sales_say_ledger_off(self):
        for url in (OVERVIEW, SALES):
            response = self.kofi.get(url)
            self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"), url)


@override_settings(LEDGER_ENABLED=True)
class SaleRowTests(VendorBase):
    def rows(self, params=None):
        response = self.kofi.get(SALES, params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["results"]

    def test_a_paid_order_waits_for_delivery_then_for_supports_call(self):
        order = paid_order(self.buyer, [(self.kofi.listing("60.00"), 2)], delivery="10.00")   # items 120.00: GH₵ 5.00 flat
        row = self.rows()[0]
        self.assertEqual(
            (row["kind"], row["order"], row["reference"], row["item_subtotal"], row["platform_fee"], row["net"], row["refunded"]),
            ("order", order.pk, f"Order #{order.pk}", "120.00", "5.00", "115.00", "0.00"),
        )
        self.assertEqual([(i["name"], i["quantity"], i["line_total"]) for i in row["items"]], [("Kofi Mensah item 1", 2, "120.00")])
        self.assertEqual(
            (row["status"], row["status_label"], row["handed_over"], row["released_at"]),
            ("awaiting_call", "Waiting for delivery or collection", False, None),
        )
        deliver(order)
        row = self.rows()[0]
        self.assertEqual(
            (row["status"], row["status_label"], row["handed_over"]),
            ("awaiting_call", "Waiting for Support's call to the customer", True),
        )

    def test_a_released_order_says_so_with_its_time(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        release(order)
        row = self.rows()[0]
        self.assertEqual((row["status"], row["status_label"], row["net"]), ("released", "Released to your Available balance", "115.00"))
        self.assertIsNotNone(row["released_at"])

    def test_a_free_delivery_promo_is_taken_from_what_is_due(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)], delivery="0.00")
        waived(self.kofi.owner, order, "15.00")
        row = self.rows()[0]
        self.assertEqual((row["free_delivery_promo"], row["net"]), ("15.00", "100.00"))          # 120 - 5 fee - 15 promo

    def test_review_focus_a_partial_refund_after_release_shows_what_is_left(self):
        order = paid_order(self.buyer, [(self.kofi.listing("600.00"), 1)])                       # 1%: GH₵ 6.00
        release(order)
        refunds.refund_order(order, 15000, source="dispute-1")                                   # GH₵ 150.00 back
        row = self.rows()[0]
        self.assertEqual(
            (row["status"], row["item_subtotal"], row["refunded"], row["platform_fee"], row["net"]),
            ("released", "600.00", "150.00", "4.50", "445.50"),                                  # GH₵ 1.50 of the fee went back
        )

    def test_review_focus_a_whole_refund_shows_refunded_with_nothing_due(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        refunds.refund_order(order, source="cancel")
        row = self.rows()[0]
        self.assertEqual(
            (row["status"], row["status_label"], row["refunded"], row["platform_fee"], row["net"]),
            ("refunded", "Refunded to the customer", "120.00", "0.00", "0.00"),
        )

    def test_an_open_dispute_puts_the_sale_on_hold_without_saying_more(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        deliver(order)
        Dispute.objects.create(
            order=order, raised_by=self.buyer, reason=Dispute.ORDER_ISSUE, description="Torn cloth", status=Dispute.OPEN,
        )
        row = self.rows()[0]
        self.assertEqual(
            (row["status"], row["status_label"], row["on_hold"]),
            ("awaiting_call", "On hold while AshantiHub checks the order", True),
        )
        self.assertNotIn("Torn", str(row))

    def test_status_and_date_filters(self):
        waiting = paid_order(self.buyer, [(self.kofi.listing("50.00"), 1)])
        released = paid_order(self.buyer, [(self.kofi.listing("50.00"), 1)])
        release(released)
        refunded = paid_order(self.buyer, [(self.kofi.listing("50.00"), 1)])
        refunds.refund_order(refunded, source="cancel")

        def ids(params):
            return [row["order"] for row in self.rows(params)]

        self.assertEqual(ids({}), [refunded.pk, released.pk, waiting.pk])
        self.assertEqual(ids({"status": "awaiting_call"}), [waiting.pk])
        self.assertEqual(ids({"status": "released"}), [released.pk])
        self.assertEqual(ids({"status": "refunded"}), [refunded.pk])
        Order.objects.filter(pk=waiting.pk).update(placed_at=timezone.now() - timedelta(days=10))
        self.assertEqual(ids({"date_to": (timezone.localdate() - timedelta(days=5)).isoformat()}), [waiting.pk])
        self.assertEqual(ids({"date_from": (timezone.localdate() - timedelta(days=5)).isoformat()}), [refunded.pk, released.pk])
        for params in ({"status": "lost"}, {"date_from": "16/10/2026"}, {"date_from": "2026-10-10", "date_to": "2026-10-01"}):
            self.assertEqual(self.kofi.get(SALES, params).status_code, 400, params)

    def test_orders_paid_before_the_ledger_was_on_are_not_rows(self):
        paid_order(self.buyer, [(self.kofi.listing("50.00"), 1)], record=False)
        self.assertEqual(self.kofi.get(SALES).json()["count"], 0)


@override_settings(LEDGER_ENABLED=True)
class OverviewTests(VendorBase):
    def test_pending_available_and_the_count_waiting(self):
        paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        released = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        release(released)
        body = self.kofi.get(OVERVIEW).json()
        self.assertEqual(
            (body["pending"], body["available"], body["withdrawable"], body["negative"], body["awaiting_call"]),
            ("120.00", "115.00", "115.00", False, 1),
        )

    def test_review_focus_pending_is_the_sum_of_the_rows_still_waiting(self):
        first = paid_order(self.buyer, [(self.kofi.listing("600.00"), 1)])
        paid_order(self.buyer, [(self.kofi.listing("80.00"), 2)], delivery="10.00")              # delivery is never the business's
        refunds.refund_order(first, 10000, source="dispute-2")                                   # part of it, before release
        rows = self.kofi.get(SALES, {"status": "awaiting_call"}).json()["results"]
        waiting = sum(Decimal(row["item_subtotal"]) - Decimal(row["refunded"]) for row in rows)
        self.assertEqual(waiting, Decimal("660.00"))
        self.assertEqual(Decimal(self.kofi.get(OVERVIEW).json()["pending"]), waiting)

    def test_a_late_refund_can_leave_available_negative_and_nothing_withdrawable(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        release(order)                                                                           # Available 115.00
        hold(self.kofi.owner, 11500, "hold-negative")                                           # all of it withdrawn
        refunds.refund_order(order, 5000, source="dispute-3")                                    # 50.00 back, 2.08 of the fee returned
        body = self.kofi.get(OVERVIEW).json()
        self.assertEqual((body["available"], body["withdrawable"], body["negative"]), ("-47.92", "0.00", True))

    def test_the_lifetime_cap_used_and_left(self):
        MoneySetting.objects.create(key="fee_cap_pesewas", value=700, effective_from=timezone.now() - timedelta(days=1))
        paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])                               # GH₵ 5.00 charged
        self.assertEqual(self.kofi.get(OVERVIEW).json()["fee_cap"], {"limit": "7.00", "used": "5.00", "remaining": "2.00"})
        self.assertEqual(self.esi.get(OVERVIEW).json()["fee_cap"], {"limit": "7.00", "used": "0.00", "remaining": "7.00"})

    def test_no_cap_says_so(self):
        self.assertEqual(self.kofi.get(OVERVIEW).json()["fee_cap"], {"limit": None, "used": "0.00", "remaining": None})


@override_settings(LEDGER_ENABLED=True)
class IsolationTests(VendorBase):
    def test_review_focus_a_shared_order_shows_each_business_only_its_own_lines(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1), (self.esi.listing("600.00"), 1)])
        kofi_rows = self.kofi.get(SALES).json()["results"]
        esi_rows = self.esi.get(SALES).json()["results"]
        self.assertEqual([(r["order"], r["item_subtotal"], r["platform_fee"]) for r in kofi_rows], [(order.pk, "120.00", "5.00")])
        self.assertEqual([(r["order"], r["item_subtotal"], r["platform_fee"]) for r in esi_rows], [(order.pk, "600.00", "6.00")])
        self.assertEqual([item["name"] for item in kofi_rows[0]["items"]], ["Kofi Mensah item 1"])
        self.assertEqual(self.kofi.get(OVERVIEW).json()["pending"], "120.00")

    def test_review_focus_no_customer_detail_reaches_a_business(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        deliver(order)
        seen = str(self.kofi.get(SALES).json()) + str(self.kofi.get(OVERVIEW).json())
        for detail in ("Ama Buyer", "241110001", "Kejetia"):
            self.assertNotIn(detail, seen)

    def test_review_focus_a_customer_with_the_same_id_or_staff_are_refused(self):
        paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        support = APIClient()
        support.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_staff('support', 'desk@example.com'))}")
        twin = signed_in(self.twin(), "customer")
        for client in (twin, support):
            for url in (OVERVIEW, SALES):
                self.assertEqual(client.get(url).status_code, 403, url)
```

- [ ] **Step 3: Run it to see it fail**

Run: `docker compose -p vend1 run --rm web python manage.py test wallets.tests.test_vendor_sales --noinput`
Expected: FAIL — every request answers 404 (no `/api/wallet/vendor/` route yet).

- [ ] **Step 4: The read model** — create `backend/wallets/vendor.py`

```python
"""A business's own money, as its dashboard shows it (spec §6; vendor plan 4): Pending and Available, the lifetime fee
cap, and one row per sale with the item subtotal, the platform fee, what is due and where the money stands. Read-only:
nothing here posts, changes a balance or takes a lock.

Sale rows come from the fee snapshots (ledger.OrderFeeSnapshot: one per order, business and fee category, fixed at
payment), so they show what the ledger recorded, never today's rules; balances come from the ledger accounts. Only the
business's own snapshots, item lines and accounts are read: an order can span several businesses (backend/CLAUDE.md,
owner-scoped order isolation). No customer's name, phone or address appears here: the order screen
(GET /api/orders/owner/) already carries what fulfilment needs. Money is integer pesewas inside and GH₵ strings in the
rows. Only product orders are in the ledger today; booking sales (Plan 1b) slot in as a second source of rows with kind
"booking" (spec §13 (lxxi))."""
from django.db.models import Count, F, Max, Q, Sum
from django.utils.dateparse import parse_date

from disputes.models import Dispute
from ledger import fees, posting, settings_store, verification
from ledger.models import Account, FulfilmentCheck, OrderFeeSnapshot
from ledger.money import to_pesewas
from marketing.models_waivers import WaivedFeeCharge
from orders.models import Order, OrderItem

from .services import money

AWAITING, RELEASED, REFUNDED = "awaiting_call", "released", "refunded"
STATUSES = (AWAITING, RELEASED, REFUNDED)
WAITING_FOR_HANDOVER = "Waiting for delivery or collection"
WAITING_FOR_CALL = "Waiting for Support's call to the customer"
ON_HOLD = "On hold while AshantiHub checks the order"  # an open dispute: never more than this (no reason, no customer)
LABELS = {RELEASED: "Released to your Available balance", REFUNDED: "Refunded to the customer"}


class RangeError(Exception):
    """A bad ?date_from= / ?date_to=: `field` names the parameter, `message` is what to show."""

    def __init__(self, field, message):
        super().__init__(message)
        self.field, self.message = field, message

    def body(self):
        return {self.field: self.message}


def _date(params, field):
    raw = params.get(field)
    if raw in (None, ""):
        return None
    try:
        value = parse_date(str(raw))
    except ValueError:  # well formed but not a real day, like 2026-02-30
        value = None
    if value is None:
        raise RangeError(field, "Use a date like 2026-10-16.")
    return value


def optional_dates(params):
    """(date_from or None, date_to or None) from the query string; raises RangeError."""
    date_from, date_to = _date(params, "date_from"), _date(params, "date_to")
    if date_from is not None and date_to is not None and date_from > date_to:
        raise RangeError("date_from", "The start date is after the end date.")
    return date_from, date_to


def sale_groups(owner, *, status=None, date_from=None, date_to=None):
    """One row per order the business sold into while the ledger was on, newest first: its snapshots on that order
    summed (pesewas) and counted. `status` narrows to awaiting_call, released or refunded; the dates are the purchase day
    in Accra."""
    snapshots = OrderFeeSnapshot.objects.filter(business_owner=owner)
    if date_from is not None:
        snapshots = snapshots.filter(order__placed_at__date__gte=date_from)
    if date_to is not None:
        snapshots = snapshots.filter(order__placed_at__date__lte=date_to)
    groups = (
        snapshots.values("order_id")
        .annotate(
            placed_at=Max("order__placed_at"), base=Sum("base_pesewas"), fee=Sum("charged_pesewas"),
            refunded_base=Sum("refunded_base_pesewas"), refunded_fee=Sum("refunded_fee_pesewas"),
            parts=Count("id"), reversed_parts=Count("id", filter=Q(reversed_at__isnull=False)),
            open_parts=Count("id", filter=Q(released_at__isnull=True, reversed_at__isnull=True)),
            last_released=Max("released_at"),  # not "released_at": an annotation may not reuse a field's name
        )
        .order_by("-placed_at", "-order_id")
    )
    if status == AWAITING:
        groups = groups.filter(open_parts__gt=0)
    elif status == RELEASED:
        groups = groups.filter(open_parts=0).exclude(reversed_parts=F("parts"))
    elif status == REFUNDED:
        groups = groups.filter(reversed_parts=F("parts"))
    return groups


def status_of(group):
    """refunded once every snapshot is reversed (refunded whole); released once every one left was released; else the
    money still waits in Pending for Support's call (spec §4.1)."""
    if group["reversed_parts"] == group["parts"]:
        return REFUNDED
    if group["open_parts"] == 0:
        return RELEASED
    return AWAITING


def rows(owner, groups):
    """The API rows for these sale groups (one page, or a whole export range), in their order, in a fixed handful of
    queries whatever their number. `platform_fee` and `net` are what is left after refunds; `net` is what is (or will
    be) the business's: subtotal − refunded − fee − its free-delivery promo."""
    groups = list(groups)
    ids = [group["order_id"] for group in groups]
    orders = Order.objects.select_related("delivery_assignment").in_bulk(ids)
    checks = {check.order_id: check for check in FulfilmentCheck.objects.filter(order_id__in=ids)}
    items = {}
    for item in OrderItem.objects.filter(order_id__in=ids, listing__business_owner=owner).select_related("listing").order_by("pk"):
        items.setdefault(item.order_id, []).append(
            {"name": item.listing.name, "quantity": item.quantity, "line_total": str(item.line_total)}
        )
    # The business's free-delivery promo on the order: owed until release, charged from Available then, reversed (and
    # given back) on a whole refund (ledger.escrow.charge_waiver / return_waiver), so OWED is what it pays.
    promos = {
        charge.order_id: to_pesewas(charge.amount)
        for charge in WaivedFeeCharge.objects.filter(order_id__in=ids, business_owner=owner, status=WaivedFeeCharge.OWED)
    }
    held = set(
        Dispute.objects.filter(order_id__in=ids).exclude(status__in=Dispute.FINAL_STATUSES).values_list("order_id", flat=True)
    )
    out = []
    for group in groups:
        order = orders[group["order_id"]]
        status = status_of(group)
        handed_over = verification.handed_over(order, checks.get(order.pk) or FulfilmentCheck(order=order))
        on_hold = status == AWAITING and order.pk in held
        fee = group["fee"] - group["refunded_fee"]
        promo = promos.get(order.pk, 0)
        if status == AWAITING:
            label = ON_HOLD if on_hold else (WAITING_FOR_CALL if handed_over else WAITING_FOR_HANDOVER)
        else:
            label = LABELS[status]
        out.append({
            "kind": "order", "order": order.pk, "reference": f"Order #{order.pk}", "placed_at": order.placed_at,
            "items": items.get(order.pk, []),
            "item_subtotal": money(group["base"]), "refunded": money(group["refunded_base"]),
            "platform_fee": money(fee), "free_delivery_promo": money(promo),
            "net": money(group["base"] - group["refunded_base"] - fee - promo),
            "status": status, "status_label": label, "handed_over": handed_over, "on_hold": on_hold,
            "released_at": group["last_released"] if status == RELEASED else None,
        })
    return out


def fee_cap(owner, now=None):
    """The lifetime platform-fee cap (spec §1 row 2) as the business sees it: the cap in force (None: no cap), the fees
    charged so far against it, and what is left (None with no cap)."""
    cap = settings_store.current("fee_cap_pesewas", now)
    used = fees.charged_to_date(owner)
    return {
        "limit": money(cap) if cap is not None else None, "used": money(used),
        "remaining": money(max(cap - used, 0)) if cap is not None else None,
    }


def overview(owner, now=None):
    """Pending (waiting for Support's call), Available (released; may be negative after a late refund, which blocks
    withdrawals), what can be withdrawn, how many sales wait, and the fee cap."""
    pending = posting.balance_of(Account.VENDOR_PENDING, owner)
    available = posting.balance_of(Account.VENDOR_AVAILABLE, owner)
    return {
        "pending": money(pending), "available": money(available), "withdrawable": money(max(available, 0)),
        "negative": available < 0, "awaiting_call": sale_groups(owner, status=AWAITING).count(),
        "fee_cap": fee_cap(owner, now),
    }
```

- [ ] **Step 5: The views** — create `backend/wallets/views_vendor.py`

```python
"""A business's own money for its dashboard (spec §6; vendor plan 4), at /api/wallet/vendor/: the overview (Pending,
Available, the lifetime fee cap), one row per sale, the daily summary, the statement export, the platform fees in force
and the texts about its money. Business owners only: a customer (whatever their id) or a staff member gets 403, so a
platform fee never reaches a customer (spec §3.2). Read-only, except the digest choice. Every endpoint answers
409 ledger_off while LEDGER_ENABLED is off."""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.views import IsBusinessOwner
from ledger import escrow

from . import vendor
from .views import Pagination, ledger_off

SALE_STATUSES = ("all", *vendor.STATUSES)


class VendorOverviewView(APIView):
    """GET vendor/ — Pending, Available (may be negative after a late refund), what can be withdrawn, how many sales
    wait for Support's call, and the lifetime fee cap used and left."""

    permission_classes = [IsBusinessOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        return Response(vendor.overview(request.user))


class VendorSalesView(APIView):
    """GET vendor/sales/?status=all|awaiting_call|released|refunded&date_from=&date_to= — one row per order the business
    sold into (its own lines only), newest first, 20 a page."""

    permission_classes = [IsBusinessOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        wanted = request.query_params.get("status") or "all"
        if wanted not in SALE_STATUSES:
            return Response({"status": "Choose all, awaiting_call, released or refunded."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            date_from, date_to = vendor.optional_dates(request.query_params)
        except vendor.RangeError as exc:
            return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)
        groups = vendor.sale_groups(
            request.user, status=None if wanted == "all" else wanted, date_from=date_from, date_to=date_to,
        )
        paginator = Pagination()
        page = paginator.paginate_queryset(groups, request, view=self)
        return paginator.get_paginated_response(vendor.rows(request.user, page))
```

- [ ] **Step 6: The routes** — in `backend/wallets/urls.py` replace

```python
from . import views, views_payouts, views_staff
```

with

```python
from . import views, views_payouts, views_staff, views_vendor
```

and replace

```python
    path("staff/reconciliation/", views_staff.StaffReconciliationView.as_view(), name="wallet-staff-reconciliation"),
```

with

```python
    path("staff/reconciliation/", views_staff.StaffReconciliationView.as_view(), name="wallet-staff-reconciliation"),
    path("vendor/", views_vendor.VendorOverviewView.as_view(), name="wallet-vendor"),
    path("vendor/sales/", views_vendor.VendorSalesView.as_view(), name="wallet-vendor-sales"),
```

- [ ] **Step 7: Run the tests**

Run: `docker compose -p vend1 run --rm web python manage.py test wallets.tests.test_vendor_sales --noinput`
Expected: PASS (17 tests).

- [ ] **Step 8: Commit**

```bash
git add backend/wallets/vendor.py backend/wallets/views_vendor.py backend/wallets/urls.py backend/wallets/tests/vendor_helpers.py backend/wallets/tests/test_vendor_sales.py
git commit -m "feat(wallets): vendor overview and per-sale rows - subtotal, platform fee, net, awaiting call / released / refunded, own lines only" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 2: The daily summary

**Files:**
- Modify: `backend/wallets/vendor.py`, `backend/wallets/views_vendor.py`, `backend/wallets/urls.py`
- Create: `backend/wallets/tests/test_vendor_daily.py`

**Interfaces:**
- Consumes: Task 1 (`vendor.optional_dates`, `RangeError`, `money`), `ledger.models.JournalLine`, `wallets.tests.helpers.fund(kind, owner, pesewas, key)`.
- Produces:
  - `vendor.OWNER_TYPE = "accounts.businessowner"`; `vendor.account(owner, kind) -> Account | None` (never opens one)
  - `vendor.date_range(params, *, default_days, max_days, today=None) -> (date, date)` (raises `RangeError`); `vendor.bounds(first, last) -> (aware datetime, aware datetime)` (`[start, end)` of those Accra days)
  - `vendor.FOLD` (`{(journal kind, account kind, side): (column, sign)}`), `vendor.COLUMNS`
  - `vendor.daily(owner, first, last) -> {"from", "to", "days": [{"day", "orders", "sold", "fees", "released", "refunded", "free_delivery_promo", "withdrawn", "other", "net_change"}], "totals": {...}}`
  - `views_vendor.VendorDailyView`; URL `wallet-vendor-daily`

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_vendor_daily.py`

```python
"""The business's money day by day (vendor plan 4, Task 2), from its own ledger lines. Review Focus 1 (only its own
accounts), 3 (the columns add up to the change in its balances) and 4 (day boundaries, ranges)."""
from datetime import datetime, timedelta
from decimal import Decimal
from unittest import mock
from zoneinfo import ZoneInfo

from django.test import override_settings
from django.utils import timezone

from ledger import refunds
from ledger.models import Account

from .helpers import fund
from .vendor_helpers import VendorBase, hold, paid_order, release, signed_in, waived

DAILY, OVERVIEW = "/api/wallet/vendor/daily/", "/api/wallet/vendor/"
ACCRA = ZoneInfo("Africa/Accra")


def at(moment):
    """Everything inside happens at `moment` (journals are append-only, so they are written then, never back-dated)."""
    return mock.patch("django.utils.timezone.now", return_value=moment)


class LedgerOffTests(VendorBase):
    def test_review_focus_the_daily_summary_says_ledger_off(self):
        response = self.kofi.get(DAILY)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))


@override_settings(LEDGER_ENABLED=True)
class DailySummaryTests(VendorBase):
    def test_a_day_of_sales_a_release_and_a_refund(self):
        first = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        second = paid_order(self.buyer, [(self.kofi.listing("600.00"), 1)])
        release(first)                                                                          # fee 5.00, 115.00 to Available
        refunds.refund_order(second, 10000, source="dispute-4")                                 # 100.00 back before release
        day = self.kofi.get(DAILY).json()["days"][0]
        self.assertEqual(day["day"], timezone.localdate().isoformat())
        self.assertEqual(
            (day["orders"], day["sold"], day["fees"], day["released"], day["refunded"], day["net_change"]),
            (2, "720.00", "5.00", "115.00", "100.00", "615.00"),
        )

    def test_review_focus_the_columns_add_up_to_the_change_in_the_balances(self):
        big = paid_order(self.buyer, [(self.kofi.listing("600.00"), 1)])
        release(big)                                                                            # fee 6.00
        refunds.refund_order(big, 15000, source="dispute-5")                                    # after release: 1.50 of the fee back
        promo = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)], delivery="0.00")
        waived(self.kofi.owner, promo, "15.00")
        release(promo)                                                                          # fee 5.00, then the 15.00 promo
        paid_order(self.buyer, [(self.kofi.listing("80.00"), 1)])                              # still waiting
        hold(self.kofi.owner, 20000, "hold-1")                                                 # a withdrawal
        fund(Account.VENDOR_AVAILABLE, self.kofi.owner, 1000, "fund-other")                   # any other movement
        totals = self.kofi.get(DAILY).json()["totals"]
        self.assertEqual(
            (totals["sold"], totals["fees"], totals["refunded"], totals["free_delivery_promo"], totals["withdrawn"], totals["other"]),
            ("800.00", "11.00", "148.50", "15.00", "200.00", "10.00"),
        )

        def figure(key):
            return Decimal(totals[key])

        self.assertEqual(
            figure("sold") - figure("fees") - figure("refunded") - figure("free_delivery_promo") - figure("withdrawn") + figure("other"),
            figure("net_change"),
        )
        overview = self.kofi.get(OVERVIEW).json()
        self.assertEqual(figure("net_change"), Decimal(overview["pending"]) + Decimal(overview["available"]))

    def test_review_focus_a_sale_before_midnight_and_its_release_after_fall_on_their_own_days(self):
        with at(datetime(2026, 10, 14, 23, 59, 30, tzinfo=ACCRA)):
            order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        with at(datetime(2026, 10, 15, 0, 0, 30, tzinfo=ACCRA)):
            release(order)
        body = self.kofi.get(DAILY, {"date_from": "2026-10-14", "date_to": "2026-10-15"}).json()
        self.assertEqual(
            [(d["day"], d["orders"], d["sold"], d["fees"], d["released"]) for d in body["days"]],
            [("2026-10-15", 0, "0.00", "5.00", "115.00"), ("2026-10-14", 1, "120.00", "0.00", "0.00")],
        )
        only_the_14th = self.kofi.get(DAILY, {"date_from": "2026-10-14", "date_to": "2026-10-14"}).json()
        self.assertEqual([d["day"] for d in only_the_14th["days"]], ["2026-10-14"])

    def test_review_focus_bad_or_too_long_ranges_are_refused(self):
        for params in (
            {"date_from": "2026-13-01"}, {"date_from": "yesterday"}, {"date_from": "2026-10-10", "date_to": "2026-10-01"},
            {"date_from": "2026-01-01", "date_to": "2026-10-16"},
        ):
            response = self.kofi.get(DAILY, params)
            self.assertEqual(response.status_code, 400, params)
            self.assertIn("date_", next(iter(response.json())))

    def test_the_default_is_the_last_30_days_and_quiet_days_are_left_out(self):
        body = self.kofi.get(DAILY).json()
        today = timezone.localdate()
        self.assertEqual((body["from"], body["to"]), ((today - timedelta(days=29)).isoformat(), today.isoformat()))
        self.assertEqual((body["days"], body["totals"]["net_change"], body["totals"]["orders"]), ([], "0.00", 0))

    def test_review_focus_only_the_businesss_own_accounts_count(self):
        paid_order(self.buyer, [(self.kofi.listing("120.00"), 1), (self.esi.listing("600.00"), 1)])
        twin = self.twin()
        fund(Account.CUSTOMER_WALLET, twin, 99900, "fund-twin")                               # same id number, a customer's wallet
        totals = self.kofi.get(DAILY).json()["totals"]
        self.assertEqual((totals["orders"], totals["sold"], totals["net_change"]), (1, "120.00", "120.00"))
        self.assertEqual(signed_in(twin, "customer").get(DAILY).status_code, 403)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p vend1 run --rm web python manage.py test wallets.tests.test_vendor_daily --noinput`
Expected: FAIL — 404 for `/api/wallet/vendor/daily/`.

- [ ] **Step 3: The imports** — in `backend/wallets/vendor.py` replace

```python
from django.db.models import Count, F, Max, Q, Sum
from django.utils.dateparse import parse_date

from disputes.models import Dispute
from ledger import fees, posting, settings_store, verification
from ledger.models import Account, FulfilmentCheck, OrderFeeSnapshot
```

with

```python
from datetime import datetime, time, timedelta

from django.db.models import Count, F, Max, Q, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone
from django.utils.dateparse import parse_date

from accounts.models import BusinessOwner
from disputes.models import Dispute
from ledger import fees, posting, settings_store, verification
from ledger.models import Account, FulfilmentCheck, JournalLine, OrderFeeSnapshot
```

- [ ] **Step 4: The summary** — append to `backend/wallets/vendor.py`

```python
# --- the daily summary (Task 2) ------------------------------------------------------------------------------------

OWNER_TYPE = BusinessOwner._meta.label_lower
P, A = Account.VENDOR_PENDING, Account.VENDOR_AVAILABLE
DR, CR = JournalLine.DEBIT, JournalLine.CREDIT
# How each ledger line on a business's own accounts counts in its daily summary: (journal kind, account, side) ->
# (column, sign). The release takes the item subtotal out of Pending (a debit) and credits Available with it less the
# platform fee, so the fee is the difference. Any other line lands in "other" (credits in, debits out), so for every day
#   sold - fees - refunded - free_delivery_promo - withdrawn + other = net_change (the change in Pending + Available).
# Booking sales (Plan 1b) add their booking_* kinds here (spec §13 (lxxi)).
FOLD = {
    ("order_payment", P, CR): ("sold", 1),
    ("order_release", P, DR): ("fees", 1),
    ("order_release", A, CR): ("fees", -1),
    ("order_refund", P, DR): ("refunded", 1),
    ("order_refund", A, DR): ("refunded", 1),
    ("order_refund", A, CR): ("refunded", -1),
    ("order_waiver_charge", A, DR): ("free_delivery_promo", 1),
    ("order_waiver_return", A, CR): ("free_delivery_promo", -1),
    ("withdrawal_hold", A, DR): ("withdrawn", 1),
    ("withdrawal_reversed", A, CR): ("withdrawn", -1),
}
COLUMNS = ("sold", "fees", "released", "refunded", "free_delivery_promo", "withdrawn", "other", "net_change")


def account(owner, kind):
    """The business's own ledger account of `kind`, or None when none was ever opened (reading never opens one)."""
    return Account.objects.filter(kind=kind, owner_type=OWNER_TYPE, owner_id=str(owner.pk)).first()


def date_range(params, *, default_days, max_days, today=None):
    """(first, last) Accra days, inclusive, from ?date_from=&date_to=: by default the last `default_days` days up to
    today; at most `max_days` days. Raises RangeError."""
    today = today or timezone.localdate()
    date_from, date_to = optional_dates(params)
    date_to = date_to or today
    date_from = date_from or date_to - timedelta(days=default_days - 1)
    if date_from > date_to:
        raise RangeError("date_from", "The start date is after the end date.")
    if (date_to - date_from).days + 1 > max_days:
        raise RangeError("date_from", f"Choose at most {max_days} days.")
    return date_from, date_to


def bounds(first, last):
    """[start, end) aware datetimes covering the Accra days first..last."""
    zone = timezone.get_current_timezone()
    return (
        timezone.make_aware(datetime.combine(first, time.min), zone),
        timezone.make_aware(datetime.combine(last + timedelta(days=1), time.min), zone),
    )


def _blank():
    return {"orders": 0, **{column: 0 for column in COLUMNS}}


def _shown(row):
    return {"orders": row["orders"], **{column: money(row[column]) for column in COLUMNS}}


def daily(owner, first, last):
    """The business's money for the Accra days first..last, from the journal lines on its own Pending and Available
    accounts (never another holder's: accounts are matched by kind, owner type and id). Newest day first; days when
    nothing moved are left out; `totals` covers the range. `orders` counts the payments into Pending; `released` is what
    moved to Available at release (shown, not part of the identity in FOLD's note)."""
    accounts = [found for found in (account(owner, P), account(owner, A)) if found is not None]
    days = {}
    if accounts:
        start, end = bounds(first, last)
        lines = (
            JournalLine.objects.filter(account__in=accounts, journal__created_at__gte=start, journal__created_at__lt=end)
            .annotate(day=TruncDate("journal__created_at"))
            .values("day", "journal__kind", "account__kind", "side")
            .annotate(total=Sum("amount"), journals=Count("journal", distinct=True))
            .order_by()
        )
        for line in lines:
            row = days.setdefault(line["day"], _blank())
            key = (line["journal__kind"], line["account__kind"], line["side"])
            signed = line["total"] if line["side"] == CR else -line["total"]
            if key in FOLD:
                column, sign = FOLD[key]
                row[column] += sign * line["total"]
            else:
                row["other"] += signed
            row["net_change"] += signed
            if key == ("order_payment", P, CR):
                row["orders"] += line["journals"]
            if key == ("order_release", A, CR):
                row["released"] += line["total"]
    totals = _blank()
    for row in days.values():
        for name in ("orders", *COLUMNS):
            totals[name] += row[name]
    return {
        "from": first, "to": last,
        "days": [{"day": day, **_shown(days[day])} for day in sorted(days, reverse=True)],
        "totals": _shown(totals),
    }
```

- [ ] **Step 5: The view** — append to `backend/wallets/views_vendor.py`

```python
class VendorDailyView(APIView):
    """GET vendor/daily/?date_from=&date_to= — the business's money day by day (Accra days, newest first; the last 30
    by default, at most 92), only days when something moved, and the range's totals: sold (item subtotals paid into
    Pending), fees (platform fees taken at release), released (moved to Available), refunded, free_delivery_promo,
    withdrawn, other and net_change, where sold − fees − refunded − free_delivery_promo − withdrawn + other = net_change."""

    permission_classes = [IsBusinessOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        try:
            first, last = vendor.date_range(request.query_params, default_days=30, max_days=92)
        except vendor.RangeError as exc:
            return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)
        return Response(vendor.daily(request.user, first, last))
```

- [ ] **Step 6: The route** — in `backend/wallets/urls.py` replace

```python
    path("vendor/sales/", views_vendor.VendorSalesView.as_view(), name="wallet-vendor-sales"),
```

with

```python
    path("vendor/sales/", views_vendor.VendorSalesView.as_view(), name="wallet-vendor-sales"),
    path("vendor/daily/", views_vendor.VendorDailyView.as_view(), name="wallet-vendor-daily"),
```

- [ ] **Step 7: Run the tests**

Run: `docker compose -p vend1 run --rm web python manage.py test wallets.tests.test_vendor_daily wallets.tests.test_vendor_sales --noinput`
Expected: PASS (7 new tests; Task 1's 17 unchanged).

- [ ] **Step 8: Commit**

```bash
git add backend/wallets/vendor.py backend/wallets/views_vendor.py backend/wallets/urls.py backend/wallets/tests/test_vendor_daily.py
git commit -m "feat(wallets): vendor daily summary from its own ledger lines - columns add up to the balance change, Accra days" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 3: The statement export

**Files:**
- Modify: `backend/wallets/vendor.py`, `backend/wallets/views_vendor.py`, `backend/wallets/urls.py`
- Create: `backend/wallets/tests/test_vendor_statement.py`

**Interfaces:**
- Consumes: Task 1 (`sale_groups`, `rows`, statuses), Task 2 (`date_range`, `bounds`), `wallets.models.Withdrawal`, `otp.identity.ref(account) -> (account_type, id)`, `wallets.tests.helpers.destination(holder, *, name=...)`.
- Produces:
  - `vendor.STATEMENT_HEADER` (10 column names), `vendor.SALE_STATEMENT_STATUS`, `vendor.WITHDRAWAL_STATEMENT_STATUS`
  - `vendor.statement(owner, first, last) -> list[list[str]]` (rows without the header, oldest first)
  - `views_vendor.VendorStatementExportView`; URL `wallet-vendor-statement-export`

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_vendor_statement.py`

```python
"""The business's statement as a CSV (vendor plan 4, Task 3): each sale with the platform fee shown separately and its
status, and each withdrawal. Review Focus 1 (its own rows, no customer detail, no free text) and 4 (ranges)."""
import csv
import io
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from ledger import refunds
from ledger.models import Account
from orders.models import Order
from wallets import vendor
from wallets.models import PayoutDestination, Withdrawal

from .helpers import destination
from .vendor_helpers import VendorBase, paid_order, release, signed_in

EXPORT = "/api/wallet/vendor/statement/export/"


def csv_rows(response):
    return list(csv.reader(io.StringIO(response.content.decode("utf-8"))))


def withdrawal(shop, request_id, amount, charge, status):
    """A withdrawal made directly (the engine is tested in 3b), to the business's one payout destination (made once: a
    holder has at most one live destination per number)."""
    payee = (
        PayoutDestination.objects.filter(holder_type="business_owner", holder_id=shop.owner.pk).first()
        or destination(shop.owner, name=shop.owner.full_name)
    )
    return Withdrawal.objects.create(
        holder_type="business_owner", holder_id=shop.owner.pk, source_kind=Account.VENDOR_AVAILABLE,
        destination=payee, request_id=request_id,
        amount_pesewas=amount, charge_pesewas=charge, net_pesewas=amount - charge, status=status, provider="simulated",
    )


class LedgerOffTests(VendorBase):
    def test_review_focus_the_export_says_ledger_off(self):
        response = self.kofi.get(EXPORT)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))


@override_settings(LEDGER_ENABLED=True)
class StatementExportTests(VendorBase):
    def test_sales_in_every_state_and_withdrawals_oldest_first(self):
        waiting = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        released = paid_order(self.buyer, [(self.kofi.listing("600.00"), 1)])
        release(released)
        refunded = paid_order(self.buyer, [(self.kofi.listing("50.00"), 1)])
        refunds.refund_order(refunded, source="cancel")
        paid_out = withdrawal(self.kofi, "req-0001", 5000, 100, Withdrawal.SUCCEEDED)
        returned = withdrawal(self.kofi, "req-0002", 2000, 0, Withdrawal.FAILED)
        response = self.kofi.get(EXPORT)
        self.assertEqual((response.status_code, response["Content-Type"]), (200, "text/csv"))
        today = timezone.localdate()
        self.assertIn(
            f'filename="ashantihub-statement-{(today - timedelta(days=29)).isoformat()}-to-{today.isoformat()}.csv"',
            response["Content-Disposition"],
        )
        rows = csv_rows(response)
        self.assertEqual(rows[0], vendor.STATEMENT_HEADER)
        day = today.isoformat()
        self.assertEqual(rows[1:], [
            [day, "Sale", f"Order #{waiting.pk}", "120.00", "5.00", "0.00", "0.00", "", "115.00", "Pending"],
            [day, "Sale", f"Order #{released.pk}", "600.00", "6.00", "0.00", "0.00", "", "594.00", "Available"],
            [day, "Sale", f"Order #{refunded.pk}", "50.00", "0.00", "0.00", "50.00", "", "0.00", "Refunded"],
            [day, "Withdrawal", paid_out.reference, "50.00", "", "", "", "1.00", "49.00", "Withdrawn"],
            [day, "Withdrawal", returned.reference, "20.00", "", "", "", "0.00", "20.00", "Returned to Available"],
        ])

    def test_review_focus_only_the_businesss_own_rows_and_no_free_text(self):
        shared = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1), (self.esi.listing("600.00"), 1)])
        withdrawal(self.esi, "req-esi-1", 5000, 100, Withdrawal.SUCCEEDED)
        response = self.kofi.get(EXPORT)
        self.assertEqual([row[2] for row in csv_rows(response)[1:]], [f"Order #{shared.pk}"])
        text = response.content.decode("utf-8")
        for detail in ("Ama Buyer", "241110001", "Kejetia", "item 1", "600.00", "AH-WD-"):
            self.assertNotIn(detail, text)

    def test_the_range_picks_sales_by_purchase_day_and_withdrawals_by_request_day(self):
        old = paid_order(self.buyer, [(self.kofi.listing("80.00"), 1)])
        Order.objects.filter(pk=old.pk).update(placed_at=timezone.now() - timedelta(days=40))
        old_withdrawal = withdrawal(self.kofi, "req-old", 3000, 0, Withdrawal.SUCCEEDED)
        Withdrawal.objects.filter(pk=old_withdrawal.pk).update(created_at=timezone.now() - timedelta(days=40))
        new = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        self.assertEqual([row[2] for row in csv_rows(self.kofi.get(EXPORT))[1:]], [f"Order #{new.pk}"])
        then = (timezone.localdate() - timedelta(days=40)).isoformat()
        rows = csv_rows(self.kofi.get(EXPORT, {"date_from": then, "date_to": then}))[1:]
        self.assertEqual([row[2] for row in rows], [f"Order #{old.pk}", old_withdrawal.reference])

    def test_review_focus_bad_ranges_are_refused(self):
        for params in (
            {"date_from": "2025-01-01", "date_to": "2026-10-16"}, {"date_to": "16-10-2026"},
            {"date_from": "2026-10-10", "date_to": "2026-10-01"},
        ):
            self.assertEqual(self.kofi.get(EXPORT, params).status_code, 400, params)

    def test_a_customer_with_the_same_id_gets_no_statement(self):
        paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        self.assertEqual(signed_in(self.twin(), "customer").get(EXPORT).status_code, 403)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p vend1 run --rm web python manage.py test wallets.tests.test_vendor_statement --noinput`
Expected: ERROR — `AttributeError: module 'wallets.vendor' has no attribute 'STATEMENT_HEADER'`.

- [ ] **Step 3: The imports** — in `backend/wallets/vendor.py` replace

```python
from orders.models import Order, OrderItem

from .services import money
```

with

```python
from orders.models import Order, OrderItem
from otp.identity import ref

from .models import Withdrawal
from .services import money
```

- [ ] **Step 4: The statement** — append to `backend/wallets/vendor.py`

```python
# --- the statement (Task 3) ----------------------------------------------------------------------------------------

STATEMENT_HEADER = [
    "Date", "Type", "Reference", "Gross (GHS)", "Platform fee (GHS)", "Free-delivery promo (GHS)", "Refunded (GHS)",
    "Withdrawal charge (GHS)", "Amount (GHS)", "Status",
]
SALE_STATEMENT_STATUS = {AWAITING: "Pending", RELEASED: "Available", REFUNDED: "Refunded"}
WITHDRAWAL_STATEMENT_STATUS = {
    Withdrawal.PENDING: "Withdrawal in progress", Withdrawal.PROCESSING: "Withdrawal in progress",
    Withdrawal.SUCCEEDED: "Withdrawn", Withdrawal.FAILED: "Returned to Available", Withdrawal.CANCELLED: "Returned to Available",
}


def statement(owner, first, last):
    """The business's statement for the Accra days first..last, oldest first (spec §6, the transactions page's export):
    each sale bought on those days (gross, the platform fee shown separately, the free-delivery promo, what was refunded,
    the amount due or paid, and Pending / Available / Refunded) and each withdrawal asked for on them (what left
    Available, the provider's charge, what arrived; Withdrawn, in progress or returned). Every cell is a date, a number,
    a fixed word or an AshantiHub reference - no item name, note or person - so a spreadsheet never runs a formula from it."""
    entries = []
    for row in rows(owner, sale_groups(owner, date_from=first, date_to=last)):
        entries.append((row["placed_at"], 0, row["order"], [
            timezone.localdate(row["placed_at"]).isoformat(), "Sale", row["reference"], row["item_subtotal"],
            row["platform_fee"], row["free_delivery_promo"], row["refunded"], "", row["net"],
            SALE_STATEMENT_STATUS[row["status"]],
        ]))
    holder_type, holder_id = ref(owner)
    start, end = bounds(first, last)
    for withdrawal in Withdrawal.objects.filter(
        holder_type=holder_type, holder_id=holder_id, created_at__gte=start, created_at__lt=end,
    ):
        entries.append((withdrawal.created_at, 1, withdrawal.pk, [
            timezone.localdate(withdrawal.created_at).isoformat(), "Withdrawal", withdrawal.reference,
            money(withdrawal.amount_pesewas), "", "", "", money(withdrawal.charge_pesewas), money(withdrawal.net_pesewas),
            WITHDRAWAL_STATEMENT_STATUS[withdrawal.status],
        ]))
    entries.sort(key=lambda entry: entry[:3])
    return [entry[3] for entry in entries]
```

- [ ] **Step 5: The view** — in `backend/wallets/views_vendor.py` replace

```python
from rest_framework import status
from rest_framework.response import Response
```

with

```python
import csv

from django.http import HttpResponse
from rest_framework import status
from rest_framework.response import Response
```

and append

```python
class VendorStatementExportView(APIView):
    """GET vendor/statement/export/?date_from=&date_to= — the statement as a CSV download (the last 30 days by default,
    at most 366). Always CSV: it takes no ?format=, which is DRF's renderer override (backend/CLAUDE.md)."""

    permission_classes = [IsBusinessOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        try:
            first, last = vendor.date_range(request.query_params, default_days=30, max_days=366)
        except vendor.RangeError as exc:
            return Response(exc.body(), status=status.HTTP_400_BAD_REQUEST)
        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = f'attachment; filename="ashantihub-statement-{first.isoformat()}-to-{last.isoformat()}.csv"'
        writer = csv.writer(response)
        writer.writerow(vendor.STATEMENT_HEADER)
        writer.writerows(vendor.statement(request.user, first, last))
        return response
```

- [ ] **Step 6: The route** — in `backend/wallets/urls.py` replace

```python
    path("vendor/daily/", views_vendor.VendorDailyView.as_view(), name="wallet-vendor-daily"),
```

with

```python
    path("vendor/daily/", views_vendor.VendorDailyView.as_view(), name="wallet-vendor-daily"),
    path("vendor/statement/export/", views_vendor.VendorStatementExportView.as_view(), name="wallet-vendor-statement-export"),
```

- [ ] **Step 7: Run the tests**

Run: `docker compose -p vend1 run --rm web python manage.py test wallets.tests.test_vendor_statement wallets.tests.test_vendor_sales --noinput`
Expected: PASS (6 new tests; Task 1's unchanged).

- [ ] **Step 8: Commit**

```bash
git add backend/wallets/vendor.py backend/wallets/views_vendor.py backend/wallets/urls.py backend/wallets/tests/test_vendor_statement.py
git commit -m "feat(wallets): vendor statement CSV - sales with the platform fee shown separately, withdrawals, no free text" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 4: Fee transparency for the business

**Files:**
- Modify: `backend/wallets/vendor.py`, `backend/wallets/views_vendor.py`, `backend/wallets/urls.py`
- Create: `backend/wallets/tests/test_vendor_fees.py`

**Interfaces:**
- Consumes: Task 1 (`fee_cap`, `money`), `ledger.fees.rule_set_in_force(category, at)`, `fees.quote(category, base, *, cap, already_charged, at) -> FeeQuote(rule_set_id, base, computed, charged)`, `fees.charged_to_date(owner)`, `fees.FeeError`, `ledger.models.FeeRuleSet` (`CATEGORY_CHOICES`, `PRODUCT`, `SERVICE`, `EVENT`) / `FeeBand`, `wallets.views.parse_amount(raw) -> pesewas` / `AmountError`.
- Produces:
  - `vendor.APPLIES_TO`, `vendor.CHARGED = (FeeRuleSet.PRODUCT,)`, `vendor.FEE_BASE`
  - `vendor.band_row(band) -> {from, to, percent, flat, fee}`; `vendor.fee_schedule(owner, now=None) -> {categories, fee_base, fee_cap}`; `vendor.fee_quote(owner, category, amount, now=None) -> {category, amount, fee, you_receive, charged}` (raises `fees.FeeError`)
  - `views_vendor.VendorFeesView`; URL `wallet-vendor-fees`

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_vendor_fees.py`

```python
"""The platform fees a business pays, as it sees them (vendor plan 4, Task 4): the approved tiers in force, the next
approved change, the cap, and a server-side quote. Review Focus 1 (customers and staff never see them)."""
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from ledger.models import FeeBand, FeeRuleSet, MoneySetting

from .vendor_helpers import VendorBase, paid_order, signed_in

FEES = "/api/wallet/vendor/fees/"
PRODUCT_LADDER = [
    {"from": "0.00", "to": "99.99", "percent": "1", "flat": None, "fee": "1%"},
    {"from": "100.00", "to": "499.99", "percent": None, "flat": "5.00", "fee": "GH₵ 5.00 flat"},
    {"from": "500.00", "to": "49999.99", "percent": "1", "flat": None, "fee": "1%"},
    {"from": "50000.00", "to": None, "percent": None, "flat": "500.00", "fee": "GH₵ 500.00 flat"},
]


class LedgerOffTests(VendorBase):
    def test_review_focus_the_fees_say_ledger_off(self):
        response = self.kofi.get(FEES)
        self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))


@override_settings(LEDGER_ENABLED=True)
class FeeScheduleTests(VendorBase):
    def categories(self, params=None):
        response = self.kofi.get(FEES, params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json(), {category["category"]: category for category in response.json()["categories"]}

    def test_the_tiers_in_force_for_each_category(self):
        body, by_category = self.categories()
        self.assertEqual(list(by_category), ["product", "service", "event"])
        product = by_category["product"]
        self.assertEqual(
            (product["label"], product["applies_to"], product["charged"], product["bands"], product["next"]),
            ("Products", "Product orders", True, PRODUCT_LADDER, None),
        )
        self.assertIsNotNone(product["in_force_from"])
        self.assertEqual((by_category["service"]["charged"], by_category["event"]["charged"]), (False, False))
        self.assertIn("never on delivery", body["fee_base"])
        self.assertEqual(body["fee_cap"], {"limit": None, "used": "0.00", "remaining": None})
        self.assertNotIn("quote", body)

    def test_review_focus_an_approved_change_shows_with_its_start_and_a_proposal_waiting_does_not(self):
        starts = timezone.now() + timedelta(days=7)
        later = FeeRuleSet.objects.create(category=FeeRuleSet.PRODUCT, effective_from=starts)
        FeeBand.objects.create(rule_set=later, lower_pesewas=0, upper_pesewas=None, percent_bp=150)
        accountant = APIClient()
        accountant.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_staff('accountant', 'fees@example.com'))}")
        proposed = accountant.post("/api/ledger/fees/", {
            "category": "service", "bands": [{"lower": 0, "upper": None, "percent_bp": 900, "flat": None}],
        }, format="json")
        self.assertEqual(proposed.status_code, 201, proposed.content)
        body, by_category = self.categories()
        upcoming = by_category["product"]["next"]
        self.assertEqual(upcoming["bands"], [{"from": "0.00", "to": None, "percent": "1.5", "flat": None, "fee": "1.5%"}])
        self.assertEqual(parse_datetime(upcoming["from"]), starts)
        self.assertEqual(by_category["product"]["bands"], PRODUCT_LADDER)                    # still today's ladder
        self.assertIsNone(by_category["service"]["next"])
        self.assertNotIn("9%", str(body))                                                    # a waiting proposal is never shown

    def test_review_focus_a_quote_counts_the_lifetime_cap(self):
        body, _ = self.categories({"amount": "120.00", "category": "product"})
        self.assertEqual(body["quote"], {"category": "product", "amount": "120.00", "fee": "5.00", "you_receive": "115.00", "charged": True})
        MoneySetting.objects.create(key="fee_cap_pesewas", value=700, effective_from=timezone.now() - timedelta(days=1))
        paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])                           # 5.00 of the 7.00 cap used
        body, _ = self.categories({"amount": "120.00"})
        self.assertEqual((body["quote"]["fee"], body["quote"]["you_receive"]), ("2.00", "118.00"))
        self.assertEqual(body["fee_cap"], {"limit": "7.00", "used": "5.00", "remaining": "2.00"})

    def test_bad_quote_input_is_refused(self):
        self.assertIn("amount", self.kofi.get(FEES, {"amount": "abc"}).json())
        self.assertEqual(self.kofi.get(FEES, {"amount": "0"}).status_code, 400)
        response = self.kofi.get(FEES, {"amount": "10", "category": "rides"})
        self.assertEqual((response.status_code, list(response.json())), (400, ["category"]))

    def test_review_focus_customers_and_staff_never_see_the_fees(self):
        support = APIClient()
        support.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_staff('support', 'desk@example.com'))}")
        self.assertEqual(support.get(FEES).status_code, 403)
        self.assertEqual(signed_in(self.buyer, "customer").get(FEES).status_code, 403)
        self.assertEqual(signed_in(self.twin(), "customer").get(FEES, {"amount": "120"}).status_code, 403)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p vend1 run --rm web python manage.py test wallets.tests.test_vendor_fees --noinput`
Expected: FAIL — 404 for `/api/wallet/vendor/fees/`.

- [ ] **Step 3: The imports** — in `backend/wallets/vendor.py` replace

```python
from datetime import datetime, time, timedelta
```

with

```python
from datetime import datetime, time, timedelta
from decimal import Decimal
```

and replace

```python
from ledger.models import Account, FulfilmentCheck, JournalLine, OrderFeeSnapshot
```

with

```python
from ledger.models import Account, FeeRuleSet, FulfilmentCheck, JournalLine, OrderFeeSnapshot
```

- [ ] **Step 4: The schedule** — append to `backend/wallets/vendor.py`

```python
# --- the platform fees, for the business (Task 4) ------------------------------------------------------------------

APPLIES_TO = {FeeRuleSet.PRODUCT: "Product orders", FeeRuleSet.SERVICE: "Services and stays", FeeRuleSet.EVENT: "Event tickets"}
# The categories the ledger charges today: only product orders are recorded until booking sales are (Plan 1b). The
# follow-up that slots them in adds services and events here (spec §13 (lxxi)).
CHARGED = (FeeRuleSet.PRODUCT,)
FEE_BASE = (
    "Worked out per order on your items' total after your own sale prices, never on delivery; a coupon AshantiHub gives "
    "the customer does not change it. It is taken when the money is released to you, and stops once your lifetime cap, "
    "if there is one, is reached."
)


def band_row(band):
    """One tier as the business reads it: GH₵ amounts, the percentage without trailing zeros ("1", "1.5")."""
    if band.percent_bp is not None:
        percent = format(Decimal(band.percent_bp) / 100, "f")
        fee = f"{percent}%"
    else:
        percent, fee = None, f"GH₵ {money(band.flat_pesewas)} flat"
    return {
        "from": money(band.lower_pesewas), "to": money(band.upper_pesewas) if band.upper_pesewas is not None else None,
        "percent": percent, "flat": money(band.flat_pesewas) if band.flat_pesewas is not None else None, "fee": fee,
    }


def fee_schedule(owner, now=None):
    """The approved platform fees for each category: the tiers in force and since when, and the next approved change
    with when it starts (§3.3: it applies only to orders paid after). A proposal still waiting for approval is never
    shown. Plus how the fee is worked out and the business's lifetime cap."""
    now = now or timezone.now()
    categories = []
    for category, label in FeeRuleSet.CATEGORY_CHOICES:
        current = fees.rule_set_in_force(category, now)
        upcoming = FeeRuleSet.objects.filter(category=category, effective_from__gt=now).order_by("effective_from", "id").first()
        categories.append({
            "category": category, "label": label, "applies_to": APPLIES_TO[category], "charged": category in CHARGED,
            "in_force_from": current.effective_from if current is not None else None,
            "bands": [band_row(band) for band in current.bands.all()] if current is not None else [],
            "next": (
                {"from": upcoming.effective_from, "bands": [band_row(band) for band in upcoming.bands.all()]}
                if upcoming is not None else None
            ),
        })
    return {"categories": categories, "fee_base": FEE_BASE, "fee_cap": fee_cap(owner, now)}


def fee_quote(owner, category, amount, now=None):
    """The fee the business would pay on a sale of `amount` pesewas in `category` now, its lifetime cap counted (the
    same ledger.fees.quote the payment uses). Raises fees.FeeError when no rules are in force."""
    now = now or timezone.now()
    quote = fees.quote(
        category, amount, cap=settings_store.current("fee_cap_pesewas", now), already_charged=fees.charged_to_date(owner), at=now,
    )
    return {
        "category": category, "amount": money(amount), "fee": money(quote.charged),
        "you_receive": money(amount - quote.charged), "charged": category in CHARGED,
    }
```

- [ ] **Step 5: The view** — in `backend/wallets/views_vendor.py` replace

```python
from accounts.views import IsBusinessOwner
from ledger import escrow

from . import vendor
from .views import Pagination, ledger_off
```

with

```python
from accounts.views import IsBusinessOwner
from ledger import escrow, fees
from ledger.models import FeeRuleSet

from . import vendor
from .views import AmountError, Pagination, ledger_off, parse_amount
```

and append

```python
class VendorFeesView(APIView):
    """GET vendor/fees/ — the platform fees in force for each category (and the next approved change, with when it
    starts; never a proposal still waiting), how the fee is worked out, and the business's lifetime cap.
    ?amount=&category= (category defaults to product) adds `quote`: the fee on a sale of that amount now, cap counted;
    null when no rules are in force."""

    permission_classes = [IsBusinessOwner]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        body = vendor.fee_schedule(request.user)
        params = request.query_params
        if params.get("amount") is not None or params.get("category") is not None:
            category = params.get("category") or FeeRuleSet.PRODUCT
            if category not in dict(FeeRuleSet.CATEGORY_CHOICES):
                return Response({"category": "Choose product, service or event."}, status=status.HTTP_400_BAD_REQUEST)
            try:
                amount = parse_amount(params.get("amount"))
            except AmountError as exc:
                return Response({"amount": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
            try:
                body["quote"] = vendor.fee_quote(request.user, category, amount)
            except fees.FeeError:
                body["quote"] = None
        return Response(body)
```

- [ ] **Step 6: The route** — in `backend/wallets/urls.py` replace

```python
    path("vendor/statement/export/", views_vendor.VendorStatementExportView.as_view(), name="wallet-vendor-statement-export"),
```

with

```python
    path("vendor/statement/export/", views_vendor.VendorStatementExportView.as_view(), name="wallet-vendor-statement-export"),
    path("vendor/fees/", views_vendor.VendorFeesView.as_view(), name="wallet-vendor-fees"),
```

- [ ] **Step 7: Run the tests**

Run: `docker compose -p vend1 run --rm web python manage.py test wallets.tests.test_vendor_fees wallets.tests.test_vendor_sales --noinput`
Expected: PASS (6 new tests; Task 1's unchanged).

- [ ] **Step 8: Commit**

```bash
git add backend/wallets/vendor.py backend/wallets/views_vendor.py backend/wallets/urls.py backend/wallets/tests/test_vendor_fees.py
git commit -m "feat(wallets): vendor fee transparency - approved tiers in force, the next approved change, cap, server quote; never to customers" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 5: The text outbox — queued, sent after commit, retried, counted by the spend alert

**Files:**
- Modify: `backend/wallets/models.py`, `backend/wallets/tasks.py`, `backend/otp/spend.py`, `backend/staffsecurity/policy.py`, `backend/ashantihub/settings.py`
- Create: `backend/wallets/vendor_texts.py`, `backend/wallets/migrations/0005_vendor_texts.py` (generated), `backend/wallets/tests/test_vendor_texts.py`

**Interfaces:**
- Consumes: `otp.senders.deliver(channel, to, subject, body) -> Delivery(ok, provider, ref)` (never raises), `otp.senders.sms_outbox`, `otp.spend.check_quietly(now)`, `otp.identity.contacts(account) -> {channel: destination}` (`+233…` phones), `otp.models.SMS`, `accounts.phones.mask_phone`, `staffsecurity.policy.set_otp(values, staff)`.
- Produces:
  - models `wallets.VendorText` (`ORDER_PAID`, `ORDER_RELEASED`, `DAILY_DIGEST`; `QUEUED`, `SENT`, `FAILED`, `NO_PHONE`; fields `key` unique, `business_owner`, `kind`, `order`, `day`, `body`, `status`, `attempts`, `next_attempt_at`, `last_attempt_at`, `sent_at`, `provider`, `provider_ref`, `to_hint`, `notification`, `created_at`) and `wallets.VendorPreference` (`business_owner` one-to-one, `daily_digest`, `updated_at`)
  - `wallets.vendor_texts.LEASE`, `BACKOFF`, `MAX_ATTEMPTS`, `MAX_LENGTH`, `fits(body) -> bool`
  - `vendor_texts.queue(owner, kind, key, body, *, order=None, day=None, notification=None, now=None) -> VendorText | None` (never raises)
  - `vendor_texts.deliver(pk, now=None) -> str | None` (the new status, or None when not due / held by another sender)
  - `vendor_texts.send_due(now=None, limit=200) -> int`; `vendor_texts.row(text) -> dict`
  - tasks `wallets.tasks.send_vendor_text(pk)`, `wallets.tasks.send_due_vendor_texts()`; beat entry `wallets-send-vendor-texts`
  - `otp.spend.texts_sent_on(day)` counts code texts plus sent business texts

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_vendor_texts.py`

```python
"""The business money-text outbox (vendor plan 4, Task 5): queued with the money movement, sent after commit through
otp.senders, claimed so it is never sent twice at once, retried, and counted by the SMS-spend alert without touching the
code send limits. Review Focus 2."""
from datetime import timedelta
from unittest import mock

from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone

from accounts.models import BusinessOwner
from accounts.testing import make_staff
from notifications.models import Notification
from otp import senders, spend
from otp.models import SMS, OtpEvent
from staffsecurity import policy
from wallets import vendor_texts
from wallets.models import VendorText

BODY = "AshantiHub: order #12 paid. Items GHS 120.00, platform fee GHS 5.00, due to you GHS 115.00 after delivery and Support's check."
DOWN = senders.Delivery(ok=False, provider="hubtel")


class PlainTextTests(SimpleTestCase):
    def test_only_plain_characters_and_at_most_two_parts(self):
        self.assertTrue(vendor_texts.fits(BODY))
        self.assertTrue(vendor_texts.fits("x" * 306))
        for body in ("", "x" * 307, "GH₵ 5.00 due", "Order — paid", "1 × Kente"):
            self.assertFalse(vendor_texts.fits(body), body)


class OutboxBase(TestCase):
    def setUp(self):
        senders.sms_outbox.clear()
        self.owner = BusinessOwner.objects.create(full_name="Kofi Mensah", login_phone="0201110001", password_hash="x")
        self.now = timezone.now()

    def queue(self, key="paid-12-1", **extra):
        return vendor_texts.queue(self.owner, VendorText.ORDER_PAID, key, BODY, now=self.now, **extra)


class QueueTests(OutboxBase):
    def test_a_text_is_queued_once_per_key_and_sent_after_commit(self):
        with self.captureOnCommitCallbacks(execute=True):
            first = self.queue()
            again = self.queue()
        self.assertEqual(first.pk, again.pk)
        first.refresh_from_db()
        self.assertEqual(
            (first.status, first.attempts, first.provider, first.to_hint),
            (VendorText.SENT, 1, "locmem", "020 *** 0001"),
        )
        self.assertEqual([(text.to, text.body) for text in senders.sms_outbox], [("+233201110001", BODY)])

    def test_nothing_is_sent_before_the_money_movement_commits(self):
        with self.captureOnCommitCallbacks(execute=False) as callbacks:
            text = self.queue()
        self.assertEqual(len(callbacks), 1)
        self.assertEqual(senders.sms_outbox, [])
        self.assertEqual(VendorText.objects.get(pk=text.pk).status, VendorText.QUEUED)

    def test_review_focus_a_text_that_cannot_be_queued_never_raises(self):
        with mock.patch.object(VendorText.objects, "get_or_create", side_effect=RuntimeError("db down")), \
                self.assertLogs("wallets.vendor_texts", "ERROR") as logs:
            self.assertIsNone(self.queue())
        self.assertIn("RuntimeError", "\n".join(logs.output))
        self.assertNotIn("115.00", "\n".join(logs.output))                                  # never the body

    def test_a_body_that_is_not_plain_or_too_long_is_not_queued(self):
        for key, body in (("k-cedi", "GH₵ 5.00 due"), ("k-long", "x" * 307)):
            with self.assertLogs("wallets.vendor_texts", "ERROR"):
                self.assertIsNone(vendor_texts.queue(self.owner, VendorText.ORDER_PAID, key, body, now=self.now))
        self.assertFalse(VendorText.objects.exists())


class DeliverTests(OutboxBase):
    def test_review_focus_a_failed_send_is_retried_with_backoff_then_given_up(self):
        text = self.queue()
        at = self.now
        with mock.patch("wallets.vendor_texts.senders.deliver", return_value=DOWN):
            for attempt, minutes in enumerate((5, 15, 60, 240), start=1):
                self.assertEqual(vendor_texts.deliver(text.pk, at), VendorText.QUEUED)
                text.refresh_from_db()
                self.assertEqual((text.attempts, text.next_attempt_at), (attempt, at + timedelta(minutes=minutes)))
                self.assertIsNone(vendor_texts.deliver(text.pk, at + timedelta(minutes=minutes - 1)))   # not due yet
                at += timedelta(minutes=minutes)
            self.assertEqual(vendor_texts.deliver(text.pk, at), VendorText.FAILED)
        text.refresh_from_db()
        self.assertEqual((text.status, text.attempts, text.provider), (VendorText.FAILED, 5, "hubtel"))
        self.assertIsNone(vendor_texts.deliver(text.pk, at + timedelta(days=1)))                      # final

    def test_review_focus_no_usable_phone_is_final_and_the_in_app_copy_stays(self):
        BusinessOwner.objects.filter(pk=self.owner.pk).update(login_phone="+44 20 7946 0000")
        notice = Notification.objects.create(business_owner=self.owner, kind="vendor_money", title="Order #12 released", body=BODY)
        with self.captureOnCommitCallbacks(execute=True):
            text = self.queue(notification=notice)
        text.refresh_from_db()
        self.assertEqual((text.status, text.notification_id), (VendorText.NO_PHONE, notice.pk))
        self.assertEqual(senders.sms_outbox, [])
        self.assertIsNone(vendor_texts.deliver(text.pk, self.now + timedelta(days=1)))

    def test_review_focus_a_send_in_progress_is_not_picked_up_again(self):
        text = self.queue()
        second = []

        def provider(*args):
            second.append(vendor_texts.deliver(text.pk, self.now))                  # another worker, mid-send
            return senders.Delivery(ok=True, provider="locmem")

        with mock.patch("wallets.vendor_texts.senders.deliver", side_effect=provider):
            self.assertEqual(vendor_texts.deliver(text.pk, self.now), VendorText.SENT)
        self.assertEqual(second, [None])
        self.assertIsNone(vendor_texts.deliver(text.pk, self.now + timedelta(hours=1)))  # sent: never again

    def test_a_crashed_send_is_tried_again_after_the_lease(self):
        text = self.queue()
        # Claimed by a worker that then died: attempts counted, next try pushed out by the lease.
        VendorText.objects.filter(pk=text.pk).update(attempts=1, next_attempt_at=self.now + vendor_texts.LEASE)
        self.assertIsNone(vendor_texts.deliver(text.pk, self.now + timedelta(minutes=9)))
        self.assertEqual(vendor_texts.deliver(text.pk, self.now + vendor_texts.LEASE), VendorText.SENT)
        self.assertEqual(VendorText.objects.get(pk=text.pk).attempts, 2)

    def test_the_job_sends_what_is_due_and_one_bad_row_never_stops_the_rest(self):
        broken = self.queue("k-broken")
        fine = self.queue("k-fine")
        real = vendor_texts.deliver

        def flaky(pk, now=None):
            if pk == broken.pk:
                raise RuntimeError("boom")
            return real(pk, now)

        with mock.patch("wallets.vendor_texts.deliver", side_effect=flaky), self.assertLogs("wallets.vendor_texts", "ERROR"):
            self.assertEqual(vendor_texts.send_due(self.now), 1)
        self.assertEqual(VendorText.objects.get(pk=fine.pk).status, VendorText.SENT)
        self.assertEqual(VendorText.objects.get(pk=broken.pk).status, VendorText.QUEUED)

    @override_settings(OTP_SMS_PROVIDER="simulated")
    def test_a_simulated_text_says_it_was_not_sent(self):
        text = self.queue()
        self.assertEqual(vendor_texts.deliver(text.pk, self.now), VendorText.SENT)
        text.refresh_from_db()
        self.assertEqual((text.provider, vendor_texts.row(text)["status_label"]), ("simulated", "Not sent: texts are simulated"))


class SpendTests(OutboxBase):
    def setUp(self):
        super().setUp()
        self.boss = make_staff("super_admin", "boss@example.com")
        policy.set_otp({"otp_sms_daily_alert": 3}, self.boss)

    def test_review_focus_business_texts_count_toward_the_sms_spend_alert(self):
        OtpEvent.objects.create(kind=OtpEvent.SENT, channel=SMS, at=self.now, provider="locmem")   # one code text
        for key in ("k-1", "k-2"):
            vendor_texts.deliver(self.queue(key).pk, self.now)
        self.assertEqual(spend.texts_sent_on(timezone.localdate(self.now)), 3)
        alert = Notification.objects.get(staff=self.boss, kind=spend.ALERT_KIND)
        self.assertIn("3", alert.title)
        self.assertIn("business money texts", alert.body)

    def test_review_focus_business_texts_never_use_up_the_code_send_limits(self):
        for n in range(25):                                                       # more than the 20-an-hour per-phone ceiling
            vendor_texts.deliver(self.queue(f"k-{n}").pk, self.now)
        self.assertEqual(VendorText.objects.filter(status=VendorText.SENT).count(), 25)
        self.assertFalse(OtpEvent.objects.filter(kind__in=(OtpEvent.SENT, OtpEvent.SEND_FAILED)).exists())
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p vend1 run --rm web python manage.py test wallets.tests.test_vendor_texts --noinput`
Expected: ERROR — `ImportError: cannot import name 'vendor_texts' from 'wallets'`.

- [ ] **Step 3: The models** — append to `backend/wallets/models.py`

```python


class VendorText(models.Model):
    """A text to a business about its money (spec §6; vendor plan 4): one per paid order and business, one per release
    and business, one daily digest. Queued in the transaction that moved the money (so it exists only if that committed),
    sent after commit through otp.senders and retried by wallets.tasks.send_due_vendor_texts. Holds no customer's name,
    phone or address and never the business's whole number (`to_hint` is masked). `notification` is the in-app copy,
    kept even when the text could not be sent."""

    ORDER_PAID, ORDER_RELEASED, DAILY_DIGEST = "order_paid", "order_released", "daily_digest"
    KIND_CHOICES = [(ORDER_PAID, "Order paid"), (ORDER_RELEASED, "Order released"), (DAILY_DIGEST, "Daily digest")]
    QUEUED, SENT, FAILED, NO_PHONE = "queued", "sent", "failed", "no_phone"
    STATUS_CHOICES = [(QUEUED, "Waiting to send"), (SENT, "Sent"), (FAILED, "Could not be sent"), (NO_PHONE, "No number to text")]

    key = models.CharField(max_length=80, unique=True)       # paid-<order>-<owner>, released-<order>-<owner>, digest-<owner>-<day>
    business_owner = models.ForeignKey("accounts.BusinessOwner", on_delete=models.CASCADE, related_name="vendor_texts")
    kind = models.CharField(max_length=16, choices=KIND_CHOICES)
    order = models.ForeignKey("orders.Order", null=True, blank=True, on_delete=models.PROTECT, related_name="+")
    day = models.DateField(null=True, blank=True)
    body = models.CharField(max_length=320)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=QUEUED)
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField()
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    provider = models.CharField(max_length=20, blank=True, default="")
    provider_ref = models.CharField(max_length=64, blank=True, default="")
    to_hint = models.CharField(max_length=20, blank=True, default="")   # "020 *** 0001": never the whole number
    notification = models.ForeignKey("notifications.Notification", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["status", "next_attempt_at"]),
            models.Index(fields=["business_owner", "created_at"]),
            models.Index(fields=["status", "sent_at"]),
        ]

    def __str__(self):
        return f"{self.kind} text to business {self.business_owner_id}: {self.status}"


class VendorPreference(models.Model):
    """What a business chose about its money texts. Order and release texts always go (spec §6: "SMS on every paid
    order"); the daily digest is optional and off until the business turns it on."""

    business_owner = models.OneToOneField("accounts.BusinessOwner", on_delete=models.CASCADE, related_name="vendor_preference")
    daily_digest = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Texts for business {self.business_owner_id}: digest {'on' if self.daily_digest else 'off'}"
```

- [ ] **Step 4: Generate the migration**

Run: `docker compose -p vend1 run --rm web python manage.py makemigrations wallets --name vendor_texts`
Expected: `wallets/migrations/0005_vendor_texts.py` with `Create model VendorPreference`, `Create model VendorText` and its three indexes.

- [ ] **Step 5: The outbox** — create `backend/wallets/vendor_texts.py`

```python
"""Texts to a business about its money (spec §6; vendor plan 4): an outbox, so a text can never stop the payment or
release that asked for it ("SMS failure never blocks payment (queued, retried)").

* `queue` writes one VendorText (idempotent on its key) inside the caller's transaction, in a savepoint, and never
  raises; the send waits for the commit (`transaction.on_commit`, robust), so a rolled-back payment texts nobody.
* `deliver` sends one due text through otp.senders (the one door for texts: simulated / locmem / Hubtel), outside any
  transaction. It claims the row first with one conditional UPDATE that also pushes `next_attempt_at` out by LEASE, so
  two workers never send it at once; a worker that dies mid-send leaves it to be tried again after the lease (a text may
  then go twice: at least once, never lost). A failure is retried after 5 minutes, 15 minutes, 1 hour and 4 hours, then
  given up (FAILED); a business with no usable Ghana mobile number gets none (NO_PHONE). The in-app copy stays either way.
* A sent text is counted by the SMS-spend alert (otp.spend, spec §9) with the code texts. It is never an OtpEvent: those
  rows are what the code send limits count, and a busy shop's order texts must never use up its own sign-in codes.
* Bodies are plain GSM-7 characters ("GHS", never "GH₵", which would make every text cost about three times as much), at
  most two text parts (306 characters), and hold no customer's name, phone or address. Never logged."""
import logging
import string
from datetime import timedelta
from functools import partial

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from accounts.phones import mask_phone
from otp import senders, spend
from otp.identity import contacts
from otp.models import SMS

from .models import VendorText

logger = logging.getLogger(__name__)

LEASE = timedelta(minutes=10)
BACKOFF = (timedelta(minutes=5), timedelta(minutes=15), timedelta(hours=1), timedelta(hours=4))
MAX_ATTEMPTS = len(BACKOFF) + 1
MAX_LENGTH = 306                                            # two GSM-7 parts of 153 characters
PLAIN = frozenset(string.ascii_letters + string.digits + " .,:;#'()-/!?&%+")
STATUS_LABELS = {
    VendorText.QUEUED: "Waiting to send", VendorText.SENT: "Sent", VendorText.FAILED: "Could not be sent",
    VendorText.NO_PHONE: "Not sent: no Ghana mobile number on your account",
}
SIMULATED_LABEL = "Not sent: texts are simulated"


def fits(body):
    """True for a body that is plain GSM-7 characters and at most two text parts."""
    return bool(body) and len(body) <= MAX_LENGTH and all(char in PLAIN for char in body)


def queue(owner, kind, key, body, *, order=None, day=None, notification=None, now=None):
    """Queue one text to the business (once per `key`) and send it once the caller's transaction commits. Returns the
    VendorText, or None when it could not be queued (logged by type only). Never raises."""
    now = now or timezone.now()
    try:
        if not fits(body):
            raise ValueError("A business text must be plain characters, two parts at most")
        with transaction.atomic():  # a savepoint: a failure here must not break the caller's transaction
            text, created = VendorText.objects.get_or_create(key=key, defaults={
                "business_owner": owner, "kind": kind, "order": order, "day": day, "body": body,
                "next_attempt_at": now, "notification": notification,
            })
    except Exception as exc:  # noqa: BLE001 - spec §6: a text never blocks the money movement that asked for it
        logger.error("Business text %s not queued: %s", kind, type(exc).__name__)
        return None
    if created:
        transaction.on_commit(partial(_send_soon, text.pk), robust=True)
    return text


def _send_soon(pk):
    from .tasks import send_vendor_text

    send_vendor_text.delay(pk)


def deliver(pk, now=None):
    """Send text `pk` if it is queued and due. Returns its new status, or None when it was not due or another sender
    holds it. Call outside any transaction: a real provider's call is a network round trip."""
    now = now or timezone.now()
    claimed = VendorText.objects.filter(pk=pk, status=VendorText.QUEUED, next_attempt_at__lte=now).update(
        attempts=F("attempts") + 1, last_attempt_at=now, next_attempt_at=now + LEASE,
    )
    if not claimed:
        return None
    text = VendorText.objects.select_related("business_owner").get(pk=pk)
    phone = contacts(text.business_owner).get(SMS)
    if not phone:
        VendorText.objects.filter(pk=pk).update(status=VendorText.NO_PHONE)
        return VendorText.NO_PHONE
    delivery = senders.deliver(SMS, phone, "", text.body)
    hint, provider = mask_phone(phone), (delivery.provider or "")[:20]
    if delivery.ok:
        VendorText.objects.filter(pk=pk).update(
            status=VendorText.SENT, sent_at=now, provider=provider, provider_ref=(delivery.ref or "")[:64], to_hint=hint,
        )
        spend.check_quietly(now)
        return VendorText.SENT
    if text.attempts >= MAX_ATTEMPTS:
        VendorText.objects.filter(pk=pk).update(status=VendorText.FAILED, provider=provider, to_hint=hint)
        return VendorText.FAILED
    VendorText.objects.filter(pk=pk).update(next_attempt_at=now + BACKOFF[text.attempts - 1], provider=provider, to_hint=hint)
    return VendorText.QUEUED


def send_due(now=None, limit=200):
    """Send the texts that are due, oldest first: first tries whose send after commit was lost, and retries. One text
    that raises is logged and skipped. Returns how many were sent."""
    now = now or timezone.now()
    due = list(
        VendorText.objects.filter(status=VendorText.QUEUED, next_attempt_at__lte=now)
        .order_by("next_attempt_at", "pk").values_list("pk", flat=True)[:limit]
    )
    sent = 0
    for pk in due:
        try:
            sent += deliver(pk, now) == VendorText.SENT
        except Exception as exc:  # noqa: BLE001 - one bad row never stops the rest
            logger.error("Business text %s not sent: %s", pk, type(exc).__name__)
    return sent


def row(text):
    """A text as its business sees it. A text the simulated provider "sent" says it was not sent."""
    simulated = text.status == VendorText.SENT and text.provider == "simulated"
    return {
        "id": text.pk, "kind": text.kind, "order": text.order_id, "day": text.day, "body": text.body,
        "status": text.status, "status_label": SIMULATED_LABEL if simulated else STATUS_LABELS[text.status],
        "to": text.to_hint, "created_at": text.created_at, "sent_at": text.sent_at,
    }
```

- [ ] **Step 6: The jobs** — in `backend/wallets/tasks.py` replace

```python
from . import payouts
```

with

```python
from . import payouts, vendor_texts
```

and append

```python
@shared_task
def send_vendor_text(pk):
    """Send one business money text right after the payment or release that queued it committed."""
    return vendor_texts.deliver(pk)


@shared_task
def send_due_vendor_texts():
    """Every 5 minutes: business money texts not sent yet (a first try lost after commit, or a retry). Runs whatever
    LEDGER_ENABLED says now: a text exists only if the ledger was on when it was queued, and a business told of a sale
    should hear of it. The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    return vendor_texts.send_due()
```

and in `backend/ashantihub/settings.py` replace

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
    "wallets-send-vendor-texts": {
        "task": "wallets.tasks.send_due_vendor_texts",
        "schedule": 300.0,  # every 5 minutes: business money texts not sent yet (spec §6: queued, retried)
    },
}
```

- [ ] **Step 7: One spend alert for every text** — in `backend/otp/spend.py` (a) replace

```python
"""The SMS-spend alert (spec §9). OTP texts are counted per day from the audit trail; the first check that finds
today's count at the threshold Super Admin set (staffsecurity.policy.otp_sms_daily_alert, default 500) tells
everyone holding security.manage, once a day. Nothing is blocked: the alert is for a person to look at."""
```

with

```python
"""The SMS-spend alert (spec §9). Every text AshantiHub pays for is counted per day: code texts from the OTP audit trail
and business money texts from wallets.VendorText (spec §6; vendor plan 4). The first check that finds today's count at
the threshold Super Admin set (staffsecurity.policy.otp_sms_daily_alert, default 500) tells everyone holding
security.manage, once a day. Nothing is blocked: the alert is for a person to look at."""
```

(b) replace

```python
def texts_sent_on(day):
    return OtpEvent.objects.filter(kind=OtpEvent.SENT, channel=SMS, at__date=day).count()
```

with

```python
def texts_sent_on(day):
    """Code texts plus business money texts sent on `day`. Business texts are never OtpEvents (the code send limits
    count those), so they are counted from their own outbox."""
    from wallets.models import VendorText

    codes = OtpEvent.objects.filter(kind=OtpEvent.SENT, channel=SMS, at__date=day).count()
    return codes + VendorText.objects.filter(status=VendorText.SENT, sent_at__date=day).count()
```

and (c) replace

```python
        "security.manage", ALERT_KIND, f"One-time-code texts reached {threshold} today",
        body=(
            f"{sent} code texts have been sent today ({day:%d %b}). A sudden rise can mean someone is abusing the "
            "code requests. Look at the code log and the text balance."
        ),
```

with

```python
        "security.manage", ALERT_KIND, f"Texts reached {threshold} today",
        body=(
            f"{sent} texts have been sent today ({day:%d %b}), one-time codes and business money texts together. A "
            "sudden rise can mean someone is abusing the code requests. Look at the code log and the text balance."
        ),
```

and in `backend/staffsecurity/policy.py` replace

```python
    "otp_sms_daily_alert": "Code texts a day before Super Admin is alerted",
```

with

```python
    "otp_sms_daily_alert": "Texts a day (codes and business money texts) before Super Admin is alerted",
```

- [ ] **Step 8: Run the tests**

Run: `docker compose -p vend1 run --rm web python manage.py test wallets.tests.test_vendor_texts otp.tests.test_senders --noinput`
Expected: PASS (13 new tests; `otp.tests.test_senders` unchanged — its alert test checks only the threshold in the title).

- [ ] **Step 9: Commit**

```bash
git add backend/wallets/models.py backend/wallets/migrations/0005_vendor_texts.py backend/wallets/vendor_texts.py backend/wallets/tasks.py backend/wallets/tests/test_vendor_texts.py backend/otp/spend.py backend/staffsecurity/policy.py backend/ashantihub/settings.py
git commit -m "feat(wallets): business money-text outbox - queued in a savepoint, sent after commit, leased claim, retried, counted by the SMS-spend alert" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 6: A text on every paid order and on every release

**Files:**
- Modify: `backend/wallets/vendor_texts.py`, `backend/orders/alerts.py`, `backend/ledger/escrow.py`
- Create: `backend/wallets/tests/test_vendor_text_wiring.py`

**Interfaces:**
- Consumes: Task 5 (`queue`, `VendorText`), `ledger.escrow` (`enabled`, `pay_key`, `release_key`, `waiver_key`), `ledger.models.Journal` / `JournalLine` / `OrderFeeSnapshot` / `Account`, `marketing.models_waivers.WaivedFeeCharge`, `notifications.services.notify_business_owner(owner, kind, title, body=, link=, icon=)`, `wallets.services.money`.
- Produces:
  - `vendor_texts.VENDOR_MONEY = "vendor_money"` (the in-app kind of release and digest copies), `vendor_texts.OWNER_TYPE`
  - `vendor_texts.Amounts(subtotal, fee, promo)` with `.due`; `paid_amounts(order) -> {owner pk: Amounts}` (never raises)
  - `paid_key(order, owner)`, `released_key(order, owner)`, `paid_text(order, amounts)`, `paid_line(amounts)`, `released_text(order, released, fee, promo)`
  - `order_released(order) -> int` (never raises), called at the end of `escrow.release_verified`
  - `orders.alerts.alert_owners_of_paid_order(order)`: with the ledger on, the notice carries `paid_line` and a paid text is queued

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_vendor_text_wiring.py`

```python
"""Texts to each business when an order is paid and when it is released, through the real checkout and Support's call
(vendor plan 4, Task 6). Review Focus 1 (each business its own, no customer detail, the fee never to the customer), 2 (a
text never stops the money) and 5 (ledger off)."""
from unittest import mock

from django.test import override_settings

from ledger import escrow, posting
from ledger.models import Account, Journal
from notifications.models import Notification
from orders.models import Order
from otp import senders
from wallets.models import VendorText

from .vendor_helpers import VendorBase, paid_order, release, signed_in, waived

DOWN = senders.Delivery(ok=False, provider="hubtel")


def paid_body(order_id, items, fee, due):
    return (f"AshantiHub: order #{order_id} paid. Items GHS {items}, platform fee GHS {fee}, due to you GHS {due} after "
            "delivery and Support's check.")


class CheckoutBase(VendorBase):
    def setUp(self):
        super().setUp()
        self.kofi_item = self.kofi.listing("120.00")
        self.esi_item = self.esi.listing("600.00")
        self.shopper = signed_in(self.buyer, "customer")

    def checkout(self, *lines):
        for listing, quantity in lines:
            added = self.shopper.post("/api/cart/items/", {"listing": listing.id, "quantity": quantity}, format="json")
            self.assertIn(added.status_code, (200, 201), added.content)
        with self.captureOnCommitCallbacks(execute=True):
            response = self.shopper.post("/api/orders/checkout/", {}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response


class LedgerOffTests(CheckoutBase):
    def test_review_focus_with_the_ledger_off_nothing_is_texted_and_the_notice_is_as_before(self):
        self.checkout((self.kofi_item, 1))
        self.assertEqual(senders.sms_outbox, [])
        self.assertFalse(VendorText.objects.exists())
        self.assertNotIn("Platform fee", Notification.objects.get(business_owner=self.kofi.owner).body)


@override_settings(LEDGER_ENABLED=True)
class PaidTextTests(CheckoutBase):
    def test_review_focus_each_business_is_texted_its_own_subtotal_fee_and_amount_due(self):
        order_id = self.checkout((self.kofi_item, 1), (self.esi_item, 1)).json()["id"]
        self.assertEqual(sorted((text.to, text.body) for text in senders.sms_outbox), [
            ("+233201110001", paid_body(order_id, "120.00", "5.00", "115.00")),
            ("+233201110002", paid_body(order_id, "600.00", "6.00", "594.00")),
        ])
        for text in senders.sms_outbox:
            for detail in ("Ama Buyer", "241110001"):
                self.assertNotIn(detail, text.body)

    def test_the_new_order_notice_is_the_in_app_copy(self):
        self.checkout((self.kofi_item, 1))
        notice = Notification.objects.get(business_owner=self.kofi.owner)                       # one notice, not two
        self.assertEqual(notice.kind, Notification.NEW_ORDER)
        self.assertIn("Platform fee GHS 5.00; due to you GHS 115.00", notice.body)
        self.assertEqual(VendorText.objects.get(business_owner=self.kofi.owner).notification_id, notice.pk)

    def test_review_focus_the_customer_never_sees_the_platform_fee(self):
        response = self.checkout((self.kofi_item, 1))
        order_id = response.json()["id"]
        self.assertNotIn("platform", response.content.decode().lower())
        self.assertNotIn("platform", self.shopper.get(f"/api/orders/{order_id}/").content.decode().lower())
        self.assertFalse(Notification.objects.filter(customer=self.buyer, body__icontains="platform").exists())
        self.assertNotIn("+233241110001", [text.to for text in senders.sms_outbox])

    def test_review_focus_a_text_that_cannot_be_queued_never_stops_the_payment(self):
        with mock.patch.object(VendorText.objects, "get_or_create", side_effect=RuntimeError("down")), \
                self.assertLogs("wallets.vendor_texts", "ERROR"):
            response = self.checkout((self.kofi_item, 1))
        order = Order.objects.get(pk=response.json()["id"])
        self.assertEqual(order.status, Order.PAID)
        self.assertTrue(Journal.objects.filter(key=escrow.pay_key(order)).exists())
        self.assertIn("Platform fee", Notification.objects.get(business_owner=self.kofi.owner).body)   # the copy stays

    def test_review_focus_a_provider_that_is_down_leaves_the_text_queued_for_a_retry(self):
        with mock.patch("wallets.vendor_texts.senders.deliver", return_value=DOWN):
            self.checkout((self.kofi_item, 1))
        text = VendorText.objects.get()
        self.assertEqual((text.status, text.attempts), (VendorText.QUEUED, 1))


@override_settings(LEDGER_ENABLED=True)
class ReleaseTextTests(VendorBase):
    def released(self, order):
        with self.captureOnCommitCallbacks(execute=True):
            release(order)

    def test_review_focus_the_release_text_says_what_reached_available(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        self.released(order)
        body = f"AshantiHub: order #{order.pk} released. GHS 115.00 added to your Available balance after the GHS 5.00 platform fee."
        self.assertEqual([(text.to, text.body) for text in senders.sms_outbox], [("+233201110001", body)])
        notice = Notification.objects.get(business_owner=self.kofi.owner, kind="vendor_money")
        self.assertEqual((notice.title, notice.body), (f"Order #{order.pk} released", body))

    def test_a_free_delivery_promo_taken_at_release_is_in_the_text(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)], delivery="0.00")
        waived(self.kofi.owner, order, "15.00")
        self.released(order)
        self.assertTrue(senders.sms_outbox[-1].body.endswith(
            "after the GHS 5.00 platform fee. GHS 15.00 free-delivery promo was then taken from it."
        ))

    def test_review_focus_a_shared_order_texts_each_business_its_own_release(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1), (self.esi.listing("600.00"), 1)])
        self.released(order)
        by_phone = {text.to: text.body for text in senders.sms_outbox}
        self.assertIn("GHS 115.00 added", by_phone["+233201110001"])
        self.assertIn("GHS 594.00 added", by_phone["+233201110002"])
        self.assertNotIn("594.00", by_phone["+233201110001"])

    def test_review_focus_a_text_that_cannot_be_queued_never_stops_a_release(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        with mock.patch.object(VendorText.objects, "get_or_create", side_effect=RuntimeError("down")), \
                self.assertLogs("wallets.vendor_texts", "ERROR"):
            self.released(order)
        self.assertTrue(Journal.objects.filter(key=escrow.release_key(order)).exists())
        self.assertEqual(posting.balance_of(Account.VENDOR_AVAILABLE, self.kofi.owner), 11500)
        self.assertTrue(Notification.objects.filter(business_owner=self.kofi.owner, kind="vendor_money").exists())

    def test_a_release_is_texted_once(self):
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        self.released(order)
        self.assertIsNone(escrow.release_verified(order))
        self.assertEqual(VendorText.objects.filter(kind=VendorText.ORDER_RELEASED).count(), 1)
        self.assertEqual(len(senders.sms_outbox), 1)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p vend1 run --rm web python manage.py test wallets.tests.test_vendor_text_wiring --noinput`
Expected: FAIL — `senders.sms_outbox` is empty and no `VendorText` exists (nothing queues texts yet); the ledger-off test passes.

- [ ] **Step 3: The imports** — in `backend/wallets/vendor_texts.py` replace

```python
import logging
import string
from datetime import timedelta
from functools import partial

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from accounts.phones import mask_phone
from otp import senders, spend
from otp.identity import contacts
from otp.models import SMS

from .models import VendorText
```

with

```python
import logging
import string
from dataclasses import dataclass
from datetime import timedelta
from functools import partial

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from accounts.models import BusinessOwner
from accounts.phones import mask_phone
from ledger import escrow
from ledger.models import Account, Journal, JournalLine, OrderFeeSnapshot
from ledger.money import to_pesewas
from marketing.models_waivers import WaivedFeeCharge
from notifications.services import notify_business_owner
from otp import senders, spend
from otp.identity import contacts
from otp.models import SMS

from .models import VendorText
from .services import money
```

- [ ] **Step 4: Paid and release texts** — append to `backend/wallets/vendor_texts.py`

```python
# --- texts on a paid order and on release (Task 6) -----------------------------------------------------------------

VENDOR_MONEY = "vendor_money"  # the in-app kind of a release or digest text's copy (Notification kinds are free slugs)
OWNER_TYPE = BusinessOwner._meta.label_lower


@dataclass(frozen=True)
class Amounts:
    """One business's share of a paid order, in pesewas: its item subtotal, the platform fee snapshotted on it, and the
    free-delivery promo it owes for the order (taken from its Available at release)."""

    subtotal: int
    fee: int
    promo: int

    @property
    def due(self):
        return self.subtotal - self.fee - self.promo


def paid_key(order, owner):
    return f"paid-{order.pk}-{owner.pk}"


def released_key(order, owner):
    return f"released-{order.pk}-{owner.pk}"


def paid_amounts(order):
    """{business owner pk: Amounts} for an order whose payment the ledger has just recorded (its fee snapshots); {} when
    it was not (ledger off, a GH₵ 0.00 order, one paid before the ledger was on). A business whose lines are worth
    nothing is left out. Never raises: it runs inside the payment."""
    try:
        with transaction.atomic():
            if not escrow.enabled() or not Journal.objects.filter(key=escrow.pay_key(order)).exists():
                return {}
            totals = {}
            for snap in OrderFeeSnapshot.objects.filter(order=order).order_by("pk"):
                base, fee = totals.get(snap.business_owner_id, (0, 0))
                totals[snap.business_owner_id] = (base + snap.base_pesewas, fee + snap.charged_pesewas)
            promos = {
                charge.business_owner_id: to_pesewas(charge.amount)
                for charge in WaivedFeeCharge.objects.filter(order=order, status=WaivedFeeCharge.OWED)
            }
    except Exception as exc:  # noqa: BLE001 - a text never stops a payment
        logger.error("Paid-order texts not worked out: %s", type(exc).__name__)
        return {}
    return {pk: Amounts(base, fee, promos.get(pk, 0)) for pk, (base, fee) in totals.items() if base > 0}


def _promo_part(promo):
    return f", free-delivery promo GHS {money(promo)}" if promo else ""


def paid_text(order, amounts):
    """Spec §6: reference, item subtotal, platform fee, amount due."""
    return (
        f"AshantiHub: order #{order.pk} paid. Items GHS {money(amounts.subtotal)}, platform fee GHS {money(amounts.fee)}"
        f"{_promo_part(amounts.promo)}, due to you GHS {money(amounts.due)} after delivery and Support's check."
    )


def paid_line(amounts):
    """The money line added to the in-app "New order" notice (the paid text's in-app copy)."""
    return (
        f"Platform fee GHS {money(amounts.fee)}{_promo_part(amounts.promo)}; due to you GHS {money(amounts.due)} once the "
        "order is delivered and Support has checked it."
    )


def released_text(order, released, fee, promo):
    """Spec §6 "second SMS on release": what reached Available, the fee taken, and a promo taken after."""
    then = f" GHS {money(promo)} free-delivery promo was then taken from it." if promo else ""
    return (
        f"AshantiHub: order #{order.pk} released. GHS {money(released)} added to your Available balance after the "
        f"GHS {money(fee)} platform fee.{then}"
    )


def order_released(order):
    """The release text and its in-app copy for each business the release paid, worked out from the journals just
    written: its Pending debit (the subtotal released), its Available credit (that less the fee) and a free-delivery
    promo charged right after (ledger.escrow.charge_waiver). Called inside the release's transaction after every posting;
    takes no lock and never raises. Returns how many texts were queued."""
    try:
        with transaction.atomic():
            shares = {}
            lines = JournalLine.objects.filter(
                journal__key=escrow.release_key(order), account__owner_type=OWNER_TYPE,
                account__kind__in=(Account.VENDOR_PENDING, Account.VENDOR_AVAILABLE),
            ).select_related("account")
            for line in lines:
                share = shares.setdefault(int(line.account.owner_id), {"base": 0, "released": 0, "promo": 0})
                if line.account.kind == Account.VENDOR_PENDING and line.side == JournalLine.DEBIT:
                    share["base"] += line.amount
                elif line.account.kind == Account.VENDOR_AVAILABLE and line.side == JournalLine.CREDIT:
                    share["released"] += line.amount
            promo_lines = JournalLine.objects.filter(
                journal__key=escrow.waiver_key(order), side=JournalLine.DEBIT, account__owner_type=OWNER_TYPE,
            ).select_related("account")
            for line in promo_lines:
                if int(line.account.owner_id) in shares:
                    shares[int(line.account.owner_id)]["promo"] += line.amount
            owners = BusinessOwner.objects.in_bulk(list(shares))
    except Exception as exc:  # noqa: BLE001 - spec §6: a text never stops a release
        logger.error("Release texts not worked out: %s", type(exc).__name__)
        return 0
    queued = 0
    for pk in sorted(shares):
        share, owner = shares[pk], owners.get(pk)
        if owner is None or share["base"] <= 0:
            continue
        body = released_text(order, share["released"], share["base"] - share["released"], share["promo"])
        notice = notify_business_owner(
            owner, VENDOR_MONEY, f"Order #{order.pk} released", body=body, link="/business-dashboard", icon="💰",
        )
        if queue(owner, VendorText.ORDER_RELEASED, released_key(order, owner), body, order=order, notification=notice) is not None:
            queued += 1
    return queued
```

- [ ] **Step 5: Paid texts** — replace the whole of `backend/orders/alerts.py` with

```python
"""New-order alerts for business owners.

Called once, when an order is marked paid (payments.services._finalize_order_checkout,
which both the simulated and the Hubtel-webhook paths go through). An order can span
several businesses, so each owner is alerted about their own lines only — the same
isolation rule as OwnerOrderSerializer and the sales report.

With the ledger on (it recorded this payment), each owner's in-app alert also carries the platform fee and the amount
due, and is the in-app copy of the money text queued for them (wallets.vendor_texts; spec §6), so a business gets one
notice per order, not two. The customer is never told the platform fee (spec §3.2).
"""
from decimal import Decimal

from django.db import transaction

from accounts.emails import send_new_order_email
from notifications.models import Notification
from notifications.services import notify_business_owner


def alert_owners_of_paid_order(order):
    from wallets import vendor_texts
    from wallets.models import VendorText

    shares = vendor_texts.paid_amounts(order)  # {} unless the ledger recorded this payment; never raises
    lines_by_owner = {}
    for item in order.items.select_related("listing__business_owner"):
        lines_by_owner.setdefault(item.listing.business_owner, []).append(item)

    for owner, items in lines_by_owner.items():
        lines = [(item.quantity, item.listing.name, item.line_total) for item in items]
        subtotal = sum((item.line_total for item in items), Decimal("0.00"))
        summary = ", ".join(f"{quantity} × {name}" for quantity, name, _ in lines)
        body = f"{summary} — GHS {subtotal}"
        amounts = shares.get(owner.pk)
        if amounts is not None:
            body = f"{body}. {vendor_texts.paid_line(amounts)}"
        # The in-app alert is a row in the same transaction, so it rolls back with it.
        notice = notify_business_owner(
            owner, Notification.NEW_ORDER, f"New order #{order.id}",
            body=body, link="/business-dashboard", icon="🛍️",
        )
        if amounts is not None:
            # Queued in this transaction and sent after it commits; never raises (a text never blocks a payment).
            vendor_texts.queue(
                owner, VendorText.ORDER_PAID, vendor_texts.paid_key(order, owner), vendor_texts.paid_text(order, amounts),
                order=order, notification=notice,
            )
        # The email can't be taken back, so it waits until the payment is committed.
        if owner.email:
            transaction.on_commit(
                lambda email=owner.email, lines=lines, subtotal=subtotal: send_new_order_email(
                    email, order.id, lines, subtotal
                )
            )
```

- [ ] **Step 6: Release texts** — in `backend/ledger/escrow.py` (inside `release_verified`) replace

```python
        OrderFeeSnapshot.objects.filter(pk__in=[s.pk for s in snapshots]).update(released_at=now)
        charge_waiver(order)
        return journal
```

with

```python
        OrderFeeSnapshot.objects.filter(pk__in=[s.pk for s in snapshots]).update(released_at=now)
        charge_waiver(order)
        # Each business paid gets its release text and in-app copy (spec §6), queued in this transaction and sent after it
        # commits. It reads the journals just written, takes no lock and never raises (vendor plan 4).
        from wallets import vendor_texts

        vendor_texts.order_released(order)
        return journal
```

- [ ] **Step 7: Run the tests**

Run: `docker compose -p vend1 run --rm web python manage.py test wallets.tests.test_vendor_text_wiring wallets.tests.test_vendor_texts orders.tests.test_new_order_alerts ledger --noinput`
Expected: PASS (11 new tests; the new-order alert tests and the whole `ledger` suite unchanged).

- [ ] **Step 8: Commit**

```bash
git add backend/wallets/vendor_texts.py backend/orders/alerts.py backend/ledger/escrow.py backend/wallets/tests/test_vendor_text_wiring.py
git commit -m "feat(wallets): text each business on a paid order (subtotal, fee, due) and on release, in-app copy kept, never blocks the money" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 7: The texts screen API and the optional daily digest

**Files:**
- Modify: `backend/wallets/vendor_texts.py`, `backend/wallets/views_vendor.py`, `backend/wallets/urls.py`, `backend/wallets/tasks.py`, `backend/ashantihub/settings.py`
- Create: `backend/wallets/tests/test_vendor_digest.py`

**Interfaces:**
- Consumes: Task 2 (`vendor.daily(owner, first, last)`), Tasks 5–6 (`queue`, `row`, `VENDOR_MONEY`, `VendorText`, `VendorPreference`), `ledger.posting.balance_of`, `otp.identity.contacts`, `accounts.phones.mask_phone`.
- Produces:
  - `vendor_texts.wants_digest(owner) -> bool`, `digest_key(owner, day)`, `digest_text(day, summary, pending, available)`, `queue_digests(day, now=None) -> int`
  - `views_vendor.VendorTextsView` (GET, PATCH); URL `wallet-vendor-texts`
  - task `wallets.tasks.queue_vendor_digests()`; beat entry `wallets-vendor-digests` (07:00)

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_vendor_digest.py`

```python
"""The business's texts screen and the optional daily digest (vendor plan 4, Task 7). Review Focus 1 (its own texts; a
customer with the same id is refused), 2 (no usable phone said plainly), 4 (the digest covers exactly yesterday) and 5
(ledger off)."""
from datetime import datetime, time, timedelta
from unittest import mock

from django.conf import settings
from django.test import override_settings
from django.utils import timezone

from accounts.models import BusinessOwner
from notifications.models import Notification
from otp import senders
from wallets import tasks, vendor_texts
from wallets.models import VendorPreference, VendorText

from .vendor_helpers import VendorBase, paid_order, release, signed_in

TEXTS = "/api/wallet/vendor/texts/"


class LedgerOffTests(VendorBase):
    def test_review_focus_the_texts_screen_says_ledger_off(self):
        for response in (self.kofi.get(TEXTS), self.kofi.client.patch(TEXTS, {"daily_digest": True}, format="json")):
            self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"))
        self.assertFalse(VendorPreference.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class TextSettingsTests(VendorBase):
    def test_the_digest_is_off_until_turned_on(self):
        body = self.kofi.get(TEXTS).json()
        self.assertEqual((body["order_texts"], body["daily_digest"], body["phone"], body["recent"]), (True, False, "020 *** 0001", []))
        turned_on = self.kofi.client.patch(TEXTS, {"daily_digest": True}, format="json")
        self.assertEqual((turned_on.status_code, turned_on.json()["daily_digest"]), (200, True))
        self.assertTrue(self.kofi.get(TEXTS).json()["daily_digest"])
        self.assertFalse(self.esi.get(TEXTS).json()["daily_digest"])
        self.assertFalse(self.kofi.client.patch(TEXTS, {"daily_digest": False}, format="json").json()["daily_digest"])

    def test_only_true_or_false(self):
        for value in ("yes", 1, None):
            response = self.kofi.client.patch(TEXTS, {"daily_digest": value}, format="json")
            self.assertEqual((response.status_code, list(response.json())), (400, ["daily_digest"]), value)

    def test_recent_texts_are_the_businesss_own_newest_first(self):
        first = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        second = paid_order(self.buyer, [(self.kofi.listing("600.00"), 1), (self.esi.listing("50.00"), 1)])
        with self.captureOnCommitCallbacks(execute=True):
            release(first)
            release(second)
        recent = self.kofi.get(TEXTS).json()["recent"]
        self.assertEqual([(r["kind"], r["order"], r["status"], r["status_label"], r["to"]) for r in recent], [
            ("order_released", second.pk, "sent", "Sent", "020 *** 0001"),
            ("order_released", first.pk, "sent", "Sent", "020 *** 0001"),
        ])
        self.assertEqual([r["order"] for r in self.esi.get(TEXTS).json()["recent"]], [second.pk])

    def test_review_focus_a_business_with_no_ghana_mobile_is_told_plainly(self):
        BusinessOwner.objects.filter(pk=self.kofi.owner.pk).update(login_phone="+44 20 7946 0000")
        order = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        with self.captureOnCommitCallbacks(execute=True):
            release(order)
        body = self.kofi.get(TEXTS).json()
        self.assertIsNone(body["phone"])
        self.assertEqual(
            (body["recent"][0]["status"], body["recent"][0]["status_label"]),
            ("no_phone", "Not sent: no Ghana mobile number on your account"),
        )
        self.assertTrue(Notification.objects.filter(business_owner=self.kofi.owner, kind="vendor_money").exists())

    def test_review_focus_a_customer_with_the_same_id_cannot_read_or_change_them(self):
        twin = signed_in(self.twin(), "customer")
        self.assertEqual(twin.get(TEXTS).status_code, 403)
        self.assertEqual(twin.patch(TEXTS, {"daily_digest": True}, format="json").status_code, 403)
        self.assertFalse(VendorPreference.objects.exists())


@override_settings(LEDGER_ENABLED=True)
class DigestTests(VendorBase):
    def setUp(self):
        super().setUp()
        self.day = timezone.localdate() - timedelta(days=1)
        self.noon = timezone.make_aware(datetime.combine(self.day, time(12, 0)))

    def yesterday(self):
        return mock.patch("django.utils.timezone.now", return_value=self.noon)

    def test_review_focus_yesterdays_digest_goes_once_to_a_business_that_asked(self):
        VendorPreference.objects.create(business_owner=self.kofi.owner, daily_digest=True)
        VendorPreference.objects.create(business_owner=self.esi.owner, daily_digest=True)        # nothing moved for Esi
        with self.yesterday():
            sold = paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
            paid_order(self.buyer, [(self.kofi.listing("600.00"), 1)])
            release(sold)
        paid_order(self.buyer, [(self.kofi.listing("80.00"), 1)])                                 # today: not in yesterday's digest
        with self.captureOnCommitCallbacks(execute=True):
            self.assertEqual(vendor_texts.queue_digests(self.day), 1)
            self.assertEqual(vendor_texts.queue_digests(self.day), 0)                            # a re-run adds nothing
        expected = (
            f"AshantiHub {self.day:%d %b}: 2 orders paid, items GHS 720.00. Released GHS 115.00, fees GHS 5.00, "
            "refunds GHS 0.00. Now Pending GHS 680.00, Available GHS 115.00."
        )
        self.assertEqual([(text.to, text.body) for text in senders.sms_outbox], [("+233201110001", expected)])
        copies = Notification.objects.filter(business_owner=self.kofi.owner, title=f"Your AshantiHub day, {self.day:%d %b}")
        self.assertEqual([copy.body for copy in copies], [expected])

    def test_a_business_that_did_not_ask_gets_none(self):
        with self.yesterday():
            paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        self.assertEqual(vendor_texts.queue_digests(self.day), 0)
        self.assertFalse(VendorText.objects.filter(kind=VendorText.DAILY_DIGEST).exists())

    def test_the_digest_job_is_a_no_op_with_the_ledger_off_and_both_jobs_are_scheduled(self):
        VendorPreference.objects.create(business_owner=self.kofi.owner, daily_digest=True)
        with self.yesterday():
            paid_order(self.buyer, [(self.kofi.listing("120.00"), 1)])
        with override_settings(LEDGER_ENABLED=False):
            self.assertEqual(tasks.queue_vendor_digests(), 0)
        self.assertEqual(tasks.queue_vendor_digests(), 1)
        scheduled = {entry["task"] for entry in settings.CELERY_BEAT_SCHEDULE.values()}
        self.assertTrue({"wallets.tasks.send_due_vendor_texts", "wallets.tasks.queue_vendor_digests"} <= scheduled)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p vend1 run --rm web python manage.py test wallets.tests.test_vendor_digest --noinput`
Expected: ERROR — `AttributeError: module 'wallets.tasks' has no attribute 'queue_vendor_digests'` (and 404 for `/api/wallet/vendor/texts/`).

- [ ] **Step 3: The imports** — in `backend/wallets/vendor_texts.py` replace

```python
from ledger import escrow
```

with

```python
from ledger import escrow, posting
```

and replace

```python
from .models import VendorText
from .services import money
```

with

```python
from . import vendor
from .models import VendorPreference, VendorText
from .services import money
```

- [ ] **Step 4: The digest** — append to `backend/wallets/vendor_texts.py`

```python
# --- the optional daily digest (Task 7) ----------------------------------------------------------------------------

def wants_digest(owner):
    return VendorPreference.objects.filter(business_owner=owner, daily_digest=True).exists()


def digest_key(owner, day):
    return f"digest-{owner.pk}-{day:%Y-%m-%d}"


def digest_text(day, summary, pending, available):
    """`summary` is one day of vendor.daily (GH₵ strings); `pending` and `available` are pesewas now."""
    orders = summary["orders"]
    return (
        f"AshantiHub {day:%d %b}: {orders} order{'' if orders == 1 else 's'} paid, items GHS {summary['sold']}. "
        f"Released GHS {summary['released']}, fees GHS {summary['fees']}, refunds GHS {summary['refunded']}. "
        f"Now Pending GHS {money(pending)}, Available GHS {money(available)}."
    )


def queue_digests(day, now=None):
    """Queue `day`'s digest (spec §6, "optional daily digest") with its in-app copy for each business that turned it on
    and whose money moved that Accra day. A business already sent that day's digest is skipped, so a re-run adds
    nothing; one business that fails is logged and skipped. Returns how many were queued."""
    queued = 0
    for owner in BusinessOwner.objects.filter(vendor_preference__daily_digest=True).order_by("pk"):
        key = digest_key(owner, day)
        if VendorText.objects.filter(key=key).exists():
            continue
        try:
            days = vendor.daily(owner, day, day)["days"]
            if not days:
                continue  # nothing moved: no text
            body = digest_text(
                day, days[0], posting.balance_of(Account.VENDOR_PENDING, owner), posting.balance_of(Account.VENDOR_AVAILABLE, owner),
            )
        except Exception as exc:  # noqa: BLE001 - one business never stops the others' digests
            logger.error("Digest for business %s not worked out: %s", owner.pk, type(exc).__name__)
            continue
        notice = notify_business_owner(
            owner, VENDOR_MONEY, f"Your AshantiHub day, {day:%d %b}", body=body, link="/business-dashboard", icon="💰",
        )
        if queue(owner, VendorText.DAILY_DIGEST, key, body, day=day, notification=notice, now=now) is not None:
            queued += 1
    return queued
```

- [ ] **Step 5: The texts view** — in `backend/wallets/views_vendor.py` replace

```python
from accounts.views import IsBusinessOwner
from ledger import escrow, fees
from ledger.models import FeeRuleSet

from . import vendor
from .views import AmountError, Pagination, ledger_off, parse_amount
```

with

```python
from accounts.phones import mask_phone
from accounts.views import IsBusinessOwner
from ledger import escrow, fees
from ledger.models import FeeRuleSet
from otp.identity import contacts
from otp.models import SMS

from . import vendor, vendor_texts
from .models import VendorPreference, VendorText
from .views import AmountError, Pagination, ledger_off, parse_amount
```

and append

```python
class VendorTextsView(APIView):
    """GET vendor/texts/ — the business's money texts: order and release texts always go (spec §6), whether the daily
    digest is on, the masked number they go to (null: no Ghana mobile number on the account, so none can be sent) and
    its last 20 texts with what happened to each. PATCH {daily_digest: true|false} — turn the digest on or off."""

    permission_classes = [IsBusinessOwner]

    def _body(self, owner):
        phone = contacts(owner).get(SMS)
        return {
            "order_texts": True, "daily_digest": vendor_texts.wants_digest(owner),
            "phone": mask_phone(phone) if phone else None,
            "recent": [vendor_texts.row(text) for text in VendorText.objects.filter(business_owner=owner)[:20]],
        }

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        return Response(self._body(request.user))

    def patch(self, request):
        if not escrow.enabled():
            return ledger_off()
        data = request.data if isinstance(request.data, dict) else {}
        if not isinstance(data.get("daily_digest"), bool):
            return Response({"daily_digest": "Choose true or false."}, status=status.HTTP_400_BAD_REQUEST)
        VendorPreference.objects.update_or_create(business_owner=request.user, defaults={"daily_digest": data["daily_digest"]})
        return Response(self._body(request.user))
```

- [ ] **Step 6: The route, the job and its schedule** — in `backend/wallets/urls.py` replace

```python
    path("vendor/fees/", views_vendor.VendorFeesView.as_view(), name="wallet-vendor-fees"),
```

with

```python
    path("vendor/fees/", views_vendor.VendorFeesView.as_view(), name="wallet-vendor-fees"),
    path("vendor/texts/", views_vendor.VendorTextsView.as_view(), name="wallet-vendor-texts"),
```

append to `backend/wallets/tasks.py`

```python
@shared_task
def queue_vendor_digests():
    """07:00 every day: yesterday's digest for each business that asked for one (a no-op while the ledger is off). The
    beat entry makes core.jobs keep a JobRun heartbeat for it."""
    if not escrow.enabled():
        return 0
    return vendor_texts.queue_digests(timezone.localdate() - timedelta(days=1))
```

and in `backend/ashantihub/settings.py` replace

```python
    "wallets-send-vendor-texts": {
        "task": "wallets.tasks.send_due_vendor_texts",
        "schedule": 300.0,  # every 5 minutes: business money texts not sent yet (spec §6: queued, retried)
    },
}
```

with

```python
    "wallets-send-vendor-texts": {
        "task": "wallets.tasks.send_due_vendor_texts",
        "schedule": 300.0,  # every 5 minutes: business money texts not sent yet (spec §6: queued, retried)
    },
    "wallets-vendor-digests": {
        "task": "wallets.tasks.queue_vendor_digests",
        "schedule": crontab(hour=7, minute=0),  # yesterday's digest for businesses that asked; a no-op while the ledger is off
    },
}
```

- [ ] **Step 7: Run the tests**

Run: `docker compose -p vend1 run --rm web python manage.py test wallets.tests.test_vendor_digest wallets.tests.test_vendor_texts wallets.tests.test_vendor_text_wiring --noinput`
Expected: PASS (9 new tests; Tasks 5–6 unchanged).

- [ ] **Step 8: Commit**

```bash
git add backend/wallets/vendor_texts.py backend/wallets/views_vendor.py backend/wallets/urls.py backend/wallets/tasks.py backend/ashantihub/settings.py backend/wallets/tests/test_vendor_digest.py
git commit -m "feat(wallets): vendor texts screen API and the optional daily digest (07:00, yesterday, only when money moved)" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

---

### Task 8: Documentation and full verification

**Files:**
- Modify: `backend/CLAUDE.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Line up with Plan 1b first** — if Plan 1b (`feature/ledger-services-1b`) has merged into `righteoushack`, run `git fetch origin && git rebase origin/righteoushack` now, so this task's spec block lands after Plan 1b's (both append to the end of the spec). If it has not, carry on: whichever branch merges second keeps both appended blocks, Stage 1b's first. Do **not** edit the spec's Status / Scope lines, its §4.2 line, or the root `CLAUDE.md` (Plan 1b rewrites those).

- [ ] **Step 2: Correctness core** — in `backend/CLAUDE.md` replace

```markdown
    secret field or local-variable name to `ashantihub/sentry.py`.

## Test-fixture gotcha
```

with

```markdown
    secret field or local-variable name to `ashantihub/sentry.py`.
- **A business's money and texts (`wallets/vendor.py`, `vendor_texts.py`, Stage 4).** `/api/wallet/vendor/*` is
  business-owner only (a customer with the same id, or staff, gets 403: platform fees never reach a customer) and answers
  `409 ledger_off` while the ledger is off. Read-only: sale rows come from the business's own `OrderFeeSnapshot`s (never
  today's rules), the daily summary from journal lines on its own Pending and Available accounts (`vendor.FOLD`; any
  other line lands in `other`, so the columns always add up to the balance change), and no row, export or text holds a
  customer's name, phone or address. Texts to a business go through `wallets.VendorText`: `vendor_texts.queue` runs
  inside the payment (`orders.alerts`) or the release (`escrow.release_verified`, after every posting), in a savepoint,
  and never raises; the send happens after commit through `otp.senders`, claimed with a 10-minute lease, retried 5 times.
  A business text is **never an `OtpEvent`** (those count toward the code send limits) but is counted by the
  `otp.spend` alert. Bodies are GSM-7 plain text with "GHS" (never "GH₵"), at most 306 characters. Only product orders
  are covered; booking sales slot in later (spec §13 (lxxi)).

## Test-fixture gotcha
```

- [ ] **Step 3: The stage index** — in `docs/IMPLEMENTATION_INSTRUCTIONS.md` replace

```markdown
| **4** Vendor dashboard and SMS | Statements, per-order SMS, digest, cap meter. |
```

with

```markdown
| **4** Vendor dashboard and SMS | Statements, per-order SMS, digest, cap meter. Backend: docs/superpowers/plans/2026-10-16-vendor-side-sms-4.md (overview with the cap, per-sale rows, daily summary, statement export, fee transparency, paid/release texts and the optional digest), product orders only, behind `LEDGER_ENABLED` (default off); the screens are Plan 4F. |
```

- [ ] **Step 4: The spec** — append to the end of `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (after Plan 1b's Stage 1b sections if they are there)

```markdown

### Stage 4 (vendor dashboard and texts, backend) reconciliation (2026-10-16)

Found while writing `docs/superpowers/plans/2026-10-16-vendor-side-sms-4.md` (§0 there; its V1–V16):

- **V1 Sections.** The vendor dashboard and texts are §6; §9 contributes its SMS-spend alert.
- **V2 Where it lives.** `wallets/vendor.py` (read model), `wallets/vendor_texts.py` (text outbox), `/api/wallet/vendor/`;
  `wallets.VendorText` and `wallets.VendorPreference`. Hooks: `orders.alerts` (paid) and `escrow.release_verified` (release).
- **V3 Figures.** Sale rows from the business's own fee snapshots and owed promo; the daily summary from journal lines on
  its own Pending and Available; balances from the accounts. Never today's fee rules.
- **V4 Status.** `awaiting_call` (labelled waiting for delivery or collection, waiting for Support's call, or on hold while
  a dispute is open), `released`, `refunded`; the export says Pending / Available / Refunded and Withdrawn / in progress /
  Returned for withdrawals.
- **V5 Privacy.** No customer name, phone or address in any vendor row, summary, export or text; the export has no free
  text. Fees are shown to business owners only.
- **V6 Texts.** One per paid order and business, per release and business, per digest day; queued inside the money
  transaction (never raises), sent after commit through `otp.senders`, leased, retried 5 times, `no_phone` when the login
  phone is not a Ghana mobile. Never an `OtpEvent` (the code send limits count those); counted by the `otp.spend` alert,
  which now watches all SMS spend. GSM-7 plain text with "GHS", at most 306 characters. No throttle or quiet hours.
- **V7 In-app copy.** The paid order's "New order" notice carries the fee and amount due; release and digest copies are
  `vendor_money` notices. Kept when a text fails.
- **V8 Digest.** Opt-in per business, 07:00 Accra for the day before, only when money moved.
- **V9 Fee transparency.** Approved tiers in force and the next approved change with its start (never a waiting
  proposal), `charged` only for products today, the fee base explained, the cap used and left, a server quote.
- **V10 Not built.** No low-balance, negative-Available, refund or withdrawal text (the spec names none); no staff
  outbox screen; booking sales (Plan 1b) not yet covered.

### Before LEDGER_ENABLED is turned on — Stage 4 additions

- (lxvi) **Business texts need a real SMS provider.** They go through `otp.senders` (`OTP_SMS_PROVIDER`): with
  `simulated` nothing is sent and the texts screen says "Not sent: texts are simulated"; the Hubtel SMS client is
  unverified (the OTP gate items apply).
- (lxvii) **Text cost and the spend alert.** Every paid order texts each business in it, and every release texts it
  again (two texts per business per order, plus opted-in digests). The daily SMS-spend alert (`otp_sms_daily_alert`,
  default 500) now counts these with the code texts; set it from the expected order volume. Nothing is ever blocked.
- (lxviii) **Sender ID and content.** Hubtel needs an Approved Sender ID; confirm whether transactional texts need
  template approval with the networks.
- (lxix) **Owner question: texts on refunds, a negative Available, withdrawals, or a low balance.** The spec names none,
  so none is sent (3b's in-app withdrawal notices stay).
- (lxx) **Businesses whose login phone is not a Ghana mobile get no texts** (`no_phone`, in-app copy kept). There is no
  staff list of them yet; Support should check before switch-on.
- (lxxi) **Booking sales are not covered.** Once Plan 1b records bookings: add them as a second row source
  (`kind: "booking"`) to `vendor.sale_groups` / `rows` / `statement`, their `booking_*` journal kinds to `vendor.FOLD`,
  services and events to `vendor.CHARGED`, and booking paid / release texts to `vendor_texts`. Until then a booking's
  money is in Pending but not in the sale rows (Pending no longer equals the waiting rows) and lands in the daily
  summary's `other` column. Do it before the ledger is on if Plan 1b ships.
- (lxxii) **Retention.** `VendorText` rows (amounts and order numbers only) are kept indefinitely; decide a purge beside
  `otp.retention`.
- (lxxiii) **Frontend (Plan 4F):** the overview with the cap meter, sales with filters, the daily summary, the export,
  the fee page and the texts settings.
- (lxxiv) **At-least-once texts.** A worker that dies between the claim and the provider's answer leaves the text to be
  tried again after 10 minutes; with a real provider the business may get it twice.
- (lxxv) **Owner question: a suspended business still gets money texts** (its money still moves).
```

- [ ] **Step 5: Commit**

```bash
git add backend/CLAUDE.md docs
git commit -m "docs(wallets): correctness core for the vendor money API and texts; spec V1-V10 and gates (lxvi)-(lxxv); stage index (4)" --trailer "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>" --trailer "Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j"
```

- [ ] **Step 6: Run the whole backend suite**

Run: `docker compose -p vend1 run --rm web python manage.py test --noinput`
Expected: PASS. If a ledger-on test that reads `otp.tests.helpers.last_sms_code()` now picks up a business text (a checkout or release between the code being sent and read), clear `senders.sms_outbox` before that test sends its code and say so in the report. If a failure is unrelated to this work, confirm it on the commit this branch started from (`d26dd54`, "docs(regulatory): BoG request pack - letter, submission v0.2, technical summary, terms"; `git switch --detach d26dd54`, re-run the failing label, `git switch feature/vendor-side-4`) and report it rather than fixing it here.

- [ ] **Step 7: Migrations check**

Run: `docker compose -p vend1 run --rm web python manage.py makemigrations --check --dry-run`
Expected: `No changes detected`.

---

## What this plan deliberately does not do (later plans)

| Plan | Scope | Why separate |
|---|---|---|
| **4F** Frontend | The vendor money screens: overview with the cap meter, sales with filters and labels, daily summary, the statement download, the fee page with the quote, the texts settings and recent texts. | No screen ships in a backend plan; the API answers `ledger_off` and 403 for it to handle. |
| **1b follow-up** | Booking sales in the vendor rows, statement, daily columns, fee `charged` flags and texts (gate (lxxi)). | Plan 1b is planned in parallel; its `ledger.BookingSale` must land first. |
| **5** Third-party riders | Rider earnings view and texts. | Spec §7. |
| **6** Stock offers | Low-stock and sold-out alerts by SMS/email (§1 row 15, §10). | Spec §11 step 6; not a money text. |
| **7** Hubtel live | A verified Hubtel SMS send and an Approved Sender ID (gates (lxvi), (lxviii)). | Needs credentials (§11 step 7). |
| Owner decisions | Texts on refunds / negative Available / withdrawals, digest thresholds, retention, texts to suspended businesses (A1–A11; gates (lxix), (lxxii), (lxxv)). | Not decided. |

## Self-review

**Spec coverage:**

| Requirement | Task(s) |
|---|---|
| §6 two views, Pending and Available | 1 (`overview`; `/api/wallet/` already shows both) |
| §6 negative Available (blocks withdrawal) shown | 1 (`negative`, `withdrawable` 0) |
| §6 transactions page: date, order, gross, platform fee shown separately, amount, status Pending / Available / Withdrawn / Refunded | 1 (rows), 3 (statement with the four words) |
| §6 filters | 1 (status, dates), 2 and 3 (ranges) |
| §6 cap used and remaining | 1 (`fee_cap`), 4 (`fee_cap` with the tiers) |
| §6 export | 3 |
| Brief: per-order sale rows with item subtotal, platform fee, net, awaiting call / released / refunded | 1 |
| Brief: daily summary | 2 |
| §6 SMS on every paid order, per vendor: reference, item subtotal, platform fee, amount due | 6 (`paid_text`) |
| §6 second SMS on release | 6 (`order_released`) |
| §6 optional daily digest | 7 |
| §6 in-app copy always kept | 5 (copy kept on `no_phone`), 6 (the new-order notice; `vendor_money` on release), 7 (digest copy) |
| §6 SMS failure never blocks payment (queued, retried) | 5 (outbox, lease, backoff), 6 (payment and release tests with the queue failing) |
| §9 SMS-spend alert | 5 (`texts_sent_on` counts business texts) |
| §3.2 fees never shown to the customer | 1, 4 (403 for customers and staff), 6 (checkout, order detail, notices) |
| §3.1 / §3.3 tiers, changes apply only later | 4 (tiers in force, next approved change, no waiting proposal) |
| Brief: owner-scoped isolation, customer vs owner same pk | 1, 2, 3, 4, 7 (twin tests), 6 (shared order texts) |
| Brief: privacy | 1, 3, 6 (no customer detail) |
| Brief: ledger off → 409 ledger_off | 1–4, 7 (`LedgerOffTests`), 6 (no text, notice as before) |
| Brief: throttles / quiet hours only if the spec says | none built (V8) |
| Brief: low-balance only per spec | none built (V12; gate (lxix)) |
| §11 step 4 behind the switch | every task |

**Placeholder scan:** every code step carries complete code and every test step complete test code; every edit quotes the exact text it replaces; no "TBD", "similar to" or undefined names.

**Name consistency:** `vendor.AWAITING/RELEASED/REFUNDED/STATUSES`, `RangeError(field, message).body()`, `optional_dates`, `sale_groups(owner, *, status, date_from, date_to)`, `status_of`, `rows(owner, groups)`, `fee_cap`, `overview` (1, 2, 3, 4); `vendor.OWNER_TYPE`, `account`, `date_range(params, *, default_days, max_days)`, `bounds`, `FOLD`, `COLUMNS`, `daily(owner, first, last)` (2, 3, 7); `vendor.STATEMENT_HEADER`, `statement` (3); `vendor.APPLIES_TO`, `CHARGED`, `FEE_BASE`, `band_row`, `fee_schedule`, `fee_quote` (4); `VendorText.ORDER_PAID/ORDER_RELEASED/DAILY_DIGEST`, `QUEUED/SENT/FAILED/NO_PHONE`, `VendorPreference.daily_digest` (5, 6, 7); `vendor_texts.LEASE/BACKOFF/MAX_ATTEMPTS/MAX_LENGTH/fits/queue/deliver/send_due/row` (5, 6, 7); `vendor_texts.VENDOR_MONEY`, `Amounts`, `paid_amounts`, `paid_key`, `released_key`, `paid_text`, `paid_line`, `released_text`, `order_released` (6); `vendor_texts.wants_digest`, `digest_key`, `digest_text`, `queue_digests` (7); tasks `send_vendor_text`, `send_due_vendor_texts` (5), `queue_vendor_digests` (7); views `VendorOverviewView`, `VendorSalesView` (1), `VendorDailyView` (2), `VendorStatementExportView` (3), `VendorFeesView` (4), `VendorTextsView` (7); fixtures `VendorBase`, `Shop`, `signed_in`, `customer`, `paid_order`, `deliver`, `release`, `waived`, `hold` (1–7) and 3b's `fund`, `destination` (2, 3).

**Test counts:** Task 1 — 17 (`test_vendor_sales`: 1 + 8 + 5 + 3); Task 2 — 7 (`test_vendor_daily`: 1 + 6); Task 3 — 6 (`test_vendor_statement`: 1 + 5); Task 4 — 6 (`test_vendor_fees`: 1 + 5); Task 5 — 13 (`test_vendor_texts`: 1 + 4 + 6 + 2); Task 6 — 11 (`test_vendor_text_wiring`: 1 + 5 + 5); Task 7 — 9 (`test_vendor_digest`: 1 + 5 + 3). 69 new tests in all.

**Review Focus pins:** each of the five lines above names the tasks and tests that pin it; all of those tests are written out in their tasks.

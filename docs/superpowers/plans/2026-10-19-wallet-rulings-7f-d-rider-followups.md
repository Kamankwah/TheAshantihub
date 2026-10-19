# Wallet Rulings 7F-D: Rider Delivery-Fee Rule, Promo Funding and Rider Withdrawal Cap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the owner's round-2 rulings (2026-10-19) to the 7D rider build: the delivery fee belongs to the rider once any pickup is done and a goods refund never returns it; a promo-covered fee is paid to the rider by the promo's owner; a coupon shortfall never cuts the rider's pay; a rider may make at most 3 withdrawals a day (governed setting).

**Architecture:** Replaces 7D Task 1's "pay the rider a share, return the remainder" with "carve the whole delivery fee out of what a refund can return". `ledger/refunds.py` (`left`, `refund_order`, `_post`, `check`) asks one new predicate, `ledger/riders.delivery_earned(order)`; on a whole refund before release it calls a new settle step that pays the fee through the same release-time machinery (`escrow.charge_waiver`, `riders.credit_delivery`). The promo's funder is a field on the existing `WaivedFeeCharge`. The rider-withdrawal cap is one more governed `ledger/settings_store.py` definition enforced in `wallets/withdrawals.request()`.

**Tech Stack:** Django, DRF, Postgres ledger (`ledger.posting`), React (Money rules page).

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` §6, §7, §13 gates (xciii), (xcviii). Rulings: memory `wallet-owner-decisions-2026-10-18`, "Round 2". Builds on the branch `feature/wallet-rulings-7d` (7A, 7E, 7D built). Plan 7D: `docs/superpowers/plans/2026-10-18-wallet-rulings-7d-riders-and-texts.md`.

## Global Constraints

- **Delivery-fee rule (binding).** Once the rider has PICKED UP at least one stop of a door-to-door delivery (multi-stop: any `PickupStop` collected; single stop: `DeliveryAssignment.picked_up_at`), the delivery fee belongs to the rider, whether or not the delivery completed. A refund of goods (whole or partial, any shop) returns only goods (items) and, on the whole refund, the unspent processing charge rule as today; it never returns the delivery fee. With no pickup before a whole refund, the customer gets the delivery fee back as today and the rider nothing.
- This replaces 7D ruling 7 ("picked up only after the last shop") and the rule "commission goes back to the customer". The rider is paid through the usual third-party split: `riders.split(gross, bp)` at the rate in force when the order was paid (`rider_commission_bp`); rider share to rider balance, the commission part to the rider reserve and from there to platform commission income at end of day (`riders.post_day`), exactly as a release does.
- An AshantiHub (in-house) rider who picked up: the fee is likewise not refunded and stays platform delivery income (assumption beyond the ruling's wording; recorded as an open question in Task 4).
- **Payment moment.** A fee that is still held (Delivery payable) when a **whole** refund arrives before release is settled at that refund (the release will never run). A partial or shop-scoped refund moves nothing: the held fee still goes to the rider at the usual release. The rider is paid once per order (`RiderEarning` is one per order; first trigger wins).
- **Promo-covered fee** (`Order.delivery_fee` is 0, `WaivedFeeCharge` OWED): the promo's owner pays the rider when the delivery was done (picked up before the refund) and nothing moves otherwise (charge reversed as today). Funder is `business` (debit that business's Available, may go negative) or `platform` (debit `Account.PLATFORM_PROMO_SUBSIDY`).
- **Coupon shortfall** (7D ruling 5, kept): if a coupon leaves the customer less than the fee kept, the customer's credit floors at 0, the rider is still paid in full, AshantiHub covers the gap out of the promo subsidy that would have gone back.
- **No back-compat data.** The ledger is off in production (`LEDGER_ENABLED`), 7D is unpushed, so no `OrderRefund`, `RiderEarning` (`rider-refund-*` journal) or reversal row recorded under the old rule exists anywhere. Edit 7D's migration `backend/ledger/migrations/0012_orderrefund_rider_pesewas.py` in place. If 7D has merged to `righteoushack` before this lands, add `0013` that renames the field instead and states the same fact.
- Rider withdrawals: at most `rider_withdrawals_per_day` (default 3) per rider per Accra day (`withdrawals.start_of_day`), counting `Withdrawal.COUNTED` statuses; resets 00:00 Accra. Customers and businesses are not capped by it.
- Money is integer pesewas; journals must balance; lock order per `ledger/riders.py` module text (order row, fee snapshots, delivery assignment row, rider row, then `posting.lock` once). Never put a payout number in a log, event or notice.
- Test commands: `docker compose run --rm web python manage.py test <labels>` from the repo root.

## Review Focus

- Whole goods refund after any pickup, before release: customer gets items (+ processing if staff waived it) minus nothing for delivery; rider balance + reserve get the fee; journals balance; `OrderRefund.delivery_pesewas` is 0.
- Multi-stop: shop A collected, shop B not yet; whole refund: rider paid. Shop A collected, shop B skipped, delivery failed: a later whole refund still pays the rider. Nothing collected: customer gets the fee back, rider 0.
- Refund after release: no rider reversal any more; the fee stays with the rider; the order's remaining goods money returns as before.
- Promo order: vendor-funded charge debits that vendor and pays the rider; platform-funded debits the subsidy account; no pickup: charge reversed and nobody paid.
- Idempotence: the same refund twice (same source) and a refund then a release never pay the rider twice.
- Fourth rider withdrawal of the day refused with `rider_daily_count` and the reset time; cancelled/failed/reversed ones do not count.

---

### Task 1: The delivery fee belongs to the rider once any pickup is done

**Files:**
- Modify: `backend/ledger/riders.py` (replace `_picked_up`, `rider_picked_up`, `refund_trip`, `refund_accounts`, `credit_on_refund`, `refund_key`; delete `earning_to_reverse`, `reversal_accounts`, `reverse_earning`, `check_reversal`, `reversal_key`, `REVERSAL_NOTICE_KIND`, `_reversal_text`; update the module text), `backend/ledger/refunds.py` (`left`, `refund_order`, `_cancel_if_not_handed_over` untouched, `_free_promo`, `_post`, `check`, module text), `backend/ledger/escrow.py` (new `settle_delivery`, `settle_key`), `backend/ledger/models.py` (`OrderRefund.rider_pesewas` -> `delivery_kept_pesewas`, `wallet_pesewas` property), `backend/ledger/migrations/0012_orderrefund_rider_pesewas.py` (edit in place; rename file to `0012_orderrefund_delivery_kept_pesewas.py`), `backend/delivery/models.py` (`RiderEarning` docstring only; columns `reversed_at`, `reversal_journal` stay, always null)
- Test: `backend/ledger/tests/test_rider_refund_pay.py` (rewrite), `backend/ledger/tests/test_rider_refunds.py` (reversal tests replaced), `backend/ledger/tests/rider_helpers.py` (add `stop_collected(order, owner, at)` helper)

**Interfaces:**
- Produces `riders.pickup_made(order) -> datetime | None`: the earliest pickup of a door-to-door order: `min(PickupStop.collected_at)` over status COLLECTED stops, else `DeliveryAssignment.picked_up_at`; `None` if neither, or not `Order.DOOR_TO_DOOR`. Does NOT look at `assignment.status` (a failed delivery after a pickup still counts).
- Produces `riders.delivery_earned(order) -> bool`: `pickup_made(order) is not None` or a `RiderEarning` exists for the order or the order has been released with a delivered assignment (`assignment.delivered_at` set). Once true it stays true.
- Produces `riders.delivery_kept(order) -> int`: pesewas of `Order.delivery_fee` that a refund can never return (the whole `to_pesewas(order.delivery_fee)` when `delivery_earned`, else 0).
- Produces `escrow.settle_delivery(order, now) -> RiderEarning | None`, keyed `order-delivery-settle-{order.pk}`: only for an unreleased order with `delivery_earned`; Dr the order's Delivery payable (whatever it holds), Cr platform delivery income; then `charge_waiver(order)` (Task 2); then `riders.credit_delivery(order, rider, now)` for a third-party rider whose employment period covers `pickup_made(order)` (`employment.third_party_at`). `riders._taken_as_delivery_income` also sums the `order-delivery-settle-*` journal. An in-house rider or none leaves the fee as platform delivery income. Returns the earning or None. Idempotent on its key and on `RiderEarning`.
- Produces `escrow.settle_accounts(order, rider)`: the accounts `settle_delivery` posts to, for the refund's up-front lock (Delivery payable, platform delivery income, rider balance and reserve, the waiver accounts).
- Changes `refunds.left(order)`: `Left.delivery` is `to_pesewas(order.delivery_fee) - done.delivery - delivery_kept(order)` (never below 0). `Left.customer` still counts the money the customer paid (fee included); the fee is carved out inside `_post`.
- Changes `refunds._post(...)`: for a whole refund compute `kept = riders.delivery_kept(order)`; `delivery` passed in is already 0 when kept; `wallet_credit = max(0, customer + processing - kept)`; `unfunded = kept - (customer + processing - wallet_credit)` equivalent floor shortfall, taken off the promo-subsidy credit exactly as 7D's `unfunded` was (`subsidy - unfunded`); the Delivery payable / platform delivery income debit line for the fee is dropped (the fee is not refunded). Before posting, if `whole and not released and delivery_earned`: lock rider/assignment rows then call `escrow.settle_delivery` (first, so the fee has left the payable). `OrderRefund.delivery_kept_pesewas = kept`; `wallet_pesewas` property = `max(0, amount_pesewas + processing_pesewas - delivery_kept_pesewas)`.
- Changes `refunds.refund_order`: `clears_promo` and the `_free_promo(...)` call are skipped whenever `riders.delivery_earned(order)` (the delivery was done, the promo's owner keeps paying); `_free_promo` no longer reverses a rider earning. `refunds.check` uses the same `left()` so the pre-check agrees.
- Deletes the reversal path: after this task nothing refunds a delivery fee that a rider holds. `RiderEarning.reversed_at/reversal_journal` remain as unused historical columns (no migration), documented as always null.
- Removes the `OrderRefund.rider_pesewas` references in `backend/orders/support.py`, `backend/disputes/views.py`, `backend/delivery/config.py` only if they use the field directly (they read `wallet_pesewas`, which keeps its meaning: what the customer got).

- [ ] **Step 1: Failing tests** in `test_rider_refund_pay.py` (use `rider_helpers.rider`, `delivered_by`, new `stop_collected`; build a paid ledger order like `ledger/tests/test_rider_release.py`):
  `test_whole_refund_after_pickup_keeps_fee_for_rider` (order items 100.00, fee 15.00, third-party rider with `picked_up_at`; refund whole: customer wallet +100.00; `delivery_pesewas` 0; `delivery_kept_pesewas` 1500; rider balance 13.50, reserve 1.50, `RiderEarning` gross 1500, `commission_bp` 1000; Delivery payable 0; every journal balances),
  `test_whole_refund_before_pickup_returns_fee_and_pays_rider_nothing` (assigned only; customer +115.00; no `RiderEarning`),
  `test_multi_stop_any_pickup_pays_rider` (two stops, one COLLECTED, assignment `picked_up_at` null, status `accepted`; whole refund pays the rider),
  `test_failed_delivery_after_pickup_still_pays_rider` (assignment FAILED with a collected stop),
  `test_no_stop_collected_returns_fee`,
  `test_partial_refund_of_one_shop_moves_no_fee` (rider unpaid, fee still in Delivery payable; release later pays the rider once),
  `test_refund_then_release_pays_once`,
  `test_refund_after_release_does_not_reverse_rider` (no `order-rider-reversal-*` journal, rider balance unchanged, customer gets goods only),
  `test_same_source_twice_is_idempotent`,
  `test_in_house_rider_fee_stays_platform_income` (no earning; Delivery payable moved to platform delivery income; customer still not refunded the fee),
  `test_rider_not_third_party_at_pickup_gets_nothing`,
  `test_coupon_shortfall_pays_rider_in_full` (items 20.00, fee 15.00, coupon 30.00, customer paid 5.00: customer credit 0.00, rider 15.00 split 13.50/1.50, promo-subsidy credit 20.00 so AshantiHub nets 10.00 out; journals balance) and `test_coupon_covers_fee_no_shortfall` (customer credit = paid - fee).
  Also in `test_rider_refunds.py`: delete the reversal tests and replace with `test_no_reverse_earning_symbol_remains` (import check `not hasattr(riders, "reverse_earning")`).
  Model test in `backend/ledger/tests/test_models.py`: `test_wallet_pesewas_is_credit_after_kept_fee`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test ledger.tests.test_rider_refund_pay ledger.tests.test_rider_refunds ledger.tests.test_models` — Expected: FAIL.
- [ ] **Step 3: Implement** the interfaces above. Keep `riders.credit_delivery`, `split`, `accounts_of`, `post_day` unchanged. Replace the 7D module-text paragraph in `ledger/riders.py` and the `refunds.py` header bullets ("A third-party rider paid ..." and "Before release, a whole refund pays ...") with the new rule. Edit migration 0012 and the `OrderRefund` field comment (`# the delivery fee kept from the customer because the rider had picked up`).
- [ ] **Step 4: Run** `docker compose run --rm web python manage.py test ledger orders disputes delivery wallets` — Expected: PASS (fix any test that asserted the 7D remainder rule or a reversal).
- [ ] **Step 5: Commit** `feat(ledger): the delivery fee belongs to the rider once any pickup is done; goods refunds never return it`

### Task 2: A promo-covered delivery fee is paid by the promo's owner

**Files:**
- Modify: `backend/marketing/models_waivers.py` (`DeliveryWaiver.funded_by`, `WaivedFeeCharge.funded_by`; docstring), `backend/marketing/waivers.py` (`record_charge` copies `waiver.funded_by`), `backend/ledger/escrow.py` (`charge_waiver`, `waiver_accounts`), new migration `backend/marketing/migrations/00NN_waiver_funded_by.py`; Test: `backend/ledger/tests/test_promo_rider_pay.py`, `backend/marketing/tests/` (existing waiver tests unchanged)
- Reads (no change): `delivery.services` (checkout fee quote), `ledger/refunds.py` `subsidy_pesewas` (that is the customer **coupon**, `Order.discount_amount`, always AshantiHub's; it is a different thing from the delivery promo and stays untouched).

**Interfaces:**
- Findings the implementer must keep: today every free-delivery promo is a business's (`DeliveryWaiver.business_owner`, checkout `covering_waiver` allows one business only); the fee is charged to that business at release by `escrow.charge_waiver` (Dr vendor Available, Cr platform delivery income) and reversed on a whole refund (`return_waiver`, `marketing.waivers.reverse_for_order`). Before this task a promo order's rider was paid only at release (`riders.rider_for_release` `owed` branch) and never on a refund, which is the 7D final-review gap in gate (xciii).
- Produces `DeliveryWaiver.funded_by` and `WaivedFeeCharge.funded_by`, `CharField(max_length=8, choices=[("business","Business"),("platform","AshantiHub")], default="business")`; every existing and new waiver is `business`. No endpoint creates a `platform` promo yet (the field and the ledger path exist so a staff-created AshantiHub promo can be added without touching money code; recorded as an open question in Task 4).
- Changes `escrow.charge_waiver(order)`: debit account is `posting.account_for(Account.PLATFORM_PROMO_SUBSIDY)` when `charge.funded_by == "platform"`, else the business's `VENDOR_AVAILABLE` (as now); credit unchanged. Journal key and memo stay (`order-waiver-{order}`), memo names the funder. `escrow.waiver_accounts` returns the same accounts. `waiver_return_accounts`/`return_waiver` already read the debited line, so a platform promo returns to the subsidy account with no change.
- `settle_delivery` (Task 1) is the only new caller: it calls `charge_waiver` before `credit_delivery`, so a promo order's rider is paid `gross = waived amount` (+ any fee paid) at the first whole refund after pickup, funded by the promo's owner; `riders._taken_as_delivery_income` already counts the `waiver_key` credit.
- No pickup before the whole refund: unchanged path (`clears_promo`, `return_waiver`, `reverse_for_order`): the owner owes nothing and the rider is paid nothing.

- [ ] **Step 1: Failing tests** `test_promo_rider_pay.py`: `test_business_promo_whole_refund_after_pickup_debits_business_and_pays_rider` (waived 15.00 via `rider_helpers.waived`; business Available -15.00, rider 13.50 + reserve 1.50, customer refunded goods only), `test_platform_funded_promo_debits_subsidy_account`, `test_promo_refund_before_pickup_pays_nobody_and_reverses_charge`, `test_promo_partial_refund_moves_nothing_then_release_pays_rider_once`, `test_promo_with_in_house_rider_charges_owner_keeps_platform_income`, `test_funder_is_copied_at_checkout_not_read_from_waiver_later` (changing `DeliveryWaiver.funded_by` after the order does not change the charge), `test_return_waiver_credits_subsidy_for_platform_promo`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test ledger.tests.test_promo_rider_pay` — Expected: FAIL.
- [ ] **Step 3: Implement**, add the migration (both columns default `business`), `makemigrations --check` clean.
- [ ] **Step 4: Run** `docker compose run --rm web python manage.py test ledger marketing orders` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(ledger): a promo-covered delivery fee is paid to the rider by the promo's owner`

### Task 3: At most 3 withdrawals a day for a rider (governed setting)

**Files:**
- Modify: `backend/ledger/settings_store.py` (`DEFINITIONS`), `backend/ledger/approval_kinds.py` (`RIDER_SETTING_KEYS`, `setting_consequences`; `ledger.setting` still Super Admin only, sudo, as the 7A settings), `backend/wallets/withdrawals.py` (`request()`, new `next_reset(now)`), `frontend/components/admin/panels/moneyRulesFormat.js` (`GROUPS` "Riders"); Test: `backend/ledger/tests/test_settings_store.py`, `backend/ledger/tests/test_governance.py`, `backend/wallets/tests/test_withdrawal_engine.py`, `backend/wallets/tests/test_rider_api.py`, `frontend/components/admin/panels/moneyRulesFormat.test.js` (if the file exists beside it; else add to the existing Money rules page test)

**Interfaces:**
- Produces `settings_store.DEFINITIONS["rider_withdrawals_per_day"] = Definition("Withdrawals a rider may make per day (the day resets at midnight, Accra)", 3, False, 1, 20)`.
- Produces `approval_kinds.RIDER_SETTING_KEYS = ("rider_withdrawals_per_day",)` and a `setting_consequences` branch: "Applies to riders' withdrawals asked for after it starts. Withdrawals already made today still count." (The commission key `rider_commission_bp` keeps the default "orders paid after it starts" text.)
- Produces `wallets.withdrawals.next_reset(now) -> datetime`: the next 00:00 Africa/Accra after `now` (`start_of_day(now) + 1 day`, built in local time so it is correct across the date line of the day).
- Changes `withdrawals.request()`: for `isinstance(holder, StaffUser)` only, after the balance checks and inside the locked section beside the daily-amount check, count `mine(holder).filter(status__in=Withdrawal.COUNTED, created_at__gte=start_of_day(now))`; if `count >= settings_store.current("rider_withdrawals_per_day", now)` raise `WithdrawalError(f"You can make {limit} withdrawal{'s' if limit != 1 else ''} a day, and you have made {count} today. You can withdraw again from {time} tomorrow.", "daily_count_limit", 409, resets_at=next_reset(now).isoformat(), limit=limit)` with the time rendered as "00:00 (Accra)". A cancelled, failed or reversed withdrawal is not in `COUNTED` and frees the slot. The check runs under the same `posting.lock(source, transit)` as the amount check so two concurrent requests cannot both take the last slot.
- Frontend: `GROUPS` entry becomes `["Riders", ["rider_commission_bp", "rider_withdrawals_per_day"]]`; the rider wallet's withdrawal form (grep the component that reads `negative_balance`/`daily_limit` codes under `frontend/components/`) shows the refusal message as is (it already renders `detail`); add the `resets_at` line only if that component already renders `usable_from`-style extras, else leave the message to carry the time.

- [ ] **Step 1: Failing tests:** `test_rider_withdrawals_per_day_definition` (default 3, bounds 1 and 20, `clean` rejects 0 and 21), `test_rider_setting_consequence_text` and `test_rider_setting_needs_super_admin_and_sudo`, in `test_withdrawal_engine.py`: `test_rider_fourth_withdrawal_refused_with_code_and_reset_time` (code `daily_count_limit`, `resets_at` is next 00:00 Accra, nothing written), `test_cancelled_withdrawal_frees_a_slot`, `test_count_resets_at_midnight_accra` (freeze 23:59 then 00:01 Accra), `test_setting_change_applies_from_its_start`, `test_customer_and_vendor_not_capped_by_rider_setting`, `test_two_concurrent_requests_take_one_last_slot` (TransactionTestCase, like the existing concurrency tests there); in `test_rider_api.py`: `test_api_returns_409_with_code_and_resets_at`; frontend: `GROUPS lists rider_withdrawals_per_day under Riders` and `groupSettings never sends it to Other`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test ledger.tests.test_settings_store ledger.tests.test_governance wallets.tests.test_withdrawal_engine wallets.tests.test_rider_api` and, from `frontend/`, `npm run test -- moneyRulesFormat` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same commands plus `docker compose run --rm web python manage.py test wallets ledger` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(wallets): riders may make at most 3 withdrawals a day, governed setting`

### Task 4: Record the round-2 rulings in the spec and gates

**Files:** Modify `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (§13 gates (xciii), (xcviii); §3.3 settings list; §6/§7 rider text where the 7D rule is stated); `docs/superpowers/plans/2026-10-18-wallet-rulings-7d-riders-and-texts.md` (Global Constraints and Task 1 header: add "Superseded for Task 1's pay rule by plan 7F-D, 2026-10-19"); no code, `CLAUDE.md` untouched.

- [ ] **Step 1:** Edit the gates; no code:
  - (xciii): mark "DECIDED 2026-10-19 (round 2), supersedes 2026-10-18": delivery fee belongs to the rider after any pickup, goods refunds never return it, no pickup means whole refund returns it; rider paid via the usual 90/10 split; promo-covered fee paid by the promo's owner (business: debited from it; AshantiHub: promo subsidy account); coupon shortfall covered by AshantiHub (7D ruling 5 kept); `OrderRefund.delivery_kept_pesewas` replaces `rider_pesewas`; multi-stop "any pickup" replaces 7D ruling 7; the 7D final-review "promo-funded rider pay gap" note is closed; built by plan 7F-D Tasks 1-2. Keep the 2026-10-18 text as "superseded".
  - (xcviii): "DECIDED 2026-10-19: riders share the governed amount limits and are additionally capped at `rider_withdrawals_per_day` (default 3) withdrawals per Accra day; refusal code `daily_count_limit` with `resets_at`; built by plan 7F-D Task 3." Add the setting to the §3.3 list.
  - Open questions to list under (xciii): (a) in-house rider who picked up: fee kept as platform income (assumed); (b) a failed delivery re-assigned to a second rider: only the first rider with a pickup is paid, the fee is not paid twice; (c) a staff-created AshantiHub-funded free-delivery promo (field exists, no screen).
- [ ] **Step 2:** `git diff --stat` shows only the spec and the 7D plan changed.
- [ ] **Step 3: Commit** `docs(wallet): record the round-2 rider rulings against gates (xciii) and (xcviii)`

### Task 5: Post-merge — 7C staff approval events must carry the withdrawal amount

Do this only after 7C (`feature/wallet-rulings-7c`) and 7D (this branch plus 7F-D) are both merged into `righteoushack`; it cannot be done earlier because `backend/wallets/approval_kinds.py` exists only on the 7C branch and `withdrawals.event_amount` only on the 7D branch (merge order is 7E, 7C, 7D; expect the conflict in `backend/wallets/views_staff.py` and the spec).

**Files:** Modify `backend/wallets/approval_kinds.py` (the staff "fail" and "paid" approval apply/record paths for a stuck PROCESSING withdrawal), `backend/wallets/views_staff.py` (resolve the merge so both the 7C approval path and 7D's `event_amount` usage at the former lines ~246 and ~276 survive); Test: `backend/wallets/tests/test_staff_withdrawals.py` (or 7C's approval test file, same folder)

**Interfaces:** Each `activity.services.record(...)` call in those apply functions adds `**withdrawals.event_amount(withdrawal)` to its `after` dict (keys `amount`, `amount_label`; never the payout number, reason still through `mask_numbers`).

- [ ] **Step 1: Failing tests:** `test_staff_paid_approval_event_carries_amount`, `test_staff_fail_approval_event_carries_amount`, `test_approval_events_never_contain_payout_number`.
- [ ] **Step 2: Run** `docker compose run --rm web python manage.py test wallets.tests.test_staff_withdrawals` — Expected: FAIL.
- [ ] **Step 3: Implement** by importing `withdrawals` in `approval_kinds.py` and spreading `event_amount` into the two events' `after`.
- [ ] **Step 4: Run** `docker compose run --rm web python manage.py test wallets approvals activity` — Expected: PASS.
- [ ] **Step 5: Commit** `fix(wallets): staff paid and fail approval events carry the withdrawal amount`

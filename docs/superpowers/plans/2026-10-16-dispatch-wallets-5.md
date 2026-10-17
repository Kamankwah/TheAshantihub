# Third-Party Dispatch Wallets and Daily Commission — Implementation Plan (Stage 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A rider can be marked third-party (from a rider company, not an AshantiHub employee) through a Super Admin approval; when Support's verification call releases an order a third-party rider delivered, the order's delivery fee is paid into that rider's wallet — 90% withdrawable at once, 10% held as AshantiHub's commission and posted to platform income at the end of the Accra day — reversed correctly by refunds, withdrawable through the Stage 3b destination/withdrawal engine with step-up codes, readable by the rider (own rows only) and by `wallets.view` staff. AshantiHub's own riders keep no wallet (`409 wallet_disabled`). All behind `LEDGER_ENABLED` (default off), simulated rails, backend only.

**Architecture:** `delivery.Rider` gains an employment flag changed only through a new `delivery.rider_employment` approval kind. A new `ledger/riders.py` pays the rider inside `escrow.release_verified`'s transaction, after the release and the free-delivery charge, with its own journal (`order-rider-<order>`: Dr platform delivery income, Cr rider balance 90%, Cr rider reserve 10%), records a `delivery.RiderEarning`, reverses it when the whole order is refunded after release, and posts each day's reserve to platform commission income from a Celery beat job (`delivery.RiderCommissionPosting`). Rider ledger accounts are held by the rider's staff account, so the Stage 3b engine (`wallets.destinations`, `withdrawals`, `payouts`) serves riders with small holder-type branches; the rider API lives beside the rider app at `/api/delivery/rider/wallet/`.

**Tech Stack:** Django 5.2, DRF, Postgres, Celery beat (eager under tests), the repo's `delivery`, `ledger`, `wallets`, `otp`, `approvals`, `activity`, `notifications` apps.

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` — §1 rows 4 (delivery on top, one fee, wholly to a third-party rider or AshantiHub), 5 (10% reserve per delivery credit, 90% withdrawable at once, end-of-day posting), 14 (riders bear their withdrawal charges), 16 (governance); §2.1 (Rider balance, Rider commission reserve, platform commission income); §2.2 steps 2(c), 4, 5, 6 and "Company riders have no wallet"; §3.3 (the rider commission rate is a governed setting; changes apply to orders paid after they start); §4.1 (release follows Support's verification call, no timer); §7; §8; §9; §11 step 5; §13. Deviations are in §0 below; Task 1 records them in the spec.

**Depends on:** Stages 1, 2, 3a and 3b, all on `origin/righteoushack` (base commit `d26dd54`). From them: `ledger.posting` (`post(..., allow_negative=...)`, `lock`, `account_for`, `balance_of`, `InsufficientFunds`), `ledger.escrow` (`release_verified`, `charge_waiver`, `return_waiver`, `waiver_accounts`, `waiver_return_accounts`, `pay_key`, `release_key`, `waiver_key`), `ledger.refunds` (`refund_order`, `_post`, `_free_promo`), `ledger.settings_store` (`rider_commission_bp`, default 1000, already governed by the `ledger.setting` approval), `ledger.verification.record`, the `wallets` app (`destinations`, `withdrawals`, `payouts`, `names`, `views_payouts`, `views_staff`, `views.ledger_off` / `OFF` / `Pagination`, `services.money`), `otp.step_up` (`WITHDRAWAL`, `PAYOUT_DESTINATION`), `otp.views_step_up._codes_off`, the `wallets.view` permission (accounts migration 0054).

**Branch and worktree:** `feature/dispatch-wallets-5` in `/home/righteoushack/projects/TheAshantihub/.worktrees/dispatch5` (from `origin/righteoushack`). Every command below runs from that directory.

## 0. Decisions and reconciliation with the code

| # | Question | Decision | Why (grounded in the code) |
|---|---|---|---|
| R1 | The third-party flag (none exists today) | `delivery.Rider` gains `employment` (`ashantihub` — the default, so every existing rider is unchanged — or `third_party`), a free-text `company_name` (required for third-party) and `third_party_since` (when the current third-party engagement started; null for AshantiHub's own). **No `RiderCompany` table.** | Surveyed: `delivery/models.py` has `Rider` (one row per Dispatch `StaffUser`, made by `delivery.signals`), `Vehicle.owner_kind` and nothing about who employs a rider; its docstring says "no payout, payroll or ledger model". `docs/IMPLEMENTATION_INSTRUCTIONS.md` row 5 names a "`Rider` employment flag". The spec pays the rider personally (§2.1 Rider balance per rider; §8 destinations name-matched to the holder), so nothing in the money keys on the company; a company record is only needed if a company itself is contracted or paid (owner question, gate (xcix)). |
| R2 | Who changes it | A new approval kind `delivery.rider_employment` (`delivery/employment.py`): a Delivery Manager (`delivery.fleet`) proposes at `POST /api/delivery/riders/<id>/employment/`, a Super Admin approves with the password (`requires_sudo`); a Super Admin's own proposal for another rider applies at once and now needs the password too (`sessions.require_sudo`, as for the recovery kind). Nobody may change their own employment (`own_rider` 403, a Super Admin included) and only a Dispatch role holder can be third-party (`not_a_rider` 409). One pending request per rider (best effort: the approval re-checks at decision time). | The flag routes delivery fees from AshantiHub's income to a third party's withdrawable money: a money decision (spec §1 row 16; backend/CLAUDE.md "Approvals: the maker never decides"). Every other fleet edit (`RiderDetailView.patch`, `RiderJobHoldView`) is one Delivery Manager alone, which must not hold here. |
| R3 | Switching back to AshantiHub's own | Refused (`409 rider_money_open`, with `open`: `balance`, `reserve`, `withdrawal`, `deliveries`) while the rider's balance is not zero, a reserve is still held, a withdrawal is open, or a door-to-door order they delivered as third-party is paid in the ledger but not yet released (and not refunded whole). Checked when proposed, again when approved (`validate`), and again in `apply` under the rider row's lock; a release takes the same row lock before paying a rider. | "AshantiHub-own riders have wallets disabled": a wallet must never close with money in it, and a delivery made as third-party must not silently become AshantiHub's income. |
| R4 | When the rider is credited | **At release only**: Support's positive verification call (`ledger.verification.record` → `escrow.release_verified`), in the release's own transaction, never at the doorstep or on a timer. The rider is the assignment's `dispatch` when the order is door to door, the assignment is not `FAILED`, `delivered_at` is set, and that rider was third-party at `delivered_at` (inside one of their `RiderEmploymentPeriod` rows; a later switch back does not change it). | Spec §2.2 step 2(c) puts the rider's 90/10 inside the release, and §4.1 releases only on the call. `orders.DeliveryAssignment` is one-to-one with the order and a re-dispatch replaces `dispatch` on the same row (`delivery.services.assign` refuses once delivered), so the row names the rider who delivered; a failed attempt earns nothing (its fee goes to whoever delivers). `escrow.release_verified` already says "then any third-party rider (Stage 5)". The wait for Support's call is an owner question (gate (c), RA12). |
| R5 | What the rider is paid, and how it is posted | The whole delivery fee AshantiHub took at release: what the release credited to platform delivery income (the Delivery payable) plus the business's free-delivery promo charge (`charge_waiver`). One journal right after both, same transaction: `order-rider-<order>` (kind `rider_earning`): Dr platform delivery income gross, Cr rider balance net, Cr rider reserve reserve. Recorded on a `delivery.RiderEarning` row. The rate-card `DeliveryAssignment.rider_pay` is not what a third-party rider is paid; it stays a payroll record for AshantiHub's own riders. | §1 row 4: the fee "goes wholly to the rider (third party)". Posting through platform delivery income leaves `release_verified`, `charge_waiver` and every Stage 3a refund path as they are (a refund after release already takes the fee back from platform delivery income); both journals commit together, so §2.2's "one atomic release" holds. |
| R6 | Rate, rounding, true-up | reserve = gross × `rider_commission_bp` ÷ 10,000, half up; net = gross − reserve. The rate is the one in force **when the order was paid** (the `order-pay-<order>` journal's `created_at`), kept on the earning. The end-of-day posting sums stored reserves, so **no true-up** is needed. The setting is the existing Stage 1 `rider_commission_bp` (default 1000, 0–10000), changed through the `ledger.setting` approval (Accounting proposes, Super Admin approves) — **not** a new `dispatch_commission_bp`. | §3.3: a change "takes effect only for orders paid after its effective time" (and `ledger.approval_kinds.setting_consequences` already tells the approver exactly that for this key, pinned in `wallets/tests/test_guards.py`). §1 row 5's true-up assumed the reserve was computed at end of day. A second key with the same meaning could disagree with the first. |
| R7 | Whose accounts | `rider_balance` and `rider_reserve` (Stage 1 kinds, unused so far) held by the rider's `StaffUser` (`accounts.staffuser:<pk>`). Destinations and withdrawals name the holder `("staff", pk)` (`otp.identity.ref`). | A rider signs in as staff (`delivery.views_rider.RiderView`, `delivery.dispatch`); every Stage 3b helper keys on the signed-in account through `ref()` and `posting.account_for(kind, holder)`. |
| R8 | End of day | Celery beat at 00:20 Accra: `ledger.tasks.post_rider_commission` → `riders.post_commission(today)`: for each (rider, day) with earnings of a day before today that are neither posted nor reversed (so a missed night is caught up), lock those earning rows, post `rider-commission-<staff pk>-<YYYY-MM-DD>-<first earning pk>` (kind `rider_commission`: Dr rider reserve, Cr platform commission income) and write a `delivery.RiderCommissionPosting` (day, deliveries, gross, commission, net). Idempotent (rows re-filtered under their lock); a 0% day gets a row and no journal; a no-op while the ledger is off. | §2.2 step 6: "Reserve posted to commission income; day's gross, commission and net recorded". Lessons (xxxviii) and (lxxxix): a missed night must not be lost. |
| R9 | Refunds and failed deliveries | **Before release:** the rider was never paid; a whole refund returns the delivery fee to the customer (Stage 3a W4, unchanged), so the rider earns nothing for that delivery. **After release:** a partial refund never touches the rider (the fee comes back only with the whole order, W4); a whole refund first reverses the earning (`order-rider-reversal-<order>`, kind `rider_earning_reversal`: Dr rider balance net — it may go below zero, recovered from later deliveries, and then blocks withdrawals — Dr the reserve, or platform commission income once the day was posted, Cr platform delivery income), then the refund takes the fee from platform delivery income as before. The same reversal runs in `_free_promo` (an emptied promo order whose promo goes back to the business). A reversed earning is never posted at end of day. A failed delivery earns nothing. | §2.2 step 6: "A reversed delivery reverses its share of the reserve"; W4. Without the reversal, platform delivery income would be debited for a fee it passed on (`posting.post` refuses: `InsufficientFunds`). Owner question RA3. |
| R10 | Withdrawals and the name check | The Stage 3b engine as it is: a rider withdraws `rider_balance` only (never the reserve); a negative balance blocks it; the same governed limits per holder account, cooling period and holder-borne charge; a held withdrawal is returned instead of sent if the rider stopped being third-party, was suspended or deactivated, or their card lapsed. The rider's verified name is their staff `full_name` once an **approved, in-date Ghana Card** is on file (`RiderDocument.GHANA_CARD`); before that `409 id_required`. | §8. The Ghana Card is the only identity check riders have (`delivery.services.REQUIRED_DOCUMENTS`, reviewed by the Delivery Manager). |
| R11 | Step-up for riders | A third-party rider may ask the step-up endpoints for `withdrawal` and `payout_destination` codes only, and only while the ledger is on; every other staff member still gets 403 (they use sudo). The rider endpoints call `step_up.require(..., force=True)` as the 3b views do. | §9 "OTP mandatory for everyone" before a withdrawal. O4's "staff use sudo" was for office staff. `otp.identity.contacts` and `otp.service` already handle staff accounts (`GUESS_LOCK_NAMESPACE["staff"]`). |
| R12 | API, isolation and the activity log | Rider endpoints under `/api/delivery/rider/wallet/` (`delivery.dispatch`; `409 ledger_off` first, then `409 wallet_disabled`), always the caller's own rows. The write views are `activity_exempt` and record their own event, without the number, inside the transaction that saves (a `saved()` hook added to `wallets.views_payouts`). Staff reads: `GET /api/wallet/staff/wallets/?kind=rider`, rider names in `GET /api/wallet/staff/withdrawals/`, `GET /api/delivery/riders/<id>/wallet/`, `GET /api/delivery/rider-commission/?day=` — all `wallets.view`. | Riders are staff: `activity.middleware.StaffActivityMiddleware` wraps every staff write in a transaction and stores its body, which would put the account number in the append-only log and the name lookup and payout inside a transaction (backend/CLAUDE.md: never). Plan 4 (PR #153) owns `wallets/urls.py` edits, so the new routes live in `delivery/urls.py`; `wallets/views_staff.py` is untouched by Plans 1b and 4. |
| R13 | Reconciliation | No change. | Rider earnings, reversals and commission never touch provider clearing; rider withdrawals post the same `withdrawal-*` journals the nightly run compares, and the simulated statement lists every `Withdrawal` whatever its holder (`payments/providers.py`). |
| R14 | Where the code lives | `delivery/models.py` (`Rider` fields; `RiderEarning`, `RiderCommissionPosting`; migrations `delivery/0007_rider_employment`, `0008_rider_earnings`), `delivery/employment.py` (flag, approval kind), `ledger/riders.py` (money), `wallets/rider_wallet.py` (reads), `wallets/views_rider_wallet.py` (API). | Plan 1b (PR #152) adds `ledger/0008`, Plan 4 adds `wallets/0005`; `delivery` migrations are at 0006 on every branch, so these never collide. A rider's money record sits with the rider. |

## Global Constraints

- Money is integer pesewas, converted only through `ledger.money`; a balance changes only through `ledger.posting.post`; journals and lines are never edited (a correction is a new reversing journal).
- `LEDGER_ENABLED` (default off) gates everything: with it off no rider is credited, the end-of-day job is a no-op, and every new endpoint answers `409 {"code": "ledger_off"}`. Rider wallet endpoints then answer `409 {"code": "wallet_disabled"}` for AshantiHub's own riders.
- **Lock order:** the order row, its fee snapshots, then the rider row (release) or the earning row (refund), then every ledger account in one sorted pass (`posting.lock`), including the accounts of every later posting in the same transaction. The end-of-day job locks the rider row first (its commit-time foreign key check from `RiderCommissionPosting.rider` waits for a `FOR UPDATE` holder, and a release or switch back holds the rider row then wants the reserve), then the day's earning rows, then the accounts. A refund locks the earning row, so it must NOT insert any row with a foreign key to `Rider` (a notice keyed on Rider, say) after that, or the cycle returns. `select_for_update(of=("self",))` whenever a query joins (never lock a `StaffUser` or `BusinessOwner` row by accident, except `wallets.destinations.save`'s deliberate no-key lock on the holder row, which for a rider is the `StaffUser` row).
- New journal keys and kinds: `order-rider-<order>` (`rider_earning`), `order-rider-reversal-<order>` (`rider_earning_reversal`), `rider-commission-<staff pk>-<YYYY-MM-DD>-<first earning pk>` (`rider_commission`).
- The commission rate is the existing money setting `rider_commission_bp` (default 1000 = 10%), changed only through the `ledger.setting` approval.
- Payout account and MoMo numbers leave the server only through `accounts.serializers.mask_but_last`; never in a log line, an activity event, a fraud case or a notice. Rider wallet write views are `activity_exempt`.
- No provider call runs inside a database transaction (name lookup, payout, status).
- Owner-scoped isolation: a rider endpoint reads only `request.user`'s rows; another rider's withdrawal answers 404.
- Simulated rails only. Never deploy, never touch staging or production, never turn `LEDGER_ENABLED` on outside tests.
- Commands, from `/home/righteoushack/projects/TheAshantihub/.worktrees/dispatch5`: `docker compose -p disp1 run --rm web python manage.py test <label> --noinput`. Never two docker commands at once. Migrations are generated with `docker compose -p disp1 run --rm --user "$(id -u):$(id -g)" web python manage.py makemigrations ...` (the `--user` keeps the file yours: spec §13 (lii)); if the container cannot run as your user, drop `--user` and `sudo chown "$(id -u):$(id -g)"` the new file before committing.
- Migrations: `delivery/0007_rider_employment.py` (Task 1) and `delivery/0008_rider_earnings.py` (Task 2), both generated. No `ledger`, `wallets` or `accounts` migration.
- **In-flight branches.** Plan 4 (PR #153) inserts `vendor_texts.order_released(order, journal)` right after `charge_waiver(order)` in `escrow.release_verified`, where Task 2 inserts `riders.credit_delivery(order, rider, now)`: whichever merges second keeps both lines, the rider credit first. Plans 1b and 4 also append to the end of spec §13 and edit the stage index lines in `CLAUDE.md` and the spec header: if either merged first, append after their sections and fold the Stage 5 words into their wording. Plan 6 also appends gates after (xc): Plan 5 keeps (xci)-(c) and Plan 6 renumbers to start at (ci).
- Every commit message ends with these two trailer lines (each commit step below shows them):
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j`
- Style: module docstrings, no type annotations, plain words in user-facing messages, tests in each app's `tests/`.

## Review Focus

1. **A whole refund after release, after the rider already withdrew** — the earning is taken back, the rider's balance goes below zero, further withdrawals are refused (`negative_balance`, "recovers from your next deliveries"), and AshantiHub never ends short (platform delivery income and commission income end at 0); the rider is told in-app that the delivery was taken back, and the day's commission shown as given back. Pinned in Task 4 (`test_review_focus_a_rider_who_already_withdrew_goes_below_zero`) and Task 5 (`test_review_focus_a_negative_balance_blocks_withdrawal`).
2. **The commission rate changed between payment and release** — each earning keeps the rate in force when its order was paid; the end-of-day posting needs no true-up. Pinned in Task 2 (`test_review_focus_the_rate_is_the_one_in_force_when_the_order_was_paid`).
3. **The end-of-day job run twice, at the same time, after a missed night, or racing a refund** — each reserve is posted exactly once and never taken twice. Pinned in Task 3 (`test_review_focus_end_of_day_posts_each_riders_reserve_once`, `test_review_focus_a_missed_night_is_caught_up_day_by_day`, `ConcurrentEndOfDayTests.test_review_focus_two_runs_at_once_post_once`) and Task 4 (`ConcurrentRiderRefundTests.test_review_focus_a_refund_racing_the_end_of_day_never_takes_the_commission_twice`).
4. **Employment changing around a delivery** — a delivery made before the rider became third-party stays AshantiHub's; switching back is refused while money is open; AshantiHub's own riders get `wallet_disabled` everywhere. Pinned in Task 1 (`test_review_focus_switching_back_is_refused_while_the_rider_has_money`, `test_review_focus_the_manager_proposes_and_only_a_super_admin_makes_a_rider_third_party`, `test_a_super_admin_cannot_make_themselves_third_party`), Task 2 (`test_review_focus_a_delivery_made_before_the_rider_became_third_party_stays_with_ashantihub`, `test_a_redispatched_delivery_pays_the_rider_who_delivered`, `test_a_skipped_shops_refund_still_pays_the_rider_the_whole_fee`, and the threaded `ConcurrentReleaseSwitchBackTests.test_review_focus_a_release_and_a_switch_back_never_close_a_paid_wallet` for the rider row lock) and Task 6 (`test_review_focus_an_ashantihub_rider_is_told_wallets_are_off_everywhere`).
5. **Isolation and number leaks** — a rider sees only their own earnings, statement and withdrawals; no response, staff read or activity event holds a whole account number. Pinned in Task 6 (`test_review_focus_each_rider_sees_only_their_own_earnings_and_statement`, `test_review_focus_a_rider_cannot_cancel_another_riders_withdrawal`, `test_review_focus_a_rider_adds_a_destination_with_a_code_and_withdraws`) and Task 7 (`test_review_focus_staff_see_rider_balances_with_wallets_view_only`).
6. **A rider with no checked identity** — no approved, in-date Ghana Card: no destination (`id_required`). Pinned in Task 5 (`test_review_focus_without_an_approved_ghana_card_no_destination`).
7. **A delivered order refunded whole before release** — the customer gets everything back and the rider is paid nothing (and no empty rider account is opened). Pinned in Task 4 (`test_review_focus_a_whole_refund_before_release_pays_the_rider_nothing`).

## Assumptions made (decided here, cheap to change — for the owner to confirm)

- **RA1** Third-party is a flag per rider with a free-text rider company; there is no company record and no payment to a company (each rider is paid personally).
- **RA2** A Delivery Manager proposes the flag and a Super Admin approves it (password); existing riders stay AshantiHub's own.
- **RA3** A rider is paid only for deliveries whose order money is released by Support's call. If the order is refunded whole — before release, or after it (then the earning is taken back and the balance may go below zero, recovered from later deliveries) — the rider is paid nothing for it, even when the business was at fault.
- **RA4** The commission rate is the one in force when the order was paid; there is no end-of-day true-up.
- **RA5** The 10% reserve is rounded half up per delivery and posted at 00:20 Accra time for every earlier day; a missed night is caught up.
- **RA6** A delivery made before the rider became third-party stays AshantiHub's, even if it is released later.
- **RA7** A third-party rider's verified name is their staff name, once an approved, in-date Ghana Card is on file.
- **RA8** Riders share the customers' and vendors' withdrawal limits (GH₵ 5,000 per withdrawal, GH₵ 10,000 a day per account), 24-hour cooling and the holder-borne withdrawal charge.
- **RA9** Riders confirm wallet actions with a texted or emailed code, like customers and vendors (not with their password).
- **RA10** A delivery fee a business covered with its free-delivery promo is paid to the rider like a fee the customer paid.
- **RA11** A rider cannot be switched back to AshantiHub's own while they hold money, a withdrawal is on its way, or a delivered order still waits for Support's call.
- **RA12** A third-party rider is paid when Support's call releases the order, which may be days after delivery, or never when the customer cannot be reached; "withdrawable immediately" runs from release (spec gate (c)).

## File Structure

Create:
- `backend/delivery/employment.py` (Task 1), `backend/delivery/migrations/0007_rider_employment.py` (Task 1, generated), `backend/delivery/migrations/0008_rider_earnings.py` (Task 2, generated)
- `backend/ledger/riders.py` (Tasks 2–4)
- `backend/wallets/rider_wallet.py` (Task 6), `backend/wallets/views_rider_wallet.py` (Tasks 6–7)
- Tests: `backend/delivery/tests/test_employment.py` (1), `backend/ledger/tests/rider_helpers.py` and `test_rider_release.py` (2), `test_rider_commission.py` (3), `test_rider_refunds.py` (4), `backend/wallets/tests/test_rider_engine.py` (5), `test_rider_api.py` (6), `test_rider_staff.py` (7)

Modify:
- `backend/delivery/models.py` (1, 2), `apps.py` (1), `fleet.py` (1), `views_fleet.py` (1), `urls.py` (1, 6, 7), `views_rider.py` (6), `views_rules.py` and `views_rider_money.py` (6: payroll leaves out third-party deliveries)
- `backend/ledger/escrow.py` (2), `refunds.py` (4), `tasks.py` (3); `backend/ashantihub/settings.py` (3: beat entry)
- `backend/wallets/names.py`, `destinations.py`, `withdrawals.py`, `payouts.py` (5), `views_payouts.py` (6), `views_staff.py` (7), `tests/test_staff_wallets.py` (7); `backend/otp/views_step_up.py` and `backend/otp/step_up.py` (5)
- `backend/CLAUDE.md`, `CLAUDE.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md` (8), `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (1, 8)

API added or changed:

| Method + path | Who | Body → answer |
|---|---|---|
| `POST /api/delivery/riders/<id>/employment/` | `delivery.fleet` | `{employment: "ashantihub" \| "third_party", company_name, note}` → 201 `{approval_id, status, employment}` (`status` `approved` when a Super Admin proposed it); 400 `invalid` (+`field`); 403; 409 `no_change` / `already_pending` / `rider_money_open` (+`open`) / `not_a_rider`; 403 `own_rider` |
| `GET /api/delivery/riders/<id>/` | changed | + `employment: {employment, employment_label, company_name, third_party_since, wallet, pending}` |
| `GET /api/delivery/rider/me/` | changed | `rider` + `employment`, `wallet` |
| `GET /api/delivery/rider/wallet/` | `delivery.dispatch`, third-party | → `{kind: "rider", balance, reserve, reserve_note, commission_bp, company_name, awaiting_release}` |
| `GET /api/delivery/rider/wallet/earnings/?day=YYYY-MM-DD` | same | → paginated `{id, order, delivered_at, earned_at, earned_on, gross, commission_bp, commission, you_got, status, status_label, reversed_at}`; 400 bad day |
| `GET /api/delivery/rider/wallet/days/` | same | → `{results: [{day, deliveries, gross, commission, net, given_back}]}` (last 30 posted days) |
| `GET /api/delivery/rider/wallet/statement/` | same | → paginated `{id, at, account: balance \| reserve, kind, label, direction, amount, order, reference}` |
| `GET/POST /api/delivery/rider/wallet/destinations/`, `POST .../destinations/<id>/remove/`, `GET/POST .../withdrawals/`, `POST .../withdrawals/<id>/cancel/` | same + `X-Step-Up-Token` on writes | exactly as `/api/wallet/` (Stage 3b), plus 409 `id_required` (no approved Ghana Card); a rider's withdrawal draws on the balance only |
| every `/api/delivery/rider/wallet/*` | — | 409 `ledger_off` while the ledger is off; 409 `wallet_disabled` for AshantiHub's own riders; 403 for staff without `delivery.dispatch` |
| `POST /api/otp/step-up/send/`, `verify/` | changed | a third-party rider may ask for `withdrawal` / `payout_destination` codes while the ledger is on (`otp_off` for every other action); other staff 403 as before |
| `GET /api/wallet/staff/wallets/?kind=rider` | `wallets.view` | → paginated `{holder_id, rider_id, name, company_name, employment, balance, reserve}`, largest balance first |
| `GET /api/wallet/staff/withdrawals/` | changed | `holder_name` filled for riders (`holder_type` `staff`) |
| `GET /api/delivery/riders/<id>/wallet/` | `wallets.view` | → `{rider: {...}, <summary>, earnings: [last 20], days: [last 30]}` |
| `GET /api/delivery/rider-commission/?day=YYYY-MM-DD` | `wallets.view` | → `{day, results: [... + given_back], totals: {deliveries, gross, commission, net, given_back}}` (default: yesterday, Accra); 400 bad day |

---

### Task 1: The third-party flag, its approval and the fleet API; the spec addendum

**Files:**
- Modify: `backend/delivery/models.py` (`Rider`), `backend/delivery/apps.py`, `backend/delivery/fleet.py` (`profile`), `backend/delivery/views_fleet.py`, `backend/delivery/urls.py`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (append)
- Create: `backend/delivery/employment.py`, `backend/delivery/migrations/0007_rider_employment.py` (generated), `backend/delivery/tests/test_employment.py`

**Interfaces:**
- Consumes: `approvals.services.submit(maker, kind_key, *, title, payload, target=None, maker_note="", request=None)`, `approvals.services.approve(approval_id, staff, note="", http_request=None)`, `approvals.registry.ApprovalKind`, `ledger.posting.balance_of`, `wallets.models.Withdrawal.OPEN`, `otp.identity.ref`, `activity.services.record`.
- Produces:
  - `Rider.ASHANTIHUB = "ashantihub"`, `Rider.THIRD_PARTY = "third_party"`, `Rider.EMPLOYMENT_CHOICES`; fields `Rider.employment`, `Rider.company_name`, `Rider.third_party_since`, and the model `delivery.RiderEmploymentPeriod` (`rider`, `started_at`, `ended_at`; related name `employment_periods`)
  - `delivery.employment.KIND = "delivery.rider_employment"`, `WALLET_DISABLED` (str), `OPEN_LABELS` (dict)
  - `EmploymentError(message, code, status_code=400, field=None, **extra)` with `.body()`
  - `is_third_party(rider) -> bool`, `wallet_rider(staff) -> Rider | None`, `id_verified(rider, today=None) -> bool`, `unreleased_deliveries(rider) -> QuerySet[DeliveryAssignment]`, `payroll_jobs(jobs) -> QuerySet[DeliveryAssignment]`, `third_party_at(rider, when) -> bool`, `money_open(rider, lock=False) -> list[str]`, `clean(data) -> (employment, company_name)`, `check(rider, employment, company, maker=None, lock=False)`, `pending_for(rider) -> ApprovalRequest | None`, `propose(maker, rider, data, *, note="", request=None) -> ApprovalRequest`, `row(rider) -> dict`, `EMPLOYMENT_KIND` (registered in `DeliveryConfig.ready`)
  - `POST /api/delivery/riders/<id>/employment/`; `fleet.profile(rider)["employment"]`

- [ ] **Step 1: Write the failing test** — `backend/delivery/tests/test_employment.py`

```python
"""Who a rider works for (wallets Plan 5, Task 1; spec §1 rows 4-5, §7): AshantiHub's own by default, third-party only
through the delivery.rider_employment approval, and never switched back while money is open. Review Focus 4."""
from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

from django.db import transaction
from django.test import override_settings
from django.utils import timezone

from accounts.models import StaffUser
from accounts.testing import make_staff
from approvals import registry
from approvals import services as approvals
from approvals.models import ApprovalRequest
from approvals.services import MakerCannotDecide
from delivery import employment
from delivery.models import Rider, RiderEmploymentPeriod
from ledger import escrow, posting
from ledger.models import Account
from orders.models import DeliveryAssignment, Order

from .base import DeliveryCase

URL = "/api/delivery/riders/{}/employment/"


class EmploymentTests(DeliveryCase):
    def super_admin(self):
        return StaffUser.objects.filter(email="sa@example.com").first() or make_staff("super_admin", "sa@example.com")

    def propose(self, staff, body, rider=None):
        sudo = staff.role.name == "super_admin"                       # a Super Admin's own change needs the password
        return self.as_staff(staff, sudo=sudo).post(URL.format((rider or self.rider).pk), body, format="json")

    def make_third_party(self):
        self.rider.employment, self.rider.company_name = Rider.THIRD_PARTY, "Swift Riders Ltd"
        self.rider.third_party_since = timezone.now() - timedelta(days=3)
        self.rider.save(update_fields=["employment", "company_name", "third_party_since"])
        RiderEmploymentPeriod.objects.create(rider=self.rider, started_at=self.rider.third_party_since)

    def fund_rider(self, pesewas, key="fund-rider"):
        posting.post(key=key, kind="test_fund", lines=[
            posting.debit(posting.account_for(Account.PROVIDER_CLEARING), pesewas),
            posting.credit(posting.account_for(Account.RIDER_BALANCE, self.rider_staff), pesewas),
        ])

    def test_a_new_rider_is_ashantihubs_own_and_has_no_wallet(self):
        self.assertEqual(self.rider.employment, Rider.ASHANTIHUB)
        self.assertIsNone(employment.wallet_rider(self.rider_staff))
        profile = self.as_staff(self.manager).get(f"/api/delivery/riders/{self.rider.pk}/").json()
        self.assertEqual((profile["employment"]["employment"], profile["employment"]["wallet"]), ("ashantihub", False))
        self.assertIsNone(profile["employment"]["pending"])

    def test_review_focus_the_manager_proposes_and_only_a_super_admin_makes_a_rider_third_party(self):
        response = self.propose(self.manager, {"employment": "third_party", "company_name": "Swift Riders Ltd"})
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["status"], ApprovalRequest.PENDING)
        self.assertEqual(response.json()["employment"]["pending"]["company_name"], "Swift Riders Ltd")
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.employment, Rider.ASHANTIHUB)                         # nothing changes until approved
        with self.assertRaises(MakerCannotDecide):
            approvals.approve(response.json()["approval_id"], self.manager)               # the maker never decides
        approvals.approve(response.json()["approval_id"], self.super_admin())
        self.rider.refresh_from_db()
        self.assertEqual((self.rider.employment, self.rider.company_name), (Rider.THIRD_PARTY, "Swift Riders Ltd"))
        self.assertIsNotNone(self.rider.third_party_since)
        self.assertEqual(employment.wallet_rider(self.rider_staff), self.rider)

    def test_a_super_admins_own_change_applies_at_once(self):
        response = self.propose(self.super_admin(), {"employment": "third_party", "company_name": "Swift Riders Ltd"})
        self.assertEqual((response.status_code, response.json()["status"]), (201, ApprovalRequest.APPROVED))
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.employment, Rider.THIRD_PARTY)

    def test_a_third_party_rider_needs_a_company_and_a_second_request_waits(self):
        blank = self.propose(self.manager, {"employment": "third_party", "company_name": " "})
        self.assertEqual((blank.status_code, blank.json()["field"]), (400, "company_name"))
        unknown = self.propose(self.manager, {"employment": "freelance"})
        self.assertEqual((unknown.status_code, unknown.json()["field"]), (400, "employment"))
        same = self.propose(self.manager, {"employment": "ashantihub"})
        self.assertEqual((same.status_code, same.json()["code"]), (409, "no_change"))
        self.assertEqual(self.propose(self.manager, {"employment": "third_party", "company_name": "Swift"}).status_code, 201)
        again = self.propose(self.manager, {"employment": "third_party", "company_name": "Other Riders"})
        self.assertEqual((again.status_code, again.json()["code"]), (409, "already_pending"))

    def test_a_rider_cannot_change_their_own_employment(self):
        # a rider lacks delivery.fleet, so the permission refuses first (own_rider is tested for a Super Admin below)
        self.assertEqual(self.propose(self.rider_staff, {"employment": "third_party", "company_name": "Me Ltd"}).status_code, 403)

    def test_a_super_admin_cannot_make_themselves_third_party(self):
        sa = self.super_admin()
        own = Rider.objects.get_or_create(staff=sa)[0]                    # any Dispatch holder gets a Rider row; a Super Admin holds every permission
        body = {"employment": "third_party", "company_name": "Me Ltd"}
        mine = self.as_staff(sa, sudo=True).post(URL.format(own.pk), body, format="json")
        self.assertEqual((mine.status_code, mine.json()["code"]), (403, "own_rider"))
        other = StaffUser.objects.filter(email="sa2@example.com").first() or make_staff("super_admin", "sa2@example.com")
        not_a_rider = self.as_staff(other, sudo=True).post(URL.format(own.pk), body, format="json")   # the row's owner is no Dispatch rider
        self.assertEqual((not_a_rider.status_code, not_a_rider.json()["code"]), (409, "not_a_rider"))
        own.refresh_from_db()
        self.assertEqual(own.employment, Rider.ASHANTIHUB)

    @override_settings(LEDGER_ENABLED=True)
    def test_the_approval_needs_the_password_and_says_what_it_does(self):
        kind = registry.get_kind(employment.KIND)
        self.assertTrue(kind.requires_sudo)
        said = kind.consequences(SimpleNamespace(payload={"employment": "third_party"}))[0]
        self.assertIn("10%", said)
        self.assertIn("stay with payroll", said)
        self.assertIn("payroll", kind.consequences(SimpleNamespace(payload={"employment": "ashantihub"}))[0])

    @override_settings(LEDGER_ENABLED=True)
    def test_review_focus_switching_back_is_refused_while_the_rider_has_money(self):
        self.make_third_party()
        self.fund_rider(900)
        response = self.propose(self.super_admin(), {"employment": "ashantihub"})
        self.assertEqual(
            (response.status_code, response.json()["code"], response.json()["open"]), (409, "rider_money_open", ["balance"]),
        )
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.employment, Rider.THIRD_PARTY)

    @override_settings(LEDGER_ENABLED=True)
    def test_a_delivered_order_waiting_for_supports_call_blocks_switching_back(self):
        self.make_third_party()
        order = self.make_order()
        escrow.record_order_payment(order)
        DeliveryAssignment.objects.create(
            order=order, dispatch=self.rider_staff, status=DeliveryAssignment.DELIVERED, delivered_at=timezone.now(),
        )
        self.assertEqual(list(employment.unreleased_deliveries(self.rider).values_list("order_id", flat=True)), [order.pk])
        response = self.propose(self.manager, {"employment": "ashantihub"})
        self.assertEqual((response.status_code, response.json()["open"]), (409, ["deliveries"]))

    @override_settings(LEDGER_ENABLED=True)
    def test_switching_back_once_settled_closes_the_wallet(self):
        self.make_third_party()
        response = self.propose(self.super_admin(), {"employment": "ashantihub"})
        self.assertEqual(response.json()["status"], ApprovalRequest.APPROVED, response.content)
        self.rider.refresh_from_db()
        self.assertEqual((self.rider.employment, self.rider.company_name, self.rider.third_party_since), (Rider.ASHANTIHUB, "", None))
        self.assertIsNone(employment.wallet_rider(self.rider_staff))

    @override_settings(LEDGER_ENABLED=True)
    def test_money_arriving_before_the_decision_refuses_the_approval(self):
        self.make_third_party()
        response = self.propose(self.manager, {"employment": "ashantihub"})                 # nothing open yet: staged
        self.assertEqual(response.status_code, 201, response.content)
        self.fund_rider(500)                                                                  # a release paid them meanwhile
        with self.assertRaises(approvals.ApprovalError):
            approvals.approve(response.json()["approval_id"], self.super_admin())
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.employment, Rider.THIRD_PARTY)
        self.assertEqual(ApprovalRequest.objects.get(pk=response.json()["approval_id"]).status, ApprovalRequest.PENDING)

    def test_a_super_admins_own_proposal_needs_the_password(self):
        sa = self.super_admin()
        response = self.as_staff(sa).post(URL.format(self.rider.pk), {"employment": "third_party", "company_name": "Swift"}, format="json")
        self.assertEqual((response.status_code, response.json()["code"]), (403, "sudo_required"))
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.employment, Rider.ASHANTIHUB)

    def test_another_delivery_manager_cannot_approve_and_the_http_approval_asks_for_the_password(self):
        response = self.propose(self.manager, {"employment": "third_party", "company_name": "Swift"})
        peer = make_staff("delivery_manager", "dm2@example.com", phone="+233244000009")
        with self.assertRaises(approvals.ApprovalError):
            approvals.approve(response.json()["approval_id"], peer)
        url = f"/api/approvals/{response.json()['approval_id']}/approve/"
        answer = self.as_staff(self.super_admin()).post(url, {}, format="json")
        self.assertEqual((answer.status_code, answer.json().get("code")), (403, "sudo_required"))
        self.assertEqual(self.as_staff(self.super_admin(), sudo=True).post(url, {}, format="json").status_code, 200)

    def test_the_rider_cannot_decide_their_own_change(self):
        response = self.propose(self.manager, {"employment": "third_party", "company_name": "Swift"})
        request = ApprovalRequest.objects.get(pk=response.json()["approval_id"])
        request.decided_by = self.rider_staff
        with self.assertRaises(MakerCannotDecide), transaction.atomic():
            employment.apply(request)

    def test_not_a_rider_at_decision_time(self):
        response = self.propose(self.manager, {"employment": "third_party", "company_name": "Swift"})
        self.rider_staff.role = make_staff("scout", "scout@example.com").role
        self.rider_staff.save(update_fields=["role"])
        with self.assertRaises(approvals.ApprovalError):
            approvals.approve(response.json()["approval_id"], self.super_admin())

    @override_settings(LEDGER_ENABLED=True)
    def test_the_reserve_and_an_open_withdrawal_each_block_switching_back(self):
        self.make_third_party()
        posting.post(key="fund-reserve", kind="test_fund", lines=[
            posting.debit(posting.account_for(Account.PROVIDER_CLEARING), 100),
            posting.credit(posting.account_for(Account.RIDER_RESERVE, self.rider_staff), 100),
        ])
        self.assertEqual(employment.money_open(self.rider), ["reserve"])
        from otp.identity import ref
        from wallets.models import Withdrawal

        holder_type, holder_id = ref(self.rider_staff)
        with mock.patch.object(Withdrawal.objects, "filter") as fake:
            fake.return_value.exists.return_value = True
            self.assertEqual(employment.money_open(self.rider), ["reserve", "withdrawal"])
            fake.assert_called_once_with(holder_type=holder_type, holder_id=holder_id, status__in=Withdrawal.OPEN)

    @override_settings(LEDGER_ENABLED=True)
    def test_apply_decides_on_locked_balances_so_money_posted_after_the_proposal_refuses(self):
        self.make_third_party()
        response = self.propose(self.manager, {"employment": "ashantihub"})
        self.fund_rider(300)                                          # e.g. a withdrawal returned between propose and apply
        request = ApprovalRequest.objects.get(pk=response.json()["approval_id"])
        request.decided_by = self.super_admin()
        with mock.patch("ledger.posting.lock", wraps=posting.lock) as locked:
            with self.assertRaises(approvals.ApprovalError), transaction.atomic():
                employment.apply(request)
        locked.assert_called_once()
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.employment, Rider.THIRD_PARTY)

    def delivered(self, delivered_at, *, paid=True, status=None, dispatch=None):
        order = self.make_order()
        if paid:
            escrow.record_order_payment(order)
        DeliveryAssignment.objects.create(
            order=order, dispatch=dispatch or self.rider_staff, status=status or DeliveryAssignment.DELIVERED, delivered_at=delivered_at,
        )
        return order.pk

    def payroll(self):
        return sorted(employment.payroll_jobs(DeliveryAssignment.objects.filter(dispatch=self.rider_staff)).values_list("order_id", flat=True))

    @override_settings(LEDGER_ENABLED=True)
    def test_history_is_kept_in_periods_so_payroll_still_leaves_out_third_party_days(self):
        now = timezone.now()
        old, inside = self.delivered(now - timedelta(days=25)), self.delivered(now - timedelta(days=15))
        self.rider.employment, self.rider.company_name = Rider.THIRD_PARTY, "Swift"
        self.rider.third_party_since = now - timedelta(days=20)
        self.rider.save(update_fields=["employment", "company_name", "third_party_since"])
        RiderEmploymentPeriod.objects.create(rider=self.rider, started_at=now - timedelta(days=20))
        # the day-15 order is still waiting for Support: switching back is refused until it is released or refunded
        refused = self.propose(self.super_admin(), {"employment": "ashantihub"})
        self.assertEqual((refused.status_code, refused.json()["open"]), (409, ["deliveries"]))
        posting.post(key=escrow.release_key(Order.objects.get(pk=inside)), kind="test_release", lines=[        # Support released it
            posting.debit(posting.account_for(Account.PROVIDER_CLEARING), 1), posting.credit(posting.account_for(Account.PLATFORM_DELIVERY_INCOME), 1),
        ])
        response = self.propose(self.super_admin(), {"employment": "ashantihub"})
        self.assertEqual(response.json()["status"], ApprovalRequest.APPROVED, response.content)
        closed = self.rider.employment_periods.get()
        self.assertIsNotNone(closed.ended_at)                              # apply() closed it
        after_gap = self.delivered(closed.ended_at + timedelta(hours=1))
        self.assertEqual(self.payroll(), sorted([old, after_gap]))         # the day-15 delivery stays out of payroll
        self.assertTrue(employment.third_party_at(self.rider, now - timedelta(days=15)))
        self.assertFalse(employment.third_party_at(self.rider, closed.ended_at + timedelta(hours=1)))
        with mock.patch.object(employment, "timezone", SimpleNamespace(now=lambda: closed.ended_at + timedelta(hours=2), localdate=timezone.localdate)):
            again = self.propose(self.super_admin(), {"employment": "third_party", "company_name": "Other"})
        self.assertEqual(again.json()["status"], ApprovalRequest.APPROVED, again.content)
        self.assertEqual(self.rider.employment_periods.count(), 2)
        self.assertEqual(self.rider.employment_periods.filter(ended_at__isnull=True).count(), 1)
        later = self.delivered(closed.ended_at + timedelta(hours=3))
        self.assertEqual(self.payroll(), sorted([old, after_gap]))         # both periods kept, the later one excluded too
        self.assertNotIn(later, self.payroll())

    @override_settings(LEDGER_ENABLED=True)
    def test_the_decision_uses_the_locked_balance_not_an_unlocked_read(self):
        self.make_third_party()
        account = posting.account_for(Account.RIDER_BALANCE, self.rider_staff)          # an empty account: balance_of says 0
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.rider_staff), 0)
        locked = {account.pk: SimpleNamespace(pk=account.pk, balance=777)}               # the fresh, locked row says otherwise
        with mock.patch("ledger.posting.lock", return_value=locked):
            self.assertEqual(employment.money_open(self.rider, lock=True), ["balance"])
            self.assertEqual(employment.money_open(self.rider), [])

    @override_settings(LEDGER_ENABLED=True)
    def test_period_boundaries_start_inclusive_end_exclusive(self):
        start = timezone.now() - timedelta(days=10)
        end = start + timedelta(days=4)
        RiderEmploymentPeriod.objects.create(rider=self.rider, started_at=start, ended_at=end)
        at_start, at_end = self.delivered(start), self.delivered(end)
        self.assertEqual(self.payroll(), [at_end])
        self.assertTrue(employment.third_party_at(self.rider, start))
        self.assertFalse(employment.third_party_at(self.rider, end))

    @override_settings(LEDGER_ENABLED=True)
    def test_payroll_keeps_deliveries_the_wallet_will_never_pay(self):
        now = timezone.now()
        RiderEmploymentPeriod.objects.create(rider=self.rider, started_at=now - timedelta(days=10))
        unpaid = self.delivered(now - timedelta(days=2), paid=False)       # paid before the ledger was switched on
        paid = self.delivered(now - timedelta(days=1))
        self.assertEqual(self.payroll(), [unpaid])
        self.assertNotIn(paid, self.payroll())

    def test_with_the_ledger_off_payroll_counts_every_delivery(self):
        now = timezone.now()
        RiderEmploymentPeriod.objects.create(rider=self.rider, started_at=now - timedelta(days=10))
        order = self.delivered(now - timedelta(days=1), paid=False)
        self.assertEqual(self.payroll(), [order])

    @override_settings(LEDGER_ENABLED=True)
    def test_a_delivery_in_progress_blocks_switching_back(self):
        self.make_third_party()
        self.delivered(None, paid=False, status=DeliveryAssignment.PICKED_UP)
        response = self.propose(self.super_admin(), {"employment": "ashantihub"})
        self.assertEqual((response.status_code, response.json()["open"]), (409, ["delivery_in_progress"]))

    @override_settings(LEDGER_ENABLED=True)
    def test_a_delivery_from_a_closed_earlier_period_still_blocks_switching_back(self):
        now = timezone.now()
        RiderEmploymentPeriod.objects.create(rider=self.rider, started_at=now - timedelta(days=20), ended_at=now - timedelta(days=10))
        self.delivered(now - timedelta(days=15))
        self.make_third_party()                                            # a second, open period
        self.assertEqual(employment.money_open(self.rider), ["deliveries"])

    def test_a_company_name_only_change_opens_no_period(self):
        self.make_third_party()
        response = self.propose(self.super_admin(), {"employment": "third_party", "company_name": "Other Riders"})
        self.assertEqual(response.json()["status"], ApprovalRequest.APPROVED, response.content)
        self.assertEqual(self.rider.employment_periods.count(), 1)
        self.rider.refresh_from_db()
        self.assertEqual(self.rider.company_name, "Other Riders")

    def test_the_wallet_flag_needs_the_dispatch_role(self):
        self.make_third_party()
        self.assertTrue(employment.row(self.rider)["wallet"])
        self.rider_staff.role = make_staff("scout", "scout2@example.com").role
        self.rider_staff.save(update_fields=["role"])
        self.rider.refresh_from_db()
        self.assertFalse(employment.row(self.rider)["wallet"])
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p disp1 run --rm web python manage.py test delivery.tests.test_employment --noinput`
Expected: ERROR — `ImportError: cannot import name 'employment' from 'delivery'`.

- [ ] **Step 3: The fields** — in `backend/delivery/models.py`, replace

```python
    MANUAL, DOCUMENTS = "manual", "documents"
    SUSPENSION_SOURCE_CHOICES = [("", "Not suspended"), (MANUAL, "Suspended by a manager"), (DOCUMENTS, "A required paper expired")]
```

with

```python
    MANUAL, DOCUMENTS = "manual", "documents"
    SUSPENSION_SOURCE_CHOICES = [("", "Not suspended"), (MANUAL, "Suspended by a manager"), (DOCUMENTS, "A required paper expired")]
    ASHANTIHUB, THIRD_PARTY = "ashantihub", "third_party"
    EMPLOYMENT_CHOICES = [(ASHANTIHUB, "AshantiHub's own rider"), (THIRD_PARTY, "Third-party rider (from a rider company)")]
```

and replace

```python
    suspension_source = models.CharField(max_length=10, choices=SUSPENSION_SOURCE_CHOICES, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
```

with

```python
    suspension_source = models.CharField(max_length=10, choices=SUSPENSION_SOURCE_CHOICES, blank=True, default="")
    # Who the rider works for (spec §1 rows 4-5, §7; wallets Plan 5). Changed only through the delivery.rider_employment
    # approval (delivery.employment). A third-party rider is paid the delivery fee of each order they deliver from
    # `third_party_since` on, at release, into a wallet (ledger.riders); AshantiHub's own riders have no wallet.
    employment = models.CharField(max_length=12, choices=EMPLOYMENT_CHOICES, default=ASHANTIHUB)
    company_name = models.CharField(max_length=120, blank=True, default="")
    third_party_since = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

- [ ] **Step 4: Generate the migration**

Run: `docker compose -p disp1 run --rm --user "$(id -u):$(id -g)" web python manage.py makemigrations delivery --name rider_employment`
Expected: `delivery/migrations/0007_rider_employment.py` with `Add field company_name to rider`, `Add field employment to rider`, `Add field third_party_since to rider` and `Create model RiderEmploymentPeriod` (and nothing else). The model sits after `Rider` in `delivery/models.py` (see the committed code: `rider` FK with `related_name="employment_periods"`, `started_at`, `ended_at` null, one open period per rider by a unique constraint). The periods, not the flag, decide who a delivery's money belongs to.

- [ ] **Step 5: The flag and its approval** — create `backend/delivery/employment.py`

```python
"""Who a rider works for (spec §1 rows 4-5, §2.2, §7; wallets Plan 5).

AshantiHub's own rider (`Rider.ASHANTIHUB`, the default for every rider): no wallet, every delivery fee they carry is
AshantiHub's income, and their pay stays with payroll (the rate card's `rider_pay` record). A third-party rider
(`Rider.THIRD_PARTY`, from a rider company, not an AshantiHub employee): the delivery fee of each order they deliver while
they are third-party (inside one of their `RiderEmploymentPeriod` rows) is paid into their wallet when the order's money
is released (ledger.riders), less AshantiHub's commission.

The flag decides whether a delivery fee becomes AshantiHub's income or a third party's withdrawable money, so it changes
only through the `delivery.rider_employment` approval: a Delivery Manager (delivery.fleet) proposes, a Super Admin
approves with the password (a Super Admin's own change applies at once and needs the password too). Switching a rider back to AshantiHub's own is
refused while they still have money with AshantiHub, a withdrawal on its way, or a delivered order whose money Support has
not released yet (`money_open`). That is checked when proposed, when approved, and again under the rider row's lock when
applied; a release takes the same lock before paying a rider (ledger.riders.rider_for_release)."""
from django.db.models import CharField, Exists, OuterRef, Q, Value
from django.db.models.functions import Cast, Concat
from django.utils import timezone

from approvals import services as approvals
from approvals.models import ApprovalRequest
from approvals.services import MakerCannotDecide
from approvals.registry import ApprovalKind
from ledger.models import Journal
from orders.models import DeliveryAssignment, Order

from .models import Rider, RiderDocument, RiderEmploymentPeriod

KIND = "delivery.rider_employment"
WALLET_DISABLED = "Wallets are for third-party riders. AshantiHub's own riders are paid through payroll."
OPEN_LABELS = {
    "balance": "money in their wallet (to withdraw, or owed after a refund)",
    "reserve": "commission held until the end of the day",
    "withdrawal": "a withdrawal on its way",
    "delivery_in_progress": "a delivery in progress",
    "deliveries": "delivered orders waiting for Support's call",
}


class EmploymentError(Exception):
    def __init__(self, message, code, status_code=400, field=None, **extra):
        super().__init__(message)
        self.message, self.code, self.status_code, self.field, self.extra = message, code, status_code, field, extra

    def body(self):
        data = {"detail": self.message, "code": self.code, **self.extra}
        if self.field:
            data["field"] = self.field
        return data


def is_third_party(rider):
    return rider is not None and rider.employment == Rider.THIRD_PARTY and rider.third_party_since is not None


def third_party_at(rider, when):
    """True when `rider` was a third-party rider at `when` (inside one of their employment periods, the start inclusive and
    the end exclusive). History reads the periods, never the current flag."""
    if rider is None or when is None:
        return False
    return rider.employment_periods.filter(started_at__lte=when).filter(Q(ended_at__isnull=True) | Q(ended_at__gt=when)).exists()


def wallet_rider(staff):
    """The staff member's Rider when they are a third-party rider (their wallet is on), else None. The staff member must
    still hold the Dispatch role: a re-roled ex-rider keeps a Rider row but no wallet (and no step-up codes)."""
    if getattr(staff, "pk", None) is None:
        return None
    return Rider.objects.select_related("staff").filter(
        staff_id=staff.pk, staff__role__name="dispatch", employment=Rider.THIRD_PARTY, third_party_since__isnull=False,
    ).first()


def id_verified(rider, today=None):
    """An approved Ghana Card in date is on file (the Delivery Manager reviews riders' papers). The name on the rider's
    staff account is then their verified name for payout destinations (wallets.names)."""
    today = today or timezone.localdate()
    return rider.documents.filter(kind=RiderDocument.GHANA_CARD, status=RiderDocument.APPROVED).filter(
        Q(expires_on__isnull=True) | Q(expires_on__gte=today)
    ).exists()


def _in_a_period():
    """Exists() over the assignment's rider's employment periods that contain its delivered_at (start inclusive, end
    exclusive). All periods count, past ones included."""
    return Exists(RiderEmploymentPeriod.objects.filter(
        rider__staff_id=OuterRef("dispatch_id"), started_at__lte=OuterRef("delivered_at"),
    ).filter(Q(ended_at__isnull=True) | Q(ended_at__gt=OuterRef("delivered_at"))))


def _with_keys(jobs):
    return jobs.annotate(
        pay_key=Concat(Value("order-pay-"), Cast("order_id", CharField())),
        release_key=Concat(Value("order-release-"), Cast("order_id", CharField())),
    )


def unreleased_deliveries(rider):
    """Door-to-door orders this rider delivered while third-party (in ANY of their employment periods, so a switch back
    cannot hide one) whose payment the ledger recorded and whose money is not released yet (Support's call is still to
    come), and not refunded whole."""
    jobs = _with_keys(
        DeliveryAssignment.objects.filter(
            dispatch_id=rider.staff_id, order__status=Order.PAID, order__delivery_method=Order.DOOR_TO_DOOR,
        ).filter(_in_a_period())
        .exclude(status=DeliveryAssignment.FAILED).exclude(order__refunds__whole=True)
    )
    return jobs.filter(Exists(Journal.objects.filter(key=OuterRef("pay_key")))).exclude(
        Exists(Journal.objects.filter(key=OuterRef("release_key")))
    )


def payroll_jobs(jobs):
    """`jobs` (a DeliveryAssignment queryset) without the deliveries the rider's wallet will be paid for: delivered while
    the rider was third-party (inside one of their RiderEmploymentPeriod rows, past ones included) AND whose order has an
    `order-pay-<order id>` journal (exactly what a release can pay). A delivery with no payment journal (the ledger off, or
    an order paid before it was switched on) is never paid into a wallet, so payroll keeps counting it: otherwise nobody
    would pay the rider. Used by the payroll screens (delivery.views_rules RiderEarnedView / RiderEarningsLinesView) and the
    rider app's rider/earnings/ figures."""
    walleted = _with_keys(jobs.filter(_in_a_period())).filter(Exists(Journal.objects.filter(key=OuterRef("pay_key"))))
    return jobs.exclude(pk__in=walleted.values("pk"))


def money_open(rider, lock=False):
    """What stops this rider's wallet closing now, as OPEN_LABELS keys in a fixed order ([] when nothing does). With
    `lock` (inside the decision's transaction, after the rider row's lock: rider row, then accounts, the global order) the
    rider's existing balance and reserve accounts are locked and the decision is made on those locked balances."""
    from ledger import posting
    from ledger.models import Account
    from otp.identity import ref
    from wallets.models import Withdrawal

    staff, found = rider.staff, []
    if lock:
        held = list(Account.objects.filter(
            kind__in=(Account.RIDER_BALANCE, Account.RIDER_RESERVE), owner_type=staff._meta.label_lower, owner_id=str(staff.pk),
        ))
        locked = posting.lock(*held)
        balance = {account.kind: locked[account.pk].balance for account in held}
    else:
        balance = {kind: posting.balance_of(kind, staff) for kind in (Account.RIDER_BALANCE, Account.RIDER_RESERVE)}
    if balance.get(Account.RIDER_BALANCE, 0) != 0:
        found.append("balance")
    if balance.get(Account.RIDER_RESERVE, 0) != 0:
        found.append("reserve")
    holder_type, holder_id = ref(staff)
    if Withdrawal.objects.filter(holder_type=holder_type, holder_id=holder_id, status__in=Withdrawal.OPEN).exists():
        found.append("withdrawal")
    if DeliveryAssignment.objects.filter(dispatch_id=rider.staff_id, status__in=DeliveryAssignment.ACTIVE_STATUSES).exists():
        found.append("delivery_in_progress")        # an unlocked read: locking assignments would cycle with deliver -> order
    if unreleased_deliveries(rider).exists():
        found.append("deliveries")
    return found


def clean(data):
    """(employment, company_name) from a request body or an approval payload. Raises EmploymentError (400)."""
    employment = data.get("employment")
    if employment not in (Rider.ASHANTIHUB, Rider.THIRD_PARTY):
        raise EmploymentError("Choose AshantiHub's own rider or a third-party rider.", "invalid", field="employment")
    if employment == Rider.ASHANTIHUB:
        return employment, ""
    company = str(data.get("company_name") or "").strip()
    if not 2 <= len(company) <= 120:
        raise EmploymentError("Name the rider company (2 to 120 characters).", "invalid", field="company_name")
    return employment, company


def check(rider, employment, company, maker=None, lock=False):
    """Raise EmploymentError when this change cannot be made now. `maker` is the staff member who proposed it: nobody
    changes who they themselves work for (a Super Admin holds every permission, and their own change applies at once, so
    without this rule they could route delivery fees into their own wallet)."""
    if maker is not None and maker.pk == rider.staff_id:
        raise EmploymentError("You can't change who you work for.", "own_rider", 403)
    if employment == Rider.THIRD_PARTY and getattr(rider.staff.role, "name", "") != "dispatch":
        raise EmploymentError("Only a Dispatch rider can be a third-party rider.", "not_a_rider", 409)
    if rider.employment == employment and rider.company_name == company:
        raise EmploymentError("Nothing would change.", "no_change", 409)
    if employment == Rider.ASHANTIHUB and rider.employment == Rider.THIRD_PARTY:
        found = money_open(rider, lock=lock)
        if found:
            raise EmploymentError(
                "This rider still has " + "; ".join(OPEN_LABELS[key] for key in found) + ". Settle that first.",
                "rider_money_open", 409, open=found,
            )


def pending_for(rider):
    return ApprovalRequest.objects.filter(
        kind=KIND, status=ApprovalRequest.PENDING, target_type=Rider._meta.label_lower, target_id=str(rider.pk),
    ).select_related("maker").first()


def _label(employment, company):
    label = dict(Rider.EMPLOYMENT_CHOICES).get(employment, employment or "")
    return f"{label} ({company})" if company else label


def propose(maker, rider, data, *, note="", request=None):
    """Stage the change for a Super Admin (applied at once when the maker is one). Returns the ApprovalRequest; raises
    EmploymentError."""
    employment, company = clean(data if isinstance(data, dict) else {})
    if pending_for(rider) is not None:
        raise EmploymentError("A change for this rider is already waiting for approval.", "already_pending", 409)
    check(rider, employment, company, maker)
    try:
        return approvals.submit(
            maker, KIND, title=f"{rider.staff.full_name}: {_label(employment, company)}",
            payload={"rider_id": rider.pk, "employment": employment, "company_name": company},
            target=rider, maker_note=str(note or "")[:500], request=request,
        )
    except approvals.ApprovalError as exc:
        raise EmploymentError(exc.message, "refused", exc.status_code) from exc


def row(rider):
    """What the fleet screens show of a rider's employment, with any change waiting for approval."""
    pending = pending_for(rider)
    return {
        "employment": rider.employment, "employment_label": rider.get_employment_display(),
        "company_name": rider.company_name, "third_party_since": rider.third_party_since, "wallet": is_third_party(rider) and getattr(rider.staff.role, "name", "") == "dispatch",
        "pending": None if pending is None else {
            "approval_id": pending.pk, "employment": pending.payload.get("employment"),
            "company_name": pending.payload.get("company_name"), "proposed_by": pending.maker.full_name,
            "created_at": pending.created_at,
        },
    }


# --- the approval kind --------------------------------------------------------------------------------------------

def _rider(request):
    return Rider.objects.select_related("staff").get(pk=request.payload["rider_id"])


def current_state(request):
    rider = _rider(request)
    return {"employment": rider.employment, "company_name": rider.company_name}


def validate(request):
    try:
        employment, company = clean(request.payload)
        check(_rider(request), employment, company, request.maker)
    except EmploymentError as exc:
        raise approvals.ApprovalError(exc.message) from exc


def apply(request):
    """Inside the decision's transaction: lock the rider row, check again (a release locks it before paying a rider), set
    the flag. Becoming third-party opens an employment period and sets `third_party_since` (the open period's start);
    a new company name changes neither; going back closes the period and clears `third_party_since`."""
    from activity.services import record

    decider = request.decided_by or request.maker
    rider = Rider.objects.select_for_update(of=("self",)).select_related("staff").get(pk=request.payload["rider_id"])
    now = timezone.now()          # right after the rider lock, before the checks: a delivery finished later is after this moment
    if decider.pk == rider.staff_id:
        raise MakerCannotDecide("You can't change who you work for.")
    try:
        employment, company = clean(request.payload)
        check(rider, employment, company, request.maker, lock=True)
    except EmploymentError as exc:
        raise approvals.ApprovalError(exc.message) from exc
    before = {"employment": rider.employment, "company_name": rider.company_name}
    if employment == Rider.THIRD_PARTY and rider.employment != Rider.THIRD_PARTY:
        rider.third_party_since = now
        RiderEmploymentPeriod.objects.create(rider=rider, started_at=now)
    elif employment == Rider.ASHANTIHUB:
        rider.third_party_since = None
        rider.employment_periods.filter(ended_at__isnull=True).update(ended_at=now)
    rider.employment, rider.company_name = employment, company
    rider.save(update_fields=["employment", "company_name", "third_party_since"])
    # Last: record() holds the activity chain lock until commit.
    record(
        decider, "delivery.rider_employment_applied", target=rider,
        summary=f"{rider.staff.full_name}: {_label(employment, company)}", before=before,
        after={"employment": employment, "company_name": company},
    )


def render_diff(request):
    before = request.before or {}
    return [{
        "field": "Works for", "before": _label(before.get("employment"), before.get("company_name")),
        "after": _label(request.payload.get("employment"), request.payload.get("company_name")),
    }]


def consequences(request):
    from ledger import escrow

    before = getattr(request, "before", None) or {}
    if request.payload.get("employment") == Rider.THIRD_PARTY:
        if before.get("employment") == Rider.THIRD_PARTY:
            return ["Only the rider company's name changes. The rider stays a third-party rider and nothing else changes."]
        if not escrow.enabled():
            return ["Marks this rider as a third-party rider. The wallet system is switched off, so this has no money effect "
                    "yet; once it is on, each delivery they make from approval is paid into their wallet less AshantiHub's "
                    "commission, and deliveries made before approval, or on orders paid before then, stay with payroll."]
        from ledger import settings_store

        rate = settings_store.current("rider_commission_bp") / 100
        return [
            "From approval, each delivery this rider makes is paid into their AshantiHub wallet when Support confirms the "
            f"order with the customer: the delivery fee less AshantiHub's commission ({rate:g}% now, held until the end of "
            "the day). Deliveries made before approval, and orders paid before the wallet system was switched on, stay with payroll. They can withdraw to an account in their own "
            "name once their Ghana Card is approved."
        ]
    if not escrow.enabled():
        return ["Marks this rider as AshantiHub's own rider again. The wallet system is switched off, so this has no money "
                "effect yet; their pay returns to payroll."]
    return [
        "From approval, this rider's deliveries are AshantiHub's: delivery fees stay with AshantiHub and their pay returns "
        "to payroll. Their wallet closes. This is refused while they still have money with AshantiHub, a withdrawal on its "
        "way, or a delivered order waiting for Support's call."
    ]


EMPLOYMENT_KIND = ApprovalKind(
    key=KIND, label="Change who a rider works for", pool_permission="", current_state=current_state, apply=apply,
    response_hours=48, resolve_approver=lambda request: [(ApprovalRequest.SUPER_ADMIN, None)], render_diff=render_diff,
    validate=validate, consequences=consequences, requires_sudo=True, chain_note="Super Admin only",
)
```

- [ ] **Step 6: Register it** — in `backend/delivery/apps.py` replace

```python
        from . import signals  # noqa: F401
        from .config import KINDS
```

with

```python
        from . import signals  # noqa: F401
        from .config import KINDS
        from .employment import EMPLOYMENT_KIND
```

and replace

```python
        for kind in KINDS:
            if registry.get_kind(kind.key) is None:
                registry.register(kind)
```

with

```python
        for kind in (*KINDS, EMPLOYMENT_KIND):
            if registry.get_kind(kind.key) is None:
                registry.register(kind)
```

- [ ] **Step 7: The profile shows it** — in `backend/delivery/fleet.py` replace `from . import payloads, services` with `from . import employment, payloads, services`, and replace

```python
        "pay": None,  # no rate card or pay record yet: the screen says rider pay arrives with Accounting
```

with

```python
        "employment": employment.row(rider),
        "pay": None,  # no rate card or pay record yet: the screen says rider pay arrives with Accounting
```

- [ ] **Step 8: The endpoint** — in `backend/delivery/views_fleet.py` replace `from . import files, fleet, payloads, services` with `from . import employment, files, fleet, payloads, services`, and add after the `RiderJobHoldView` class:

```python
class RiderEmploymentView(FleetView):
    """POST riders/<id>/employment/ {"employment": "ashantihub"|"third_party", "company_name", "note"} — propose who the
    rider works for (wallets Plan 5). A Super Admin approves it with the password (their own change applies at once).
    201 {approval_id, status, employment}; 409 no_change / already_pending / rider_money_open (+ open)."""

    def post(self, request, pk):
        rider = get_object_or_404(Rider.objects.select_related("staff"), pk=pk)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            approval = employment.propose(request.user, rider, data, note=data.get("note", ""), request=request)
        except employment.EmploymentError as exc:
            return Response(exc.body(), status=exc.status_code)
        rider.refresh_from_db()
        return Response(
            {"approval_id": approval.pk, "status": approval.status, "employment": employment.row(rider)},
            status=status.HTTP_201_CREATED,
        )
```

and in `backend/delivery/urls.py` replace

```python
    path("riders/<int:pk>/reinstate/", views_fleet.RiderReinstateView.as_view(), name="delivery-rider-reinstate"),
```

with

```python
    path("riders/<int:pk>/reinstate/", views_fleet.RiderReinstateView.as_view(), name="delivery-rider-reinstate"),
    path("riders/<int:pk>/employment/", views_fleet.RiderEmploymentView.as_view(), name="delivery-rider-employment"),
```

- [ ] **Step 9: Run the test to see it pass**

Run: `docker compose -p disp1 run --rm web python manage.py test delivery.tests.test_employment --noinput`
Expected: PASS (11 tests).

- [ ] **Step 10: The spec addendum** — append to the end of `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (after Plan 1b's and Plan 4's sections if they have merged):

```markdown

### Stage 5 (third-party dispatch) reconciliation (2026-10-16)

Found while writing `docs/superpowers/plans/2026-10-16-dispatch-wallets-5.md` (§0 there):

- **R1 Third-party flag.** The code had no rider company or employment concept. `delivery.Rider` gains `employment`
  (`ashantihub`, the default for every existing rider, or `third_party`), a free-text `company_name` and
  `third_party_since`. No rider-company table: each rider is paid personally (§2.1, §8), so nothing keys on the company.
- **R2 Who sets it.** The `delivery.rider_employment` approval: the Delivery Manager (`delivery.fleet`) proposes, a Super
  Admin approves with the password (their own change applies at once). Switching back to AshantiHub's own is refused while
  the rider holds money, has a withdrawal on its way or a delivered order waiting for Support's call.
- **R3 When a rider is paid.** At release only (Support's positive call, §4.1), in the release's transaction, for a
  door-to-door order the rider delivered after becoming third-party. The whole fee AshantiHub took at release (the
  customer's delivery fee plus a fee the business covered with its free-delivery promo) moves from platform delivery
  income to the rider (`order-rider-<order>`): 90% to Rider balance, 10% to the reserve. The rate-card `rider_pay` stays a
  payroll record for AshantiHub's own riders.
- **R4 Rate.** The existing `rider_commission_bp` (default 1000) as it stood when the order was paid (§3.3), kept on the
  earning, so the end-of-day posting needs no true-up (§1 row 5).
- **R5 End of day.** At 00:20 Accra each rider's reserve of every earlier day still held goes to platform commission
  income, with the day's deliveries, gross, commission and net recorded; a missed night is caught up.
- **R6 Refunds.** Before release a whole refund returns the delivery fee to the customer and the rider is never paid.
  After release a partial refund leaves the rider paid; a whole refund takes the earning back first (the rider's balance
  may go below zero and then blocks withdrawals; the reserve is taken back, or the commission once posted).
- **R7 Wallet.** A rider's accounts are held by their staff account; the Stage 3b destinations and withdrawals serve them
  (`holder_type` "staff") with the rider's staff name as the verified name once an approved, in-date Ghana Card is on
  file, the same limits and cooling, and step-up codes (third-party riders, unlike office staff, may ask for
  `withdrawal` and `payout_destination` codes). AshantiHub's own riders get `409 wallet_disabled`.
- **R8 Reconciliation.** Unchanged: rider money touches provider clearing only through the withdrawal journals the
  nightly run already compares.
```

- [ ] **Step 11: Commit**

```bash
git add backend/delivery/models.py backend/delivery/migrations/0007_rider_employment.py backend/delivery/employment.py backend/delivery/apps.py backend/delivery/fleet.py backend/delivery/views_fleet.py backend/delivery/urls.py backend/delivery/tests/test_employment.py docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md
git commit -F - <<'EOF'
feat(delivery): third-party rider flag behind a Super Admin approval; never switched back with money open

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 2: Pay the rider at release — 90% to the balance, 10% to the reserve

**Files:**
- Modify: `backend/delivery/models.py` (module docstring; new `RiderCommissionPosting`, `RiderEarning`), `backend/ledger/escrow.py` (`release_verified`, imports, docstring)
- Create: `backend/delivery/migrations/0008_rider_earnings.py` (generated), `backend/ledger/riders.py`, `backend/ledger/tests/rider_helpers.py`, `backend/ledger/tests/test_rider_release.py`

**Interfaces:**
- Consumes: Task 1's `Rider.employment` / `THIRD_PARTY` / `third_party_since`; `ledger.posting`, `ledger.settings_store.current(key, at)`, `escrow.pay_key/release_key/waiver_key`, `marketing.models_waivers.WaivedFeeCharge`.
- Produces:
  - `delivery.models.RiderCommissionPosting` (`rider`, `day`, `deliveries`, `gross_pesewas`, `commission_pesewas`, `net_pesewas`, `journal` null, `posted_at`)
  - `delivery.models.RiderEarning` (`order` one-to-one, `rider`, `gross_pesewas`, `commission_bp`, `reserve_pesewas`, `net_pesewas`, `earned_at`, `earned_on`, `journal`, `commission_posting` null, `reversed_at` null, `reversal_journal` null)
  - `ledger.riders`: `COMMISSION_SETTING = "rider_commission_bp"`, `earning_key(order) -> str`, `split(gross, bp) -> (reserve, net)`, `accounts_of(rider) -> (balance_account, reserve_account)`, `third_party_rider(order, *, lock=False) -> Rider | None`, `rider_for_release(order) -> Rider | None`, `release_accounts(rider) -> tuple`, `credit_delivery(order, rider, now=None) -> RiderEarning | None`
  - `escrow.release_verified` pays the rider (no signature change)
  - test helpers `ledger.tests.rider_helpers`: `rider(email="rider@example.com", *, name="Kojo Mensah", phone="+233244000002", third_party=True, since=None, company="Swift Riders Ltd") -> Rider`, `delivered_by(order, rider_row, *, at=None, status=DeliveryAssignment.CONFIRMED)`, `waived(order, owner, amount="15.00")`, `earning(rider_row, *, gross, at, bp=1000) -> RiderEarning`, `ghana_card(rider_row, *, expires_on=None, status=RiderDocument.APPROVED)`

- [ ] **Step 1: The test helpers** — create `backend/ledger/tests/rider_helpers.py`

```python
"""Fixtures for the third-party rider tests across apps (not test cases themselves; wallets Plan 5)."""
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from accounts.models import Customer
from accounts.testing import make_staff
from delivery.models import Rider, RiderDocument, RiderEarning, RiderEmploymentPeriod
from ledger import posting, riders
from ledger.models import Account
from marketing.models_waivers import DeliveryWaiver, WaivedFeeCharge
from orders.models import DeliveryAssignment, Order


def rider(email="rider@example.com", *, name="Kojo Mensah", phone="+233244000002", third_party=True, since=None,
          company="Swift Riders Ltd"):
    """A Dispatch staff member (two-word name, so a payout name can match it) and their Rider row: third-party from
    `since` (a month ago by default) unless third_party=False."""
    staff = make_staff("dispatch", email, phone=phone)
    staff.full_name = name
    staff.save(update_fields=["full_name"])
    row = Rider.objects.select_related("staff").get(staff=staff)
    if third_party:
        row.employment, row.company_name = Rider.THIRD_PARTY, company
        row.third_party_since = since or timezone.now() - timedelta(days=30)
        row.save(update_fields=["employment", "company_name", "third_party_since"])
        RiderEmploymentPeriod.objects.create(rider=row, started_at=row.third_party_since)    # the periods decide who was paid
    return row


def delivered_by(order, rider_row, *, at=None, status=DeliveryAssignment.CONFIRMED):
    """The order went door to door and `rider_row` delivered it (and the customer confirmed), or failed it."""
    at = at or timezone.now()
    order.delivery_method = Order.DOOR_TO_DOOR
    order.save(update_fields=["delivery_method"])
    failed = status == DeliveryAssignment.FAILED
    return DeliveryAssignment.objects.create(
        order=order, dispatch=rider_row.staff, status=status, delivered_at=None if failed else at,
        confirmed_at=at if status == DeliveryAssignment.CONFIRMED else None, failed_at=at if failed else None,
    )


def waived(order, owner, amount="15.00"):
    """The business covered the order's delivery fee with its free-delivery promo (charged to it at release)."""
    now = timezone.now()
    waiver = DeliveryWaiver.objects.create(
        business_owner=owner, name="Free delivery week", starts_at=now - timedelta(days=1), ends_at=now + timedelta(days=1),
        status=DeliveryWaiver.ACTIVE,
    )
    return WaivedFeeCharge.objects.create(order=order, waiver=waiver, business_owner=owner, amount=Decimal(amount))


def earning(rider_row, *, gross, at, bp=1000):
    """A delivery already paid to the rider as a release leaves it (journal order-rider-<order>, the earning row), on an
    order with no money of its own: for the end-of-day, wallet and staff tests."""
    customer = Customer.objects.get_or_create(phone="+233200770001", defaults={"full_name": "Esi Mensah", "password_hash": "x"})[0]
    order = Order.objects.create(customer=customer, status=Order.PAID, total_amount=Decimal("0.00"), delivery_method=Order.DOOR_TO_DOOR)
    reserve, net = riders.split(gross, bp)
    balance, held = riders.accounts_of(rider_row)
    lines = [posting.debit(posting.account_for(Account.PROVIDER_CLEARING), gross)]
    if net:
        lines.append(posting.credit(balance, net))
    if reserve:
        lines.append(posting.credit(held, reserve))
    journal = posting.post(
        key=riders.earning_key(order), kind="rider_earning", lines=lines, reference_type="orders.order", reference_id=str(order.pk),
    )
    return RiderEarning.objects.create(
        order=order, rider=rider_row, gross_pesewas=gross, commission_bp=bp, reserve_pesewas=reserve, net_pesewas=net,
        earned_at=at, earned_on=timezone.localdate(at), journal=journal,
    )


def ghana_card(rider_row, *, expires_on=None, status=RiderDocument.APPROVED):
    """A Ghana Card on file, approved and in date unless told otherwise. No file is written: the row only names one (the
    paper review itself is tested in delivery)."""
    return RiderDocument.objects.create(
        rider=rider_row, kind=RiderDocument.GHANA_CARD, file="documents/ghana-card.png", status=status,
        expires_on=expires_on or timezone.localdate() + timedelta(days=365),
    )
```

- [ ] **Step 2: Write the failing test** — `backend/ledger/tests/test_rider_release.py`

```python
"""A third-party rider is paid at release (wallets Plan 5, Task 2; spec §1 row 4, §2.2 step 2(c), §3.3, §4.1): the delivery
fee AshantiHub took for the order, 90% to their balance and 10% held in the reserve, at the rate in force when the order
was paid. Review Focus 2 and 4."""
import threading
from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.test import SimpleTestCase, TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import BusinessOwner, Customer
from accounts.testing import make_staff, staff_token
from approvals import services as approvals
from delivery import services as delivery_services
from delivery.models import Rider, RiderEarning
from ledger import escrow, posting, refunds, riders, settings_store, verification
from ledger.models import Account, FulfilmentCheck, Journal, MoneySetting
from listings.models import Category, Listing, Zone
from orders.models import DeliveryAssignment, Order, OrderItem

from . import rider_helpers
from .test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class RiderReleaseTests(RefundBase):
    def setUp(self):
        super().setUp()
        self.kofi = self.owner("Kofi")

    def delivered_order(self, by, *, delivery="10.00", price="60.00", at=None):
        order = self.paid([(self.listing(self.kofi, price), 1)], delivery=delivery)
        rider_helpers.delivered_by(order, by, at=at)
        return order

    def test_review_focus_a_third_party_delivery_pays_the_rider_90_and_holds_10(self):
        swift = rider_helpers.rider()
        order = self.delivered_order(swift)
        self.release(order)
        self.assertEqual(self.balance(Account.RIDER_BALANCE, swift.staff), 900)
        self.assertEqual(self.balance(Account.RIDER_RESERVE, swift.staff), 100)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)                   # it all went to the rider
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 5940)             # the vendor's side is unchanged
        earning = RiderEarning.objects.get(order=order)
        self.assertEqual(
            (earning.rider, earning.gross_pesewas, earning.commission_bp, earning.reserve_pesewas, earning.net_pesewas),
            (swift, 1000, 1000, 100, 900),
        )
        self.assertEqual((earning.journal.key, earning.journal.kind), (f"order-rider-{order.pk}", "rider_earning"))
        self.assertEqual(earning.earned_on, timezone.localdate(earning.earned_at))

    def test_an_ashantihub_riders_delivery_fee_stays_with_ashantihub(self):
        own = rider_helpers.rider(third_party=False)
        order = self.delivered_order(own)
        self.release(order)
        self.assertFalse(RiderEarning.objects.exists())
        self.assertFalse(Account.objects.filter(kind__in=[Account.RIDER_BALANCE, Account.RIDER_RESERVE]).exists())  # no wallet opened
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)

    def test_review_focus_a_delivery_made_before_the_rider_became_third_party_stays_with_ashantihub(self):
        swift = rider_helpers.rider(since=timezone.now())
        order = self.delivered_order(swift, at=timezone.now() - timedelta(hours=1))
        self.release(order)
        self.assertFalse(RiderEarning.objects.exists())
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)

    def test_a_store_pickup_or_a_failed_delivery_pays_no_rider(self):
        swift = rider_helpers.rider()
        pickup = self.paid([(self.listing(self.kofi, "60.00"), 1)])                             # store pickup: no rider
        self.release(pickup)
        failed = self.paid([(self.listing(self.kofi, "60.00"), 1)], delivery="10.00")
        rider_helpers.delivered_by(failed, swift, status=DeliveryAssignment.FAILED)
        self.release(failed)
        self.assertFalse(RiderEarning.objects.exists())
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 1000)

    def test_review_focus_the_rate_is_the_one_in_force_when_the_order_was_paid(self):
        swift = rider_helpers.rider()
        before = self.paid([(self.listing(self.kofi, "60.00"), 1)], delivery="10.00")          # paid at 10%
        paid_at = Journal.objects.get(key=f"order-pay-{before.pk}").created_at
        MoneySetting.objects.create(key="rider_commission_bp", value=2000, effective_from=paid_at + timedelta(microseconds=1))
        after = self.paid([(self.listing(self.kofi, "60.00"), 1)], delivery="10.00")           # paid at 20%
        for order in (before, after):
            rider_helpers.delivered_by(order, swift)
            self.release(order)                                                                  # both released at 20% in force
        self.assertEqual(RiderEarning.objects.get(order=before).reserve_pesewas, 100)
        self.assertEqual(RiderEarning.objects.get(order=after).reserve_pesewas, 200)
        self.assertEqual(self.balance(Account.RIDER_RESERVE, swift.staff), 300)
        self.assertEqual(self.balance(Account.RIDER_BALANCE, swift.staff), 1700)

    def test_a_free_delivery_promo_fee_paid_by_the_business_goes_to_the_rider(self):
        swift = rider_helpers.rider()
        order = self.delivered_order(swift, delivery="0.00", price="120.00")
        rider_helpers.waived(order, self.kofi)
        self.release(order)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 10000)            # 12000 - 500 fee - 1500 promo
        self.assertEqual(self.balance(Account.RIDER_BALANCE, swift.staff), 1350)
        self.assertEqual(self.balance(Account.RIDER_RESERVE, swift.staff), 150)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)

    def test_a_redispatched_delivery_pays_the_rider_who_delivered(self):
        first, second = rider_helpers.rider(), rider_helpers.rider("rider2@example.com", name="Yaw Boateng", phone="+233244000003")
        order = self.delivered_order(first)
        DeliveryAssignment.objects.filter(order=order).update(status=DeliveryAssignment.FAILED, delivered_at=None, failed_at=timezone.now())
        manager = make_staff("delivery_manager", "dm@example.com")
        delivery_services.assign(order, second.staff, manager, mode=DeliveryAssignment.MANUAL)   # the same row, a new rider
        DeliveryAssignment.objects.filter(order=order).update(
            status=DeliveryAssignment.CONFIRMED, delivered_at=timezone.now(), confirmed_at=timezone.now(), failed_at=None,
        )
        self.release(order)
        self.assertEqual(RiderEarning.objects.get(order=order).rider, second)
        self.assertEqual(self.balance(Account.RIDER_BALANCE, second.staff), 900)
        self.assertEqual(self.balance(Account.RIDER_BALANCE, first.staff), 0)                    # the failed attempt earned nothing
        self.assertFalse(Account.objects.filter(kind=Account.RIDER_BALANCE, owner_id=str(first.staff.pk)).exists())

    def test_a_skipped_shops_refund_still_pays_the_rider_the_whole_fee(self):
        swift, esi = rider_helpers.rider(), self.owner("Esi")
        order = self.paid([(self.listing(self.kofi, "60.00"), 1), (self.listing(esi, "40.00"), 1)], delivery="10.00")
        rider_helpers.delivered_by(order, swift)
        refunds.refund_order(order, 4000, source="skipped-shop-1", owner_ids={esi.pk})          # Esi's shop could not hand over
        self.release(order)
        self.assertEqual(self.balance(Account.RIDER_BALANCE, swift.staff), 900)                 # one order, one fee, never reduced
        self.assertEqual(self.balance(Account.RIDER_RESERVE, swift.staff), 100)

    def test_releasing_twice_pays_the_rider_once(self):
        swift = rider_helpers.rider()
        order = self.delivered_order(swift)
        self.release(order)
        self.assertIsNone(escrow.release_verified(order))
        self.assertIsNone(riders.credit_delivery(order, swift))
        self.assertEqual(RiderEarning.objects.filter(order=order).count(), 1)
        self.assertEqual(self.balance(Account.RIDER_BALANCE, swift.staff), 900)

    def test_supports_matches_call_pays_the_rider(self):
        swift = rider_helpers.rider()
        order = self.delivered_order(swift)
        verification.record(order, make_staff("support", "support@example.com"), FulfilmentCheck.MATCHES)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, swift.staff), 900)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, swift.staff), 100)

    def test_the_commission_rate_changes_only_through_the_money_setting_approval(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(make_staff('accountant', 'acc@example.com'))}")
        response = client.post("/api/ledger/settings/", {"key": "rider_commission_bp", "value": 1500}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(settings_store.current("rider_commission_bp"), 1000)                   # waits for a Super Admin
        approvals.approve(response.json()["approval_id"], make_staff("super_admin", "sa@example.com"))
        self.assertEqual(settings_store.current("rider_commission_bp"), 1500)


@override_settings(LEDGER_ENABLED=True)
class ConcurrentReleaseSwitchBackTests(TransactionTestCase):
    """The reason release takes the rider row lock (R3): a release and the switch back to AshantiHub's own, at the same
    moment, never leave an AshantiHub rider holding a wallet's money."""

    serialized_rollback = True

    def test_review_focus_a_release_and_a_switch_back_never_close_a_paid_wallet(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200990001", password_hash="x")
        owner = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207990001", password_hash="x")
        listing = Listing.objects.create(
            business_owner=owner, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name="Kente", description="D.", contact_phone=owner.login_phone, price_amount=Decimal("60.00"), status=Listing.PUBLISHED,
        )
        order = Order.objects.create(customer=customer, status=Order.PAID, total_amount=Decimal("70.00"), delivery_fee=Decimal("10.00"))
        OrderItem.objects.create(order=order, listing=listing, quantity=1, unit_price=Decimal("60.00"), line_total=Decimal("60.00"))
        swift = rider_helpers.rider()
        support, super_admin = make_staff("support", "support@example.com"), make_staff("super_admin", "sa@example.com")
        manager = make_staff("delivery_manager", "dm@example.com")
        # The manager stages the switch back while nothing is open yet (no delivery exists), so it can be proposed. Then the
        # order is paid and delivered, and the Super Admin's approval races Support's call.
        request = approvals.submit(
            manager, "delivery.rider_employment", title="Back to AshantiHub",
            payload={"rider_id": swift.pk, "employment": Rider.ASHANTIHUB, "company_name": ""}, target=swift,
        )
        escrow.record_order_payment(order)
        rider_helpers.delivered_by(order, swift)
        errors, barrier = [], threading.Barrier(2)

        def release():
            try:
                barrier.wait()
                verification.record(order, support, FulfilmentCheck.MATCHES)
            except Exception as exc:                                     # noqa: BLE001 - collected and asserted below
                errors.append(exc)
            finally:
                connection.close()

        def switch_back():
            try:
                barrier.wait()
                approvals.approve(request.pk, super_admin)
            except approvals.ApprovalError as exc:
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=release), threading.Thread(target=switch_back)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)
            self.assertFalse(thread.is_alive(), "a racing thread hung")
        self.assertTrue(all(isinstance(error, approvals.ApprovalError) for error in errors), errors)   # only a refusal, never a crash
        swift.refresh_from_db()
        balance = posting.balance_of(Account.RIDER_BALANCE, swift.staff)
        if swift.employment == Rider.THIRD_PARTY:                        # the switch back was refused: the rider was paid
            self.assertEqual((len(errors), balance, posting.balance_of(Account.RIDER_RESERVE, swift.staff)), (1, 900, 100))
        else:                                                            # it applied first: AshantiHub's own, so no wallet, fee kept
            self.assertEqual((balance, RiderEarning.objects.count()), (0, 0))
            self.assertEqual(posting.balance_of(Account.PLATFORM_DELIVERY_INCOME), 1000)
        self.assertFalse(swift.employment == Rider.ASHANTIHUB and balance != 0)


class RiderReleaseLedgerOffTests(RefundBase):
    def test_with_the_ledger_off_no_rider_is_paid(self):
        swift = rider_helpers.rider()
        order = self.order([(self.listing(self.owner("Kofi"), "60.00"), 1)], delivery="10.00")
        rider_helpers.delivered_by(order, swift)
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        self.assertIsNone(escrow.release_verified(order))
        self.assertFalse(RiderEarning.objects.exists())
        self.assertFalse(Account.objects.filter(kind=Account.RIDER_BALANCE).exists())


class SplitTests(SimpleTestCase):
    def test_the_reserve_is_rounded_half_up_and_the_net_is_the_rest(self):
        self.assertEqual(riders.split(1000, 1000), (100, 900))
        self.assertEqual(riders.split(1005, 1000), (101, 904))          # 100.5 -> 101
        self.assertEqual(riders.split(1004, 1000), (100, 904))          # 100.4 -> 100
        self.assertEqual(riders.split(1, 1000), (0, 1))
        self.assertEqual(riders.split(1000, 0), (0, 1000))
        self.assertEqual(riders.split(1000, 10000), (1000, 0))
```

- [ ] **Step 3: Run it to see it fail**

Run: `docker compose -p disp1 run --rm web python manage.py test ledger.tests.test_rider_release --noinput`
Expected: ERROR — `ImportError: cannot import name 'RiderEarning' from 'delivery.models'` (raised by `rider_helpers`).

- [ ] **Step 4: The models** — in `backend/delivery/models.py` replace the module docstring's last sentence

```python
A rider is a ``StaffUser`` with the ``dispatch`` role plus one ``Rider`` row. Nothing here moves money:
the rate card is a configuration, cash handovers are an operational count, and there is no payout,
payroll or ledger model (owner decision, Super Admin brief)."""
```

with

```python
A rider is a ``StaffUser`` with the ``dispatch`` role plus one ``Rider`` row. Nothing here moves money:
the rate card is a configuration and cash handovers are an operational count. A third-party rider's
earnings (``RiderEarning``, ``RiderCommissionPosting``; wallets Plan 5) are records the ledger writes
(``ledger.riders``); AshantiHub's own riders have no payout, payroll or ledger model (owner decision,
Super Admin brief)."""
```

and append after the `Shift` class (after its lines `        ordering = ["starts_at", "id"]` / `        indexes = [models.Index(fields=["starts_at"])]`):

```python


# ── Third-party riders' money (wallets Plan 5; written by ledger.riders) ────────────────────────
class RiderCommissionPosting(models.Model):
    """One end-of-day posting of a third-party rider's commission reserve to AshantiHub (spec §2.2 step 6): the deliveries
    of `day` (Accra) it covered and their gross, commission and net, in pesewas. `journal` is null when the commission
    was 0 (a 0% rate). Never edited. A day normally has one row per rider; a delivery credited after that day's run gets a
    row of its own."""

    rider = models.ForeignKey(Rider, on_delete=models.PROTECT, related_name="commission_postings")
    day = models.DateField()
    deliveries = models.PositiveIntegerField()
    gross_pesewas = models.BigIntegerField()
    commission_pesewas = models.BigIntegerField()
    net_pesewas = models.BigIntegerField()
    journal = models.OneToOneField(
        "ledger.Journal", null=True, blank=True, on_delete=models.PROTECT, related_name="rider_commission_posting",
    )
    posted_at = models.DateTimeField()

    class Meta:
        ordering = ["-day", "-id"]
        indexes = [models.Index(fields=["rider", "-day"]), models.Index(fields=["day"])]


class RiderEarning(models.Model):
    """What a third-party rider earned for one order (spec §2.2 step 2(c), §7): the delivery fee AshantiHub took at the
    order's release (`gross_pesewas`: the fee the customer paid plus a fee the business covered with its free-delivery
    promo), split at `commission_bp` (the rate in force when the order was paid) into `reserve_pesewas`, held until the
    end of `earned_on` (Accra), and `net_pesewas`, withdrawable at once. Written in the release's transaction (journal
    order-rider-<order>); afterwards only the end-of-day posting (`commission_posting`) and a reversal on a whole refund
    after release (`reversed_at`, `reversal_journal`) are written to it."""

    order = models.OneToOneField("orders.Order", on_delete=models.PROTECT, related_name="rider_earning")
    rider = models.ForeignKey(Rider, on_delete=models.PROTECT, related_name="earnings")
    gross_pesewas = models.BigIntegerField()
    commission_bp = models.PositiveIntegerField()
    reserve_pesewas = models.BigIntegerField()
    net_pesewas = models.BigIntegerField()
    earned_at = models.DateTimeField()
    earned_on = models.DateField()
    journal = models.OneToOneField("ledger.Journal", on_delete=models.PROTECT, related_name="rider_earning")
    commission_posting = models.ForeignKey(
        RiderCommissionPosting, null=True, blank=True, on_delete=models.PROTECT, related_name="earnings",
    )
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversal_journal = models.OneToOneField(
        "ledger.Journal", null=True, blank=True, on_delete=models.PROTECT, related_name="rider_earning_reversal",
    )

    class Meta:
        ordering = ["-earned_at", "-id"]
        indexes = [models.Index(fields=["rider", "earned_on"]), models.Index(fields=["earned_on", "commission_posting"])]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(gross_pesewas__gt=0, reserve_pesewas__gte=0, net_pesewas__gte=0),
                name="delivery_rider_earning_amounts",
            ),
            models.CheckConstraint(
                condition=models.Q(gross_pesewas=models.F("reserve_pesewas") + models.F("net_pesewas")),
                name="delivery_rider_earning_adds_up",
            ),
        ]
```

- [ ] **Step 5: Generate the migration**

Run: `docker compose -p disp1 run --rm --user "$(id -u):$(id -g)" web python manage.py makemigrations delivery --name rider_earnings`
Expected: `delivery/migrations/0008_rider_earnings.py` with `Create model RiderCommissionPosting` and `Create model RiderEarning` (its dependencies include `ledger` 0007 and the latest `orders` migration).

- [ ] **Step 6: The rider money module** — create `backend/ledger/riders.py`

```python
"""Third-party riders' money in the ledger (spec §1 rows 4-5, §2.1, §2.2 steps 2(c) and 6, §3.3, §7; wallets Plan 5).

A third-party rider (delivery.employment) is paid the delivery fee of each order they deliver when the order's money is
released: Support's positive verification call (ledger.verification.record -> escrow.release_verified), never at the
doorstep and never on a timer. In the release's own transaction, after the release journal and the business's
free-delivery promo charge, one journal `order-rider-<order>` (kind rider_earning) moves what those two credited to
platform delivery income on to the rider:
    Dr platform delivery income   gross (the fee the customer paid, plus a fee the business covered with its promo)
    Cr rider balance              net = gross - reserve (withdrawable at once)
    Cr rider reserve              reserve = gross x rate, half up (AshantiHub's commission, held until the end of the day)
The rate is `rider_commission_bp` as it stood when the order was paid (spec §3.3), kept on the RiderEarning row, so the
end-of-day posting needs no true-up. AshantiHub's own riders, store pickups, failed deliveries and deliveries made before
the rider became third-party pay no rider: the fee stays platform delivery income. A rider's accounts are held by their
staff account (otp.identity.ref gives ("staff", pk)), so the Stage 3b withdrawal engine pays them out.

Lock order (spec W7, extended): the order row, its fee snapshots, the rider row (release) or the earning row (refund),
then every ledger account in one sorted pass (posting.lock). The end-of-day job locks the day's earning rows, then the
accounts."""
from django.db.models import Sum
from django.utils import timezone

from delivery import employment
from delivery.models import Rider, RiderEarning
from orders.models import DeliveryAssignment, Order

from . import posting, settings_store
from .models import Account, Journal, JournalLine

COMMISSION_SETTING = "rider_commission_bp"


def earning_key(order):
    return f"order-rider-{order.pk}"


def split(gross, bp):
    """(reserve, net) of `gross` pesewas at `bp` basis points: the reserve rounded half up, the net what is left."""
    reserve = (gross * bp + 5000) // 10000
    return reserve, gross - reserve


def accounts_of(rider):
    """(Rider balance, Rider commission reserve) of this rider, held by their staff account (opened on first use)."""
    return posting.account_for(Account.RIDER_BALANCE, rider.staff), posting.account_for(Account.RIDER_RESERVE, rider.staff)


def third_party_rider(order, *, lock=False):
    """The third-party Rider who delivered this order, or None: not door to door, no delivery made (none, failed, never
    marked delivered), AshantiHub's own rider, or delivered before the rider became third-party. `lock` takes the rider
    row's lock (that row only), so a switch back to AshantiHub's own (delivery.employment.apply) waits for the caller."""
    if order.delivery_method != Order.DOOR_TO_DOOR:
        return None
    assignment = DeliveryAssignment.objects.filter(order_id=order.pk).first()
    if (
        assignment is None or assignment.status == DeliveryAssignment.FAILED or assignment.delivered_at is None
        or assignment.dispatch_id is None
    ):
        return None
    rows = Rider.objects.select_related("staff").filter(staff_id=assignment.dispatch_id)
    if lock:
        rows = rows.select_for_update(of=("self",))
    rider = rows.first()
    if rider is None:
        return None
    # History reads the employment periods (delivery.RiderEmploymentPeriod), never the current flag, so a later switch
    # back or forward cannot re-label this delivery.
    return rider if employment.third_party_at(rider, assignment.delivered_at) else None


def rider_for_release(order):
    """The third-party rider to pay at this order's release, their row locked, or None. Only when there is something to
    pay them: a delivery fee still held in the order's Delivery payable, or a free-delivery promo charge the business owes
    (so no empty rider account is ever opened). Call inside the release's transaction, after the order row and its fee
    snapshots (the caller holds the order row, so the payable cannot change meanwhile)."""
    from marketing.models_waivers import WaivedFeeCharge

    held = Account.objects.filter(
        kind=Account.DELIVERY_PAYABLE, owner_type=Order._meta.label_lower, owner_id=str(order.pk), net_credit__gt=0,
    ).exists()
    owed = WaivedFeeCharge.objects.filter(order_id=order.pk, status=WaivedFeeCharge.OWED, amount__gt=0).exists()
    return third_party_rider(order, lock=True) if held or owed else None


def release_accounts(rider):
    """The accounts credit_delivery posts to besides platform delivery income (already in the release's lock); none
    without a rider."""
    return accounts_of(rider) if rider is not None else ()


def _taken_as_delivery_income(order):
    """What this order's release and its free-delivery promo charge credited to platform delivery income."""
    from . import escrow

    total = JournalLine.objects.filter(
        journal__key__in=(escrow.release_key(order), escrow.waiver_key(order)), side=JournalLine.CREDIT,
        account__kind=Account.PLATFORM_DELIVERY_INCOME,
    ).aggregate(total=Sum("amount"))["total"]
    return total or 0


def credit_delivery(order, rider, now=None):
    """Pay `rider` the delivery fee AshantiHub took at this order's release (see the module text) and record the
    RiderEarning. Call last in escrow.release_verified's transaction, with the rider's accounts in its up-front lock.
    Returns the earning, or None (no rider, already paid, or nothing was taken for delivery)."""
    from . import escrow

    if rider is None or RiderEarning.objects.filter(order_id=order.pk).exists():
        return None
    gross = _taken_as_delivery_income(order)
    if gross <= 0:
        return None
    now = now or timezone.now()
    paid_at = Journal.objects.get(key=escrow.pay_key(order)).created_at
    bp = settings_store.current(COMMISSION_SETTING, paid_at)
    reserve, net = split(gross, bp)
    balance, held = accounts_of(rider)
    credits = []
    if net:
        credits.append(posting.credit(balance, net))
    if reserve:
        credits.append(posting.credit(held, reserve))
    journal = posting.post(
        key=earning_key(order), kind="rider_earning",
        lines=[posting.debit(posting.account_for(Account.PLATFORM_DELIVERY_INCOME), gross), *credits],
        reference_type="orders.order", reference_id=str(order.pk), memo=f"Delivery of order #{order.pk}, paid to the rider",
    )
    return RiderEarning.objects.create(
        order=order, rider=rider, gross_pesewas=gross, commission_bp=bp, reserve_pesewas=reserve, net_pesewas=net,
        earned_at=now, earned_on=timezone.localdate(now), journal=journal,
    )
```

- [ ] **Step 7: Wire it into the release** — in `backend/ledger/escrow.py`:

(a) replace `from . import fees, posting, settings_store` with `from . import fees, posting, riders, settings_store`;

(b) replace the end of the module docstring

```python
that waived the delivery fee through its free-delivery promo pays it from its Available right after (charge_waiver, kind
order_waiver_charge); a whole refund gives it back (return_waiver)."""
```

with

```python
that waived the delivery fee through its free-delivery promo pays it from its Available right after (charge_waiver, kind
order_waiver_charge); a whole refund gives it back (return_waiver). A third-party rider who delivered the order is then
paid what platform delivery income took for it, in the same transaction (ledger.riders.credit_delivery)."""
```

(c) replace

```python
        if not Journal.objects.filter(key=pay_key(order)).exists():
            return None
        # No snapshot left (a scoped refund took every item) is not the end: the delivery fee is still held in the
```

with

```python
        if not Journal.objects.filter(key=pay_key(order)).exists():
            return None
        # A third-party rider who delivered the order is paid at this release (ledger.riders, wallets Plan 5). Their row is
        # locked now - after the order and its snapshots, before any account - so a switch of the rider back to AshantiHub's
        # own (delivery.employment) waits for this release instead of closing a wallet it is about to pay.
        rider = riders.rider_for_release(order)
        # No snapshot left (a scoped refund took every item) is not the end: the delivery fee is still held in the
```

(d) two separate edits, in this order. The release's set-up between them (the Delivery payable, platform delivery income, the pendings and the availables) stays untouched, and `riders.release_accounts(rider)` stays inside the single sorted `posting.lock(...)` pass (spec W7): if it were dropped, `credit_delivery` would take the rider's account locks after the release's, which is the deadlock class Stage 3a closed.

(d1) replace the three comment lines

```python
        # Every account this transaction can post to, locked in one sorted pass (spec W7) before anything is decided
        # from a balance: the Delivery payable's is read from the locked row, and the promo charge's accounts (the
        # second posting, charge_waiver) are taken now so it never takes a new lock while the release's are held.
```

with

```python
        # Every account this transaction can post to, locked in one sorted pass (spec W7) before anything is decided
        # from a balance: the Delivery payable's is read from the locked row, and the promo charge's accounts (the
        # second posting, charge_waiver) and a third-party rider's (the third, riders.credit_delivery) are taken now so
        # neither takes a new lock while the release's are held.
```

(d2) replace the single line (several lines below the comment, after the set-up of `delivery_account`, `delivery_income`, `pendings` and `availables`)

```python
        locked = posting.lock(income, delivery_account, delivery_income, *pendings.values(), *availables.values(), *waiver_accounts(order))
```

with

```python
        locked = posting.lock(
            income, delivery_account, delivery_income, *pendings.values(), *availables.values(), *waiver_accounts(order),
            *riders.release_accounts(rider),
        )
```

(e) replace

```python
        OrderFeeSnapshot.objects.filter(pk__in=[s.pk for s in snapshots]).update(released_at=now)
        charge_waiver(order)
        return journal
```

with

```python
        OrderFeeSnapshot.objects.filter(pk__in=[s.pk for s in snapshots]).update(released_at=now)
        charge_waiver(order)
        # The delivery fee platform delivery income just took (release and promo charge) goes to a third-party rider: 90%
        # withdrawable, 10% held until the end of the day (spec §2.2 step 2(c)). Plan 4's vendor texts, if merged, follow.
        riders.credit_delivery(order, rider, now)
        return journal
```

- [ ] **Step 8: Run the tests to see them pass**

Run: `docker compose -p disp1 run --rm web python manage.py test ledger.tests.test_rider_release --noinput`
Expected: PASS (14 tests).

Run: `grep -n "riders.release_accounts(rider)" -B3 -A1 backend/ledger/escrow.py` and check the line sits inside the `posting.lock(` call of `release_verified` (not after it, not in a later statement).

Run: `docker compose -p disp1 run --rm web python manage.py test ledger --noinput`
Expected: PASS (every Stage 1/3a release and refund test unchanged: their orders have no rider, or a rider with no `dispatch`).

- [ ] **Step 9: Commit**

```bash
git add backend/delivery/models.py backend/delivery/migrations/0008_rider_earnings.py backend/ledger/riders.py backend/ledger/escrow.py backend/ledger/tests/rider_helpers.py backend/ledger/tests/test_rider_release.py
git commit -F - <<'EOF'
feat(ledger): pay a third-party rider the delivery fee at release, 90% balance and 10% reserve at the rate in force when paid

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 3: End of day — each day's reserve to AshantiHub's commission income, once

**Files:**
- Modify: `backend/ledger/riders.py` (imports; `commission_key`, `post_day`, `post_commission`), `backend/ledger/tasks.py`, `backend/ashantihub/settings.py` (`CELERY_BEAT_SCHEDULE`)
- Create: `backend/ledger/tests/test_rider_commission.py`

**Interfaces:**
- Consumes: Task 2's `RiderEarning`, `RiderCommissionPosting`, `riders.accounts_of`, `rider_helpers.rider/delivered_by/earning`; `escrow.enabled()`.
- Produces:
  - `riders.commission_key(rider, day, first_earning_pk) -> str`
  - `riders.post_day(rider_id, day, now=None) -> RiderCommissionPosting | None`
  - `riders.post_commission(today=None, now=None) -> int` (postings made)
  - `ledger.tasks.post_rider_commission()` and the beat entry `ledger-post-rider-commission` (00:20 daily)

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_rider_commission.py`

```python
"""End of day for third-party riders (wallets Plan 5, Task 3; spec §1 row 5, §2.2 step 6): each earlier day's reserve goes
to platform commission income exactly once, with the day's deliveries, gross, commission and net recorded; a missed
night is caught up. Review Focus 3."""
import threading
from datetime import timedelta

from django.conf import settings
from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from delivery.models import RiderCommissionPosting, RiderEarning
from ledger import escrow, posting, riders, tasks
from ledger.models import Account, FulfilmentCheck, MoneySetting

from . import rider_helpers
from .test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class EndOfDayTests(RefundBase):
    def setUp(self):
        super().setUp()
        self.kofi = self.owner("Kofi")
        self.today = timezone.localdate()
        self.yesterday = timezone.localtime().replace(hour=12, minute=0, second=0, microsecond=0) - timedelta(days=1)

    def delivered(self, by, at, fee="10.00"):
        """An order `by` delivered an hour before `at`, released by Support's call at `at`."""
        order = self.paid([(self.listing(self.kofi, "60.00"), 1)], delivery=fee)
        rider_helpers.delivered_by(order, by, at=at - timedelta(hours=1))
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        escrow.release_verified(order, now=at)
        return RiderEarning.objects.get(order=order)

    def test_review_focus_end_of_day_posts_each_riders_reserve_once(self):
        swift = rider_helpers.rider("swift@example.com")
        fast = rider_helpers.rider("fast@example.com", name="Yaw Boateng", phone="+233244000003", company="Fast Riders")
        self.delivered(swift, self.yesterday)
        self.delivered(swift, self.yesterday, fee="20.00")
        self.delivered(fast, self.yesterday)
        self.assertEqual(riders.post_commission(today=self.today), 2)
        self.assertEqual(self.balance(Account.RIDER_RESERVE, swift.staff), 0)
        self.assertEqual(self.balance(Account.RIDER_RESERVE, fast.staff), 0)
        self.assertEqual(self.balance(Account.PLATFORM_COMMISSION_INCOME), 400)                # 100 + 200 + 100
        self.assertEqual(self.balance(Account.RIDER_BALANCE, swift.staff), 2700)               # untouched: 900 + 1800
        row = RiderCommissionPosting.objects.get(rider=swift)
        self.assertEqual(
            (row.day, row.deliveries, row.gross_pesewas, row.commission_pesewas, row.net_pesewas),
            (self.yesterday.date(), 2, 3000, 300, 2700),
        )
        self.assertEqual(row.journal.kind, "rider_commission")
        self.assertFalse(RiderEarning.objects.filter(commission_posting__isnull=True).exists())
        self.assertEqual(riders.post_commission(today=self.today), 0)                          # a second run posts nothing
        self.assertEqual(RiderCommissionPosting.objects.count(), 2)
        self.assertEqual(self.balance(Account.PLATFORM_COMMISSION_INCOME), 400)

    def test_todays_deliveries_wait_for_the_end_of_the_day(self):
        swift = rider_helpers.rider()
        self.delivered(swift, timezone.now())
        self.assertEqual(riders.post_commission(today=self.today), 0)
        self.assertEqual(self.balance(Account.RIDER_RESERVE, swift.staff), 100)

    def test_review_focus_a_missed_night_is_caught_up_day_by_day(self):
        swift = rider_helpers.rider()
        self.delivered(swift, self.yesterday - timedelta(days=1))
        self.delivered(swift, self.yesterday)
        self.assertEqual(riders.post_commission(today=self.today), 2)
        self.assertEqual(
            sorted(RiderCommissionPosting.objects.values_list("day", flat=True)),
            [self.yesterday.date() - timedelta(days=1), self.yesterday.date()],
        )
        self.assertEqual(self.balance(Account.PLATFORM_COMMISSION_INCOME), 200)

    def test_a_zero_rate_records_the_day_without_a_journal(self):
        MoneySetting.objects.create(key="rider_commission_bp", value=0, effective_from=timezone.now() - timedelta(days=60))
        swift = rider_helpers.rider()
        earning = self.delivered(swift, self.yesterday)
        self.assertEqual((earning.reserve_pesewas, earning.net_pesewas), (0, 1000))
        self.assertEqual(riders.post_commission(today=self.today), 1)
        row = RiderCommissionPosting.objects.get()
        self.assertEqual((row.gross_pesewas, row.commission_pesewas, row.net_pesewas, row.journal), (1000, 0, 1000, None))

    def test_the_job_runs_after_midnight_and_does_nothing_with_the_ledger_off(self):
        entry = settings.CELERY_BEAT_SCHEDULE["ledger-post-rider-commission"]
        self.assertEqual(entry["task"], "ledger.tasks.post_rider_commission")
        self.assertEqual((entry["schedule"].hour, entry["schedule"].minute), ({0}, {20}))
        swift = rider_helpers.rider()
        self.delivered(swift, self.yesterday)
        with override_settings(LEDGER_ENABLED=False):
            self.assertEqual(tasks.post_rider_commission(), 0)
        self.assertEqual(tasks.post_rider_commission(), 1)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, swift.staff), 0)


class ConcurrentEndOfDayTests(TransactionTestCase):
    serialized_rollback = True

    def test_review_focus_two_runs_at_once_post_once(self):
        swift = rider_helpers.rider()
        yesterday = timezone.now() - timedelta(days=1)
        for gross in (1000, 2000):
            rider_helpers.earning(swift, gross=gross, at=yesterday)
        day = timezone.localdate(yesterday)
        results, errors, barrier = [], [], threading.Barrier(2)

        def run():
            try:
                barrier.wait()
                results.append(riders.post_day(swift.pk, day))
            except Exception as exc:  # reported below, never swallowed
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing thread hung")
        self.assertEqual(errors, [])
        self.assertEqual(sum(1 for result in results if result is not None), 1)
        self.assertEqual(RiderCommissionPosting.objects.count(), 1)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, swift.staff), 0)
        self.assertEqual(posting.balance_of(Account.PLATFORM_COMMISSION_INCOME), 300)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p disp1 run --rm web python manage.py test ledger.tests.test_rider_commission --noinput`
Expected: FAIL/ERROR — `AttributeError: module 'ledger.riders' has no attribute 'post_commission'` (and `KeyError: 'ledger-post-rider-commission'`).

- [ ] **Step 3: The posting** — in `backend/ledger/riders.py` replace

```python
from django.db.models import Sum
from django.utils import timezone

from delivery.models import Rider, RiderEarning
```

with

```python
import logging

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from delivery.models import Rider, RiderCommissionPosting, RiderEarning
```

and replace

```python
COMMISSION_SETTING = "rider_commission_bp"
```

with

```python
logger = logging.getLogger(__name__)
COMMISSION_SETTING = "rider_commission_bp"
```

then append to the end of the file:

```python


# --- end of day (spec §2.2 step 6) ------------------------------------------------------------------------------------

def commission_key(rider, day, first_earning_pk):
    return f"rider-commission-{rider.staff_id}-{day:%Y-%m-%d}-{first_earning_pk}"


def post_day(rider_id, day, now=None):
    """Post one rider's commission held for `day`: the reserve of every earning of that day not yet posted or reversed goes
    to platform commission income (Dr rider reserve, Cr platform commission income; no journal when it is 0), and the
    day's deliveries, gross, commission and net are recorded on a RiderCommissionPosting. The earning rows are locked
    first and filtered again under the lock, so a second run (or a refund reversing one) never posts a reserve twice.
    Returns the posting, or None when nothing is left to post."""
    now = now or timezone.now()
    with transaction.atomic():
        earnings = list(
            RiderEarning.objects.select_for_update(of=("self",))
            .filter(rider_id=rider_id, earned_on=day, commission_posting__isnull=True, reversed_at__isnull=True)
            .order_by("pk")
        )
        if not earnings:
            return None
        rider = Rider.objects.select_related("staff").get(pk=rider_id)
        gross = sum(earning.gross_pesewas for earning in earnings)
        commission = sum(earning.reserve_pesewas for earning in earnings)
        journal = None
        if commission:
            journal = posting.post(
                key=commission_key(rider, day, earnings[0].pk), kind="rider_commission",
                lines=[
                    posting.debit(accounts_of(rider)[1], commission),
                    posting.credit(posting.account_for(Account.PLATFORM_COMMISSION_INCOME), commission),
                ],
                reference_type="accounts.staffuser", reference_id=str(rider.staff_id),
                memo=f"Commission on {len(earnings)} deliveries of {day:%Y-%m-%d}",
            )
        row = RiderCommissionPosting.objects.create(
            rider=rider, day=day, deliveries=len(earnings), gross_pesewas=gross, commission_pesewas=commission,
            net_pesewas=gross - commission, journal=journal, posted_at=now,
        )
        RiderEarning.objects.filter(pk__in=[earning.pk for earning in earnings]).update(commission_posting=row)
        return row


def post_commission(today=None, now=None):
    """The end-of-day job: post every rider's held commission of each day before `today` (Accra), oldest first, so a
    missed night is caught up by the next run. A no-op while the ledger is off. One rider-day that fails is logged and
    skipped, so it never stops the others. Returns how many postings were made."""
    from . import escrow

    if not escrow.enabled():
        return 0
    now = now or timezone.now()
    today = today or timezone.localdate(now)
    groups = list(
        RiderEarning.objects.filter(commission_posting__isnull=True, reversed_at__isnull=True, earned_on__lt=today)
        .order_by("earned_on", "rider_id").values_list("rider_id", "earned_on").distinct()
    )
    done = 0
    for rider_id, day in groups:
        try:
            if post_day(rider_id, day, now) is not None:
                done += 1
        except Exception:  # one rider-day the ledger refuses must not stop every other rider's posting
            logger.exception("Rider commission posting failed for rider %s on %s", rider_id, day)
    return done
```

- [ ] **Step 4: The job** — replace the whole of `backend/ledger/tasks.py` with

```python
from celery import shared_task

from . import riders, verification


@shared_task
def refund_uncollected_pickups():
    """Hourly: store-pickup orders not collected within the pickup window go back to the customer's wallet (a no-op
    while the ledger is off). The beat entry makes core.jobs keep a JobRun heartbeat for it."""
    return verification.expire_uncollected()


@shared_task
def post_rider_commission():
    """00:20 every day: third-party riders' commission held for earlier days goes to AshantiHub's commission income (a
    no-op while the ledger is off; a missed night is caught up by the next run). The beat entry makes core.jobs keep a
    JobRun heartbeat for it."""
    return riders.post_commission()
```

and in `backend/ashantihub/settings.py` replace

```python
    "ledger-refund-uncollected-pickups": {
        "task": "ledger.tasks.refund_uncollected_pickups",
        "schedule": crontab(minute=25),  # hourly, at twenty-five past: a no-op while the ledger is off
    },
```

with

```python
    "ledger-refund-uncollected-pickups": {
        "task": "ledger.tasks.refund_uncollected_pickups",
        "schedule": crontab(minute=25),  # hourly, at twenty-five past: a no-op while the ledger is off
    },
    "ledger-post-rider-commission": {
        "task": "ledger.tasks.post_rider_commission",
        "schedule": crontab(hour=0, minute=20),  # earlier days' rider commission (Accra); a no-op while the ledger is off
    },
```

- [ ] **Step 5: Run the test to see it pass**

Run: `docker compose -p disp1 run --rm web python manage.py test ledger.tests.test_rider_commission --noinput`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/ledger/riders.py backend/ledger/tasks.py backend/ashantihub/settings.py backend/ledger/tests/test_rider_commission.py
git commit -F - <<'EOF'
feat(ledger): end-of-day rider commission - each earlier day's reserve posted once, day totals recorded, missed nights caught up

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 4: Refunds — a whole refund after release takes the delivery back from the rider

> **Note (Task 3 review).** The refund locks the earning row, so after that it must NOT insert any row with a foreign key to `Rider` (a notice keyed on Rider, say): the end-of-day job takes the rider row first and its commit waits on a `FOR UPDATE` holder of that row, so a refund holding the earning row and then touching the rider would bring back the cycle.

> **Note (Task 2 review).** Until this task lands, a whole refund after release takes the delivery fee back from shared platform delivery income, not from the rider who was paid it (Task 2 already moved the fee to the rider). Do not turn the ledger on for riders before this task is merged.

**Files:**
- Modify: `backend/ledger/riders.py` (`reversal_key`, `earning_to_reverse`, `reversal_accounts`, `reverse_earning`), `backend/ledger/refunds.py` (imports, module docstring, `_free_promo`, `_post`)
- Create: `backend/ledger/tests/test_rider_refunds.py`

**Interfaces:**
- Consumes: Task 2's `RiderEarning`, `riders.accounts_of`, `earning_key`; Task 3's `post_commission`; `refunds.refund_order`, `escrow.release_key`, `posting.post(..., allow_negative=...)`.
- Produces:
  - `riders.reversal_key(order) -> str`
  - `riders.earning_to_reverse(order) -> RiderEarning | None` (locks the earning row)
  - `riders.reversal_accounts(earning) -> tuple` (`()` for None)
  - `riders.reverse_earning(earning, now=None) -> Journal`
  - `refunds.refund_order` reverses a rider's earning on a whole refund after release, and `_free_promo` does when it returns a promo after release (no signature changes)

- [ ] **Step 1: Write the failing test** — `backend/ledger/tests/test_rider_refunds.py`

```python
"""Refunds and a third-party rider's pay (wallets Plan 5, Task 4; spec §2.2 steps 3-4 and 6, §13 W4): before release the
rider was never paid; after release a partial refund leaves them paid and a whole refund takes the earning back first
(the balance may go below zero; the reserve, or the commission once posted). Review Focus 1, 3 and 7."""
import threading
from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from accounts.models import BusinessOwner, Customer
from delivery.models import RiderEarning
from ledger import escrow, posting, refunds, riders
from ledger.models import Account, FulfilmentCheck
from listings.models import Category, Listing, Zone
from notifications.models import Notification
from orders.models import Order, OrderItem

from . import rider_helpers
from .test_refunds import RefundBase


@override_settings(LEDGER_ENABLED=True)
class RiderRefundTests(RefundBase):
    def setUp(self):
        super().setUp()
        self.kofi = self.owner("Kofi")
        self.swift = rider_helpers.rider()

    def delivered_order(self, *, delivery="10.00", price="60.00"):
        order = self.paid([(self.listing(self.kofi, price), 1)], delivery=delivery)
        rider_helpers.delivered_by(order, self.swift)
        return order

    def rider_balances(self):
        return (
            posting.balance_of(Account.RIDER_BALANCE, self.swift.staff), posting.balance_of(Account.RIDER_RESERVE, self.swift.staff),
        )

    def test_review_focus_a_whole_refund_before_release_pays_the_rider_nothing(self):
        order = self.delivered_order()
        refunds.refund_order(order, source="dispute-1")                                     # the whole order, delivery included
        self.assertEqual(self.wallet(), 7000)
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        self.assertIsNone(escrow.release_verified(order))
        self.assertFalse(RiderEarning.objects.exists())
        self.assertFalse(Account.objects.filter(kind=Account.RIDER_BALANCE).exists())        # no empty wallet opened

    def test_a_partial_refund_after_release_leaves_the_rider_paid(self):
        order = self.delivered_order()
        self.release(order)
        refunds.refund_order(order, 3000, source="dispute-1")
        self.assertEqual(self.rider_balances(), (900, 100))
        self.assertIsNone(RiderEarning.objects.get(order=order).reversed_at)

    def test_every_item_refunded_before_release_still_pays_the_rider_the_delivery(self):
        order = self.delivered_order()
        refunds.refund_order(order, source="dispute-1", owner_ids={self.kofi.pk})           # items back; the fee stays held
        self.release(order)
        self.assertEqual(self.rider_balances(), (900, 100))

    def test_review_focus_a_whole_refund_after_release_takes_the_delivery_back_from_the_rider(self):
        order = self.delivered_order()
        self.release(order)
        refund = refunds.refund_order(order, source="dispute-1")
        self.assertTrue(refund.whole)
        self.assertEqual(self.wallet(), 7000)
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        earning = RiderEarning.objects.get(order=order)
        self.assertIsNotNone(earning.reversed_at)
        self.assertEqual(
            (earning.reversal_journal.key, earning.reversal_journal.kind), (f"order-rider-reversal-{order.pk}", "rider_earning_reversal"),
        )
        self.assertEqual(riders.post_commission(today=timezone.localdate() + timedelta(days=1)), 0)  # a reversed one is never posted
        self.assertEqual(self.balance(Account.PLATFORM_COMMISSION_INCOME), 0)
        told = Notification.objects.filter(staff=self.swift.staff, title="A delivery was taken back")   # the rider is told (S5)
        self.assertEqual(told.count(), 1)
        self.assertIn(f"Order #{order.pk} was refunded in full", told.get().body)
        self.assertIn("GH₵ 9", told.get().body)

    def test_after_the_days_commission_was_posted_ashantihub_gives_its_commission_back(self):
        order = self.delivered_order()
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        escrow.release_verified(order, now=timezone.now() - timedelta(days=1))
        self.assertEqual(riders.post_commission(today=timezone.localdate()), 1)
        self.assertEqual(self.balance(Account.PLATFORM_COMMISSION_INCOME), 100)
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.balance(Account.PLATFORM_COMMISSION_INCOME), 0)
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assertEqual(self.wallet(), 7000)
        # The day record still names the delivery; the views show what was given back from the reversed earnings (S4).
        earning = RiderEarning.objects.get(order=order)
        self.assertEqual((earning.commission_posting.commission_pesewas, earning.reserve_pesewas, earning.reversed_at is not None), (100, 100, True))

    def test_review_focus_a_rider_who_already_withdrew_goes_below_zero(self):
        order = self.delivered_order()
        self.release(order)
        balance, _ = riders.accounts_of(self.swift)
        posting.post(key="spent", kind="test", lines=[
            posting.debit(balance, 900), posting.credit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), 900),
        ])
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.rider_balances(), (-900, 0))                                    # recovered from later deliveries
        self.assertEqual(self.wallet(), 7000)
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)                  # AshantiHub is never short

    def test_a_promo_order_refunded_whole_after_release_unwinds_the_rider_and_the_business(self):
        order = self.delivered_order(delivery="0.00", price="120.00")
        rider_helpers.waived(order, self.kofi)
        self.release(order)                                                                    # rider 1350 + 150 of the promo
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 0)
        self.assertEqual(self.wallet(), 12000)

    def test_a_promo_fee_comes_back_from_the_rider_when_shop_refunds_then_a_last_refund_empty_the_order(self):
        order = self.delivered_order(delivery="0.00", price="120.00")
        rider_helpers.waived(order, self.kofi)
        self.release(order)
        refunds.refund_order(order, source="dispute-1", owner_ids={self.kofi.pk})            # every item, shop-scoped: not whole
        self.assertEqual(self.rider_balances(), (1350, 150))
        self.assertIsNone(refunds.refund_order(order, source="dispute-2"))                   # nothing left: the promo goes back
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertEqual(self.balance(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assertEqual(self.balance(Account.VENDOR_AVAILABLE, self.kofi), 0)
        self.assertIsNotNone(RiderEarning.objects.get(order=order).reversed_at)

    def test_the_same_refund_twice_takes_the_delivery_back_once(self):
        order = self.delivered_order()
        self.release(order)
        refunds.refund_order(order, source="dispute-1")
        refunds.refund_order(order, source="dispute-1")
        self.assertEqual(self.rider_balances(), (0, 0))
        self.assertEqual(self.wallet(), 7000)


class ConcurrentRiderRefundTests(TransactionTestCase):
    serialized_rollback = True

    @override_settings(LEDGER_ENABLED=True)
    def test_review_focus_a_refund_racing_the_end_of_day_never_takes_the_commission_twice(self):
        customer = Customer.objects.create(full_name="Ama", phone="+233200990001", password_hash="x")
        kofi = BusinessOwner.objects.create(full_name="Kofi", login_phone="+233207990001", password_hash="x")
        listing = Listing.objects.create(
            business_owner=kofi, category=Category.objects.get(slug="shops"), zone=Zone.objects.get(name="Manhyia"),
            name="Item", description="D.", contact_phone=kofi.login_phone, price_amount=Decimal("60.00"), status=Listing.PUBLISHED,
        )
        order = Order.objects.create(
            customer=customer, status=Order.PAID, total_amount=Decimal("70.00"), discount_amount=Decimal("0.00"),
            delivery_fee=Decimal("10.00"),
        )
        OrderItem.objects.create(order=order, listing=listing, quantity=1, unit_price=listing.price_amount, line_total=listing.price_amount)
        escrow.record_order_payment(order)
        swift = rider_helpers.rider()
        rider_helpers.delivered_by(order, swift)
        FulfilmentCheck.objects.create(order=order, outcome=FulfilmentCheck.MATCHES)
        escrow.release_verified(order, now=timezone.now() - timedelta(days=1))
        work = [lambda: riders.post_commission(today=timezone.localdate()), lambda: refunds.refund_order(order, source="dispute-1")]
        errors, barrier = [], threading.Barrier(2)

        def run(job):
            try:
                barrier.wait()
                job()
            except Exception as exc:  # reported below, never swallowed
                errors.append(exc)
            finally:
                connection.close()

        threads = [threading.Thread(target=run, args=(job,)) for job in work]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
            self.assertFalse(thread.is_alive(), "a racing thread hung")
        self.assertEqual(errors, [])
        # Whichever ran first, the commission is either never posted or posted and given back: never taken twice.
        self.assertEqual(posting.balance_of(Account.PLATFORM_COMMISSION_INCOME), 0)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, swift.staff), 0)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, swift.staff), 0)
        self.assertEqual(posting.balance_of(Account.PLATFORM_DELIVERY_INCOME), 0)
        self.assertEqual(posting.balance_of(Account.CUSTOMER_WALLET, customer), 7000)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p disp1 run --rm web python manage.py test ledger.tests.test_rider_refunds --noinput`
Expected: FAIL/ERROR — the whole-refund-after-release tests raise `InsufficientFunds: platform_delivery_income would go below zero` (the fee was passed to the rider and nothing takes it back yet).

- [ ] **Step 3: The reversal** — append to the end of `backend/ledger/riders.py`:

```python


# --- refunds (spec §2.2 step 6: "A reversed delivery reverses its share of the reserve") --------------------------------

def reversal_key(order):
    return f"order-rider-reversal-{order.pk}"


def earning_to_reverse(order):
    """The order's rider earning not yet reversed, its row locked (after the order row and its fee snapshots, before any
    account), or None."""
    return (
        RiderEarning.objects.select_for_update(of=("self",)).select_related("rider__staff", "order")
        .filter(order_id=order.pk, reversed_at__isnull=True).first()
    )


def reversal_accounts(earning):
    """(rider balance, where the reserve is taken from, platform delivery income) for reverse_earning, for the caller's
    up-front lock; () without an earning. The reserve comes back from the rider's reserve, or from platform commission
    income once the day's commission was posted."""
    if earning is None:
        return ()
    balance, held = accounts_of(earning.rider)
    taker = posting.account_for(Account.PLATFORM_COMMISSION_INCOME) if earning.commission_posting_id else held
    return balance, taker, posting.account_for(Account.PLATFORM_DELIVERY_INCOME)


def reverse_earning(earning, now=None):
    """The whole order is refunded after release, delivery fee included, so the rider's pay for it comes back first:
    Dr rider balance (the net; it may go below zero, recovered from later deliveries, and blocks withdrawals meanwhile),
    Dr the reserve (or platform commission income once posted: AshantiHub gives its commission back), Cr platform
    delivery income, from which the refund then returns the fee. Call with the earning locked (earning_to_reverse) and
    reversal_accounts(earning) in the caller's one up-front lock. Idempotent on its key."""
    now = now or timezone.now()
    balance, taker, delivery_income = reversal_accounts(earning)
    debits = []
    if earning.net_pesewas:
        debits.append(posting.debit(balance, earning.net_pesewas))
    if earning.reserve_pesewas:
        debits.append(posting.debit(taker, earning.reserve_pesewas))
    journal = posting.post(
        key=reversal_key(earning.order), kind="rider_earning_reversal",
        lines=[*debits, posting.credit(delivery_income, earning.gross_pesewas)],
        reference_type="orders.order", reference_id=str(earning.order_id),
        memo=f"Order #{earning.order_id} refunded in full: its delivery fee taken back from the rider",
        allow_negative={Account.RIDER_BALANCE},
    )
    earning.reversed_at, earning.reversal_journal = now, journal
    earning.save(update_fields=["reversed_at", "reversal_journal"])
    # Tell the rider: money left their balance (possibly below zero, which blocks withdrawals). This runs inside the refund's
    # transaction; notify only creates a row. The day's RiderCommissionPosting row is never edited (records are append-only);
    # the rider's days and the Accountant's commission report show the commission given back from the reversed earnings.
    from notifications.services import notify_staff

    from .money import from_pesewas

    notify_staff(
        earning.rider.staff, "withdrawal", "A delivery was taken back",
        body=f"Order #{earning.order_id} was refunded in full, so GH₵ {from_pesewas(earning.net_pesewas)} came back out of your balance.",
        link="/staff", icon="↩️",
    )
    return journal
```

- [ ] **Step 4: Wire it into refunds** — in `backend/ledger/refunds.py`:

(a) replace `from . import escrow, posting` with `from . import escrow, posting, riders`;

(b) in the module docstring replace

```python
* The provider's collection charge ("payment processing") is not refunded, except when staff say AshantiHub or a vendor
```

with

```python
* A third-party rider paid the delivery fee at release (ledger.riders) gives it back when the whole order is refunded
  after release, before the refund journal takes the fee from platform delivery income (riders.reverse_earning; the
  same when an emptied promo order's promo goes back to the business). A partial refund never touches the rider (it
  never returns the delivery fee); before release the rider was never paid.
* The provider's collection charge ("payment processing") is not refunded, except when staff say AshantiHub or a vendor
```

(c) replace

```python
def _free_promo(order, extra):
    """Give a charged free-delivery promo back and reverse an owed one (locks first: spec W7)."""
    from marketing.waivers import reverse_for_order

    posting.lock(*escrow.waiver_return_accounts(order), *extra)
    escrow.return_waiver(order)
    reverse_for_order(order, "order_refunded")
```

with

```python
def _free_promo(order, extra):
    """Give a charged free-delivery promo back and reverse an owed one (locks first: spec W7). After release, a
    third-party rider who was paid the promo's fee gives it back first, so platform delivery income holds what
    return_waiver takes (lock order: the earning row, then the accounts)."""
    from marketing.waivers import reverse_for_order

    released = Journal.objects.filter(key=escrow.release_key(order)).exists()
    earning = riders.earning_to_reverse(order) if released else None
    posting.lock(*escrow.waiver_return_accounts(order), *extra, *riders.reversal_accounts(earning))
    if earning is not None:
        riders.reverse_earning(earning)
    escrow.return_waiver(order)
    reverse_for_order(order, "order_refunded")
```

(d) replace

```python
def _post(order, snapshots, shares, *, customer, delivery, subsidy, processing, whole, source, by, note, now, extra_locks=()):
    released = Journal.objects.filter(key=escrow.release_key(order)).exists()
    by_vendor, allocation = {}, []
```

with

```python
def _post(order, snapshots, shares, *, customer, delivery, subsidy, processing, whole, source, by, note, now, extra_locks=()):
    released = Journal.objects.filter(key=escrow.release_key(order)).exists()
    # A whole refund after release takes the delivery fee back from platform delivery income; a third-party rider who
    # was paid it gives it back first. Their earning row is locked here: after the order row and its snapshots, before
    # any account (wallets Plan 5).
    earning = riders.earning_to_reverse(order) if whole and released else None
    by_vendor, allocation = {}, []
```

(e) replace

```python
    posting.lock(*(line.account for line in debits + credits), *extra_locks)
    journal = None
```

with

```python
    posting.lock(*(line.account for line in debits + credits), *extra_locks, *riders.reversal_accounts(earning))
    if earning is not None:
        riders.reverse_earning(earning, now)                     # first: the refund below takes the fee back from there
    journal = None
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `docker compose -p disp1 run --rm web python manage.py test ledger.tests.test_rider_refunds --noinput`
Expected: PASS (10 tests).

Run: `docker compose -p disp1 run --rm web python manage.py test ledger disputes delivery --noinput`
Expected: PASS (no refund or release test without a third-party rider changes).

- [ ] **Step 6: Commit**

```bash
git add backend/ledger/riders.py backend/ledger/refunds.py backend/ledger/tests/test_rider_refunds.py
git commit -F - <<'EOF'
feat(ledger): a whole refund after release takes the delivery back from the rider (reserve or commission), never twice

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 5: The withdrawal engine serves third-party riders; step-up codes for riders

**Files:**
- Modify: `backend/wallets/names.py` (`verified_names`, docstring), `backend/wallets/destinations.py` (`_holder_problem`, `_rider_problem`, imports), `backend/wallets/withdrawals.py` (`source_kind`, `request`, `NEGATIVE`, imports, docstring), `backend/wallets/payouts.py` (`_holder_model`, `claim`, `_tell`, imports), `backend/otp/views_step_up.py` (`IsCustomerOwnerOrWalletRider`, `RIDER_ACTIONS`, `_codes_off`, module text), `backend/otp/step_up.py` (module text only)
- Create: `backend/wallets/tests/test_rider_engine.py`

**Interfaces:**
- Consumes: Task 1's `employment.wallet_rider(staff)`, `id_verified(rider)`, `WALLET_DISABLED`; Task 2's `riders.accounts_of`, `rider_helpers.rider/ghana_card`; Stage 3b `destinations.check/save`, `withdrawals.request`, `payouts.claim/submit`, `wallets.tests.helpers.destination`.
- Produces:
  - `names.verified_names(staff)` = `[staff.full_name]` for a third-party rider with an approved, in-date Ghana Card, else `[]`
  - `destinations.DestinationError` codes `wallet_disabled` (409) and `id_required` (409) for riders; `suspended` (403) for a deactivated staff account
  - `withdrawals.source_kind(staff) -> Account.RIDER_BALANCE` (or `WithdrawalError` 409 `wallet_disabled`); `withdrawals.NEGATIVE` (dict: account kind → refusal text)
  - `payouts.HOLDER_MODELS = {"customer": Customer, "business_owner": BusinessOwner, "staff": StaffUser}`
  - `otp.views_step_up.RIDER_ACTIONS = (step_up.WITHDRAWAL, step_up.PAYOUT_DESTINATION)`, `IsCustomerOwnerOrWalletRider`

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_rider_engine.py`

```python
"""Third-party riders withdraw through the Stage 3b engine (wallets Plan 5, Task 5; spec §2.2 step 5, §7, §8, §9): their
balance only (never the reserve), to an account in their own name once an approved Ghana Card is on file, confirmed with
a texted or emailed code. AshantiHub's own riders have no wallet. Review Focus 1, 4 and 6."""
from datetime import timedelta

from django.core.cache import cache
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from delivery.models import Rider, RiderDocument, RiderEmploymentPeriod
from ledger import posting, riders
from ledger.models import Account
from ledger.tests import rider_helpers
from notifications.models import Notification
from otp import senders
from otp.tests.helpers import last_sms_code
from wallets import destinations, names, payouts, withdrawals
from wallets.models import Withdrawal

from .helpers import destination

MOMO = {"rail": "momo", "institution": "MTN", "account_number": "0241234567"}


@override_settings(LEDGER_ENABLED=True)
class RiderEngineTests(TestCase):
    def setUp(self):
        self.swift = rider_helpers.rider()
        self.staff = self.swift.staff
        rider_helpers.ghana_card(self.swift)

    def fund(self, net=900, reserve=100):
        balance, held = riders.accounts_of(self.swift)
        lines = [posting.debit(posting.account_for(Account.PROVIDER_CLEARING), net + reserve), posting.credit(balance, net)]
        if reserve:
            lines.append(posting.credit(held, reserve))
        posting.post(key=f"fund-{net}-{reserve}", kind="test_fund", lines=lines)

    def hold(self, amount, request_id="req-rider-0001", holder=None):
        with transaction.atomic():
            return withdrawals.request(
                holder or self.staff, destination_id=self.dest.pk, amount_pesewas=amount, request_id=request_id,
            )

    def refused(self, code, **kwargs):
        with self.assertRaises(withdrawals.WithdrawalError) as caught:
            self.hold(**kwargs)
        self.assertEqual(caught.exception.code, code)
        return caught.exception

    def test_review_focus_an_ashantihub_rider_has_no_wallet(self):
        own = rider_helpers.rider("own@example.com", third_party=False, phone="+233244000009")
        rider_helpers.ghana_card(own)
        with self.assertRaises(destinations.DestinationError) as caught:
            destinations.check(own.staff, MOMO)
        self.assertEqual((caught.exception.code, caught.exception.status_code), ("wallet_disabled", 409))
        self.dest = destination(own.staff, name="Kojo Mensah")
        self.refused("wallet_disabled", amount=100, holder=own.staff)
        self.assertEqual(names.verified_names(own.staff), [])
        self.assertEqual(names.verified_names(make_staff("accountant", "acc@example.com")), [])

    def test_review_focus_without_an_approved_ghana_card_no_destination(self):
        self.swift.documents.all().delete()
        cards = (None, {"expires_on": timezone.localdate() - timedelta(days=1)}, {"status": RiderDocument.UPLOADED})
        for card in cards:
            if card is not None:
                rider_helpers.ghana_card(self.swift, **card)
            with self.subTest(card=card), self.assertRaises(destinations.DestinationError) as caught:
                destinations.check(self.staff, MOMO)
            self.assertEqual((caught.exception.code, caught.exception.status_code), ("id_required", 409))
        self.assertEqual(names.verified_names(self.staff), [])

    def test_a_rider_adds_a_destination_in_their_own_name(self):
        self.assertEqual(names.verified_names(self.staff), ["Kojo Mensah"])
        checked = destinations.check(self.staff, MOMO)
        self.assertEqual(checked["matched_name"], "Kojo Mensah")
        with transaction.atomic():
            saved = destinations.save(self.staff, checked)
        self.assertEqual((saved.holder_type, saved.holder_id), ("staff", self.staff.pk))

    @override_settings(SIMULATED_ACCOUNT_NAMES={"+233241234567": "Ama Owusu"})
    def test_an_account_in_someone_elses_name_is_refused(self):
        with self.assertRaises(destinations.DestinationError) as caught:
            destinations.check(self.staff, MOMO)
        self.assertEqual(caught.exception.code, "name_mismatch")

    def test_review_focus_a_rider_withdraws_the_balance_never_the_reserve(self):
        self.fund(900, 100)
        self.dest = destination(self.staff, name="Kojo Mensah")
        self.refused("insufficient_funds", amount=1000)
        held = self.hold(900)
        self.assertEqual(held.source_kind, Account.RIDER_BALANCE)
        self.assertEqual(payouts.submit(held.pk).status, Withdrawal.SUCCEEDED)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.staff), 0)
        self.assertEqual(posting.balance_of(Account.RIDER_RESERVE, self.staff), 100)            # AshantiHub's, taken at day end
        self.assertTrue(Notification.objects.filter(staff=self.staff, kind="withdrawal").exists())

    def test_review_focus_a_negative_balance_blocks_withdrawal(self):
        balance, _ = riders.accounts_of(self.swift)
        posting.post(key="owed", kind="test", lines=[
            posting.debit(balance, 500), posting.credit(posting.account_for(Account.WITHDRAWAL_IN_TRANSIT), 500),
        ], allow_negative={Account.RIDER_BALANCE})
        self.dest = destination(self.staff, name="Kojo Mensah")
        refusal = self.refused("negative_balance", amount=100)
        self.assertIn("next deliveries", refusal.message)

    def test_a_deactivated_rider_cannot_withdraw_or_add_a_destination(self):
        self.fund()
        self.dest = destination(self.staff, name="Kojo Mensah")
        self.staff.is_active = False
        self.staff.save(update_fields=["is_active"])
        self.refused("suspended", amount=100)
        with self.assertRaises(destinations.DestinationError) as caught:
            destinations.check(self.staff, MOMO)
        self.assertEqual(caught.exception.code, "suspended")

    def test_a_held_withdrawal_goes_back_if_the_rider_stops_being_third_party_before_it_is_sent(self):
        self.fund()
        self.dest = destination(self.staff, name="Kojo Mensah")
        held = self.hold(500)
        Rider.objects.filter(pk=self.swift.pk).update(employment=Rider.ASHANTIHUB, third_party_since=None)
        RiderEmploymentPeriod.objects.filter(rider=self.swift).update(ended_at=timezone.now())
        self.assertIsNone(payouts.claim(held.pk))
        held.refresh_from_db()
        self.assertEqual(held.status, Withdrawal.CANCELLED)
        self.assertEqual(posting.balance_of(Account.RIDER_BALANCE, self.staff), 900)


@override_settings(LEDGER_ENABLED=True)
class RiderStepUpTests(TestCase):
    def setUp(self):
        cache.clear()
        senders.sms_outbox.clear()
        self.swift = rider_helpers.rider()
        self.client = self.client_for(self.swift.staff)

    def client_for(self, staff):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
        return client

    def send(self, action, client=None):
        return (client or self.client).post("/api/otp/step-up/send/", {"action": action, "channel": "sms"}, format="json")

    def test_review_focus_a_third_party_rider_gets_codes_for_wallet_actions_only(self):
        for action in ("withdrawal", "payout_destination"):
            with self.subTest(action=action):
                self.assertEqual(self.send(action).status_code, 200)
                verified = self.client.post("/api/otp/step-up/verify/", {"action": action, "code": last_sms_code()}, format="json")
                self.assertEqual(verified.status_code, 200, verified.content)
                self.assertEqual(verified.json()["action"], action)
        for action in ("contact_change", "password_change"):                    # 4 sends in all: under otp_send's 5/min
            response = self.send(action)
            self.assertEqual((response.status_code, response.json()["code"]), (409, "otp_off"), action)

    def test_an_ashantihub_rider_and_office_staff_cannot_ask_for_codes(self):
        own = rider_helpers.rider("own@example.com", third_party=False, phone="+233244000009")
        for staff in (own.staff, make_staff("accountant", "acc@example.com")):
            self.assertEqual(self.send("withdrawal", self.client_for(staff)).status_code, 403)
        self.assertEqual(senders.sms_outbox, [])

    def test_with_the_ledger_off_a_rider_gets_no_code(self):
        with override_settings(LEDGER_ENABLED=False):
            response = self.send("withdrawal")
        self.assertEqual((response.status_code, response.json()["code"]), (409, "otp_off"))
        self.assertEqual(senders.sms_outbox, [])
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p disp1 run --rm web python manage.py test wallets.tests.test_rider_engine --noinput`
Expected: FAIL — `destinations.check` answers `name_required` instead of `wallet_disabled` / `id_required`, `withdrawals.request` answers `not_a_holder`, and the step-up endpoints answer 403 to the rider.

- [ ] **Step 3: The rider's verified name** — in `backend/wallets/names.py` replace

```python
A customer's profile name is self-declared (there is no customer KYC) and can be changed without a code, so for
customers this stops typing mistakes, not a determined holder (a recorded deviation: spec §13 (xxix))."""
```

with

```python
A customer's profile name is self-declared (there is no customer KYC) and can be changed without a code, so for
customers this stops typing mistakes, not a determined holder (a recorded deviation: spec §13 (xxix)). A third-party
rider's verified name is the name on their staff account, once the Delivery Manager has approved an in-date Ghana Card
(wallets Plan 5; nothing yet compares the card's name with it: spec §13 (xcii))."""
```

and replace

```python
def verified_names(holder):
    """The names a destination may match, or [] when there is none yet (a vendor not KYC-verified, a blank profile)."""
    from accounts.models import BusinessOwner, Customer
```

with

```python
def verified_names(holder):
    """The names a destination may match, or [] when there is none yet (a vendor not KYC-verified, a blank profile, a
    rider without an approved Ghana Card, AshantiHub's own riders and office staff)."""
    from accounts.models import BusinessOwner, Customer, StaffUser

    if isinstance(holder, StaffUser):
        from delivery import employment

        rider = employment.wallet_rider(holder)
        if rider is None or not employment.id_verified(rider) or not (holder.full_name or "").strip():
            return []
        return [holder.full_name]
```

- [ ] **Step 4: Destinations** — in `backend/wallets/destinations.py` replace `from accounts.models import BusinessOwner, BusinessOwnerProfile` with `from accounts.models import BusinessOwner, BusinessOwnerProfile, StaffUser`, and replace

```python
def _holder_problem(holder):
    """The DestinationError that stops this holder adding a destination now, or None."""
    if getattr(holder, "is_suspended", False):
        return DestinationError("This account is suspended.", "suspended", 403)
```

with

```python
def _rider_problem(staff):
    """A staff account may hold destinations only as an active third-party rider with an approved, in-date Ghana Card
    (wallets Plan 5)."""
    from delivery import employment

    if not staff.is_active:
        return DestinationError("This account is suspended.", "suspended", 403)
    if employment.wallet_rider(staff) is None:
        return DestinationError(employment.WALLET_DISABLED, "wallet_disabled", 409)
    if not names.verified_names(staff):
        return DestinationError(
            "Your Ghana Card must be approved, and in date, before money can be paid out to you. Ask your delivery manager.",
            "id_required", 409,
        )
    return None


def _holder_problem(holder):
    """The DestinationError that stops this holder adding a destination now, or None."""
    if getattr(holder, "is_suspended", False):
        return DestinationError("This account is suspended.", "suspended", 403)
    if isinstance(holder, StaffUser):
        return _rider_problem(holder)
```

- [ ] **Step 5: Withdrawals** — in `backend/wallets/withdrawals.py`:

(a) replace

```python
withdrawals stay within the daily limit. Customers withdraw their wallet, vendors their Available; third-party riders
are Stage 5."""
```

with

```python
withdrawals stay within the daily limit. Customers withdraw their wallet, vendors their Available, third-party riders
their balance (never the commission reserve; wallets Plan 5); a negative Available or rider balance blocks any
withdrawal."""
```

(b) replace `from accounts.models import BusinessOwner, Customer` with `from accounts.models import BusinessOwner, Customer, StaffUser`;

(c) replace

```python
def source_kind(holder):
    if isinstance(holder, Customer):
        return Account.CUSTOMER_WALLET
    if isinstance(holder, BusinessOwner):
        return Account.VENDOR_AVAILABLE
    raise WithdrawalError("Only customers and businesses can withdraw.", "not_a_holder", 403)
```

with

```python
# A balance below zero after a refund blocks every withdrawal until later money covers it.
NEGATIVE = {
    Account.VENDOR_AVAILABLE: "Your available balance is below zero after a refund. It recovers from your next sales.",
    Account.RIDER_BALANCE: "Your balance is below zero after a refund. It recovers from your next deliveries.",
}


def source_kind(holder):
    if isinstance(holder, Customer):
        return Account.CUSTOMER_WALLET
    if isinstance(holder, BusinessOwner):
        return Account.VENDOR_AVAILABLE
    if isinstance(holder, StaffUser):
        from delivery import employment

        if employment.wallet_rider(holder) is None:
            raise WithdrawalError(employment.WALLET_DISABLED, "wallet_disabled", 409)
        return Account.RIDER_BALANCE  # never the reserve: AshantiHub's commission, taken at the end of the day
    raise WithdrawalError("Only customers, businesses and third-party riders can withdraw.", "not_a_holder", 403)
```

(d) replace

```python
    now = now or timezone.now()
    if getattr(holder, "is_suspended", False):
        raise WithdrawalError("This account is suspended.", "suspended", 403)
    kind = source_kind(holder)
```

with

```python
    now = now or timezone.now()
    if getattr(holder, "is_suspended", False) or (isinstance(holder, StaffUser) and not holder.is_active):
        raise WithdrawalError("This account is suspended.", "suspended", 403)
    kind = source_kind(holder)
```

(e) replace

```python
    if kind == Account.VENDOR_AVAILABLE and balance < 0:
        raise WithdrawalError(
            "Your available balance is below zero after a refund. It recovers from your next sales.", "negative_balance", 409,
        )
```

with

```python
    if kind in NEGATIVE and balance < 0:
        raise WithdrawalError(NEGATIVE[kind], "negative_balance", 409)
```

- [ ] **Step 6: Payouts** — in `backend/wallets/payouts.py`:

(a) replace `from accounts.models import BusinessOwner, Customer` with `from accounts.models import BusinessOwner, Customer, StaffUser`, and `from notifications.services import notify_business_owner, notify_customer` with `from notifications.services import notify_business_owner, notify_customer, notify_staff`;

(b) replace

```python
def _holder_model(withdrawal):
    return Customer if withdrawal.holder_type == "customer" else BusinessOwner
```

with

```python
HOLDER_MODELS = {"customer": Customer, "business_owner": BusinessOwner, "staff": StaffUser}  # staff: a third-party rider


def _holder_model(withdrawal):
    return HOLDER_MODELS.get(withdrawal.holder_type, BusinessOwner)
```

(c) replace

```python
    if isinstance(holder, Customer):
        notify_customer(holder, "withdrawal", title, body=body, link="/my-account", icon="💸")
    elif holder is not None:
        notify_business_owner(holder, "withdrawal", title, body=body, link="/business", icon="💸")
```

with

```python
    if isinstance(holder, Customer):
        notify_customer(holder, "withdrawal", title, body=body, link="/my-account", icon="💸")
    elif isinstance(holder, StaffUser):
        notify_staff(holder, "withdrawal", title, body=body, link="/staff", icon="💸")
    elif holder is not None:
        notify_business_owner(holder, "withdrawal", title, body=body, link="/business", icon="💸")
```

(d) replace

```python
            holder is None or holder.is_suspended or destination.removed_at is not None or destination.usable_from > now
            or names.matching_name(destination.account_name, holder) is None
```

with

```python
            holder is None or holder.is_suspended or not getattr(holder, "is_active", True)
            or destination.removed_at is not None or destination.usable_from > now
            or names.matching_name(destination.account_name, holder) is None  # a rider no longer third-party has no name
```

- [ ] **Step 7: Step-up codes for riders** — in `backend/otp/views_step_up.py`:

(a) replace

```python
Who may ask (final review F2):
* Customers and business owners only (403 for staff, 401 without a sign-in). Staff confirm sensitive changes with
  their password (RequiresSudo); letting them ask here would send real codes and, through the account-wide lock,
  let a wrong code lock their own code sign-in.
```

with

```python
Who may ask (final review F2):
* Customers and business owners (401 without a sign-in). Staff confirm sensitive changes with their password
  (RequiresSudo) and get 403, except a third-party rider (wallets Plan 5): a rider company's rider holds a wallet, so
  they may ask for `withdrawal` and `payout_destination` codes, and nothing else, while LEDGER_ENABLED is on.
```

(b) replace

```python
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Customer
from ledger import escrow
```

with

```python
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import BusinessOwner, Customer, StaffUser
from ledger import escrow
```

(c) replace `from .views_authenticator import IsCustomerOrOwner` with nothing (delete the line), and replace

```python
WALLET_ACTIONS = (step_up.WITHDRAWAL, step_up.PAYOUT_DESTINATION, step_up.CONTACT_CHANGE)


def _codes_off(account, action):
    """True when no step-up could be asked of this person for `action`, so no code is sent (see the module text)."""
    if flags.step_up_enforced() or flags.sign_in_enforced():
        return False
```

with

```python
WALLET_ACTIONS = (step_up.WITHDRAWAL, step_up.PAYOUT_DESTINATION, step_up.CONTACT_CHANGE)
# A third-party rider's wallet actions (wallets Plan 5): the only codes a staff account may ask for.
RIDER_ACTIONS = (step_up.WITHDRAWAL, step_up.PAYOUT_DESTINATION)


class IsCustomerOwnerOrWalletRider(BasePermission):
    """Customers, business owners, and staff who are third-party riders (their wallet is on)."""

    def has_permission(self, request, view):
        user = request.user
        if isinstance(user, (Customer, BusinessOwner)):
            return True
        if isinstance(user, StaffUser):
            from delivery import employment

            return employment.wallet_rider(user) is not None
        return False


def _codes_off(account, action):
    """True when no step-up could be asked of this person for `action`, so no code is sent (see the module text)."""
    if isinstance(account, StaffUser):
        return not (action in RIDER_ACTIONS and escrow.enabled())
    if flags.step_up_enforced() or flags.sign_in_enforced():
        return False
```

(d) in both `StepUpSendView` and `StepUpVerifyView` replace `permission_classes = [IsCustomerOrOwner]` with `permission_classes = [IsCustomerOwnerOrWalletRider]` (two occurrences; use replace-all).

(e) in `backend/otp/step_up.py`, whose module text (line 9) still says the opposite, replace the sentence `Only customers and business owners can get a token (otp.views_step_up); staff use sudo.` (keep the file's own line wrapping) with `Only customers, business owners and third-party riders (withdrawal and payout_destination) can get a token (otp.views_step_up); other staff use sudo.`

- [ ] **Step 8: Run the tests to see them pass**

Run: `docker compose -p disp1 run --rm web python manage.py test wallets.tests.test_rider_engine --noinput`
Expected: PASS (11 tests).

Run: `docker compose -p disp1 run --rm web python manage.py test wallets otp --noinput`
Expected: PASS (customers' and vendors' destinations, withdrawals and step-up unchanged; staff other than third-party riders still 403).

- [ ] **Step 9: Commit**

```bash
git add backend/wallets/names.py backend/wallets/destinations.py backend/wallets/withdrawals.py backend/wallets/payouts.py backend/otp/views_step_up.py backend/otp/step_up.py backend/wallets/tests/test_rider_engine.py
git commit -F - <<'EOF'
feat(wallets): third-party riders withdraw their balance (never the reserve), name-checked on an approved Ghana Card, with step-up codes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 6: The rider's own wallet API

> **Note (Task 2 review).** A rider moved off the Dispatch role keeps a wallet that nobody can open (the wallet API resolves the rider through `wallet_rider`, which requires the dispatch role). Decide here whether such a wallet is paid out by staff or the role change is refused while money is open.

**Files:**
- Modify: `backend/wallets/views_payouts.py` (`SavedHook`, the four holder views, `_tell_holder`, imports, docstring), `backend/delivery/urls.py` (rider wallet routes), `backend/delivery/views_rider.py` (`MeView`, imports), `backend/delivery/views_rules.py` (`RiderEarnedView`, `RiderEarningsLinesView`: payroll leaves out third-party deliveries), `backend/delivery/views_rider_money.py` (`EarningsView`)
- Create: `backend/wallets/rider_wallet.py`, `backend/wallets/views_rider_wallet.py`, `backend/wallets/tests/test_rider_api.py`

**Interfaces:**
- Consumes: Task 1's `employment.wallet_rider`, `is_third_party`, `unreleased_deliveries`, `WALLET_DISABLED`; Task 2's `RiderEarning`; Task 3's `RiderCommissionPosting`, `riders.post_commission`; Task 5's engine; `wallets.views.OFF`, `Pagination`; `wallets.services.money`; `activity.services.record`.
- Produces:
  - `wallets.rider_wallet`: `LABELS`, `ACCOUNT_NAMES`, `STATUS_LABELS`, `summary(rider) -> dict`, `earnings(rider, day=None) -> QuerySet`, `status_of(earning) -> str`, `earning_row(earning) -> dict`, `days(rider, limit=30) -> list[dict]` (each with `given_back`), `given_back(day_filter) -> dict`, `statement_lines(rider) -> QuerySet[JournalLine]`, `line_row(line) -> dict`
  - `wallets.views_payouts.SavedHook` with `saved(request, event, obj)` (a no-op), called inside the saving transaction with `destination_added`, `destination_removed`, `withdrawal_requested`, `withdrawal_cancelled`
  - `wallets.views_rider_wallet`: `LedgerOff`, `WalletDisabled` (409 API exceptions), `parse_day(raw) -> date | None` (raises `ValueError`), `RiderWalletMixin`, `RiderWalletView`, `RiderEarningsView`, `RiderDaysView`, `RiderStatementView`, `RiderDestinationsView`, `RiderDestinationRemoveView`, `RiderWithdrawalsView`, `RiderWithdrawalCancelView`
  - routes `delivery-rider-wallet`, `-earnings`, `-days`, `-statement`, `-destinations`, `-destination-remove`, `-withdrawals`, `-withdrawal-cancel` under `/api/delivery/rider/wallet/`; `GET rider/me/` carries `rider.employment` and `rider.wallet`

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_rider_api.py`

```python
"""The rider's own wallet API (wallets Plan 5, Task 6; spec §7): balance, reserve, earnings per delivery, each day's
commission, the statement, payout destinations and withdrawals, always the caller's own. AshantiHub's own riders get 409
wallet_disabled; every endpoint answers 409 ledger_off while the ledger is off. Review Focus 4 and 5."""
import json
from datetime import timedelta
from decimal import Decimal

from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone

from accounts.testing import make_staff
from activity.models import ActivityEvent
from delivery.models import RiderEarning
from ledger import riders
from ledger.tests import rider_helpers
from notifications.models import Notification
from orders.models import DeliveryAssignment
from wallets import withdrawals
from wallets.models import PayoutDestination

from .helpers import Holder, destination

BASE = "/api/delivery/rider/wallet/"
PATHS = ("", "earnings/", "days/", "statement/", "destinations/", "withdrawals/")
MOMO = {"rail": "momo", "institution": "MTN", "account_number": "0241234567"}


@override_settings(LEDGER_ENABLED=True)
class RiderWalletApiTests(TestCase):
    def setUp(self):
        self.swift = rider_helpers.rider()
        rider_helpers.ghana_card(self.swift)
        self.me = Holder(self.swift.staff, "staff")

    def credited(self, gross=1000, rider=None, at=None):
        return rider_helpers.earning(rider or self.swift, gross=gross, at=at or timezone.now())

    def other_rider(self):
        return rider_helpers.rider("fast@example.com", name="Yaw Boateng", phone="+233244000003", company="Fast Riders")

    def test_review_focus_an_ashantihub_rider_is_told_wallets_are_off_everywhere(self):
        own = rider_helpers.rider("own@example.com", third_party=False, phone="+233244000009")
        them = Holder(own.staff, "staff")
        for path in PATHS:
            response = them.get(BASE + path)
            self.assertEqual((response.status_code, response.json()["code"]), (409, "wallet_disabled"), path)
        posted = them.post(
            BASE + "withdrawals/", {"destination": 1, "amount": "5.00", "request_id": "req-own-0001"}, action="withdrawal",
        )
        self.assertEqual((posted.status_code, posted.json()["code"]), (409, "wallet_disabled"))
        home = them.get("/api/delivery/rider/me/").json()["rider"]
        self.assertEqual((home["employment"], home["wallet"]), ("ashantihub", False))

    def test_with_the_ledger_off_every_endpoint_answers_ledger_off(self):
        with override_settings(LEDGER_ENABLED=False):
            for path in PATHS:
                response = self.me.get(BASE + path)
                self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"), path)

    def test_office_staff_cannot_open_a_rider_wallet(self):
        self.assertEqual(Holder(make_staff("accountant", "acc@example.com"), "staff").get(BASE).status_code, 403)

    def test_the_wallet_shows_balance_reserve_rate_and_company(self):
        self.credited(1000)
        body = self.me.get(BASE).json()
        self.assertEqual(
            {key: body[key] for key in ("kind", "balance", "reserve", "commission_bp", "company_name", "awaiting_release")},
            {"kind": "rider", "balance": "9.00", "reserve": "1.00", "commission_bp": 1000, "company_name": "Swift Riders Ltd",
             "awaiting_release": 0},
        )
        home = self.me.get("/api/delivery/rider/me/").json()["rider"]
        self.assertEqual((home["employment"], home["wallet"]), ("third_party", True))

    def test_review_focus_each_rider_sees_only_their_own_earnings_and_statement(self):
        mine, theirs = self.credited(1000), self.credited(2000, rider=self.other_rider())
        rows = self.me.get(BASE + "earnings/").json()["results"]
        self.assertEqual([row["order"] for row in rows], [mine.order_id])
        self.assertEqual(
            {key: rows[0][key] for key in ("gross", "commission_bp", "commission", "you_got", "status")},
            {"gross": "10.00", "commission_bp": 1000, "commission": "1.00", "you_got": "9.00", "status": "reserve_held"},
        )
        lines = self.me.get(BASE + "statement/").json()["results"]
        self.assertEqual(sorted((line["account"], line["amount"], line["order"]) for line in lines),
                         [("balance", "9.00", mine.order_id), ("reserve", "1.00", mine.order_id)])
        self.assertNotIn(theirs.order_id, [line["order"] for line in lines])
        self.assertEqual(self.me.get(BASE + "earnings/", {"day": "2026-13-01"}).status_code, 400)

    def test_each_day_shows_gross_commission_and_net(self):
        yesterday = timezone.now() - timedelta(days=1)
        self.credited(1000, at=yesterday)
        self.credited(2000, at=yesterday)
        riders.post_commission(today=timezone.localdate())
        self.assertEqual(self.me.get(BASE + "days/").json()["results"], [{
            "day": timezone.localdate(yesterday).isoformat(), "deliveries": 2, "gross": "30.00", "commission": "3.00", "net": "27.00",
            "given_back": "0.00",
        }])
        self.assertEqual({row["status"] for row in self.me.get(BASE + "earnings/").json()["results"]}, {"commission_taken"})

    def test_a_delivery_taken_back_after_the_day_was_posted_shows_the_commission_given_back(self):
        yesterday = timezone.now() - timedelta(days=1)
        self.credited(1000, at=yesterday)
        taken_back = self.credited(2000, at=yesterday)
        riders.post_commission(today=timezone.localdate())
        RiderEarning.objects.filter(pk=taken_back.pk).update(reversed_at=timezone.now())     # what riders.reverse_earning records
        day = self.me.get(BASE + "days/").json()["results"][0]
        self.assertEqual((day["commission"], day["given_back"]), ("3.00", "2.00"))            # the day's record is never edited

    def test_payroll_figures_leave_out_a_third_party_riders_deliveries(self):
        own = rider_helpers.rider("own@example.com", third_party=False, phone="+233244000009")
        for row, pay in ((self.swift, "12.00"), (own, "8.00")):
            order = rider_helpers.earning(row, gross=1000, at=timezone.now()).order
            job = rider_helpers.delivered_by(order, row)
            DeliveryAssignment.objects.filter(pk=job.pk).update(rider_pay=Decimal(pay))
        manager = Holder(make_staff("delivery_manager", "dm@example.com"), "staff")
        paid = manager.get("/api/delivery/payouts/").json()["riders"]
        self.assertEqual([row["staff_id"] for row in paid], [own.staff.pk])                    # Accounting cannot pay the wallet rider twice
        self.assertEqual(manager.get(f"/api/delivery/payouts/{self.swift.staff.pk}/").json()["results"], [])
        mine = self.me.get("/api/delivery/rider/earnings/?period=week").json()
        self.assertEqual((mine["jobs"], mine["total"]), (0, None))                              # the rider's pay is the wallet

    def test_review_focus_a_rider_adds_a_destination_with_a_code_and_withdraws(self):
        self.credited(1000)
        refused = self.me.post(BASE + "destinations/", MOMO)
        self.assertEqual((refused.status_code, refused.json()["code"]), (403, "step_up_required"))
        added = self.me.post(BASE + "destinations/", MOMO, action="payout_destination")
        self.assertEqual(added.status_code, 201, added.content)
        self.assertNotIn("1234567", added.content.decode())
        PayoutDestination.objects.filter(pk=added.json()["id"]).update(usable_from=timezone.now() - timedelta(hours=1))
        paid = self.me.post(
            BASE + "withdrawals/", {"destination": added.json()["id"], "amount": "9.00", "request_id": "req-rider-0001"},
            action="withdrawal",
        )
        self.assertEqual((paid.status_code, paid.json()["status"]), (201, "succeeded"), paid.content)
        self.assertEqual(self.me.get(BASE).json()["balance"], "0.00")
        removed = self.me.post(BASE + f"destinations/{added.json()['id']}/remove/", action="payout_destination")
        self.assertEqual(removed.status_code, 204)
        self.assertEqual(
            sorted(ActivityEvent.objects.filter(verb__startswith="wallets.rider_").values_list("verb", flat=True)),
            ["wallets.rider_destination_added", "wallets.rider_destination_removed", "wallets.rider_withdrawal_requested"],
        )
        for event in ActivityEvent.objects.all():                                           # never the number, anywhere
            self.assertNotIn("1234567", json.dumps([event.summary, event.target_label, event.before, event.after]))
        self.assertTrue(Notification.objects.filter(staff=self.swift.staff, kind="payout_destination").exists())

    def test_review_focus_a_rider_cannot_cancel_another_riders_withdrawal(self):
        fast = self.other_rider()
        rider_helpers.ghana_card(fast)
        self.credited(1000, rider=fast)
        to_fast = destination(fast.staff, name="Yaw Boateng")
        with transaction.atomic():
            held = withdrawals.request(fast.staff, destination_id=to_fast.pk, amount_pesewas=500, request_id="req-fast-0001")
        refused = self.me.post(BASE + f"withdrawals/{held.pk}/cancel/")
        self.assertEqual((refused.status_code, refused.json()["code"]), (404, "not_found"))
        self.assertEqual(self.me.get(BASE + "withdrawals/").json()["results"], [])
        cancelled = Holder(fast.staff, "staff").post(BASE + f"withdrawals/{held.pk}/cancel/")
        self.assertEqual((cancelled.status_code, cancelled.json()["status"]), (200, "cancelled"))
        self.assertTrue(ActivityEvent.objects.filter(verb="wallets.rider_withdrawal_cancelled").exists())
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p disp1 run --rm web python manage.py test wallets.tests.test_rider_api --noinput`
Expected: FAIL — 404 for every `/api/delivery/rider/wallet/` path, and `KeyError: 'employment'` on `rider/me/`.

- [ ] **Step 3: The read model** — create `backend/wallets/rider_wallet.py`

```python
"""A third-party rider's money as they (and wallets.view staff) see it (spec §2.1, §2.2 step 6, §7; wallets Plan 5): the
balance (90% of each delivery fee, withdrawable; below zero after a refund that took a delivery back), the commission
reserve held until the end of the day (read-only), what each delivery earned, each day's posted commission, and the
statement of their ledger lines. Over the ledger and the RiderEarning / RiderCommissionPosting rows ledger.riders writes.
Integer pesewas inside, GH₵ strings at the edge; reading never opens an account."""
from django.db.models import Sum

from accounts.models import StaffUser
from delivery import employment
from delivery.models import RiderCommissionPosting, RiderEarning
from ledger import posting, settings_store
from ledger.models import Account, JournalLine

from .services import money

LABELS = {
    "rider_earning": "Delivery paid to you",
    "rider_earning_reversal": "Delivery taken back (order refunded)",
    "rider_commission": "AshantiHub's commission",
    "withdrawal_hold": "Withdrawal",
    "withdrawal_reversed": "Withdrawal returned",
}
ACCOUNT_NAMES = {Account.RIDER_BALANCE: "balance", Account.RIDER_RESERVE: "reserve"}
STATUS_LABELS = {
    "reserve_held": "Paid to you. AshantiHub's commission is held until the end of the day.",
    "commission_taken": "Paid to you. AshantiHub's commission was taken.",
    "refunded": "Taken back: the order was refunded in full.",
}


def summary(rider):
    staff = rider.staff
    return {
        "kind": "rider",
        "balance": money(posting.balance_of(Account.RIDER_BALANCE, staff)),
        "reserve": money(posting.balance_of(Account.RIDER_RESERVE, staff)),
        "reserve_note": "AshantiHub's commission, held until it is taken after midnight. It cannot be withdrawn.",
        "commission_bp": settings_store.current("rider_commission_bp"),
        "company_name": rider.company_name,
        "awaiting_release": employment.unreleased_deliveries(rider).count(),
    }


def earnings(rider, day=None):
    rows = RiderEarning.objects.filter(rider=rider).select_related("order__delivery_assignment")
    if day is not None:
        rows = rows.filter(earned_on=day)
    return rows.order_by("-earned_at", "-id")


def status_of(earning):
    if earning.reversed_at is not None:
        return "refunded"
    return "commission_taken" if earning.commission_posting_id else "reserve_held"


def earning_row(earning):
    assignment = getattr(earning.order, "delivery_assignment", None)
    status = status_of(earning)
    return {
        "id": earning.pk, "order": earning.order_id, "delivered_at": assignment.delivered_at if assignment else None,
        "earned_at": earning.earned_at, "earned_on": earning.earned_on, "gross": money(earning.gross_pesewas),
        "commission_bp": earning.commission_bp, "commission": money(earning.reserve_pesewas),
        "you_got": money(earning.net_pesewas), "status": status, "status_label": STATUS_LABELS[status],
        "reversed_at": earning.reversed_at,
    }


def given_back(day_filter):
    """{day: pesewas of commission AshantiHub gave back} for deliveries taken back (a whole refund) after their day's
    commission was posted. A RiderCommissionPosting row is never edited, so the views add this beside it. `day_filter` is
    a RiderEarning filter (a rider, or every rider) already narrowed to the days shown."""
    return dict(
        RiderEarning.objects.filter(reversed_at__isnull=False, commission_posting__isnull=False, **day_filter)
        .values("commission_posting__day").annotate(total=Sum("reserve_pesewas")).values_list("commission_posting__day", "total")
    )


def days(rider, limit=30):
    """Each posted day, newest first: deliveries, gross, AshantiHub's commission and net (several postings of one day add
    up), and `given_back`: the part of that commission given back because a delivery of the day was refunded in full."""
    rows = list(
        RiderCommissionPosting.objects.filter(rider=rider).values("day")
        .annotate(deliveries=Sum("deliveries"), gross=Sum("gross_pesewas"), commission=Sum("commission_pesewas"), net=Sum("net_pesewas"))
        .order_by("-day")[:limit]
    )
    back = given_back({"rider": rider, "commission_posting__day__in": [row["day"] for row in rows]})
    return [
        {"day": row["day"], "deliveries": row["deliveries"], "gross": money(row["gross"]), "commission": money(row["commission"]),
         "net": money(row["net"]), "given_back": money(back.get(row["day"], 0))}
        for row in rows
    ]


def statement_lines(rider):
    """Every journal line on the rider's own balance and reserve, newest first."""
    return (
        JournalLine.objects.filter(
            account__kind__in=tuple(ACCOUNT_NAMES), account__owner_type=StaffUser._meta.label_lower,
            account__owner_id=str(rider.staff_id),
        )
        .select_related("journal", "account").order_by("-journal__created_at", "-id")
    )


def line_row(line):
    journal = line.journal
    is_order = journal.reference_type == "orders.order" and journal.reference_id.isdigit()
    return {
        "id": line.pk, "at": journal.created_at, "account": ACCOUNT_NAMES[line.account.kind], "kind": journal.kind,
        "label": LABELS.get(journal.kind, "Other"),
        # Both rider accounts grow with credits, so a credit is money in.
        "direction": "in" if line.side == JournalLine.CREDIT else "out",
        "amount": money(line.amount), "order": int(journal.reference_id) if is_order else None,
        "reference": journal.reference_id if journal.reference_type == "wallets.withdrawal" else "",
    }
```

- [ ] **Step 4: The saving hook in the holder views** — in `backend/wallets/views_payouts.py`:

(a) replace

```python
of every destination added or removed (no number in it). Every endpoint answers 409 ledger_off while the ledger is off."""
```

with

```python
of every destination added or removed (no number in it). Every endpoint answers 409 ledger_off while the ledger is off.
Third-party riders use these same views at /api/delivery/rider/wallet/ (wallets.views_rider_wallet), which record their
own activity event through the `saved()` hook, inside the transaction that saves."""
```

(b) replace

```python
from accounts.models import Customer
from ledger import escrow, settings_store
from notifications.services import notify_business_owner, notify_customer
```

with

```python
from accounts.models import Customer, StaffUser
from ledger import escrow, settings_store
from notifications.services import notify_business_owner, notify_customer, notify_staff
```

(c) replace

```python
    if isinstance(holder, Customer):
        notify_customer(holder, "payout_destination", title, body=body, link="/my-account", icon="🏦")
    else:
        notify_business_owner(holder, "payout_destination", title, body=body, link="/business", icon="🏦")


def _described(destination):
    return f"A {destination.get_rail_display().lower()} ({destination.institution}) payout destination"
```

with

```python
    if isinstance(holder, Customer):
        notify_customer(holder, "payout_destination", title, body=body, link="/my-account", icon="🏦")
    elif isinstance(holder, StaffUser):  # a third-party rider (wallets Plan 5)
        notify_staff(holder, "payout_destination", title, body=body, link="/staff", icon="🏦")
    else:
        notify_business_owner(holder, "payout_destination", title, body=body, link="/business", icon="🏦")


def _described(destination):
    return f"A {destination.get_rail_display().lower()} ({destination.institution}) payout destination"


class SavedHook:
    """`saved(request, event, obj)` runs last inside the transaction that saved a destination or a withdrawal. A no-op
    here; the third-party rider views record their own activity event in it (wallets Plan 5)."""

    def saved(self, request, event, obj):
        return None
```

(d) replace `class DestinationsView(APIView):` with `class DestinationsView(SavedHook, APIView):`, `class DestinationRemoveView(APIView):` with `class DestinationRemoveView(SavedHook, APIView):`, `class WithdrawalsView(APIView):` with `class WithdrawalsView(SavedHook, APIView):`, and `class WithdrawalCancelView(APIView):` with `class WithdrawalCancelView(SavedHook, APIView):`;

(e) replace

```python
            with transaction.atomic():
                step_up.require(request, step_up.PAYOUT_DESTINATION, force=True)
                destination = destinations.save(request.user, checked)
```

with

```python
            with transaction.atomic():
                step_up.require(request, step_up.PAYOUT_DESTINATION, force=True)
                destination = destinations.save(request.user, checked)
                self.saved(request, "destination_added", destination)
```

(f) replace

```python
            with transaction.atomic():
                step_up.require(request, step_up.PAYOUT_DESTINATION, force=True)
                destination = destinations.remove(request.user, pk)
```

with

```python
            with transaction.atomic():
                step_up.require(request, step_up.PAYOUT_DESTINATION, force=True)
                destination = destinations.remove(request.user, pk)
                self.saved(request, "destination_removed", destination)
```

(g) replace

```python
                withdrawal = withdrawals.request(
                    request.user, destination_id=data.get("destination"), amount_pesewas=amount, request_id=request_id,
                )
```

with

```python
                withdrawal = withdrawals.request(
                    request.user, destination_id=data.get("destination"), amount_pesewas=amount, request_id=request_id,
                )
                self.saved(request, "withdrawal_requested", withdrawal)
```

(h) replace

```python
        try:
            withdrawal = withdrawals.cancel(request.user, pk)
        except withdrawals.WithdrawalError as exc:
```

with

```python
        try:
            with transaction.atomic():
                withdrawal = withdrawals.cancel(request.user, pk)
                self.saved(request, "withdrawal_cancelled", withdrawal)
        except withdrawals.WithdrawalError as exc:
```

- [ ] **Step 5: The rider views** — create `backend/wallets/views_rider_wallet.py`

```python
"""A third-party rider's own wallet at /api/delivery/rider/wallet/ (permission delivery.dispatch; always the caller's own
rows; wallets Plan 5, spec §7). Every endpoint answers 409 ledger_off while the ledger is off, then 409 wallet_disabled
for AshantiHub's own riders (their pay stays with payroll). Destinations and withdrawals are the Stage 3b holder views
(wallets.views_payouts) with the rider's permission: the same step-up codes (X-Step-Up-Token), name check (the rider's
staff name, once an approved Ghana Card is on file), cooling period and limits.

Riders are staff accounts, so their writes would pass through the staff activity middleware, which runs the view inside a
transaction and stores the request body: these views are activity_exempt (the body holds an account number, and the
account-name lookup and the payout must run outside any transaction) and record their own event, without the number,
through the `saved()` hook inside the transaction that saves."""
from datetime import date

from rest_framework import exceptions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import HasRolePermission
from activity.services import record
from delivery import employment
from ledger import escrow

from . import rider_wallet, views_payouts
from .models import PayoutDestination
from .services import money
from .views import OFF, Pagination

RIDER_PERMISSION = "delivery.dispatch"
BAD_DAY = "Use a date like 2026-10-16."


class LedgerOff(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self):
        super().__init__({"detail": OFF, "code": "ledger_off"})


class WalletDisabled(exceptions.APIException):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self):
        super().__init__({"detail": employment.WALLET_DISABLED, "code": "wallet_disabled"})


def parse_day(raw):
    """A YYYY-MM-DD query value as a date; None when absent. Raises ValueError when it is not a date."""
    if raw in (None, ""):
        return None
    return date.fromisoformat(str(raw))


class RiderWalletMixin:
    """delivery.dispatch, then the ledger on (409 ledger_off), then a third-party rider (409 wallet_disabled), in that
    order; `self.wallet_rider` is the caller's Rider."""

    activity_exempt = True

    def get_permissions(self):
        return [HasRolePermission(RIDER_PERMISSION)]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not escrow.enabled():
            raise LedgerOff()
        self.wallet_rider = employment.wallet_rider(request.user)
        if self.wallet_rider is None:
            raise WalletDisabled()

    def saved(self, request, event, obj):
        if isinstance(obj, PayoutDestination):
            done = "added" if event == "destination_added" else "removed"
            summary = f"{obj.get_rail_display()} ({obj.institution}) payout destination {done}"
            after = {"rail": obj.rail, "institution": obj.institution}
        else:
            done = "asked for" if event == "withdrawal_requested" else "cancelled"
            summary = f"Withdrawal {obj.reference} of GH₵ {money(obj.amount_pesewas)} {done}"
            after = {"reference": obj.reference, "amount": money(obj.amount_pesewas), "status": obj.status}
        # Last in the transaction that saved it: record() holds the activity chain lock until commit. Never the number.
        record(request.user, f"wallets.rider_{event}", target=obj, summary=summary, after=after, request=request)


class RiderWalletView(RiderWalletMixin, APIView):
    """GET rider/wallet/ — the balance (withdrawable; below zero after a refund took a delivery back), the reserve
    (AshantiHub's commission, held until it is taken after midnight; read-only), the commission rate for orders paid now, the rider
    company, and how many delivered orders still wait for Support's call."""

    def get(self, request):
        return Response(rider_wallet.summary(self.wallet_rider))


class RiderEarningsView(RiderWalletMixin, APIView):
    """GET rider/wallet/earnings/?day=YYYY-MM-DD — what each delivery earned, newest first, 20 a page."""

    def get(self, request):
        try:
            day = parse_day(request.query_params.get("day"))
        except ValueError:
            return Response({"day": BAD_DAY}, status=status.HTTP_400_BAD_REQUEST)
        paginator = Pagination()
        page = paginator.paginate_queryset(rider_wallet.earnings(self.wallet_rider, day), request, view=self)
        return paginator.get_paginated_response([rider_wallet.earning_row(earning) for earning in page])


class RiderDaysView(RiderWalletMixin, APIView):
    """GET rider/wallet/days/ — each posted day's deliveries, gross, AshantiHub's commission and net (the last 30)."""

    def get(self, request):
        return Response({"results": rider_wallet.days(self.wallet_rider)})


class RiderStatementView(RiderWalletMixin, APIView):
    """GET rider/wallet/statement/ — every ledger line on the rider's balance and reserve, newest first, 20 a page."""

    def get(self, request):
        paginator = Pagination()
        page = paginator.paginate_queryset(rider_wallet.statement_lines(self.wallet_rider), request, view=self)
        return paginator.get_paginated_response([rider_wallet.line_row(line) for line in page])


class RiderDestinationsView(RiderWalletMixin, views_payouts.DestinationsView):
    """GET/POST rider/wallet/destinations/ — as /api/wallet/destinations/ (Stage 3b), for the rider."""


class RiderDestinationRemoveView(RiderWalletMixin, views_payouts.DestinationRemoveView):
    """POST rider/wallet/destinations/<id>/remove/ — as /api/wallet/destinations/<id>/remove/."""


class RiderWithdrawalsView(RiderWalletMixin, views_payouts.WithdrawalsView):
    """GET/POST rider/wallet/withdrawals/ — as /api/wallet/withdrawals/; a rider withdraws their balance only."""


class RiderWithdrawalCancelView(RiderWalletMixin, views_payouts.WithdrawalCancelView):
    """POST rider/wallet/withdrawals/<id>/cancel/ — as /api/wallet/withdrawals/<id>/cancel/."""
```

- [ ] **Step 6: The routes and the rider home** — in `backend/delivery/urls.py` replace

```python
from . import views_cash, views_cases, views_fleet, views_live, views_queue, views_rider, views_rider_money, views_rules, views_shifts
```

with

```python
from wallets import views_rider_wallet

from . import views_cash, views_cases, views_fleet, views_live, views_queue, views_rider, views_rider_money, views_rules, views_shifts
```

and replace

```python
    path("rider/cash/", views_rider_money.CashView.as_view(), name="delivery-rider-cash"),
```

with

```python
    path("rider/cash/", views_rider_money.CashView.as_view(), name="delivery-rider-cash"),
    # Rider wallet (third-party riders only; wallets Plan 5)
    path("rider/wallet/", views_rider_wallet.RiderWalletView.as_view(), name="delivery-rider-wallet"),
    path("rider/wallet/earnings/", views_rider_wallet.RiderEarningsView.as_view(), name="delivery-rider-wallet-earnings"),
    path("rider/wallet/days/", views_rider_wallet.RiderDaysView.as_view(), name="delivery-rider-wallet-days"),
    path("rider/wallet/statement/", views_rider_wallet.RiderStatementView.as_view(), name="delivery-rider-wallet-statement"),
    path("rider/wallet/destinations/", views_rider_wallet.RiderDestinationsView.as_view(), name="delivery-rider-wallet-destinations"),
    path(
        "rider/wallet/destinations/<int:pk>/remove/", views_rider_wallet.RiderDestinationRemoveView.as_view(),
        name="delivery-rider-wallet-destination-remove",
    ),
    path("rider/wallet/withdrawals/", views_rider_wallet.RiderWithdrawalsView.as_view(), name="delivery-rider-wallet-withdrawals"),
    path(
        "rider/wallet/withdrawals/<int:pk>/cancel/", views_rider_wallet.RiderWithdrawalCancelView.as_view(),
        name="delivery-rider-wallet-withdrawal-cancel",
    ),
```

In `backend/delivery/views_rider.py` replace `from . import files, payloads, services` with `from . import employment, files, payloads, services`, and replace

```python
                "manager": {"id": manager.pk, "full_name": manager.full_name, "phone": manager.phone} if manager else None,
            },
```

with

```python
                "manager": {"id": manager.pk, "full_name": manager.full_name, "phone": manager.phone} if manager else None,
                # Who the rider works for (wallets Plan 5): only a third-party rider has a wallet (rider/wallet/*).
                "employment": rider.employment, "wallet": employment.is_third_party(rider),
            },
```

Payroll must not pay a third-party rider a second time (their pay is the wallet; the rate-card `rider_pay` stays a payroll record for AshantiHub's own riders only). In `backend/delivery/views_rules.py` replace

```python
            DeliveryAssignment.objects.filter(delivered_at__gte=since, dispatch__isnull=False)
```

with

```python
            employment.payroll_jobs(DeliveryAssignment.objects.filter(delivered_at__gte=since, dispatch__isnull=False))
```

in `RiderEarnedView`, and in `RiderEarningsLinesView` replace

```python
        jobs = DeliveryAssignment.objects.filter(dispatch_id=staff_id, delivered_at__gte=since).order_by("-delivered_at")
```

with

```python
        jobs = employment.payroll_jobs(DeliveryAssignment.objects.filter(dispatch_id=staff_id, delivered_at__gte=since)).order_by("-delivered_at")
```

and change the file's `from . import config, rates, services` to `from . import config, employment, rates, services`. In `backend/delivery/views_rider_money.py`, in `EarningsView.get` replace

```python
        jobs = DeliveryAssignment.objects.filter(dispatch=request.user, delivered_at__date__gte=start).order_by("-delivered_at")
```

with

```python
        jobs = employment.payroll_jobs(DeliveryAssignment.objects.filter(dispatch=request.user, delivered_at__date__gte=start)).order_by("-delivered_at")
```

and add `from . import employment` to that module's imports (merge with its existing `from . import ...` line if it has one). Both payroll screens now show only deliveries that are AshantiHub's own; the "Your AshantiHub earnings" figures of a third-party rider read zero jobs, and their money is on `rider/wallet/`.

- [ ] **Step 7: Run the tests to see them pass**

Run: `docker compose -p disp1 run --rm web python manage.py test wallets.tests.test_rider_api --noinput`
Expected: PASS (10 tests).

Run: `docker compose -p disp1 run --rm web python manage.py test wallets delivery --noinput`
Expected: PASS (the customer and vendor holder views behave as before: their `saved()` is a no-op).

- [ ] **Step 8: Commit**

```bash
git add backend/wallets/rider_wallet.py backend/wallets/views_rider_wallet.py backend/wallets/views_payouts.py backend/delivery/urls.py backend/delivery/views_rider.py backend/delivery/views_rules.py backend/delivery/views_rider_money.py backend/wallets/tests/test_rider_api.py
git commit -F - <<'EOF'
feat(wallets): the rider's own wallet API - balance, reserve, earnings, days, statement, destinations, withdrawals; own rows only

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 7: Staff reads of riders' money (wallets.view)

**Files:**
- Modify: `backend/wallets/views_staff.py` (`StaffWalletsView`, `rider_rows`, `holders_of`, imports, docstring), `backend/wallets/views_rider_wallet.py` (staff views), `backend/delivery/urls.py` (staff routes), `backend/wallets/tests/test_staff_wallets.py` (the unknown-kind test)
- Create: `backend/wallets/tests/test_rider_staff.py`

**Interfaces:**
- Consumes: Task 6's `rider_wallet.summary/earnings/earning_row/days`, `parse_day`, `BAD_DAY`; Task 3's `RiderCommissionPosting`; `wallets.views.ledger_off`; `wallets.views_staff.VIEW`.
- Produces:
  - `GET /api/wallet/staff/wallets/?kind=rider` (`views_staff.rider_rows(page, ids) -> list[dict]`); `holders_of` names `("staff", pk)` holders
  - `views_rider_wallet.StaffRiderWalletView` at `GET /api/delivery/riders/<id>/wallet/`, `StaffRiderCommissionView` at `GET /api/delivery/rider-commission/?day=` (both `wallets.view`)

- [ ] **Step 1: Write the failing test** — `backend/wallets/tests/test_rider_staff.py`

```python
"""Staff reads of third-party riders' money (wallets Plan 5, Task 7): wallets.view only (Accountant, Super Admin), never a
whole account number; 409 ledger_off while the ledger is off. Review Focus 5."""
from datetime import timedelta

from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.testing import make_staff, staff_token
from delivery.models import RiderEarning
from ledger import riders
from ledger.tests import rider_helpers
from wallets import withdrawals

from .helpers import destination


@override_settings(LEDGER_ENABLED=True)
class StaffRiderWalletTests(TestCase):
    def setUp(self):
        self.swift = rider_helpers.rider()
        self.yesterday = timezone.now() - timedelta(days=1)
        rider_helpers.earning(self.swift, gross=1000, at=self.yesterday)                    # 900 + 100, posted below
        rider_helpers.earning(self.swift, gross=2000, at=timezone.now())                    # 1800 + 200, held today
        riders.post_commission(today=timezone.localdate())
        self.accountant = self.client_for(make_staff("accountant", "acc@example.com"))
        self.manager = self.client_for(make_staff("delivery_manager", "dm@example.com"))

    def client_for(self, staff):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")
        return client

    def test_review_focus_staff_see_rider_balances_with_wallets_view_only(self):
        response = self.accountant.get("/api/wallet/staff/wallets/", {"kind": "rider"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["results"], [{
            "holder_id": self.swift.staff_id, "rider_id": self.swift.pk, "name": "Kojo Mensah",
            "company_name": "Swift Riders Ltd", "employment": "third_party", "balance": "27.00", "reserve": "2.00",
        }])
        self.assertEqual(self.manager.get("/api/wallet/staff/wallets/", {"kind": "rider"}).status_code, 403)
        self.assertEqual(self.accountant.get("/api/wallet/staff/wallets/", {"kind": "drivers"}).status_code, 400)

    def test_the_withdrawals_queue_names_the_rider_and_masks_the_number(self):
        rider_helpers.ghana_card(self.swift)
        to_swift = destination(self.swift.staff, name="Kojo Mensah")
        with transaction.atomic():
            withdrawals.request(self.swift.staff, destination_id=to_swift.pk, amount_pesewas=500, request_id="req-swift-0001")
        response = self.accountant.get("/api/wallet/staff/withdrawals/", {"status": "all"})
        row = response.json()["results"][0]
        self.assertEqual((row["holder_type"], row["holder_name"]), ("staff", "Kojo Mensah"))
        self.assertNotIn("1234567", response.content.decode())

    def test_one_riders_wallet_and_a_days_commission(self):
        mine = self.accountant.get(f"/api/delivery/riders/{self.swift.pk}/wallet/")
        self.assertEqual(mine.status_code, 200, mine.content)
        body = mine.json()
        self.assertEqual((body["rider"]["name"], body["balance"], body["reserve"]), ("Kojo Mensah", "27.00", "2.00"))
        self.assertEqual(len(body["earnings"]), 2)
        self.assertEqual(body["days"][0]["commission"], "1.00")
        self.assertEqual(self.manager.get(f"/api/delivery/riders/{self.swift.pk}/wallet/").status_code, 403)
        day = self.accountant.get("/api/delivery/rider-commission/", {"day": timezone.localdate(self.yesterday).isoformat()}).json()
        self.assertEqual(day["totals"], {"deliveries": 1, "gross": "10.00", "commission": "1.00", "net": "9.00", "given_back": "0.00"})
        self.assertEqual([(row["name"], row["company_name"]) for row in day["results"]], [("Kojo Mensah", "Swift Riders Ltd")])
        default = self.accountant.get("/api/delivery/rider-commission/").json()
        self.assertEqual(default["day"], (timezone.localdate() - timedelta(days=1)).isoformat())
        self.assertEqual(self.accountant.get("/api/delivery/rider-commission/", {"day": "yesterday"}).status_code, 400)

    def test_a_day_shows_the_commission_given_back_after_a_full_refund(self):
        RiderEarning.objects.filter(rider=self.swift, earned_on=timezone.localdate(self.yesterday)).update(reversed_at=timezone.now())
        day = self.accountant.get("/api/delivery/rider-commission/", {"day": timezone.localdate(self.yesterday).isoformat()}).json()
        self.assertEqual((day["results"][0]["commission"], day["results"][0]["given_back"], day["totals"]["given_back"]), ("1.00", "1.00", "1.00"))
        wallet = self.accountant.get(f"/api/delivery/riders/{self.swift.pk}/wallet/").json()
        self.assertEqual((wallet["days"][0]["commission"], wallet["days"][0]["given_back"]), ("1.00", "1.00"))

    def test_with_the_ledger_off_staff_reads_answer_ledger_off(self):
        with override_settings(LEDGER_ENABLED=False):
            for url in (
                "/api/wallet/staff/wallets/?kind=rider", f"/api/delivery/riders/{self.swift.pk}/wallet/",
                "/api/delivery/rider-commission/",
            ):
                response = self.accountant.get(url)
                self.assertEqual((response.status_code, response.json()["code"]), (409, "ledger_off"), url)
```

- [ ] **Step 2: Run it to see it fail**

Run: `docker compose -p disp1 run --rm web python manage.py test wallets.tests.test_rider_staff --noinput`
Expected: FAIL — `kind=rider` answers 400, `holder_name` is `""` for the rider, and the two `/api/delivery/...` staff paths answer 404.

- [ ] **Step 3: The staff list** — in `backend/wallets/views_staff.py`:

(a) replace

```python
"""Staff reads of holders' money (wallets.view: Accountant, Super Admin). Never an account or MoMo number. Answers
409 ledger_off while the ledger is off. Plan 3b adds withdrawals and the reconciliation runs here."""
```

with

```python
"""Staff reads of holders' money (wallets.view: Accountant, Super Admin). Never an account or MoMo number. Answers
409 ledger_off while the ledger is off. Plan 3b adds withdrawals and the reconciliation runs here; Plan 5 adds
third-party riders (their accounts are held by their staff account, holder_type "staff")."""
```

(b) replace `from accounts.models import BusinessOwner, Customer` with

```python
from accounts.models import BusinessOwner, Customer, StaffUser
from delivery.models import Rider
```

(c) replace the whole `StaffWalletsView` class

```python
class StaffWalletsView(APIView):
    """GET staff/wallets/?kind=customer|vendor — customers' wallets, or vendors' Pending and Available (every vendor
    with a sale has a Pending account), largest first, 20 a page."""

    def get_permissions(self):
        return [HasRolePermission(VIEW)]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        kind = request.query_params.get("kind") or "customer"
        if kind not in ("customer", "vendor"):
            return Response({"kind": "Choose customer or vendor."}, status=status.HTTP_400_BAD_REQUEST)
        if kind == "customer":
            accounts = Account.objects.filter(kind=Account.CUSTOMER_WALLET, owner_type=Customer._meta.label_lower)
        else:
            accounts = Account.objects.filter(kind=Account.VENDOR_PENDING, owner_type=BusinessOwner._meta.label_lower)
        paginator = Pagination()
        page = paginator.paginate_queryset(accounts.order_by("-net_credit", "pk"), request, view=self)
        ids = [int(account.owner_id) for account in page]
        if kind == "customer":
            names = dict(Customer.objects.filter(pk__in=ids).values_list("pk", "full_name"))
            rows = [{"holder_id": int(a.owner_id), "name": names.get(int(a.owner_id), ""), "balance": money(a.balance)} for a in page]
        else:
```

with

```python
def rider_rows(page, ids):
    """Third-party riders' balance and reserve (accounts held by their staff account), with the rider company."""
    found = {rider.staff_id: rider for rider in Rider.objects.filter(staff_id__in=ids).select_related("staff")}
    reserve = {
        account.owner_id: account.balance
        for account in Account.objects.filter(
            kind=Account.RIDER_RESERVE, owner_type=StaffUser._meta.label_lower, owner_id__in=[a.owner_id for a in page],
        )
    }
    rows = []
    for account in page:
        rider = found.get(int(account.owner_id))
        rows.append({
            "holder_id": int(account.owner_id), "rider_id": rider.pk if rider else None,
            "name": rider.staff.full_name if rider else "", "company_name": rider.company_name if rider else "",
            "employment": rider.employment if rider else "", "balance": money(account.balance),
            "reserve": money(reserve.get(account.owner_id, 0)),
        })
    return rows


class StaffWalletsView(APIView):
    """GET staff/wallets/?kind=customer|vendor|rider — customers' wallets, vendors' Pending and Available (every vendor
    with a sale has a Pending account), or third-party riders' balance and reserve, largest first, 20 a page."""

    def get_permissions(self):
        return [HasRolePermission(VIEW)]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        kind = request.query_params.get("kind") or "customer"
        if kind not in ("customer", "vendor", "rider"):
            return Response({"kind": "Choose customer, vendor or rider."}, status=status.HTTP_400_BAD_REQUEST)
        if kind == "customer":
            accounts = Account.objects.filter(kind=Account.CUSTOMER_WALLET, owner_type=Customer._meta.label_lower)
        elif kind == "rider":
            accounts = Account.objects.filter(kind=Account.RIDER_BALANCE, owner_type=StaffUser._meta.label_lower)
        else:
            accounts = Account.objects.filter(kind=Account.VENDOR_PENDING, owner_type=BusinessOwner._meta.label_lower)
        paginator = Pagination()
        page = paginator.paginate_queryset(accounts.order_by("-net_credit", "pk"), request, view=self)
        ids = [int(account.owner_id) for account in page]
        if kind == "customer":
            names = dict(Customer.objects.filter(pk__in=ids).values_list("pk", "full_name"))
            rows = [{"holder_id": int(a.owner_id), "name": names.get(int(a.owner_id), ""), "balance": money(a.balance)} for a in page]
        elif kind == "rider":
            rows = rider_rows(page, ids)
        else:
```

(d) replace

```python
    customer_ids = {w.holder_id for w in rows if w.holder_type == "customer"}
    owner_ids = {w.holder_id for w in rows if w.holder_type == "business_owner"}
    names = {("customer", pk): name for pk, name in Customer.objects.filter(pk__in=customer_ids).values_list("pk", "full_name")}
```

with

```python
    customer_ids = {w.holder_id for w in rows if w.holder_type == "customer"}
    owner_ids = {w.holder_id for w in rows if w.holder_type == "business_owner"}
    staff_ids = {w.holder_id for w in rows if w.holder_type == "staff"}  # third-party riders
    names = {("customer", pk): name for pk, name in Customer.objects.filter(pk__in=customer_ids).values_list("pk", "full_name")}
    names.update({("staff", pk): name for pk, name in StaffUser.objects.filter(pk__in=staff_ids).values_list("pk", "full_name")})
```

(e) in `backend/wallets/tests/test_staff_wallets.py` replace

```python
        self.assertEqual(self.client.get(URL, {"kind": "rider"}).status_code, 400)
```

with

```python
        self.assertEqual(self.client.get(URL, {"kind": "drivers"}).status_code, 400)                # riders exist since Plan 5
```

- [ ] **Step 4: One rider, and a day's commission** — in `backend/wallets/views_rider_wallet.py` replace

```python
from datetime import date

from rest_framework import exceptions, status
```

with

```python
from datetime import date, timedelta

from django.db.models import Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import exceptions, status
```

replace

```python
from delivery import employment
from ledger import escrow
```

with

```python
from delivery import employment
from delivery.models import Rider, RiderCommissionPosting, RiderEarning
from ledger import escrow
```

replace `from .views import OFF, Pagination` with `from .views import OFF, Pagination, ledger_off`, and append to the end of the file:

```python


# --- staff reads (wallets.view: Accountant, Super Admin) ------------------------------------------------------------

STAFF_PERMISSION = "wallets.view"


class StaffRiderWalletView(APIView):
    """GET riders/<id>/wallet/ — one rider's balance, reserve, last 20 earnings and last 30 posted days (wallets.view)."""

    def get_permissions(self):
        return [HasRolePermission(STAFF_PERMISSION)]

    def get(self, request, pk):
        if not escrow.enabled():
            return ledger_off()
        rider = get_object_or_404(Rider.objects.select_related("staff"), pk=pk)
        return Response({
            "rider": {
                "id": rider.pk, "staff_id": rider.staff_id, "name": rider.staff.full_name, "employment": rider.employment,
                "company_name": rider.company_name, "third_party_since": rider.third_party_since,
            },
            **rider_wallet.summary(rider),
            "earnings": [rider_wallet.earning_row(earning) for earning in rider_wallet.earnings(rider)[:20]],
            "days": rider_wallet.days(rider),
        })


class StaffRiderCommissionView(APIView):
    """GET rider-commission/?day=YYYY-MM-DD — every rider's commission posted for that day (default yesterday, Accra),
    with the day's totals (wallets.view)."""

    def get_permissions(self):
        return [HasRolePermission(STAFF_PERMISSION)]

    def get(self, request):
        if not escrow.enabled():
            return ledger_off()
        try:
            day = parse_day(request.query_params.get("day")) or timezone.localdate() - timedelta(days=1)
        except ValueError:
            return Response({"day": BAD_DAY}, status=status.HTTP_400_BAD_REQUEST)
        rows = RiderCommissionPosting.objects.filter(day=day).select_related("rider__staff").order_by("rider__staff__full_name", "pk")
        totals = rows.aggregate(
            deliveries=Sum("deliveries"), gross=Sum("gross_pesewas"), commission=Sum("commission_pesewas"), net=Sum("net_pesewas"),
        )
        # A posting row is never edited: commission given back for a delivery refunded in full afterwards is shown beside it.
        back = dict(
            RiderEarning.objects.filter(reversed_at__isnull=False, commission_posting__day=day)
            .values("rider_id").annotate(total=Sum("reserve_pesewas")).values_list("rider_id", "total")
        )
        return Response({
            "day": day,
            "results": [
                {
                    "rider_id": row.rider_id, "name": row.rider.staff.full_name, "company_name": row.rider.company_name,
                    "deliveries": row.deliveries, "gross": money(row.gross_pesewas), "commission": money(row.commission_pesewas),
                    "net": money(row.net_pesewas), "given_back": money(back.get(row.rider_id, 0)), "posted_at": row.posted_at,
                }
                for row in rows
            ],
            "totals": {
                "deliveries": totals["deliveries"] or 0, "gross": money(totals["gross"] or 0),
                "commission": money(totals["commission"] or 0), "net": money(totals["net"] or 0),
                "given_back": money(sum(back.values())),
            },
        })
```

and in `backend/delivery/urls.py` replace

```python
    path("riders/<int:pk>/employment/", views_fleet.RiderEmploymentView.as_view(), name="delivery-rider-employment"),
```

with

```python
    path("riders/<int:pk>/employment/", views_fleet.RiderEmploymentView.as_view(), name="delivery-rider-employment"),
    path("riders/<int:pk>/wallet/", views_rider_wallet.StaffRiderWalletView.as_view(), name="delivery-rider-wallet-staff"),
    path("rider-commission/", views_rider_wallet.StaffRiderCommissionView.as_view(), name="delivery-rider-commission"),
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `docker compose -p disp1 run --rm web python manage.py test wallets.tests.test_rider_staff wallets.tests.test_staff_wallets wallets.tests.test_staff_withdrawals --noinput`
Expected: PASS (5 new tests in `test_rider_staff`, 1 changed in `test_staff_wallets`).

- [ ] **Step 6: Commit**

```bash
git add backend/wallets/views_staff.py backend/wallets/views_rider_wallet.py backend/delivery/urls.py backend/wallets/tests/test_rider_staff.py backend/wallets/tests/test_staff_wallets.py
git commit -F - <<'EOF'
feat(wallets): staff reads of riders' money - balances, the withdrawals queue, one rider's wallet, a day's commission (wallets.view)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

---

### Task 8: Documentation, the spec's switch-on gates, and full verification

**Files:**
- Modify: `backend/CLAUDE.md`, `CLAUDE.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md`, `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md`

**Interfaces:**
- Consumes: everything above. Produces: no code.

- [ ] **Step 1: Correctness core** — in `backend/CLAUDE.md` replace

```markdown
- **The ledger (`ledger/`) is append-only and integer-pesewa.** A balance changes only inside `ledger.posting.post`
```

with

```markdown
- **Third-party riders (`delivery/employment.py`, `ledger/riders.py`, `wallets/rider_wallet.py`, Plan 5).** A rider is
  AshantiHub's own (`Rider.employment="ashantihub"`, the default: no wallet, every `/api/delivery/rider/wallet/*`
  endpoint answers `409 wallet_disabled`) or third-party, changed only through the `delivery.rider_employment` approval
  (Delivery Manager proposes, Super Admin approves; switching back is refused while money, a withdrawal or a
  delivered-but-unreleased order is open). Behind `LEDGER_ENABLED`, a third-party rider is paid only at release
  (Support's "matches"), never at the door: `riders.credit_delivery`, last in `escrow.release_verified`'s transaction,
  moves what platform delivery income took for the order (fee plus promo charge) to the rider (`order-rider-<order>`: 90%
  Rider balance, 10% reserve at the `rider_commission_bp` in force when the order was paid). A whole refund after release
  reverses it first (`riders.reverse_earning`; the balance may go below zero and then blocks withdrawals); a partial
  refund never touches it. The 00:20 job (`ledger.tasks.post_rider_commission`) posts each earlier day's reserve to
  platform commission income once (earning rows locked; missed nights caught up). **Lock order:** the order row, its fee
  snapshots, then the rider row (release) or the earning row (refund), then accounts in one sorted pass; the end-of-day
  job takes the rider row, then the earning rows, then the accounts. A rider's accounts are held by their staff account, so the Stage 3b
  destinations and withdrawals serve riders (`holder_type` "staff"; verified name = staff name with an approved, in-date
  Ghana Card; step-up codes for `withdrawal` / `payout_destination` only). Rider wallet writes are `activity_exempt`
  (as staff writes they would run inside the middleware's transaction and store the account number) and record their
  own event, without the number, through `views_payouts`' `saved()` hook. Nobody changes their own employment
  (`own_rider` 403, a Super Admin included) and only a Dispatch rider can be third-party; `wallet_rider()` also checks
  the Dispatch role. Payroll (`RiderEarnedView`, `rider/earnings/`) leaves out a third-party rider's deliveries
  (`employment.payroll_jobs`), so Accounting cannot pay them twice. A day's `RiderCommissionPosting` is never edited:
  commission given back by a later full refund shows as `given_back` beside it.
- **The ledger (`ledger/`) is append-only and integer-pesewa.** A balance changes only inside `ledger.posting.post`
```

(1b) in the same file, two sentences the new rider rules make stale. Replace

```markdown
withdrawal, payout destination) must call it. Only customers and owners may ask for step-up codes (staff use
    sudo), and the endpoints answer `409 otp_off` unless a code could be owed.
```

with

```markdown
withdrawal, payout destination) must call it. Only customers, owners and third-party riders (riders: withdrawal and
    payout_destination only, while the ledger is on) may ask for step-up codes (other staff use sudo), and the
    endpoints answer `409 otp_off` unless a code could be owed.
```

(keep the file's own indentation and line breaks around the replaced words), and replace `a vendor's negative` / `  Available blocks it.` (two lines in the withdrawals bullet) with `a negative vendor` / `  Available or rider balance blocks it.`. The matching sentence in `backend/otp/step_up.py` is fixed in Task 5 Step 7(e).

- [ ] **Step 2: The stage index** — (a) in the root `CLAUDE.md` replace

```markdown
  OTP; Stage 1 (ledger), Stage 2 (OTP, backend) and Stage 3 (wallets, withdrawals, reconciliation, backend) are
  implemented behind switches that default off, later stages are specs only; §13 lists what must be done before each
  switch is turned on
```

with

```markdown
  OTP; Stage 1 (ledger), Stage 2 (OTP, backend), Stage 3 (wallets, withdrawals, reconciliation, backend) and Stage 5
  backend (third-party rider wallets and daily commission, Plan 5) are implemented behind switches that default off,
  later stages are specs only; §13 lists what must be done before each switch is turned on
```

(if Plan 4 merged first, its wording of these lines is different: add "and Stage 5 backend (third-party rider wallets and daily commission, Plan 5)" to its list instead);

(b) in `docs/IMPLEMENTATION_INSTRUCTIONS.md` replace

```markdown
| **5** Third-party dispatch | `Rider` employment flag, rider wallet, 90/10 split on release, end-of-day commission job. |
```

with

```markdown
| **5** Third-party dispatch | `Rider` employment flag, rider wallet, 90/10 split on release, end-of-day commission job. Backend: docs/superpowers/plans/2026-10-16-dispatch-wallets-5.md, built behind `LEDGER_ENABLED` (default off); the screens are Plan 5F. |
```

- [ ] **Step 3: The spec's header** — in `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` replace

```markdown
docs/superpowers/plans/2026-10-16-withdrawals-3b.md (payout destinations, withdrawals, reconciliation).
```

with

```markdown
docs/superpowers/plans/2026-10-16-withdrawals-3b.md (payout destinations, withdrawals, reconciliation). Stage 5 (third-party dispatch, backend) plan: docs/superpowers/plans/2026-10-16-dispatch-wallets-5.md.
```

and replace

```markdown
**Scope:** One system, built in the order given in §11. Stage 1 (ledger), Stage 2 (OTP, backend) and Stage 3 (wallets,
payments, refunds, withdrawals and reconciliation, backend) are implemented behind switches that default off (branches
feature/ledger-stage1, feature/otp-security and feature/wallets; see section 13); later stages are specs only.
```

with

```markdown
**Scope:** One system, built in the order given in §11. Stage 1 (ledger), Stage 2 (OTP, backend), Stage 3 (wallets,
payments, refunds, withdrawals and reconciliation, backend) and Stage 5 (third-party rider wallets and daily commission,
backend) are implemented behind switches that default off (branches feature/ledger-stage1, feature/otp-security,
feature/wallets and feature/dispatch-wallets-5; see section 13); later stages are specs only.
```

(fold the Stage 5 words into Plan 1b's and Plan 4's wording if either changed these lines first).

- [ ] **Step 4: The switch-on gates** — append to the end of the spec, after Task 1's "Stage 5 (third-party dispatch) reconciliation" section (numbering continues from Plan 4's (xc)). **Plan 5 keeps gates (xci)-(c).** Plan 6 (catalogue) also appended after (xc) and used (xci)-(cii): whichever merges second renumbers; Plan 6 will renumber to start at (ci), and when it does, every cross-reference in this plan follows (the `wallets/names.py` docstring's "(xcii)", the §0 R1 row's "(xcix)", the table below):

```markdown

### Before LEDGER_ENABLED is turned on — Stage 5 additions

- (xci) **Frontend (Plan 5F).** The rider app's wallet: the balance; the reserve as "AshantiHub's commission, taken after
  midnight"; earnings per delivery with their status; each day's gross, commission and net; the statement; payout
  destinations and withdrawals with the step-up prompt; `409 wallet_disabled` for AshantiHub's own riders and
  `409 id_required` until the Ghana Card is approved. The Delivery Manager's "works for" control on the rider profile (it
  raises an approval; `409 rider_money_open` lists what is open). The Accountant's rider wallets, rider withdrawals and
  daily commission screens.
- (xcii) **Rider identity rests on one person.** A third-party rider's verified name (staff `full_name`) and code channel
  (staff `phone` / `email`) are typed by whoever invited them, usually the Delivery Manager, who also approves their Ghana
  Card; nothing compares the card's name with `full_name`. (No staff-edit endpoint exists today: `staff.manage` has
  manager, permissions, suspend, deactivate and invite, not rename or change phone.) Before switch-on: record the card's
  name at review and match it, and have a second person (or the Super Admin's employment approval) confirm both the name
  and the contacts. Any future staff-edit endpoint that changes a third-party rider's name or contacts must restart
  destination cooling and notify the old contacts, as (xxix) and (xxxiv) ask for customers and owners.
- (xciii) **Owner question: a rider is paid nothing for a delivery whose order is refunded whole,** before release (the fee
  goes back to the customer, W4) or after it (the earning is taken back and the balance may go below zero), even when the
  business was at fault and the rider did the work. The alternative is for AshantiHub to pay the rider from its own
  income in those cases. (See also (c): the same wait applies to an unreachable customer.)
- (xciv) **A rider switched back to AshantiHub's own can still owe money later.** The switch is refused while money is
  open, but a whole refund after release of an older third-party delivery still reverses its earning, leaving a negative
  balance on a closed wallet with no way to recover it in the app (payroll deduction or write-off is a process decision).
  **Deactivating or suspending a third-party rider strands their wallet:** `staff/<id>/deactivate/` is not blocked by
  `employment.money_open` (deactivation is not a switch back), and a deactivated or suspended staff member can neither sign
  in nor withdraw (a paper-expiry auto-suspension does the same until reinstated). Before switch-on: refuse the
  deactivation while `money_open(rider)` is non-empty (409 `rider_money_open`), and flag a suspension with money open, or
  provide a maker-checker staff payout to a verified destination.
- (xcv) **The end-of-day commission job is a no-op while the ledger is off** (like (xxxix)). The switch is one-way ((x)),
  so a reserve is stranded only if the ledger is switched off, which it must never be. A missed night is caught up by the
  next run (built).
- (xcvi) **Accounting screens do not show rider money yet.** `insights/accounting.py` and the Accountant's dashboard count
  neither platform commission income nor AshantiHub's liability to riders (Σ rider balance + Σ rider reserve); add both.
  The pay screens built for payroll (`delivery/views_rules.py` `RiderEarnedView` at `payouts/`, the rider app's
  `rider/earnings/`) still show rate-card pay with "no money has moved", which is not what a third-party rider is paid:
  exclude deliveries made while the rider was third-party (`delivered_at` inside one of their `RiderEmploymentPeriod` rows, past ones too) from `RiderEarnedView` /
  `RiderEarningsLinesView` and the rider app's `rider/earnings/` payroll figures before the ledger is on, or Accounting can
  pay a third-party rider twice (wallet plus payroll). **Built in Task 6** (`employment.payroll_jobs`, tested); what stays
  open is the Accounting dashboard's liability and commission lines.
- (xcvii) **Delivery fees are off (`DELIVERY_FEE_ENABLED`, default off).** Until they are charged most orders carry no
  delivery fee, and a third-party rider earns only fees a business covered with its free-delivery promo. Third-party
  riders need delivery fees on (owner decision 2026-10-13).
- (xcviii) **Owner question: rider withdrawal limits.** Riders share the customers' and vendors' governed limits
  (GH₵ 5,000 per withdrawal, GH₵ 10,000 a day, 24-hour cooling); separate rider limits would need new settings.
- (xcix) **Owner question: rider companies.** `Rider.company_name` is free text. If a rider company itself is to be
  contracted, invoiced or paid (instead of each rider), a company record and company payouts are a new plan.
- (c) **Owner question: rider pay waits for Support's verification call.** A third-party rider is credited only when
  Support records "matches" (spec §2.2 step 2(c), §4.1), so their pay can wait up to 72 hours, or indefinitely when the
  customer cannot be reached ("could not reach" releases nothing, and nothing releases on its own). Their switch back to
  AshantiHub's own is blocked meanwhile (R3, `deliveries`). Decide whether the delivery fee should be released to the rider
  at delivery (or after the customer's own confirmation) separately from the vendor's money. The spec's "90% withdrawable
  immediately" holds from release, not from delivery. (RA12.)
```

- [ ] **Step 5: Commit**

```bash
git add backend/CLAUDE.md CLAUDE.md docs
git commit -F - <<'EOF'
docs(wallets): correctness core for third-party riders, stage index, spec scope and switch-on gates (xci)-(c) (Plan 5)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01HDHNosHkqu4Wwocp7a2c8j
EOF
```

- [ ] **Step 6: Run the whole backend suite**

Run: `docker compose -p disp1 run --rm web python manage.py test --noinput`
Expected: PASS. If a failure is unrelated to this work, confirm it on the base commit (`d26dd54`: `git switch --detach d26dd54`, re-run the failing label, `git switch feature/dispatch-wallets-5`) and report it rather than fixing it here.

- [ ] **Step 7: Migrations check**

Run: `docker compose -p disp1 run --rm web python manage.py makemigrations --check --dry-run`
Expected: `No changes detected`.

---

## What this plan deliberately does not do (later plans)

| Plan | Scope | Why separate |
|---|---|---|
| **5F** Frontend | The rider app's wallet screens, the fleet "works for" control, the Accountant's rider wallet, withdrawals and daily commission screens (spec §13 (xci)). | No screen ships in a backend plan; the API answers `wallet_disabled` / `id_required` / `step_up_required` / `ledger_off` for it to handle. |
| **7** Hubtel live | Real payouts to riders, name lookups and the payout webhook (`wallets.payouts.apply_result`), as for customers and vendors. | Needs credentials and regulatory clearance (§11 step 7, §12). |
| Accounting | Commission income and rider liabilities on the Accountant's dashboard; payroll for AshantiHub's own riders (`rider_pay` stays a record). | §13 (xcvi); payroll is not in the spec. |
| Owner decisions | Paying riders for deliveries refunded whole (xciii), recovering a closed wallet's negative balance (xciv), rider-specific limits (xcviii), rider companies as payees (xcix), paying riders before Support's call (c). | Not decided; the plan's defaults are RA1–RA11. |

## Self-review

**Spec coverage:**

| Requirement | Task(s) |
|---|---|
| §1 row 4 / §7 third-party dispatch = riders from a rider company, not employees; AshantiHub's own riders have no wallet | 1 (`Rider.employment`, `company_name`, approval), 5 (`wallet_disabled` in the engine), 6 (`wallet_disabled` on every rider endpoint) |
| §1 row 4 delivery paid by the customer on top, one fee per order, wholly to the third-party rider or AshantiHub, never borne by the vendor | 2 (the whole fee AshantiHub took at release goes to the rider; vendor lines untouched; a promo fee the business chose to cover goes to the rider too) |
| §1 row 5 10% reserve per credit, 90% withdrawable at once, reserve to platform income at end of day | 2 (split at release), 3 (00:20 job), 5 (balance withdrawable, never the reserve) |
| §1 row 5 true-up if the rate changed that day | 2 (rate fixed per earning at payment time: no true-up needed; R6) |
| §3.3 / §1 row 16 the commission is editable by Super Admin / Accounting through the governed approvals | 2 (`rider_commission_bp` through `ledger.setting`, test), R6 |
| §2.2 step 2(c) the rider's share is part of the release on Support's call | 2 (`credit_delivery` last in `release_verified`'s transaction; `verification.record` test) |
| §2.2 step 6 day's gross, commission and net recorded; a reversed delivery reverses its share | 3 (`RiderCommissionPosting`), 4 (`reverse_earning`; reserve or commission) |
| §2.2 steps 3-4 refunds before and after release | 4 |
| §2.2 step 5 / §8 withdrawals to a verified, name-matched, OTP-confirmed destination, cooling, limits, holder-borne charge | 5 (engine), 6 (API with step-up) |
| §2.2 "a reversed delivery reverses its share" visible to the rider and Accounting | 4 (rider notice), 6 and 7 (`given_back` beside the never-edited day record) |
| Brief: no double pay with payroll; nobody makes themselves a wallet rider | 6 (`payroll_jobs`), 1 (`own_rider`, `not_a_rider`) |
| §9 OTP before withdrawal and payout-destination actions for everyone | 5 (step-up codes for third-party riders), 6 |
| Brief: rider-facing reads (balance, earnings per delivery, statement) with isolation | 6 |
| Brief: staff reads under `wallets.view` | 7 |
| Brief: reconciliation additions only if needed | none needed (R13) |
| §11 step 5 behind a switch, simulated rails | every task (`LEDGER_ENABLED`; simulated provider) |

**Placeholder scan:** every code step carries complete code and every test step complete test code; every edit quotes the exact text it replaces; no "TBD", "similar to" or undefined names.

**Name consistency:** `Rider.ASHANTIHUB/THIRD_PARTY/EMPLOYMENT_CHOICES`, `employment/company_name/third_party_since` and `RiderEmploymentPeriod` (`rider`, `started_at`, `ended_at`, related name `employment_periods`) with `employment.third_party_at` (1–7); `delivery.employment.KIND`, `WALLET_DISABLED`, `OPEN_LABELS`, `EmploymentError`, `is_third_party`, `wallet_rider`, `id_verified`, `unreleased_deliveries`, `payroll_jobs`, `money_open`, `clean`, `check(rider, employment, company, maker=None, lock=False)`, `pending_for`, `propose`, `row`, `EMPLOYMENT_KIND` (1, 5, 6); `RiderEarning` (`gross_pesewas`, `commission_bp`, `reserve_pesewas`, `net_pesewas`, `earned_at`, `earned_on`, `journal`, `commission_posting`, `reversed_at`, `reversal_journal`) and `RiderCommissionPosting` (`rider`, `day`, `deliveries`, `gross_pesewas`, `commission_pesewas`, `net_pesewas`, `journal`, `posted_at`) (2–7); `ledger.riders.COMMISSION_SETTING`, `earning_key`, `split`, `accounts_of`, `third_party_rider`, `rider_for_release`, `release_accounts`, `credit_delivery(order, rider, now=None)` (2), `commission_key`, `post_day(rider_id, day, now=None)`, `post_commission(today=None, now=None)` (3), `reversal_key`, `earning_to_reverse`, `reversal_accounts`, `reverse_earning(earning, now=None)` (4); `ledger.tasks.post_rider_commission` (3); `withdrawals.NEGATIVE`, `payouts.HOLDER_MODELS`, `otp.views_step_up.RIDER_ACTIONS`, `IsCustomerOwnerOrWalletRider` (5); `views_payouts.SavedHook.saved(request, event, obj)` with events `destination_added`, `destination_removed`, `withdrawal_requested`, `withdrawal_cancelled` (6); `rider_wallet.summary/earnings/status_of/earning_row/given_back/days/statement_lines/line_row` (6, 7); `views_rider_wallet.LedgerOff`, `WalletDisabled`, `parse_day`, `BAD_DAY`, `RiderWalletMixin` and the eight rider views (6), `StaffRiderWalletView`, `StaffRiderCommissionView` (7); `views_staff.rider_rows` (7); test helpers `rider_helpers.rider/delivered_by/waived/earning/ghana_card` (2–7). From Stage 3: `posting.post(..., allow_negative=...)`, `lock`, `account_for`, `balance_of`; `escrow.pay_key/release_key/waiver_key/waiver_return_accounts/return_waiver`; `wallets.tests.helpers.Holder/destination`; `views.ledger_off/OFF/Pagination`; `services.money`.

**Test counts:** Task 1 — 11 (`test_employment`); Task 2 — 14 (`test_rider_release`: 11 + 1 ledger-off + 1 split + 1 threaded `ConcurrentReleaseSwitchBackTests`); Task 3 — 6 (`test_rider_commission`: 5 + 1 threaded); Task 4 — 10 (`test_rider_refunds`: 9 + 1 threaded); Task 5 — 11 (`test_rider_engine`: 8 + 3); Task 6 — 10 (`test_rider_api`); Task 7 — 5 (`test_rider_staff`) and one changed (`test_staff_wallets`). 67 new tests in all.

**Review Focus pins:** each of the seven lines above names the task and the test that pins it; all of those tests are written out in their tasks.

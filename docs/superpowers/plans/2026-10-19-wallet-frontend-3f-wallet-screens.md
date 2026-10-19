# Wallet Frontend 3F — Wallet and Payments Screens — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put screens on the wallet backends of Plans 3a and 3b (and the 7C rulings): the shared wallet API layer and holder-agnostic components, "pay from wallet" at checkout with the honest payment-processing line, refund notices on the statement, the vendor's payouts tab, and the staff Wallets list, Withdrawals queue (with two-person resolution of stuck payouts) and Reconciliation screen. Nothing here ships to customers until `LEDGER_ENABLED` is on; every screen answers `409 {"code":"ledger_off"}` with an honest "Wallets aren't switched on yet."

**Architecture:** One new flat folder `frontend/components/wallet/` of holder-agnostic components (customer, vendor; riders mount them in Plan 5F), one hook file per endpoint family under `frontend/hooks/`, and `frontend/components/admin/panels/` for the three staff panels. Hooks own their data (query), mutations are plain `apiPost` in event handlers (no `useMutation`), styling is inline off `C` (customer) or `D` (dashboard and staff) through one `walletStyles(tone)` helper. Money is a GH₵ string from the server and is shown as sent; the client does no limit, charge or balance maths. Withdrawals and destination changes call `apiPost` and rely on **Plan 2F's apiClient-level step-up retry** (a `403 {code:"step_up_required", action}` opens the prompt and retries once with `X-Step-Up-Token`); 3F builds no prompt of its own.

**Tech Stack:** React 19, TanStack Query, MSW, Vitest + Testing Library. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` §5 (customer wallet), §6 (vendor), §8 (destinations), §13 gates (iii)-(xlix) listed under Review Focus; plans `2026-10-16-wallets-payments-3a.md` and `2026-10-16-withdrawals-3b.md` (their final tables' 3F rows and "Before LEDGER_ENABLED" gates); rulings in `2026-10-18-wallet-rulings-7c-release-withdrawals-otp.md` (Tasks 3-5) and memory `wallet-owner-decisions-2026-10-18`; `DESIGN.md`.

**Base:** branch from `righteoushack` after Wallet Plans 3a, 3b and 2F's step-up piece have merged. 7C is a soft dependency (top-up hold fields, `resolve/` endpoint); each task says what it shows when 7C is not merged. Run Vitest from `frontend/` only.

**Commit trailers:** every commit message in this plan ends with a blank line and exactly these two lines:

```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XFGWCBi9roL1jB5Yhycjq5
```

## Division with marketplace Plan 4

Source: `docs/superpowers/plans/2026-10-19-marketplace-4-shopper-pages.md`, its "Pending wallet frontends" table and Tasks 10, 14 and 15. **Order: 3F tasks 1-5 merge first; Plan 4 consumes them.** Plan 4 Step 0 of Tasks 14 and 15 stops if the 3F files named below are absent.

| Screen or piece | Built by | Notes |
|---|---|---|
| `useWallet`, `useWalletTransactions`, `useWalletProcessing`, `useWalletDestinations`, `useWithdrawals`, `walletErrors.js` (hooks and API layer) | **3F Task 1** | Same names Plan 4 lists in its Task 14/15 Files. |
| `ProcessingLine`, `TopUpForm`, `BalanceSummary`, `TransactionsList`, `RefundNotice`, `DestinationsList`, `AddDestinationForm`, `WithdrawForm`, `WithdrawalHistory` | **3F Tasks 2-5** | Holder-agnostic, `tone` prop picks the `C` or `D` palette; no tabs, no page chrome, no routes. |
| `PaymentMethodPicker`, pay-from-wallet at checkout | **3F Task 6** on today's `CartDrawer` checkout | Plan 4 Task 10 imports `PaymentMethodPicker` and `ProcessingLine` into `CheckoutPage` and deletes the `CartDrawer` checkout step; it does **not** build them. |
| `WalletTabs` (Overview, Wallet, Transactions, Settings), `WalletOverview`, `TopUpDialog` (a thin dialog around `TopUpForm`), the Settings tab, routes `/my-account/payments/<tab>`, breadcrumb, marketplace look, the "default address" card | **Plan 4 Tasks 14-15** | They compose 3F's components. |
| Vendor Payouts tab (Pending/Available, destinations, withdraw, history) | **3F Task 7** | Plan 4F (vendor money: overview with cap meter, sales, daily, export, fee page, texts settings) reuses `useWallet`/`useVendorWalletOverview` and links to this tab. |
| Rider wallet screens and mounting destinations/withdrawals for riders | **Plan 5F** | 3F's components take `basePath` (default `/api/wallet`) so 5F passes the rider endpoints; 3F mounts nothing for riders. |
| Staff Wallets list, Withdrawals queue and resolution, Reconciliation | **3F Tasks 8-9** | Not in Plan 4. |
| Recovery-contact step-up screens | **Plan 2F** | 3F only checks them in Task 10. |

**Edits Plan 4 owes once this plan is accepted** (to be made in Plan 4, not here): delete from Task 14 Files `useWallet.js`, `useWalletTransactions.js`, `useTopUp.js`, `walletErrors.js` and from Task 15 Files `useWalletDestinations.js`, `useWithdrawals.js`, `DestinationsList.jsx`, `AddDestinationForm.jsx`, `WithdrawForm.jsx`, `WithdrawalHistory.jsx`; delete `PaymentMethodPicker.jsx`, `ProcessingLine.jsx`, `useWalletProcessing.js` from Task 10 Files; change their Step 3 to "compose 3F's components". There is **no `useTopUp` hook**: a mutation is a handler (`frontend/CLAUDE.md`), so `TopUpForm` posts itself.

## Global Constraints

- **Mutations are plain `apiPost`/`apiDelete` in handlers** with a local error and `refetch()`/`invalidateQueries`; no `useMutation`. Components never import `App.jsx` (`MoMoPayment` arrives as the existing `PaymentComponent` prop).
- **Money rules (`DESIGN.md`):** amounts are dark-brown text, `font-variant-numeric: tabular-nums`, no gold, no decoration; direction is shown by sign and arrow, never colour alone. Checkout and payout forms are calm, white cards on cream, one gold confirm button.
- **No fabricated data:** no client-made charge, fee, limit, cap, balance or reason. The processing line comes from `GET /api/wallet/processing/`; a withdrawal's `charge` and `you_receive` are shown only after the server returns them; refusals show the server's `detail` verbatim (`walletMessage`). `MoMoPayment` today shows a made-up "Transaction fee (1.5%)": Task 6 removes it when the ledger is on.
- **Numbers are masked as sent** (`account_number_masked`); the UI never holds, logs or tests an unmasked number except the one the user is typing, which lives in the form's own state and is cleared on success.
- **Step-up is Plan 2F's.** Destination add/remove and withdrawals are always step-up-gated while the ledger is on (`force=True`). Components never read or store the token.
- **Paginated vs unpaginated:** `useWalletTransactions`, `useWithdrawals`, `useStaffWallets`, `useStaffWithdrawals` return the DRF envelope (read `data.results`, follow `next`); `useWallet`, `useWalletDestinations` (`{results, cooling_hours}`) and the reconciliation list (`{results}`) are not paginated envelopes. Each hook's header comment says which, like `useEscrowLedger`.
- **Staff menus are per role** (`navModel.js`); a panel's nav item is added only with the panel. Gate on `wallets.view` (read) and `wallets.manage` (resolve); the accountant holds both, Super Admin all, Support neither.
- **No realtime key exists** for wallets (`backend/realtime/publish.py` names none); staff panels refetch on a visible Refresh button and on window focus. Do not invent a key.
- **Contract tests:** `StaffDashboard.test.jsx`, `BusinessDashboard.test.jsx`, `navModel.test.js`, `accountingNav.test.js`, `SettingsScreens.test.jsx` and `MoMoPayment.test.jsx` are behavioural contracts. Each task that touches what they assert names the assertion and keeps it green; the only intentional edits are listed in Tasks 6-9 with the reason.
- **Vitest from `frontend/`**; a flood of `[MSW] intercepted a request without a matching request handler` means a local `frontend/.env` overrides `VITE_API_BASE_URL` (move it aside). `mocks/handlers.js` hardcodes `http://localhost:8000`.
- **Customer, vendor and staff copy never shows another person's number, and 3F never renders `failure_reason` as staff text:** the server already replaces staff reasons with "AshantiHub could not complete it."

## Review Focus

1. **Withdraw once.** A double click, a retry after a network error and the step-up retry all send the same `request_id`; a new one is minted only after success or a deliberate change of amount or destination (`test_withdraw_sends_one_request_id_across_a_double_click`, `test_request_id_survives_the_step_up_retry`). Gate (xxxv)/B-series idempotency depends on it.
2. **No second code prompt, no token handling in components** (`test_withdraw_form_never_reads_a_step_up_token`).
3. **Masking and the cooling line:** a destination in its cooling period shows "can receive money from {usable_from}", and the Withdraw button offers only `usable` destinations (`test_cooling_destination_is_listed_but_not_offered_for_withdrawal`). Gates (xxviii), (xxxiii).
4. **Top-up money held one hour (7C T3):** the balance says how much is held and until when only when the server sends `held_topup_pesewas`/`topup_free_at`; a `topup_held` refusal shows the server's `free_at` (`test_topup_held_refusal_shows_the_time_it_frees_up`). Without 7C, nothing about a hold is shown.
5. **Processing line honesty:** MoMo shows the server's `payment_processing` (even `0.00`, shown as "No payment processing charge"); wallet shows none; `ledger_off` omits it; `MoMoPayment` no longer adds 1.5% when the ledger is on (`test_momo_modal_has_no_made_up_fee_when_the_ledger_is_on`). Gates (ix), (xiii).
6. **Refund notices say only what the line says:** "Refund" rows with the order link and "returned to your wallet"; no reason is invented. The backend sends no refund notification for dispute or delivery refunds (gate (xvi)); 3F records that as an open gap, it does not fake a notice (`test_refund_notice_has_no_invented_reason`).
7. **Stuck withdrawal needs two people (7C T4, gates (xxxv), (xxxvi)):** the staff screen proposes "fail" or "settle as paid" with 10+ characters of evidence, shows "waiting for a second approver" and never shows a direct fail button; the proposer sees no Approve (`test_resolve_submits_a_request_not_a_fail`, `test_evidence_under_ten_characters_is_not_sent`).
8. **Staff rows are masked and names shown only to `wallets.view`** (`test_staff_withdrawal_rows_show_masked_destination_and_holder_name`).

## Assumptions made (decided here, cheap to change — for the owner to confirm)

- **F1** Support gets no wallet screens: it holds neither `wallets.view` nor `wallets.manage` by default (`accounts/migrations/0054_seed_wallet_permissions.py`). The Accountant and Super Admin do. Granting Support `wallets.view` later shows the screens under its role without code, but its menu is exhaustive, so a nav change would then be needed.
- **F2** The staff nav items are `wallets` (Wallets) and `withdrawals` (Withdrawals), added to Super Admin's Money group; the Accountant reaches them under "More tools" (its menu is not exhaustive and its canvas is not changed). The existing `reconciliation` item keeps its id and places; its panel becomes the real one when the ledger is on and the old "arrives later" stub when it is off.
- **F3** `POST /api/wallet/staff/withdrawals/<id>/resolve/` with `{outcome: "failed"|"paid", evidence}` (7C T4) answers a pending approval (`{approval_id, status:"pending"}`); the second approver acts in the existing Approvals screen, which already lists any kind by `kind_label`. Until 7C is merged the screen uses today's `.../fail/` with `{reason}` and says it applies at once.
- **F4** Vendor withdrawals use the same components as customers; the vendor page adds nothing the backend lacks (no cap meter, 4F's).
- **F5** A customer with no wallet screen yet (Plan 4 not merged) is acceptable only while the ledger is off; the switch-on checklist gains "Plan 4 Tasks 14-15 shipped" (added in Task 10).

## File Structure

New (all **create**): `frontend/components/wallet/{walletStyles.js,walletMoney.js,walletErrors.js,ProcessingLine.jsx,TopUpForm.jsx,BalanceSummary.jsx,TransactionsList.jsx,RefundNotice.jsx,DestinationsList.jsx,AddDestinationForm.jsx,WithdrawForm.jsx,WithdrawalHistory.jsx,PaymentMethodPicker.jsx,VendorPayouts.jsx}`; `frontend/hooks/{useWallet.js,useWalletTransactions.js,useWalletProcessing.js,useWalletDestinations.js,useWithdrawals.js,useStaffWallets.js,useStaffWithdrawals.js,useWalletReconciliation.js}`; `frontend/components/admin/panels/{WalletsPanel.jsx,WithdrawalsPanel.jsx,WalletReconciliationPanel.jsx}`; tests under `frontend/components/wallet/__tests__/` and `frontend/components/admin/panels/__tests__/`. Modified: `frontend/mocks/handlers.js`, `frontend/components/CartDrawer.jsx`, `frontend/App.jsx` (`MoMoPayment` only), `frontend/components/dashboard/BusinessCommandCenter.jsx`, `frontend/components/admin/AdminCommandCenter.jsx`, `frontend/components/admin/shell/navModel.js`, `frontend/CLAUDE.md`, `docs/IMPLEMENTATION_INSTRUCTIONS.md`.

---

### Task 1: The wallet API layer — hooks, error messages, MSW defaults

**Files:**
- Create: `frontend/hooks/useWallet.js`, `useWalletTransactions.js`, `useWalletProcessing.js`, `useWalletDestinations.js`, `useWithdrawals.js` (all in `frontend/hooks/`), `frontend/components/wallet/walletErrors.js`, `frontend/components/wallet/walletMoney.js`, `frontend/components/wallet/walletStyles.js`, `frontend/hooks/__tests__/useWallet.test.jsx`, `frontend/components/wallet/__tests__/walletErrors.test.js`
- Modify: `frontend/mocks/handlers.js`

**Interfaces:**
- Step 0 gate: confirm Plan 2F's step-up is merged (`grep -n step_up_required frontend/apiClient.js`; record the registration helper's real name, assumed `setStepUpHandler` by analogy with `setSudoHandler`). Not merged: stop; Tasks 4, 5 and 7 need it, Tasks 2, 3, 6, 8, 9 do not and may proceed.
- `useWallet({enabled=true})` → `GET /api/wallet/`, key `['wallet']`, returns the server body as is (`{kind:"customer", balance}` or `{kind:"vendor", pending, available}`; 7C adds `held_topup_pesewas`, `topup_free_at`). Also export `useVendorWalletOverview({enabled})` → `GET /api/wallet/vendor/`, key `['wallet','vendor']` (`pending, available, withdrawable, negative, awaiting_call, fee_cap`). Header comment: not paginated; `ledger_off` surfaces as `error.body.code`, with `retry:false` for that code so the "off" state does not spin.
- `useWalletTransactions(page=1,{enabled})` → `GET /api/wallet/transactions/?page=`, key `['wallet','transactions',page]`, DRF envelope; row fields `id, at, account, kind, label, direction, amount, order, booking_sale, reference`.
- `useWalletProcessing(amount)` → `GET /api/wallet/processing/?amount=`, enabled only when `amount` is a non-empty string already passing `isPlausibleAmount` (below); returns `{amount, payment_processing, you_pay, provider}`; a `400 {amount}` surfaces as `error.body.amount`.
- `useWalletDestinations({basePath='/api/wallet', enabled})` → `GET {basePath}/destinations/` → `{results, cooling_hours}`; `useWithdrawals(page, {basePath, enabled})` → `GET {basePath}/withdrawals/?page=`, envelope. Query keys include `basePath`.
- `walletMoney.js`: `isPlausibleAmount(text)` (ASCII digits, optional `.` plus 1-2 digits, greater than 0, at most 10 integer digits; **only** decides whether to spend a request, the server's message still wins), `formatGhs(str)` → `"GH₵ 1,250.00"` from the server string (no float maths), `pesewasToGhs(int)` for the 7C held field only, `newRequestId()` → `crypto.randomUUID()` with a fallback.
- `walletErrors.js`: `walletMessage(error) → {text, kind}`; `409 ledger_off` → `{text:"Wallets aren't switched on yet.", kind:"off"}`; `403 step_up_required` that reaches a component (prompt cancelled) → `{text:"We need to confirm it is you. Try again and enter the code.", kind:"stepup"}`; otherwise the server's `detail`, then the first string in the body (reuse `apiErrorMessage`), else `"Something went wrong. Try again."`; `kind:"error"`. Also export `refusalCode(error)` → `error.body?.code ?? null`.
- `walletStyles(tone)` → `{card, label, value, amount, button, ghost, field, error, note}` inline-style objects off `C` for `tone="light"` and `D` for `tone="dashboard"`; `amount` has `fontVariantNumeric:"tabular-nums"` and dark text; the only gold is `button` (confirm).
- MSW defaults in `handlers.js` (ledger **on**, empty): `GET /api/wallet/` → `{kind:"customer", balance:"0.00"}`; `transactions/` → empty envelope; `destinations/` → `{results:[], cooling_hours:24}`; `withdrawals/` → empty envelope; `processing/` → 400 unless `amount`, else `{amount, payment_processing:"0.00", you_pay:amount, provider:"simulated"}`; `GET /api/wallet/vendor/` → zeros. Tests that need `ledger_off` override per test.

- [ ] **Step 1: Failing tests.** `useWallet.test.jsx`: `test_returns_the_customer_summary_as_sent`, `test_returns_the_vendor_summary_as_sent`, `test_ledger_off_is_not_retried`, `test_transactions_follow_page_and_read_results`, `test_processing_not_asked_for_an_implausible_amount`, `test_destinations_use_the_base_path`. `walletErrors.test.js`: `test_ledger_off_text`, `test_server_detail_wins`, `test_step_up_cancelled_text`, `test_plausible_amounts` (table: `"50"`, `"50.5"`, `"50.25"` ok; `""`, `"0"`, `"0.00"`, `"1.234"`, `"abc"`, `"-5"`, `"1e3"` not), `test_formatGhs_never_uses_float_maths` (`"0.10"` + large `"99999999.99"` render exactly).
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run hooks/__tests__/useWallet.test.jsx components/wallet/__tests__/walletErrors.test.js`.
- [ ] **Step 3: Implement** the files above.
- [ ] **Step 4: Run to pass**, then the full suite (the new MSW defaults must not change any existing test).
- [ ] **Step 5: Commit** — `feat(wallet): wallet API hooks, error messages and money helpers`.

### Task 2: Top-up with the payment-processing line, and the balance summary

**Files:**
- Create: `frontend/components/wallet/ProcessingLine.jsx`, `TopUpForm.jsx`, `BalanceSummary.jsx`, tests `frontend/components/wallet/__tests__/TopUpForm.test.jsx`, `BalanceSummary.test.jsx`

**Interfaces:**
- `ProcessingLine({ amount, tone, method="momo" })` — uses `useWalletProcessing`; renders "Payment processing GH₵ x" with `you_pay` below; `payment_processing === "0.00"` → "No payment processing charge"; `method="wallet"`, `ledger_off` (409) or any error → renders nothing (the checkout total then shows no line, never a guess).
- `TopUpForm({ tone, onDone })` — amount input, `ProcessingLine` once the amount is plausible, a **Top up** button, `onDone(summary)` after success. `apiPost('/api/wallet/top-up/', {amount})`: `201 mode:"immediate"` → invalidate `['wallet']`, `['wallet','transactions']`, call `onDone`; `200 mode:"redirect"` → `window.location.href = checkout_url`; `400 {amount}` and any refusal → `walletMessage`. Copy: "You pay GH₵ {you_pay} (includes GH₵ {payment_processing} payment processing); GH₵ {amount} reaches your wallet." Button disabled in flight (double click posts once). When 7C is merged the form adds one line under the button: "Topped-up money can be withdrawn after {hold} hour(s)" **only if** the wallet payload carries `topup_hold_minutes`; otherwise no line.
- `BalanceSummary({ tone, basePath })` — `useWallet`; customer shows "AshantiHub wallet" with the balance; vendor shows **Pending** ("waiting for Support's call or the release time") and **Available**, and for `negative: true` (from `useVendorWalletOverview`) a plain note "Available is below zero after a late refund; withdrawals wait until it is recovered." With `held_topup_pesewas > 0` shows "GH₵ x of this was topped up and can be withdrawn from {topup_free_at as local time}"; `ledger_off` → the off text; loading/error states from `walletMessage`.

- [ ] **Step 1: Failing tests.** `TopUpForm.test.jsx`: `test_bad_amounts_send_no_request` (`""`, `"0"`, `"1.234"`, `"abc"`, `"-5"`), `test_processing_line_shows_the_servers_numbers`, `test_zero_processing_says_no_charge_not_a_made_up_figure`, `test_immediate_top_up_refreshes_the_balance_and_calls_onDone`, `test_redirect_answer_navigates_to_checkout_url`, `test_server_refusal_text_is_shown_verbatim`, `test_double_click_posts_once`, `test_ledger_off_shows_the_off_state_and_no_form`, `test_no_card_fields_exist`. `BalanceSummary.test.jsx`: `test_customer_balance_two_decimals`, `test_vendor_shows_pending_and_available`, `test_negative_available_explains_the_block`, `test_held_topup_line_only_when_the_server_sends_it`, `test_no_hold_wording_without_7c_fields`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/wallet/__tests__/TopUpForm.test.jsx components/wallet/__tests__/BalanceSummary.test.jsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then the full suite.
- [ ] **Step 5: Commit** — `feat(wallet): top-up form with the payment-processing line and balance summary`.

### Task 3: Statement and refund notices

**Files:**
- Create: `frontend/components/wallet/TransactionsList.jsx`, `RefundNotice.jsx`, test `frontend/components/wallet/__tests__/TransactionsList.test.jsx`

**Interfaces:**
- `TransactionsList({ tone, orderHref })` — `useWalletTransactions(page)`; each row: `label`, signed amount (`+`/`−` plus an arrow glyph with a screen-reader word "in"/"out"), date from `at`, and a link from `orderHref(order)` (default `/my-account/orders/{id}`; Plan 4 passes its route, the vendor tab passes none) when `order` is set; "Load more" follows `next` and appends; empty state "You don't have any transactions yet."; `ledger_off` state. Filter chips only if every `kind` in `wallets/services.py` `LABELS` maps to exactly one group (it does: top-ups `wallet_top_up`; purchases `order_payment`, `booking_payment`; refunds `order_refund`, `booking_refund`; withdrawals `withdrawal_hold`, `withdrawal_reversed`); filtering is client-side on the loaded pages and the chip row says "Shows what is loaded" until `next` is null, so it never implies a complete filter.
- `RefundNotice({ line })` — rendered inside a row whose `kind` is `order_refund` or `booking_refund` (direction in): "Refunded to your AshantiHub wallet" and, with an order, "for order #{order}". It adds no reason, no processing-charge claim and no date promise. Exported for Plan 4's order pages.
- Open gap recorded in the component header comment and in Task 10: dispute and delivery refunds send the customer no notification (spec gate (xvi)); the statement row is the notice until the backend notifies.

- [ ] **Step 1: Failing tests.** `test_in_and_out_rows_carry_a_sign_and_an_arrow_not_just_colour`, `test_order_rows_link_through_orderHref`, `test_vendor_rows_without_orderHref_render_no_link`, `test_load_more_follows_next_and_appends`, `test_empty_state_text`, `test_ledger_off_state`, `test_refund_row_shows_the_notice`, `test_refund_notice_has_no_invented_reason`, `test_withdrawal_returned_row_is_labelled_by_the_server_label`, `test_filter_chips_say_they_filter_loaded_rows_only`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/wallet/__tests__/TransactionsList.test.jsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then the full suite.
- [ ] **Step 5: Commit** — `feat(wallet): statement list with refund notices`.

### Task 4: Payout destinations — list, add, remove

**Files:**
- Create: `frontend/components/wallet/DestinationsList.jsx`, `AddDestinationForm.jsx`, test `frontend/components/wallet/__tests__/Destinations.test.jsx`

**Interfaces:**
- `DestinationsList({ tone, basePath, onChanged })` — `useWalletDestinations`; a card per destination: rail, institution, `account_name`, `account_number_masked`, a "name checked" chip from `name_check`; while `usable` is false and `removed` false: "Can receive money from {usable_from, local}" and above the list "A new number can receive money after {cooling_hours} hours"; **Remove** (confirm first, then `apiPost('{basePath}/destinations/{id}/remove/', {})`, expect 204 → `null`). Removed rows are not listed (the server omits them). `ledger_off` state. Never an Edit control.
- `AddDestinationForm({ tone, basePath, canCopyFromProfile, onDone })` — rail (`momo`/`bank`), institution (free text with the network names the server accepts; a refusal's `detail` is the validation, the client invents none), account number (input `autocomplete="off"`, cleared on success), and for a vendor **Use my registered payout details** → `{from_profile:true}`. `apiPost('{basePath}/destinations/', body)` goes through Plan 2F's step-up retry (the first 403 `step_up_required` with `action:"payout_destination"` opens the prompt, the retry carries the token). Success `201` shows "Added. It can receive money from {usable_from}"; refusals (`name_check_unavailable`, name mismatch, `payouts_unavailable`, a throttle 429) show `walletMessage`. The form never reads or stores a token.

- [ ] **Step 1: Failing tests.** `test_lists_masked_numbers_only_and_never_a_full_number`, `test_cooling_destination_shows_can_receive_from_and_the_cooling_hours_line`, `test_add_goes_through_the_step_up_retry_and_posts_the_same_body_twice` (fake handler installed through 2F's registration helper; first call 403 `step_up_required`, second carries `X-Step-Up-Token`), `test_add_cancelled_prompt_shows_the_try_again_text`, `test_add_refusal_text_is_shown_verbatim`, `test_from_profile_posts_only_the_flag`, `test_number_field_is_cleared_after_success`, `test_remove_confirms_then_posts`, `test_remove_cancelled_confirm_sends_nothing`, `test_base_path_is_honoured`, `test_ledger_off_state`, `test_no_card_fields_exist`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/wallet/__tests__/Destinations.test.jsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then the full suite.
- [ ] **Step 5: Commit** — `feat(wallet): payout destinations list, add and remove`.

### Task 5: Withdraw and withdrawal history

**Files:**
- Create: `frontend/components/wallet/WithdrawForm.jsx`, `WithdrawalHistory.jsx`, test `frontend/components/wallet/__tests__/Withdrawals.test.jsx`

**Interfaces:**
- `WithdrawForm({ tone, basePath, onDone })` — reads `useWalletDestinations` and offers only entries with `usable: true` (a note when none: "Add a payout number first" / "Your new number is still in its waiting period"). Amount input (same plausibility rule as top-up). **One `request_id` from `newRequestId()` created when the form mounts**, reused by every submit of the same destination and amount, regenerated after a success or when the amount or destination changes. `apiPost('{basePath}/withdrawals/', {destination, amount, request_id})` through the step-up retry (`action:"withdrawal"`). `201` or `200` (a retry already made) → shows the row's `charge`, `you_receive`, `status_label`; **no pre-estimate of the charge anywhere before submit.** Refusals render the server's `detail`: `suspended`, `invalid`, `unknown_destination`, `destination_cooling`, `name_mismatch`, `payouts_unavailable`, `below_charge`, `over_limit`, `negative_balance`, `insufficient_funds`, `daily_limit`, `duplicate_request`, `request_id_reused`, `topup_held` (7C; also shows `free_at` as a local time when present), `wallet_disabled`, `not_a_holder`. Button disabled while in flight. `ledger_off` state.
- `WithdrawalHistory({ tone, basePath })` — `useWithdrawals(page)`; rows: date, **amount**, charge, you receive, `status_label`, masked destination (7C ruling: every withdrawal event shows the amount); "Load more" via `next`; **Cancel** on each non-terminal row: it always tries `POST '{basePath}/withdrawals/{id}/cancel/'` and shows the server's reply (`not_pending` "Only a withdrawal not sent yet can be cancelled."), never guessing which rows are cancellable; `failure_reason` is shown as sent (the server already hides staff text).

- [ ] **Step 1: Failing tests.** `test_withdraw_sends_one_request_id_across_a_double_click`, `test_request_id_survives_the_step_up_retry`, `test_withdraw_retry_after_a_network_error_reuses_the_request_id`, `test_request_id_changes_after_success`, `test_request_id_changes_when_amount_or_destination_changes`, `test_only_usable_destinations_are_offered`, `test_cooling_destination_is_listed_but_not_offered_for_withdrawal`, `test_success_shows_charge_you_receive_and_status`, `test_no_charge_is_estimated_before_submitting`, `test_each_refusal_code_shows_the_server_detail` (table over the 16 codes above), `test_topup_held_refusal_shows_the_time_it_frees_up`, `test_withdraw_form_never_reads_a_step_up_token` (spy on `localStorage`/`sessionStorage`, assert no `X-Step-Up-Token` literal in the component source), `test_history_rows_show_the_amount`, `test_history_load_more_and_cancel_shows_the_servers_reply`, `test_ledger_off_state`.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/wallet/__tests__/Withdrawals.test.jsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then the full suite.
- [ ] **Step 5: Commit** — `feat(wallet): withdraw form with idempotent request id, and withdrawal history`.

### Task 6: Pay from the wallet at checkout, and the honest processing line

**Files:**
- Create: `frontend/components/wallet/PaymentMethodPicker.jsx`, test `frontend/components/wallet/__tests__/PaymentMethodPicker.test.jsx`, `frontend/components/__tests__/CartDrawer.wallet.test.jsx`
- Modify: `frontend/components/CartDrawer.jsx` (checkout step), `frontend/App.jsx` (`MoMoPayment` only: lines 109-280)

**Interfaces:**
- `PaymentMethodPicker({ value, onChange, amount, tone })` — radio group "Mobile money" / "AshantiHub wallet". The wallet option shows the balance from `useWallet` and is **disabled** (with the reason) when the ledger is off (`ledger_off` → "Paying from your wallet isn't switched on yet.", the server's `WALLET_OFF` text) or when the balance is below `amount` (compares two server-sent amounts as pesewas integers parsed from strings, display only; the server still decides and answers `insufficient_funds`). With the ledger off the whole picker renders only "Mobile money" and no wallet row, so today's checkout is unchanged. `ProcessingLine` (Task 2) sits under it for MoMo; none for the wallet.
- `CartDrawer` checkout: renders the picker above "Confirm & Pay"; state `paymentMethod` (`"momo"` default). **Wallet:** no `PaymentComponent`; the button posts `apiPost('/api/orders/checkout/', {payment_method:"wallet", ...existing delivery fields, ...coupon})` once (guarded like `payReady`); `201` → existing confirmation; refusals `insufficient_funds` / `ledger_off` show the server `detail` in `checkoutError` and leave the cart. **MoMo:** unchanged flow (`PaymentComponent` then `handlePaymentSuccess`) but the post body adds `payment_method:"momo"` only when the picker is shown (ledger on). The confirmation shows "Payment processing" from the order's `payment_processing` when present and non-zero. The staff gate (`staffGate.blocked()`) stays first in both paths.
- `MoMoPayment` (in `App.jsx`) gains an optional prop `processing` (a server GH₵ string). `processing === undefined` keeps today's behaviour byte for byte (the simulated 1.5% line, `MoMoPayment.test.jsx` unchanged); a string replaces the fee: label "Payment processing", value the string, total = amount + that string, no "(1.5%)". `CartDrawer` passes the processing value it fetched; other call sites pass nothing. The 1.5% is a pre-ledger simulation placeholder; this task stops it contradicting the server once the ledger is on.

- [ ] **Step 1: Failing tests.** `PaymentMethodPicker.test.jsx`: `test_ledger_off_shows_only_mobile_money`, `test_wallet_option_shows_the_balance`, `test_wallet_disabled_when_balance_is_short`, `test_processing_line_for_momo_only`, `test_choosing_wallet_hides_the_processing_line`. `CartDrawer.wallet.test.jsx`: `test_wallet_order_posts_payment_method_wallet_without_opening_the_momo_modal`, `test_double_click_posts_once`, `test_insufficient_funds_shows_the_server_detail_and_keeps_the_cart`, `test_ledger_off_checkout_is_unchanged` (existing flow, no picker), `test_momo_post_carries_payment_method_momo_when_ledger_on`, `test_staff_session_still_gets_the_staff_notice`, `test_momo_modal_has_no_made_up_fee_when_the_ledger_is_on` (and `test_momo_modal_keeps_the_simulated_fee_when_processing_is_undefined` pinning `MoMoPayment.test.jsx` behaviour).
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/wallet/__tests__/PaymentMethodPicker.test.jsx components/__tests__/CartDrawer.wallet.test.jsx`.
- [ ] **Step 3: Implement.** Keep `CartDrawer.test.jsx` and `MoMoPayment.test.jsx` green without edits (they run with the ledger off; the default MSW `GET /api/wallet/` from Task 1 is on, so `CartDrawer.test.jsx` handlers set `409 ledger_off` for the wallet endpoints in its setup if the picker would otherwise change its assertions: do that in the test's setup, not by weakening an assertion).
- [ ] **Step 4: Run to pass**, then the full suite.
- [ ] **Step 5: Commit** — `feat(checkout): pay from the AshantiHub wallet and show the server's payment-processing charge`.

### Task 7: Vendor Payouts tab

**Files:**
- Create: `frontend/components/wallet/VendorPayouts.jsx`, test `frontend/components/wallet/__tests__/VendorPayouts.test.jsx`
- Modify: `frontend/components/dashboard/BusinessCommandCenter.jsx` (`TABS` and the tab switch)

**Interfaces:**
- `VendorPayouts()` — `tone="dashboard"`; sections in order: `BalanceSummary` (Pending/Available, negative note), `DestinationsList` + `AddDestinationForm canCopyFromProfile`, `WithdrawForm`, `WithdrawalHistory`, `TransactionsList` (no `orderHref`). Intro line: "Withdrawals go only to a payout number whose account name matches your registered name." No cap meter, sales table, export or fee page (Plan 4F).
- `TABS` gains `{ id: "payouts", icon: "🏦", label: "Payouts" }` after `"payments"`; `{tab === "payouts" && <VendorPayouts />}`. Ledger off: the tab shows the off state (one honest line), never hidden by a client switch.

- [ ] **Step 1: Failing tests.** `VendorPayouts.test.jsx`: `test_shows_pending_and_available`, `test_negative_available_blocks_the_form_copy`, `test_registered_details_button_posts_from_profile_through_step_up`, `test_withdraw_uses_the_vendor_base_path_default`, `test_ledger_off_shows_one_line`, `test_no_cap_meter_or_export_controls`. Also assert in `BusinessDashboard.test.jsx`'s existing tab-order test only if it lists tab labels (read it first; adding a tab there is the intentional edit, with the reason "Payouts tab added by wallet 3F"); otherwise leave it untouched.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/wallet/__tests__/VendorPayouts.test.jsx components/dashboard`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then the full suite (`BusinessDashboard.test.jsx` green).
- [ ] **Step 5: Commit** — `feat(wallet): vendor payouts tab`.

### Task 8: Staff Wallets list

**Files:**
- Create: `frontend/hooks/useStaffWallets.js`, `frontend/components/admin/panels/WalletsPanel.jsx`, tests `frontend/components/admin/panels/__tests__/WalletsPanel.test.jsx`
- Modify: `frontend/components/admin/AdminCommandCenter.jsx` (import and `activeTab === "wallets"`), `frontend/components/admin/shell/navModel.js` (`NAV_ITEMS` entry, Super Admin Money group), `frontend/components/admin/shell/__tests__/navModel.test.js` (the one intentional edit)

**Interfaces:**
- `useStaffWallets({ kind, page, enabled })` → `GET /api/wallet/staff/wallets/?kind=customer|vendor|rider&page=`, key `['staff-wallets', kind, page]`, DRF envelope (read `data.results`). Rows: customer `{holder_id, name, balance}`, vendor `{holder_id, name, pending, available}`, rider as `rider_rows` (read `views_staff.rider_rows` in Step 0 and pass its fields through; show only fields present).
- `WalletsPanel({ auth })` — preamble copied from `EscrowLedgerPanel` (`Title`, `D`, `page`, `panelStyles`); three pills Customers / Vendors / Riders; table of name, balance or Pending and Available; a vendor with negative Available is flagged "Below zero" with text, not colour alone; "Load more" follows `next`; a **Refresh** button; `ledger_off` → the off state; a 403 shows `walletMessage`. Read-only: no balance edit exists. Shown to `wallets.view`.
- Nav: `{ id: "wallets", icon: "👛", label: "Wallets", show: (auth) => auth.hasPermission("wallets.view") }`; Super Admin `money` group gains `"wallets"` (the Accountant sees it under "More tools", F2). Group label rule: "Wallets" must not equal its group label ("Money"): fine.

- [ ] **Step 1: Failing tests.** `WalletsPanel.test.jsx`: `test_customers_tab_lists_name_and_balance`, `test_vendors_tab_lists_pending_and_available_and_flags_below_zero`, `test_riders_tab_passes_through_the_servers_fields_only`, `test_load_more_follows_next`, `test_ledger_off_state`, `test_no_edit_controls`, `test_panel_is_hidden_without_wallets_view` (nav `show`). In `navModel.test.js` update the Super Admin Money group expectation (line ~467) to include `'Wallets'`, and add `test_accountant_reaches_wallets_under_more_tools`; `accountingNav.test.js` and `StaffDashboard.test.jsx` (menu list at ~line 66) must stay green: if `StaffDashboard.test.jsx` lists Super Admin's Money items, add `'Wallets'` there too, stating "wallet 3F added the item" in the commit.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/admin/panels/__tests__/WalletsPanel.test.jsx components/admin/shell StaffDashboard.test.jsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then the full suite and `node scripts/staff-layout-audit.js` if it runs offline (otherwise the manual phone-width check in Task 10).
- [ ] **Step 5: Commit** — `feat(staff): wallets list`.

### Task 9: Staff Withdrawals queue, two-person resolution, and Reconciliation

**Files:**
- Create: `frontend/hooks/useStaffWithdrawals.js`, `frontend/hooks/useWalletReconciliation.js`, `frontend/components/admin/panels/WithdrawalsPanel.jsx`, `frontend/components/admin/panels/WalletReconciliationPanel.jsx`, tests `WithdrawalsPanel.test.jsx`, `WalletReconciliationPanel.test.jsx` (in `frontend/components/admin/panels/__tests__/`)
- Modify: `frontend/components/admin/AdminCommandCenter.jsx` (`withdrawals` tab; `reconciliation` tab renders the new panel with the old stub as fallback), `frontend/components/admin/shell/navModel.js` (`withdrawals` item, Super Admin Money group), `navModel.test.js` (intentional edit as Task 8)

**Interfaces:**
- `useStaffWithdrawals({ status, page })` → `GET /api/wallet/staff/withdrawals/?status=open|succeeded|failed|cancelled|all&page=`, key `['staff-withdrawals', status, page]`, envelope; rows are `withdrawals.row` plus `holder_type, holder_id, holder_name, provider, provider_reference, submitted_at, stuck`. `useWalletReconciliation()` → `GET /api/wallet/staff/reconciliation/` → `{results:[{day, provider, status, status_label, ledger_in, statement_in, ledger_out, statement_out, in_transit, in_transit_note, unavailable_checks, statement_source, differences, fraud_case_id, ran_at}]}` (not paginated).
- `WithdrawalsPanel({ auth })` — status pills (default **Open**); table: reference, holder name and type, amount, charge, status label, masked destination, submitted time, a **Stuck** chip (text) when `stuck`. Row action **Resolve…** only for `stuck` rows and only with `wallets.manage`: a sheet with outcome (Failed / Paid), evidence text (required, 10+ characters, counted), a plain-words consequence ("Failed returns GH₵ x to the holder's balance. Paid records it as paid. A second approver must confirm; nothing changes until then."), and **Send for approval** → `apiPost('/api/wallet/staff/withdrawals/{id}/resolve/', {outcome, evidence})` (password re-entry is automatic: `sudo_required` is handled by `SudoPrompt`). Success shows "Sent for approval (request A-{approval_id}). A second person must approve it in Approvals." Refusals show `walletMessage` for `provider_unreachable`, `provider_processing`, `provider_answered`, `provider_changed`, `amount_case_open`, `not_stuck`, `own_withdrawal`. Before 7C: posts `.../fail/` with `{reason}` and the success line says "Failed and returned" (F3). No Approve button here; approval lives in `ApprovalsPanel`.
- `WalletReconciliationPanel({ fallback })` — the last 30 runs newest first: day, `status_label`, ledger in/out vs statement in/out, in transit with its `in_transit_note`, `statement_source` text always visible (so the simulated source is never mistaken for a bank statement), `unavailable_checks` listed as "Not checked: …", `differences` rendered generically (key and value as sent, numbers masked as sent), a link to the fraud case when `fraud_case_id`; a Refresh button; on `ledger_off` renders `fallback` (the existing `ReconciliationPanel`, so `SettingsScreens.test.jsx` stays as it is).
- Nav: `{ id: "withdrawals", icon: "💸", label: "Withdrawals", show: (auth) => auth.hasPermission("wallets.view") }`.

- [ ] **Step 1: Failing tests.** `WithdrawalsPanel.test.jsx`: `test_open_is_the_default_filter`, `test_staff_withdrawal_rows_show_masked_destination_and_holder_name`, `test_stuck_rows_get_a_text_chip`, `test_resolve_submits_a_request_not_a_fail`, `test_evidence_under_ten_characters_is_not_sent`, `test_resolve_needs_wallets_manage`, `test_each_refusal_code_shows_its_server_detail`, `test_success_points_to_the_approvals_screen`, `test_no_direct_fail_or_approve_button_exists`, `test_pre_7c_fail_door_is_used_when_resolve_is_404` (MSW 404 on `resolve/`, fallback to `fail/` with `{reason}`), `test_ledger_off_state`. `WalletReconciliationPanel.test.jsx`: `test_runs_listed_newest_first_with_ledger_and_statement_figures`, `test_simulated_source_is_always_stated`, `test_unavailable_checks_are_listed_not_hidden`, `test_differences_render_as_sent`, `test_ledger_off_renders_the_fallback_stub`. Confirm `SettingsScreens.test.jsx` "Reconciliation says it needs Hubtel…" still passes untouched.
- [ ] **Step 2: Run to see them fail** — `cd frontend && npx vitest run components/admin/panels/__tests__/WithdrawalsPanel.test.jsx components/admin/panels/__tests__/WalletReconciliationPanel.test.jsx`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to pass**, then the full suite.
- [ ] **Step 5: Commit** — `feat(staff): withdrawals queue with two-person resolution, and wallet reconciliation`.

### Task 10: Closeout — conformance sweep, switch-on checklist, docs

**Files:**
- Create: `frontend/components/wallet/__tests__/WalletNoInventionSweep.test.jsx`
- Modify: `frontend/CLAUDE.md` (a "Wallet screens" bullet group), `docs/IMPLEMENTATION_INSTRUCTIONS.md` (mark 3F built, list what remains: Plan 4 tabs, 4F, 5F), `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` (3F status line and the gate bullets below)

- [ ] **Step 1: Failing sweep test.** Renders `TopUpForm`, `BalanceSummary`, `TransactionsList`, `DestinationsList`, `WithdrawForm`, `WithdrawalHistory`, `PaymentMethodPicker`, `VendorPayouts`, `WalletsPanel`, `WithdrawalsPanel` with default MSW data (one populated variant) and asserts across all: no `a[href^="tel:"]`, no `wa.me`; no text matching `/card number|CVV|expiry/i`; no element whose text is a bare 10+ digit run; every amount element has `font-variant-numeric: tabular-nums`; no gold (`#D4A017`) on an amount element; the literal `"1.5%"` appears nowhere; nothing renders `NaN` or `undefined`.
- [ ] **Step 2: Run to see it fail** (or pass after real findings are fixed) — `cd frontend && npx vitest run components/wallet/__tests__/WalletNoInventionSweep.test.jsx`.
- [ ] **Step 3: Fix findings, then verify.**
  - Full frontend suite from `frontend/`; `npm run build`.
  - **Gate checks (read, record the result in the spec's 3F status line, fix only inside 3F's files):** (a) Plan 2F's recovery-contact screens handle `step_up_required` from `customers/me/secondary-email/` and `secondary-phone/` (gate (xxiv)): `grep -n "secondary-email\|secondary-phone" frontend/hooks/useAuth.js frontend/components` and trigger each in a test or by hand; if they fail, that is 2F's, record "blocked on 2F". (b) Registration's payout step (`submitPayoutInfo`) still uses the unforced `PATCH business-owners/me/payout/` (gate (xxxii)): leave it, record that forcing it needs a step-up in registration first. (c) Dispute and delivery refunds send no customer notice (gate (xvi)): record "needs a backend notification; the statement row is the notice". (d) Switch-on checklist adds: Plan 4 Tasks 14-15 shipped (F5); stale "no money moves" copy in `RefundsPanel.jsx` (`SimulatedBanner` text) and `LaterPhasePanels.jsx` branches on the ledger (gates (xiii), (xxxi)) - **not changed here**, listed.
  - Manual: each new screen at 360, 768 and 1280 px for horizontal overflow and `DESIGN.md` conformance; the staff panels against `scripts/staff-layout-audit.js`; one real-phone pass of the step-up prompt over the withdraw form; a staging run of top-up, pay-from-wallet, add a number, withdraw, and a stuck-withdrawal resolution by two staff accounts on the simulated provider (`SIMULATED_PAYOUT_OUTCOME=pending`).
  - Backend regression is not touched; if `docker compose run --rm web python manage.py test wallets orders` is run for confidence it must be green.
- [ ] **Step 4: Commit** — `docs(wallet): 3F closeout, conformance sweep and switch-on checklist`.
- [ ] **Step 5: Stop.** Deploy to staging only on the user's go-ahead via the `deploy` skill; production only on an explicit "promote to production".

## Self-review

**Spec and gate coverage:**

| Requirement | Task |
|---|---|
| 3a row: wallet screen (balance, statement, top-up with processing line) | 1-3 (components); tabs in Plan 4 |
| 3a row: pay from wallet at checkout | 6 |
| 3a row: refund notices | 3 (statement notice), 10 (gap (xvi)) |
| 3a row: staff wallet list | 8 |
| 3b row: destinations (add with step-up, masked list, "can receive money from") | 4 |
| 3b row: withdrawal form with charge and "you receive", history | 5 |
| 3b row: staff withdrawals queue and reconciliation screen | 9 |
| Gate (ix)/(xiii) honest processing line, no made-up fee | 2, 6 |
| Gates (xxiv), (xxxii), (xvi), (xxxi) checked and recorded | 10 |
| 7C T3 top-up hold (balance line, `topup_held`) | 2, 5 |
| 7C T4 two-person resolution | 9 |
| 7C T5 staff edits of payout details need maker-checker | **No screen in 3F:** staff cannot edit payout contacts or names from any current staff screen (`UsersPanel` edits are `users.manage`, not wallet); when 7C's `wallets.holder_details_edit` request is created it appears in Approvals by `kind_label`. Verified in Task 10 by listing the Approvals entry in a test fixture. |
| 7C ruling: withdrawal events show the amount | 5 (`test_history_rows_show_the_amount`); the notices are the server's |
| Owner ruling: Support holds no wallet screens | F1 |
| Vendor withdraw/destinations | 7 |
| Rider mounting | Plan 5F (components take `basePath`) |

**Name consistency:** hooks `useWallet`, `useVendorWalletOverview`, `useWalletTransactions`, `useWalletProcessing`, `useWalletDestinations`, `useWithdrawals`, `useStaffWallets`, `useStaffWithdrawals`, `useWalletReconciliation`; helpers `walletMessage`, `refusalCode`, `isPlausibleAmount`, `formatGhs`, `pesewasToGhs`, `newRequestId`, `walletStyles(tone)`; components as in File Structure; endpoints exactly those in `backend/wallets/urls.py`; header `X-Step-Up-Token` owned by 2F; actions `payout_destination`, `withdrawal` (3b `step_up`).

**Open points the executor must resolve in Step 0 of the named task:** 2F's exported handler name (Task 1); the rider-row field list (Task 8); whether 7C's `resolve/` and wallet-payload fields are merged (Tasks 2, 5, 9).

# backend/ — conventions and gotchas

Conventions that differ from the Django/DRF default, and failure contracts the code alone
would not teach. App structure, models, serializers and URLs are derivable — read them.

## Moderated-queue contract

Every moderated queue (`BusinessOwner`, `Listing`, `HeroMediaSubmission`, `Event`,
`SubscriptionPlan`, `Review`) follows the same backend shape, and new ones should too:

- Keep the historical `.../pending/` URL; add a module-level `X_STATUS_MAP` and a
  `get_queryset()` reading `?status=`, defaulting to `pending` and **falling back to pending on an
  unknown value rather than erroring**.
- Pending orders oldest-first; history orders `-reviewed_at` with a `-created_at`/`-id` fallback
  for rows actioned before the queue existed.
- Approve and reject both set `reviewed_by=request.user` and `reviewed_at=timezone.now()`.
- `XReReviewView` at `.../<int:pk>/re-review/` 400s unless the row is currently rejected, then
  clears the reason and the reviewer pair.
- Exceptions worth knowing: `Event` keeps `approved_by` *alongside* `reviewed_by` (approved_by
  survives a later rejection); `Dispute` has no `reviewed_*` pair and uses
  `flagged_by`/`resolved_by`/`resolution_notes` + `updated_at` instead; `Review`'s `hidden` status
  doubles as "rejected", which is why `hidden_reason`/`hidden_by` kept those names.

## Correctness cores — change with care

- **`bookings/availability.py`.** Half-open `[check_in, check_out)` date ranges, per-night unit
  availability enforced against `Listing.units_total`, rejected 409 if any night would exceed
  capacity. Only `ACTIVE_STATUSES` (pending/confirmed/checked_in) hold inventory, so a cancel or
  check-out frees the dates. The server re-checks and re-prices under a row lock.
- **Staff permissions: effective = role.permissions + extra_permissions − revoked_permissions**,
  computed by `StaffUser.effective_permission_codenames()`. `HasRolePermission`,
  `HasAnyRolePermission`, **and** `GET /api/accounts/me/`'s `permissions` list must all read that
  one method — if they diverge, the UI gates on a different set than the server enforces.
  `StaffListSerializer` exposes `role_permissions` alongside the effective set so the permission
  editor can tell an individual grant from a role grant (an effective-set-only view would let
  `.set([])` silently clear one).
- **Payout account and MoMo numbers are stored unmasked.** `accounts/serializers.py`'s
  `mask_but_last()` is the **only** way they ever leave the server, always masked: in
  `StaffBusinessOwnerDetailSerializer.get_profile`, and for wallet payout destinations in
  `wallets.destinations.row` (every holder and staff response, withdrawals included). Never put one in a log line, an
  activity body, a fraud case or a notice; `account_number` is in Sentry's denylist. Don't add another path.
- **Stock is reserved at checkout, not at payment.** `OrderCheckoutView` decrements
  `Listing.stock_quantity` with a 400 oversell guard before creating anything; a
  `stock_quantity=None` listing is untracked and never decremented. `_fail_order_checkout` in
  `payments/services.py`'s `FAILURE_HANDLERS` rolls the reservation back on a failed payment.
- **`GET /api/orders/owner/` must never leak another business's lines.** `OwnerOrderSerializer`
  exposes only the caller's own line items and an `owner_subtotal` over just those — a shared
  order can span multiple businesses. Same rule for the sales report and its CSV export.
- **Promotions: "expired" is derived from the time window** (`status=active AND ends_at < now`),
  never read off `status` — nothing in this app ever transitions a finished promotion, so a
  status-based filter would show an empty Expired tab forever.
- **The activity log is append-only and hash-chained.** `activity.services.record()` is the only
  writer; Postgres triggers refuse `UPDATE`/`DELETE` on `activity_activityevent`, and
  `verify_activity_chain` re-checks the SHA-256 chain nightly. `StaffActivityMiddleware` wraps
  every authenticated staff write in a transaction and records it, so a new staff endpoint is
  covered automatically. The client IP is taken from nginx's `X-Real-IP` and canonicalised (invalid
  is stored blank); secrets in request bodies are redacted before storing — see `SECRET_MARKERS`
  and the exact-key/suffix rules in `activity/services.py` (bare `code`/`pin` and `*_code`/`*_pin`
  keys are redacted, `codename(s)` is not); call `record()` yourself (inside the same transaction, and last, because
  it holds a global advisory lock until commit) when you have a richer before/after story — it
  marks the request so the middleware doesn't duplicate it.
- **Team managers act only on their direct reports.** `staff.invite_team` (Operations, Delivery
  Manager) is checked with `_guard_team_scope`; anything beyond invite/resend/suspend/unsuspend
  stays `staff.manage`. Only someone who can lead a team — a Super Admin, or anyone whose
  effective permissions hold `staff.invite_team` — can be set as a manager, by `StaffManagerView` or an
  invite's `manager` field; both use `accounts.permissions.can_lead_team`.
- **Staff sessions are server-side.** Every staff JWT names a `StaffSession` by its `jti`;
  `MultiAccountJWTAuthentication` refuses revoked, idle (30 min) and expired (12 h) sessions and
  writes `last_seen_at` at most once a minute. In tests mint staff tokens with `issue_token()` or
  `accounts.testing.staff_token(staff, sudo=True)` — a hand-built `AccessToken` has no session and
  401s. Ending sessions goes through `accounts.sessions.revoke()`/`revoke_all()`, which also drop
  the live socket.
- **Sensitive staff actions need the password again.** List `RequiresSudo()` after the role
  permission in `get_permissions`, or call `accounts.sessions.require_sudo(request)` for a
  conditional case. It answers `403 {"code": "sudo_required"}`, which the frontend turns into a
  password prompt and one retry.
- **2-step challenges are bound to their stage and to a fingerprint of the password hash**
  (`accounts/two_factor.py`), so changing or resetting the password kills every open challenge. An
  expired challenge (5 min) answers `code: "challenge_expired"`.
- **Approvals: the maker never decides.** A new kind registers an `ApprovalKind` in its app's
  `ready()`; `approvals.services.submit()` is the only way in, and `approve()` re-reads the target,
  refuses a stale one (409) and runs `apply` inside the decision's transaction. Lock order is the
  approval row, then the target (advisory lock `TARGET_LOCK_NAMESPACE`), then the activity chain
  lock; keep it. A crash inside `apply` is converted to `ApplyFailed`.
- **Report state changes go through `reports.services._locked`** (row lock). The first submission
  fixes `is_late` and `submitted_at`; a resubmission after a return never changes them.
- **`?format=` is DRF's renderer override.** An endpoint taking `?format=csv|xlsx|pdf` must set
  `content_negotiation_class = reports.exports.ExportNegotiation`, or DRF answers 404 before the
  view runs.
- **Exports:** a job claims its row (QUEUED to RUNNING) exactly once, so a redelivered task is a
  no-op; `reap_stuck_exports` fails rows stuck QUEUED/RUNNING. Every later status change is guarded
  by the status it expects (the job finishes only a RUNNING row, `fail_export` only an unfinished
  one) and notifies only if it moved the row, so a reaped export never flips back to READY or gets
  two notices. Partials are named `<export id>-<uuid>.partial`; the reaper deletes only its rows'. A PDF above `PDF_SYNC_ROWS` (200)
  is built by the job, not in the request. WeasyPrint runs with a URL fetcher that refuses every
  URL (report text is user-written). Sudo is required by scope: `exports.reaches_others()`.
- **Background jobs and live updates run in-process under `manage.py test`** (eager Celery,
  in-memory channel layer, local-memory `realtime` cache). On-commit work needs
  `captureOnCommitCallbacks(execute=True)` in a `TestCase`; consumer tests that read the database
  need `TransactionTestCase` with `serialized_rollback = True`.
- **Live updates come from the activity log.** `realtime.publish.publish_activity` runs on commit
  of every `ActivityEvent`; a queue that should refresh live goes in `QUEUE_INVALIDATIONS`. Feed
  events reach only staff who could read that event through `GET /api/activity/`; permission
  groups get query keys, never labels. An `APIView` with `activity_exempt = True` is skipped by the
  activity middleware (the realtime ticket, the registration check, and views that record their
  own event so a raw body never reaches the log: the owner claim and the staff edit of a business
  owner's details). Publishing goes through one bounded
  `_group_send` (2 s), so a dead Redis cannot hang a request; a ticket the cache can't issue
  answers 503. With `DJANGO_DEBUG=False` (outside `manage.py test`) the settings refuse to load
  without a `redis://`/`rediss://` `REDIS_URL`. Activity bodies have NUL stripped
  before hashing (Postgres text cannot hold it).
- **A business is a `BusinessOwner` plus its `BusinessOwnerProfile`** - there is no Business
  model. Show `BusinessOwner.display_name` (business name, else the owner's name). A scout-
  registered owner (`registration_channel = "scout"`) has an unusable password until they claim
  their login (`needs_claim`); `compute_registration_step()` treats that channel differently.
- **Phones are compared by their last 9 digits.** Write owner phones through
  `accounts.phones.normalize_gh_phone()` (`+233...`) and match stored phones only through
  `phone_key()` / `filter_by_phone()` (there is no `phone_match_q`), because older rows hold
  whatever owners typed.
- **Hidden businesses:** a suspended owner - or, only while `SUBSCRIPTION_PAUSE_ENABLED` is on, one
  whose subscription is paused - is hidden from public browse by
  `listings.visibility.hidden_business_q()`. Every public listing or event queryset, and adding to
  a cart, must use it.
- **The subscription clock** (`billing.clock`, hourly) marks overdue, reminds on days 7 and 13 and,
  only with `settings.SUBSCRIPTION_PAUSE_ENABLED` on, pauses at day 15. The setting (env, default
  **off**) stays off until real payments (the planned in-app wallet) can renew automatically.
  Turning it on pauses every subscription already 14+ days overdue on the next hourly run, and
  those owners were never warned about hiding - switch it on only together with automatic
  renewal, or first reset `overdue_since` to the switch-on time. While it is off, nothing is
  paused or hidden, `subscription_state()` never reads `"paused"` (it carries `pause_enabled`, and
  `overdue_day` isn't capped at 14), and no notice, email, task or screen counts down to a pause
  or mentions hiding - branch on `billing.clock.pause_enabled()`. Only
  `payments.services._finalize_subscription` (a real payment) clears the clock, through
  `billing.clock.clear_after_payment()`; `POST /api/billing/subscriptions/me/` must never.
- **KYC goes through `accounts.kyc`.** The KYC queue and the `business.kyc` approval share
  `approve_owner()` / `reject_owner()`; a queue decision settles the pending request with
  `approvals.services.close_pending_for_target()` (never by running `apply` again). `approve()`
  sets `decided_by` before `apply`, so an `apply` may read it. No KYC submitter
  (`accounts.kyc.is_kyc_submitter` - extend it, never copy it) decides its KYC through either
  door, Super Admin included (403, `kyc.OWN_REGISTRATION`), or records its Ghana Post address
  decision: the registrar, the current account manager, the maker of any
  `business.kyc`/`business.update` request for it, any staff member who edited the owner's details
  directly (`PATCH business-owners/{id}/` records `business_owner.details_changed` with only the
  changed fields, payout numbers and TIN masked by `accounts.serializers.owner_details_change`; a
  PATCH that changes nothing records nothing), and a field scout who corrected the address (one
  who only confirmed it is not). A correction rewrites `gps_address` and clears the address
  decision, so someone else re-checks it - a lead through address-verify or another scout's later
  visit; `GET kyc/{id}/` and the review sheet show it as `address_correction`.
  `kyc.address_decision_missing()` makes a scout-channel business, or any business with a field
  correction, wait for the Ghana Post address decision before KYC approval through either door. A
  scout's `business.update` that changes `gps_address` clears that decision too (kept in
  `AppliedChange.result`; an undo puts it back with the address).
- **Scout changes are approval kinds** in `portfolio.approval_kinds.KINDS` (registered in
  `PortfolioConfig.ready()`); only the business's account manager may submit them; each applied
  change writes a `portfolio.AppliedChange` the owner can undo for 7 days
  (`portfolio.undo.undo_change`), which always opens a fraud case. `email` / `login_phone` are
  proposable only while the owner `needs_claim`, and a proposed email or phone that belongs to
  staff is refused. Deactivating a scout counts only their non-rejected managed businesses.
- **Owner claim tokens** (`accounts.claims`) are stored as SHA-256 hashes; a hand-over token works
  only on the scout session that started it; the claim view is `activity_exempt` and records
  `business.claimed` itself, so the password never reaches the activity log. The claim strips
  password edge spaces (sign-in trims them), and password reset sends nothing to an owner who
  `needs_claim` - they must claim, so that consent is recorded. A staff member's email is refused
  as an owner's email at registration and at the claim (resets go there). Lock order in `claim()`
  is owner, then token, as when issuing one. Sentry's scrubber (`ashantihub/sentry.py`) holds the
  claim secrets' field names - add any new secret field there.
- **Fraud cases** come from `fraud.services.raise_flag()` (use a `dedupe_key` for system checks).
  Confirming runs the hooks in `fraud.services.ON_CONFIRMED`; plan 2B adds commission reversal
  there. The realtime `fraud.` row also invalidates `kyc-queue` and `portfolio-business`.

- **Marketing sends are gated server-side, in `marketing/campaigns.py` and `dispatch.py`.** A
  recipient is re-checked at send time for a live opt-in (`consent.is_opted_in`), the per-person cap
  and the sending window; the provider answers `not_connected`/`simulated`/`connected`
  (`marketing/providers`), and **delivery, cost and Meta/network outcomes exist only when a provider
  or a person recorded them** (`SenderId`, `Template.meta_status`, `ProviderStep` are hand-kept).
  A campaign over the GH₵ limit (or with no known price) is a `marketing.campaign` approval, Super
  Admin only. Coupon failures all answer `checkout.INVALID_CODE`, and failed lookups are throttled in
  `marketing/code_guard.py`; never reintroduce a more specific message.

- **Distances come from `routing.service`.** Never call `delivery.services.distance_estimate_km` for a figure shown to a user; use `routing.service.leg`/`legs_from`/`legs_between`, which return the road route or the labelled estimate (`basis`). Only `routing/client.py` talks to OSRM and converts lat/lng to lng/lat. The one exception until stage 2: `delivery.dispatching.rank` (the Dispatch queue ranking and its radius check) still uses the straight-line estimate and says so in its `distance_basis`. The service area is `routing.region.in_service_area` (an approximate rectangle, see its docstring).
- **Multi-stop delivery.** Stop codes and wrong tries live on `PickupStop`; stop 1 is mirrored into the assignment's legacy fields (deliveries assigned before the release keep one stop and the old code). `stops.stops_of` never writes; write paths call `ensure_stops` first and must not prefetch `stops` on a locked row. Skip evidence (rider pin, time, note) lives on the append-only `skipped_stop` `DeliveryEvent` rows and survives a reset; a job with every shop skipped fails as `all_stops_skipped` and is requeued by resetting the same OneToOne row.
- **The ledger (`ledger/`) is append-only and integer-pesewa.** A balance changes only inside `ledger.posting.post`
  (balanced, idempotent on its key, accounts locked in primary-key order); Postgres triggers refuse `UPDATE`/`DELETE`
  on journals and lines, so a correction is a new reversing journal. Convert money only through `ledger.money`. Fees
  are snapshotted per order, vendor and category at payment (`OrderFeeSnapshot`): release reads the snapshot, never the
  rules now, and `fees.quote` caps a fee at its line value. **No timer releases a vendor's money:** release happens only
  on Support's positive call, `ledger.verification.record`, after the goods reached the customer (rider delivery or
  pickup-desk collection) and the receipt is confirmed. With the ledger on, `verification.record` answers 409 and rolls
  back if a verified order could not be released. The customer's phone appears only on the `orders.verify`-gated
  Support list, never on the Pickup Desk queue. Fee rules and money settings change only through the
  `ledger.fee_rules` / `ledger.setting` approval kinds (Super Admin approves; Accounting proposes). `LEDGER_ENABLED`
  (default off) gates all recording, and `SUBSCRIPTIONS_ENABLED` (default on) must stay on until the frontend
  registration change (Plan 1F) ships. Held customer money is exactly Σ Vendor Pending + Σ Delivery payable (no
  order-escrow account). Follow-ups before flipping `SUBSCRIPTIONS_ENABLED` / `LEDGER_ENABLED` live are in
  `docs/superpowers/specs/2026-10-15-wallet-fees-security-design.md` section 13.
- **Wallets, payments and refunds (`wallets/`, `ledger/refunds.py`, `payments/providers.py`).** Behind `LEDGER_ENABLED`
  like the rest of the ledger: with it off every `/api/wallet/` endpoint answers `409 ledger_off` and checkout, cancel,
  dispute and approval responses are exactly as before. A customer pays by MoMo (`payment_method` `momo`, the default)
  or from the wallet (`wallet`: the payment journal debits `customer_wallet` instead of provider clearing; a wallet must
  cover the whole order, else `409 insufficient_funds` and the checkout rolls back). The provider's collection charge
  is paid on top of MoMo payments and top-ups (`CheckoutSession.processing_fee`, "payment processing"); the ledger
  records only the net. Refunds always go to the wallet through `ledger.refunds.refund_order` (one `OrderRefund` per
  order and source, e.g. `dispute-<id>`, so never twice), per fee snapshot (`refunded_base_pesewas` /
  `refunded_fee_pesewas`, `reversed_at` when whole), which frees the lifetime cap; release pays only what is left and
  never a cancelled order; after release the vendor's Available is debited (may go negative) and the fee returned in
  proportion; the delivery fee comes back only with the whole order; the collection charge only on a platform/vendor
  error (its proportional share on a partial refund). Release (and Support's "matches") also waits while a
  delivery-case refund is pending the Super Admin's approval (`escrow.has_pending_refund`; with the ledger off Support's answers are the old ones). A whole refund of an order not yet handed over also cancels it and returns its stock in the same transaction (`refunds._cancel_if_not_handed_over`), and the delivery board, pickup queue and pickup desk refuse a wholly refunded order (`refunds.is_wholly_refunded`). Support's cancel, the hourly uncollected-pickup job, dispute resolution and the delivery-case refund approval
  all call it. A business's free-delivery promo (`WaivedFeeCharge`) is taken from its Available at release. **Lock
  order for money:** the order row, its fee snapshots, then ledger accounts in primary-key order taken up front with
  `posting.lock` in one sorted pass, including the accounts of a second posting in the same transaction (the promo
  charge at release, the promo return on a whole refund; `posting.post` takes them the same way). `collect` is `payments.services.process_payment` and
  `handle_webhook` is `HubtelWebhookView` (both unchanged); the Hubtel provider's payout, status and name lookup raise
  `NotConnected` until Plan 7.
- **Payout destinations, withdrawals, reconciliation (`wallets/`, Stage 3b).** A destination is accepted only when the
  provider's account name matches the holder's verified name (`wallets.names`: customer profile name, which is
  self-declared, spec §13 (xxix); KYC-verified vendor's owner or business name) and a step-up code is spent; the name
  lookup runs before that transaction (`destinations.check`, then `save`). It can receive money after
  `payout_cooling_hours`, is never edited (remove + add), and every add and remove sends the holder a notice.
  Destination add/remove and withdrawals call `step_up.require(..., force=True)`, and adding a customer recovery email
  or phone calls it with `force=escrow.enabled()`: while the ledger is on they always need a code, and the step-up
  endpoints send codes for those three actions. `wallets.withdrawals.request` locks the destination, then the source
  and in-transit accounts together (`posting.lock`), then checks balance and limits (governed
  `withdrawal_per_tx_limit_pesewas` / `withdrawal_daily_limit_pesewas`, per holder account); a vendor's negative
  Available blocks it. Every hold and settlement locks the one `withdrawal_in_transit` account, so withdrawals
  serialise (throughput only). A withdrawal is claimed before the provider is called (sent once; returned instead if
  the holder was suspended or the destination removed) and ends only through `wallets.payouts.apply_result` / `close`
  (row lock, per-reference journal keys, a final status never changes, the amount the provider reports must equal what
  was sent; a report for a withdrawal never sent, a "paid" report after the money went back and a "failed" report
  after it was paid each open a fraud case and post nothing). **No provider call runs inside a transaction** (lookup,
  payout, status, statement), and the provider's own message is never stored or shown. Staff failing a stuck
  withdrawal asks the provider first and is refused (409 `provider_processing`) while it says processing or anything
  unmapped, never with an open amount case, and the holder sees only AshantiHub's fixed
  reason. The nightly `wallets.reconciliation` is read-only and compares by provider reference.
- **Services, stays and event tickets in the ledger (`ledger/sales.py`, Plan 1b).** Behind `LEDGER_ENABLED` like the
  rest. A paid service request, stay or ticket purchase is one `ledger.BookingSale` (its subject; its fee snapshot from
  the services table — stays count as services — or the events table; Support's call), recorded by the payment
  finalizers (`booking-pay-<session reference>`: Dr provider clearing or customer wallet, Cr vendor Pending). The
  lifetime cap counts sales and order snapshots together (`fees.charged_to_date`), read after the business's Pending is
  locked. Handed over = service marked done, guest checked in, a ticket scanned or the event's date passed; release only
  on Support's "matches" (`sales.record_verification`, `/api/ledger/bookings/`), with the 72-hour window counted from
  hand-over (provisional until the owner confirms it: spec gate (lvii)). Tickets for a customer-organised event stay outside the ledger (MoMo only). With the ledger on a ticket's
  escrow flag follows its sale: a scan no longer releases it, the manual release and hold answer `409 ledger_on`.
  Refunds go to the wallet through `sales.refund` (one `BookingRefund` per sale and source; the refund that empties a
  sale cancels a booking not yet handed over), wired into the customer's stay cancel, Support's booking cancel, the
  Accountant's ticket refund and dispute resolution. **Lock order:** the service request or stay row (tickets: the
  purchase's tickets in primary-key order), then the sale, then accounts in one sorted pass (`sales.lock(sale)`); the
  hand-over steps (service done, check-in, ticket scan) lock their own row. `record_verification` locks the linked
  dispute first (dispute, then subject, then sale, as disputes resolve). The three pay endpoints take
  `payment_method` and add "payment processing" on MoMo through `payments/booking_pay.py`; a service request's price
  must be above GH₵ 0.00 with at most two decimals (this check is always on, ledger on or off: spec §13 (lxvii)).
- **Pickup Desk** is the `pickup_desk` staff role with the single permission `pickup.confirm` (store-pickup queue and
  collection); only a Super Admin invites it.
- **One-time codes (`otp/`).** One OTP service for every account kind: 6-digit codes kept only as a salted HMAC
  (SHA-1, 40 hex, 32-hex salt - the attempt and lock limits, not the hash, defend the 6-digit space), 5 minutes,
  5 tries per code (a resend keeps the count), 60 s resend wait. Hourly send limits, counted from `OtpEvent` (so they
  hold across processes; failed sends count): 5 per (account, phone/email), 20 per phone/email across all accounts,
  10 per account, 60 per IP. A failed send never kills the code already delivered or starts the wait;
  `otp.senders.deliver` never raises.
  - **Guessing.** A sliding lock while 5 or more wrong codes (texted, emailed or authenticator) fall inside the last
    15 minutes; sending answers the same `try_later` as a limit. Guesses run one at a time per account in
    `otp.service.guessing()` (advisory lock; the outcome is returned from the block so the FAILED row commits, the
    refusal is raised after) - a new guess path must use it. The holder gets a link-free notice (`otp.notices`) when
    the lock engages (at most hourly) and when a recovery code signs in.
  - **Sign-in.** Public endpoints take a signed `mfa_token` (nonce + password fingerprint, 600 s), never an
    identifier; refusals are Responses, never raised - never call `otp.service.verify` inside an atomic block a
    refusal would roll back. Login views ask `otp.signin.sign_in_step()` (staff authenticators in
    `accounts.two_factor` are checked first); registration with the sign-up switch on answers
    `otp.signin.code_challenge()` directly, and refuses (400) up front when the submitted contact is unusable. An
    account that owes a code but has no phone/email on file gets `409 no_channel`; the send endpoint's "not that
    way" is `400 channel_unavailable`. A correct SIGN_UP code does not skip an enabled authenticator (it answers
    `two_factor_required`), and a code ticket stops working once an authenticator is on. A customer's secondary
    phone is never a channel (its check answers `demo_code`, spec O6). Only customers get a `device_token`; trusted
    devices die with any password change (fingerprint) and are revoked on reset; the stale-device purge uses the
    configured customer gap, not a fixed number.
  - **Step-up.** Sensitive changes call `otp.step_up.require(request, ACTION)` **inside** the `transaction.atomic()`
    that saves (a refused change keeps the token); tokens are single-use, 5 minutes, bound to the action and the
    access token's `jti` (`X-Step-Up-Token`, `403 step_up_required`). A new sensitive endpoint (password change,
    withdrawal, payout destination) must call it. Only customers and owners may ask for step-up codes (staff use
    sudo), and the endpoints answer `409 otp_off` unless a code could be owed.
  - **Recovery and rollout.** Staff recovery is the `otp.recovery` approval (Support asks, Super Admin approves; no
    text while `OTP_SMS_PROVIDER` is `simulated`); it sends a recovery-specific message plus a link-free notice to the
    account's other contacts. Three switches default off (`OTP_SIGNIN_ENFORCED`, `OTP_STEP_UP_ENFORCED`,
    `OTP_SIGNUP_VERIFICATION_ENFORCED`); turn them on only after every item in the spec's §13 "Before the OTP
    switches are turned on" (frontend Plan 2F, `OTP_SMS_PROVIDER=hubtel`, ...). An unknown `OTP_SMS_PROVIDER` fails
    the `otp.E001` system check. Texts go through `otp.senders` only (`locmem` under tests: read
    `otp.senders.sms_outbox`). Codes and device/step-up tokens are never stored or logged in clear; add any new
    secret field or local-variable name to `ashantihub/sentry.py`.
- **A business's money and texts (`wallets/vendor.py`, `vendor_texts.py`, Stage 4).** `/api/wallet/vendor/*` is
  business-owner only (a customer with the same id, or staff, gets 403: platform fees never reach a customer) and answers
  `409 ledger_off` while the ledger is off. Read-only: sale rows come from the business's own `OrderFeeSnapshot`s (never
  today's rules), the daily summary from journal lines on its own Pending and Available accounts (`vendor.FOLD`; any
  other line lands in `other`, so the columns always add up to the balance change), and no row, export or text holds a
  customer's name, phone or address. Texts to a business go through `wallets.VendorText`: `vendor_texts.queue` runs
  inside the payment (`orders.alerts`) or the release (`escrow.release_verified`, after every posting), in a savepoint,
  and never raises; the send happens after commit through `otp.senders`, claimed with a 10-minute lease, tried at most 5 times, and only to a login phone that is an `otp.VerifiedContact` (stricter than
  today's lock notices, which text every contact on the account: an open must-fix in spec §13, whose fix will make them
  VerifiedContact-only too). A provider-down breaker (cache, 120 s, after 3 failures in a row) leaves texts queued. The hand-off after commit is a lambda that logs its own errors (Django's robust `on_commit` formats
  `func.__qualname__`, which a `functools.partial` lacks).
  A business text is **never an `OtpEvent`** (those count toward the code send limits) but is counted by the
  `otp.spend` alert. Bodies are GSM-7 plain text with "GHS" (never "GH₵"), at most 306 characters. `phone` is in
  `ashantihub/sentry.py`'s denylist (the whole number is a local in `vendor_texts.deliver`). **Booking sales (Plan 1b)
  are not on these screens yet.** Their money is in Pending and Available and their fees count toward the cap (the fee
  page marks all three categories `charged`), but the sale rows, `awaiting_call`, the statement and the texts come from
  `OrderFeeSnapshot` only, and `booking_*` journal lines land in the daily summary's `other` column. A follow-up (Plan
  4F or 4b) must add `BookingSale` rows, `FOLD` kinds and texts before the ledger is turned on (spec §13 (lxxxiii)).

## Test-fixture gotcha

**Reviews are pre-moderated.** A new `Review` lands in `pending` and is invisible to the public
list view and to the `avg_rating`/`review_count` annotations, which filter on
`status="published"`. Any fixture creating a `Review` **without an explicit
`status=Review.PUBLISHED` is invisible to those aggregates** — this already broke several
rating-annotation tests.

## Commands

Run through compose; the service is named **`web`**, not `backend`:
`docker compose run --rm web python manage.py <cmd>`. On the server, target an environment via its
compose project — see the `deploy` skill.

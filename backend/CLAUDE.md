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
  `mask_but_last()` in `StaffBusinessOwnerDetailSerializer.get_profile` is the **only** place they
  ever leave the server, always masked. Don't add a second path.
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
  activity middleware (used only for the realtime ticket). Publishing goes through one bounded
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
- **Hidden businesses:** a suspended owner or one whose subscription is paused is hidden from
  public browse by `listings.visibility.hidden_business_q()`. Every public listing or event
  queryset, and adding to a cart, must use it.
- **The subscription clock** (`billing.clock`, hourly) marks overdue, reminds on days 7 and 13 and
  pauses at day 15. Only `payments.services._finalize_subscription` (a real payment) clears it,
  through `billing.clock.clear_after_payment()`; `POST /api/billing/subscriptions/me/` must never.
- **KYC goes through `accounts.kyc`.** The KYC queue and the `business.kyc` approval share
  `approve_owner()` / `reject_owner()`; a queue decision settles the pending request with
  `approvals.services.close_pending_for_target()` (never by running `apply` again). `approve()`
  sets `decided_by` before `apply`, so an `apply` may read it. The business's registrar can never
  decide its KYC through either door, Super Admin included (403) - nor record its Ghana Post
  address decision - and a scout-channel business needs the Ghana Post address decision before
  KYC approval through either door. A scout's `business.update` that changes `gps_address` clears
  that decision (kept in `AppliedChange.result`; an undo puts it back with the address).
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

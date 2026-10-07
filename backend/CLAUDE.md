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
  stays `staff.manage`.

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

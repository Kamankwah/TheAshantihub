# Remediation tracker — Architecture + Backend (review of 2026-11-06)

Source: `docs/reviews/2026-11-06-principal-review.md`. Work branch: `fix/review-arc-be` (from `righteoushack`). Nothing here is
deployed; promotion follows the `deploy` skill and the golden rule in `CLAUDE.md`.
Order of work across the review: **Architecture + Backend → Database → Frontend → Mobile.**

Status: `done` = fixed, tested, committed on the branch · `partial` = fixed as far as possible without an outside input ·
`next` / `queued` = not started · `moved` = belongs to a later track.

| ID | Sev | Finding | Recommendation | Status |
|---|---|---|---|---|
| BE-02 | P1 | Sign-in throttles bypassable by a forged `X-Forwarded-For`; per-worker memory counters; no account lockout | `NUM_PROXIES=1`; Redis-backed `throttle` cache; fail-open `ClusterScopedRateThrottle`; per-account lockout (10 / 15 min) | **done** `4041c7e5` |
| BE-03 | P1 | Payment provider fails open when `HUBTEL_CLIENT_ID` is blank | Explicit `PAYMENTS_PROVIDER`; `payments.E001–E003/W001` system checks run by every `migrate`; `create_checkout` refuses blank credentials | **done** `0f185007` — operators must set `PAYMENTS_PROVIDER=simulated` (or `hubtel`) in each server `.env` |
| BE-04 | P1 | Webhook status parser matches substrings ("Unpaid" = paid) | Exact-match normalised statuses; success needs a matching amount | **partial** `d246f96b` — server-side confirmation through Hubtel's status API is blocked on their docs / sandbox |
| BE-12 | P1 | 75 known advisories (Pillow 66, DRF 5, requests 4) | Pillow 13.0.0, DRF 3.18.2, requests 2.33.0 | **done** `92e58c43` — `pip-audit`: none |
| BE-01 | P0 | Ghana Card / certificate images in public `MEDIA_ROOT`, served by nginx with no auth | Private storage + short-lived signed URLs; random file names; move existing files; nginx deny | **done** `bd24f1e4` — run `ls /opt/ashantihub/backend/media/ghana_cards | wc -l` on the server before shipping; deploy runs `move_identity_files_private` |
| BE-05 | P2 | Checkout/booking: no idempotency key; cart read outside the transaction | Lock + re-read cart in the transaction; client `request_id` with a unique constraint | **done** `22c5e15c` |
| BE-07 | P2 | Pending checkouts/bookings/tickets never expire | Beat reaper `payments.tasks.expire_stale_checkouts` (TTL `CHECKOUT_PENDING_TTL_MINUTES`=120); a late success on a closed session is logged "PAID LATE" for manual refund | **done** |
| BE-08 | P2 | Cart not cleared after a Hubtel-confirmed order | Finalizer clears the lines the order bought | **done** |
| BE-17 | P3 | Late payment can mark a cancelled order PAID | Session failed (`not_applied=order_cancelled`), order stays cancelled, flagged for manual refund | **done** |
| BE-11 | P2 | Cart price snapshot never revalidated | Reprice at checkout, prompt on change | **done** checkout compares each line with today's price: 409 `price_changed` + refreshed snapshots, then the shopper confirms. This replaces "checkout prices from the snapshot" (ruling R33 still governs add / quantity change) — **owner to confirm**; the web/mobile checkout should show the `changes` list |
| BE-06 | P2 | Hubtel HTTP call inside a DB transaction holding row locks | `process_payment(defer_provider_call=True)` + `start_hubtel_checkout`; order checkout calls Hubtel after commit, a failure cancels the order and returns the stock (503 `payment_unavailable`) | **partial** — order checkout done; booking, ticket, event, top-up and subscription callers still call Hubtel inside their own (smaller) transactions |
| BE-09 | P2 | 12 h web tokens, no revocation, no 401 recovery | `token_version` claim; suspension check for all kinds; shorter token + refresh | **partial** `token_version` (`tv` claim) ends tokens on reset / deletion / sign-out-everywhere; suspended customers and owners refused at authentication (403 `account_suspended`). **Not done:** shorter access token + refresh and the web 401 recovery — need the web and mobile clients (frontend / mobile tracks) |
| BE-13 | P3 | Webhook row written before the signature check; edge cases | Verify first; alert on `processed=False` | **done** signature verified before anything is stored (a rejected call leaves a size-only marker); `payments.tasks.alert_unprocessed_webhooks` logs signed-but-unapplied callbacks at ERROR |
| BE-14 | P3 | Reset token plaintext + query string; weak password rule | Hash token, fragment URL, invalidate older tokens, breached-password check | **done** reset tokens SHA-256 at rest, `#fragment` link (frontend reads both), only the newest link works, common / all-digit passwords refused — live reset links issued before the deploy stop working |
| BE-16 | P3 | Staff 2FA mandatory only for Super Admin | Default-require for money/PII/approval roles | **done** `STAFF_TWO_FACTOR_DEFAULT_ROLES` (accountant, general_manager, cosigner, operations, support) required until a Super Admin saves a policy — those staff must enrol 2-step at next sign-in |
| ARC-07 | P3 | Insecure dev defaults (`ALLOWED_HOSTS=*`, CORS allow-all) | Fail closed when `DEBUG` is off | **done** `core.E001–E003` system checks (run by every `migrate`) |
| ARC-03 | P2 | Health endpoint always 200; no external monitoring | `/healthz` vs `/readyz`; uptime probe; alerts | **partial** `/api/readyz/` (DB-checked, 503 when down), `deploy.sh` waits on it, `infra/scripts/uptime_probe.sh` written — **not installed anywhere**: an external uptime service / second host is an owner action |
| ARC-02 | P2 | No CI, no enforced merge gate | GitHub Actions + branch protection | queued (needs repo admin) |
| ARC-04 | P2 | Deploy/rollback: restore-only rollback, mutable tags, migrate before swap | SHA-tagged images, migration lint, `lock_timeout` | **done** SHA-tagged images (5 kept), `rollback.sh`, `migrate` under `lock_timeout=15s`, `core/migration_lint.py` in CI. Rollback is code only; restoring data stays the pre-deploy dump |
| ARC-05 | P3 | Celery: one queue, no time limits, non-durable Redis | `money` / `slow` queues, limits, AOF | **done** `money` / `slow` / default queues with a `worker-money` service, 10-min task limits, prefetch 1, Redis AOF on a volume. Not done: `acks_late` (needs a per-task idempotency audit) |
| ARC-08 | P3 | Giant views (`OrderCheckoutView.post` 284 lines) | Extract checkout services | **partial** `orders/checkout.py` holds availability, delivery-address, price and stock-reservation steps (`_checkout` is ~120 lines shorter); fee quoting, promo pricing and order/line creation remain in the view |
| BE-18 | P4 | PII in logs, Node 20 EOL, `.env` into db/redis, docs drift | Clean up | **done** masked recipient in the mail-failure log, Node 22 for the production frontend build, `db`/`redis` containers get only their own variables, CLAUDE.md files brought up to date |
| ARC-01 / DB-01 | P0 | Backups local, untested, 0644, unalerted | — | **moved** to the Database track (first item) |
| BE-10 / DB-03 | P2 | PII plaintext at rest | — | **moved** to Database |
| BE-15 / DB-05 / DB-06 | P0/P2 | App is a Postgres superuser; ledger integrity job | — | **moved** to Database |
| ARC-06 | P3 | Single server for prod + staging | Snapshots, rebuild runbook | **moved** (owner decision on hosting) |

Verification rule for every row: a failing test first, the focused suite, then the full suite (`docker compose run --rm web
python manage.py test --parallel 4`), `pip-audit` clean, no new system-check errors.

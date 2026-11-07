# Principal Engineer Review — AshantiHub — 2026-11-06

Reviewer stance: read-only. Repo at `342254a7`, plus read-only checks on the **staging** stack. Production was not touched.
Raw evidence: `docs/reviews/evidence/` (`backend-arc/`, `database/`, `frontend/`, `mobile/`, `staging/`, `backend-arc-pip-audit.txt`).
Diagram: `docs/architecture/as-found.md`. Note `/docs` is gitignored, so none of this is committed unless you move it.

---

## 1. Executive summary

**What the system must do well.** Hold customers' and vendors' money correctly (wallet, escrow, ledger, payouts), keep national-ID and payout data private, and stay up on a single server for a Ghanaian marketplace that opened on 6 Nov 2026. Changes arrive at about 35 commits per day, by effectively one person plus AI.

**The three things most likely to stop it**
1. **One disk, one copy.** Every backup sits on the same disk as the database, nothing is copied off the server, there is no point-in-time recovery, no restore has ever been tested, and uploaded files (including ID photos) are not backed up at all.
2. **Identity documents are served to anyone with the link.** Ghana Card photos, business certificates and signboards are stored in a folder nginx serves with no authentication. I confirmed the mechanism live on staging; I did not check whether production already holds real files.
3. **The money path is safe only while its switches are off.** The ledger and withdrawal engine are well built. But the payment provider silently falls back to "simulated success" if one environment variable is blank, the Hubtel webhook treats "unpaid" as paid, and login brute-force protection can be bypassed with a forged header. Each becomes live the day wallets or Hubtel are switched on.

**Headline counts:** P0 **3** · P1 **6** · P2 **24** · P3 **25** · P4 **5** (63 findings after merging duplicates across tracks).

**Top five, in plain language**
| # | Finding | Business impact |
|---|---|---|
| 1 | DB-01 Backups are local, untested, world-readable, unalerted | One failure loses all orders, wallet records and IDs; best case 24 h of data |
| 2 | BE-01 ID documents publicly fetchable | Reportable breach under Ghana Act 843 if one URL leaks |
| 3 | DB-05 App runs as Postgres superuser | One SQL injection or leaked credential can edit the "tamper-proof" ledger |
| 4 | BE-03/BE-04 Payment fail-open and unsafe status parsing | Free orders from a typo; unpaid orders marked paid |
| 5 | MOB-01 Mobile apps cannot be force-updated or hot-fixed | The next launch crash (like the 5 Nov R8 one) costs days of store review |

**Verdict.** Fit for today's scale (staging DB is 25 MB; a 4-vCPU host is plenty). **Not yet fit to take real money or hold real ID documents** until the P0 and P1 items close. Fit for the next 18 months if the P0–P2 items are done before the wallet/ledger/Hubtel switches flip; the architecture itself (modular monolith, Postgres, Celery) is the right size and should not change. The single assumption that moves the answer most: **the date you intend to switch on `LEDGER_ENABLED` and live Hubtel**. Every gated item below must land before that date.

**Total remediation:** about **120–180 dev-days** (confidence: Medium). P0+P1 is **17–37 dev-days**, about 4–8 weeks for one developer at full capacity. See §7 for the P2 caveat.

---

## 2. Scope, access, assumptions

- **Tracks:** A Architecture, B Backend, C Database, D Frontend (web), E Mobile.
- **Access:** repo with full history; local tooling (`pip-audit`, `npm audit/outdated`, a fresh frontend build, Vitest); read-only staging (SSH host checks, read-only SQL via `BEGIN READ ONLY`, HTTP probes). No production access, no device, no store console, no Hubtel sandbox.
- **Could not verify:** production DB state and ID-file existence; production `.env` values (`DEBUG`, `ALLOWED_HOSTS`, CORS, Hubtel keys); `manage.py check --deploy` (local venv is stale: Django 5.0.9); `makemigrations --check`; backend test suite (needs Postgres); Lighthouse/CrUX on real devices; Maps key restrictions; merged Android/iOS manifests; GitHub branch protection (API returned 404); Hubtel's real status vocabulary and signature scheme; live restore timing. These are marked *unverified* in the findings.
- **Staging DB is 25 MB**, so index, N+1 and capacity findings are static reads, not measurements.
- **Assumed:** a team of one effective committer (1,469 + 222 of 1,616 commits), AI-assisted; 30% capacity on remediation by default, 100% during Phase 0.
- **Jurisdiction:** Ghana Data Protection Act 2012 (Act 843), Cybersecurity Act 2020 (Act 1038). Cards are not touched directly (Hubtel/MoMo), so PCI DSS scope is not assessed.
- **Method note:** four evidence-gathering subagents (one per track) reported; I re-verified the highest-impact claims myself (public media on staging, superuser role, no WAL archive, no `NUM_PROXIES`, fail-open provider, substring status parser, backup file modes, full `pip-audit`).

## 3. Business context and critical journeys

Marketplace for listings, bookings, events/tickets and delivery in Ashanti, with a "Contact Support" intermediary model instead of direct business contact. Users are on mid-range Android over 3G/4G. Journeys reviewed:

1. Checkout → payment → escrow/ledger → release/refund.
2. Wallet withdrawal / vendor payout.
3. Booking and ticket purchase.
4. Authentication (customer, owner, staff, mobile).
5. Hubtel payment callback.

Journey verdicts: (2) excellent; (1) excellent core, weak edges at the provider; (3) correct locking but pending holds never expire; (4) staff and OTP strong, IP throttling broken; (5) good scaffolding, unsafe parser.

## 4. Architecture as documented vs as found

See `docs/architecture/as-found.md` for the C4 diagrams and the ten-row gap list. The structure is a modular Django monolith (about 50 apps), Celery beat/worker, Channels realtime, Postgres 16, Redis, on one Hetzner CX33 hosting prod and staging. It fits a team of one. The largest drawing-vs-reality gaps: public ID media, backups, production frontend not on Vercel (no security headers), mobile client not OpenAPI-generated, cart never cleared on Hubtel success.

---

## 5. Findings

### Summary table

| ID | Sev | Title | Effort | Phase |
|---|---|---|---|---|
| DB-01 | **P0** | Backups: local-only, untested, no PITR, 0644, unalerted (also ARC-01, DB-15) | M–L | 0 |
| BE-01 | **P0** | ID documents served publicly by nginx (also DB-02) | M | 0 |
| DB-05 | **P0** | App connects to Postgres as superuser (also BE-15, DB-06 part) | M | 0 |
| BE-02 | P1 | Login/registration throttles bypassable; no account lockout | S–M | 1 |
| BE-03 | P1 | Payment provider selection fails open | S | 1 |
| BE-04 | P1 (gated) | Hubtel webhook status parser misclassifies failures as success | M | 1 |
| BE-12 | P1 | 75 known advisories: Pillow 10.4.0 (66), DRF (5), requests (4) | S | 1 |
| FE-01 | P1 | No React error boundary; failed chunk = blank page | S | 1 |
| MOB-01 | P1 | No force-update, no OTA, no version header | M | 1 |
| BE-05 | P2 | Checkout/booking: no idempotency key, cart race (also FE-08, MOB-09) | S–M | 2 |
| BE-06 | P2 (gated) | Hubtel HTTP call inside DB transaction holding row locks | M | 2 |
| BE-07 | P2 (gated) | Pending checkouts/bookings/tickets never expire | S | 2 |
| BE-08 | P2 (gated) | Cart not cleared after Hubtel-confirmed order | S | 2 |
| BE-09 | P2 | 12 h non-revocable web tokens; no 401 recovery (also FE-04, MOB-05) | M–L | 2 |
| DB-03 | P2 | National ID, bank/MoMo, TIN, DOB in plaintext (also BE-10) | L | 2 |
| DB-04 | P2 | Account deletion leaves personal data; unbounded retention | M | 2 |
| DB-06 | P2→P1 | Ledger balance enforced in code only; no integrity job | M | 2 |
| DB-09 | P2 | No connection mgmt, timeouts, `pg_stat_statements`; default tuning | S | 2 |
| BE-11 | P2 | Cart price snapshot never revalidated | S | 2 |
| ARC-02 | P2 | No CI, no enforced merge gate (also FE-10, MOB-18) | S–M | 2 |
| ARC-03 | P2 | Health endpoint shallow; no external monitoring or alerts | S–M | 2 |
| ARC-04 | P2 | Deploy/rollback: restore-only rollback, mutable image tags | M | 2 |
| FE-02 | P2 | No client error or web-vitals telemetry (also MOB-02) | S–M | 2 |
| FE-03 | P2 | Production serves no security headers or CSP | S–M | 2 |
| FE-05 | P2 | Listing photos full-size, eager, no dimensions | S–M | 2 |
| FE-06 | P2 | 245 kB gzip entry bundle | M | 2 |
| FE-07 | P2 | Auth modal and cart drawer fail WCAG 2.2 AA | M | 2 |
| FE-09 | P2 | Five invented testimonials on About page | S | 2 |
| MOB-03 | P2 | R8 shrinking off; root cause unfixed | S–M | 2 |
| MOB-04 | P2 | Missing env var silently builds against staging | S | 2 |
| MOB-06 | P2 | Startup resilience: SecureStore failure/no fetch timeout/lock unmount (merges 06–08) | S–M | 2 |
| MOB-10 | P2 | Google Maps key restriction undocumented | S | 2 |
| MOB-11 | P2 | Consent links open nothing; permission strings and privacy manifest | S–M | 2 |
| P3 ×25, P4 ×5 | | See §5.3 | | 3 |

### 5.1 P0 findings

#### DB-01 Backups are local-only, untested and unalerted — P0 — Database / Ops
- **Evidence:**
  - `infra/scripts/backup-db.sh:44-49` runs plain `pg_dump | gzip` into `<checkout>/backups`. `infra/README.md:229-231,446-447` states nothing leaves the server.
  - Staging: `archive_mode=off`, `wal_level=replica`, no archiver activity (`pg_stat_archiver` all zero), 27 dumps totalling 3.3 MB, directory `0755`, files `-rw-r--r--` (world-readable). No rclone/rsync/restic in cron or script (`docs/reviews/evidence/staging/host-db-readonly.txt`, `db-readonly-2.txt`).
  - `backend/media` and `backend/private` are bind mounts with no backup (ID photos, listing photos).
  - README restore (`:223-226`) pipes a plain dump into a non-empty DB with no `--clean`, `ON_ERROR_STOP` or single transaction, so it would not restore cleanly (reasoned from code, not executed). No restore-test record anywhere. Failure is logged only to `/var/log/ashantihub-cron.log`; the script exits 0 if the db container is down.
  - Production backup state: **unverified** (outside granted scope). The cron entry and script are shared, so the same behaviour is expected.
- **Business impact:** a disk failure, provider incident, bad `rm` or ransomware destroys the data and every copy together. Best case you lose up to 24 h of orders, wallet postings and KYC; real recovery time is unknown because it has never been attempted. Dumps hold unmasked payout numbers and Ghana Card numbers.
- **Recommendation:** (1) nightly encrypted (age/restic) copy of dumps **and** `media/` + `private/` to Hetzner Object Storage or a Storage Box in another location; (2) `umask 077` and `chmod 700 backups`; (3) WAL archiving via pgBackRest or WAL-G for PITR; (4) a scripted restore drill into a scratch container with `manage.py check` and the ledger trial-balance query, run monthly; (5) dead-man's-switch alert if no good dump in 26 h; (6) write down RPO ≤ 15 min and RTO ≤ 4 h targets. Standards: PostgreSQL docs ch. 25 (continuous archiving/PITR), NIST SP 800-34 Rev. 1, ISO 22301, Google SRE (a backup is a hypothesis until restored), 3-2-1 rule.
- **Effort / timeline / owner:** M for items 1, 2, 5; L if PITR and the automated restore test are included. 2–3 weeks, confidence Medium. Owner: developer with server access. **Do first.**

#### BE-01 Ghana Card and KYC images are served publicly — P0 (pending one production `ls`) — Backend / Security
- **Evidence:** `accounts/models.py:455-460` (`upload_to="ghana_cards/"`), `:477` (certificate), `:564` (signboard), `disputes/models.py:153`; all land in public `MEDIA_ROOT`. `infra/hestia/templates/ashantihub-api.stpl.in:36-39` has `location /media/ { alias …; access_log off; }`. Live staging vhost has the identical block. HEAD on `https://api-test…/media/ghana_cards/<file>` returned **200** with no credentials (`evidence/staging/ghana-card-media-head.txt`; the one file there is a map image, not an ID). `accounts/files.py:1-4` admits "served publicly by nginx"; `settings.py:708-710` states the opposite rule. Filenames are not randomised. Rider documents already use `private_storage` (`delivery/models.py:129,263`).
- **Business impact:** any URL that leaks (staff screenshot, referrer, browser history, log) exposes a national ID permanently, with no access log to show who fetched it. Breach-notification and regulator exposure under Act 843. **Severity falls to P1 if production holds zero files** in `ghana_cards/`; `ls /opt/ashantihub/backend/media/ghana_cards | wc -l` on the server settles it.
- **Recommendation:** move these fields to the existing private storage; serve through a permission-checked view or `X-Accel-Redirect`/short-lived signed URL; randomise filenames; migrate and rename existing files; add `deny` for the old prefixes in the nginx template; stop `access_log off` for them. Standards: OWASP ASVS 5.0 V8/V14, API Security Top 10 API3:2023, NIST SP 800-53 AC-3, Act 843 security safeguards.
- **Effort / timeline / owner:** M, 3–5 days, confidence High. Owner: backend developer.

#### DB-05 App connects as Postgres superuser — P0 — Database / Security
- **Evidence:** staging `select rolname, rolsuper from pg_roles` → `ashantihub | t` (only role). `settings.py:166-171` uses `POSTGRES_USER` for the app; the same role runs migrations and **owns** the tables and the append-only triggers (`ledger_journal_append_only`, `ledger_journalline_append_only`, `activity_event_no_update`, `marketing_consent_no_change`; owner `ashantihub` per `pg_tables`). Production uses the same compose and image behaviour, so the same role is expected (unverified).
- **Business impact:** the "tamper-evident" ledger and audit log are only as strong as the app's weakest query. One SQL injection or leaked credential can `DROP TRIGGER`, `TRUNCATE`, or read/modify every table, and can run OS commands via `COPY … PROGRAM`.
- **Recommendation:** two roles: an owner/migrator used only by `migrate` at deploy time, and a non-superuser runtime role with DML grants only (revoke `TRIGGER`, `TRUNCATE`, DDL). Standards: PostgreSQL role/privilege docs, CIS PostgreSQL Benchmark, OWASP ASVS V1.4, NIST SP 800-53 AC-6.
- **Effort / timeline / owner:** M, 3–5 days including test-suite and deploy-script changes. Confidence Medium. Owner: backend developer.

### 5.2 P1 and P2 findings

#### BE-02 Login throttles bypassable; no lockout — P1 — Backend / Auth
- **Evidence:** no `NUM_PROXIES` in `settings.py`; nginx appends to a client-supplied `X-Forwarded-For` (`ashantihub-api.stpl.in:74`), so DRF's `get_ident` keys on the whole header (offline test: three forged headers gave three buckets). Throttle cache is `LocMemCache` (`settings.py:510`), per worker and reset on restart. Login serializers (`accounts/serializers.py:788-862`) have no per-account lockout. The project's own spec (`2026-10-16-security-hardening-design.md`, G1–G4) says "nothing built".
- **Impact:** unlimited password guessing and credential stuffing on customer, owner and staff logins; unlimited password-reset SMS/email spend.
- **Fix:** `NUM_PROXIES=1` (or key on `X-Real-IP` as OTP already does), Redis-backed throttle cache, per-account progressive lockout, nginx `limit_req`. ASVS V2.2/V11.1, API4:2023. **S–M, 2–4 days.**

#### BE-03 Payment provider fails open — P1 (gated) — Backend
- **Evidence:** `settings.py:351` `PAYMENTS_PROVIDER = "hubtel" if HUBTEL_CLIENT_ID else "simulated"`; `payments/services.py:474-494` records SUCCESS and finalises with no money moving. No system check couples `LEDGER_ENABLED` to a real provider.
- **Impact:** after a restore or env typo that blanks `HUBTEL_CLIENT_ID`, every order, subscription and ticket becomes a free success, silently.
- **Fix:** explicit `PAYMENTS_PROVIDER` required; Django `Error` check refusing `simulated` when `DEBUG` is false unless `ALLOW_SIMULATED_PAYMENTS` is set; second check coupling `LEDGER_ENABLED` to a real provider. 12-Factor III, ASVS V13. **S, 1 day.**

#### BE-04 Hubtel webhook status parser unsafe — P1 (gated) — Backend / Payments
- **Evidence:** `payments/views.py:28-65` classifies by substring, success checked first (`"success"`, `"paid"`, `"approved"`). Re-read by me: `"Unpaid"`, `"Unsuccessful"`, `"Not Approved"` all contain a success marker. Signature scheme and field names are self-declared UNVERIFIED (`hubtel_client.py:1-25`). Tests use only "Success"/"Failed".
- **Impact:** if Hubtel ever sends such strings, unpaid orders are marked PAID and goods released. Whether Hubtel does is **unverified, needs the Hubtel sandbox/docs**.
- **Fix:** exact match on documented codes; confirm every callback via Hubtel's transaction-status API server-side; reject callbacks with no amount; reconciler for PENDING sessions. ASVS V13.2, API10:2023. **M, 2–5 days, blocked on Hubtel sandbox access.**

#### BE-12 Vulnerable dependencies — P1 — Backend / Supply chain
- **Evidence:** `uvx pip-audit -r backend/requirements.txt --no-deps` → **75 vulnerabilities in 3 packages**: Pillow 10.4.0 (66; fixes up to 13.0.0), djangorestframework 3.16.1 (5; fix 3.18.2), requests 2.32.3 (4; fix 2.33.0). Output: `evidence/backend-arc-pip-audit.txt`. Individual exploitability is **unverified**.
- **Impact:** Pillow decodes every uploaded JPEG/PNG, including ID photos, on an internet-facing endpoint.
- **Fix:** bump the three packages, run the full test suite, add `pip-audit` to CI and Dependabot. ASVS V14.2, OWASP A06:2021, NIST SSDF. **S, 1 day** (plus regression run).

#### FE-01 No React error boundary — P1 — Frontend
- **Evidence:** grep for `ErrorBoundary|componentDidCatch|errorElement` finds nothing. `App.jsx:2464` wraps only a `Suspense`; 22 `React.lazy` chunks (`App.jsx:94-118`) including checkout.
- **Impact:** on flaky 3G a failed chunk download, or a tab held open across a deploy, leaves a shopper on a blank page mid-checkout with no retry. *Before/after unverified; needs a staging test blocking a chunk URL.*
- **Fix:** top-level and per-route boundaries with "Try again"; a `lazy()` wrapper that retries once then reloads once. **S, 1 day.**

#### MOB-01 No force-update, no OTA — P1 (P0 once builds go public) — Mobile
- **Evidence:** no `expo-updates`, `runtimeVersion` or channel in `package.json`, `app.config.ts` or any `eas.json` profile; client sends only `X-Client: mobile` (`src/lib/api.ts:40`), no version header; backend has no minimum-version check. `docs/mobile-release/LAUNCH_CHECKLIST.md:43` assumes "EAS Update for JS-only fixes", which this config cannot do. Play upload is manual and there is no service-account key.
- **Impact:** every bug needs a new store release (Play review hours–days, plus a manual upload). Users on a bad build cannot be made to update. The 5 Nov R8 launch crash is the preview.
- **Fix:** add `expo-updates` with an `appVersion`/fingerprint runtime policy and a channel per EAS profile; send `X-App-Version`/build number; backend returns 426 with `min_supported_version`; "please update" gate screen; rollback runbook. MASVS-PLATFORM, Expo EAS Update docs. **M, 3–5 days. Must precede the first public store build and any breaking API change.**

#### BE-05 Checkout/booking: no idempotency key, cart race — P2 (P1 once Hubtel/wallets are on)
- **Evidence:** no idempotency key anywhere in checkout (grep); `orders/views.py:100-101` reads the cart before the transaction, `:199` opens it without re-reading or locking, cart cleared `:379`; `OrderCheckoutView.post` is 284 lines. Frontend: `CheckoutPage.jsx:236` has only a `placingRef` guard (the withdrawal flow, `WithdrawForm.jsx:55-76`, does it right). Mobile: no `idempot` in `src` (MOB-09). Backend already supports the pattern in `wallets/withdrawals`.
- **Impact:** a double tap or a retry after a dropped 3G response creates two orders, two payments, and double stock reservation.
- **Fix:** lock and re-read the cart in the transaction; client UUID `request_id` with a unique constraint on web and mobile, returning the first result on repeat. API4/API6:2023, ASVS V11. **S–M backend + S per client.**

#### BE-06 Hubtel call inside DB transaction — P2 (gated)
- `orders/views.py:199,227,341-342` → `payments/services.py:499` → `hubtel_client.py:57` (`requests.post`, 15 s) while listing row locks are held; web has 4 sync workers, `--timeout=60`. A slow Hubtel stalls the API on hot items. **Fix:** commit order/reservation/PENDING session, call Hubtel outside the transaction (mirror `wallets.payouts.claim`). **M.**

#### BE-07 Pending checkouts never expire — P2 (gated)
- No beat entry or task for `CheckoutSession` (`settings.py:548-702`); `bookings/models.py:37` counts PENDING as active; stock reserved at `orders/views.py:277-285`. Abandoned Hubtel pages strand stock and dates. **Fix:** reaper that checks Hubtel status then `finalize_failure`. **S.**

#### BE-08 Cart not cleared after Hubtel-confirmed order — P2 (gated)
- `orders/views.py:89-93` says the webhook clears it; `payments/services.py:40-58` has no cart code; only the simulated branch clears (`:379`). A paid customer's next checkout buys everything again. **Fix:** clear in `_finalize_order_checkout`. **S.**

#### BE-09 Web sessions: 12 h, non-revocable, no 401 recovery — P2
- **Evidence:** `ACCESS_TOKEN_LIFETIME` 12 h, no refresh (`settings.py:483`); `accounts/authentication.py:42-56` checks suspension only for staff; password reset does not kill web tokens; `apiClient.js:5,17-31` keeps the session in `localStorage`; logout is local-only (`useAuth.js:118-121`); only the staff shell listens for the 401 event. Mobile: a 429 or network blip on refresh signs the user out (`src/lib/session.ts:55-60`; carriers put many phones behind one IP and the refresh throttle is 30/min/IP).
- **Impact:** a stolen token survives sign-out, password reset and suspension for up to 12 h; owners mid-dashboard or shoppers mid-checkout see raw "Invalid or expired token" errors; mobile users get logged out by transient errors.
- **Fix:** per-account `token_version`/password fingerprint, check suspension for all account types, 15–60 min access token with rotating refresh (HttpOnly cookie on web), a session-ended handler that preserves the pending action; mobile signs out only on definitive 401/403. ASVS V7, NIST SP 800-63B. **M for the UX and revocation parts, L for cookie refresh.**

#### DB-03 Sensitive data plaintext at rest — P2
- `accounts/models.py:454` (Ghana Card no.), `:480` (TIN), `:483-487` (bank/MoMo), `:84` (DOB); `wallets/models.py:18`; `delivery/models.py:131`. Only staff TOTP secrets are Fernet-encrypted. Staging has 1 Ghana Card record, 1 MoMo (fictional data). Masking on output is good but does not protect the DB, a dump or SQL access (and dumps are 0644, DB-01). **Fix:** application-level field encryption with a key outside the DB plus HMAC blind indexes for uniqueness/duplicate checks; encrypt dumps. Act 843, ASVS V6.1/V8.3, NIST SP 800-111. **L** (M for backups/permissions).

#### DB-04 Deletion and retention gaps — P2
- `accounts/deletion.py:104-166` blanks contacts but leaves `PayoutDestination.account_number/account_name`, `Order.delivery_address/phone/landmark`, messages, notifications; `ActivityEvent` keeps `ip`, `user_agent` and is immutable by trigger; no data-subject export found in `accounts`. Staging holds 186 activity events (IP content not checked). **Fix:** blank payout fields on delete; anonymise order/message data after the financial retention period; document the activity-log lawful basis and pseudonymise IP; build an export. Act 843 retention/access principles. **M.**

#### DB-06 Ledger integrity enforced in code only — P2 (P1 when `LEDGER_ENABLED` flips)
- `Account.net_credit` is a mutable cache (`ledger/models.py:49`); balanced-journal and non-negative rules live only in `posting._validate` (`posting.py:63-76`); no CHECK, no deferred constraint trigger, no TRUNCATE guard, no trial-balance job. Staging ledger tables are empty, and the integrity queries (D1–D4) returned zero rows trivially. **Fix:** nightly recompute and zero-sum alert; deferred per-journal balance trigger; `CHECK (net_credit >= 0)` per kind. **M.**

#### DB-09 No connection management, timeouts or query visibility — P2
- No `CONN_MAX_AGE`, `statement_timeout` or `lock_timeout` in `settings.py:164-173`. Staging: `shared_buffers=128MB` (default), `log_min_duration_statement=-1`, **no `pg_stat_statements`** (extension absent, only `pg_trgm`), `ssl=off` (acceptable inside the Docker network). `core_jobrun` has 1.67M sequential scans on 38 rows (polling hot spot). Dev password fallback `ashantihub_dev` if env is unset. **Fix:** `CONN_MAX_AGE=60`, `CONN_HEALTH_CHECKS`, timeouts via `OPTIONS`, `pg_stat_statements`, slow-query log, tuned memory, pinned PG minor. Django persistent-connection docs. **S.**

#### BE-11 Cart price snapshot never revalidated — P2
- `cart/views.py:221-229` reprices only on quantity change; checkout totals from `unit_price_snapshot` (`orders/views.py:~289`). A sale price stays purchasable after it ends. **Fix:** reprice from `effective_price` at checkout with a "price changed" prompt. **S.**

#### ARC-02 No CI and no enforced merge gate — P2
- No `.github`, no hooks; GitHub branch protection returns 404; the "gate" is prose for an AI agent in `.claude/skills/deploy/SKILL.md`; `deploy.sh` runs no tests. 6,947 backend test functions on real Postgres, 4,337 frontend tests, ~430 mobile cases exist but nothing runs them automatically. Frontend suite: 7m19s wall; at rest 2 files still fail (`App.staffSession`, `darkModeSmoke`); no ESLint/Prettier. Mobile `node_modules` missing, so tests were not run. **Fix:** GitHub Actions with Postgres service: backend tests, `makemigrations --check`, `pip-audit`, frontend build+typecheck+sharded Vitest, mobile `tsc`+`jest`; require via branch protection on `main`/`production`. DORA, OWASP SAMM. **S–M.** Highest ROI item in this review: it guards every other fix.

#### ARC-03 Health is shallow; no external monitoring — P2
- `core/views.py:46-48` always returns 200, never touches DB/Redis; Docker health and `deploy.sh:178-188` depend on it. Deep health is staff-only. No uptime probe or pager documented. **Fix:** `/healthz` vs `/readyz`; external uptime check; alerts on stale backup, late JobRun, disk, unprocessed webhooks, failed withdrawals. Google SRE golden signals. **S–M.**

#### ARC-04 Deploy and rollback safety — P2
- `deploy.sh`: rollback = restore the dump (loses writes since); mutable image tag, `docker image prune -f` at `:263`; `migrate` runs while the old web container serves (`:168`), no expand/contract rule or `lock_timeout`; 72 `RunPython` lines without explicit reverse per the backend agent (the DB agent counted all 84 reversible: **conflict, unresolved**); `npm ci` and the Node 20 (EOL) frontend build run on the production host. **Fix:** tag images by git SHA, keep last 3; migration lint + `lock_timeout`; build frontend in CI. **M.**

#### FE-02 / MOB-02 No client error or performance telemetry — P2
- No Sentry/web-vitals/analytics in web or mobile; `sourcemap:false`; 474 web mutation sites report only to local state. The mobile store-privacy docs assume "Sentry with PII scrubbing" that does not exist. The R8 crash was found by hand on one device. **Fix:** `@sentry/react` and `@sentry/react-native` (org exists) with PII scrubbing, hidden source maps and dSYMs, release tagging, `web-vitals` beacon. ASVS V7. **S–M each.**

#### FE-03 Production serves no security headers — P2
- `curl -I https://theashantihub.com/`: no HSTS, X-Frame-Options, nosniff, CSP, Referrer-Policy. `vercel.json` headers apply to **staging only** (production is nginx, `ashantihub-spa.stpl`). Duplicate `cache-control`; gzip only. Combined with the `localStorage` token, any future XSS is full account takeover with no CSP backstop. (The template includes `nginx.hsts.conf*`; HSTS at another layer is unverified.) **Fix:** mirror `vercel.json` in the Hestia template, add `frame-ancestors 'none'`, brotli, CSP in Report-Only first. ASVS 5.0 V3, CSP L3. **S** for headers, **M** for enforced CSP.

#### FE-05 Listing photos unoptimised — P2
- `App.jsx:1070,1082` bare `<img src alt>`: no `loading`, `width/height`, `srcSet`. Backend already ships `main_photo_variants` (`listings/serializers.py:284-324`); the frontend never uses it. Hits LCP and CLS on the main browse journey. **Fix:** use variants with `srcSet/sizes`, lazy-load, aspect-ratio, `fetchpriority` on the first hero only. Core Web Vitals. **S–M.** *Before/after unverified; needs staging Lighthouse.*

#### FE-06 Large entry bundle — P2
- `index-*.js` 803,486 B raw / **244,722 B gzip** plus 24 kB render-blocking CSS. `App.jsx` and its static imports are 43%; framer-motion 123 kB raw and `qrcode` 23 kB are imported statically. **Fix:** lazy-load CTA bands/footer motion/`TicketQr`, CSS for simple reveals, `manualChunks`, preload one font; budget < 150 kB gzip. **M.**

#### FE-07 Accessibility failures on sign-up and cart — P2
- `AuthModal` (`App.jsx:1213,1325`): no `role=dialog`, no Escape, no focus management, close button `✕` with no label; placeholder-only inputs; zero `autoComplete`. `CartDrawer` same. Star rating is `<span onClick>` (`App.jsx:925`). 28 `<div|span onClick>`; 653 `<label>` vs 64 `htmlFor`; `outline:none` on 14 inputs; ~1,393 inline font sizes of 10–12.6 px. **Fix:** one accessible Dialog primitive (Radix is in the stack), labels/`autocomplete` (`one-time-code` helps OTP), focus ring, 14 px minimum, add `jest-axe`. WCAG 2.2 AA (1.3.1, 1.3.5, 2.1.1, 2.4.7, 4.1.2). **M.** *Touch-target pixel sizes unverified.*

#### FE-09 Invented testimonials — P2 (breaks a stated product rule)
- `components/ui/about-testimonials-section.tsx:5-60`, rendered at `App.jsx:3433`: five named quotes, disclosed only in a code comment; one claims a Business Credit Score loan, one says "message me on WhatsApp" (contradicts the no-direct-contact rule). Related dead code: `MoMoModal` (random booking ref) and `ReferralModal` (random code, GHS 5/10 promises) never rendered; the support WhatsApp number `233244000000` is hard-coded in 5 files and looks like a placeholder (**unverified, needs owner**). **Fix:** remove or replace with consented real quotes; delete dead code; read the number from `SiteSettings`. **S.**

#### MOB-03 R8/resource shrinking off — P2
- `app.config.ts:37-40`; root cause (R8 stripping `WorkDatabase`) is unfixed, no `extraProguardRules`, no release-artefact smoke test. Larger APK on 3–4 GB phones; the next reflection-dependent library may fail differently. **Fix:** keep rule for `androidx.work.impl.WorkDatabase_Impl` (or Room rule), re-enable shrinking behind a smoke test on the SM-A225F. **S–M.** *Size delta unverified.*

#### MOB-04 Silent staging fallback — P2
- `src/lib/config.ts:2` falls back to the staging URL when `EXPO_PUBLIC_API_BASE_URL` is unset; both store profiles bake staging. A mis-built "production" binary talks to the test DB and, with MOB-01, cannot be corrected without a store release. **Fix:** remove the fallback, throw on the `production` profile, add an "ENV: staging" badge. **S.**

#### MOB-06 Startup resilience — P2
- `src/state/auth.ts:60` and `lock.ts:28` await `session.load()` outside try/catch while screens return `null` on "loading" (blank screen if Keystore decrypt fails, e.g. after device restore); no `AbortController`/timeout anywhere in `src` (hung request → blank screen on poor networks); `LockGate.tsx:38` unmounts the whole navigator on any backgrounding, losing checkout/form state and the paid-result screen. **Fix:** catch → signed out; 15–20 s fetch timeout mapped to the offline state; render the lock as an overlay. **S–M.** *Device behaviour unverified.*

#### MOB-10 Maps key restriction — P2 (unverified)
- Key comes from an EAS secret into every APK manifest; no document mentions restricting by package + SHA-1. **Fix:** restrict to `com.ashantihub.app` (Play App Signing + EAS SHA-1) and Maps SDK for Android; quota + budget alert. **S.** *Needs Cloud Console.*

#### MOB-11 Consent links and store declarations — P2
- `customer-sign-up.tsx:126,130` open `EXPO_PUBLIC_TERMS_URL`/`PRIVACY_URL`, set in no profile, so the links do nothing in every build (the `/legal/[doc]` route exists). Camera permission string promises ID photos but `launchCameraAsync` is never called; location string covers only delivery pins; no `ios.privacyManifests`; `allowBackup` not set. **Fix:** point links at `/legal/*`; align permission strings; run `expo prebuild` once and review manifest, `Info.plist`, `PrivacyInfo.xcprivacy`. Apple 5.1.1, Play user-data policy, Act 843. **S–M.** *Merged manifests unverified.*

### 5.3 P3 and P4 findings (compact)

| ID | Sev | Finding and evidence | Fix | Effort |
|---|---|---|---|---|
| DB-07 | P3 | Orders/payments/listings use `DecimalField` with no `>= 0` CHECK (`orders/models.py:63-64`, `payments/models.py:91-94`, `listings/models.py:139-141`); ledger uses integer pesewas (good) | CHECK constraints `NOT VALID` then `VALIDATE` | S |
| DB-08 | P3 | `on_delete=CASCADE` on money/booking rows (`orders/models.py:39`, `billing/models.py:172,176`, `payments/models.py:79,83`, `events/models.py:430`); ledger FKs are PROTECT | PROTECT + a test guarding new FKs | S–M |
| DB-10 | P3 | Global locks: `PROVIDER_CLEARING` per payment, one advisory lock for all audited writes (`activity/services.py:186`); nightly full-chain verify | Load-test at 10×; incremental checkpoint | M–L |
| DB-11 | P3 | Likely gaps: `Journal.created_at/kind`, `Order` status/placed_at, 41 `icontains` searches (pg_trgm installed). **Unverified at volume** (staging 25 MB; 476 indexes show zero scans across 194 tables, which is meaningless at this size) | Add after `pg_stat_statements`, `CONCURRENTLY` | S–M |
| DB-12 | P3 | No purge for notifications, messages, `WebhookEvent`, delivery events, vendor texts; consent 2-year retention counted but not enforced (`marketing/views_consent.py:21,119-124`) | Retention schedule + Celery purges; partition activity log | M |
| DB-13 | P3 | Phones unique on raw string (`024…` vs `+23324…`), emails case-sensitive unique; the staging duplicate probe returned one repeated key (`db-readonly-2.txt`, not investigated) | Normalise to E.164, unique on normalised/`lower(email)` | M |
| DB-14 | P3 | Plaintext codes/tokens: secondary-contact verify codes, `StaffUser.invite_token`, `FulfilmentCheck.collection_code` | Hash like the other tokens | S |
| BE-13 | P3 | Webhook writes row before signature check; amount check skipped when absent; unparseable amount returns 200 (`payments/views.py:114,154-172`); no IP allow-list | Verify first; alert on `processed=False`; nginx allow-list | S |
| BE-14 | P3 | Reset token plaintext in DB and query string (`accounts/serializers.py:~275-283`); older tokens not invalidated; min length 8 only; PBKDF2 hasher | Hash token, fragment URL, breached-password check, Argon2 | S |
| BE-16 | P3 | Staff 2FA mandatory only for Super Admin by default (`staffsecurity/policy.py:12-17`); prod policy row unverified | Default-require for money/PII/approval roles | S |
| BE-17 | P3 | Late Hubtel success can mark a CANCELLED order PAID after stock returned (`orders/support.py:63-84`, `payments/services.py:44-48`) | Fail session + refund path | S |
| ARC-05 | P3 | Celery: no time limits/`acks_late`, one queue, concurrency 2, Redis non-durable (`--save '' --appendonly no`), 38 beat entries incl. every 10 s | Separate `money`/`slow` queues, limits, AOF | M |
| ARC-06 | P3 | Prod + staging + builds + mail on one 8 GB host | Hetzner snapshots, rebuild runbook, later separate staging | L |
| ARC-07 | P3 | Dev defaults `ALLOWED_HOSTS=["*"]`, `CORS_ALLOW_ALL_ORIGINS=True`; prod `.env` unread | Fail closed when `DEBUG` false; `check --deploy` in CI | S |
| ARC-08 | P3 | `accounts/views.py` 2,087 lines, `listings/views.py` 1,804, `OrderCheckoutView.post` 284 lines; frontend `App.jsx` 3,478 lines, 95 `useState`, 539 inline styles (FE-13) | Split checkout into tested services; real `<Routes>` | L |
| FE-11 | P3 | `react-router` advisory GHSA-qwww-vcr4-c8h2 (RSC mode, unused; patch 7.18.5); Vite 5.4 vs 8.x, Vitest 1.6 vs 4.x | Patch now; schedule Vite/Vitest after CI | S / M |
| FE-12 | P3 | Staff dashboard one 1.65 MB chunk (408 kB gzip); PWA precaches 4.1 MiB | Lazy-load panels per role | M |
| FE-14 | P3 | `new QueryClient()` defaults: retries 4xx 3×, focus refetch, no `AbortSignal` | Global `staleTime`, skip 4xx retry, pass `signal` | S–M |
| FE-15 | P3 | `window.location.href = checkout_url` at 6 sites unvalidated; `unpkg.com` marker icons; staff drafts in `localStorage` | Scheme/host allow-list; self-host icons | S |
| MOB-12 | P3 | ~25 routes lack a client auth guard (`manage/*`, `checkout`, …); server enforces authz | Layout-level guards | S |
| MOB-13 | P3 | No in-app password reset | Link to web flow or OTP | S–M |
| MOB-14 | P3 | Hand-written client: 79 `as T` casts, 106 `as never` route casts; OpenAPI unused | Generate types in CI, validate money payloads | M |
| MOB-15 | P3 | Deals strip uses full-size images; 20–60 s polling continues in background; `expo-image` in 3 files | Thumbnails, `cachePolicy`, pause polling | S–M |
| MOB-16 | P3 | A11y: chips 44 dp (<48), 3 `hitSlop`, no `maxFontSizeMultiplier`; 91 Pressables vs 101 labels | 48 dp, test at 200% with TalkBack | S |
| MOB-17 | P3 | Business Agreement text duplicated in-app (`register/terms.tsx`), can drift | Serve versioned text from API | S–M |
| DB-16 | P4 | 303 migrations/37 apps, 9 mix schema+data, none squashed | Squash old; separate data migrations | M |
| DB-17 | P4 | Dev compose publishes Postgres `0.0.0.0:5432` with known password (prod does not) | Bind to 127.0.0.1 | S |
| BE-18 | P4 | PII in logs (`accounts/emails.py:25`), Node 20 EOL, `.env` injected into db/redis, docs drift | Clean up | S |
| MOB-19 | P4 | No cert pinning (defence in depth; pin two keys if added); SDK/targetSdk deadlines unconfirmed | Check Expo/Play policy | S |
| MOB-20 | P4 | Riders refused in app (`state/auth.ts:195-197`); support number looks like a placeholder; dead `ComingSoon.tsx` | Product decision; delete dead code | S |

**Open conflict between agents:** the database agent reports all 84 `RunPython` calls have reverses; the backend agent says 72 lack one. I did not resolve this; run `grep` per migration before relying on rollback (ARC-04).

---

## 6. What is fine — leave it alone

- **Ledger core and withdrawal engine.** Integer pesewas, append-only Postgres triggers (present and enabled on staging), `PROTECT` on ledger FKs, unique journal keys, pk-ordered locks with a threaded test, unique `request_id`, send-once `claim()`, no provider call inside a transaction. Do not redesign.
- **Authorization discipline.** An AST scan found 0 views without explicit permissions despite `DEFAULT_PERMISSION_CLASSES = []`; 0 `fields="__all__"`; 10 sampled views scope to the caller. Staff sessions (server-side jti, idle 30 min, sudo 10 min), TOTP replay protection, OTP (HMAC-stored, advisory-locked), mobile refresh rotation with reuse detection.
- **Injection/SSRF hygiene.** Parameterised SQL, no `shell=True`/pickle/eval, fixed outbound hosts with timeouts, WeasyPrint fetcher blocked, uploads sniffed with `python-magic`.
- **Secrets.** `.env` and `.cred.md` gitignored and never in history; `.dockerignore` excludes `.env`; production image runs non-root; settings fail closed on secret keys and Redis; Sentry `send_default_pii` off with a denylist. No secret in the built web bundle.
- **Network posture.** Firewall default DROP, Postgres/Redis/app ports internal or loopback, `/admin/` hidden, debug off on staging, API sends HSTS/nosniff/XFO.
- **Postgres choice and sizing.** Postgres 16.15 is current; the box is not the constraint. No engine change, no microservices.
- **Stock reservation** (pk-ordered locks, whole-cart check) and **time zones/keys** (`USE_TZ`, `BigAutoField`).
- **Web client patterns.** No XSS sinks, `useMutation` convention applied consistently with visible errors, withdrawal double-submit protection (copy it to checkout), self-hosted fonts, route-level code splitting, tokenised light/dark themes, safely scoped staff service worker, correct immutable-asset cache headers.
- **Mobile.** `expo-secure-store` only (no AsyncStorage), payments via system browser (no WebView/JS bridge), screen-capture blocking on money screens, https only, permissions requested at point of use, EAS-managed signing with `autoIncrement`. Product rules (no direct business contact, no invented data) hold.
- **Honest documentation.** `backend/CLAUDE.md` and the specs record their own gaps, including several above. The hardening spec correctly diagnosed BE-02, BE-14, DB-03; it needs building, not rediscovering.

## 7. Remediation roadmap

**Assumptions:** one developer (AI-assisted); 100% capacity in Phases 0–1, 30–40% afterwards; Hubtel sandbox access for BE-04; Hetzner Object Storage account. Ranges are dev-days; confidence Medium.

| Phase | Items | Effort | Parallel with | Calendar | Owner |
|---|---|---|---|---|---|
| **0 Stop the bleeding** (weeks 0–2) | DB-01 (backups offsite, perms, alert, restore drill; PITR can trail), BE-01, DB-05; plus a one-time `ls` of production `ghana_cards/` and `stat` of prod backups on day 1 | 8–20 d | DB-01 offsite copy runs while BE-01 is built | 2–3 wks | Backend/infra dev |
| **1 Stabilise** (weeks 2–6) | BE-02, BE-03, BE-12, FE-01, MOB-01, BE-04 (when sandbox access exists) | 9–17 d | BE-12, FE-01 on day 1; MOB-01 alongside backend gate | 2–3 wks | Same dev; mobile for MOB-01 |
| **2 Strengthen** (weeks 6–12+) | 24 P2 items. **Order:** ARC-02 CI first; then every *gated* item (BE-05–08, DB-06, DB-09) before the money switches; then DB-03/04, BE-09, then FE/MOB items | 55–80 d | Frontend items parallel to backend | 11–16 wks at 100%; **6–9 months at 30%** | Dev + PR review via CI |
| **3 Modernise** (months 3–6+) | 25 P3 + 5 P4 folded into feature work | 45–65 d | — | Opportunistic | — |

**Overall:** about **120–180 dev-days**. Phases 0–1 close in roughly **4–8 weeks**; Phase 2 finishes in about **3 months if dedicated, 6–9 months if squeezed into feature work**. Re-sequence rather than stretch: the money-gated items are a hard prerequisite for switching on the ledger and Hubtel, so the switch date, not the calendar, sets the deadline. Sequencing rules applied: backups and the restore test first; CI before bulk refactors; observability (ARC-03, FE-02) before performance tuning; forced-update (MOB-01) before any breaking API change; no engine swap or service split anywhere in the plan.

**Unverified items that could widen the range:** production ID-file count, production DB role and backup state, Hubtel's real status/signature scheme, restore time, manifest/privacy-manifest contents.

## 8. Residual risk register

| Risk | Status after roadmap | Owner |
|---|---|---|
| Single server (prod + staging + builds + mail) | **Accepted** for opening window; mitigated by offsite backups, snapshots and rebuild runbook (ARC-06) | Owner |
| Bus factor 1 (one committer; 47/47 mobile commits) | Partly mitigated by CI + runbooks; **accepted** until a second engineer can deploy and restore | Owner |
| Hubtel integration correctness | Unverifiable until sandbox testing; keep switches off until BE-03/04/06/07/08 are proven | Owner |
| Public Maps key abuse | Quota + restriction (MOB-10); residual billing risk | Dev |
| No certificate pinning on mobile | **Accepted** (MOB-19); pin only with rotation plan and OTA in place | Dev |
| Data in the immutable activity log | Lawful basis and retention to be documented (DB-04); legal review recommended | Owner / counsel |
| Performance at volume | Unmeasured (25 MB staging); revisit after `pg_stat_statements` has collected a month of real traffic | Dev |

## 9. Appendix

**Evidence index** (`docs/reviews/evidence/`): `staging/http-headers.txt`, `host-db-readonly.txt`, `db-readonly-1.txt`, `db-readonly-2.txt`, `ghana-card-media-head.txt`; `database/01-static-evidence.txt`, `02-staging-readonly-queries.sql`; `backend-arc/01…13`; `backend-arc-pip-audit.txt`; `frontend/FE-evidence-raw.md`, `FE-evidence-code-greps.md`; `mobile/track-e-mobile-evidence.md`.

**Commands run by me (all read-only):** SSH host checks (`ss -tlnp`, `docker compose ps`, `iptables -S`, `ls`/`stat` on staging backups and media, cron listing, nginx vhost read); `psql` read-only queries on the staging DB (including the `BEGIN READ ONLY` file with the `pg_stat_statements` statement removed because the extension is absent); `curl -I` on staging/prod front-end and staging API; HEAD on one staging media URL; `uvx pip-audit -r backend/requirements.txt --no-deps`; `git shortlog`, `git ls-files`/`check-ignore` (checked that `.cred.md` is ignored and absent from history; contents not read).

**Versions observed:** Django 5.2.18, DRF 3.16.1, Postgres 16.15, Redis 7, React 19.2.7, Vite 5.4.21, Vitest 1.6.1, Tailwind 4.3.2, Expo SDK 58 / RN 0.88 (per mobile agent).

**Tooling gaps:** `gitleaks`/`trufflehog` not installed, so a history-wide secret scan was not run (only `.cred.md` tracking was checked); a scan is a cheap Phase 0 addition.

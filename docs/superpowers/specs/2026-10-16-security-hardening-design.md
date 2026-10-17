# Security hardening: login abuse, crawling, secret data, denial of service

**Status:** DRAFT for owner review. Nothing here is built or deployed. Date: 2026-10-16.
**Rule that governs every phase:** test locally, ship to **staging** (`api-test.theashantihub.com`), and
promote to production **only** when the owner says so (CLAUDE.md golden rule). Each phase below ends with a
"Rollback" line.

Answers the four questions asked on 2026-10-16. Blockchain / smart-contract languages were considered for the
wallet and rejected (the double-entry ledger already gives the tamper-evidence a chain would; the money still
moves through the licensed provider; the BoG filing is built on a ledger over provider rails). If a tamper-evident
ledger is ever demanded by an auditor, extend the existing `activity-verify-chain` hash-chain job to ledger rows.
That needs no new technology.

---

## 0. What the code actually does today (verified 2026-10-16)

| # | Finding | Where | Risk |
|---|---------|-------|------|
| G1 | **Throttles can be bypassed by spoofing a header.** `NUM_PROXIES` is unset, so DRF uses the *whole* `X-Forwarded-For` string as the client identity, and nginx *appends* to whatever the client sent. A new fake header value = a fresh bucket, so `login: 5/min` does not hold. | `settings.py` `REST_FRAMEWORK`; `ashantihub-api.tpl.in` `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` | **High** |
| G2 | Throttle counters live in per-process memory (`default` cache is `LocMemCache`), so each gunicorn worker counts separately and a restart resets them. | `settings.py` `CACHES` | High |
| G3 | No per-account lockout and no bot challenge on login/register/reset. | `accounts/views.py` | High |
| G4 | No CDN/WAF, no `limit_req`, API origin reachable directly. One Hetzner box serves **both the API and the production web app** (only `test.` is on Vercel). | `infra/README.md`, nginx templates | **High** (DoS) |
| G5 | Payout account numbers are stored **unmasked** (masked on display only): `PayoutDestination.account_number`, plus `payout_momo_number`, `payout_bank_account_number`, `tin` on the business profile. | `wallets/models.py:18`, `accounts/models.py:445` | High (DB leak) |
| G6 | Login code calls `check_password(...)` with no `setter`, so stored password hashes are never upgraded when the hasher changes. | `accounts/serializers.py:564-` | Low |
| G7 | Public list/search endpoints have no crawl throttle. Some views override `throttle_classes` with plain `ScopedRateThrottle`. | `messaging/views.py:119,161`, `marketing/views_banners.py:178` | Medium |
| G8 | 12-hour access tokens. | `settings.py` `SIMPLE_JWT` | Medium (separate spec, see §9) |

Already good (keep): passwords hashed by Django; no card data or PINs stored (hosted checkout); Sentry scrubs
`account_number`, OTP codes and tokens; OTP hourly limits are counted from DB rows (hold across processes);
HSTS/SSL redirect on; Redis not exposed on a host port; step-up OTP on withdrawals (built, switched off).

---

## Order of work

| Phase | What | Closes | Effort |
|-------|------|--------|--------|
| 1 | Correct client IP + shared (Redis) throttles | G1, G2 | ~0.5 day |
| 2 | Account lockout + Turnstile bot challenge | G3 | ~1 day (+ frontend) |
| 3 | Cloudflare in front, origin locked to it | G4 | ~0.5 day + DNS wait |
| 4 | nginx `limit_req` / `limit_conn` | G4 | ~2 h |
| 5 | Encrypt payout numbers (5a), Argon2 (5b, optional), encrypted backups (5c) | G5, G6 | ~2 days |
| 6 | Crawl control | G7 | ~0.5 day |
| 7 | Attack runbook + alerts | G4 | ~2 h |

Do 1, 3 and 5a **before any wallet switch is turned on**; add them to spec §13 of
`2026-10-15-wallet-fees-security-design.md`.

---

## Phase 1. Correct client IP and shared throttles (G1, G2)

**1.1 Make nginx overwrite `X-Forwarded-For`** in `infra/hestia/templates/ashantihub-api.tpl.in` and
`ashantihub-api.stpl.in`, in both `location /ws/` and `location /`:

```diff
-		proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
+		proxy_set_header X-Forwarded-For   $remote_addr;
```

(After Phase 3, `$remote_addr` is the real visitor because nginx is told to trust Cloudflare's header.)

**1.2 Tell DRF there is exactly one proxy** (`settings.py`, inside `REST_FRAMEWORK`):

```python
    "NUM_PROXIES": 1,
```

**1.3 A Redis cache for throttles that fails open.** In `settings.py`, after `CACHES = {...}`:

```python
CACHES["throttle"] = (
    {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
        "KEY_PREFIX": "ah-throttle",
        "OPTIONS": {"socket_connect_timeout": 1, "socket_timeout": 2},
    }
    if USE_REDIS
    else {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "throttle"}
)
```

New file `backend/core/throttling.py`:

```python
"""ScopedRateThrottle counted in Redis so every gunicorn worker shares one count. A Redis outage must never take
sign-in down (settings.py CACHES comment), so a cache failure allows the request and is logged at ERROR for Sentry."""
import logging

from django.core.cache import caches
from rest_framework.throttling import ScopedRateThrottle

log = logging.getLogger(__name__)


class SharedScopedRateThrottle(ScopedRateThrottle):
    cache = caches["throttle"]

    def allow_request(self, request, view):
        try:
            return super().allow_request(request, view)
        except Exception:
            log.exception("throttle cache unavailable; allowing the request")
            return True
```

**1.4 Switch every user of the old class:**

```bash
cd /home/righteoushack/projects/TheAshantihub
grep -rn "ScopedRateThrottle\|throttle_classes" backend --include=*.py | grep -v /tests/
```

Set `DEFAULT_THROTTLE_CLASSES` to `["core.throttling.SharedScopedRateThrottle"]`, and in `messaging/views.py` (2
places) and `marketing/views_banners.py:178` replace `ScopedRateThrottle` with `SharedScopedRateThrottle`. Leave the
`throttle_classes = []` lines alone (deliberately unthrottled).

**1.5 Tests first** (`accounts/tests/test_rate_limiting.py`; its `setUp` clears `cache`, so also clear the new one):

```python
from django.core.cache import caches
# in setUp:  caches["throttle"].clear()

def test_spoofed_forwarded_for_does_not_reset_the_login_limit(self):
    for i in range(6):
        response = self.client.post(
            "/api/accounts/customers/login/", {"identifier": "nobody@example.com", "password": "wrong"},
            format="json", REMOTE_ADDR="203.0.113.9", HTTP_X_FORWARDED_FOR=f"10.0.0.{i}, 203.0.113.9",
        )
    self.assertEqual(response.status_code, 429)
```

```bash
docker compose run --rm web python manage.py test accounts.tests.test_rate_limiting core
```

**1.6 Staging check** (should print `400` five times, then `429`):

```bash
for i in $(seq 1 8); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST https://api-test.theashantihub.com/api/accounts/customers/login/ \
    -H 'Content-Type: application/json' -H "X-Forwarded-For: 10.9.9.$i" \
    -d '{"identifier":"nobody@example.com","password":"wrong"}'
done
```

**Rollback:** revert the commit; nothing persists.

---

## Phase 2. Account lockout and bot challenge (G3)

Per-IP throttles do not stop one account being attacked from thousands of IPs. Add a per-account failure counter
and a Cloudflare Turnstile challenge after a few failures.

**2.1 Keys** (Cloudflare dashboard, Turnstile, add widget for `theashantihub.com` and `test.theashantihub.com`).
Put `TURNSTILE_SECRET_KEY` in `backend/.env` (staging and production) and `VITE_TURNSTILE_SITE_KEY` in the
frontend env. For local tests Cloudflare publishes always-pass dummy keys (check the current Turnstile docs).
Add `TURNSTILE_SECRET_KEY=` to `infra/env/backend.env.example` and to `settings.py`:

```python
TURNSTILE_SECRET_KEY = env("TURNSTILE_SECRET_KEY", default="")  # empty = challenge off
```

**2.2 `backend/accounts/lockout.py`:**

```python
"""Failed-sign-in counter per account, shared by all workers (the `throttle` cache). Fixed 15-minute window from the
first failure. 3 failures -> a bot challenge is required; 10 -> sign-in is refused until the window ends (password
reset by one-time code still works). A lock can be triggered by someone else typing your identifier, which is why it
is temporary and why reset stays open. Cache trouble never blocks sign-in."""
import hashlib
import logging

from django.core.cache import caches

log = logging.getLogger(__name__)
WINDOW_SECONDS = 15 * 60
CHALLENGE_AFTER = 3
LOCK_AFTER = 10


def _key(kind, identifier):
    return "lockout:" + hashlib.sha256(f"{kind}:{str(identifier).strip().lower()}".encode()).hexdigest()


def failures(kind, identifier):
    try:
        return caches["throttle"].get(_key(kind, identifier), 0)
    except Exception:
        log.exception("lockout cache unavailable")
        return 0


def record_failure(kind, identifier):
    try:
        cache, key = caches["throttle"], _key(kind, identifier)
        cache.add(key, 0, WINDOW_SECONDS)
        cache.incr(key)
    except Exception:
        log.exception("lockout cache unavailable")


def clear(kind, identifier):
    try:
        caches["throttle"].delete(_key(kind, identifier))
    except Exception:
        log.exception("lockout cache unavailable")


def is_locked(kind, identifier):
    return failures(kind, identifier) >= LOCK_AFTER


def needs_challenge(kind, identifier):
    return failures(kind, identifier) >= CHALLENGE_AFTER
```

**2.3 `backend/core/turnstile.py`:**

```python
import requests
from django.conf import settings

VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


def verify(token, ip=""):
    """True when the visitor passed the challenge. Off (always True) until TURNSTILE_SECRET_KEY is set; fails open
    if Cloudflare cannot be reached, because the lockout still protects the account."""
    if not settings.TURNSTILE_SECRET_KEY:
        return True
    if not token:
        return False
    try:
        reply = requests.post(VERIFY_URL, data={"secret": settings.TURNSTILE_SECRET_KEY, "response": token, "remoteip": ip}, timeout=3)
        return bool(reply.json().get("success"))
    except (requests.RequestException, ValueError):
        return True
```

**2.4 Wire it into the three sign-in views** (`CustomerLoginView`, `BusinessOwnerLoginView`, `StaffLoginView` in
`accounts/views.py`). Shape for the customer view (the other two are the same with their `kind`):

```python
identifier = str(request.data.get("identifier", ""))
if lockout.is_locked("customer", identifier):
    return Response({"detail": "Too many failed attempts. Try again in 15 minutes, or reset your password."}, status=429)
if lockout.needs_challenge("customer", identifier) and not turnstile.verify(request.data.get("turnstile_token"), request.META.get("REMOTE_ADDR", "")):
    return Response({"detail": "challenge_required"}, status=400)
serializer = self.get_serializer(data=request.data)
try:
    serializer.is_valid(raise_exception=True)
except serializers.ValidationError:
    lockout.record_failure("customer", identifier)
    raise
lockout.clear("customer", identifier)
```

Also add the challenge (no lockout) to registration and password-reset request views, keyed on IP via the existing
throttle scopes.

**2.5 Frontend** (follow `frontend/CLAUDE.md`: inline `C` palette, no `useMutation`):

```bash
cd frontend && npm install @marsidev/react-turnstile
```

In the sign-in form, when a response is `{"detail": "challenge_required"}`, render the widget with
`VITE_TURNSTILE_SITE_KEY` and resend with `turnstile_token`. Test with Vitest, run from `frontend/`:
`npm run test -- AuthModal`.

**2.6 Tests:** 3 failures then a request without a token gets `challenge_required`; 10 failures then `429` even
with the right password; success clears the counter; cache raising an exception does not block sign-in.

**Rollback:** unset `TURNSTILE_SECRET_KEY` (challenge off). Lockout is code, so revert the commit.

---

## Phase 3. Cloudflare in front, origin locked to it (G4)

This is what actually absorbs a volumetric attack. One server cannot.

**3.1 Pre-flight (read-only):**

```bash
dig NS theashantihub.com +short          # where DNS lives today
dig MX theashantihub.com +short          # mail is at 20i (stackmail), NOT on this server
curl -sI https://api.theashantihub.com/api/health/ | head -1
```

Export or screenshot every existing DNS record first.

**3.2 Add the site to Cloudflare** (dashboard, Free plan), then change the nameservers at the registrar to the two
Cloudflare gives you. Cloudflare imports the records; **check each one**:

| Record | Proxy |
|--------|-------|
| `theashantihub.com`, `www`, `api`, `api-test` | **Proxied (orange)** |
| `test` (Vercel) | DNS only (grey) |
| all `MX`, mail/imap/smtp hosts, SPF/DKIM/DMARC `TXT` | **DNS only (grey)**. Proxying breaks mail |
| any host you SSH to | DNS only |

**3.3 SSL/TLS** (dashboard): mode **Full (strict)**; the origin already has Hestia Let's Encrypt certificates.
Minimum TLS 1.2. Leave Bot Fight Mode **off** on the API for now: on the free plan it cannot be exempted for
webhooks (confirm in the current Cloudflare docs).

**3.4 Make nginx see the real visitor.** New script `infra/scripts/update-cloudflare-ips.sh` (run as root; also
add a monthly line to `infra/cron/ashantihub.cron`):

```bash
#!/usr/bin/env bash
# Refresh the Cloudflare address list nginx trusts for the real client IP.
set -euo pipefail
V4=$(curl -fsS https://www.cloudflare.com/ips-v4)
V6=$(curl -fsS https://www.cloudflare.com/ips-v6)
[[ -n "$V4" && -n "$V6" ]] || { echo "FATAL: empty Cloudflare list" >&2; exit 1; }
tmp=$(mktemp)
{
	echo "# Generated by infra/scripts/update-cloudflare-ips.sh. Do not edit."
	for range in $V4 $V6; do echo "set_real_ip_from ${range};"; done
	echo "real_ip_header CF-Connecting-IP;"
} >"$tmp"
install -m 644 "$tmp" /etc/nginx/conf.d/cloudflare-realip.conf
rm -f "$tmp"
nginx -t
systemctl reload nginx
```

```bash
# on the server, as root
nginx -T 2>/dev/null | grep -n "conf.d/\*.conf"      # confirm Hestia's nginx includes conf.d
bash /opt/ashantihub/infra/scripts/update-cloudflare-ips.sh
```

**3.5 Lock the origin so only Cloudflare can reach it.** Without this, attackers use the server IP and bypass
everything. Recommended: the **Hetzner Cloud Firewall** (applies before traffic reaches the box; undo in the
console if you lock yourself out).

```bash
# on your laptop; hcloud CLI configured (hcloud context create ashantihub)
MYIP=$(curl -fsS https://api.ipify.org)
CF=$( (curl -fsS https://www.cloudflare.com/ips-v4; echo; curl -fsS https://www.cloudflare.com/ips-v6) | grep -v '^$' | paste -sd, -)

hcloud firewall create --name ashantihub-web
hcloud firewall add-rule ashantihub-web --direction in --protocol tcp --port 80   --source-ips "$CF" --description "Cloudflare http"
hcloud firewall add-rule ashantihub-web --direction in --protocol tcp --port 443  --source-ips "$CF" --description "Cloudflare https"
hcloud firewall add-rule ashantihub-web --direction in --protocol tcp --port 22   --source-ips "$MYIP/32" --description "admin ssh"
hcloud firewall add-rule ashantihub-web --direction in --protocol tcp --port 8083 --source-ips "$MYIP/32" --description "Hestia panel"
hcloud firewall add-rule ashantihub-web --direction in --protocol icmp --source-ips 0.0.0.0/0 --source-ips ::/0
hcloud firewall describe ashantihub-web
hcloud firewall apply-to-resource ashantihub-web --type server --server <server-name>
```

Do this on a window when you can reach the Hetzner console. If your home IP changes, SSH stops working until you
update the rule. The Hestia firewall (`v-list-firewall`) stays as a second layer; do not remove its SSH rule.

Verify, from a machine **not** on the allowlist:

```bash
curl -m 5 -sI https://<server-ip> || echo "blocked: good"
curl -sI https://api.theashantihub.com/api/health/ | head -1      # still 200 through Cloudflare
ss -tlnp | grep -E ':(5432|6379)\b' || echo "db/redis not listening publicly: good"
```

**3.6 Cloudflare rules** (dashboard, Security → WAF):
- *Rate limiting rule* (free plan allows few; options are limited): expression
  `http.host eq "api.theashantihub.com" and starts_with(http.request.uri.path, "/api/")`, per IP, a generous
  threshold (phones share carrier IPs; the banner beacon alone allows 240/min), action Block.
- *Custom rule, action Skip/Allow* for the Hubtel webhook and SMS callback paths, so they are never challenged.
  Find them: `grep -rn "path(" backend/payments/urls.py backend/marketing/urls.py | grep -i "hubtel\|callback"`.
- Turn on the managed free ruleset and "block AI scrapers and crawlers" if offered on your plan.
- Notifications → enable DDoS attack alerts to the owner's email.

**3.7 Staging first:** do 3.2–3.6 for `api-test.theashantihub.com` only (leave production records grey), test
sign-in, a webhook replay, `/ws/` staff sockets and uploads; then repeat for production on instruction.

**Rollback:** set the records back to DNS only (grey) in Cloudflare (seconds) and detach the Hetzner firewall:
`hcloud firewall remove-from-resource ashantihub-web --type server --server <server-name>`.

---

## Phase 4. nginx limits as a second layer (G4)

Create `infra/hestia/nginx-conf.d/ashantihub-limits.conf` and install it to `/etc/nginx/conf.d/` (Hestia includes
that directory in the `http` block; confirm with the `nginx -T` command in 3.4):

```nginx
limit_req_zone  $binary_remote_addr zone=ah_api:10m  rate=20r/s;
limit_req_zone  $ah_auth_key        zone=ah_auth:10m rate=20r/m;
limit_conn_zone $binary_remote_addr zone=ah_conn:10m;
limit_req_status  429;
limit_conn_status 429;

# Only sign-in / registration / one-time-code paths get the strict zone; an empty key is never counted.
map $request_uri $ah_auth_key {
	default "";
	~*/(login|register|otp|password-reset)  $binary_remote_addr;
}
```

Confirm the real path names first: `grep -n "path(" backend/accounts/urls.py backend/otp/urls.py | grep -i "login\|register\|otp\|reset"`.

In both API templates, inside `location /`:

```nginx
		limit_req  zone=ah_api  burst=60 nodelay;
		limit_req  zone=ah_auth burst=5  nodelay;
		limit_conn ah_conn 40;
```

Do **not** add a `^~ /.well-known/` location (CLAUDE.md). Deploy: `bash /opt/ashantihub/infra/scripts/install-hestia-templates.sh`
(production checkout only; deploy.sh runs it when templates change). Test with `nginx -t`.

**Rollback:** remove the three lines and the conf.d file, `nginx -t && systemctl reload nginx`.

Also cheap hardening in the same change: gunicorn already has `--timeout=60`; keep `client_max_body_size 25m` only
where uploads happen by adding `client_max_body_size 1m;` to `location /` and a separate `location ~ ^/api/(media|listings|portfolio)/.*upload`
only after you list the real upload paths (`grep -rn "FileField\|ImageField\|MultiPartParser" backend --include=*.py`).

---

## Phase 5. Hide secrets at rest (G5, G6)

### 5a. Encrypt payout numbers and TIN

Encrypted columns cannot be searched or made unique, so each gets a keyed **blind index** (HMAC) next to the
ciphertext. Three releases so nothing breaks: add, backfill, then cut over.

**Keys** (store both in the password manager *and* a second safe place; losing the encryption key makes the
numbers unrecoverable, and never keep the key only on the same server as the backups):

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"      # PAYOUT_FIELD_KEYS (comma list; first encrypts, all decrypt: rotation)
python3 -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"        # PAYOUT_INDEX_KEY
```

Add both to `infra/env/backend.env.example` and validate them in `settings.py` the same way `STAFF_SECRETS_KEY` is
(refuse to start in production when missing or invalid).

New `backend/core/secret_fields.py`:

```python
import hashlib
import hmac

from cryptography.fernet import Fernet, MultiFernet
from django.conf import settings


def _fernet():
    return MultiFernet([Fernet(key.encode()) for key in settings.PAYOUT_FIELD_KEYS])


def encrypt(value):
    return _fernet().encrypt(str(value).encode()).decode()


def decrypt(token):
    return _fernet().decrypt(token.encode()).decode()


def blind_index(value):
    """Same input -> same output, for 'is this number already registered' and the unique constraint."""
    return hmac.new(settings.PAYOUT_INDEX_KEY.encode(), str(value).encode(), hashlib.sha256).hexdigest()
```

**Release 1 (add + dual write).** `wallets.PayoutDestination` gets `account_number_enc = TextField(blank=True, default="")`
and `account_number_hash = CharField(max_length=64, blank=True, default="", db_index=True)`. Writes fill all three
(plaintext still, for now); reads use a `number` property that decrypts when `account_number_enc` is set. Change the
duplicate check in `wallets/destinations.py:116` to filter on `account_number_hash`. Tests first (round trip, hash
stable, old rows still readable).

```bash
docker compose run --rm web python manage.py makemigrations wallets -n encrypt_payout_numbers
docker compose run --rm web python manage.py test wallets
```

**Backfill command** `wallets/management/commands/encrypt_payout_numbers.py`: loops in batches of 500, skips rows
that already have `account_number_enc`, sets enc + hash, is safe to re-run, prints counts.

```bash
docker compose run --rm web python manage.py encrypt_payout_numbers --dry-run
docker compose run --rm web python manage.py encrypt_payout_numbers
docker compose run --rm web python manage.py shell -c "from wallets.models import PayoutDestination as P; print(P.objects.filter(account_number_enc='').count())"   # must be 0
```

**Release 2 (cut over).** Replace the unique constraint with one on `(holder_type, holder_id, rail, account_number_hash)`
(live rows only), stop writing plaintext, and in a data migration set `account_number=''`.

**Release 3 (later).** Drop the plaintext column.

**Same treatment** for `payout_momo_number`, `payout_bank_account_number` and `tin` on the business profile, using
the same helper. List every lookup that must move to a hash:

```bash
grep -rn "payout_momo_number\|payout_bank_account_number\|\btin\b" backend --include=*.py | grep -v "/tests/\|migrations"
```

`mask_but_last` is applied to the decrypted value, so API output does not change.

**Afterwards:** older database backups still hold plaintext. Decide the retention (`backups/` and any off-site copy)
and delete pre-migration dumps once the cut-over is verified. Run on staging first.

**Rollback:** releases 1 and 2 keep the plaintext until you choose to clear it; revert the code and the data is
intact. Release 3 is the point of no return.

### 5b. Argon2 and password-hash upgrade (optional, lower priority)

Django's default PBKDF2 is acceptable. Argon2 is stronger against GPU cracking. Note that every login then costs
~100 MB of RAM while it hashes (Django's default Argon2 settings), which is another reason Phases 1-4 matter first.

```bash
cd backend && .venv/bin/pip install argon2-cffi && .venv/bin/pip freeze | grep -i argon2    # add the pinned line to requirements.txt
```

```python
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",   # keeps old hashes valid
]
```

Then make logins upgrade hashes (they currently cannot, because `check_password` is called without `setter`):

```python
password_valid = check_password(attrs["password"], password_hash, setter=lambda raw: self._rehash(account, raw))
```

where `_rehash` saves `make_password(raw)` to `password_hash`. Regenerate `DUMMY_PASSWORD_HASH` with the new
primary hasher so unknown-account logins take the same time.

### 5c. Encrypt backups

Dumps contain everything. Encrypt before they leave the box:

```bash
apt install age
age-keygen -o ~/ashantihub-backup.key          # keep the private key OFF the server; note the public key printed
# in infra/scripts/backup-db.sh, pipe the dump:  ... | gzip | age -r <public-key> > "$out.gz.age"
age -d -i ~/ashantihub-backup.key backup.sql.gz.age | gunzip | head      # restore test, monthly
```

---

## Phase 6. Crawl control (G7)

1. **Scope for public reads** in `DEFAULT_THROTTLE_RATES`: `"public_read": "120/min"` (shared mobile-carrier
   addresses are common; start generous and tighten from logs). Add `throttle_scope = "public_read"` to the public
   listing, search, business and event list/detail views. Find them:
   `grep -rln "AllowAny" backend --include=views*.py`.
2. **Cap page size**: set `max_page_size` on the paginators (`grep -rn "PAGE_SIZE\|max_page_size\|PageNumberPagination" backend --include=*.py`).
3. **`robots.txt`**: serve one that disallows `/api/` and staff paths. It only stops polite crawlers, which is its
   limit, so the real control is 1 + Cloudflare (3.6).
4. The product rule that businesses cannot be contacted directly already removes most of the value of scraping
   contact lists; do not add contact fields to public responses.

Test: unauthenticated list endpoint returns `429` after the 121st call from one address; authenticated staff calls
are unaffected.

---

## Phase 7. "Under attack" runbook and alerts

**Alerts (set once):** Cloudflare DDoS notifications (3.6); an external uptime check on
`https://api.theashantihub.com/api/health/` every minute (any free uptime monitor); Sentry alert on the log message
`throttle cache unavailable`.

**During an attack:**
1. Confirm it is an attack: Cloudflare → Security → Events; `tail -f /var/log/nginx/domains/api.theashantihub.com.log`.
2. **Website (`theashantihub.com`, `www`):** turn on Under Attack mode:
   ```bash
   curl -X PATCH "https://api.cloudflare.com/client/v4/zones/$CF_ZONE_ID/settings/security_level" \
     -H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json" --data '{"value":"under_attack"}'
   # back to normal afterwards:  --data '{"value":"medium"}'
   ```
   This is zone-wide, and its browser challenge **breaks API calls from the app**. If the API is the target, do
   not use it. Instead add a Cloudflare custom rule that **blocks** the attacking country/ASN/path, tighten the
   rate rule, and keep the app working for everyone else.
3. Wallet safety valve: leave the withdrawal and ledger switches as they are, or turn withdrawals off via the
   existing governed setting while the incident is open.
4. After: write what happened and the rule that stopped it; keep the best rule.

Cloudflare API token: scope it to Zone → Zone Settings → Edit for this zone only; store in the password manager,
never in the repo.

---

## 8. Verification checklist (staging, then production on instruction)

| Check | Command / action | Pass |
|-------|------------------|------|
| Header spoof no longer bypasses login limit | loop in 1.6 | 5 × 400 then 429 |
| Limit is shared across workers | run 1.6 with `GUNICORN_WORKERS=2` | same |
| Redis down does not break sign-in | stop `redis` on staging, log in | login works, ERROR in Sentry |
| Lockout | 11 wrong passwords for one account from changing headers | 429, then OK after 15 min or reset |
| Origin closed | curl server IP from outside | times out |
| Site works through Cloudflare | open site, sign in, upload, staff `/ws/` live updates, webhook replay | all work |
| Mail still works | send/receive `no-reply@` | works |
| Real IP in logs | `tail` access log while visiting | your IP, not Cloudflare's |
| Payout numbers encrypted | `psql` select of `account_number_enc` | ciphertext only |
| Backup restore | monthly age decrypt test (5c) | restores |

## 9. Not in this plan (decide separately)

- **Access-token lifetime** (12 h): shortening needs a refresh-token flow in the frontend. Its own spec.
  Meanwhile step-up OTP on withdrawals limits the damage of a stolen session.
- **Hash-chaining ledger rows**: only if an auditor asks (reuse the `activity` chain job).
- **Paid Cloudflare plans / Super Bot Fight Mode**: revisit after a month of real traffic data.

## 10. Documents to update when this ships

`docs/regulatory/TECHNICAL_AND_CONTROLS_SUMMARY.md` (§12 limitations, security controls), the BoG submission §5.9
and Q&A, and the wallet spec §13 go-live list. Until each phase ships, describe it as **planned**, not in place.

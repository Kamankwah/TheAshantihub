# Staff Foundations 1B — Live Updates, Sessions & 2-Step Sign-in, Approvals, Reports, Per-Role Menus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the staff-platform foundations: Redis + Django Channels on ASGI with a Celery worker and beat, server-side staff sessions with idle/absolute limits, password re-entry and 2-step sign-in, the approvals engine and inbox, the report engine with CSV/Excel/PDF exports, live updates over a ticketed WebSocket, and per-role staff menus.

**Architecture:** Backend work stays in Django apps: `accounts` gains `StaffSession` (every staff JWT's `jti` names one) and `StaffTwoFactor`; three new apps — `approvals` (registry of kinds, maker-checker services, escalation job), `reports` (provider registry, Draft → Submitted → Acknowledged/Returned workflow, exports) and `realtime` (ticket endpoint, `StaffConsumer`, a publisher hooked onto `activity.services.on_recorded`). One Redis per environment carries the channel layer, the realtime-ticket cache and the Celery broker; under `manage.py test` everything runs in-process. The frontend moves the staff nav to a per-role menu config, adds a realtime client, idle sign-out, an automatic password re-entry prompt, and the Approvals, Reports, Sign-in & Security and Sessions & Devices screens, all in the existing inline-`D` style.

**Tech Stack:** Django 5.2 LTS, DRF, SimpleJWT, Postgres 16 (`pg_trgm`), Django Channels 4 + channels-redis, Celery 5.5 + Redis 7, gunicorn with uvicorn workers (ASGI), daphne (local `runserver` only), pyotp + cryptography (Fernet), XlsxWriter, WeasyPrint; React 19 + React Query 5 + Vitest + MSW.

**Spec:** `docs/superpowers/specs/2026-10-07-staff-foundations-design.md` — this plan covers F2, F5, F6, F9 and the rest of F10. Parent: `docs/superpowers/specs/2026-10-07-staff-platform-overview-design.md`. Plan 1A (`docs/superpowers/plans/2026-10-07-staff-foundations-1a.md`) is done and is the base.

**Base branch:** `feature/staff-foundations-1a` (1A complete). Work on a new branch `feature/staff-foundations-1b` cut from it.

## Global Constraints

- Every backend command runs from the worktree root through the local test compose. Shell variables don't survive between agent shell calls, so start each backend command line with:
  `BT="docker compose -p ah1a -f docker-compose.yml -f /tmp/claude-1000/-home-righteoushack-projects-TheAshantihub/6a2aeb55-6465-4fa1-826e-58e43fc944b7/scratchpad/compose-test-override.yml";`
  then `$BT run --rm web python manage.py test --noinput <labels>`. Host ports 5432 and 8000 are taken, so the override publishes no ports. After a `requirements.txt` or `Dockerfile` change, rebuild first: `$BT build web`.
- The test suite needs no Redis: under `manage.py test` the settings force the in-memory channel layer, a local-memory `realtime` cache and eager Celery (`CELERY_TASK_ALWAYS_EAGER`), whatever `REDIS_URL` says.
- The local `docker-compose.yml` gains `redis`, `worker` and `beat` services under the `jobs` profile. None publishes a host port, so the test override needs no new entry; if a port is ever added to `redis`, the override must get `redis: {ports: !reset []}` too.
- Vitest runs from `frontend/` only: `cd frontend && npx vitest run`. MSW is `onUnhandledRequest: 'error'`, so every endpoint a shell-level component calls needs a default handler in `frontend/mocks/handlers.js`. The default for `POST /api/realtime/ticket/` answers 503, so tests never open a WebSocket.
- Staff permission checks read `StaffUser.effective_permission_codenames()` (role + grants − revokes) — never `role.permissions`.
- New permissions in this plan: `approvals.view_all` and `reports.view_all`, granted to `super_admin` only. No support or field-role grant changes, so `test_authentication.py`, `test_login.py` and `test_roles_seed.py`'s `DEFAULT_MATRIX` stay as they are; `test_roles_seed` still requires super_admin to hold every permission.
- Accounts migrations continue from `0034_seed_calls_permissions`: `0035` StaffSession, `0036` StaffTwoFactor, `0037` approvals permission, `0038` reports permission.
- Sessions: idle limit **30 minutes**, absolute limit **12 hours**, `last_seen_at` written **at most once a minute**, password re-entry ("sudo") lasts **10 minutes** on that session only.
- Sudo is required for: staff permission edits, manager changes, staff suspension and deactivation, 2-step setup / turning it off / new recovery codes / resetting someone's, and any report export that contains a report other than the requester's own. Payout and payroll approval will use the same `RequiresSudo` when phase 5 builds them. A refusal is `403 {"detail": "Re-enter your password to continue.", "code": "sudo_required"}`.
- 2-step sign-in: TOTP, 6 digits, 30-second steps, ±1 step of drift, a step is never accepted twice; 10 single-use recovery codes; secrets Fernet-encrypted with the `STAFF_SECRETS_KEY` env var; mandatory for `super_admin` (set up at the next password sign-in), optional for everyone else.
- Approvals: the maker can never decide their own request (`403 "You can't approve your own request."`); returning needs a note; a stale target is refused with `409 "This changed since it was requested — ask for a fresh request."`; a Super Admin's own request applies at once and other Super Admins are notified; reminder at 75% of the response time, move up one level at 100%; the escalation job runs every 5 minutes.
- Reports: periods day / week (Monday–Sunday) / month; due default **19:00 Africa/Accra** on the period's last day; similarity ≥ **0.8** flags; CSV is UTF-8 with a BOM and every cell starting `=`, `+`, `-`, `@`, tab or CR gets a leading `'`; ranges over **31 days** or **5,000 rows** export in the background; download links are signed and valid **24 hours**; every export records `report.exported` with its filters.
- Realtime: tickets are single-use and valid **30 seconds**; groups are `staff.<id>`, `session.<id>`, `role.<role>`, `perm.<codename>` per effective permission, and `team.<manager_id>`; a feed event carries exactly `{type, verb, target: {type, id, label}, actor: {id, name, role}, at, invalidate}` and goes only to staff who could read that event through `GET /api/activity/`; permission groups get `{type: "invalidate", invalidate, at}` only. Customers and business owners get no socket.
- Domain code calls `activity.services.record()` last inside its transaction (it holds a global advisory lock until commit).
- Infra: never touch `deploy.sh`'s `/tmp` re-exec block; never add a `^~` location to a Hestia template and never touch `.well-known`; `/ws/` is a plain prefix location.
- Frontend: inline `style={{}}` from `D`/`glassCard` (`components/admin/theme.js`); mutations are plain `apiPost`/`apiPatch` in handlers with a local `actionError` and `apiErrorMessage()`; components never import `App.jsx`; `StaffDashboard.test.jsx` is a contract — it must pass unchanged.
- No fabricated data: empty states say so honestly; design-canvas menu items whose screens don't exist yet are left out of the menus, never shown as dead links.
- Commit messages follow the repo style (`feat(staff): …`, `chore(infra): …`) and end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01CPzLdTaySS6wWWArSXaLps
  ```

## Review Focus

1. **Redis is down** → sign-in and every REST endpoint keep working; only live updates and background jobs stop, and `/api/health/` still answers 200 with `"redis": "down"`. The login throttles therefore stay on the local-memory `default` cache. Pinned by `test_sign_in_throttles_never_depend_on_redis` and `test_redis_down_is_reported_but_the_api_stays_healthy` (Task 1).
2. **A staff token minted before this deploy, or a session ended on another device** → the API answers 401 and the open dashboard lands on the staff sign-in with a short reason, instead of looping on errors. Pinned by `test_a_token_with_no_session_is_refused` (Task 2) and the `session-ended` tests in Task 11.
3. **Two approvers press Approve on the same request at the same moment** (a manager and a Super Admin, both allowed) → exactly one decision wins, `apply` runs once, the other approver gets 400 "already decided". Pinned by `ConcurrentDecisionTests` (Task 5); the escalation job takes the same row lock with `skip_locked`, so it never moves a request mid-decision.
4. **A 2-step code or challenge used twice or in the wrong place** — the same TOTP code replayed, the enrolment code reused to sign in, a verify challenge used to start enrolment, an expired challenge → all refused. Pinned in Task 4.
5. **The password prompt is cancelled, the password is wrong, or two protected actions fire at once** → nothing is retried after a cancel, a wrong password shows inline and keeps the prompt open, and two parallel 403s show one prompt and both retry after one correct password. Pinned by `SudoPrompt.test.jsx` (Task 14).

---

### Task 1: Live-update and background-job infrastructure

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/ashantihub/settings.py` (imports, `INSTALLED_APPS`, new block at the end)
- Modify: `backend/ashantihub/asgi.py`, `backend/ashantihub/__init__.py`
- Create: `backend/ashantihub/celery.py`
- Create: `backend/activity/tasks.py`
- Modify: `backend/core/views.py` (`health_check`), `backend/core/tests/test_health_check.py`
- Create: `backend/core/tests/test_background_jobs.py`, `backend/activity/tests/test_nightly_check.py`
- Modify: `docker-compose.yml`, `infra/compose/docker-compose.yml`, `backend/Dockerfile.prod`, `infra/scripts/deploy.sh`, `infra/hestia/templates/ashantihub-api.tpl.in`, `infra/hestia/templates/ashantihub-api.stpl.in`, `infra/cron/ashantihub.cron`, `infra/env/backend.env.example`, `backend/.gitignore`, `backend/.dockerignore`

**Interfaces:**
- Consumes: 1A's `verify_activity_chain` command and `notify_staff_role`.
- Produces:
  - settings `TESTING`, `REDIS_URL`, `USE_REDIS`, `CACHES["realtime"]`, `CHANNEL_LAYERS`, `CELERY_*`, `CELERY_BEAT_SCHEDULE` (later tasks add entries), `ACTIVITY_SEAL_EMAIL`, `PRIVATE_MEDIA_ROOT`
  - `ashantihub.celery.app`; tasks are `@shared_task` functions in `<app>/tasks.py`
  - `ashantihub.asgi.application` — a `ProtocolTypeRouter` with `"http"` (Task 10 adds `"websocket"`)
  - `activity.tasks.verify_activity_chain_nightly()`
  - `GET /api/health/` → `{"status": "ok", "redis": "ok" | "down" | "not_configured"}`
  - compose services `db`, `redis`, `web`, `worker`, `beat`; all three app services share the image `${APP_IMAGE}`; `backend/private` is bind-mounted into `web` and `worker`

- [ ] **Step 1: Write the failing tests**

`backend/core/tests/test_background_jobs.py`:
```python
from django.conf import settings
from django.test import SimpleTestCase

from ashantihub.celery import app


class BackgroundJobSettingsTests(SimpleTestCase):
    def test_the_test_suite_needs_no_redis(self):
        self.assertFalse(settings.USE_REDIS)
        self.assertEqual(settings.CHANNEL_LAYERS["default"]["BACKEND"], "channels.layers.InMemoryChannelLayer")
        self.assertEqual(settings.CACHES["realtime"]["BACKEND"], "django.core.cache.backends.locmem.LocMemCache")
        self.assertTrue(settings.CELERY_TASK_ALWAYS_EAGER)

    def test_sign_in_throttles_never_depend_on_redis(self):
        # Review Focus 1: the default cache backs the login throttles and must
        # stay local-memory even in production, so a Redis outage can't take
        # sign-in down.
        self.assertEqual(settings.CACHES["default"]["BACKEND"], "django.core.cache.backends.locmem.LocMemCache")

    def test_every_scheduled_job_names_a_registered_task(self):
        app.loader.import_default_modules()
        for name, entry in settings.CELERY_BEAT_SCHEDULE.items():
            self.assertIn(entry["task"], app.tasks, name)

    def test_the_asgi_application_serves_http(self):
        from ashantihub.asgi import application

        self.assertIn("http", application.application_mapping)
```

`backend/activity/tests/test_nightly_check.py`:
```python
from django.core import mail
from django.core.management.base import CommandError
from django.db import connection
from django.test import TestCase, override_settings

from accounts.models import Role, StaffUser
from activity import services
from activity.tasks import verify_activity_chain_nightly
from notifications.models import Notification


class NightlyChainCheckTests(TestCase):
    def setUp(self):
        self.boss = StaffUser.objects.create(
            full_name="Simon Peter", email="boss@example.com", password_hash="x",
            role=Role.objects.get(name="super_admin"),
        )

    def test_a_clean_chain_passes_without_alerts(self):
        services.record(None, "test.ok")
        verify_activity_chain_nightly()
        self.assertFalse(Notification.objects.filter(kind="activity_chain_broken").exists())
        self.assertEqual(len(mail.outbox), 0)

    @override_settings(ACTIVITY_SEAL_EMAIL=True)
    def test_production_emails_the_seal(self):
        services.record(None, "test.ok")
        verify_activity_chain_nightly()
        self.assertEqual(mail.outbox[0].to, ["boss@example.com"])

    def test_a_broken_chain_alerts_super_admins_and_fails_the_job(self):
        events = [services.record(None, f"test.{i}") for i in range(2)]
        with connection.cursor() as cursor:
            cursor.execute("ALTER TABLE activity_activityevent DISABLE TRIGGER activity_event_no_update")
            cursor.execute("UPDATE activity_activityevent SET summary = 'forged' WHERE id = %s", [events[0].pk])
            cursor.execute("ALTER TABLE activity_activityevent ENABLE TRIGGER activity_event_no_update")
        with self.assertRaises(CommandError):
            verify_activity_chain_nightly()
        self.assertTrue(Notification.objects.filter(staff=self.boss, kind="activity_chain_broken").exists())
```

Replace the whole of `backend/core/tests/test_health_check.py`:
```python
from django.test import override_settings
from rest_framework.test import APITestCase


class HealthCheckTests(APITestCase):
    @override_settings(REDIS_URL="")
    def test_health_check_returns_ok(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "redis": "not_configured"})

    @override_settings(REDIS_URL="redis://127.0.0.1:1/0")
    def test_redis_down_is_reported_but_the_api_stays_healthy(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "redis": "down"})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$BT run --rm web python manage.py test --noinput core.tests.test_background_jobs core.tests.test_health_check activity.tests.test_nightly_check`
Expected: ERROR — `No module named 'ashantihub.celery'` / `No module named 'activity.tasks'`, and the health payload lacks `redis`.

- [ ] **Step 3: Add the dependencies**

Look up the newest release in each series (note them down):
```bash
$BT run --rm --no-deps web pip index versions channels          # newest 4.x
$BT run --rm --no-deps web pip index versions channels-redis    # newest 4.x
$BT run --rm --no-deps web pip index versions daphne            # newest 4.x
$BT run --rm --no-deps web pip index versions celery            # newest 5.5.x
$BT run --rm --no-deps web pip index versions uvicorn           # newest
$BT run --rm --no-deps web pip index versions uvicorn-worker    # newest
```
Append to `backend/requirements.txt`, with the exact versions you noted in place of each `X`:
```
# Live updates and background jobs (staff foundations F2). daphne only makes
# the local `runserver` speak WebSockets; production serves ASGI through
# gunicorn with uvicorn workers.
channels==X
channels-redis==X
daphne==X
celery[redis]==X
uvicorn[standard]==X
uvicorn-worker==X
```
Then rebuild and pin the Redis client pip resolved (the health check and Django's Redis cache import it directly):
```bash
$BT build web
$BT run --rm --no-deps web pip freeze | grep -iE "^redis=="
```
Append the printed line (e.g. `redis==5.2.1`) to `requirements.txt` under the block above.

- [ ] **Step 4: Settings**

In `backend/ashantihub/settings.py`, add `import sys` under `from pathlib import Path`, and `from celery.schedules import crontab` under `from django.core.exceptions import ImproperlyConfigured`. Make `"daphne"` the **first** entry of `INSTALLED_APPS` (its `runserver` must override the stock one):
```python
INSTALLED_APPS = [
    # Makes the local `manage.py runserver` serve ASGI, WebSockets included
    # (staff foundations F2). Production runs gunicorn + uvicorn workers.
    "daphne",
    "django.contrib.contenttypes",
```
Append at the very end of the file:
```python
# ── Live updates and background jobs (staff foundations F2) ─────────────────
# One Redis per environment (infra/compose/docker-compose.yml) carries the
# Channels layer, the realtime-ticket cache and the Celery broker. With
# REDIS_URL unset (plain local dev) — and ALWAYS under `manage.py test`, so
# the suite never needs Redis — everything runs in-process instead: the
# in-memory channel layer, a local-memory ticket cache and eager Celery.
#
# The "default" cache deliberately stays local-memory even in production:
# the login throttles read it, and a Redis outage must never take sign-in
# down (spec §3: "Redis down: sockets fail, polling continues").
TESTING = len(sys.argv) > 1 and sys.argv[1] == "test"
REDIS_URL = env("REDIS_URL", default="")
USE_REDIS = bool(REDIS_URL) and not TESTING

CACHES = {
    "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
    "realtime": (
        {"BACKEND": "django.core.cache.backends.redis.RedisCache", "LOCATION": REDIS_URL, "KEY_PREFIX": "ah"}
        if USE_REDIS
        else {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "realtime"}
    ),
}
CHANNEL_LAYERS = {
    "default": (
        {"BACKEND": "channels_redis.core.RedisChannelLayer", "CONFIG": {"hosts": [REDIS_URL]}}
        if USE_REDIS
        else {"BACKEND": "channels.layers.InMemoryChannelLayer"}
    )
}

CELERY_BROKER_URL = REDIS_URL if USE_REDIS else "memory://"
CELERY_TASK_ALWAYS_EAGER = not USE_REDIS
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_TASK_IGNORE_RESULT = True
CELERY_TIMEZONE = TIME_ZONE
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
# Each job's owning app adds its own entry; core/tests/test_background_jobs.py
# fails if an entry names a task that doesn't exist. Times are Africa/Accra.
CELERY_BEAT_SCHEDULE = {
    "activity-verify-chain": {
        "task": "activity.tasks.verify_activity_chain_nightly",
        "schedule": crontab(hour=1, minute=45),
    },
}

# Production sets this True so the nightly activity check emails its seal to
# every Super Admin; staging only verifies.
ACTIVITY_SEAL_EMAIL = env.bool("ACTIVITY_SEAL_EMAIL", default=False)

# Files only a permission-checked view may serve (report exports, F6). Never
# under MEDIA_ROOT, which nginx serves to anyone.
PRIVATE_MEDIA_ROOT = BASE_DIR / "private"
```

- [ ] **Step 5: The Celery app and the ASGI entry point**

`backend/ashantihub/celery.py`:
```python
import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ashantihub.settings")

# Worker: celery -A ashantihub worker   ·   Scheduler: celery -A ashantihub beat
# Settings prefixed CELERY_ in ashantihub/settings.py configure it; tasks are
# @shared_task functions in each app's tasks.py.
app = Celery("ashantihub")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()
```
Replace `backend/ashantihub/__init__.py` (currently empty) with:
```python
# Load Celery with Django so @shared_task binds to this project's app.
from .celery import app as celery_app

__all__ = ("celery_app",)
```
Replace `backend/ashantihub/asgi.py`:
```python
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ashantihub.settings")
# Initialise Django before importing anything that touches models.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter  # noqa: E402

# HTTP and (from Task 10) WebSockets from one process type — gunicorn with
# uvicorn workers in production, daphne's runserver locally.
application = ProtocolTypeRouter({"http": django_asgi_app})
```

- [ ] **Step 6: The nightly activity check as a Celery task**

`backend/activity/tasks.py`:
```python
from celery import shared_task
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError

from notifications.services import notify_staff_role


@shared_task
def verify_activity_chain_nightly():
    """F4's nightly chain check, run by Celery beat (it replaces the host cron
    lines plan 1A added). A break raises — the command logs it at ERROR, which
    Sentry captures — and alerts every Super Admin in-app."""
    try:
        call_command("verify_activity_chain", email_seal=settings.ACTIVITY_SEAL_EMAIL)
    except CommandError as exc:
        notify_staff_role(
            "activity.view_all", "activity_chain_broken", "Activity log check failed",
            body=f"{exc}. Investigate before anything else; never repair rows by hand.",
            link="activity", icon="🚨",
        )
        raise
```

- [ ] **Step 7: Report Redis in the health check**

In `backend/core/views.py` add `from django.conf import settings` at the top and replace `health_check` with:
```python
def _redis_state():
    """For System health (phase 7). The API itself never depends on Redis."""
    if not settings.REDIS_URL:
        return "not_configured"
    try:
        import redis

        redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=1).ping()
    except Exception:
        return "down"
    return "ok"


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(request):
    return Response({"status": "ok", "redis": _redis_state()})
```

- [ ] **Step 8: Run the tests**

Run: `$BT run --rm web python manage.py test --noinput core activity`
Expected: OK.

- [ ] **Step 9: The production stack**

Replace `infra/compose/docker-compose.yml` with (header comment kept, services rewritten):
```yaml
# AshantiHub application stack — one instance per environment.
#
#   production  /opt/ashantihub          project "ashantihub"          API on 127.0.0.1:8000
#   staging     /opt/ashantihub-staging  project "ashantihub-staging"  API on 127.0.0.1:8001
#
# Both are started by infra/scripts/deploy.sh, which reads the checkout's own
# untracked .deploy.conf and passes the project name, port and image tag
# explicitly, so the two stacks never share containers, networks, images or
# database volumes.
#
# Nothing here is published to the public internet: the API binds to 127.0.0.1
# and HestiaCP's nginx terminates TLS in front of it (see infra/hestia/).

x-logging: &default-logging
  driver: json-file
  options:
    max-size: "10m"
    max-file: "5"

# Shared by web, worker and beat. Only `web` builds; worker and beat run the
# very image web just built (the same APP_IMAGE tag, written per environment
# by deploy.sh), so the three can never run different code.
x-app: &app
  image: ${APP_IMAGE:-ashantihub-app}
  restart: unless-stopped
  env_file: ../../backend/.env
  extra_hosts:
    # Django sends mail through the host's Exim, which queues, signs with
    # DKIM and relays onward. The bridge gateway IP differs per environment
    # and can change when a network is recreated, so EMAIL_HOST resolves
    # this name instead of a hardcoded address.
    - "host.docker.internal:host-gateway"
  logging: *default-logging

services:
  db:
    image: postgres:16
    restart: unless-stopped
    # Same file the app reads, so POSTGRES_* can never drift between the two.
    env_file: ../../backend/.env
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      # $$ escapes the variable past Compose's own interpolation so it is the
      # container's shell that expands it.
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER:-ashantihub} -d $${POSTGRES_DB:-ashantihub}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s
    logging: *default-logging

  # Channels layer, realtime tickets and the Celery broker (staff foundations
  # F2). Nothing in it is precious — no persistence — and it is never
  # published to the host. volatile-lru only ever evicts keys that carry a
  # TTL (cached tickets, channel messages), never queued Celery jobs.
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    env_file: ../../backend/.env
    command: ["sh", "-c", "exec redis-server --requirepass \"$$REDIS_PASSWORD\" --maxmemory 128mb --maxmemory-policy volatile-lru --save '' --appendonly no"]
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \"$$REDIS_PASSWORD\" --no-auth-warning ping | grep -q PONG"]
      interval: 10s
      timeout: 5s
      retries: 5
    logging: *default-logging

  web:
    <<: *app
    build:
      context: ../../backend
      dockerfile: Dockerfile.prod
    # ASGI: HTTP and WebSockets from the same workers. Sync DRF views still
    # run one at a time per worker, exactly as under the old sync workers.
    command:
      - gunicorn
      - ashantihub.asgi:application
      - --worker-class=uvicorn_worker.UvicornWorker
      - --bind=0.0.0.0:8000
      - --workers=${GUNICORN_WORKERS:-4}
      - --timeout=60
      - --access-logfile=-
      - --error-logfile=-
    ports:
      # Bound to loopback on purpose — the only way in is through nginx.
      - "127.0.0.1:${APP_PORT:-8000}:8000"
    volumes:
      # Uploads and collected static live on the host so nginx can serve them
      # directly; Django never serves either when DEBUG=False. private/ holds
      # report exports, which only a permission-checked view serves.
      - ../../backend/media:/app/media
      - ../../backend/staticfiles:/app/staticfiles
      - ../../backend/private:/app/private
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      # X-Forwarded-Proto mimics nginx: without it SECURE_SSL_REDIRECT (on
      # whenever DEBUG=False) answers this loopback probe with a 301 to https
      # instead of the health payload. DJANGO_ALLOWED_HOSTS must also include
      # 127.0.0.1, or Django rejects the probe's Host header with a 400.
      # Quoted as one string on purpose: unquoted, YAML reads the
      # "X-Forwarded-Proto: https" header as a nested mapping.
      test: ["CMD-SHELL", "curl -fsS -H 'X-Forwarded-Proto: https' http://127.0.0.1:8000/api/health/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # Background jobs: approval escalation, report reminders and exports,
  # session cleanup, the nightly activity check (see CELERY_BEAT_SCHEDULE).
  worker:
    <<: *app
    command: ["celery", "-A", "ashantihub", "worker", "--loglevel=INFO", "--concurrency=2"]
    volumes:
      - ../../backend/media:/app/media
      - ../../backend/private:/app/private
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy

  # Exactly one scheduler per environment, or every job would run twice.
  beat:
    <<: *app
    command: ["celery", "-A", "ashantihub", "beat", "--loglevel=INFO", "--schedule=/tmp/celerybeat-schedule"]
    depends_on:
      redis:
        condition: service_healthy

volumes:
  pgdata:
```
In `backend/Dockerfile.prod`, change the header comment's "runs gunicorn as a non-root user" to "runs gunicorn with uvicorn workers (ASGI) as a non-root user" and replace the `CMD`:
```dockerfile
CMD ["gunicorn", "ashantihub.asgi:application", \
     "--worker-class=uvicorn_worker.UvicornWorker", \
     "--bind=0.0.0.0:8000", \
     "--workers=4", \
     "--timeout=60", \
     "--access-logfile=-", \
     "--error-logfile=-"]
```
Add `private/` under `media/` in both `backend/.gitignore` and `backend/.dockerignore`.

Replace the local `docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: ashantihub
      POSTGRES_USER: ashantihub
      POSTGRES_PASSWORD: ashantihub_dev
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
  web:
    build: ./backend
    command: python manage.py runserver 0.0.0.0:8000
    volumes:
      - ./backend:/app
    ports:
      - "8000:8000"
    env_file:
      - ./backend/.env
    depends_on:
      - db
  # Optional: a real Redis and the background-job processes, like production.
  # Without them (plain `docker compose up`), REDIS_URL stays unset and Django
  # runs everything in-process — eager Celery, in-memory channel layer — so
  # live updates still work through runserver. To use them, add
  # REDIS_URL=redis://redis:6379/0 to backend/.env and run
  # `docker compose --profile jobs up`. None of these publish a host port.
  redis:
    image: redis:7-alpine
    profiles: ["jobs"]
  worker:
    build: ./backend
    profiles: ["jobs"]
    command: celery -A ashantihub worker --loglevel=INFO
    volumes:
      - ./backend:/app
    env_file:
      - ./backend/.env
    depends_on:
      - db
      - redis
  beat:
    build: ./backend
    profiles: ["jobs"]
    command: celery -A ashantihub beat --loglevel=INFO --schedule=/tmp/celerybeat-schedule
    volumes:
      - ./backend:/app
    env_file:
      - ./backend/.env
    depends_on:
      - redis
volumes:
  pgdata:
```

- [ ] **Step 10: deploy.sh brings up the new services (re-exec block untouched)**

In `infra/scripts/deploy.sh` make exactly these edits:
1. In the `cat > "$APP_DIR/infra/compose/.env" <<ENVVARS` heredoc, add a line after `GUNICORN_WORKERS=$GUNICORN_WORKERS`:
   ```
   APP_IMAGE=$PROJECT-app
   ```
   (`$PROJECT` is already set from `.deploy.conf`, so production builds `ashantihub-app` and staging `ashantihub-staging-app` — the two environments never share an image tag.) Leave the comments around the heredoc as they are.
2. Replace
   ```bash
   log "Starting the database"
   "${COMPOSE[@]}" up -d db
   ```
   with
   ```bash
   log "Starting the database and Redis"
   "${COMPOSE[@]}" up -d db redis
   ```
3. Replace the ownership block's two lines with:
   ```bash
   mkdir -p "$APP_DIR/backend/media" "$APP_DIR/backend/staticfiles" "$APP_DIR/backend/private"
   chown -R 10001:10001 "$APP_DIR/backend/media" "$APP_DIR/backend/staticfiles" "$APP_DIR/backend/private"
   ```
4. Replace
   ```bash
   log "Starting the application"
   "${COMPOSE[@]}" up -d web
   ```
   with
   ```bash
   log "Starting the application, worker and scheduler"
   "${COMPOSE[@]}" up -d web worker beat
   ```
5. Directly after the `curl ... || { ... }` block that checks the API, insert:
   ```bash
   log "Waiting for the background worker"
   for _ in $(seq 1 30); do
   	if "${COMPOSE[@]}" exec -T worker celery -A ashantihub inspect ping --timeout 5 >/dev/null 2>&1; then
   		echo "  worker answering"
   		break
   	fi
   	sleep 2
   done
   "${COMPOSE[@]}" exec -T worker celery -A ashantihub inspect ping --timeout 5 >/dev/null || {
   	echo "FATAL: the Celery worker did not answer. Recent logs:" >&2
   	"${COMPOSE[@]}" logs --tail=60 worker >&2
   	exit 1
   }
   ```
   (Tabs, matching the file's indentation.)

- [ ] **Step 11: nginx `/ws/` location (plain prefix, never `^~`)**

In both `infra/hestia/templates/ashantihub-api.tpl.in` and `ashantihub-api.stpl.in`, insert directly **above** `location / {`:
```nginx
	# Live updates (Django Channels, staff foundations F2). A plain prefix
	# location: "^~" would outrank Hestia's ACME regex location (see the
	# note above) and break certificate renewal.
	location /ws/ {
		proxy_pass http://127.0.0.1:__UPSTREAM_PORT__;
		proxy_http_version 1.1;
		proxy_set_header Upgrade           $http_upgrade;
		proxy_set_header Connection        "upgrade";
		proxy_set_header Host              $host;
		proxy_set_header X-Real-IP         $remote_addr;
		proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;
		# A quiet socket stays open; the client reconnects if it drops.
		proxy_read_timeout 3600s;
		proxy_send_timeout 3600s;
		proxy_buffering    off;
	}

```

- [ ] **Step 12: Cron and the env template**

In `infra/cron/ashantihub.cron` replace the `# Activity-log integrity: …` comment and its two `verify_activity_chain` lines with:
```
# The activity-log integrity check runs in Celery beat since plan 1B
# (CELERY_BEAT_SCHEDULE "activity-verify-chain", 01:45 Africa/Accra).
# Production sets ACTIVITY_SEAL_EMAIL=True so the seal is emailed.
```
In `infra/env/backend.env.example` add before `# ── Optional`:
```
# ── Live updates and background jobs ───────────────────────────────────────
# The redis container reads REDIS_PASSWORD; Django, the Celery worker and
# beat read REDIS_URL. Put the SAME password in both (env files don't
# substitute variables). Generate with:
#   python -c "import secrets; print(secrets.token_urlsafe(32))"
REDIS_PASSWORD=
REDIS_URL=redis://:PASTE_REDIS_PASSWORD_HERE@redis:6379/0
# True in production only: the nightly activity-log check emails its seal
# to every Super Admin. Staging only verifies.
ACTIVITY_SEAL_EMAIL=False

```

- [ ] **Step 13: Validate the stack definition and the production image**

```bash
docker compose -f infra/compose/docker-compose.yml config -q && echo compose-ok
bash -n infra/scripts/deploy.sh && echo deploy-syntax-ok
grep -n "location" infra/hestia/templates/ashantihub-api.tpl.in infra/hestia/templates/ashantihub-api.stpl.in
docker build -q -f backend/Dockerfile.prod -t ah1b-prod-smoke backend
docker run --rm -e DJANGO_DEBUG=True ah1b-prod-smoke python -c "import os, django; os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'ashantihub.settings'); django.setup(); import ashantihub.asgi, uvicorn_worker, celery; print('prod-image-ok')"
docker image rm ah1b-prod-smoke
```
Expected: `compose-ok`, `deploy-syntax-ok`, the grep lists `location /ws/` with no `^~` and the existing `location ~ /\.(?!well-known\/)` untouched, then `prod-image-ok`.

- [ ] **Step 14: Commit**

```bash
git add backend docker-compose.yml infra
git commit -m "feat(infra): Redis, Channels on ASGI, Celery worker and beat, /ws/ proxy

The nightly activity-chain check moves from host cron to Celery beat; the
health check reports Redis without depending on it."
```

---
### Task 2: Server-side staff sessions

**Files:**
- Modify: `backend/accounts/models.py` (add `StaffSession`; `from django.utils import timezone`)
- Create: `backend/accounts/migrations/0035_staffsession.py` (generated)
- Create: `backend/accounts/sessions.py`, `backend/accounts/testing.py`, `backend/accounts/tasks.py`
- Modify: `backend/accounts/authentication.py` (`issue_token`, `MultiAccountJWTAuthentication.authenticate`)
- Modify: `backend/accounts/views.py` (`StaffActivateView`, `StaffLoginView`, `StaffLogoutView`, `StaffSuspendView`, `StaffDeactivateView`)
- Modify: `backend/accounts/serializers.py` (`PasswordResetConfirmSerializer.save`, `StaffListSerializer.last_sign_in_at`)
- Modify: `backend/activity/services.py` (public `client_ip`)
- Modify: `backend/ashantihub/settings.py` (`CELERY_BEAT_SCHEDULE` entry)
- Test: `backend/accounts/tests/test_staff_sessions.py`

**Interfaces:**
- Consumes: Task 1 (Celery, beat schedule); 1A's `activity.services._client_ip`.
- Produces:
  - `accounts.models.StaffSession` — fields `staff`, `jti`, `device_label`, `ip`, `user_agent`, `two_factor`, `created_at`, `last_seen_at`, `revoked_at`, `revoked_reason`, `sudo_until`; reason constants `SIGNED_OUT`, `ENDED`, `SIGNED_OUT_EVERYWHERE`, `SUSPENDED`, `DEACTIVATED`, `PASSWORD_RESET`, `IDLE`, `EXPIRED`; reverse `staff.sessions`
  - `accounts.sessions`: `IDLE_LIMIT`, `ABSOLUTE_LIMIT`, `SEEN_WRITE_INTERVAL`, `SUDO_WINDOW`, `RETENTION`, `ENDED_MESSAGE`, `SUDO_MESSAGE`; `describe_device(user_agent) -> str`; `start(staff, jti, request=None, *, two_factor=False) -> StaffSession`; `end_reason_if_invalid(session, now=None) -> str | None`; `validate(staff, token) -> StaffSession` (raises `AuthenticationFailed`); `touch(session, now=None)`; `current(request) -> StaffSession | None`; `revoke(session, reason) -> int`; `revoke_all(staff, reason, *, except_session=None) -> int`; `grant_sudo(session, now=None) -> datetime`; `has_sudo(request) -> bool`; `require_sudo(request)` (raises the `sudo_required` 403); `cleanup(now=None) -> int`
  - `accounts.authentication.issue_token(account, account_type, *, request=None, two_factor=False) -> str` — a staff token opens a session
  - `accounts.testing.staff_token(staff, *, sudo=False) -> str` (test helper)
  - `accounts.tasks.cleanup_staff_sessions()` (beat, daily 03:30)
  - `activity.services.client_ip(request) -> str | None`
  - `StaffListSerializer` gains `last_sign_in_at`

- [ ] **Step 1: Write the failing tests**

`backend/accounts/tests/test_staff_sessions.py`:
```python
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts.authentication import issue_token
from accounts.models import Customer, PasswordResetToken, Role, StaffSession, StaffUser
from accounts.tasks import cleanup_staff_sessions
from accounts.testing import staff_token

PASSWORD = "correct-horse-1"


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash=make_password(PASSWORD),
        role=Role.objects.get(name=role), **extra,
    )


def session_of(token):
    return StaffSession.objects.get(jti=AccessToken(token)["jti"])


class StaffSessionTests(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.esi = make_staff("support", "esi@example.com")
        self.boss = make_staff("super_admin", "boss@example.com")

    def use(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")

    def me(self):
        return self.client.get("/api/accounts/me/")

    def test_sign_in_opens_a_session_named_by_the_token(self):
        response = self.client.post(
            "/api/accounts/staff/login/", {"identifier": "esi@example.com", "password": PASSWORD}, format="json",
            HTTP_USER_AGENT="Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36",
            HTTP_X_REAL_IP="154.160.24.91",
        )
        session = session_of(response.json()["token"])
        self.assertEqual(session.staff, self.esi)
        self.assertEqual(session.device_label, "Chrome on Android device")
        self.assertEqual(session.ip, "154.160.24.91")
        self.assertIsNone(session.revoked_at)

    def test_customer_tokens_open_no_session(self):
        customer = Customer.objects.create(full_name="Yaw Mensah", phone="0240000001", password_hash="x")
        issue_token(customer, "customer")
        self.assertFalse(StaffSession.objects.exists())

    def test_a_token_with_no_session_is_refused(self):
        # Review Focus 2: every staff token minted before this release has no
        # session row behind it.
        token = AccessToken()
        token["sub"] = str(self.esi.pk)
        token["account_type"] = "staff"
        self.use(str(token))
        self.assertEqual(self.me().status_code, 401)

    def test_thirty_minutes_idle_ends_the_session(self):
        token = issue_token(self.esi, "staff")
        StaffSession.objects.update(last_seen_at=timezone.now() - timedelta(minutes=31))
        self.use(token)
        self.assertEqual(self.me().status_code, 401)
        self.assertEqual(session_of(token).revoked_reason, StaffSession.IDLE)

    def test_twelve_hours_ends_even_an_active_session(self):
        token = issue_token(self.esi, "staff")
        StaffSession.objects.update(created_at=timezone.now() - timedelta(hours=12, minutes=1))
        self.use(token)
        self.assertEqual(self.me().status_code, 401)
        self.assertEqual(session_of(token).revoked_reason, StaffSession.EXPIRED)

    def test_last_seen_is_written_at_most_once_a_minute(self):
        token = issue_token(self.esi, "staff")
        recent = timezone.now() - timedelta(seconds=30)
        StaffSession.objects.update(last_seen_at=recent)
        self.use(token)
        self.me()
        self.assertEqual(session_of(token).last_seen_at, recent)
        StaffSession.objects.update(last_seen_at=timezone.now() - timedelta(seconds=90))
        self.me()
        self.assertGreater(session_of(token).last_seen_at, timezone.now() - timedelta(seconds=10))

    def test_sign_out_ends_this_session_only(self):
        first, second = issue_token(self.esi, "staff"), issue_token(self.esi, "staff")
        self.use(first)
        self.assertEqual(self.client.post("/api/accounts/staff/logout/", {}, format="json").status_code, 204)
        self.assertEqual(self.me().status_code, 401)
        self.assertEqual(session_of(first).revoked_reason, StaffSession.SIGNED_OUT)
        self.use(second)
        self.assertEqual(self.me().status_code, 200)

    def test_suspension_and_deactivation_end_every_session(self):
        tokens = [issue_token(self.esi, "staff") for _ in range(2)]
        self.use(staff_token(self.boss, sudo=True))
        self.client.post(f"/api/accounts/staff/{self.esi.id}/suspend/", {"reason": "investigation"}, format="json")
        self.assertEqual({session_of(t).revoked_reason for t in tokens}, {StaffSession.SUSPENDED})
        self.client.post(f"/api/accounts/staff/{self.esi.id}/unsuspend/", {}, format="json")
        token = issue_token(self.esi, "staff")
        self.client.post(f"/api/accounts/staff/{self.esi.id}/deactivate/", {}, format="json")
        self.assertEqual(session_of(token).revoked_reason, StaffSession.DEACTIVATED)

    def test_a_password_reset_ends_every_staff_session(self):
        token = issue_token(self.esi, "staff")
        PasswordResetToken.objects.create(
            account_type="staff", account_id=self.esi.id, token="r" * 43,
            expires_at=timezone.now() + timedelta(hours=1),
        )
        response = APIClient().post(
            "/api/accounts/password-reset/confirm/",
            {"token": "r" * 43, "account_type": "staff", "password": "a-new-password-9"}, format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(session_of(token).revoked_reason, StaffSession.PASSWORD_RESET)

    def test_the_test_helper_can_unlock_sudo(self):
        self.assertGreater(session_of(staff_token(self.esi, sudo=True)).sudo_until, timezone.now())
        self.assertIsNone(session_of(staff_token(self.esi)).sudo_until)

    def test_the_roster_shows_last_sign_in(self):
        issue_token(self.esi, "staff")
        self.use(staff_token(self.boss))
        rows = {row["id"]: row for row in self.client.get("/api/accounts/staff/").json()["results"]}
        self.assertIsNotNone(rows[self.esi.id]["last_sign_in_at"])


class SessionCleanupTests(TestCase):
    def test_cleanup_ends_stale_sessions_and_forgets_old_ones(self):
        staff = make_staff("support", "esi@example.com")
        now = timezone.now()
        idle = StaffSession.objects.create(staff=staff, jti="a" * 32, last_seen_at=now - timedelta(hours=1))
        old = StaffSession.objects.create(
            staff=staff, jti="b" * 32, created_at=now - timedelta(days=91), last_seen_at=now - timedelta(days=91)
        )
        live = StaffSession.objects.create(staff=staff, jti="c" * 32)
        cleanup_staff_sessions()
        idle.refresh_from_db()
        live.refresh_from_db()
        self.assertEqual(idle.revoked_reason, StaffSession.IDLE)
        self.assertIsNone(live.revoked_at)
        self.assertFalse(StaffSession.objects.filter(pk=old.pk).exists())
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$BT run --rm web python manage.py test --noinput accounts.tests.test_staff_sessions`
Expected: ERROR — `cannot import name 'StaffSession'`.

- [ ] **Step 3: The model**

In `backend/accounts/models.py` add `from django.utils import timezone` under `from django.db import models`, and after `class RoleInviteRule` add:
```python
class StaffSession(models.Model):
    """One signed-in device (staff foundations F9). The access token's `jti`
    names its row; accounts/sessions.py holds the rules (30-minute idle limit,
    12-hour absolute limit, password re-entry)."""

    SIGNED_OUT = "signed_out"
    ENDED = "ended"
    SIGNED_OUT_EVERYWHERE = "signed_out_everywhere"
    SUSPENDED = "suspended"
    DEACTIVATED = "deactivated"
    PASSWORD_RESET = "password_reset"
    IDLE = "idle"
    EXPIRED = "expired"
    REASON_CHOICES = [
        (SIGNED_OUT, "Signed out"),
        (ENDED, "Ended from another device"),
        (SIGNED_OUT_EVERYWHERE, "Signed out of every device by a Super Admin"),
        (SUSPENDED, "Account suspended"),
        (DEACTIVATED, "Account deactivated"),
        (PASSWORD_RESET, "Password reset"),
        (IDLE, "30 minutes without activity"),
        (EXPIRED, "12-hour limit reached"),
    ]

    staff = models.ForeignKey(StaffUser, on_delete=models.CASCADE, related_name="sessions")
    jti = models.CharField(max_length=64, unique=True)
    device_label = models.CharField(max_length=120, blank=True, default="")
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True, default="")
    two_factor = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)
    last_seen_at = models.DateTimeField(default=timezone.now)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=30, blank=True, default="", choices=REASON_CHOICES)
    sudo_until = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["staff", "revoked_at"])]

    def __str__(self):
        return f"{self.staff.full_name} · {self.device_label or 'device'} · {self.created_at:%Y-%m-%d %H:%M}"
```
Run: `$BT run --rm web python manage.py makemigrations accounts --name staffsession`
Expected: `accounts/migrations/0035_staffsession.py`.

- [ ] **Step 4: Expose the client-IP helper**

In `backend/activity/services.py`, directly under `def _client_ip(request): …`, add:
```python
def client_ip(request):
    """Public name for the canonical client IP (accounts.sessions reads it)."""
    return _client_ip(request)
```

- [ ] **Step 5: The session rules**

`backend/accounts/sessions.py`:
```python
"""Server-side staff sessions (staff foundations F9).

Every staff access token carries a `jti` naming one StaffSession row. The row
is what gives otherwise stateless JWTs a real sign-out, "sign out all
devices", the 30-minute idle limit, the 12-hour absolute limit and password
re-entry ("sudo"). MultiAccountJWTAuthentication calls validate() and touch()
on every staff request.
"""
from datetime import timedelta

from django.utils import timezone
from rest_framework import exceptions

from .models import StaffSession

IDLE_LIMIT = timedelta(minutes=30)
ABSOLUTE_LIMIT = timedelta(hours=12)
SEEN_WRITE_INTERVAL = timedelta(minutes=1)
SUDO_WINDOW = timedelta(minutes=10)
RETENTION = timedelta(days=90)
ENDED_MESSAGE = "Your session has ended. Sign in again."
SUDO_MESSAGE = "Re-enter your password to continue."


def describe_device(user_agent):
    """"Chrome on Android device", "Safari on iPhone", … from a User-Agent."""
    ua = user_agent or ""
    if "Edg/" in ua:
        browser = "Edge"
    elif "Firefox/" in ua or "FxiOS/" in ua:
        browser = "Firefox"
    elif "Chrome/" in ua or "CriOS/" in ua:
        browser = "Chrome"
    elif "Safari/" in ua:
        browser = "Safari"
    else:
        browser = ""
    if "iPhone" in ua:
        device = "iPhone"
    elif "iPad" in ua:
        device = "iPad"
    elif "Android" in ua:
        device = "Android device"
    elif "Windows" in ua:
        device = "Windows computer"
    elif "Macintosh" in ua or "Mac OS X" in ua:
        device = "Mac"
    elif "Linux" in ua:
        device = "Linux computer"
    else:
        device = ""
    if browser and device:
        return f"{browser} on {device}"
    return browser or device or "Unknown device"


def start(staff, jti, request=None, *, two_factor=False):
    # Imported here: activity.services imports accounts.serializers, which
    # imports accounts.authentication, which imports this module.
    from activity.services import client_ip

    django_request = getattr(request, "_request", request)
    user_agent = django_request.META.get("HTTP_USER_AGENT", "")[:300] if django_request is not None else ""
    return StaffSession.objects.create(
        staff=staff,
        jti=jti,
        device_label=describe_device(user_agent),
        user_agent=user_agent,
        ip=client_ip(django_request) if django_request is not None else None,
        two_factor=two_factor,
    )


def end_reason_if_invalid(session, now=None):
    """None while the session may still be used, else why it ended."""
    now = now or timezone.now()
    if session.revoked_at is not None:
        return session.revoked_reason or StaffSession.SIGNED_OUT
    if now - session.created_at > ABSOLUTE_LIMIT:
        return StaffSession.EXPIRED
    if now - session.last_seen_at > IDLE_LIMIT:
        return StaffSession.IDLE
    return None


def validate(staff, token):
    """The live session behind a staff access token, or AuthenticationFailed."""
    session = StaffSession.objects.filter(jti=token.get("jti", ""), staff_id=staff.pk).first()
    if session is None:
        raise exceptions.AuthenticationFailed(ENDED_MESSAGE)
    reason = end_reason_if_invalid(session)
    if reason:
        if session.revoked_at is None:
            StaffSession.objects.filter(pk=session.pk, revoked_at__isnull=True).update(
                revoked_at=timezone.now(), revoked_reason=reason
            )
        raise exceptions.AuthenticationFailed(ENDED_MESSAGE)
    return session


def touch(session, now=None):
    """Record activity, at most one write a minute per session."""
    now = now or timezone.now()
    if now - session.last_seen_at >= SEEN_WRITE_INTERVAL:
        StaffSession.objects.filter(pk=session.pk).update(last_seen_at=now)
        session.last_seen_at = now


def current(request):
    """The session that authenticated this request (staff only), or None."""
    return getattr(getattr(request, "auth", None), "staff_session", None)


def revoke(session, reason):
    return StaffSession.objects.filter(pk=session.pk, revoked_at__isnull=True).update(
        revoked_at=timezone.now(), revoked_reason=reason
    )


def revoke_all(staff, reason, *, except_session=None):
    sessions = StaffSession.objects.filter(staff=staff, revoked_at__isnull=True)
    if except_session is not None:
        sessions = sessions.exclude(pk=except_session.pk)
    return sessions.update(revoked_at=timezone.now(), revoked_reason=reason)


def grant_sudo(session, now=None):
    until = (now or timezone.now()) + SUDO_WINDOW
    StaffSession.objects.filter(pk=session.pk).update(sudo_until=until)
    session.sudo_until = until
    return until


def has_sudo(request):
    session = current(request)
    return bool(session and session.sudo_until and session.sudo_until > timezone.now())


def require_sudo(request):
    if not has_sudo(request):
        raise exceptions.PermissionDenied({"detail": SUDO_MESSAGE, "code": "sudo_required"})


def cleanup(now=None):
    """Mark sessions that timed out as ended and forget rows older than 90
    days (sign-ins older than that live on in the activity log)."""
    now = now or timezone.now()
    StaffSession.objects.filter(revoked_at__isnull=True, created_at__lt=now - ABSOLUTE_LIMIT).update(
        revoked_at=now, revoked_reason=StaffSession.EXPIRED
    )
    StaffSession.objects.filter(revoked_at__isnull=True, last_seen_at__lt=now - IDLE_LIMIT).update(
        revoked_at=now, revoked_reason=StaffSession.IDLE
    )
    deleted, _ = StaffSession.objects.filter(created_at__lt=now - RETENTION).delete()
    return deleted
```

- [ ] **Step 6: Tokens open sessions; authentication checks them**

In `backend/accounts/authentication.py` add `from . import sessions` above `from .models import …` and replace `issue_token`:
```python
def issue_token(account, account_type, *, request=None, two_factor=False):
    """A signed access token. A staff token also opens a StaffSession named by
    the token's jti (foundations F9); `request` supplies its device, IP and
    user agent, and `two_factor` records that the sign-in passed 2-step."""
    if account_type not in ACCOUNT_MODELS:
        raise ValueError(f"Unknown account_type: {account_type}")
    token = AccessToken()
    token["sub"] = str(account.pk)
    token["account_type"] = account_type
    if account_type == "staff":
        sessions.start(account, token["jti"], request, two_factor=two_factor)
    return str(token)
```
In `MultiAccountJWTAuthentication.authenticate`, between the suspended/inactive check and `return (account, token)`, insert:
```python
        if isinstance(account, StaffUser):
            # Server-side session (F9): revoked, idle-over-30-minutes and
            # older-than-12-hours sessions are refused here.
            session = sessions.validate(account, token)
            sessions.touch(session)
            token.staff_session = session
```

- [ ] **Step 7: Views open and end sessions**

In `backend/accounts/views.py` add `from . import sessions` to the local imports and `StaffSession` to the `.models` import. Then:
- `StaffActivateView.post`: `issue_token(staff, "staff")` → `issue_token(staff, "staff", request=request)`.
- `StaffLoginView.post`: `issue_token(account, "staff")` → `issue_token(account, "staff", request=request)`.
- Replace `StaffLogoutView.post` with:
```python
    def post(self, request):
        session = sessions.current(request)
        if session is not None:
            sessions.revoke(session, StaffSession.SIGNED_OUT)
        record_activity(request.user, "staff.signed_out", target=request.user, method="POST", request=request)
        return Response(status=status.HTTP_204_NO_CONTENT)
```
- In `StaffSuspendView.post`, after `staff.save(update_fields=["is_suspended", "suspension_reason"])`:
```python
        sessions.revoke_all(staff, StaffSession.SUSPENDED)
```
- In `StaffDeactivateView.post`, after `staff.save(update_fields=["is_active"])`:
```python
        sessions.revoke_all(staff, StaffSession.DEACTIVATED)
```

- [ ] **Step 8: Serializers**

In `backend/accounts/serializers.py` add `from . import sessions` to the local imports and `StaffSession` to the `.models` import. In `PasswordResetConfirmSerializer.save`, before `return self.account`:
```python
        if isinstance(self.account, StaffUser):
            # A reset is often "someone else may have my password": end
            # every device's session.
            sessions.revoke_all(self.account, StaffSession.PASSWORD_RESET)
```
In `StaffListSerializer` add the field, list `"last_sign_in_at"` in `Meta.fields` after `"created_at"`, and add the method:
```python
    # From the session table (F9) — this replaces the missing last_login.
    last_sign_in_at = serializers.SerializerMethodField()
```
```python
    def get_last_sign_in_at(self, obj):
        return obj.sessions.order_by("-created_at").values_list("created_at", flat=True).first()
```

- [ ] **Step 9: The test helper and the cleanup job**

`backend/accounts/testing.py`:
```python
"""Helpers for tests across apps (not test cases themselves)."""
from datetime import timedelta

from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

from .authentication import issue_token
from .models import StaffSession


def staff_token(staff, *, sudo=False):
    """A staff access token with a live session. sudo=True also unlocks
    password-protected actions for 10 minutes, as POST staff/reauth/ would."""
    token = issue_token(staff, "staff")
    if sudo:
        StaffSession.objects.filter(jti=AccessToken(token)["jti"]).update(
            sudo_until=timezone.now() + timedelta(minutes=10)
        )
    return token
```
`backend/accounts/tasks.py`:
```python
from celery import shared_task

from . import sessions


@shared_task
def cleanup_staff_sessions():
    return sessions.cleanup()
```
In `backend/ashantihub/settings.py` add to `CELERY_BEAT_SCHEDULE`:
```python
    "sessions-cleanup": {
        "task": "accounts.tasks.cleanup_staff_sessions",
        "schedule": crontab(hour=3, minute=30),
    },
```

- [ ] **Step 10: Run the tests**

```bash
$BT run --rm web python manage.py test --noinput accounts.tests.test_staff_sessions
$BT run --rm web python manage.py test --noinput accounts activity calls staff_tasks notifications core
```
Expected: OK. (Every existing test mints staff tokens with `issue_token`, which now opens a session, so they keep passing.)

- [ ] **Step 11: Commit**

```bash
git add backend
git commit -m "feat(staff): server-side staff sessions with 30-minute idle and 12-hour limits"
```

---

### Task 3: Sessions & devices API and password re-entry

**Files:**
- Modify: `backend/accounts/permissions.py` (add `RequiresSudo`)
- Modify: `backend/accounts/serializers.py` (add `StaffSessionSerializer`)
- Modify: `backend/accounts/views.py` (new views; `RequiresSudo` on four staff-management views)
- Modify: `backend/accounts/urls.py`
- Modify: `backend/accounts/tests/test_staff_management.py`, `backend/accounts/tests/test_team_invites.py`, `backend/activity/tests/test_middleware.py` (their sign-in helpers unlock sudo)
- Test: `backend/accounts/tests/test_sudo_and_sessions.py`

**Interfaces:**
- Consumes: Task 2 (`sessions`, `StaffSession`, `staff_token`).
- Produces:
  - `accounts.permissions.RequiresSudo` (DRF permission; list it **after** the role permission)
  - `POST /api/accounts/staff/reauth/` `{password}` → `{"sudo_until": iso}`; 400 `{"password": ["That password isn't right."]}`
  - `GET /api/accounts/staff/sessions/` → plain list of session rows (own); `?staff=<id>` needs `staff.manage`
  - `GET /api/accounts/staff/sessions/active/` (`staff.manage`) → everyone's live sessions
  - `POST /api/accounts/staff/sessions/<id>/end/` → the session row (own, or anyone's with `staff.manage`; else 404)
  - `POST /api/accounts/staff/sessions/end-others/` → `{"ended": n}`
  - `POST /api/accounts/staff/<pk>/sign-out-everywhere/` (`staff.manage`, not self) → `{"ended": n}`
  - session row: `{id, device_label, ip, created_at, last_seen_at, ends_at, idle_ends_at, revoked_at, revoked_reason, is_active, is_current, two_factor, staff: {id, full_name, role}}`
  - Sudo now required on `staff/<pk>/suspend/`, `deactivate/`, `permissions/`, `manager/`

- [ ] **Step 1: Write the failing tests**

`backend/accounts/tests/test_sudo_and_sessions.py`:
```python
from datetime import timedelta

from django.contrib.auth.hashers import make_password
from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts.authentication import issue_token
from accounts.models import Role, StaffSession, StaffUser

PASSWORD = "correct-horse-1"


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash=make_password(PASSWORD),
        role=Role.objects.get(name=role), **extra,
    )


def session_of(token):
    return StaffSession.objects.get(jti=AccessToken(token)["jti"])


class Base(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.esi = make_staff("support", "esi@example.com")
        self.ama = make_staff("operations", "ama@example.com")

    def use(self, token):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return token


class SudoTests(Base):
    def setUp(self):
        super().setUp()
        self.token = self.use(issue_token(self.boss, "staff"))

    def reauth(self, password=PASSWORD):
        return self.client.post("/api/accounts/staff/reauth/", {"password": password}, format="json")

    def suspend(self):
        return self.client.post(f"/api/accounts/staff/{self.esi.id}/suspend/", {"reason": "x"}, format="json")

    def test_suspending_staff_needs_a_recent_password(self):
        refused = self.suspend()
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.json(), {"detail": "Re-enter your password to continue.", "code": "sudo_required"})
        self.assertEqual(self.reauth().status_code, 200)
        self.assertEqual(self.suspend().status_code, 200)

    def test_a_wrong_password_unlocks_nothing(self):
        self.assertEqual(self.reauth("wrong-password").json(), {"password": ["That password isn't right."]})
        self.assertEqual(self.suspend().status_code, 403)

    def test_the_unlock_lasts_ten_minutes(self):
        self.reauth()
        StaffSession.objects.filter(jti=AccessToken(self.token)["jti"]).update(
            sudo_until=timezone.now() - timedelta(seconds=1)
        )
        self.assertEqual(self.suspend().status_code, 403)

    def test_the_unlock_belongs_to_one_session(self):
        self.reauth()
        self.use(issue_token(self.boss, "staff"))
        self.assertEqual(self.suspend().status_code, 403)

    def test_permission_manager_and_deactivation_changes_need_it_too(self):
        cases = [
            (f"/api/accounts/staff/{self.esi.id}/permissions/", {"grant": [], "revoke": []}),
            (f"/api/accounts/staff/{self.esi.id}/manager/", {"manager": self.ama.id}),
            (f"/api/accounts/staff/{self.esi.id}/deactivate/", {}),
        ]
        for url, body in cases:
            self.assertEqual(self.client.post(url, body, format="json").json().get("code"), "sudo_required", url)
        self.reauth()
        for url, body in cases:
            self.assertEqual(self.client.post(url, body, format="json").status_code, 200, url)

    def test_a_missing_role_permission_is_reported_before_sudo(self):
        self.use(issue_token(make_staff("marketing", "akua@example.com"), "staff"))
        response = self.suspend()
        self.assertEqual(response.status_code, 403)
        self.assertNotIn("code", response.json())


class SessionsApiTests(Base):
    def test_my_sessions_list_marks_this_device(self):
        issue_token(self.esi, "staff")
        self.use(issue_token(self.esi, "staff"))
        rows = self.client.get("/api/accounts/staff/sessions/").json()
        self.assertEqual(len(rows), 2)
        self.assertEqual([row["is_current"] for row in rows].count(True), 1)
        self.assertTrue(all(row["is_active"] for row in rows))

    def test_ending_one_of_my_sessions(self):
        other = issue_token(self.esi, "staff")
        self.use(issue_token(self.esi, "staff"))
        response = self.client.post(f"/api/accounts/staff/sessions/{session_of(other).pk}/end/", {}, format="json")
        self.assertEqual(response.json()["revoked_reason"], StaffSession.ENDED)
        self.use(other)
        self.assertEqual(self.client.get("/api/accounts/me/").status_code, 401)

    def test_cannot_end_someone_elses_session(self):
        boss_session = session_of(issue_token(self.boss, "staff"))
        self.use(issue_token(self.esi, "staff"))
        self.assertEqual(
            self.client.post(f"/api/accounts/staff/sessions/{boss_session.pk}/end/", {}, format="json").status_code, 404
        )

    def test_sign_out_other_devices_keeps_this_one(self):
        for _ in range(2):
            issue_token(self.esi, "staff")
        self.use(issue_token(self.esi, "staff"))
        self.assertEqual(self.client.post("/api/accounts/staff/sessions/end-others/", {}, format="json").json(), {"ended": 2})
        self.assertEqual(self.client.get("/api/accounts/me/").status_code, 200)

    def test_only_staff_manage_sees_someone_elses_sessions(self):
        self.use(issue_token(self.esi, "staff"))
        self.assertEqual(self.client.get(f"/api/accounts/staff/sessions/?staff={self.boss.id}").status_code, 403)
        self.use(issue_token(self.boss, "staff"))
        self.assertEqual(self.client.get(f"/api/accounts/staff/sessions/?staff={self.esi.id}").status_code, 200)

    def test_super_admin_sees_everyone_signed_in_now(self):
        live = issue_token(self.esi, "staff")
        idle = issue_token(self.esi, "staff")
        StaffSession.objects.filter(jti=AccessToken(idle)["jti"]).update(last_seen_at=timezone.now() - timedelta(hours=1))
        self.use(issue_token(self.boss, "staff"))
        rows = self.client.get("/api/accounts/staff/sessions/active/").json()
        self.assertEqual({(row["staff"]["full_name"], row["is_current"]) for row in rows}, {("Esi", False), ("Boss", True)})
        self.use(live)
        self.assertEqual(self.client.get("/api/accounts/staff/sessions/active/").status_code, 403)

    def test_super_admin_signs_someone_out_everywhere(self):
        tokens = [issue_token(self.esi, "staff") for _ in range(2)]
        self.use(issue_token(self.boss, "staff"))
        response = self.client.post(f"/api/accounts/staff/{self.esi.id}/sign-out-everywhere/", {}, format="json")
        self.assertEqual(response.json(), {"ended": 2})
        self.assertEqual({session_of(t).revoked_reason for t in tokens}, {StaffSession.SIGNED_OUT_EVERYWHERE})
        self.assertEqual(
            self.client.post(f"/api/accounts/staff/{self.boss.id}/sign-out-everywhere/", {}, format="json").status_code, 400
        )
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$BT run --rm web python manage.py test --noinput accounts.tests.test_sudo_and_sessions`
Expected: FAIL — 404s for the new endpoints; suspend returns 200 without sudo.

- [ ] **Step 3: The permission class**

Append to `backend/accounts/permissions.py`:
```python
class RequiresSudo(BasePermission):
    """Password re-entered on this session within the last 10 minutes (F9).
    List it AFTER the role permission so a missing permission is reported
    first; refuses with 403 {"detail": …, "code": "sudo_required"}, which
    the frontend turns into a password prompt and a retry."""

    def has_permission(self, request, view):
        from . import sessions

        sessions.require_sudo(request)
        return True
```

- [ ] **Step 4: The session serializer**

Append to `backend/accounts/serializers.py` (`sessions` and `StaffSession` are already imported there since Task 2):
```python
class StaffSessionSerializer(serializers.ModelSerializer):
    ends_at = serializers.SerializerMethodField()
    idle_ends_at = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()
    is_current = serializers.SerializerMethodField()
    staff = serializers.SerializerMethodField()

    class Meta:
        model = StaffSession
        fields = [
            "id", "device_label", "ip", "created_at", "last_seen_at", "ends_at", "idle_ends_at",
            "revoked_at", "revoked_reason", "is_active", "is_current", "two_factor", "staff",
        ]

    def get_ends_at(self, obj):
        return obj.created_at + sessions.ABSOLUTE_LIMIT

    def get_idle_ends_at(self, obj):
        return obj.last_seen_at + sessions.IDLE_LIMIT

    def get_is_active(self, obj):
        return sessions.end_reason_if_invalid(obj) is None

    def get_is_current(self, obj):
        current = self.context.get("current_session")
        return bool(current and current.pk == obj.pk)

    def get_staff(self, obj):
        return {"id": obj.staff_id, "full_name": obj.staff.full_name, "role": obj.staff.role.name}
```

- [ ] **Step 5: The views**

In `backend/accounts/views.py` add `from django.contrib.auth.hashers import check_password` at the top, `RequiresSudo` to the `.permissions` import and `StaffSessionSerializer` to the `.serializers` import. Add `RequiresSudo()` after the role permission in four views:
- `StaffSuspendView.get_permissions` → `return [HasAnyRolePermission(*TEAM_OR_STAFF_MANAGE), RequiresSudo()]`
- `StaffDeactivateView.get_permissions` → `return [HasRolePermission("staff.manage"), RequiresSudo()]`
- `StaffPermissionsView.get_permissions` → `return [HasRolePermission("staff.manage"), RequiresSudo()]`
- `StaffManagerView.get_permissions` → `return [HasRolePermission("staff.manage"), RequiresSudo()]`

Append the new views after `PermissionCatalogView`:
```python
# ── Sessions & devices, password re-entry (staff foundations F9) ────────────


def _session_context(request):
    return {"current_session": sessions.current(request)}


class StaffReauthView(APIView):
    """Re-enter your password ("sudo"): unlocks sensitive actions on this
    session for 10 minutes."""

    throttle_scope = "login"

    def get_permissions(self):
        return [IsStaff()]

    def post(self, request):
        if not check_password(request.data.get("password") or "", request.user.password_hash):
            return Response({"password": ["That password isn't right."]}, status=400)
        return Response({"sudo_until": sessions.grant_sudo(sessions.current(request))})


class StaffSessionListView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        staff = request.user
        other = request.query_params.get("staff")
        if other:
            if not can_manage_staff(request.user):
                return Response({"detail": "Only a Super Admin can see someone else's sessions."}, status=403)
            if not (other.isdecimal() and other.isascii()):
                return Response({"staff": "Use a staff id."}, status=400)
            staff = generics.get_object_or_404(StaffUser, pk=other)
        rows = StaffSession.objects.filter(staff=staff).select_related("staff__role")[:50]
        return Response(StaffSessionSerializer(rows, many=True, context=_session_context(request)).data)


class StaffActiveSessionsView(APIView):
    """Everyone signed in now (Super Admin's Sessions & devices)."""

    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def get(self, request):
        now = timezone.now()
        rows = (
            StaffSession.objects.filter(
                revoked_at__isnull=True,
                created_at__gt=now - sessions.ABSOLUTE_LIMIT,
                last_seen_at__gt=now - sessions.IDLE_LIMIT,
                staff__is_active=True,
                staff__is_suspended=False,
            )
            .select_related("staff__role")
            .order_by("staff__full_name", "-last_seen_at")
        )
        return Response(StaffSessionSerializer(rows, many=True, context=_session_context(request)).data)


class StaffSessionEndView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def post(self, request, pk):
        scope = StaffSession.objects.all() if can_manage_staff(request.user) else StaffSession.objects.filter(staff=request.user)
        session = generics.get_object_or_404(scope.select_related("staff__role"), pk=pk)
        sessions.revoke(session, StaffSession.ENDED)
        session.refresh_from_db()
        return Response(StaffSessionSerializer(session, context=_session_context(request)).data)


class StaffEndOtherSessionsView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def post(self, request):
        ended = sessions.revoke_all(request.user, StaffSession.ENDED, except_session=sessions.current(request))
        return Response({"ended": ended})


class StaffSignOutEverywhereView(APIView):
    def get_permissions(self):
        return [HasRolePermission("staff.manage")]

    def post(self, request, pk):
        staff = generics.get_object_or_404(StaffUser, pk=pk)
        guard = _guard_self_action(request, staff)
        if guard:
            return guard
        return Response({"ended": sessions.revoke_all(staff, StaffSession.SIGNED_OUT_EVERYWHERE)})
```

- [ ] **Step 6: URLs**

In `backend/accounts/urls.py`, after `path("staff/logout/", …)`:
```python
    path("staff/reauth/", views.StaffReauthView.as_view(), name="staff-reauth"),
    path("staff/sessions/", views.StaffSessionListView.as_view(), name="staff-sessions"),
    path("staff/sessions/active/", views.StaffActiveSessionsView.as_view(), name="staff-sessions-active"),
    path("staff/sessions/end-others/", views.StaffEndOtherSessionsView.as_view(), name="staff-sessions-end-others"),
    path("staff/sessions/<int:pk>/end/", views.StaffSessionEndView.as_view(), name="staff-session-end"),
    path("staff/<int:pk>/sign-out-everywhere/", views.StaffSignOutEverywhereView.as_view(), name="staff-sign-out-everywhere"),
```

- [ ] **Step 7: Existing staff-management tests sign in with sudo**

These suites exercise suspend/deactivate/permissions/manager and must now present a session with sudo:
- `backend/accounts/tests/test_staff_management.py`: add `from accounts.testing import staff_token`; in `StaffManagementTestsBase._auth` replace `issue_token(staff, 'staff')` with `staff_token(staff, sudo=True)`.
- `backend/accounts/tests/test_team_invites.py`: add the same import; in `Base.as_` replace `issue_token(staff, 'staff')` with `staff_token(staff, sudo=True)`.
- `backend/activity/tests/test_middleware.py`: add the same import; in `StaffActivityMiddlewareTests.setUp` replace `issue_token(self.boss, 'staff')` with `staff_token(self.boss, sudo=True)`.
Leave every other `issue_token` call in those files as it is.

- [ ] **Step 8: Run the tests**

```bash
$BT run --rm web python manage.py test --noinput accounts.tests.test_sudo_and_sessions
$BT run --rm web python manage.py test --noinput accounts activity
```
Expected: OK.

- [ ] **Step 9: Commit**

```bash
git add backend
git commit -m "feat(staff): sessions & devices API and password re-entry for sensitive staff actions"
```

---

### Task 4: 2-step sign-in (authenticator app) with recovery codes

**Files:**
- Modify: `backend/requirements.txt` (`pyotp`, `cryptography`)
- Modify: `backend/ashantihub/settings.py` (`STAFF_SECRETS_KEY`)
- Modify: `infra/env/backend.env.example`
- Modify: `backend/accounts/models.py` (add `StaffTwoFactor`)
- Create: `backend/accounts/migrations/0036_stafftwofactor.py` (generated)
- Create: `backend/accounts/two_factor.py`
- Create: `backend/accounts/management/commands/reset_staff_two_factor.py`
- Modify: `backend/accounts/emails.py` (`send_two_factor_changed_email`)
- Modify: `backend/accounts/views.py` (`StaffLoginView`, new views), `backend/accounts/urls.py`
- Test: `backend/accounts/tests/test_two_factor.py`

**Interfaces:**
- Consumes: Task 2 (`issue_token(..., two_factor=True)`), Task 3 (`RequiresSudo`, `staff_token`).
- Produces:
  - `accounts.models.StaffTwoFactor(staff 1:1 related_name="two_factor", secret_encrypted, pending_secret_encrypted, confirmed_at, last_used_step, recovery_code_hashes, created_at)`
  - `accounts.two_factor`: `VERIFY`, `ENROL`, `CHALLENGE_MAX_AGE`, `_clock()`, `encrypt_secret(str) -> str`, `decrypt_secret(str) -> str`, `is_required(staff)`, `is_enabled(staff)`, `challenge_for(staff) -> VERIFY | ENROL | None`, `make_challenge(staff, stage) -> str`, `read_challenge(token, stage) -> StaffUser | None`, `begin_enrolment(staff) -> (secret, otpauth_uri)`, `confirm_enrolment(staff, code, now=None) -> list[str] | None`, `verify(staff, code, now=None) -> bool`, `use_recovery_code(staff, code) -> bool`, `regenerate_recovery_codes(staff) -> list[str] | None`, `disable(staff)`, `status(staff) -> {enabled, required, enabled_at, recovery_codes_left}`
  - `POST /api/accounts/staff/login/` now answers `{"two_factor_required": true, "mfa_token"}` or `{"two_factor_setup_required": true, "mfa_token"}` instead of a token when a second step is due
  - `POST /api/accounts/staff/login/two-factor/` `{mfa_token, code}` or `{mfa_token, recovery_code}` → the normal staff sign-in payload
  - `POST /api/accounts/staff/two-factor/enrol/start/` `{mfa_token}` → `{secret, otpauth_uri}`; `…/enrol/confirm/` `{mfa_token, code}` → sign-in payload + `recovery_codes`
  - `GET /api/accounts/staff/two-factor/` → status; `POST …/setup/` (sudo) → `{secret, otpauth_uri}`; `POST …/setup/confirm/` `{code}` → `{recovery_codes}`; `POST …/recovery-codes/` (sudo) → `{recovery_codes}`; `POST …/disable/` (sudo; 400 for a Super Admin) → 204; `POST /api/accounts/staff/<pk>/two-factor/reset/` (`staff.manage` + sudo) → 204
  - `manage.py reset_staff_two_factor <email>` for a Super Admin who lost phone and codes
  - Sign-in payload (shared): `{token, account_type: "staff", id, full_name, role, permissions}`

- [ ] **Step 1: Write the failing tests**

`backend/accounts/tests/test_two_factor.py`:
```python
import io
import time
from unittest import mock

import pyotp
from django.contrib.auth.hashers import make_password
from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts import two_factor
from accounts.models import Role, StaffSession, StaffTwoFactor, StaffUser
from accounts.testing import staff_token
from activity.models import ActivityEvent

PASSWORD = "correct-horse-1"


def make_staff(role, email):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash=make_password(PASSWORD),
        role=Role.objects.get(name=role),
    )


class TwoFactorBase(TestCase):
    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.esi = make_staff("support", "esi@example.com")
        self.t0 = int(time.time())

    def clock(self, offset=0):
        return mock.patch("accounts.two_factor._clock", return_value=self.t0 + offset)

    def enrol(self, staff):
        secret, _ = two_factor.begin_enrolment(staff)
        with self.clock():
            codes = two_factor.confirm_enrolment(staff, pyotp.TOTP(secret).at(self.t0))
        return secret, codes

    def password_step(self, email):
        return self.client.post("/api/accounts/staff/login/", {"identifier": email, "password": PASSWORD}, format="json")

    def second_step(self, mfa_token, **body):
        return self.client.post("/api/accounts/staff/login/two-factor/", {"mfa_token": mfa_token, **body}, format="json")


class TwoFactorSignInTests(TwoFactorBase):
    def test_staff_without_two_factor_sign_in_with_a_password(self):
        self.assertIn("token", self.password_step("esi@example.com").json())

    def test_a_super_admin_sets_it_up_at_the_next_sign_in(self):
        body = self.password_step("boss@example.com").json()
        self.assertEqual(set(body), {"two_factor_setup_required", "mfa_token"})
        start = self.client.post(
            "/api/accounts/staff/two-factor/enrol/start/", {"mfa_token": body["mfa_token"]}, format="json"
        ).json()
        self.assertTrue(start["otpauth_uri"].startswith("otpauth://totp/AshantiHub:"))
        with self.clock():
            done = self.client.post(
                "/api/accounts/staff/two-factor/enrol/confirm/",
                {"mfa_token": body["mfa_token"], "code": pyotp.TOTP(start["secret"]).at(self.t0)}, format="json",
            )
        self.assertEqual(done.status_code, 200)
        self.assertEqual(len(done.json()["recovery_codes"]), 10)
        self.assertTrue(StaffSession.objects.get(jti=AccessToken(done.json()["token"])["jti"]).two_factor)
        self.assertEqual(mail.outbox[-1].to, ["boss@example.com"])

    def test_the_secret_is_encrypted_at_rest(self):
        secret, _ = two_factor.begin_enrolment(self.esi)
        stored = StaffTwoFactor.objects.get(staff=self.esi).pending_secret_encrypted
        self.assertNotIn(secret, stored)
        self.assertEqual(two_factor.decrypt_secret(stored), secret)

    def test_enrolled_staff_need_their_code(self):
        secret, _ = self.enrol(self.esi)
        body = self.password_step("esi@example.com").json()
        self.assertEqual(set(body), {"two_factor_required", "mfa_token"})
        with self.clock(60):
            self.assertEqual(self.second_step(body["mfa_token"], code="000000").status_code, 400)
            response = self.second_step(body["mfa_token"], code=pyotp.TOTP(secret).at(self.t0 + 60))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {"token", "account_type", "id", "full_name", "role", "permissions"})

    def test_a_code_works_only_once(self):
        secret, _ = self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        code = pyotp.TOTP(secret).at(self.t0 + 60)
        with self.clock(60):
            self.assertEqual(self.second_step(token, code=code).status_code, 200)
            self.assertEqual(self.second_step(token, code=code).status_code, 400)

    def test_the_enrolment_code_cannot_be_reused_to_sign_in(self):
        secret, _ = self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        with self.clock():
            self.assertEqual(self.second_step(token, code=pyotp.TOTP(secret).at(self.t0)).status_code, 400)

    def test_a_recovery_code_works_once(self):
        _, codes = self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        self.assertEqual(self.second_step(token, recovery_code=codes[0].upper()).status_code, 200)
        self.assertEqual(self.second_step(token, recovery_code=codes[0]).status_code, 400)
        self.assertEqual(two_factor.status(self.esi)["recovery_codes_left"], 9)

    def test_a_wrong_stage_or_expired_challenge_is_refused(self):
        self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        self.assertEqual(
            self.client.post("/api/accounts/staff/two-factor/enrol/start/", {"mfa_token": token}, format="json").status_code,
            400,
        )
        with mock.patch("accounts.two_factor.CHALLENGE_MAX_AGE", -1):
            self.assertEqual(self.second_step(token, code="123456").status_code, 400)

    def test_failed_codes_are_recorded(self):
        self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        self.second_step(token, code="123456")
        self.assertTrue(ActivityEvent.objects.filter(verb="staff.two_factor_failed", actor_id=self.esi.id).exists())

    def test_a_suspended_staffer_cannot_finish_signing_in(self):
        secret, _ = self.enrol(self.esi)
        token = self.password_step("esi@example.com").json()["mfa_token"]
        StaffUser.objects.filter(pk=self.esi.pk).update(is_suspended=True)
        with self.clock(60):
            self.assertEqual(self.second_step(token, code=pyotp.TOTP(secret).at(self.t0 + 60)).status_code, 400)


class TwoFactorSettingsTests(TwoFactorBase):
    def setUp(self):
        super().setUp()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.esi, sudo=True)}")

    def test_other_staff_can_turn_it_on_and_off(self):
        setup = self.client.post("/api/accounts/staff/two-factor/setup/", {}, format="json").json()
        with self.clock():
            confirm = self.client.post(
                "/api/accounts/staff/two-factor/setup/confirm/",
                {"code": pyotp.TOTP(setup["secret"]).at(self.t0)}, format="json",
            )
        self.assertEqual(len(confirm.json()["recovery_codes"]), 10)
        self.assertTrue(self.client.get("/api/accounts/staff/two-factor/").json()["enabled"])
        self.assertEqual(self.client.post("/api/accounts/staff/two-factor/disable/", {}, format="json").status_code, 204)
        self.assertFalse(two_factor.is_enabled(self.esi))

    def test_setup_needs_a_recent_password(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.esi)}")
        response = self.client.post("/api/accounts/staff/two-factor/setup/", {}, format="json")
        self.assertEqual(response.json()["code"], "sudo_required")

    def test_moving_to_a_new_phone_keeps_the_old_one_working_until_confirmed(self):
        old_secret, _ = self.enrol(self.esi)
        self.client.post("/api/accounts/staff/two-factor/setup/", {}, format="json")
        self.assertTrue(two_factor.is_enabled(self.esi))
        with self.clock(60):
            self.assertTrue(two_factor.verify(self.esi, pyotp.TOTP(old_secret).at(self.t0 + 60)))

    def test_new_recovery_codes_cancel_the_old_ones(self):
        _, old = self.enrol(self.esi)
        new = self.client.post("/api/accounts/staff/two-factor/recovery-codes/", {}, format="json").json()["recovery_codes"]
        self.assertFalse(two_factor.use_recovery_code(self.esi, old[0]))
        self.assertTrue(two_factor.use_recovery_code(self.esi, new[0]))

    def test_a_super_admin_cannot_turn_it_off(self):
        self.enrol(self.boss)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss, sudo=True)}")
        self.assertEqual(self.client.post("/api/accounts/staff/two-factor/disable/", {}, format="json").status_code, 400)
        self.assertTrue(two_factor.is_enabled(self.boss))

    def test_a_super_admin_resets_someone_who_lost_their_phone(self):
        self.enrol(self.esi)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss, sudo=True)}")
        response = self.client.post(f"/api/accounts/staff/{self.esi.id}/two-factor/reset/", {}, format="json")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(two_factor.is_enabled(self.esi))

    def test_the_server_command_resets_a_locked_out_super_admin(self):
        self.enrol(self.boss)
        call_command("reset_staff_two_factor", "boss@example.com", stdout=io.StringIO())
        self.assertFalse(two_factor.is_enabled(self.boss))
        self.assertEqual(two_factor.challenge_for(self.boss), two_factor.ENROL)
```

- [ ] **Step 2: Add the dependencies, then run the tests to see them fail**

```bash
$BT run --rm --no-deps web pip index versions pyotp          # newest 2.x
$BT run --rm --no-deps web pip index versions cryptography   # newest
```
Append to `backend/requirements.txt` with the versions found:
```
# 2-step sign-in for staff (F9): TOTP codes and Fernet-encrypted secrets.
pyotp==X
cryptography==X
```
```bash
$BT build web
$BT run --rm web python manage.py test --noinput accounts.tests.test_two_factor
```
Expected: ERROR — `cannot import name 'two_factor' from 'accounts'`.

- [ ] **Step 3: The encryption key setting**

In `backend/ashantihub/settings.py` add `import base64` and `import hashlib` at the top, and directly under the existing `if not DEBUG and SECRET_KEY == "dev-only-insecure-key": …` check add:
```python
# Encrypts staff 2-step sign-in secrets at rest (accounts/two_factor.py) and
# keys the recovery-code hashes. A Fernet key — generate with:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Changing it switches off everyone's 2-step sign-in (they set it up again),
# so set it once and back it up with the database password.
STAFF_SECRETS_KEY = env("STAFF_SECRETS_KEY", default="")
if not STAFF_SECRETS_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("STAFF_SECRETS_KEY must be set when DJANGO_DEBUG=False")
    STAFF_SECRETS_KEY = base64.urlsafe_b64encode(hashlib.sha256(SECRET_KEY.encode()).digest()).decode()
```
In `infra/env/backend.env.example`, under `DJANGO_DEBUG=False` in the Core section, add:
```
# Encrypts staff 2-step sign-in secrets. REQUIRED — the app refuses to start
# without it when DJANGO_DEBUG=False. Set once; changing it switches off
# everyone's 2-step sign-in. Generate with:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
STAFF_SECRETS_KEY=
```

- [ ] **Step 4: The model**

In `backend/accounts/models.py`, after `class StaffSession`:
```python
class StaffTwoFactor(models.Model):
    """2-step sign-in (F9): an authenticator-app (TOTP) secret, Fernet-
    encrypted with STAFF_SECRETS_KEY, plus HMAC-hashed single-use recovery
    codes. A pending secret waits for its first code, so moving to a new
    phone never switches the old one off early. See accounts/two_factor.py."""

    staff = models.OneToOneField(StaffUser, on_delete=models.CASCADE, related_name="two_factor")
    secret_encrypted = models.TextField(blank=True, default="")
    pending_secret_encrypted = models.TextField(blank=True, default="")
    confirmed_at = models.DateTimeField(null=True, blank=True)
    last_used_step = models.BigIntegerField(default=0)
    recovery_code_hashes = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"2-step for {self.staff.full_name}"
```
Run: `$BT run --rm web python manage.py makemigrations accounts --name stafftwofactor`
Expected: `accounts/migrations/0036_stafftwofactor.py`.

- [ ] **Step 5: The 2-step service**

`backend/accounts/two_factor.py`:
```python
"""2-step sign-in for staff (foundations F9): TOTP authenticator codes with
single-use recovery codes. Mandatory for Super Admin (set up at the next
password sign-in), optional for everyone else."""
import hashlib
import hmac
import secrets
import time

import pyotp
from cryptography.fernet import Fernet
from django.conf import settings
from django.core import signing
from django.db import transaction
from django.utils import timezone

from .models import Role, StaffTwoFactor, StaffUser

ISSUER = "AshantiHub"
STEP_SECONDS = 30
RECOVERY_CODE_COUNT = 10
RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
CHALLENGE_SALT = "accounts.two_factor.challenge"
CHALLENGE_MAX_AGE = 300  # seconds to finish the second step
VERIFY = "verify"
ENROL = "enrol"


def _clock():
    return time.time()


def _fernet():
    return Fernet(settings.STAFF_SECRETS_KEY.encode())


def encrypt_secret(secret):
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_secret(token):
    return _fernet().decrypt(token.encode()).decode()


def is_required(staff):
    return staff.role.name == Role.SUPER_ADMIN


def is_enabled(staff):
    return (
        StaffTwoFactor.objects.filter(staff=staff, confirmed_at__isnull=False).exclude(secret_encrypted="").exists()
    )


def challenge_for(staff):
    """None when the password alone signs this staffer in, else the stage of
    the second step they must pass."""
    if is_enabled(staff):
        return VERIFY
    if is_required(staff):
        return ENROL
    return None


def make_challenge(staff, stage):
    return signing.dumps({"staff": staff.pk, "stage": stage}, salt=CHALLENGE_SALT)


def read_challenge(token, stage):
    """The staffer a challenge was issued to — or None if it is forged,
    expired, for the other stage, or they can no longer sign in."""
    try:
        data = signing.loads(token or "", salt=CHALLENGE_SALT, max_age=CHALLENGE_MAX_AGE)
    except signing.BadSignature:
        return None
    if data.get("stage") != stage:
        return None
    return (
        StaffUser.objects.select_related("role")
        .filter(pk=data.get("staff"), is_active=True, is_suspended=False)
        .first()
    )


def _hash_code(code):
    return hmac.new(settings.STAFF_SECRETS_KEY.encode(), code.encode(), hashlib.sha256).hexdigest()


def _normalise_code(code):
    return (code or "").strip().lower().replace("-", "").replace(" ", "")


def _new_recovery_codes():
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(10))
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def _match_step(secret, code, after_step, now=None):
    """The 30-second step `code` belongs to (±1 step of clock drift), or None.
    Steps at or before `after_step` are refused, so no code works twice."""
    digits = "".join(ch for ch in str(code or "") if ch.isdigit())
    if len(digits) != 6:
        return None
    totp = pyotp.TOTP(secret)
    current = int(now if now is not None else _clock()) // STEP_SECONDS
    for step in (current - 1, current, current + 1):
        if step > after_step and hmac.compare_digest(totp.at(step * STEP_SECONDS), digits):
            return step
    return None


def begin_enrolment(staff):
    """A fresh secret waiting for its first code. An existing, confirmed
    secret keeps working until the new one is confirmed."""
    secret = pyotp.random_base32()
    record, _ = StaffTwoFactor.objects.get_or_create(staff=staff)
    record.pending_secret_encrypted = encrypt_secret(secret)
    record.save(update_fields=["pending_secret_encrypted"])
    return secret, pyotp.TOTP(secret).provisioning_uri(name=staff.email, issuer_name=ISSUER)


def confirm_enrolment(staff, code, now=None):
    """Activate the pending secret if `code` matches it. Returns 10 new
    recovery codes (shown once), or None."""
    with transaction.atomic():
        record = StaffTwoFactor.objects.select_for_update().filter(staff=staff).first()
        if record is None or not record.pending_secret_encrypted:
            return None
        step = _match_step(decrypt_secret(record.pending_secret_encrypted), code, 0, now)
        if step is None:
            return None
        codes = _new_recovery_codes()
        record.secret_encrypted = record.pending_secret_encrypted
        record.pending_secret_encrypted = ""
        record.confirmed_at = timezone.now()
        record.last_used_step = step
        record.recovery_code_hashes = [_hash_code(_normalise_code(c)) for c in codes]
        record.save()
    return codes


def verify(staff, code, now=None):
    with transaction.atomic():
        record = (
            StaffTwoFactor.objects.select_for_update()
            .filter(staff=staff, confirmed_at__isnull=False)
            .exclude(secret_encrypted="")
            .first()
        )
        if record is None:
            return False
        step = _match_step(decrypt_secret(record.secret_encrypted), code, record.last_used_step, now)
        if step is None:
            return False
        record.last_used_step = step
        record.save(update_fields=["last_used_step"])
    return True


def use_recovery_code(staff, code):
    normalised = _normalise_code(code)
    if not normalised:
        return False
    with transaction.atomic():
        record = StaffTwoFactor.objects.select_for_update().filter(staff=staff, confirmed_at__isnull=False).first()
        hashed = _hash_code(normalised)
        if record is None or hashed not in record.recovery_code_hashes:
            return False
        record.recovery_code_hashes = [h for h in record.recovery_code_hashes if h != hashed]
        record.save(update_fields=["recovery_code_hashes"])
    return True


def regenerate_recovery_codes(staff):
    if not is_enabled(staff):
        return None
    codes = _new_recovery_codes()
    StaffTwoFactor.objects.filter(staff=staff).update(
        recovery_code_hashes=[_hash_code(_normalise_code(c)) for c in codes]
    )
    return codes


def disable(staff):
    StaffTwoFactor.objects.filter(staff=staff).delete()


def status(staff):
    record = StaffTwoFactor.objects.filter(staff=staff).first()
    enabled = bool(record and record.confirmed_at and record.secret_encrypted)
    return {
        "enabled": enabled,
        "required": is_required(staff),
        "enabled_at": record.confirmed_at if enabled else None,
        "recovery_codes_left": len(record.recovery_code_hashes) if enabled else 0,
    }
```

- [ ] **Step 6: The change-notice email and the server reset command**

Append to `backend/accounts/emails.py`:
```python
def send_two_factor_changed_email(staff_user, change):
    """Tells a staffer their 2-step sign-in changed, so a change they didn't
    make is noticed."""
    message = (
        f"Hi {staff_user.full_name},\n\n"
        f"{change}\n\n"
        "If this wasn't you, tell a Super Admin straight away: they can reset "
        "your 2-step sign-in and sign you out of every device.\n\n"
        "— AshantiHub"
    )
    _send("Your AshantiHub 2-step sign-in changed", message, staff_user.email)
```
`backend/accounts/management/commands/reset_staff_two_factor.py`:
```python
from django.core.management.base import BaseCommand, CommandError

from accounts import two_factor
from accounts.models import StaffUser
from activity.services import record


class Command(BaseCommand):
    help = (
        "Switch off a staffer's 2-step sign-in (they lost their phone and their recovery codes). "
        "A Super Admin sets it up again at the next sign-in. For the last resort only: "
        "a Super Admin can reset anyone else's from Sign-in & Security."
    )

    def add_arguments(self, parser):
        parser.add_argument("email")

    def handle(self, *args, **options):
        staff = StaffUser.objects.filter(email=options["email"]).first()
        if staff is None:
            raise CommandError(f"No staff account with email {options['email']}")
        two_factor.disable(staff)
        record(None, "staff.two_factor_reset", target=staff, summary="Reset from the server command line")
        self.stdout.write(self.style.SUCCESS(f"2-step sign-in reset for {staff.email}"))
```

- [ ] **Step 7: Views**

In `backend/accounts/views.py` add `from . import two_factor` to the local imports and `send_two_factor_changed_email` to the `.emails` import. Add above `class StaffLoginView`:
```python
def _staff_sign_in_response(account, request, *, two_factor_used=False):
    record_activity(
        account, "staff.signed_in", target=account, method="POST", request=request,
        summary="with 2-step sign-in" if two_factor_used else "",
    )
    return {
        "token": issue_token(account, "staff", request=request, two_factor=two_factor_used),
        "account_type": "staff",
        "id": account.id,
        "full_name": account.full_name,
        "role": account.role.name,
        "permissions": sorted(account.effective_permission_codenames()),
    }


TIMED_OUT = "Your sign-in timed out. Enter your password again."
```
Replace `StaffLoginView.post` with:
```python
    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account = serializer.account
        stage = two_factor.challenge_for(account)
        if stage == two_factor.VERIFY:
            return Response({"two_factor_required": True, "mfa_token": two_factor.make_challenge(account, stage)})
        if stage == two_factor.ENROL:
            return Response({"two_factor_setup_required": True, "mfa_token": two_factor.make_challenge(account, stage)})
        return Response(_staff_sign_in_response(account, request))
```
Append after the sessions views from Task 3:
```python
# ── 2-step sign-in (staff foundations F9) ───────────────────────────────────


class StaffLoginTwoFactorView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request):
        account = two_factor.read_challenge(request.data.get("mfa_token"), two_factor.VERIFY)
        if account is None:
            return Response({"detail": TIMED_OUT}, status=400)
        recovery_code = request.data.get("recovery_code")
        if recovery_code:
            ok = two_factor.use_recovery_code(account, recovery_code)
        else:
            ok = two_factor.verify(account, request.data.get("code"))
        if not ok:
            record_activity(account, "staff.two_factor_failed", target=account, method="POST", request=request)
            return Response({"detail": "That code isn't right. Check your authenticator app and try again."}, status=400)
        if recovery_code:
            left = two_factor.status(account)["recovery_codes_left"]
            send_two_factor_changed_email(account, f"A recovery code was used to sign in. {left} recovery codes are left.")
        return Response(_staff_sign_in_response(account, request, two_factor_used=True))


class StaffTwoFactorEnrolStartView(APIView):
    """Set-up during sign-in, for a Super Admin without 2-step yet."""

    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request):
        account = two_factor.read_challenge(request.data.get("mfa_token"), two_factor.ENROL)
        if account is None:
            return Response({"detail": TIMED_OUT}, status=400)
        secret, uri = two_factor.begin_enrolment(account)
        return Response({"secret": secret, "otpauth_uri": uri})


class StaffTwoFactorEnrolConfirmView(APIView):
    permission_classes = [AllowAny]
    throttle_scope = "login"

    def post(self, request):
        account = two_factor.read_challenge(request.data.get("mfa_token"), two_factor.ENROL)
        if account is None:
            return Response({"detail": TIMED_OUT}, status=400)
        codes = two_factor.confirm_enrolment(account, request.data.get("code"))
        if codes is None:
            return Response({"detail": "That code isn't right. Check the app shows AshantiHub and try again."}, status=400)
        record_activity(account, "staff.two_factor_enabled", target=account, method="POST", request=request)
        send_two_factor_changed_email(account, "2-step sign-in was turned on for your account.")
        return Response({**_staff_sign_in_response(account, request, two_factor_used=True), "recovery_codes": codes})


class StaffTwoFactorStatusView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        return Response(two_factor.status(request.user))


class StaffTwoFactorSetupView(APIView):
    def get_permissions(self):
        return [IsStaff(), RequiresSudo()]

    def post(self, request):
        secret, uri = two_factor.begin_enrolment(request.user)
        return Response({"secret": secret, "otpauth_uri": uri})


class StaffTwoFactorSetupConfirmView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def post(self, request):
        codes = two_factor.confirm_enrolment(request.user, request.data.get("code"))
        if codes is None:
            return Response({"detail": "That code isn't right. Check the app shows AshantiHub and try again."}, status=400)
        record_activity(request.user, "staff.two_factor_enabled", target=request.user, method="POST", request=request)
        send_two_factor_changed_email(request.user, "2-step sign-in was set up on a phone for your account.")
        return Response({"recovery_codes": codes})


class StaffRecoveryCodesView(APIView):
    def get_permissions(self):
        return [IsStaff(), RequiresSudo()]

    def post(self, request):
        codes = two_factor.regenerate_recovery_codes(request.user)
        if codes is None:
            return Response({"detail": "Turn on 2-step sign-in first."}, status=400)
        record_activity(request.user, "staff.recovery_codes_renewed", target=request.user, method="POST", request=request)
        return Response({"recovery_codes": codes})


class StaffTwoFactorDisableView(APIView):
    def get_permissions(self):
        return [IsStaff(), RequiresSudo()]

    def post(self, request):
        if two_factor.is_required(request.user):
            return Response({"detail": "2-step sign-in can't be turned off for a Super Admin."}, status=400)
        two_factor.disable(request.user)
        record_activity(request.user, "staff.two_factor_disabled", target=request.user, method="POST", request=request)
        send_two_factor_changed_email(request.user, "2-step sign-in was turned off for your account.")
        return Response(status=status.HTTP_204_NO_CONTENT)


class StaffTwoFactorResetView(APIView):
    """A Super Admin resets someone who lost their phone and codes."""

    def get_permissions(self):
        return [HasRolePermission("staff.manage"), RequiresSudo()]

    def post(self, request, pk):
        staff = generics.get_object_or_404(StaffUser, pk=pk)
        guard = _guard_self_action(request, staff)
        if guard:
            return guard
        two_factor.disable(staff)
        record_activity(request.user, "staff.two_factor_reset", target=staff, method="POST", request=request)
        send_two_factor_changed_email(staff, f"{request.user.full_name} reset your 2-step sign-in.")
        return Response(status=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 8: URLs**

In `backend/accounts/urls.py`, after the Task 3 session paths:
```python
    path("staff/login/two-factor/", views.StaffLoginTwoFactorView.as_view(), name="staff-login-two-factor"),
    path("staff/two-factor/", views.StaffTwoFactorStatusView.as_view(), name="staff-two-factor"),
    path("staff/two-factor/enrol/start/", views.StaffTwoFactorEnrolStartView.as_view(), name="staff-two-factor-enrol-start"),
    path("staff/two-factor/enrol/confirm/", views.StaffTwoFactorEnrolConfirmView.as_view(), name="staff-two-factor-enrol-confirm"),
    path("staff/two-factor/setup/", views.StaffTwoFactorSetupView.as_view(), name="staff-two-factor-setup"),
    path("staff/two-factor/setup/confirm/", views.StaffTwoFactorSetupConfirmView.as_view(), name="staff-two-factor-setup-confirm"),
    path("staff/two-factor/recovery-codes/", views.StaffRecoveryCodesView.as_view(), name="staff-two-factor-recovery-codes"),
    path("staff/two-factor/disable/", views.StaffTwoFactorDisableView.as_view(), name="staff-two-factor-disable"),
    path("staff/<int:pk>/two-factor/reset/", views.StaffTwoFactorResetView.as_view(), name="staff-two-factor-reset"),
```

- [ ] **Step 9: Run the tests**

```bash
$BT run --rm web python manage.py test --noinput accounts.tests.test_two_factor
$BT run --rm web python manage.py test --noinput accounts activity
```
Expected: OK. (No existing test signs a Super Admin in through `/staff/login/`; if one does, give that staffer a confirmed 2-step record with `two_factor.begin_enrolment` + `confirm_enrolment` first and finish through `login/two-factor/`.)

- [ ] **Step 10: Commit**

```bash
git add backend infra/env/backend.env.example
git commit -m "feat(staff): 2-step sign-in with an authenticator app, mandatory for Super Admin"
```

---
### Task 5: The approvals engine

**Files:**
- Create: `backend/approvals/__init__.py` (empty), `backend/approvals/apps.py`, `backend/approvals/models.py`, `backend/approvals/registry.py`, `backend/approvals/services.py`
- Create: `backend/approvals/migrations/__init__.py` (empty), `backend/approvals/migrations/0001_initial.py` (generated)
- Create: `backend/accounts/migrations/0037_seed_approvals_permission.py`
- Create: `backend/approvals/tests/__init__.py` (empty), `backend/approvals/tests/kinds.py`, `backend/approvals/tests/test_engine.py`
- Modify: `backend/ashantihub/settings.py` (`INSTALLED_APPS`)

**Interfaces:**
- Consumes: 1A's `activity.services.record`, `notify_staff`, `staff_holding`; `StaffUser.manager`.
- Produces:
  - `approvals.models.ApprovalRequest` — statuses `PENDING/APPROVED/REJECTED/CANCELLED/EXPIRED`, stages `MANAGER/POOL/SUPER_ADMIN`, `STAGE_ORDER`; fields `kind, title, status, stage, maker, assigned_to, pool_permission, target_type, target_id, target_label, payload, before, maker_note, decided_by, decided_at, decision_note, due_at, stage_started_at, reminded_at, escalation_level, created_at`
  - `approvals.registry.ApprovalKind(key, label, pool_permission, current_state, apply, response_hours=24, resolve_approver=None, render_diff=None, validate=None)`; `register(kind)`, `unregister(key)`, `get_kind(key)`, `all_kinds()` — `validate(request)` runs at decision time after the stale check and raises `approvals.services.ApprovalError(message)` to refuse
  - `approvals.services`: `VIEW_ALL`, `STALE_MESSAGE`; errors `ApprovalError` (`.message`, `.status_code`), `MakerCannotDecide` 403, `NotYourDecision` 403, `StaleRequest` 409, `NotPending` 400, `NoteRequired` 400, `UnknownKind` 400; `submit(maker, kind_key, *, title, payload, target=None, target_type="", target_id="", target_label="", maker_note="", request=None) -> ApprovalRequest`; `approve(approval_id, staff, note="", http_request=None)`; `reject(approval_id, staff, note, http_request=None)`; `cancel(approval_id, staff, http_request=None)`; `escalate_due(now=None) -> int`; `can_decide(approval, staff) -> bool`; `approvers_for(approval) -> QuerySet`; `waiting_for(staff) -> QuerySet`; `visible_to(staff) -> QuerySet`; `diff_rows(approval) -> list`; `is_stale(approval) -> bool`
  - activity verbs `approval.requested`, `approval.approved`, `approval.rejected`, `approval.cancelled`, `approval.escalated`, `approval.applied_directly`; notification kinds `approval_waiting`, `approval_reminder`, `approval_escalated`, `approval_decided`, `approval_applied_directly` (link `approvals/<id>`)
  - permission `approvals.view_all` (super_admin)
  - test-only kinds `approvals.tests.kinds.RENAME_STAFF` (pool permission `kyc.approve`) and `BROKEN_APPLY`

- [ ] **Step 1: Write the failing tests**

`backend/approvals/tests/kinds.py`:
```python
"""Test-only approval kinds. Phase 1 ships the engine with no user-facing
kinds; phase 2 registers the first real ones (business.kyc, listing.create…)."""
from dataclasses import replace

from accounts.models import StaffUser
from approvals.registry import ApprovalKind


def _current(request):
    return {"full_name": StaffUser.objects.get(pk=request.target_id).full_name}


def _apply(request):
    StaffUser.objects.filter(pk=request.target_id).update(full_name=request.payload["full_name"])


RENAME_STAFF = ApprovalKind(
    key="test.rename_staff",
    label="Rename a staff member (test only)",
    pool_permission="kyc.approve",
    current_state=_current,
    apply=_apply,
    response_hours=24,
)


def _boom(request):
    raise RuntimeError("apply failed")


BROKEN_APPLY = replace(RENAME_STAFF, key="test.broken_apply", apply=_boom)
```
`backend/approvals/tests/test_engine.py`:
```python
import threading
from dataclasses import replace
from datetime import timedelta

from django.db import connection
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from accounts.models import Role, StaffUser
from activity.models import ActivityEvent
from approvals import registry, services
from approvals.tests.kinds import BROKEN_APPLY, RENAME_STAFF
from notifications.models import Notification


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


class Base(TestCase):
    def setUp(self):
        registry.register(RENAME_STAFF)
        self.addCleanup(registry.unregister, RENAME_STAFF.key)
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.other_ops = make_staff("operations", "kojo@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.esi = make_staff("support", "esi@example.com")

    def submit(self, maker=None, kind=RENAME_STAFF):
        return services.submit(
            maker or self.scout, kind.key, target=self.esi, title="Rename Esi", payload={"full_name": "Esi Nyarko"}
        )


class SubmitTests(Base):
    def test_a_request_goes_to_the_makers_manager_first(self):
        approval = self.submit()
        self.assertEqual((approval.status, approval.stage, approval.assigned_to), ("pending", "manager", self.lead))
        self.assertEqual(approval.before, {"full_name": "Esi"})
        self.assertEqual((approval.target_type, approval.target_id), ("accounts.staffuser", str(self.esi.pk)))
        self.assertTrue(
            Notification.objects.filter(staff=self.lead, kind="approval_waiting", link=f"approvals/{approval.pk}").exists()
        )
        self.assertTrue(ActivityEvent.objects.filter(verb="approval.requested", actor_id=self.scout.id).exists())

    def test_a_maker_without_a_manager_starts_at_the_pool(self):
        approval = self.submit(maker=self.other_ops)
        self.assertEqual((approval.stage, approval.assigned_to), ("pool", None))
        self.assertTrue(Notification.objects.filter(staff=self.lead, kind="approval_waiting").exists())
        self.assertFalse(Notification.objects.filter(staff=self.other_ops, kind="approval_waiting").exists())

    def test_an_unknown_kind_is_refused(self):
        with self.assertRaises(services.UnknownKind):
            services.submit(self.scout, "no.such.kind", title="x", payload={})

    def test_a_super_admins_own_change_applies_at_once_and_other_super_admins_hear(self):
        second = make_staff("super_admin", "abena@example.com")
        approval = self.submit(maker=self.boss)
        self.esi.refresh_from_db()
        self.assertEqual((approval.status, approval.decided_by, self.esi.full_name), ("approved", self.boss, "Esi Nyarko"))
        self.assertTrue(Notification.objects.filter(staff=second, kind="approval_applied_directly").exists())
        self.assertFalse(Notification.objects.filter(staff=self.boss, kind="approval_applied_directly").exists())
        self.assertTrue(ActivityEvent.objects.filter(verb="approval.applied_directly").exists())


class DecisionTests(Base):
    def test_the_maker_can_never_approve_their_own_request(self):
        approval = self.submit(maker=self.other_ops)  # pool stage; the maker holds the pool permission
        self.assertFalse(services.can_decide(approval, self.other_ops))
        with self.assertRaises(services.MakerCannotDecide):
            services.approve(approval.pk, self.other_ops)

    def test_approving_applies_the_change_and_tells_the_maker(self):
        approval = self.submit()
        services.approve(approval.pk, self.lead, note="Looks right")
        approval.refresh_from_db()
        self.esi.refresh_from_db()
        self.assertEqual((approval.status, approval.decided_by, approval.decision_note), ("approved", self.lead, "Looks right"))
        self.assertEqual(self.esi.full_name, "Esi Nyarko")
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="approval_decided").exists())

    def test_a_failed_apply_rolls_the_decision_back(self):
        registry.register(BROKEN_APPLY)
        self.addCleanup(registry.unregister, BROKEN_APPLY.key)
        approval = self.submit(kind=BROKEN_APPLY)
        with self.assertRaises(RuntimeError):
            services.approve(approval.pk, self.lead)
        approval.refresh_from_db()
        self.assertEqual(approval.status, "pending")
        self.assertFalse(ActivityEvent.objects.filter(verb="approval.approved").exists())

    def test_a_stale_request_cannot_be_approved(self):
        approval = self.submit()
        StaffUser.objects.filter(pk=self.esi.pk).update(full_name="Esi Changed")
        self.assertTrue(services.is_stale(approval))
        with self.assertRaises(services.StaleRequest) as raised:
            services.approve(approval.pk, self.lead)
        self.assertEqual(raised.exception.message, "This changed since it was requested — ask for a fresh request.")

    def test_only_the_current_approver_or_a_super_admin_decides(self):
        approval = self.submit()
        with self.assertRaises(services.NotYourDecision):
            services.approve(approval.pk, self.other_ops)
        services.approve(approval.pk, self.boss)

    def test_a_kind_can_refuse_a_decision_with_its_own_reason(self):
        def not_yet(request):
            raise services.ApprovalError("Approve the business's KYC first.")

        guarded = replace(RENAME_STAFF, key="test.guarded", validate=not_yet)
        registry.register(guarded)
        self.addCleanup(registry.unregister, guarded.key)
        approval = self.submit(kind=guarded)
        with self.assertRaises(services.ApprovalError) as raised:
            services.approve(approval.pk, self.lead)
        self.assertEqual(raised.exception.message, "Approve the business's KYC first.")
        approval.refresh_from_db()
        self.assertEqual(approval.status, "pending")

    def test_returning_needs_a_note(self):
        approval = self.submit()
        with self.assertRaises(services.NoteRequired):
            services.reject(approval.pk, self.lead, note="  ")
        services.reject(approval.pk, self.lead, note="Wrong spelling")
        approval.refresh_from_db()
        self.assertEqual(approval.status, "rejected")
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="approval_decided", body="Wrong spelling").exists())

    def test_only_the_maker_cancels_and_only_while_pending(self):
        approval = self.submit()
        with self.assertRaises(services.NotYourDecision):
            services.cancel(approval.pk, self.lead)
        services.cancel(approval.pk, self.scout)
        with self.assertRaises(services.NotPending):
            services.cancel(approval.pk, self.scout)

    def test_a_decided_request_cannot_be_decided_again(self):
        approval = self.submit()
        services.approve(approval.pk, self.lead)
        with self.assertRaises(services.NotPending):
            services.reject(approval.pk, self.boss, note="late")


class EscalationTests(Base):
    def test_reminder_at_three_quarters_then_up_a_level_at_the_deadline(self):
        approval = self.submit()
        start = approval.stage_started_at
        services.escalate_due(now=start + timedelta(hours=17))
        self.assertFalse(Notification.objects.filter(kind="approval_reminder").exists())
        services.escalate_due(now=start + timedelta(hours=18))
        self.assertTrue(Notification.objects.filter(staff=self.lead, kind="approval_reminder").exists())
        services.escalate_due(now=start + timedelta(hours=24))
        approval.refresh_from_db()
        self.assertEqual((approval.stage, approval.escalation_level, approval.assigned_to), ("pool", 1, None))
        self.assertTrue(Notification.objects.filter(staff=self.other_ops, kind="approval_escalated").exists())
        self.assertTrue(ActivityEvent.objects.filter(verb="approval.escalated", actor_type="system").exists())
        services.escalate_due(now=approval.due_at)
        approval.refresh_from_db()
        self.assertEqual((approval.stage, approval.escalation_level), ("super_admin", 2))
        self.assertTrue(Notification.objects.filter(staff=self.boss, kind="approval_escalated").exists())

    def test_the_last_level_keeps_reminding(self):
        approval = self.submit(maker=self.other_ops)
        services.escalate_due(now=approval.due_at)
        approval.refresh_from_db()
        self.assertEqual(approval.stage, "super_admin")
        before = Notification.objects.filter(staff=self.boss).count()
        services.escalate_due(now=approval.due_at)
        approval.refresh_from_db()
        self.assertEqual(approval.stage, "super_admin")
        self.assertEqual(Notification.objects.filter(staff=self.boss).count(), before + 1)

    def test_a_deactivated_manager_is_skipped_straight_away(self):
        approval = self.submit()
        StaffUser.objects.filter(pk=self.lead.pk).update(is_active=False)
        services.escalate_due(now=timezone.now())
        approval.refresh_from_db()
        self.assertEqual(approval.stage, "pool")

    def test_decided_requests_are_left_alone(self):
        approval = self.submit()
        services.approve(approval.pk, self.lead)
        services.escalate_due(now=approval.due_at + timedelta(days=1))
        approval.refresh_from_db()
        self.assertEqual((approval.stage, approval.status), ("manager", "approved"))


class ConcurrentDecisionTests(TransactionTestCase):
    """Review Focus 3: two approvers press Approve at the same moment."""

    serialized_rollback = True

    def test_two_approvers_at_once_decide_it_exactly_once(self):
        applied = []
        counting = replace(RENAME_STAFF, key="test.counting", apply=lambda request: applied.append(request.pk))
        registry.register(counting)
        self.addCleanup(registry.unregister, counting.key)
        lead = make_staff("operations", "ama@example.com")
        boss = make_staff("super_admin", "boss@example.com")
        scout = make_staff("scout", "kwame@example.com", manager=lead)
        esi = make_staff("support", "esi@example.com")
        approval = services.submit(scout, counting.key, target=esi, title="Rename Esi", payload={"full_name": "Esi Nyarko"})
        results = []
        barrier = threading.Barrier(2)

        def decide(staff):
            try:
                barrier.wait()
                services.approve(approval.pk, staff)
                results.append("approved")
            except services.NotPending:
                results.append("already decided")
            finally:
                connection.close()

        threads = [threading.Thread(target=decide, args=(staff,)) for staff in (lead, boss)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(sorted(results), ["already decided", "approved"])
        self.assertEqual(applied, [approval.pk])
```

- [ ] **Step 2: Create the app skeleton and register it**

Empty files: `backend/approvals/__init__.py`, `backend/approvals/migrations/__init__.py`, `backend/approvals/tests/__init__.py`.
`backend/approvals/apps.py`:
```python
from django.apps import AppConfig


class ApprovalsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "approvals"
```
Add `"approvals",` to `INSTALLED_APPS` after `"calls",`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `$BT run --rm web python manage.py test --noinput approvals`
Expected: ERROR — `cannot import name 'registry' from 'approvals'`.

- [ ] **Step 4: The model**

`backend/approvals/models.py`:
```python
from django.db import models
from django.utils import timezone


class ApprovalRequest(models.Model):
    """One staged change waiting for someone other than its maker (staff
    foundations F5). Its kind's registry entry (approvals/registry.py) reads
    the target's current state, applies the change and renders the diff."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    STATUS_CHOICES = [
        (PENDING, "Pending"),
        (APPROVED, "Approved"),
        (REJECTED, "Returned"),
        (CANCELLED, "Cancelled"),
        (EXPIRED, "Expired"),
    ]
    MANAGER = "manager"
    POOL = "pool"
    SUPER_ADMIN = "super_admin"
    STAGE_CHOICES = [
        (MANAGER, "The maker's manager"),
        (POOL, "Anyone holding the kind's permission"),
        (SUPER_ADMIN, "A Super Admin"),
    ]
    STAGE_ORDER = [MANAGER, POOL, SUPER_ADMIN]

    kind = models.CharField(max_length=60)
    title = models.CharField(max_length=200)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    stage = models.CharField(max_length=12, choices=STAGE_CHOICES, default=SUPER_ADMIN)
    maker = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="approval_requests_made")
    assigned_to = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.PROTECT, null=True, blank=True, related_name="approval_requests_assigned"
    )
    pool_permission = models.CharField(max_length=100, blank=True, default="")
    target_type = models.CharField(max_length=50, blank=True, default="")
    target_id = models.CharField(max_length=64, blank=True, default="")
    target_label = models.CharField(max_length=200, blank=True, default="")
    payload = models.JSONField(default=dict, blank=True)
    before = models.JSONField(default=dict, blank=True)
    maker_note = models.TextField(blank=True, default="")
    decided_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.PROTECT, null=True, blank=True, related_name="approval_requests_decided"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True, default="")
    due_at = models.DateTimeField()
    stage_started_at = models.DateTimeField(default=timezone.now)
    reminded_at = models.DateTimeField(null=True, blank=True)
    escalation_level = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["status", "stage", "due_at"]),
            models.Index(fields=["maker", "status"]),
            models.Index(fields=["assigned_to", "status"]),
        ]

    def __str__(self):
        return self.title
```
Run: `$BT run --rm web python manage.py makemigrations approvals`
Expected: `approvals/migrations/0001_initial.py`.

- [ ] **Step 5: The permission**

`backend/accounts/migrations/0037_seed_approvals_permission.py`:
```python
from django.db import migrations


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    perm, _ = Permission.objects.get_or_create(
        codename="approvals.view_all",
        defaults={"description": "See every approval request and decide any of them, at any stage"},
    )
    Role.objects.get(name="super_admin").permissions.add(perm)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename="approvals.view_all").delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0036_stafftwofactor")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 6: The registry**

`backend/approvals/registry.py`:
```python
"""Approval kinds (staff foundations F5). Each app registers its kinds in its
AppConfig.ready(); tests register throwaway kinds and unregister them."""
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass(frozen=True)
class ApprovalKind:
    key: str                  # stored on every request, e.g. "business.kyc"
    label: str                # shown in the inbox
    pool_permission: str      # second level: anyone holding this may decide
    current_state: Callable   # (request) -> JSON-able snapshot of the target now
    apply: Callable           # (request) -> None; runs inside the decision's transaction
    response_hours: int = 24  # per level; reminder at 75%, move up at 100%
    resolve_approver: Optional[Callable] = None  # (request) -> [(stage, StaffUser | None), …]
    render_diff: Optional[Callable] = None       # (request) -> [{"field", "before", "after"}, …]
    validate: Optional[Callable] = None          # (request) -> None; raise ApprovalError(message) to refuse


_KINDS = {}


def register(kind):
    if kind.key in _KINDS:
        raise ValueError(f"Approval kind {kind.key!r} is already registered")
    _KINDS[kind.key] = kind
    return kind


def unregister(key):
    _KINDS.pop(key, None)


def get_kind(key):
    return _KINDS.get(key)


def all_kinds():
    return dict(_KINDS)
```

- [ ] **Step 7: The services**

`backend/approvals/services.py`:
```python
"""The approvals engine (staff foundations F5). Domain code stages a change
with submit(); the inbox decides it with approve()/reject(); the maker may
cancel(); escalate_due() (Celery, every 5 minutes) reminds and moves requests
up the chain. The maker never decides their own request."""
import json
from datetime import timedelta

from django.core.exceptions import ObjectDoesNotExist
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import Role, StaffUser
from accounts.permissions import staff_holding
from activity.services import record
from notifications.services import notify_staff

from .models import ApprovalRequest
from .registry import get_kind

VIEW_ALL = "approvals.view_all"
REMIND_AT = 0.75
DEFAULT_RESPONSE_HOURS = 24
STALE_MESSAGE = "This changed since it was requested — ask for a fresh request."


class ApprovalError(Exception):
    status_code = 400

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class MakerCannotDecide(ApprovalError):
    status_code = 403


class NotYourDecision(ApprovalError):
    status_code = 403


class StaleRequest(ApprovalError):
    status_code = 409


class NotPending(ApprovalError):
    pass


class NoteRequired(ApprovalError):
    pass


class UnknownKind(ApprovalError):
    pass


def _normalise(value):
    return json.loads(json.dumps(value, default=str, sort_keys=True))


def default_chain(approval):
    """Who decides, in order: the maker's manager, then anyone holding the
    kind's pool permission, then a Super Admin (spec F5)."""
    steps = []
    manager = approval.maker.manager
    if manager is not None and manager.is_active and not manager.is_suspended:
        steps.append((ApprovalRequest.MANAGER, manager))
    if approval.pool_permission:
        steps.append((ApprovalRequest.POOL, None))
    steps.append((ApprovalRequest.SUPER_ADMIN, None))
    return steps


def chain_for(approval):
    kind = get_kind(approval.kind)
    resolver = kind.resolve_approver if kind is not None and kind.resolve_approver else default_chain
    return resolver(approval)


def _next_step(approval):
    rank = ApprovalRequest.STAGE_ORDER.index(approval.stage)
    for stage, staff in chain_for(approval):
        if ApprovalRequest.STAGE_ORDER.index(stage) > rank:
            return stage, staff
    return None


def approvers_for(approval):
    """Who decides at the current stage (never the maker). approvals.view_all
    holders may also decide at any stage — see can_decide()."""
    if approval.stage == ApprovalRequest.MANAGER:
        approvers = StaffUser.objects.filter(pk=approval.assigned_to_id, is_active=True, is_suspended=False)
    elif approval.stage == ApprovalRequest.POOL:
        approvers = staff_holding(approval.pool_permission)
    else:
        approvers = staff_holding(VIEW_ALL)
    return approvers.exclude(pk=approval.maker_id)


def can_decide(approval, staff):
    if approval.status != ApprovalRequest.PENDING or staff.pk == approval.maker_id:
        return False
    if VIEW_ALL in staff.effective_permission_codenames():
        return True
    return approvers_for(approval).filter(pk=staff.pk).exists()


def waiting_for(staff):
    """Pending requests at a stage this staffer decides: the inbox's
    "Waiting for me" and the nav badge."""
    perms = staff.effective_permission_codenames()
    scope = Q(stage=ApprovalRequest.MANAGER, assigned_to=staff)
    if perms:
        scope |= Q(stage=ApprovalRequest.POOL, pool_permission__in=perms)
    if VIEW_ALL in perms:
        scope |= Q(stage=ApprovalRequest.SUPER_ADMIN)
    return ApprovalRequest.objects.filter(status=ApprovalRequest.PENDING).filter(scope).exclude(maker=staff)


def visible_to(staff):
    """Requests this staffer may open: their own, their direct reports',
    ones they decided or can decide now; everything for approvals.view_all."""
    if VIEW_ALL in staff.effective_permission_codenames():
        return ApprovalRequest.objects.all()
    return ApprovalRequest.objects.filter(
        Q(maker=staff) | Q(maker__manager=staff) | Q(decided_by=staff) | Q(pk__in=waiting_for(staff).values("pk"))
    )


def _link(approval):
    return f"approvals/{approval.pk}"


def _notify_approvers(approval, kind, title):
    for staff in approvers_for(approval):
        notify_staff(staff, kind, title, body=approval.target_label, link=_link(approval), icon="🗳️")


def _response_time(approval):
    kind = get_kind(approval.kind)
    return timedelta(hours=kind.response_hours if kind is not None else DEFAULT_RESPONSE_HOURS)


def _enter_stage(approval, stage, staff, now):
    approval.stage = stage
    approval.assigned_to = staff if stage == ApprovalRequest.MANAGER else None
    approval.stage_started_at = now
    approval.due_at = now + _response_time(approval)
    approval.reminded_at = None


def submit(maker, kind_key, *, title, payload, target=None, target_type="", target_id="", target_label="",
           maker_note="", request=None):
    """Stage a change for approval. A Super Admin's own change applies at once
    (a sole owner can't be maker-checked) and the other Super Admins are told."""
    kind = get_kind(kind_key)
    if kind is None:
        raise UnknownKind(f"Unknown approval kind: {kind_key}")
    if target is not None:
        target_type, target_id, target_label = target._meta.label_lower, str(target.pk), str(target)
    now = timezone.now()
    with transaction.atomic():
        approval = ApprovalRequest(
            kind=kind.key, title=title[:200], maker=maker, pool_permission=kind.pool_permission,
            target_type=target_type[:50], target_id=str(target_id)[:64], target_label=target_label[:200],
            payload=_normalise(payload), maker_note=maker_note, created_at=now,
        )
        approval.before = _normalise(kind.current_state(approval))
        if maker.role.name == Role.SUPER_ADMIN:
            kind.apply(approval)
            approval.status = ApprovalRequest.APPROVED
            approval.decided_by = maker
            approval.decided_at = now
            approval.decision_note = "Applied directly: a Super Admin's own change."
            _enter_stage(approval, ApprovalRequest.SUPER_ADMIN, None, now)
            approval.save()
            for other in staff_holding(VIEW_ALL).filter(role__name=Role.SUPER_ADMIN).exclude(pk=maker.pk):
                notify_staff(
                    other, "approval_applied_directly", f"{maker.full_name} applied: {approval.title}",
                    body=approval.target_label, link=_link(approval), icon="🗳️",
                )
            record(maker, "approval.applied_directly", target=approval,
                   after={"kind": kind.key, "payload": approval.payload}, request=request)
            return approval
        stage, staff = chain_for(approval)[0]
        _enter_stage(approval, stage, staff, now)
        approval.save()
        _notify_approvers(approval, "approval_waiting", f"Waiting for you: {approval.title}")
        record(maker, "approval.requested", target=approval,
               after={"kind": kind.key, "payload": approval.payload}, request=request)
    return approval


def _lock(approval_id):
    return ApprovalRequest.objects.select_for_update(of=("self",)).select_related("maker").get(pk=approval_id)


def _check_decidable(approval, staff):
    if approval.status != ApprovalRequest.PENDING:
        raise NotPending("This request has already been decided.")
    if staff.pk == approval.maker_id:
        raise MakerCannotDecide("You can't approve your own request.")
    if not can_decide(approval, staff):
        raise NotYourDecision("This request is waiting for someone else.")


def _state_now(kind, approval):
    try:
        return _normalise(kind.current_state(approval))
    except ObjectDoesNotExist as exc:
        raise StaleRequest(STALE_MESSAGE) from exc


def is_stale(approval):
    kind = get_kind(approval.kind)
    if kind is None:
        return False
    try:
        return _state_now(kind, approval) != approval.before
    except StaleRequest:
        return True


def approve(approval_id, staff, note="", http_request=None):
    with transaction.atomic():
        approval = _lock(approval_id)
        _check_decidable(approval, staff)
        kind = get_kind(approval.kind)
        if kind is None:
            raise UnknownKind("This kind of request can no longer be decided.")
        if _state_now(kind, approval) != approval.before:
            raise StaleRequest(STALE_MESSAGE)
        if kind.validate is not None:
            kind.validate(approval)  # e.g. "approve the business's KYC first" — raises ApprovalError
        kind.apply(approval)
        approval.status = ApprovalRequest.APPROVED
        approval.decided_by = staff
        approval.decided_at = timezone.now()
        approval.decision_note = (note or "").strip()
        approval.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
        notify_staff(approval.maker, "approval_decided", f"Approved: {approval.title}",
                     body=approval.decision_note, link=_link(approval), icon="✅")
        record(staff, "approval.approved", target=approval, after={"note": approval.decision_note}, request=http_request)
    return approval


def reject(approval_id, staff, note, http_request=None):
    note = (note or "").strip()
    with transaction.atomic():
        approval = _lock(approval_id)
        _check_decidable(approval, staff)
        if not note:
            raise NoteRequired("Write a note so the maker knows what to change.")
        approval.status = ApprovalRequest.REJECTED
        approval.decided_by = staff
        approval.decided_at = timezone.now()
        approval.decision_note = note
        approval.save(update_fields=["status", "decided_by", "decided_at", "decision_note"])
        notify_staff(approval.maker, "approval_decided", f"Returned: {approval.title}",
                     body=note, link=_link(approval), icon="↩️")
        record(staff, "approval.rejected", target=approval, after={"note": note}, request=http_request)
    return approval


def cancel(approval_id, staff, http_request=None):
    with transaction.atomic():
        approval = _lock(approval_id)
        if approval.status != ApprovalRequest.PENDING:
            raise NotPending("This request has already been decided.")
        if staff.pk != approval.maker_id:
            raise NotYourDecision("Only the person who made a request can cancel it.")
        approval.status = ApprovalRequest.CANCELLED
        approval.decided_by = staff
        approval.decided_at = timezone.now()
        approval.save(update_fields=["status", "decided_by", "decided_at"])
        record(staff, "approval.cancelled", target=approval, request=http_request)
    return approval


def _remind_at(approval):
    return approval.stage_started_at + (approval.due_at - approval.stage_started_at) * REMIND_AT


def _assignee_gone(approval):
    assignee = approval.assigned_to
    return approval.stage == ApprovalRequest.MANAGER and (
        assignee is None or not assignee.is_active or assignee.is_suspended
    )


def escalate_due(now=None):
    """Remind at 75% of the response time; at 100% — or straight away if the
    assigned manager has left or is suspended — move one level up. The last
    level (Super Admin) is reminded again each time its time runs out.
    Returns how many requests moved up."""
    now = now or timezone.now()
    moved = 0
    pending = list(ApprovalRequest.objects.filter(status=ApprovalRequest.PENDING).values_list("pk", flat=True))
    for pk in pending:
        with transaction.atomic():
            approval = (
                ApprovalRequest.objects.select_for_update(skip_locked=True, of=("self",))
                .select_related("maker", "assigned_to")
                .filter(pk=pk, status=ApprovalRequest.PENDING)
                .first()
            )
            if approval is None:
                continue
            if _assignee_gone(approval) or now >= approval.due_at:
                step = _next_step(approval)
                if step is None:
                    _enter_stage(approval, approval.stage, approval.assigned_to, now)
                    approval.save()
                    _notify_approvers(approval, "approval_reminder", f"Overdue: {approval.title}")
                    continue
                _enter_stage(approval, step[0], step[1], now)
                approval.escalation_level += 1
                approval.save()
                _notify_approvers(approval, "approval_escalated", f"Moved to you: {approval.title}")
                record(None, "approval.escalated", target=approval,
                       after={"stage": approval.stage, "level": approval.escalation_level})
                moved += 1
            elif approval.reminded_at is None and now >= _remind_at(approval):
                approval.reminded_at = now
                approval.save(update_fields=["reminded_at"])
                _notify_approvers(approval, "approval_reminder", f"Due soon: {approval.title}")
    return moved


def diff_rows(approval):
    kind = get_kind(approval.kind)
    if kind is not None and kind.render_diff:
        return kind.render_diff(approval)
    if isinstance(approval.payload, dict):
        before = approval.before if isinstance(approval.before, dict) else {}
        return [{"field": key, "before": before.get(key), "after": value} for key, value in approval.payload.items()]
    return [{"field": "", "before": approval.before, "after": approval.payload}]
```

- [ ] **Step 8: Run the tests**

```bash
$BT run --rm web python manage.py test --noinput approvals accounts.tests.test_roles_seed
```
Expected: OK (including `ConcurrentDecisionTests` and `test_super_admin_has_every_permission`).

- [ ] **Step 9: Commit**

```bash
git add backend
git commit -m "feat(staff): approvals engine — maker-checker, staged changes, escalation"
```

---

### Task 6: Approvals API, badge and escalation job

**Files:**
- Create: `backend/approvals/serializers.py`, `backend/approvals/views.py`, `backend/approvals/urls.py`, `backend/approvals/tasks.py`
- Modify: `backend/ashantihub/urls.py`, `backend/ashantihub/settings.py` (`CELERY_BEAT_SCHEDULE`)
- Modify: `backend/notifications/views.py` (`StaffBadgesView`: `approvals_waiting`)
- Test: `backend/approvals/tests/test_api.py`

**Interfaces:**
- Consumes: Task 5 (`services`, `registry`, `ApprovalRequest`), Task 3 (`staff_token`).
- Produces:
  - `GET /api/approvals/?box=mine|made|team|decided|all&status=&kind=` → DRF page (25) of rows; `all` needs `approvals.view_all` (403); an unknown box 400; `mine` is ordered by due time, the rest newest first
  - row: `{id, kind, kind_label, title, status, stage, maker: {id, full_name, role}, assigned_to, pool_permission, target: {type, id, label}, maker_note, decided_by, decided_at, decision_note, due_at, escalation_level, created_at, can_decide, can_cancel}`
  - `GET /api/approvals/counts/` → `{mine, made, team, decided, can_view_all}` (made/team count pending only)
  - `GET /api/approvals/<id>/` → row + `payload`, `before`, `diff: [{field, before, after}]`, `stale`; 404 unless `visible_to`
  - `POST /api/approvals/<id>/approve/` `{note?}`, `/reject/` `{note}`, `/cancel/` → the detail payload, or `{"detail": message}` with the error's status
  - staff badge key `approvals_waiting`; Celery task `approvals.tasks.escalate_due_approvals` every 300 s

- [ ] **Step 1: Write the failing tests**

`backend/approvals/tests/test_api.py`:
```python
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, StaffUser
from accounts.testing import staff_token
from activity.models import ActivityEvent
from approvals import registry, services
from approvals.models import ApprovalRequest
from approvals.tasks import escalate_due_approvals
from approvals.tests.kinds import RENAME_STAFF


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


class ApprovalApiTests(TestCase):
    def setUp(self):
        registry.register(RENAME_STAFF)
        self.addCleanup(registry.unregister, RENAME_STAFF.key)
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.other_ops = make_staff("operations", "kojo@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.esi = make_staff("support", "esi@example.com")

    def as_(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def submit(self, maker=None):
        return services.submit(
            maker or self.scout, RENAME_STAFF.key, target=self.esi, title="Rename Esi",
            payload={"full_name": "Esi Nyarko"}, maker_note="She spelled it out at the office",
        )

    def ids(self, box):
        return [row["id"] for row in self.client.get(f"/api/approvals/?box={box}").json()["results"]]

    def test_the_inbox_boxes(self):
        approval = self.submit()
        self.as_(self.lead)
        self.assertEqual(self.ids("mine"), [approval.id])
        self.assertEqual(self.ids("team"), [approval.id])
        self.assertEqual(self.ids("made"), [])
        self.as_(self.scout)
        self.assertEqual(self.ids("made"), [approval.id])
        self.assertEqual(self.ids("mine"), [])
        self.assertEqual(self.client.get("/api/approvals/?box=all").status_code, 403)
        self.assertEqual(self.client.get("/api/approvals/?box=nope").status_code, 400)
        self.as_(self.boss)
        self.assertEqual(self.ids("all"), [approval.id])

    def test_a_row_carries_what_the_inbox_shows(self):
        self.submit()
        self.as_(self.lead)
        row = self.client.get("/api/approvals/?box=mine").json()["results"][0]
        self.assertEqual(row["kind_label"], "Rename a staff member (test only)")
        self.assertEqual(row["maker"], {"id": self.scout.id, "full_name": "Kwame", "role": "scout"})
        self.assertEqual(row["assigned_to"]["id"], self.lead.id)
        self.assertEqual(row["target"], {"type": "accounts.staffuser", "id": str(self.esi.id), "label": str(self.esi)})
        self.assertTrue(row["can_decide"])
        self.assertFalse(row["can_cancel"])

    def test_detail_shows_the_diff_and_whether_it_went_stale(self):
        approval = self.submit()
        self.as_(self.lead)
        detail = self.client.get(f"/api/approvals/{approval.id}/").json()
        self.assertEqual(detail["diff"], [{"field": "full_name", "before": "Esi", "after": "Esi Nyarko"}])
        self.assertFalse(detail["stale"])
        StaffUser.objects.filter(pk=self.esi.pk).update(full_name="Esi Changed")
        self.assertTrue(self.client.get(f"/api/approvals/{approval.id}/").json()["stale"])

    def test_outsiders_cannot_open_a_request(self):
        approval = self.submit()
        self.as_(make_staff("marketing", "akua@example.com"))
        self.assertEqual(self.client.get(f"/api/approvals/{approval.id}/").status_code, 404)

    def test_approve_through_the_api(self):
        approval = self.submit()
        self.as_(self.lead)
        response = self.client.post(f"/api/approvals/{approval.id}/approve/", {"note": "ok"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "approved")
        self.esi.refresh_from_db()
        self.assertEqual(self.esi.full_name, "Esi Nyarko")
        # requested + approved; the middleware adds no "approval-approve" duplicate
        self.assertEqual(ActivityEvent.objects.filter(verb__startswith="approval").count(), 2)

    def test_the_maker_is_refused_with_a_clear_message(self):
        approval = self.submit(maker=self.other_ops)
        self.as_(self.other_ops)
        response = self.client.post(f"/api/approvals/{approval.id}/approve/", {}, format="json")
        self.assertEqual((response.status_code, response.json()["detail"]), (403, "You can't approve your own request."))

    def test_a_stale_request_answers_409(self):
        approval = self.submit()
        StaffUser.objects.filter(pk=self.esi.pk).update(full_name="Esi Changed")
        self.as_(self.lead)
        response = self.client.post(f"/api/approvals/{approval.id}/approve/", {}, format="json")
        self.assertEqual(
            (response.status_code, response.json()["detail"]),
            (409, "This changed since it was requested — ask for a fresh request."),
        )

    def test_return_needs_a_note(self):
        approval = self.submit()
        self.as_(self.lead)
        self.assertEqual(self.client.post(f"/api/approvals/{approval.id}/reject/", {}, format="json").status_code, 400)
        response = self.client.post(f"/api/approvals/{approval.id}/reject/", {"note": "Spelling"}, format="json")
        self.assertEqual(response.json()["status"], "rejected")

    def test_the_maker_cancels(self):
        approval = self.submit()
        self.as_(self.lead)
        self.assertEqual(self.client.post(f"/api/approvals/{approval.id}/cancel/", {}, format="json").status_code, 403)
        self.as_(self.scout)
        self.assertEqual(self.client.post(f"/api/approvals/{approval.id}/cancel/", {}, format="json").json()["status"], "cancelled")

    def test_counts_and_the_nav_badge(self):
        self.submit()
        self.as_(self.lead)
        self.assertEqual(
            self.client.get("/api/approvals/counts/").json(),
            {"mine": 1, "made": 0, "team": 1, "decided": 0, "can_view_all": False},
        )
        self.assertEqual(self.client.get("/api/notifications/staff-badges/").json()["approvals_waiting"], 1)

    def test_the_escalation_job(self):
        approval = self.submit()
        ApprovalRequest.objects.filter(pk=approval.pk).update(due_at=timezone.now() - timedelta(minutes=1))
        escalate_due_approvals()
        approval.refresh_from_db()
        self.assertEqual(approval.stage, "pool")
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$BT run --rm web python manage.py test --noinput approvals.tests.test_api`
Expected: ERROR — `No module named 'approvals.tasks'`.

- [ ] **Step 3: Serializers**

`backend/approvals/serializers.py`:
```python
from rest_framework import serializers

from . import services
from .models import ApprovalRequest
from .registry import get_kind


def person(staff):
    if staff is None:
        return None
    return {"id": staff.pk, "full_name": staff.full_name, "role": staff.role.name}


class ApprovalSerializer(serializers.ModelSerializer):
    kind_label = serializers.SerializerMethodField()
    maker = serializers.SerializerMethodField()
    assigned_to = serializers.SerializerMethodField()
    decided_by = serializers.SerializerMethodField()
    target = serializers.SerializerMethodField()
    can_decide = serializers.SerializerMethodField()
    can_cancel = serializers.SerializerMethodField()

    class Meta:
        model = ApprovalRequest
        fields = [
            "id", "kind", "kind_label", "title", "status", "stage", "maker", "assigned_to", "pool_permission",
            "target", "maker_note", "decided_by", "decided_at", "decision_note", "due_at", "escalation_level",
            "created_at", "can_decide", "can_cancel",
        ]

    def get_kind_label(self, obj):
        kind = get_kind(obj.kind)
        return kind.label if kind is not None else obj.kind

    def get_maker(self, obj):
        return person(obj.maker)

    def get_assigned_to(self, obj):
        return person(obj.assigned_to)

    def get_decided_by(self, obj):
        return person(obj.decided_by)

    def get_target(self, obj):
        return {"type": obj.target_type, "id": obj.target_id, "label": obj.target_label}

    def get_can_decide(self, obj):
        return services.can_decide(obj, self.context["request"].user)

    def get_can_cancel(self, obj):
        return obj.status == ApprovalRequest.PENDING and obj.maker_id == self.context["request"].user.pk


class ApprovalDetailSerializer(ApprovalSerializer):
    diff = serializers.SerializerMethodField()
    stale = serializers.SerializerMethodField()

    class Meta(ApprovalSerializer.Meta):
        fields = ApprovalSerializer.Meta.fields + ["payload", "before", "diff", "stale"]

    def get_diff(self, obj):
        return services.diff_rows(obj)

    def get_stale(self, obj):
        return obj.status == ApprovalRequest.PENDING and services.is_stale(obj)
```

- [ ] **Step 4: Views and URLs**

`backend/approvals/views.py`:
```python
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsStaff

from . import services
from .models import ApprovalRequest
from .serializers import ApprovalDetailSerializer, ApprovalSerializer

BOXES = ("mine", "made", "team", "decided", "all")


def box_queryset(staff, box):
    if box == "mine":
        return services.waiting_for(staff)
    if box == "made":
        return ApprovalRequest.objects.filter(maker=staff)
    if box == "team":
        return ApprovalRequest.objects.filter(maker__manager=staff)
    if box == "decided":
        return ApprovalRequest.objects.filter(decided_by=staff)
    if box == "all":
        if services.VIEW_ALL not in staff.effective_permission_codenames():
            raise PermissionDenied("Only a Super Admin can see every request.")
        return ApprovalRequest.objects.all()
    raise ValidationError({"box": f"Use one of: {', '.join(BOXES)}."})


class ApprovalPagination(PageNumberPagination):
    page_size = 25


class ApprovalListView(generics.ListAPIView):
    serializer_class = ApprovalSerializer
    pagination_class = ApprovalPagination

    def get_permissions(self):
        return [IsStaff()]

    def get_queryset(self):
        params = self.request.query_params
        box = params.get("box", "mine")
        approvals = box_queryset(self.request.user, box).select_related("maker__role", "assigned_to__role", "decided_by__role")
        if params.get("status"):
            approvals = approvals.filter(status=params["status"])
        if params.get("kind"):
            approvals = approvals.filter(kind=params["kind"])
        return approvals.order_by("due_at", "id") if box == "mine" else approvals.order_by("-created_at", "-id")


class ApprovalCountsView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        user = request.user
        pending = ApprovalRequest.objects.filter(status=ApprovalRequest.PENDING)
        return Response({
            "mine": services.waiting_for(user).count(),
            "made": pending.filter(maker=user).count(),
            "team": pending.filter(maker__manager=user).count(),
            "decided": ApprovalRequest.objects.filter(decided_by=user).count(),
            "can_view_all": services.VIEW_ALL in user.effective_permission_codenames(),
        })


class ApprovalDetailView(generics.RetrieveAPIView):
    serializer_class = ApprovalDetailSerializer

    def get_permissions(self):
        return [IsStaff()]

    def get_queryset(self):
        return services.visible_to(self.request.user).select_related("maker__role", "assigned_to__role", "decided_by__role")


class _DecisionView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def decide(self, approval, request):
        raise NotImplementedError

    def post(self, request, pk):
        approval = generics.get_object_or_404(services.visible_to(request.user), pk=pk)
        try:
            self.decide(approval, request)
        except services.ApprovalError as exc:
            return Response({"detail": exc.message}, status=exc.status_code)
        approval.refresh_from_db()
        return Response(ApprovalDetailSerializer(approval, context={"request": request}).data)


class ApprovalApproveView(_DecisionView):
    def decide(self, approval, request):
        services.approve(approval.pk, request.user, note=str(request.data.get("note") or ""), http_request=request)


class ApprovalRejectView(_DecisionView):
    def decide(self, approval, request):
        services.reject(approval.pk, request.user, note=str(request.data.get("note") or ""), http_request=request)


class ApprovalCancelView(_DecisionView):
    def decide(self, approval, request):
        services.cancel(approval.pk, request.user, http_request=request)
```
`backend/approvals/urls.py`:
```python
from django.urls import path

from . import views

urlpatterns = [
    path("", views.ApprovalListView.as_view(), name="approval-list"),
    path("counts/", views.ApprovalCountsView.as_view(), name="approval-counts"),
    path("<int:pk>/", views.ApprovalDetailView.as_view(), name="approval-detail"),
    path("<int:pk>/approve/", views.ApprovalApproveView.as_view(), name="approval-approve"),
    path("<int:pk>/reject/", views.ApprovalRejectView.as_view(), name="approval-reject"),
    path("<int:pk>/cancel/", views.ApprovalCancelView.as_view(), name="approval-cancel"),
]
```
In `backend/ashantihub/urls.py` add after the `api/calls/` line:
```python
    path("api/approvals/", include("approvals.urls")),
```

- [ ] **Step 5: Badge and escalation job**

In `backend/notifications/views.py` (`StaffBadgesView.get`), add `from approvals.services import waiting_for` to the local imports at the top of `get`, and add to the returned dict after `"tasks_overdue": …`:
```python
                "approvals_waiting": waiting_for(user).count(),
```
`backend/approvals/tasks.py`:
```python
from celery import shared_task

from . import services


@shared_task
def escalate_due_approvals():
    return services.escalate_due()
```
In `backend/ashantihub/settings.py` add to `CELERY_BEAT_SCHEDULE`:
```python
    "approvals-escalate": {
        "task": "approvals.tasks.escalate_due_approvals",
        "schedule": 300.0,  # every 5 minutes
    },
```

- [ ] **Step 6: Run the tests**

```bash
$BT run --rm web python manage.py test --noinput approvals notifications core.tests.test_background_jobs
```
Expected: OK.

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(staff): approvals inbox API, approvals-waiting badge and 5-minute escalation job"
```

---
### Task 7: The report engine

**Files:**
- Create: `backend/reports/__init__.py` (empty), `backend/reports/apps.py`, `backend/reports/models.py`, `backend/reports/providers.py`, `backend/reports/services.py`, `backend/reports/tasks.py`
- Create: `backend/reports/migrations/__init__.py` (empty), `backend/reports/migrations/0001_initial.py` (generated), `backend/reports/migrations/0002_trigram_extension.py`
- Create: `backend/accounts/migrations/0038_seed_reports_permission.py`
- Create: `backend/reports/tests/__init__.py` (empty), `backend/reports/tests/test_engine.py`
- Modify: `backend/ashantihub/settings.py` (`INSTALLED_APPS`, `CELERY_BEAT_SCHEDULE`)

**Interfaces:**
- Consumes: Task 5 (`ApprovalRequest`), 1A (`ActivityEvent`, `CallLog`, `Task`, `record`, `notify_staff`).
- Produces:
  - `reports.models.StaffReport` — periods `DAY/WEEK/MONTH`, statuses `DRAFT/SUBMITTED/ACKNOWLEDGED/RETURNED`; fields `staff, period, period_start, period_end, status, submitted_at, is_late, system_snapshot, achievements, blockers, plan_next (list[str]), plan_results (list[{item, result}]), linked_targets (list[{type, id, label}]), reviewer, reviewed_at, review_note, similarity, created_at, updated_at`; unique `(staff, period, period_start)`; `narrative_text() -> str`
  - `reports.providers`: `register_provider(role, fn)`, `unregister_provider(role, fn)`, `day_bounds(start, end)`, `generic_sections(staff, start, end)`, `system_sections(staff, start, end) -> [{"key", "title", "rows": [{"label", "value"}]}]` (keys `activity`, `approvals`, `calls`, `tasks`, then role sections)
  - `reports.services`: `VIEW_ALL`, `DEFAULT_DUE_TIME`, `REPORT_DUE_TIMES`, `SIMILARITY_FLAG`; errors `ReportError` (`.message`, `.status_code`), `NotEditable`, `FuturePeriod`, `NoteRequired` (400), `NotReviewable` (403); `period_bounds(period, day)`, `due_at(report)`, `build(staff, period, day)` (saved report or unsaved draft), `save_draft(staff, period, day, data)`, `submit(report, *, now=None, http_request=None)`, `acknowledge(report, reviewer, note="", http_request=None)`, `return_report(report, reviewer, note, http_request=None)`, `can_review(report, staff)`, `visible_reports(staff)`, `narrative_similarity(report)`, `send_day_reminders(now=None) -> int`
  - activity verbs `report.submitted`, `report.acknowledged`, `report.returned`; notification kinds `report_submitted` (link `team-reports`), `report_acknowledged`, `report_returned`, `report_reminder` (link `reports`)
  - permission `reports.view_all` (super_admin); Celery task `reports.tasks.send_day_report_reminders` at 18:00

- [ ] **Step 1: Write the failing tests**

`backend/reports/tests/test_engine.py`:
```python
from datetime import date, datetime, time, timedelta

from django.test import TestCase
from django.utils import timezone

from accounts.models import Role, StaffUser
from activity import services as activity
from calls.models import CallLog
from notifications.models import Notification
from reports import providers, services
from reports.models import StaffReport
from reports.tasks import send_day_report_reminders
from staff_tasks.models import Task
from staff_tasks.services import create_task

NARRATIVE = "Visited three weavers in Bonwire; one wants to register on Wednesday. Network was poor."
PLAN = ["Register Bonwire Kente Looms"]


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


def at(day, hour, minute=0):
    return timezone.make_aware(datetime.combine(day, time(hour, minute)))


class PeriodTests(TestCase):
    def test_periods_are_a_day_a_monday_to_sunday_week_and_a_calendar_month(self):
        wednesday = date(2026, 10, 7)
        self.assertEqual(services.period_bounds("day", wednesday), (wednesday, wednesday))
        self.assertEqual(services.period_bounds("week", wednesday), (date(2026, 10, 5), date(2026, 10, 11)))
        self.assertEqual(services.period_bounds("month", wednesday), (date(2026, 10, 1), date(2026, 10, 31)))


class WorkflowTests(TestCase):
    def setUp(self):
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.today = timezone.localdate()

    def draft(self, day=None, **data):
        return services.save_draft(
            self.scout, "day", day or self.today, {"achievements": NARRATIVE, "plan_next": PLAN, **data}
        )

    def test_a_new_day_report_carries_yesterdays_plan_to_mark(self):
        yesterday = self.today - timedelta(days=1)
        old = services.save_draft(self.scout, "day", yesterday, {"achievements": "x" * 50, "plan_next": ["Visit Ejisu", "Call Adwoa Fabrics"]})
        services.submit(old, now=at(yesterday, 18))
        report = services.build(self.scout, "day", self.today)
        self.assertIsNone(report.pk)
        self.assertEqual(report.plan_results, [{"item": "Visit Ejisu", "result": ""}, {"item": "Call Adwoa Fabrics", "result": ""}])

    def test_reports_for_days_that_have_not_started_are_refused(self):
        with self.assertRaises(services.FuturePeriod):
            self.draft(day=self.today + timedelta(days=1))

    def test_submitting_locks_the_report_and_freezes_the_system_numbers(self):
        activity.record(self.scout, "scout.checked_in")
        report = self.draft()
        services.submit(report, now=at(self.today, 18))
        report.refresh_from_db()
        self.assertEqual((report.status, report.is_late), ("submitted", False))
        self.assertEqual(report.system_snapshot[0]["rows"][0], {"label": "Actions recorded", "value": 1})
        with self.assertRaises(services.NotEditable):
            services.save_draft(self.scout, "day", self.today, {"achievements": "changed"})
        self.assertTrue(Notification.objects.filter(staff=self.lead, kind="report_submitted").exists())

    def test_after_the_due_time_it_is_late(self):
        report = self.draft()
        services.submit(report, now=at(self.today, 19, 30))
        self.assertTrue(report.is_late)

    def test_an_empty_report_cannot_be_submitted(self):
        report = services.save_draft(self.scout, "day", self.today, {})
        with self.assertRaises(services.ReportError):
            services.submit(report, now=at(self.today, 18))

    def test_the_manager_returns_it_and_then_acknowledges_the_resubmission(self):
        report = self.draft()
        services.submit(report, now=at(self.today, 18))
        with self.assertRaises(services.NoteRequired):
            services.return_report(report, self.lead, note="")
        services.return_report(report, self.lead, note="Which weavers?")
        report.refresh_from_db()
        self.assertEqual((report.status, report.reviewer, report.review_note), ("returned", self.lead, "Which weavers?"))
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="report_returned").exists())
        services.save_draft(self.scout, "day", self.today, {"achievements": NARRATIVE + " Akwasi and Yaa Weaving."})
        report.refresh_from_db()
        services.submit(report, now=at(self.today, 18, 30))
        services.acknowledge(report, self.lead)
        report.refresh_from_db()
        self.assertEqual(report.status, "acknowledged")
        self.assertIn("Akwasi", report.achievements)
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="report_acknowledged").exists())

    def test_only_the_manager_or_a_super_admin_reviews(self):
        other_lead = make_staff("operations", "kojo@example.com")
        boss = make_staff("super_admin", "boss@example.com")
        report = self.draft()
        services.submit(report, now=at(self.today, 18))
        with self.assertRaises(services.NotReviewable):
            services.acknowledge(report, other_lead)
        with self.assertRaises(services.NotReviewable):
            services.acknowledge(report, self.scout)
        services.acknowledge(report, boss)

    def test_a_copied_narrative_is_flagged(self):
        self.draft(day=self.today - timedelta(days=1))
        self.assertGreaterEqual(self.draft().similarity, services.SIMILARITY_FLAG)

    def test_fresh_or_very_short_narratives_are_not_flagged(self):
        self.draft(day=self.today - timedelta(days=1))
        fresh = services.save_draft(self.scout, "day", self.today, {
            "achievements": "Registered Kejetia Beads & Crafts after checking the owner's Ghana Card and pinning the stall."
        })
        self.assertLess(fresh.similarity, services.SIMILARITY_FLAG)
        short = services.save_draft(self.scout, "week", self.today, {"achievements": "Good week."})
        self.assertEqual(short.similarity, 0.0)


class ProviderTests(TestCase):
    def setUp(self):
        self.scout = make_staff("scout", "kwame@example.com")
        self.today = timezone.localdate()

    def call(self, when):
        return CallLog.objects.create(
            staff=self.scout, direction="out", counterpart_type="business_owner", purpose="other",
            outcome="connected", started_at=when,
        )

    def test_the_generic_provider_counts_this_staffers_work(self):
        other = make_staff("scout", "efua@example.com")
        activity.record(self.scout, "call-list")
        activity.record(self.scout, "call-list")
        activity.record(other, "call-list")
        self.call(timezone.now())
        done = create_task(self.scout, "Call back Adwoa", timezone.now() + timedelta(hours=1))
        Task.objects.filter(pk=done.pk).update(status=Task.DONE, done_at=timezone.now())
        create_task(self.scout, "Old follow-up", timezone.now() - timedelta(hours=2))
        sections = {
            s["key"]: {row["label"]: row["value"] for row in s["rows"]}
            for s in providers.system_sections(self.scout, self.today, self.today)
        }
        self.assertEqual(sections["activity"], {"Actions recorded": 2, "call-list": 2})
        self.assertEqual(sections["calls"], {"Calls logged": 1, "Connected": 1})
        self.assertEqual(sections["tasks"], {"Done": 1, "Overdue and still open": 1})
        self.assertEqual(sections["approvals"], {"Requests made": 0, "Approved by you": 0, "Returned by you": 0})

    def test_a_week_adds_up_its_days(self):
        monday = self.today - timedelta(days=self.today.weekday() + 7)
        self.call(at(monday, 9))
        self.call(at(monday + timedelta(days=2), 9))

        def calls(start, end):
            section = next(s for s in providers.system_sections(self.scout, start, end) if s["key"] == "calls")
            return section["rows"][0]["value"]

        self.assertEqual(calls(monday, monday), 1)
        self.assertEqual(calls(monday, monday + timedelta(days=6)), 2)

    def test_role_providers_add_their_own_sections(self):
        def scout_numbers(staff, start, end):
            return [{"key": "visits", "title": "Visits", "rows": [{"label": "Check-ins", "value": 0}]}]

        providers.register_provider("scout", scout_numbers)
        self.addCleanup(providers.unregister_provider, "scout", scout_numbers)
        keys = [s["key"] for s in providers.system_sections(self.scout, self.today, self.today)]
        self.assertEqual(keys, ["activity", "approvals", "calls", "tasks", "visits"])
        lead = make_staff("operations", "ama@example.com")
        self.assertNotIn("visits", [s["key"] for s in providers.system_sections(lead, self.today, self.today)])


class ReminderTests(TestCase):
    def test_reminders_go_to_active_staff_without_a_submitted_day_report(self):
        today = timezone.localdate()
        make_staff("operations", "ama@example.com")
        done = make_staff("scout", "kwame@example.com")
        make_staff("super_admin", "boss@example.com")
        make_staff("support", "esi@example.com", is_suspended=True)
        make_staff("scout", "new@example.com", invite_token="t" * 43)
        report = services.save_draft(done, "day", today, {"achievements": NARRATIVE})
        services.submit(report, now=at(today, 17))
        send_day_report_reminders()
        recipients = set(Notification.objects.filter(kind="report_reminder").values_list("staff__email", flat=True))
        self.assertEqual(recipients, {"ama@example.com"})
        self.assertEqual(Notification.objects.get(kind="report_reminder").title, "Your day report is due at 19:00")
```

- [ ] **Step 2: Create the app skeleton and register it**

Empty files: `backend/reports/__init__.py`, `backend/reports/migrations/__init__.py`, `backend/reports/tests/__init__.py`.
`backend/reports/apps.py`:
```python
from django.apps import AppConfig


class ReportsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "reports"
```
In `INSTALLED_APPS` add `"django.contrib.postgres",` after `"django.contrib.staticfiles",` and `"reports",` after `"approvals",`. Add to `CELERY_BEAT_SCHEDULE`:
```python
    "reports-day-reminders": {
        "task": "reports.tasks.send_day_report_reminders",
        "schedule": crontab(hour=18, minute=0),
    },
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `$BT run --rm web python manage.py test --noinput reports`
Expected: ERROR — `cannot import name 'providers' from 'reports'`.

- [ ] **Step 4: The model and migrations**

`backend/reports/models.py`:
```python
from django.db import models


class StaffReport(models.Model):
    """A staffer's day, week or month report (staff foundations F6). The
    system section is computed live while the report is a draft and frozen
    into system_snapshot on submit; the narrative is the person's own."""

    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    PERIOD_CHOICES = [(DAY, "Day"), (WEEK, "Week"), (MONTH, "Month")]
    DRAFT = "draft"
    SUBMITTED = "submitted"
    ACKNOWLEDGED = "acknowledged"
    RETURNED = "returned"
    STATUS_CHOICES = [
        (DRAFT, "Draft"),
        (SUBMITTED, "Submitted"),
        (ACKNOWLEDGED, "Acknowledged"),
        (RETURNED, "Returned"),
    ]

    staff = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="reports")
    period = models.CharField(max_length=5, choices=PERIOD_CHOICES)
    period_start = models.DateField()
    period_end = models.DateField()
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=DRAFT)
    submitted_at = models.DateTimeField(null=True, blank=True)
    is_late = models.BooleanField(default=False)
    system_snapshot = models.JSONField(null=True, blank=True)
    achievements = models.TextField(blank=True, default="")
    blockers = models.TextField(blank=True, default="")
    plan_next = models.JSONField(default=list, blank=True)
    plan_results = models.JSONField(default=list, blank=True)
    linked_targets = models.JSONField(default=list, blank=True)
    reviewer = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.PROTECT, null=True, blank=True, related_name="reports_reviewed"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True, default="")
    similarity = models.FloatField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-period_start", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["staff", "period", "period_start"], name="unique_staff_report_period")
        ]
        indexes = [models.Index(fields=["staff", "status"]), models.Index(fields=["period", "period_start"])]

    def narrative_text(self):
        parts = [self.achievements, self.blockers, *[str(item) for item in self.plan_next]]
        return "\n".join(part.strip() for part in parts if part and part.strip())

    def __str__(self):
        return f"{self.staff.full_name} · {self.get_period_display()} report · {self.period_start}"
```
Run: `$BT run --rm web python manage.py makemigrations reports`
Expected: `reports/migrations/0001_initial.py`.

`backend/reports/migrations/0002_trigram_extension.py`:
```python
from django.contrib.postgres.operations import TrigramExtension
from django.db import migrations


class Migration(migrations.Migration):
    # The copy check (reports.services.narrative_similarity) uses pg_trgm's
    # similarity(); pg_trgm is a trusted extension on Postgres 13+.
    dependencies = [("reports", "0001_initial")]
    operations = [TrigramExtension()]
```
`backend/accounts/migrations/0038_seed_reports_permission.py`:
```python
from django.db import migrations


def seed(apps, schema_editor):
    Permission = apps.get_model("accounts", "Permission")
    Role = apps.get_model("accounts", "Role")
    perm, _ = Permission.objects.get_or_create(
        codename="reports.view_all",
        defaults={"description": "Read, review and export every staff member's reports"},
    )
    Role.objects.get(name="super_admin").permissions.add(perm)


def unseed(apps, schema_editor):
    apps.get_model("accounts", "Permission").objects.filter(codename="reports.view_all").delete()


class Migration(migrations.Migration):
    dependencies = [("accounts", "0037_seed_approvals_permission")]
    operations = [migrations.RunPython(seed, unseed)]
```

- [ ] **Step 5: The system-section providers**

`backend/reports/providers.py`:
```python
"""System sections of staff reports (foundations F6). The generic provider
runs for every role; phases 2–7 add role providers with register_provider().
A provider is fn(staff, start, end) -> [{"key", "title", "rows": [{"label",
"value"}]}] over whole local days start..end, so a week or month section is
the sum of its days."""
from datetime import datetime, time, timedelta

from django.db.models import Count
from django.utils import timezone

TOP_VERBS = 12
_ROLE_PROVIDERS = {}


def register_provider(role, fn):
    _ROLE_PROVIDERS.setdefault(role, []).append(fn)


def unregister_provider(role, fn):
    if fn in _ROLE_PROVIDERS.get(role, []):
        _ROLE_PROVIDERS[role].remove(fn)


def day_bounds(start, end):
    zone = timezone.get_current_timezone()
    low = timezone.make_aware(datetime.combine(start, time.min), zone)
    high = timezone.make_aware(datetime.combine(end + timedelta(days=1), time.min), zone)
    return low, high


def generic_sections(staff, start, end):
    from activity.models import ActivityEvent
    from approvals.models import ApprovalRequest
    from calls.models import CallLog
    from staff_tasks.models import Task

    low, high = day_bounds(start, end)
    events = ActivityEvent.objects.filter(
        actor_type=ActivityEvent.STAFF, actor_id=staff.pk, occurred_at__gte=low, occurred_at__lt=high
    )
    by_verb = list(events.values("verb").annotate(n=Count("id")).order_by("-n", "verb")[:TOP_VERBS])
    decided = ApprovalRequest.objects.filter(decided_by=staff, decided_at__gte=low, decided_at__lt=high)
    calls = CallLog.objects.filter(staff=staff, started_at__gte=low, started_at__lt=high)
    overdue_by = min(high, timezone.now())
    return [
        {
            "key": "activity",
            "title": "Activity",
            "rows": [{"label": "Actions recorded", "value": events.count()}]
            + [{"label": row["verb"], "value": row["n"]} for row in by_verb],
        },
        {
            "key": "approvals",
            "title": "Approvals",
            "rows": [
                {"label": "Requests made", "value": ApprovalRequest.objects.filter(
                    maker=staff, created_at__gte=low, created_at__lt=high).count()},
                {"label": "Approved by you", "value": decided.filter(status=ApprovalRequest.APPROVED).count()},
                {"label": "Returned by you", "value": decided.filter(status=ApprovalRequest.REJECTED).count()},
            ],
        },
        {
            "key": "calls",
            "title": "Calls",
            "rows": [
                {"label": "Calls logged", "value": calls.count()},
                {"label": "Connected", "value": calls.filter(outcome="connected").count()},
            ],
        },
        {
            "key": "tasks",
            "title": "Tasks",
            "rows": [
                {"label": "Done", "value": Task.objects.filter(
                    owner=staff, status=Task.DONE, done_at__gte=low, done_at__lt=high).count()},
                {"label": "Overdue and still open", "value": Task.objects.filter(
                    owner=staff, status=Task.OPEN, due_at__lt=overdue_by).count()},
            ],
        },
    ]


def system_sections(staff, start, end):
    sections = generic_sections(staff, start, end)
    for fn in _ROLE_PROVIDERS.get(staff.role.name, []):
        sections.extend(fn(staff, start, end))
    return sections
```

- [ ] **Step 6: The workflow services**

`backend/reports/services.py`:
```python
"""Staff reports (foundations F6): a system section computed from the
database and a narrative written by the person. Draft → Submitted (locked;
late after the due time) → Acknowledged, or Returned with a note (editable
again, then resubmitted). The reviewer is the staffer's manager; a holder of
reports.view_all (Super Admin) may review anyone's."""
import calendar
from datetime import datetime, time, timedelta

from django.db import connection, transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import Role, StaffUser
from activity.services import record
from notifications.services import notify_staff

from . import providers
from .models import StaffReport

VIEW_ALL = "reports.view_all"
DEFAULT_DUE_TIME = time(19, 0)
# Per-role due times (role name → time); phases 2–7 set them for their roles.
REPORT_DUE_TIMES = {}
SIMILARITY_FLAG = 0.8
MIN_TEXT_FOR_SIMILARITY = 40
PLAN_RESULTS = ("", "done", "partly", "not_done")
MAX_LINES = 20


class ReportError(Exception):
    status_code = 400

    def __init__(self, message):
        super().__init__(message)
        self.message = message


class NotEditable(ReportError):
    pass


class FuturePeriod(ReportError):
    pass


class NoteRequired(ReportError):
    pass


class NotReviewable(ReportError):
    status_code = 403


def period_bounds(period, day):
    if period == StaffReport.DAY:
        return day, day
    if period == StaffReport.WEEK:
        start = day - timedelta(days=day.weekday())
        return start, start + timedelta(days=6)
    if period == StaffReport.MONTH:
        return day.replace(day=1), day.replace(day=calendar.monthrange(day.year, day.month)[1])
    raise ReportError("Use day, week or month.")


def due_time_for(staff):
    return REPORT_DUE_TIMES.get(staff.role.name, DEFAULT_DUE_TIME)


def due_at(report):
    return timezone.make_aware(datetime.combine(report.period_end, due_time_for(report.staff)))


def previous_plan_items(staff, period, start):
    previous = (
        StaffReport.objects.filter(staff=staff, period=period, period_start__lt=start)
        .exclude(status=StaffReport.DRAFT)
        .order_by("-period_start")
        .first()
    )
    return [str(item) for item in (previous.plan_next if previous else [])]


def build(staff, period, day):
    """The staffer's saved report for that period, or an unsaved draft whose
    plan_results list the previous report's plan, ready to mark."""
    start, end = period_bounds(period, day)
    existing = (
        StaffReport.objects.select_related("staff__role", "reviewer__role")
        .filter(staff=staff, period=period, period_start=start)
        .first()
    )
    if existing is not None:
        return existing
    return StaffReport(
        staff=staff, period=period, period_start=start, period_end=end,
        plan_results=[{"item": item, "result": ""} for item in previous_plan_items(staff, period, start)],
    )


def _clean_items(value):
    if not isinstance(value, list):
        raise ReportError("Write the plan as a list of lines.")
    items = [str(item).strip()[:300] for item in value if str(item).strip()]
    if len(items) > MAX_LINES:
        raise ReportError(f"Keep the plan to {MAX_LINES} lines.")
    return items


def _clean_results(value):
    if not isinstance(value, list):
        raise ReportError("Mark the previous plan as a list.")
    cleaned = []
    for row in value[:MAX_LINES]:
        if not isinstance(row, dict) or row.get("result", "") not in PLAN_RESULTS:
            raise ReportError("Mark each plan item done, partly or not done.")
        cleaned.append({"item": str(row.get("item", ""))[:300], "result": row.get("result", "")})
    return cleaned


def _clean_targets(value):
    if not isinstance(value, list) or len(value) > MAX_LINES:
        raise ReportError(f"Link at most {MAX_LINES} records.")
    cleaned = []
    for row in value:
        if not isinstance(row, dict) or not row.get("type") or not row.get("id"):
            raise ReportError("Each link needs a type and an id.")
        cleaned.append({"type": str(row["type"])[:50], "id": str(row["id"])[:64], "label": str(row.get("label", ""))[:200]})
    return cleaned


def narrative_similarity(report):
    """Highest pg_trgm similarity (0–1) between this narrative and the
    staffer's last five other reports; very short text scores 0."""
    text = report.narrative_text()
    if len(text) < MIN_TEXT_FOR_SIMILARITY:
        return 0.0
    earlier = StaffReport.objects.filter(staff=report.staff).exclude(pk=report.pk).order_by("-period_start", "-id")[:5]
    texts = [t for t in (r.narrative_text() for r in earlier) if t]
    if not texts:
        return 0.0
    with connection.cursor() as cursor:
        cursor.execute("SELECT COALESCE(MAX(similarity(%s, t)), 0) FROM unnest(%s::text[]) AS t", [text, texts])
        return round(float(cursor.fetchone()[0]), 3)


def save_draft(staff, period, day, data):
    if day > timezone.localdate():
        raise FuturePeriod("You can't write a report for a day that hasn't started.")
    report = build(staff, period, day)
    if report.pk and report.status not in (StaffReport.DRAFT, StaffReport.RETURNED):
        raise NotEditable("A submitted report is locked.")
    for field in ("achievements", "blockers"):
        if field in data:
            setattr(report, field, str(data[field] or "")[:5000])
    if "plan_next" in data:
        report.plan_next = _clean_items(data["plan_next"])
    if "plan_results" in data:
        report.plan_results = _clean_results(data["plan_results"])
    if "linked_targets" in data:
        report.linked_targets = _clean_targets(data["linked_targets"])
    report.similarity = narrative_similarity(report)
    report.save()
    return report


def submit(report, *, now=None, http_request=None):
    now = now or timezone.now()
    if report.status not in (StaffReport.DRAFT, StaffReport.RETURNED):
        raise NotEditable("This report has already been submitted.")
    if report.period_start > timezone.localdate(now):
        raise FuturePeriod("You can't submit a report for a period that hasn't started.")
    if not report.narrative_text():
        raise ReportError("Write at least one line before you submit.")
    with transaction.atomic():
        report.system_snapshot = providers.system_sections(report.staff, report.period_start, report.period_end)
        report.submitted_at = now
        report.is_late = now > due_at(report)
        report.status = StaffReport.SUBMITTED
        report.save(update_fields=["system_snapshot", "submitted_at", "is_late", "status", "updated_at"])
        manager = report.staff.manager
        if manager is not None and manager.is_active:
            notify_staff(
                manager, "report_submitted",
                f"{report.staff.full_name} sent a {report.get_period_display().lower()} report",
                body="Submitted after the deadline." if report.is_late else "",
                link="team-reports", icon="📝",
            )
        record(report.staff, "report.submitted", target=report, after={
            "period": report.period, "period_start": str(report.period_start),
            "is_late": report.is_late, "similarity": report.similarity,
        }, request=http_request)
    return report


def can_review(report, staff):
    if staff.pk == report.staff_id:
        return False
    return report.staff.manager_id == staff.pk or VIEW_ALL in staff.effective_permission_codenames()


def _check_reviewable(report, staff):
    if report.status != StaffReport.SUBMITTED:
        raise ReportError("Only a submitted report can be reviewed.")
    if not can_review(report, staff):
        raise NotReviewable("Only their manager or a Super Admin can review this report.")


def acknowledge(report, reviewer, note="", http_request=None):
    _check_reviewable(report, reviewer)
    with transaction.atomic():
        report.status = StaffReport.ACKNOWLEDGED
        report.reviewer = reviewer
        report.reviewed_at = timezone.now()
        report.review_note = (note or "").strip()
        report.save(update_fields=["status", "reviewer", "reviewed_at", "review_note", "updated_at"])
        notify_staff(report.staff, "report_acknowledged", f"{reviewer.full_name} read your report",
                     body=report.review_note, link="reports", icon="✅")
        record(reviewer, "report.acknowledged", target=report, after={"note": report.review_note}, request=http_request)
    return report


def return_report(report, reviewer, note, http_request=None):
    note = (note or "").strip()
    _check_reviewable(report, reviewer)
    if not note:
        raise NoteRequired("Write what needs changing before you return it.")
    with transaction.atomic():
        report.status = StaffReport.RETURNED
        report.reviewer = reviewer
        report.reviewed_at = timezone.now()
        report.review_note = note
        report.save(update_fields=["status", "reviewer", "reviewed_at", "review_note", "updated_at"])
        notify_staff(report.staff, "report_returned", "Your report came back with a note",
                     body=note, link="reports", icon="↩️")
        record(reviewer, "report.returned", target=report, after={"note": note}, request=http_request)
    return report


def visible_reports(staff):
    """Own reports (drafts too); direct reports' once submitted; everyone's
    submitted reports for reports.view_all."""
    scope = Q(staff=staff) | (Q(staff__manager=staff) & ~Q(status=StaffReport.DRAFT))
    if VIEW_ALL in staff.effective_permission_codenames():
        scope |= ~Q(status=StaffReport.DRAFT)
    return StaffReport.objects.filter(scope)


def send_day_reminders(now=None):
    """18:00: everyone active, activated and not a Super Admin who hasn't
    submitted today's day report gets a reminder."""
    today = timezone.localdate(now or timezone.now())
    done = StaffReport.objects.filter(
        period=StaffReport.DAY, period_start=today,
        status__in=[StaffReport.SUBMITTED, StaffReport.ACKNOWLEDGED],
    ).values("staff_id")
    recipients = (
        StaffUser.objects.select_related("role")
        .filter(is_active=True, is_suspended=False, invite_token__isnull=True)
        .exclude(role__name=Role.SUPER_ADMIN)
        .exclude(pk__in=done)
    )
    sent = 0
    for staff in recipients:
        notify_staff(
            staff, "report_reminder", f"Your day report is due at {due_time_for(staff):%H:%M}",
            body="Write what you did today, what got in the way and your plan for tomorrow.",
            link="reports", icon="📝",
        )
        sent += 1
    return sent
```
`backend/reports/tasks.py`:
```python
from celery import shared_task

from . import services


@shared_task
def send_day_report_reminders():
    return services.send_day_reminders()
```

- [ ] **Step 7: Run the tests**

```bash
$BT run --rm web python manage.py test --noinput reports accounts.tests.test_roles_seed core.tests.test_background_jobs
```
Expected: OK.

- [ ] **Step 8: Commit**

```bash
git add backend
git commit -m "feat(staff): report engine — system sections, draft/submit/review workflow, copy check, reminders"
```

---

### Task 8: Reports API

**Files:**
- Create: `backend/reports/serializers.py`, `backend/reports/views.py`, `backend/reports/urls.py`
- Modify: `backend/ashantihub/urls.py`
- Test: `backend/reports/tests/test_api.py`

**Interfaces:**
- Consumes: Task 7 (`services`, `providers`, `StaffReport`), Task 3 (`staff_token`).
- Produces:
  - report payload: `{id, staff: {id, full_name, role}, period, period_start, period_end, status, submitted_at, is_late, due_at, achievements, blockers, plan_next, plan_results, linked_targets, reviewer, reviewed_at, review_note, similarity, similar_warning, can_edit, can_review, system_is_live, system?}` — `system` (list of sections) is present on single reports, absent in lists
  - `GET /api/reports/?period=` → DRF page (20) of my reports; `POST /api/reports/` `{period, date, achievements?, blockers?, plan_next?, plan_results?, linked_targets?}` → saves my draft for that period (payload)
  - `GET /api/reports/current/?period=day|week|month&date=YYYY-MM-DD` → my report for that period, saved or not (`id: null` when unsaved)
  - `GET /api/reports/<id>/`; `PATCH /api/reports/<id>/` (owner, editable only)
  - `POST /api/reports/<id>/submit/` (owner), `/acknowledge/` `{note?}`, `/return/` `{note}` (manager or `reports.view_all`)
  - `GET /api/reports/team/?period=&date=&scope=all` → `{period, period_start, rows: [{staff, report: payload-without-system | null}]}`; drafts show as `null`; `scope=all` needs `reports.view_all`
  - views helpers reused by Task 9: `reports.views._date(value, name="date", *, required=False)`, `reports.serializers.person(staff)`, `report_payload(report, viewer, *, include_system=True)`

- [ ] **Step 1: Write the failing tests**

`backend/reports/tests/test_api.py`:
```python
from datetime import datetime, time, timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, StaffUser
from accounts.testing import staff_token
from reports import services

NARRATIVE = "Visited three weavers in Bonwire; one wants to register on Wednesday. Network was poor."


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


class ReportApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.other_scout = make_staff("scout", "efua@example.com", manager=self.lead)
        self.today = timezone.localdate()

    def as_(self, staff):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff)}")

    def save(self, **body):
        return self.client.post("/api/reports/", {
            "period": "day", "date": str(self.today), "achievements": NARRATIVE,
            "plan_next": ["Register Bonwire Kente Looms"], **body,
        }, format="json")

    def submit_mine(self):
        report = self.save().json()
        self.client.post(f"/api/reports/{report['id']}/submit/", {}, format="json")
        return report

    def test_compose_save_and_submit_my_day_report(self):
        self.as_(self.scout)
        current = self.client.get("/api/reports/current/?period=day").json()
        self.assertEqual((current["id"], current["status"], current["system_is_live"]), (None, "draft", True))
        self.assertEqual([s["key"] for s in current["system"]], ["activity", "approvals", "calls", "tasks"])
        saved = self.save(blockers="Network").json()
        self.assertTrue(saved["can_edit"])
        patched = self.client.patch(f"/api/reports/{saved['id']}/", {"blockers": "Network was poor in Bonwire"}, format="json")
        self.assertEqual(patched.json()["blockers"], "Network was poor in Bonwire")
        submitted = self.client.post(f"/api/reports/{saved['id']}/submit/", {}, format="json").json()
        self.assertEqual((submitted["status"], submitted["can_edit"], submitted["system_is_live"]), ("submitted", False, False))
        self.assertEqual(self.client.patch(f"/api/reports/{saved['id']}/", {"blockers": "x"}, format="json").status_code, 400)
        history = self.client.get("/api/reports/?period=day").json()["results"]
        self.assertEqual(history[0]["id"], saved["id"])
        self.assertNotIn("system", history[0])

    def test_the_manager_sees_the_team_and_reviews(self):
        self.as_(self.scout)
        report = self.submit_mine()
        self.as_(self.lead)
        rows = {row["staff"]["id"]: row for row in self.client.get("/api/reports/team/?period=day").json()["rows"]}
        self.assertEqual(rows[self.scout.id]["report"]["status"], "submitted")
        self.assertTrue(rows[self.scout.id]["report"]["can_review"])
        self.assertIsNone(rows[self.other_scout.id]["report"])
        self.assertEqual(self.client.post(f"/api/reports/{report['id']}/return/", {}, format="json").status_code, 400)
        returned = self.client.post(f"/api/reports/{report['id']}/return/", {"note": "Which weavers?"}, format="json")
        self.assertEqual(returned.json()["status"], "returned")
        self.as_(self.scout)
        self.assertTrue(self.client.get(f"/api/reports/{report['id']}/").json()["can_edit"])
        self.client.post(f"/api/reports/{report['id']}/submit/", {}, format="json")
        self.as_(self.lead)
        acknowledged = self.client.post(f"/api/reports/{report['id']}/acknowledge/", {"note": "Thanks"}, format="json")
        self.assertEqual(acknowledged.json()["status"], "acknowledged")

    def test_drafts_stay_private_until_submitted(self):
        self.as_(self.scout)
        draft = self.save().json()
        self.as_(self.lead)
        self.assertEqual(self.client.get(f"/api/reports/{draft['id']}/").status_code, 404)
        rows = {row["staff"]["id"]: row for row in self.client.get("/api/reports/team/?period=day").json()["rows"]}
        self.assertIsNone(rows[self.scout.id]["report"])

    def test_a_scout_cannot_see_a_teammates_report(self):
        self.as_(self.other_scout)
        report = self.submit_mine()
        self.as_(self.scout)
        self.assertEqual(self.client.get(f"/api/reports/{report['id']}/").status_code, 404)
        self.assertEqual(self.client.post(f"/api/reports/{report['id']}/acknowledge/", {}, format="json").status_code, 404)

    def test_everyone_view_is_for_a_super_admin_only(self):
        self.as_(self.lead)
        self.assertEqual(self.client.get("/api/reports/team/?period=day&scope=all").status_code, 403)
        self.as_(self.boss)
        rows = self.client.get("/api/reports/team/?period=day&scope=all").json()["rows"]
        self.assertEqual({row["staff"]["full_name"] for row in rows}, {"Ama", "Kwame", "Efua"})

    def test_bad_input_is_explained(self):
        self.as_(self.scout)
        self.assertEqual(self.client.get("/api/reports/current/?period=year").status_code, 400)
        self.assertEqual(self.client.get("/api/reports/current/?period=day&date=07-10-2026").status_code, 400)
        tomorrow = self.today + timedelta(days=1)
        self.assertEqual(self.save(date=str(tomorrow)).status_code, 400)
        self.assertEqual(self.save(plan_next="not a list").status_code, 400)

    def test_the_copy_check_reaches_the_writer(self):
        yesterday = self.today - timedelta(days=1)
        earlier = services.save_draft(self.scout, "day", yesterday, {"achievements": NARRATIVE, "plan_next": ["Register Bonwire Kente Looms"]})
        services.submit(earlier, now=timezone.make_aware(datetime.combine(yesterday, time(18))))
        self.as_(self.scout)
        self.assertTrue(self.save().json()["similar_warning"])
```

- [ ] **Step 2: Run them to verify they fail**

Run: `$BT run --rm web python manage.py test --noinput reports.tests.test_api`
Expected: FAIL — 404 for `/api/reports/…`.

- [ ] **Step 3: The payload**

`backend/reports/serializers.py`:
```python
from . import providers, services
from .models import StaffReport


def person(staff):
    if staff is None:
        return None
    return {"id": staff.pk, "full_name": staff.full_name, "role": staff.role.name}


def report_payload(report, viewer, *, include_system=True):
    """One report as the API shows it to `viewer`. A draft or returned report
    shows live system numbers; a submitted one shows the frozen snapshot."""
    live = report.status in (StaffReport.DRAFT, StaffReport.RETURNED) or report.system_snapshot is None
    data = {
        "id": report.pk,
        "staff": person(report.staff),
        "period": report.period,
        "period_start": report.period_start,
        "period_end": report.period_end,
        "status": report.status,
        "submitted_at": report.submitted_at,
        "is_late": report.is_late,
        "due_at": services.due_at(report),
        "achievements": report.achievements,
        "blockers": report.blockers,
        "plan_next": report.plan_next,
        "plan_results": report.plan_results,
        "linked_targets": report.linked_targets,
        "reviewer": person(report.reviewer),
        "reviewed_at": report.reviewed_at,
        "review_note": report.review_note,
        "similarity": report.similarity,
        "similar_warning": report.similarity >= services.SIMILARITY_FLAG,
        "can_edit": viewer.pk == report.staff_id and report.status in (StaffReport.DRAFT, StaffReport.RETURNED),
        "can_review": report.status == StaffReport.SUBMITTED and services.can_review(report, viewer),
        "system_is_live": live,
    }
    if include_system:
        data["system"] = (
            providers.system_sections(report.staff, report.period_start, report.period_end)
            if live else report.system_snapshot
        )
    return data
```

- [ ] **Step 4: Views and URLs**

`backend/reports/views.py`:
```python
from datetime import date

from django.utils import timezone
from rest_framework import generics
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import StaffUser
from accounts.permissions import IsStaff

from . import services
from .models import StaffReport
from .serializers import person, report_payload


def _period(value):
    period = value or StaffReport.DAY
    if period not in dict(StaffReport.PERIOD_CHOICES):
        raise ValidationError({"period": "Use day, week or month."})
    return period


def _date(value, name="date", *, required=False):
    if not value:
        if required:
            raise ValidationError({name: "Pick a date."})
        return timezone.localdate()
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValidationError({name: "Use YYYY-MM-DD."}) from None


def _error(exc):
    return Response({"detail": exc.message}, status=exc.status_code)


class ReportPagination(PageNumberPagination):
    page_size = 20


class MyReportsView(APIView):
    """GET: my reports, newest first. POST: save my draft for a period."""

    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        reports = StaffReport.objects.filter(staff=request.user).select_related("staff__role", "reviewer__role")
        if request.query_params.get("period"):
            reports = reports.filter(period=_period(request.query_params["period"]))
        paginator = ReportPagination()
        page = paginator.paginate_queryset(reports.order_by("-period_start", "-id"), request, view=self)
        return paginator.get_paginated_response(
            [report_payload(report, request.user, include_system=False) for report in page]
        )

    def post(self, request):
        period = _period(request.data.get("period"))
        day = _date(request.data.get("date"))
        try:
            report = services.save_draft(request.user, period, day, request.data)
        except services.ReportError as exc:
            return _error(exc)
        return Response(report_payload(report, request.user))


class CurrentReportView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        period = _period(request.query_params.get("period"))
        day = _date(request.query_params.get("date"))
        if day > timezone.localdate():
            raise ValidationError({"date": "That day hasn't started yet."})
        return Response(report_payload(services.build(request.user, period, day), request.user))


class ReportDetailView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request, pk):
        report = generics.get_object_or_404(
            services.visible_reports(request.user).select_related("staff__role", "reviewer__role"), pk=pk
        )
        return Response(report_payload(report, request.user))

    def patch(self, request, pk):
        report = generics.get_object_or_404(StaffReport, pk=pk, staff=request.user)
        try:
            report = services.save_draft(request.user, report.period, report.period_start, request.data)
        except services.ReportError as exc:
            return _error(exc)
        return Response(report_payload(report, request.user))


class ReportSubmitView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def post(self, request, pk):
        report = generics.get_object_or_404(StaffReport.objects.select_related("staff__role"), pk=pk, staff=request.user)
        try:
            services.submit(report, http_request=request)
        except services.ReportError as exc:
            return _error(exc)
        return Response(report_payload(report, request.user))


class _ReviewView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def review(self, report, request):
        raise NotImplementedError

    def post(self, request, pk):
        report = generics.get_object_or_404(
            services.visible_reports(request.user).select_related("staff__role"), pk=pk
        )
        try:
            self.review(report, request)
        except services.ReportError as exc:
            return _error(exc)
        return Response(report_payload(report, request.user))


class ReportAcknowledgeView(_ReviewView):
    def review(self, report, request):
        services.acknowledge(report, request.user, note=str(request.data.get("note") or ""), http_request=request)


class ReportReturnView(_ReviewView):
    def review(self, report, request):
        services.return_report(report, request.user, note=str(request.data.get("note") or ""), http_request=request)


class TeamReportsView(APIView):
    """My direct reports' reports for one period (managers); everyone's with
    ?scope=all (reports.view_all). A draft shows as null — not submitted yet."""

    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        params = request.query_params
        period = _period(params.get("period"))
        start, _ = services.period_bounds(period, _date(params.get("date")))
        if params.get("scope") == "all":
            if services.VIEW_ALL not in request.user.effective_permission_codenames():
                raise PermissionDenied("Only a Super Admin can see everyone's reports.")
            people = StaffUser.objects.filter(is_active=True).exclude(pk=request.user.pk)
        else:
            people = StaffUser.objects.filter(manager=request.user, is_active=True)
        people = list(people.select_related("role").order_by("full_name"))
        reports = {
            report.staff_id: report
            for report in StaffReport.objects.select_related("staff__role", "reviewer__role")
            .filter(period=period, period_start=start, staff__in=people)
            .exclude(status=StaffReport.DRAFT)
        }
        return Response({
            "period": period,
            "period_start": start,
            "rows": [
                {
                    "staff": person(member),
                    "report": report_payload(reports[member.pk], request.user, include_system=False)
                    if member.pk in reports else None,
                }
                for member in people
            ],
        })
```
`backend/reports/urls.py`:
```python
from django.urls import path

from . import views

urlpatterns = [
    path("", views.MyReportsView.as_view(), name="report-drafts"),
    path("current/", views.CurrentReportView.as_view(), name="report-current"),
    path("team/", views.TeamReportsView.as_view(), name="report-team"),
    path("<int:pk>/", views.ReportDetailView.as_view(), name="report-detail"),
    path("<int:pk>/submit/", views.ReportSubmitView.as_view(), name="report-submit"),
    path("<int:pk>/acknowledge/", views.ReportAcknowledgeView.as_view(), name="report-acknowledge"),
    path("<int:pk>/return/", views.ReportReturnView.as_view(), name="report-return"),
]
```
In `backend/ashantihub/urls.py`, after the `api/approvals/` line:
```python
    path("api/reports/", include("reports.urls")),
```

- [ ] **Step 5: Run the tests**

Run: `$BT run --rm web python manage.py test --noinput reports`
Expected: OK.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(staff): reports API — compose, submit, team view, acknowledge and return"
```

---
### Task 9: Report exports — CSV, Excel, PDF, background jobs and signed links

**Files:**
- Modify: `backend/requirements.txt` (`XlsxWriter`, `weasyprint`)
- Modify: `backend/Dockerfile`, `backend/Dockerfile.prod` (Pango and fonts for WeasyPrint)
- Modify: `backend/reports/models.py` (add `ReportExport`)
- Create: `backend/reports/migrations/0003_reportexport.py` (generated)
- Create: `backend/reports/exports.py`, `backend/reports/templates/reports/report_export.html`
- Modify: `backend/reports/tasks.py`, `backend/reports/views.py`, `backend/reports/urls.py`
- Modify: `backend/ashantihub/settings.py` (`CELERY_BEAT_SCHEDULE`)
- Test: `backend/reports/tests/test_exports.py`

**Interfaces:**
- Consumes: Task 8 (`_date`, `visible_reports`), Task 2 (`sessions.require_sudo`), Task 1 (`PRIVATE_MEDIA_ROOT`, Celery).
- Produces:
  - `reports.models.ReportExport(requester, filters, format, status QUEUED/RUNNING/READY/FAILED/EXPIRED, file_name, row_count, error, created_at, finished_at, expires_at)`
  - `reports.exports`: `FORMATS`, `BACKGROUND_DAYS = 31`, `BACKGROUND_ROWS = 5000`, `LINK_MAX_AGE`, `ExportNegotiation`, `escape_cell(value) -> str`, `report_row(report) -> dict`, `csv_chunks(reports)`, `write_xlsx(reports, target)`, `pdf_bytes(reports, title) -> bytes`, `export_queryset(requester, filters)`, `may_export_staff(requester, staff_id) -> bool`, `export_response(reports, fmt, stem, title)`, `write_export_file(reports, fmt, path, title)`, `range_title(filters)`, `export_dir()`, `export_path(export)`, `download_url(export)`, `signature_matches(export, signature)`, `export_payload(export)`
  - `GET /api/reports/<id>/export/?format=csv|xlsx|pdf` → the file (sudo when it isn't the requester's own report)
  - `GET /api/reports/export/?from=&to=&format=&staff=&role=&period=` → the file, or `202 {"id", "status": "queued"}` when over 31 days or 5,000 rows (sudo when any report isn't the requester's own; 403 for a `staff` outside scope)
  - `GET /api/reports/exports/` → my last 20 exports `[{id, format, status, row_count, error, created_at, finished_at, expires_at, file_name, download_url | null}]`
  - `GET /api/reports/exports/<id>/download/?sig=` → the file (requester only; 403 for a bad or expired signature; 410 once gone)
  - Celery tasks `reports.tasks.build_report_export(export_id)` and `reports.tasks.purge_expired_exports` (daily 04:00); notification kinds `report_export_ready`, `report_export_failed`; every export records `report.exported`

- [ ] **Step 1: Write the failing tests**

`backend/reports/tests/test_exports.py`:
```python
import csv
import io
import tempfile
import zipfile
from datetime import datetime, time, timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Role, StaffUser
from accounts.testing import staff_token
from activity.models import ActivityEvent
from notifications.models import Notification
from reports import exports, services
from reports.models import ReportExport
from reports.tasks import build_report_export, purge_expired_exports

NASTY = '=HYPERLINK("http://evil.example","click")'


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


class ExportTests(TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        private = override_settings(PRIVATE_MEDIA_ROOT=directory.name)
        private.enable()
        self.addCleanup(private.disable)
        self.client = APIClient()
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.other_scout = make_staff("scout", "efua@example.com", manager=self.lead)
        self.today = timezone.localdate()
        self.report = self.submitted(self.scout, achievements=NASTY)

    def submitted(self, staff, **data):
        report = services.save_draft(staff, "day", self.today, {"achievements": "Visited Bonwire", **data})
        return services.submit(report, now=timezone.make_aware(datetime.combine(self.today, time(18))))

    def as_(self, staff, sudo=False):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(staff, sudo=sudo)}")

    def long_range(self, fmt="csv"):
        start = self.today - timedelta(days=40)
        return self.client.get(f"/api/reports/export/?from={start}&to={self.today}&format={fmt}")

    def test_escape_cell(self):
        for raw in ("=1+1", "+233", "-5", "@SUM(A1)", "\tx", "\rx"):
            self.assertEqual(exports.escape_cell(raw), "'" + raw)
        self.assertEqual(exports.escape_cell("Kumasi"), "Kumasi")
        self.assertEqual(exports.escape_cell(None), "")

    def test_csv_has_a_bom_and_neutralises_formulas(self):
        self.as_(self.scout)
        response = self.client.get(f"/api/reports/{self.report.id}/export/?format=csv")
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment;", response["Content-Disposition"])
        body = b"".join(response.streaming_content).decode("utf-8")
        self.assertTrue(body.startswith("﻿"))
        rows = list(csv.reader(io.StringIO(body.lstrip("﻿"))))
        self.assertEqual(rows[1][rows[0].index("Achievements")], "'" + NASTY)

    def test_excel_and_pdf_open(self):
        self.as_(self.scout)
        xlsx = self.client.get(f"/api/reports/{self.report.id}/export/?format=xlsx")
        with zipfile.ZipFile(io.BytesIO(xlsx.content)) as book:
            sheet = book.read("xl/worksheets/sheet1.xml").decode()
        self.assertIn("HYPERLINK", sheet)
        self.assertNotIn("<f>", sheet)
        pdf = self.client.get(f"/api/reports/{self.report.id}/export/?format=pdf")
        self.assertEqual(pdf["Content-Type"], "application/pdf")
        self.assertTrue(pdf.content.startswith(b"%PDF"))

    def test_an_unknown_format_is_refused(self):
        self.as_(self.scout)
        self.assertEqual(self.client.get(f"/api/reports/{self.report.id}/export/?format=docx").status_code, 400)

    def test_a_scout_cannot_export_a_teammates_report(self):
        theirs = self.submitted(self.other_scout)
        self.as_(self.scout, sudo=True)
        self.assertEqual(self.client.get(f"/api/reports/{theirs.id}/export/?format=csv").status_code, 404)
        response = self.client.get(
            f"/api/reports/export/?from={self.today}&to={self.today}&format=csv&staff={self.other_scout.id}"
        )
        self.assertEqual(response.status_code, 403)

    def test_exporting_someone_elses_report_needs_a_recent_password(self):
        self.as_(self.lead)
        self.assertEqual(self.client.get(f"/api/reports/{self.report.id}/export/?format=csv").json()["code"], "sudo_required")
        self.as_(self.lead, sudo=True)
        self.assertEqual(self.client.get(f"/api/reports/{self.report.id}/export/?format=csv").status_code, 200)

    def test_every_export_is_recorded_with_its_filters(self):
        self.as_(self.scout)
        self.client.get(f"/api/reports/export/?from={self.today}&to={self.today}&format=csv")
        event = ActivityEvent.objects.filter(verb="report.exported").latest("id")
        self.assertEqual(event.after["filters"], {"from": str(self.today), "to": str(self.today)})
        self.assertEqual((event.after["format"], event.after["rows"]), ("csv", 1))

    def test_a_long_range_is_built_in_the_background_and_downloaded_once_ready(self):
        self.as_(self.scout)
        with self.captureOnCommitCallbacks(execute=True):
            queued = self.long_range()
        self.assertEqual(queued.status_code, 202)
        export = ReportExport.objects.get(pk=queued.json()["id"])
        self.assertEqual((export.status, export.row_count), ("ready", 1))
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="report_export_ready").exists())
        listed = self.client.get("/api/reports/exports/").json()[0]
        download = self.client.get(listed["download_url"])
        self.assertEqual(download.status_code, 200)
        self.assertTrue(b"".join(download.streaming_content).startswith("﻿".encode()))
        self.assertEqual(self.client.get(f"/api/reports/exports/{export.id}/download/?sig=forged").status_code, 403)
        with mock.patch("reports.exports.LINK_MAX_AGE", -1):
            self.assertEqual(self.client.get(listed["download_url"]).status_code, 403)
        self.as_(self.lead, sudo=True)
        self.assertEqual(self.client.get(listed["download_url"]).status_code, 404)

    def test_a_failed_job_serves_nothing_and_says_why(self):
        self.as_(self.scout)
        with mock.patch("reports.exports.write_export_file", side_effect=RuntimeError("disk full")):
            with self.captureOnCommitCallbacks(execute=True):
                queued = self.long_range("pdf")
        export = ReportExport.objects.get(pk=queued.json()["id"])
        self.assertEqual((export.status, export.error), ("failed", "disk full"))
        self.assertTrue(Notification.objects.filter(staff=self.scout, kind="report_export_failed").exists())
        self.assertEqual(list(exports.export_dir().glob("*")), [])
        self.assertIsNone(self.client.get("/api/reports/exports/").json()[0]["download_url"])

    def test_scope_is_checked_again_when_the_job_runs(self):
        self.submitted(self.lead)
        self.as_(self.lead, sudo=True)
        queued = self.long_range()  # the job isn't run: no captureOnCommitCallbacks
        StaffUser.objects.filter(manager=self.lead).update(manager=None)
        build_report_export(queued.json()["id"])
        self.assertEqual(ReportExport.objects.get(pk=queued.json()["id"]).row_count, 1)

    def test_expired_files_are_purged(self):
        self.as_(self.scout)
        with self.captureOnCommitCallbacks(execute=True):
            queued = self.long_range()
        export = ReportExport.objects.get(pk=queued.json()["id"])
        ReportExport.objects.filter(pk=export.pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(purge_expired_exports(), 1)
        export.refresh_from_db()
        self.assertEqual(export.status, "expired")
        self.assertFalse(exports.export_path(export).exists())
```

- [ ] **Step 2: Dependencies and system libraries**

```bash
$BT run --rm --no-deps web pip index versions XlsxWriter   # newest 3.x
$BT run --rm --no-deps web pip index versions weasyprint   # newest
```
Append to `backend/requirements.txt` with the versions found:
```
# Report exports (F6): Excel and PDF. WeasyPrint needs Pango (see Dockerfiles).
XlsxWriter==X
weasyprint==X
```
In **both** `backend/Dockerfile` and `backend/Dockerfile.prod`, extend the `apt-get install` package list with WeasyPrint's libraries and a font, so the dev image (tests) and the production image match:
```
libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 fonts-dejavu-core
```
(In `Dockerfile.prod` also add a comment line above the `RUN`: `# Pango/HarfBuzz + DejaVu fonts render report PDFs (WeasyPrint, reports/exports.py).`)
```bash
$BT build web
$BT run --rm web python manage.py test --noinput reports.tests.test_exports
```
Expected: ERROR — `cannot import name 'exports' from 'reports'`.

- [ ] **Step 3: The export model**

Append to `backend/reports/models.py`:
```python
class ReportExport(models.Model):
    """A background report export (staff foundations F6): built by a Celery
    job into PRIVATE_MEDIA_ROOT and downloadable by its requester through a
    signed link for 24 hours. A failed job leaves no file behind."""

    QUEUED = "queued"
    RUNNING = "running"
    READY = "ready"
    FAILED = "failed"
    EXPIRED = "expired"
    STATUS_CHOICES = [
        (QUEUED, "Queued"),
        (RUNNING, "Being prepared"),
        (READY, "Ready"),
        (FAILED, "Failed"),
        (EXPIRED, "Expired"),
    ]

    requester = models.ForeignKey("accounts.StaffUser", on_delete=models.CASCADE, related_name="report_exports")
    filters = models.JSONField(default=dict)
    format = models.CharField(max_length=4)
    status = models.CharField(max_length=8, choices=STATUS_CHOICES, default=QUEUED)
    file_name = models.CharField(max_length=120, blank=True, default="")
    row_count = models.PositiveIntegerField(default=0)
    error = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"Report export #{self.pk} ({self.format}, {self.status})"
```
Run: `$BT run --rm web python manage.py makemigrations reports --name reportexport`
Expected: `reports/migrations/0003_reportexport.py`.

- [ ] **Step 4: The export module**

`backend/reports/exports.py`:
```python
"""Report exports (staff foundations F6): CSV (UTF-8 with a BOM, formula-
escaped), Excel (XlsxWriter, constant memory) and PDF (WeasyPrint, with SVG
bar charts). Ranges over 31 days or 5,000 rows are built by a Celery job into
PRIVATE_MEDIA_ROOT and served by a permission-checked view behind a signed
link valid 24 hours."""
import csv
import io
from pathlib import Path
from urllib.parse import quote

from django.conf import settings
from django.core import signing
from django.db.models import Q
from django.http import HttpResponse, StreamingHttpResponse
from django.template.loader import render_to_string
from django.utils import timezone
from rest_framework.negotiation import DefaultContentNegotiation

from accounts.models import StaffUser

from . import services
from .models import ReportExport, StaffReport

FORMATS = {
    "csv": "text/csv; charset=utf-8",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "pdf": "application/pdf",
}
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
BACKGROUND_DAYS = 31
BACKGROUND_ROWS = 5000
LINK_SALT = "reports.export-download"
LINK_MAX_AGE = 24 * 60 * 60
CHART_WIDTH = 230
COLUMNS = [
    ("staff", "Staff"), ("role", "Role"), ("period", "Period"), ("period_start", "From"), ("period_end", "To"),
    ("status", "Status"), ("submitted_at", "Submitted"), ("is_late", "Late"), ("system", "System numbers"),
    ("achievements", "Achievements"), ("blockers", "Blockers"), ("plan_next", "Plan"),
    ("plan_results", "Previous plan"), ("reviewer", "Reviewed by"), ("review_note", "Review note"),
    ("similarity", "Similarity"),
]


class ExportNegotiation(DefaultContentNegotiation):
    """Exports take ?format=csv|xlsx|pdf (spec F6), which DRF would otherwise
    read as its own renderer override and answer 404 before the view runs.
    Error bodies are always JSON."""

    def select_renderer(self, request, renderers, format_suffix=None):
        return renderers[0], renderers[0].media_type


def escape_cell(value):
    """Spreadsheet formula injection: a cell that starts = + - @ tab or CR
    gets a leading apostrophe so Excel and Sheets show it as text."""
    text = "" if value is None else str(value)
    return "'" + text if text.startswith(FORMULA_PREFIXES) else text


def _system_text(sections):
    parts = []
    for section in sections or []:
        rows = ", ".join(f"{row.get('label', '')} {row.get('value', '')}" for row in section.get("rows", []))
        parts.append(f"{section.get('title', '')}: {rows}")
    return "; ".join(parts)


def report_row(report):
    submitted = timezone.localtime(report.submitted_at).strftime("%Y-%m-%d %H:%M") if report.submitted_at else ""
    return {
        "staff": report.staff.full_name,
        "role": report.staff.role.name,
        "period": report.get_period_display(),
        "period_start": report.period_start.isoformat(),
        "period_end": report.period_end.isoformat(),
        "status": report.get_status_display(),
        "submitted_at": submitted,
        "is_late": "yes" if report.is_late else "no",
        "system": _system_text(report.system_snapshot),
        "achievements": report.achievements,
        "blockers": report.blockers,
        "plan_next": "; ".join(str(item) for item in report.plan_next),
        "plan_results": "; ".join(
            f"{row.get('item', '')}: {row.get('result') or 'not marked'}" for row in report.plan_results
        ),
        "reviewer": report.reviewer.full_name if report.reviewer else "",
        "review_note": report.review_note,
        "similarity": f"{report.similarity:.2f}",
    }


class _Echo:
    def write(self, value):
        return value


def csv_chunks(reports):
    writer = csv.writer(_Echo())
    yield "﻿"
    yield writer.writerow([label for _, label in COLUMNS])
    for report in reports:
        row = report_row(report)
        yield writer.writerow([escape_cell(row[key]) for key, _ in COLUMNS])


def write_xlsx(reports, target):
    import xlsxwriter

    # Every cell is written as text and strings_to_formulas is off, so nothing
    # a staffer typed can become a live formula; no apostrophe escaping needed.
    workbook = xlsxwriter.Workbook(target, {
        "constant_memory": True, "strings_to_formulas": False,
        "strings_to_urls": False, "strings_to_numbers": False,
    })
    sheet = workbook.add_worksheet("Reports")
    header = workbook.add_format({"bold": True})
    for col, (_, label) in enumerate(COLUMNS):
        sheet.write_string(0, col, label, header)
    for row_number, report in enumerate(reports, start=1):
        row = report_row(report)
        for col, (key, _) in enumerate(COLUMNS):
            sheet.write_string(row_number, col, row[key])
    workbook.close()


def _chart(section):
    rows = section.get("rows", [])
    numbers = [row.get("value") for row in rows if isinstance(row.get("value"), (int, float))]
    top = max(numbers or [0]) or 1
    drawn = []
    for index, row in enumerate(rows):
        value = row.get("value") if isinstance(row.get("value"), (int, float)) else 0
        width = round(CHART_WIDTH * value / top)
        y = index * 16
        drawn.append({
            "label": str(row.get("label", ""))[:40], "value": row.get("value", ""),
            "y": y, "text_y": y + 9, "width": width, "value_x": 190 + width + 6,
        })
    return {"title": section.get("title", ""), "rows": drawn, "height": max(len(rows) * 16, 16)}


def _pdf_report(report):
    same_day = report.period_start == report.period_end
    return {
        "staff": report.staff.full_name,
        "role": report.staff.role.name.replace("_", " ").title(),
        "period": report.get_period_display(),
        "range": str(report.period_start) if same_day else f"{report.period_start} to {report.period_end}",
        "status": report.get_status_display(),
        "submitted_at": timezone.localtime(report.submitted_at) if report.submitted_at else None,
        "is_late": report.is_late,
        "similar": report.similarity >= services.SIMILARITY_FLAG,
        "sections": [_chart(section) for section in (report.system_snapshot or [])],
        "achievements": report.achievements,
        "blockers": report.blockers,
        "plan_next": report.plan_next,
        "plan_results": report.plan_results,
        "reviewer": report.reviewer.full_name if report.reviewer else "",
        "review_note": report.review_note,
    }


def pdf_bytes(reports, title):
    from weasyprint import HTML  # loads Pango; imported only when a PDF is made

    html = render_to_string("reports/report_export.html", {
        "title": title, "generated_at": timezone.localtime(), "reports": [_pdf_report(r) for r in reports],
    })
    return HTML(string=html).write_pdf()


def may_export_staff(requester, staff_id):
    if staff_id == requester.pk or services.VIEW_ALL in requester.effective_permission_codenames():
        return True
    return StaffUser.objects.filter(pk=staff_id, manager=requester).exists()


def export_queryset(requester, filters):
    """Reports `requester` may export under `filters` ({"from", "to"} as
    YYYY-MM-DD; optional "staff", "role", "period"): their own, their direct
    reports' (managers), everyone's (reports.view_all). Drafts never export.
    The background job calls this again, so access is re-checked when it runs."""
    reports = StaffReport.objects.exclude(status=StaffReport.DRAFT).select_related("staff__role", "reviewer")
    if services.VIEW_ALL not in requester.effective_permission_codenames():
        reports = reports.filter(Q(staff=requester) | Q(staff__manager=requester))
    if filters.get("staff"):
        reports = reports.filter(staff_id=filters["staff"])
    if filters.get("role"):
        reports = reports.filter(staff__role__name=filters["role"])
    if filters.get("period"):
        reports = reports.filter(period=filters["period"])
    return reports.filter(period_start__gte=filters["from"], period_end__lte=filters["to"]).order_by(
        "staff__full_name", "period_start", "period"
    )


def range_title(filters):
    return f"AshantiHub staff reports, {filters['from']} to {filters['to']}"


def export_response(reports, fmt, stem, title):
    if fmt == "csv":
        response = StreamingHttpResponse(csv_chunks(reports), content_type=FORMATS["csv"])
    elif fmt == "xlsx":
        buffer = io.BytesIO()
        write_xlsx(reports, buffer)
        response = HttpResponse(buffer.getvalue(), content_type=FORMATS["xlsx"])
    else:
        response = HttpResponse(pdf_bytes(reports, title), content_type=FORMATS["pdf"])
    response["Content-Disposition"] = f'attachment; filename="{stem}.{fmt}"'
    return response


def write_export_file(reports, fmt, path, title):
    if fmt == "csv":
        with open(path, "w", encoding="utf-8", newline="") as handle:
            for chunk in csv_chunks(reports):
                handle.write(chunk)
    elif fmt == "xlsx":
        write_xlsx(reports, str(path))
    else:
        Path(path).write_bytes(pdf_bytes(reports, title))


def export_dir():
    return Path(settings.PRIVATE_MEDIA_ROOT) / "report-exports"


def export_path(export):
    return export_dir() / export.file_name


def download_url(export):
    signature = signing.TimestampSigner(salt=LINK_SALT).sign(str(export.pk))
    return f"/api/reports/exports/{export.pk}/download/?sig={quote(signature)}"


def signature_matches(export, signature):
    try:
        return signing.TimestampSigner(salt=LINK_SALT).unsign(signature or "", max_age=LINK_MAX_AGE) == str(export.pk)
    except signing.BadSignature:
        return False


def download_filename(export):
    return f"ashantihub-reports-{export.filters.get('from')}-{export.filters.get('to')}.{export.format}"


def export_payload(export):
    ready = export.status == ReportExport.READY and export.expires_at and export.expires_at > timezone.now()
    return {
        "id": export.pk,
        "format": export.format,
        "status": export.status,
        "row_count": export.row_count,
        "error": export.error,
        "created_at": export.created_at,
        "finished_at": export.finished_at,
        "expires_at": export.expires_at,
        "file_name": download_filename(export),
        "download_url": download_url(export) if ready else None,
    }
```

- [ ] **Step 5: The PDF template**

`backend/reports/templates/reports/report_export.html`:
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{{ title }}</title>
<style>
  @page { size: A4; margin: 18mm 16mm;
    @bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 8pt; color: #6b5a4e; } }
  body { font-family: "DejaVu Sans", sans-serif; color: #2C1810; font-size: 10pt; line-height: 1.45; }
  h1 { font-size: 16pt; margin: 0 0 4pt; }
  h2 { font-size: 12pt; margin: 0 0 4pt; padding-bottom: 3pt; border-bottom: 1px solid #D4A01766; }
  h3 { font-size: 10pt; margin: 10pt 0 3pt; }
  .meta { color: #6b5a4e; font-size: 9pt; margin-bottom: 8pt; }
  .report + .report { page-break-before: always; }
  table { border-collapse: collapse; width: 100%; margin-top: 8pt; font-variant-numeric: tabular-nums; }
  td { padding: 3pt 4pt; vertical-align: top; border-top: 1px solid #2C18101f; }
  td.label { color: #6b5a4e; width: 30%; }
  .flag { color: #A33A00; font-weight: bold; }
</style>
</head>
<body>
  <h1>{{ title }}</h1>
  <div class="meta">Generated {{ generated_at|date:"j M Y, H:i" }} · from AshantiHub's records</div>
  {% for r in reports %}
  <section class="report">
    <h2>{{ r.staff }} · {{ r.role }} · {{ r.period }} report · {{ r.range }}</h2>
    <div class="meta">
      {{ r.status }}{% if r.submitted_at %} · submitted {{ r.submitted_at|date:"j M Y, H:i" }}{% endif %}
      {% if r.is_late %} · <span class="flag">after the deadline</span>{% endif %}
      {% if r.similar %} · <span class="flag">reads very like an earlier report</span>{% endif %}
    </div>
    {% for s in r.sections %}
      <h3>{{ s.title }}</h3>
      <svg xmlns="http://www.w3.org/2000/svg" width="440" height="{{ s.height }}">
        {% for row in s.rows %}
          <text x="0" y="{{ row.text_y }}" font-size="8" fill="#2C1810">{{ row.label }}</text>
          <rect x="190" y="{{ row.y }}" width="{{ row.width }}" height="10" fill="#D4A017"></rect>
          <text x="{{ row.value_x }}" y="{{ row.text_y }}" font-size="8" fill="#2C1810">{{ row.value }}</text>
        {% endfor %}
      </svg>
    {% empty %}
      <div class="meta">No system numbers: this report was never submitted.</div>
    {% endfor %}
    <table>
      <tr><td class="label">What went well</td><td>{{ r.achievements|linebreaksbr }}</td></tr>
      <tr><td class="label">What got in the way</td><td>{{ r.blockers|linebreaksbr }}</td></tr>
      <tr><td class="label">Plan</td><td>{% for item in r.plan_next %}{{ item }}{% if not forloop.last %}<br>{% endif %}{% endfor %}</td></tr>
      <tr><td class="label">Previous plan</td><td>{% for row in r.plan_results %}{{ row.item }}: {{ row.result|default:"not marked" }}{% if not forloop.last %}<br>{% endif %}{% endfor %}</td></tr>
      {% if r.reviewer %}<tr><td class="label">Reviewed by</td><td>{{ r.reviewer }}{% if r.review_note %}: {{ r.review_note }}{% endif %}</td></tr>{% endif %}
    </table>
  </section>
  {% endfor %}
</body>
</html>
```

- [ ] **Step 6: The background jobs**

Replace `backend/reports/tasks.py`:
```python
import logging
import uuid
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from notifications.services import notify_staff

from . import exports, services
from .models import ReportExport

logger = logging.getLogger(__name__)


@shared_task
def send_day_report_reminders():
    return services.send_day_reminders()


@shared_task
def build_report_export(export_id):
    export = ReportExport.objects.select_related("requester__role").get(pk=export_id)
    ReportExport.objects.filter(pk=export.pk).update(status=ReportExport.RUNNING)
    directory = exports.export_dir()
    directory.mkdir(parents=True, exist_ok=True)
    final_name = f"{uuid.uuid4().hex}.{export.format}"
    partial = directory / f"{final_name}.partial"
    try:
        reports = list(exports.export_queryset(export.requester, export.filters))
        exports.write_export_file(reports, export.format, partial, exports.range_title(export.filters))
        partial.rename(directory / final_name)
    except Exception as exc:
        # Nothing partial is ever served: the half-written file goes too.
        partial.unlink(missing_ok=True)
        logger.exception("Report export %s failed", export.pk)
        message = (str(exc) or exc.__class__.__name__)[:300]
        ReportExport.objects.filter(pk=export.pk).update(
            status=ReportExport.FAILED, error=message, finished_at=timezone.now()
        )
        notify_staff(export.requester, "report_export_failed", "Your report export failed",
                     body=message, link="reports", icon="⚠️")
        return
    now = timezone.now()
    ReportExport.objects.filter(pk=export.pk).update(
        status=ReportExport.READY, file_name=final_name, row_count=len(reports),
        finished_at=now, expires_at=now + timedelta(seconds=exports.LINK_MAX_AGE),
    )
    notify_staff(export.requester, "report_export_ready", "Your report export is ready",
                 body="Download it from My Reports within 24 hours.", link="reports", icon="📦")


@shared_task
def purge_expired_exports():
    expired = 0
    for export in ReportExport.objects.filter(status=ReportExport.READY, expires_at__lt=timezone.now()):
        exports.export_path(export).unlink(missing_ok=True)
        ReportExport.objects.filter(pk=export.pk).update(status=ReportExport.EXPIRED)
        expired += 1
    return expired
```
In `backend/ashantihub/settings.py` add to `CELERY_BEAT_SCHEDULE`:
```python
    "reports-purge-exports": {
        "task": "reports.tasks.purge_expired_exports",
        "schedule": crontab(hour=4, minute=0),
    },
```

- [ ] **Step 7: The export views and URLs**

In `backend/reports/views.py` add these imports:
```python
from django.db import transaction
from django.http import FileResponse
from django.utils.text import slugify

from accounts.sessions import require_sudo
from activity.services import record

from . import exports
from .models import ReportExport
from .tasks import build_report_export
```
and append:
```python
def _format(params):
    fmt = params.get("format", "")
    if fmt not in exports.FORMATS:
        raise ValidationError({"format": "Use csv, xlsx or pdf."})
    return fmt


class ReportExportView(APIView):
    """GET /api/reports/<id>/export/?format= — one report."""

    content_negotiation_class = exports.ExportNegotiation

    def get_permissions(self):
        return [IsStaff()]

    def get(self, request, pk):
        fmt = _format(request.query_params)
        report = generics.get_object_or_404(
            services.visible_reports(request.user).select_related("staff__role", "reviewer"), pk=pk
        )
        if report.staff_id != request.user.pk:
            require_sudo(request)  # someone else's report is personal data
        record(request.user, "report.exported", target=report, after={"format": fmt, "report": report.pk}, request=request)
        stem = f"report-{slugify(report.staff.full_name)}-{report.period}-{report.period_start}"
        return exports.export_response([report], fmt, stem, str(report))


class ReportRangeExportView(APIView):
    """GET /api/reports/export/?from=&to=&format=[&staff=&role=&period=]"""

    content_negotiation_class = exports.ExportNegotiation

    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        params = request.query_params
        fmt = _format(params)
        start = _date(params.get("from"), "from", required=True)
        end = _date(params.get("to"), "to", required=True)
        if end < start:
            raise ValidationError({"to": "Pick an end date on or after the start."})
        filters = {"from": start.isoformat(), "to": end.isoformat()}
        if params.get("staff"):
            if not (params["staff"].isdecimal() and params["staff"].isascii()):
                raise ValidationError({"staff": "Use a staff id."})
            if not exports.may_export_staff(request.user, int(params["staff"])):
                raise PermissionDenied("You can export only your own and your team's reports.")
            filters["staff"] = int(params["staff"])
        if params.get("role"):
            filters["role"] = params["role"]
        if params.get("period"):
            filters["period"] = _period(params["period"])
        reports = exports.export_queryset(request.user, filters)
        if reports.exclude(staff=request.user).exists():
            require_sudo(request)  # other people's reports are personal data
        count = reports.count()
        background = (end - start).days + 1 > exports.BACKGROUND_DAYS or count > exports.BACKGROUND_ROWS
        record(request.user, "report.exported",
               after={"filters": filters, "format": fmt, "rows": count, "background": background}, request=request)
        if background:
            export = ReportExport.objects.create(requester=request.user, filters=filters, format=fmt)
            transaction.on_commit(lambda: build_report_export.delay(export.pk))
            return Response({"id": export.pk, "status": export.status}, status=202)
        return exports.export_response(list(reports), fmt, f"ashantihub-reports-{start}-{end}", exports.range_title(filters))


class ReportExportListView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request):
        return Response([exports.export_payload(e) for e in ReportExport.objects.filter(requester=request.user)[:20]])


class ReportExportDownloadView(APIView):
    def get_permissions(self):
        return [IsStaff()]

    def get(self, request, pk):
        export = generics.get_object_or_404(ReportExport, pk=pk, requester=request.user)
        if not exports.signature_matches(export, request.query_params.get("sig")):
            return Response({"detail": "This download link has expired. Export again."}, status=403)
        path = exports.export_path(export)
        if export.status != ReportExport.READY or not export.file_name or not path.exists():
            return Response({"detail": "This export isn't available any more."}, status=410)
        return FileResponse(open(path, "rb"), as_attachment=True, filename=exports.download_filename(export))
```
In `backend/reports/urls.py` add before `path("<int:pk>/", …)`:
```python
    path("export/", views.ReportRangeExportView.as_view(), name="report-range-export"),
    path("exports/", views.ReportExportListView.as_view(), name="report-export-list"),
    path("exports/<int:pk>/download/", views.ReportExportDownloadView.as_view(), name="report-export-download"),
    path("<int:pk>/export/", views.ReportExportView.as_view(), name="report-export"),
```

- [ ] **Step 8: Run the tests**

```bash
$BT run --rm web python manage.py test --noinput reports core.tests.test_background_jobs
```
Expected: OK.

- [ ] **Step 9: Commit**

```bash
git add backend
git commit -m "feat(staff): report exports — CSV with BOM and formula escaping, Excel, PDF, background jobs, signed links"
```

---
### Task 10: Live updates — tickets, the staff socket and the publisher

**Files:**
- Create: `backend/realtime/__init__.py` (empty), `backend/realtime/apps.py`, `backend/realtime/tickets.py`, `backend/realtime/consumers.py`, `backend/realtime/routing.py`, `backend/realtime/publish.py`, `backend/realtime/views.py`, `backend/realtime/urls.py`
- Create: `backend/realtime/tests/__init__.py` (empty), `backend/realtime/tests/test_consumer.py`, `backend/realtime/tests/test_publish.py`
- Modify: `backend/ashantihub/settings.py` (`INSTALLED_APPS`), `backend/ashantihub/asgi.py`, `backend/ashantihub/urls.py`
- Modify: `backend/accounts/sessions.py` (`revoke`, `revoke_all` disconnect sockets), `backend/accounts/views.py` (`StaffPermissionsView`, `StaffManagerView`)
- Modify: `backend/activity/middleware.py` (`activity_exempt` views)

**Interfaces:**
- Consumes: Task 1 (`CACHES["realtime"]`, channel layer, ASGI), Task 2 (`sessions.current`, `end_reason_if_invalid`), Tasks 5–8 (approval and report verbs), 1A (`activity.services.on_recorded`, `ROLE_ACTIVITY_VISIBILITY`, `staff_holding`).
- Produces:
  - `POST /api/realtime/ticket/` (staff only) → `{"ticket", "expires_in": 30}`; the view is `activity_exempt`
  - WebSocket `wss://<api>/ws/staff/?ticket=…` → `realtime.consumers.StaffConsumer`; close codes 4401 (bad ticket or ended session), 4403 (staffer can't connect), 4000 (server asks for a reconnect)
  - server → client messages: feed `{type: "activity", verb, target: {type, id, label}, actor: {id, name, role}, at, invalidate: [keys]}`; `{type: "invalidate", invalidate: [keys], at}`; `{type: "force_disconnect"}`
  - `realtime.tickets`: `TICKET_TTL`, `PREFIX`, `issue_ticket(staff, session) -> str`, `redeem_ticket(ticket, now=None) -> dict | None`
  - `realtime.routing`: `websocket_urlpatterns`, `build_websocket_app(origins=None)`
  - `realtime.publish`: `QUEUE_INVALIDATIONS`, `FEED_KEYS`, `feed_recipients(event) -> set[int]`, `publish_activity(event)`, `force_disconnect(group)`, `force_disconnect_on_commit(group)`
  - an `activity_exempt = True` class attribute on any APIView skips the activity middleware
  - query keys the frontend must use as the first element of its React Query keys: `activity`, `my-tasks`, `call-logs`, `staff-badges`, `approvals`, `approval`, `approval-counts`, `my-reports`, `report`, `team-reports`, `kyc-queue`, `kyc-detail`, `moderation-queue`, `hero-moderation-queue`, `event-moderation-queue`, `event-moderation-detail`, `reviews-moderation-queue`, `contact-messages-queue`, `staff-messaging-queue`, `staff-roster`, `my-team`

- [ ] **Step 1: Write the failing tests**

`backend/realtime/tests/test_publish.py`:
```python
import asyncio

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts import sessions
from accounts.authentication import issue_token
from accounts.models import Customer, Role, StaffSession, StaffUser
from accounts.testing import staff_token
from activity import services as activity
from activity.models import ActivityEvent
from activity.services import on_recorded
from approvals import registry
from approvals import services as approvals
from approvals.tests.kinds import RENAME_STAFF
from realtime.publish import publish_activity

FEED_FIELDS = {"type", "verb", "target", "actor", "at", "invalidate"}


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


class PublishTests(TestCase):
    def setUp(self):
        self.layer = get_channel_layer()
        async_to_sync(self.layer.flush)()
        self.boss = make_staff("super_admin", "boss@example.com")
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.esi = make_staff("support", "esi@example.com")

    def listen(self, group):
        channel = async_to_sync(self.layer.new_channel)()
        async_to_sync(self.layer.group_add)(group, channel)
        return channel

    def message(self, channel):
        return async_to_sync(self.layer.receive)(channel)

    def silent(self, channel):
        async def check():
            try:
                await asyncio.wait_for(self.layer.receive(channel), timeout=0.05)
            except asyncio.TimeoutError:
                return True
            return False

        return async_to_sync(check)()

    def record(self, actor, verb, **fields):
        with self.captureOnCommitCallbacks(execute=True):
            return activity.record(actor, verb, **fields)

    def test_the_publisher_is_attached_once(self):
        self.assertEqual(on_recorded.count(publish_activity), 1)

    def test_a_feed_event_reaches_the_actor_their_manager_and_super_admins_only(self):
        mine = self.listen(f"staff.{self.scout.id}")
        manager = self.listen(f"staff.{self.lead.id}")
        boss = self.listen(f"staff.{self.boss.id}")
        outsider = self.listen(f"staff.{self.esi.id}")
        self.record(self.scout, "call-list", method="POST", target_type="calls.calllog", target_id="7", target_label="Adwoa Fabrics")
        payload = self.message(mine)["payload"]
        self.assertEqual(set(payload), FEED_FIELDS)
        self.assertEqual(payload["target"], {"type": "calls.calllog", "id": "7", "label": "Adwoa Fabrics"})
        self.assertEqual(payload["actor"], {"id": self.scout.id, "name": "Kwame", "role": "scout"})
        self.assertEqual(payload["invalidate"], ["activity", "call-logs"])
        self.assertEqual(self.message(manager)["payload"]["verb"], "call-list")
        self.assertEqual(self.message(boss)["payload"]["verb"], "call-list")
        self.assertTrue(self.silent(outsider))

    def test_queue_changes_tell_permission_groups_only_what_to_refetch(self):
        queue = self.listen("perm.kyc.approve")
        self.record(self.lead, "kyc-approve", method="POST", target_type="accounts.businessowner", target_id="3", target_label="Adwoa Fabrics")
        payload = self.message(queue)["payload"]
        self.assertEqual(set(payload), {"type", "invalidate", "at"})
        self.assertEqual(payload["invalidate"], ["kyc-queue", "kyc-detail", "staff-badges"])

    def test_system_events_reach_only_super_admins(self):
        boss = self.listen(f"staff.{self.boss.id}")
        lead = self.listen(f"staff.{self.lead.id}")
        self.record(None, "approval.escalated")
        self.assertEqual(self.message(boss)["payload"]["verb"], "approval.escalated")
        self.assertTrue(self.silent(lead))

    def test_approval_events_refresh_the_maker_and_the_approver(self):
        registry.register(RENAME_STAFF)
        self.addCleanup(registry.unregister, RENAME_STAFF.key)
        maker = self.listen(f"staff.{self.scout.id}")
        approver = self.listen(f"staff.{self.lead.id}")
        with self.captureOnCommitCallbacks(execute=True):
            approvals.submit(self.scout, RENAME_STAFF.key, target=self.esi, title="Rename Esi", payload={"full_name": "Esi Nyarko"})
        for channel in (maker, approver):
            payloads = [self.message(channel)["payload"] for _ in range(2)]
            invalidation = next(p for p in payloads if p["type"] == "invalidate")
            self.assertIn("approvals", invalidation["invalidate"])

    def test_a_permission_change_makes_that_staffer_reconnect(self):
        channel = self.listen(f"staff.{self.esi.id}")
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss, sudo=True)}")
        with self.captureOnCommitCallbacks(execute=True):
            client.post(f"/api/accounts/staff/{self.esi.id}/permissions/", {"grant": ["kyc.approve"], "revoke": []}, format="json")
        self.assertEqual(self.message(channel), {"type": "force.disconnect"})

    def test_ending_a_session_disconnects_that_device_only(self):
        session = StaffSession.objects.get(jti=AccessToken(issue_token(self.esi, "staff"))["jti"])
        other = StaffSession.objects.get(jti=AccessToken(issue_token(self.esi, "staff"))["jti"])
        this_device = self.listen(f"session.{session.pk}")
        other_device = self.listen(f"session.{other.pk}")
        with self.captureOnCommitCallbacks(execute=True):
            sessions.revoke(session, StaffSession.ENDED)
        self.assertEqual(self.message(this_device), {"type": "force.disconnect"})
        self.assertTrue(self.silent(other_device))

    def test_tickets_are_staff_only_and_not_activity(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.esi)}")
        response = client.post("/api/realtime/ticket/", {}, format="json")
        self.assertEqual(response.json()["expires_in"], 30)
        self.assertFalse(ActivityEvent.objects.filter(verb="realtime-ticket").exists())
        customer = Customer.objects.create(full_name="Yaw Mensah", phone="0240000001", password_hash="x")
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {issue_token(customer, 'customer')}")
        self.assertEqual(client.post("/api/realtime/ticket/", {}, format="json").status_code, 403)
```
`backend/realtime/tests/test_consumer.py`:
```python
from asgiref.sync import async_to_sync, sync_to_async
from channels.layers import get_channel_layer
from channels.routing import URLRouter
from channels.testing import WebsocketCommunicator
from django.core.cache import caches
from django.test import TransactionTestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from accounts.authentication import issue_token
from accounts.models import Permission, Role, StaffSession, StaffUser
from accounts.testing import staff_token
from realtime import tickets
from realtime.routing import build_websocket_app, websocket_urlpatterns

APP = URLRouter(websocket_urlpatterns)


def make_staff(role, email, **extra):
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(), email=email, password_hash="x",
        role=Role.objects.get(name=role), **extra,
    )


def invalidation(keys):
    return {"type": "staff.event", "payload": {"type": "invalidate", "invalidate": keys, "at": "now"}}


class ConsumerTests(TransactionTestCase):
    # The consumer reads the database from another thread, so the data must
    # be committed; serialized_rollback restores the seeded roles afterwards.
    serialized_rollback = True

    def setUp(self):
        caches["realtime"].clear()
        self.lead = make_staff("operations", "ama@example.com")
        self.scout = make_staff("scout", "kwame@example.com", manager=self.lead)
        self.boss = make_staff("super_admin", "boss@example.com")
        self.token = issue_token(self.scout, "staff")
        self.session = StaffSession.objects.get(jti=AccessToken(self.token)["jti"])

    def ticket(self):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {self.token}")
        return client.post("/api/realtime/ticket/", {}, format="json").json()["ticket"]

    def socket(self, ticket, app=APP, origin=None):
        headers = [(b"origin", origin.encode())] if origin else []
        return WebsocketCommunicator(app, f"/ws/staff/?ticket={ticket}", headers=headers)

    def test_the_asgi_application_routes_websockets(self):
        from ashantihub.asgi import application

        self.assertIn("websocket", application.application_mapping)

    def test_a_ticket_connects_once(self):
        ticket = self.ticket()

        async def run():
            first = self.socket(ticket)
            connected, _ = await first.connect()
            self.assertTrue(connected)
            second = self.socket(ticket)
            connected_again, code = await second.connect()
            self.assertEqual((connected_again, code), (False, 4401))
            await first.disconnect()

        async_to_sync(run)()

    def test_a_ticket_lapses_after_thirty_seconds(self):
        ticket = tickets.issue_ticket(self.scout, self.session)
        claims = caches["realtime"].get(tickets.PREFIX + ticket)
        self.assertIsNone(tickets.redeem_ticket(ticket, now=claims["issued_at"] + 31))

    def test_garbage_tickets_are_refused(self):
        async def run():
            connected, _ = await self.socket("not-a-ticket").connect()
            self.assertFalse(connected)

        async_to_sync(run)()

    def test_groups_follow_effective_permissions(self):
        self.scout.extra_permissions.add(Permission.objects.get(codename="kyc.approve"))
        self.scout.revoked_permissions.add(Permission.objects.get(codename="calls.log"))
        ticket = self.ticket()

        async def run():
            socket = self.socket(ticket)
            await socket.connect()
            layer = get_channel_layer()
            groups = ["perm.kyc.approve", f"team.{self.lead.id}", "role.scout", f"staff.{self.scout.id}", f"session.{self.session.id}"]
            for group in groups:
                await layer.group_send(group, invalidation([group]))
                self.assertEqual((await socket.receive_json_from(timeout=1))["invalidate"], [group])
            await layer.group_send("perm.calls.log", invalidation(["call-logs"]))
            self.assertTrue(await socket.receive_nothing(timeout=0.1))
            await socket.disconnect()

        async_to_sync(run)()

    def test_suspension_forces_a_disconnect_and_blocks_reconnecting(self):
        ticket = self.ticket()
        boss = APIClient()
        boss.credentials(HTTP_AUTHORIZATION=f"Bearer {staff_token(self.boss, sudo=True)}")

        async def run():
            socket = self.socket(ticket)
            await socket.connect()
            await sync_to_async(boss.post)(f"/api/accounts/staff/{self.scout.id}/suspend/", {"reason": "x"}, format="json")
            self.assertEqual(await socket.receive_json_from(timeout=2), {"type": "force_disconnect"})
            closed = await socket.receive_output(timeout=2)
            self.assertEqual((closed["type"], closed["code"]), ("websocket.close", 4000))

        async_to_sync(run)()
        fresh = tickets.issue_ticket(self.scout, self.session)

        async def again():
            connected, _ = await self.socket(fresh).connect()
            self.assertFalse(connected)

        async_to_sync(again)()

    def test_a_foreign_origin_is_refused(self):
        app = build_websocket_app(origins=["https://theashantihub.com"])
        ticket = self.ticket()

        async def run():
            refused, _ = await self.socket(ticket, app, origin="https://evil.example").connect()
            self.assertFalse(refused)
            allowed = self.socket(ticket, app, origin="https://theashantihub.com")
            connected, _ = await allowed.connect()
            self.assertTrue(connected)
            await allowed.disconnect()

        async_to_sync(run)()
```

- [ ] **Step 2: Create the app skeleton**

Empty files: `backend/realtime/__init__.py`, `backend/realtime/tests/__init__.py`. Add `"realtime",` to `INSTALLED_APPS` after `"reports",`.
`backend/realtime/apps.py`:
```python
from django.apps import AppConfig


class RealtimeConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "realtime"

    def ready(self):
        # Every activity event is published after its transaction commits.
        from activity import services

        from .publish import publish_activity

        if publish_activity not in services.on_recorded:
            services.on_recorded.append(publish_activity)
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `$BT run --rm web python manage.py test --noinput realtime`
Expected: ERROR — `No module named 'realtime.publish'`.

- [ ] **Step 4: Tickets**

`backend/realtime/tickets.py`:
```python
"""Single-use, 30-second tickets for the staff WebSocket (F2). A browser
can't set headers on a WebSocket, and a JWT in a URL would land in access
logs, so the client trades its token for a ticket first."""
import secrets
import time

from django.core.cache import caches

TICKET_TTL = 30
PREFIX = "realtime:ticket:"


def _cache():
    return caches["realtime"]


def issue_ticket(staff, session):
    ticket = secrets.token_urlsafe(32)
    _cache().set(
        PREFIX + ticket,
        {"staff_id": staff.pk, "session_id": session.pk, "issued_at": time.time()},
        timeout=TICKET_TTL,
    )
    return ticket


def redeem_ticket(ticket, now=None):
    """The ticket's claims, exactly once and within 30 seconds; else None."""
    if not ticket or len(ticket) > 100:
        return None
    key = PREFIX + ticket
    cache = _cache()
    claims = cache.get(key)
    # delete() is true for one caller only, so two racing redemptions can't both win.
    if claims is None or not cache.delete(key):
        return None
    if (now if now is not None else time.time()) - claims["issued_at"] > TICKET_TTL:
        return None
    return claims
```

- [ ] **Step 5: The consumer and routing**

`backend/realtime/consumers.py`:
```python
import time
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from . import tickets

RECHECK_SECONDS = 60
CLOSE_UNAUTHORISED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_RECONNECT = 4000


def _groups_for(claims):
    """The groups a ticket's staffer joins, from their EFFECTIVE permissions,
    or None if they may not connect."""
    from accounts import sessions
    from accounts.models import StaffSession, StaffUser

    staff = (
        StaffUser.objects.select_related("role")
        .filter(pk=claims["staff_id"], is_active=True, is_suspended=False)
        .first()
    )
    session = StaffSession.objects.filter(pk=claims["session_id"], staff_id=claims["staff_id"]).first()
    if staff is None or session is None or sessions.end_reason_if_invalid(session):
        return None
    groups = [f"staff.{staff.pk}", f"session.{session.pk}", f"role.{staff.role.name}"]
    groups += [f"perm.{codename}" for codename in sorted(staff.effective_permission_codenames())]
    if staff.manager_id:
        groups.append(f"team.{staff.manager_id}")
    return groups


def _session_still_valid(session_id):
    from accounts import sessions
    from accounts.models import StaffSession

    session = StaffSession.objects.select_related("staff").filter(pk=session_id).first()
    return bool(
        session
        and sessions.end_reason_if_invalid(session) is None
        and session.staff.is_active
        and not session.staff.is_suspended
    )


class StaffConsumer(AsyncJsonWebsocketConsumer):
    """Server-to-client only. Messages arrive from the channel layer as
    "staff.event" (forwarded as-is) or "force.disconnect" (permission change,
    suspension, ended session — the client reconnects and gets a new group
    set, or is refused)."""

    async def connect(self):
        self.joined = []
        query = parse_qs(self.scope.get("query_string", b"").decode())
        claims = await database_sync_to_async(tickets.redeem_ticket)(query.get("ticket", [""])[0])
        if claims is None:
            await self.close(code=CLOSE_UNAUTHORISED)
            return
        groups = await database_sync_to_async(_groups_for)(claims)
        if groups is None:
            await self.close(code=CLOSE_FORBIDDEN)
            return
        self.session_id = claims["session_id"]
        self.checked_at = time.monotonic()
        for group in groups:
            await self.channel_layer.group_add(group, self.channel_name)
        self.joined = groups
        await self.accept()

    async def disconnect(self, code):
        for group in getattr(self, "joined", []):
            await self.channel_layer.group_discard(group, self.channel_name)

    async def receive_json(self, content, **kwargs):
        return  # the browser never needs to send anything

    async def staff_event(self, event):
        # A session can end without a revoke (idle, 12 h); re-check it at most
        # once a minute before forwarding anything.
        if time.monotonic() - self.checked_at > RECHECK_SECONDS:
            self.checked_at = time.monotonic()
            if not await database_sync_to_async(_session_still_valid)(self.session_id):
                await self.close(code=CLOSE_UNAUTHORISED)
                return
        await self.send_json(event["payload"])

    async def force_disconnect(self, event):
        await self.send_json({"type": "force_disconnect"})
        await self.close(code=CLOSE_RECONNECT)
```
`backend/realtime/routing.py`:
```python
from channels.routing import URLRouter
from channels.security.websocket import OriginValidator
from django.conf import settings
from django.urls import path

from .consumers import StaffConsumer

websocket_urlpatterns = [path("ws/staff/", StaffConsumer.as_asgi())]


def allowed_origins():
    # Same origins the REST API allows (CORS); "*" where CORS allows all.
    if settings.CORS_ALLOW_ALL_ORIGINS:
        return ["*"]
    return list(settings.CORS_ALLOWED_ORIGINS)


def build_websocket_app(origins=None):
    return OriginValidator(URLRouter(websocket_urlpatterns), origins if origins is not None else allowed_origins())
```
In `backend/ashantihub/asgi.py` replace the last two lines with:
```python
from channels.routing import ProtocolTypeRouter  # noqa: E402

from realtime.routing import build_websocket_app  # noqa: E402

# HTTP and WebSockets (/ws/staff/) from one process type — gunicorn with
# uvicorn workers in production, daphne's runserver locally.
application = ProtocolTypeRouter({"http": django_asgi_app, "websocket": build_websocket_app()})
```

- [ ] **Step 6: The publisher**

`backend/realtime/publish.py`:
```python
"""Live updates (staff foundations F2). Every ActivityEvent is published on
commit (activity.services.on_recorded). Two kinds of message travel:

* a feed event {type: "activity", verb, target, actor, at, invalidate} — only
  to staff who could read that event through GET /api/activity/;
* an invalidation {type: "invalidate", invalidate, at} — to permission and
  person groups whose lists changed. It names React Query keys only; the
  client refetches through the normal permission-checked REST endpoints.
"""
import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

logger = logging.getLogger(__name__)

STAFF_MANAGEMENT_VERBS = (
    "staff-invite", "staff-resend-invite", "staff-suspend", "staff-unsuspend",
    "staff-deactivate", "staff-reactivate", "staff-permissions", "staff-manager",
)
# (verb prefixes, permissions whose holders' queues changed, query keys)
QUEUE_INVALIDATIONS = [
    (("kyc-",), ("kyc.approve",), ("kyc-queue", "kyc-detail", "staff-badges")),
    (("moderation-",), ("listings.moderate",), ("moderation-queue", "staff-badges")),
    (("hero-moderation-",), ("hero_media.approve",), ("hero-moderation-queue", "staff-badges")),
    (("event-moderation-",), ("event.approve",), ("event-moderation-queue", "event-moderation-detail", "staff-badges")),
    (("review-approve", "review-hide"), ("reviews.moderate",), ("reviews-moderation-queue", "staff-badges")),
    (("contact-message",), ("contact_messages.manage",), ("contact-messages-queue", "staff-badges")),
    (("staff-conversation-",), ("messaging.manage",), ("staff-messaging-queue",)),
    (STAFF_MANAGEMENT_VERBS, ("staff.manage", "staff.invite_team"), ("staff-roster", "my-team")),
]
# (verb prefixes, extra keys for everyone who receives the feed event)
FEED_KEYS = [
    (("task-",), ("my-tasks", "staff-badges")),
    (("call-",), ("call-logs",)),
    (("approval.",), ("approvals", "approval", "approval-counts", "staff-badges")),
    (("report.",), ("my-reports", "report", "team-reports")),
]
APPROVAL_KEYS = ["approvals", "approval", "approval-counts", "staff-badges"]
REPORT_KEYS = ["my-reports", "report", "team-reports"]


def _send(group, payload):
    async_to_sync(get_channel_layer().group_send)(group, {"type": "staff.event", "payload": payload})


def feed_recipients(event):
    """Staff ids who may read `event` through GET /api/activity/ — the rules
    of activity.views.visible_events, evaluated for one event."""
    from accounts.models import StaffUser
    from accounts.permissions import staff_holding
    from activity.models import ActivityEvent
    from activity.views import ROLE_ACTIVITY_VISIBILITY

    ids = set(staff_holding("activity.view_all").values_list("pk", flat=True))
    if event.actor_type != ActivityEvent.STAFF or event.actor_id is None:
        return ids
    ids.add(event.actor_id)
    manager_id = StaffUser.objects.filter(pk=event.actor_id).values_list("manager_id", flat=True).first()
    if manager_id and staff_holding("activity.view_team").filter(pk=manager_id).exists():
        ids.add(manager_id)
    overseers = [
        role for role, rule in ROLE_ACTIVITY_VISIBILITY.items()
        if event.actor_role in rule.get("roles", [])
        or event.verb.startswith(tuple(rule.get("partial", {}).get(event.actor_role, [])))
    ]
    if overseers:
        ids.update(
            staff_holding("activity.view_domains").filter(role__name__in=overseers).values_list("pk", flat=True)
        )
    return ids


def _approval_groups(event):
    from approvals.models import ApprovalRequest

    if event.target_type != "approvals.approvalrequest" or not event.target_id.isdigit():
        return []
    approval = ApprovalRequest.objects.select_related("maker").filter(pk=event.target_id).first()
    if approval is None:
        return []
    groups = {f"staff.{approval.maker_id}", "perm.approvals.view_all"}
    if approval.maker.manager_id:
        groups.add(f"staff.{approval.maker.manager_id}")
    if approval.assigned_to_id:
        groups.add(f"staff.{approval.assigned_to_id}")
    if approval.stage == ApprovalRequest.POOL and approval.pool_permission:
        groups.add(f"perm.{approval.pool_permission}")
    return sorted(groups)


def _report_groups(event):
    from reports.models import StaffReport

    if event.target_type != "reports.staffreport" or not event.target_id.isdigit():
        return []
    report = StaffReport.objects.select_related("staff").filter(pk=event.target_id).first()
    if report is None:
        return []
    groups = {f"staff.{report.staff_id}", "perm.reports.view_all"}
    if report.staff.manager_id:
        groups.add(f"staff.{report.staff.manager_id}")
    return sorted(groups)


def publish_activity(event):
    at = event.occurred_at.isoformat()
    keys = ["activity"]
    for prefixes, extra in FEED_KEYS:
        if event.verb.startswith(prefixes):
            keys += [key for key in extra if key not in keys]
    feed = {
        "type": "activity",
        "verb": event.verb,
        "target": {"type": event.target_type, "id": event.target_id, "label": event.target_label},
        "actor": {"id": event.actor_id, "name": event.actor_label, "role": event.actor_role},
        "at": at,
        "invalidate": keys,
    }
    for staff_id in sorted(feed_recipients(event)):
        _send(f"staff.{staff_id}", feed)
    for prefixes, codenames, query_keys in QUEUE_INVALIDATIONS:
        if event.verb.startswith(prefixes):
            for codename in codenames:
                _send(f"perm.{codename}", {"type": "invalidate", "invalidate": list(query_keys), "at": at})
    if event.verb.startswith("approval."):
        for group in _approval_groups(event):
            _send(group, {"type": "invalidate", "invalidate": APPROVAL_KEYS, "at": at})
    if event.verb.startswith("report."):
        for group in _report_groups(event):
            _send(group, {"type": "invalidate", "invalidate": REPORT_KEYS, "at": at})


def force_disconnect(group):
    """Ask every socket in `group` to reconnect (and so re-check access)."""
    try:
        async_to_sync(get_channel_layer().group_send)(group, {"type": "force.disconnect"})
    except Exception:  # Redis down: sockets are already gone or will re-check
        logger.exception("Could not force-disconnect %s", group)


def force_disconnect_on_commit(group):
    transaction.on_commit(lambda: force_disconnect(group))
```

- [ ] **Step 7: The ticket endpoint**

`backend/realtime/views.py`:
```python
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts import sessions
from accounts.permissions import IsStaff

from . import tickets


class RealtimeTicketView(APIView):
    """POST /api/realtime/ticket/ — a single-use, 30-second ticket for
    wss://<api>/ws/staff/?ticket=… Staff only."""

    # Fetching a ticket changes nothing; recording each reconnect would flood
    # the activity log.
    activity_exempt = True

    def get_permissions(self):
        return [IsStaff()]

    def post(self, request):
        ticket = tickets.issue_ticket(request.user, sessions.current(request))
        return Response({"ticket": ticket, "expires_in": tickets.TICKET_TTL})
```
`backend/realtime/urls.py`:
```python
from django.urls import path

from . import views

urlpatterns = [path("ticket/", views.RealtimeTicketView.as_view(), name="realtime-ticket")]
```
In `backend/ashantihub/urls.py`, after the `api/reports/` line:
```python
    path("api/realtime/", include("realtime.urls")),
```
In `backend/activity/middleware.py`, at the top of `process_view`, before the method check:
```python
        if getattr(getattr(view_func, "cls", None), "activity_exempt", False):
            return None
```

- [ ] **Step 8: Sockets follow access changes**

In `backend/accounts/sessions.py` replace `revoke` and `revoke_all` with:
```python
def _disconnect_sessions(session_ids):
    # Imported here: realtime imports accounts.
    from realtime.publish import force_disconnect_on_commit

    for session_id in session_ids:
        force_disconnect_on_commit(f"session.{session_id}")


def revoke(session, reason):
    ended = StaffSession.objects.filter(pk=session.pk, revoked_at__isnull=True).update(
        revoked_at=timezone.now(), revoked_reason=reason
    )
    if ended:
        _disconnect_sessions([session.pk])
    return ended


def revoke_all(staff, reason, *, except_session=None):
    live = StaffSession.objects.filter(staff=staff, revoked_at__isnull=True)
    if except_session is not None:
        live = live.exclude(pk=except_session.pk)
    ids = list(live.values_list("pk", flat=True))
    ended = StaffSession.objects.filter(pk__in=ids).update(revoked_at=timezone.now(), revoked_reason=reason)
    _disconnect_sessions(ids)
    return ended
```
In `backend/accounts/views.py` add `from realtime.publish import force_disconnect_on_commit` to the imports. In `StaffPermissionsView.post`, after `staff.revoked_permissions.set(revoke_perms)`, and in `StaffManagerView.post`, after `staff.save(update_fields=["manager"])`, add:
```python
        # Their socket's permission and team groups are now wrong: reconnect.
        force_disconnect_on_commit(f"staff.{staff.pk}")
```

- [ ] **Step 9: Run the tests**

```bash
$BT run --rm web python manage.py test --noinput realtime
$BT run --rm web python manage.py test --noinput accounts activity approvals reports core
```
Expected: OK.

- [ ] **Step 10: Commit**

```bash
git add backend
git commit -m "feat(staff): live updates — ticketed staff WebSocket, permission-scoped groups, activity publisher"
```

---
### Task 11: Staff shell — per-role menus, live-updates client, idle and session-ended sign-out

**Files:**
- Modify: `frontend/components/admin/shell/navModel.js` (rewrite: `NAV_ITEMS`, `DEFAULT_GROUPS`, `ROLE_MENUS`)
- Modify: `frontend/components/admin/shell/__tests__/navModel.test.js`
- Create: `frontend/lib/realtime.js`, `frontend/lib/__tests__/realtime.test.js`
- Create: `frontend/lib/signOutReason.js`
- Create: `frontend/hooks/useRealtime.js`, `frontend/hooks/useIdleSignOut.js`, `frontend/hooks/__tests__/useIdleSignOut.test.jsx`
- Create: `frontend/components/admin/shell/LiveUpdatesIndicator.jsx`, `frontend/components/admin/shell/__tests__/LiveUpdates.test.jsx`
- Modify: `frontend/components/admin/shell/StaffHeader.jsx` (`status` prop), `frontend/components/admin/AdminCommandCenter.jsx`
- Modify: `frontend/apiClient.js` (export `API_BASE_URL`, `SESSION_ENDED_EVENT`), `frontend/apiClient.test.js`
- Modify: `frontend/App.jsx` (`AuthModal`: signed-out notice)
- Modify: `frontend/mocks/handlers.js` (realtime ticket default)

**Interfaces:**
- Consumes: Task 10 (`POST /api/realtime/ticket/`, `wss://<api>/ws/staff/?ticket=`, message shapes), Task 2 (401 for ended sessions).
- Produces:
  - `navModel.js`: `NAV_ITEMS` (catalogue `{id, icon, label, show(auth)}`), `buildNavGroups(auth)` (per-role via `auth.user.role`, unknown role → the original grouping, unplaced permitted items → group `more` "More tools"), `BADGE_KEY_BY_TAB`, `makeBadgeFor`, `isPermittedTab`, `pickBottomBarItems` (unchanged signatures). Menus already place the ids later tasks add: `approvals`, `reports`, `team-reports`, `security`, `sessions` — an id not in `NAV_ITEMS` is skipped.
  - `lib/realtime.js`: `BACKOFF_MS`, `PAUSED_AFTER_MS`, `realtimeUrl(apiBase, ticket)`, `createRealtimeClient({apiBase, getTicket, onInvalidate, onEvent?, onStatus?, createSocket?}) -> {start, stop, getStatus}`
  - `hooks/useRealtime.js`: `useRealtime(enabled = true) -> {live, paused}`
  - `hooks/useIdleSignOut.js`: `IDLE_LIMIT_MS`, `useIdleSignOut(onIdle, {limitMs?, enabled?})`
  - `lib/signOutReason.js`: `noteSignedOutReason(reason)`, `takeSignedOutMessage() -> string | null`, `SIGNED_OUT_MESSAGES`
  - `apiClient.js`: `API_BASE_URL`, `SESSION_ENDED_EVENT = 'ashantihub:session-ended'` (fired on a 401 when a session was stored)
  - `StaffHeader` prop `status` (rendered on every breakpoint); `LiveUpdatesIndicator({paused})`

- [ ] **Step 1: Write the failing nav tests**

Append to `frontend/components/admin/shell/__tests__/navModel.test.js` (and add `NAV_ITEMS` to its import from `'../navModel.js'`):
```javascript
describe('per-role menus', () => {
  const authAs = (role, perms) => ({ user: { role }, hasPermission: (c) => perms.includes(c) })
  const groupOf = (groups, itemId) => groups.find((g) => g.items.some((i) => i.id === itemId))?.label

  it("places an Operations lead's tools in the groups from the design canvas", () => {
    const groups = buildNavGroups(authAs('operations', ['kyc.approve', 'listings.moderate', 'calls.log', 'staff.invite_team', 'site_settings.manage', 'messaging.manage']))
    expect(groupOf(groups, 'kyc')).toBe('Moderation')
    expect(groupOf(groups, 'my-team')).toBe('People')
    expect(groupOf(groups, 'messaging')).toBe('Service')
    expect(groupOf(groups, 'activity')).toBe('Staff activity')
    expect(groupOf(groups, 'calls')).toBe('My work')
    expect(groupOf(groups, 'site-settings')).toBe('Settings')
  })

  it('gives support an Inbox, Calls and Queues', () => {
    const groups = buildNavGroups(authAs('support', ['messaging.manage', 'calls.log', 'reviews.moderate', 'users.view']))
    expect(groupOf(groups, 'messaging')).toBe('Inbox')
    expect(groupOf(groups, 'calls')).toBe('Calls')
    expect(groupOf(groups, 'reviews')).toBe('Queues')
    expect(groupOf(groups, 'users')).toBe('People')
  })

  it("puts a granted tool the role's menu doesn't place under More tools", () => {
    const groups = buildNavGroups(authAs('support', ['messaging.manage', 'analytics.view']))
    expect(groupOf(groups, 'analytics')).toBe('More tools')
    expect(groups.at(-1).id).toBe('more')
  })

  it('shows every permitted item exactly once and no empty group, for every role', () => {
    for (const role of ['super_admin', 'operations', 'accountant', 'marketing', 'support', 'scout', 'delivery_manager', 'dispatch']) {
      const groups = buildNavGroups({ user: { role }, hasPermission: () => true })
      const ids = groups.flatMap((g) => g.items.map((i) => i.id))
      expect(new Set(ids).size).toBe(ids.length)
      expect([...ids].sort()).toEqual(NAV_ITEMS.map((i) => i.id).sort())
      expect(groups.every((g) => g.items.length > 0)).toBe(true)
    }
  })

  it('keeps the original grouping for a session without a known role', () => {
    const groups = buildNavGroups({ user: { role: 'not-a-role' }, hasPermission: () => true })
    expect(groups.map((g) => g.id)).toEqual(['moderation', 'finance', 'users-roles', 'field-ops', 'content', 'system', 'my-work'])
  })
})
```
Run: `cd frontend && npx vitest run components/admin/shell/__tests__/navModel.test.js`
Expected: FAIL — `NAV_ITEMS` is not exported.

- [ ] **Step 2: Rewrite the nav model**

Replace `frontend/components/admin/shell/navModel.js` with:
```javascript
// The staff side menu. NAV_ITEMS is every panel the shell can open; each
// role's menu (ROLE_MENUS) only places ids into the groups drawn on the
// approved staff design canvases (2026-10-07). Canvas items whose screens
// don't exist yet are simply not listed — the phase that builds a screen adds
// it to NAV_ITEMS and the menus. An id a menu lists but NAV_ITEMS lacks is
// skipped, and anything a staffer may open that their role's menu doesn't
// place (an individual grant) lands in "More tools", so a permission never
// loses its screen.
//
// Every id, label and permission check below is byte-for-byte what
// StaffDashboard.test.jsx relies on; only the grouping varies by role.
export const NAV_ITEMS = [
  { id: "kyc", icon: "🪪", label: "KYC Queue", show: (auth) => auth.hasPermission("kyc.approve") },
  { id: "moderation", icon: "📋", label: "Listings Moderation", show: (auth) => auth.hasPermission("listings.moderate") },
  { id: "hero", icon: "🌟", label: "Hero Approval", show: (auth) => auth.hasPermission("hero_media.approve") },
  { id: "events-moderation", icon: "🎉", label: "Events Moderation", show: (auth) => auth.hasPermission("event.approve") },
  { id: "reviews", icon: "⭐", label: "Reviews", show: (auth) => auth.hasPermission("reviews.moderate") },
  { id: "event-pricing", icon: "💵", label: "Event Pricing", show: (auth) => auth.hasPermission("event_pricing.manage") || auth.hasPermission("event_pricing.approve") },
  { id: "subscription-plans", icon: "💳", label: "Subscription Plans", show: (auth) => auth.hasPermission("subscription_plans.manage") },
  { id: "subscription-plans-approval", icon: "✅", label: "Plan Approvals", show: (auth) => auth.hasPermission("subscription_plans.approve") },
  { id: "escrow", icon: "💰", label: "Escrow Ledger", show: (auth) => auth.hasPermission("escrow.view") || auth.hasPermission("escrow.release") || auth.hasPermission("escrow.refund") },
  { id: "disputes", icon: "⚖️", label: "Disputes", show: (auth) => auth.hasPermission("disputes.resolve_financial") || auth.hasPermission("disputes.flag") },
  { id: "transactions", icon: "📈", label: "Transactions Report", show: (auth) => auth.hasPermission("transactions.report") },
  { id: "credit", icon: "💳", label: "Credit & Lending", show: (auth) => auth.hasPermission("credit.manage") },
  { id: "users", icon: "👥", label: "Users", show: (auth) => auth.hasPermission("users.view") },
  { id: "staff", icon: "🛡️", label: "Staff Management", show: (auth) => auth.hasPermission("staff.manage") },
  { id: "scout-assignments", icon: "🧭", label: "Scout Assignments", show: (auth) => auth.hasPermission("scouts.assign") },
  { id: "field-verification", icon: "📋", label: "Field Verification", show: (auth) => auth.hasPermission("scouts.verify") },
  { id: "delivery-coordination", icon: "🚚", label: "Delivery Coordination", show: (auth) => auth.hasPermission("delivery.manage") },
  { id: "my-deliveries", icon: "📦", label: "My Deliveries", show: (auth) => auth.hasPermission("delivery.dispatch") },
  { id: "categories-zones", icon: "🗂️", label: "Categories & Zones", show: (auth) => auth.hasPermission("categories.manage") || auth.hasPermission("zones.manage") },
  { id: "promotions", icon: "🎯", label: "Promotions", show: (auth) => auth.hasPermission("promotions.manage") },
  { id: "site-settings", icon: "🧭", label: "Site Settings", show: (auth) => auth.hasPermission("site_settings.manage") },
  { id: "delivery", icon: "🚚", label: "Delivery Management", show: (auth) => auth.hasPermission("orders.manage_delivery") },
  { id: "contact-messages", icon: "✉️", label: "Contact Messages", show: (auth) => auth.hasPermission("contact_messages.manage") },
  { id: "messaging", icon: "💬", label: "Messaging / Tickets", show: (auth) => auth.hasPermission("messaging.manage") },
  { id: "analytics", icon: "📊", label: "Analytics", show: (auth) => auth.hasPermission("analytics.view") },
  { id: "tasks", icon: "✅", label: "Tasks", show: () => true },
  { id: "calls", icon: "📞", label: "Call Log", show: (auth) => auth.hasPermission("calls.log") },
  { id: "activity", icon: "🕘", label: "Activity", show: () => true },
  { id: "my-team", icon: "👥", label: "My Team", show: (auth) => auth.hasPermission("staff.invite_team") },
];

// [group id, group label, item ids]. The original (pre-1B) grouping, used for
// any session whose role has no menu below.
const DEFAULT_GROUPS = [
  ["moderation", "Moderation", ["kyc", "moderation", "hero", "events-moderation", "reviews"]],
  ["finance", "Finance", ["event-pricing", "subscription-plans", "subscription-plans-approval", "escrow", "disputes", "transactions", "credit"]],
  ["users-roles", "Users & Roles", ["users", "staff", "sessions"]],
  ["field-ops", "Field Operations", ["scout-assignments", "field-verification", "delivery-coordination", "my-deliveries"]],
  ["content", "Content", ["categories-zones", "promotions", "site-settings"]],
  ["system", "System", ["delivery", "contact-messages", "messaging", "analytics"]],
  ["my-work", "My Work", ["approvals", "tasks", "calls", "reports", "team-reports", "activity", "my-team", "security"]],
];

// Per-role menus from the approved design canvases. A group label never
// repeats an item label (e.g. the canvas's "Approvals" group is "Decisions"
// here) so a label always names exactly one thing on screen.
const ROLE_MENUS = {
  super_admin: [
    ["home", "Home", ["approvals"]],
    ["people", "People", ["staff", "my-team", "sessions"]],
    ["teams", "Teams (step in)", ["scout-assignments", "field-verification", "delivery-coordination", "my-deliveries"]],
    ["marketplace", "Marketplace", ["users", "kyc", "moderation", "hero", "events-moderation", "reviews", "delivery", "disputes", "messaging", "contact-messages"]],
    ["money", "Money", ["transactions", "escrow", "credit"]],
    ["insights", "Insights", ["analytics", "reports", "team-reports"]],
    ["security-audit", "Security & audit", ["activity"]],
    ["settings", "Settings", ["subscription-plans", "subscription-plans-approval", "event-pricing", "promotions", "categories-zones", "site-settings"]],
    ["my-work", "My work", ["tasks", "calls", "security"]],
  ],
  operations: [
    ["decisions", "Decisions", ["approvals"]],
    ["people", "People", ["my-team", "scout-assignments", "field-verification"]],
    ["moderation", "Moderation", ["kyc", "moderation", "hero", "events-moderation", "reviews"]],
    ["service", "Service", ["messaging", "disputes", "delivery"]],
    ["oversight", "Staff activity", ["activity"]],
    ["reports", "Reports", ["reports", "team-reports"]],
    ["my-work", "My work", ["tasks", "calls", "security"]],
    ["settings", "Settings", ["categories-zones", "site-settings", "contact-messages"]],
  ],
  accountant: [
    ["decisions", "Decisions", ["approvals"]],
    ["money-in", "Money in", ["escrow"]],
    ["controls", "Controls", ["disputes", "transactions"]],
    ["plans-pricing", "Plans & pricing", ["subscription-plans", "subscription-plans-approval", "event-pricing", "credit"]],
    ["reports", "Reports", ["reports", "team-reports"]],
    ["my-work", "My work", ["tasks", "activity", "security"]],
  ],
  marketing: [
    ["decisions", "Decisions", ["approvals"]],
    ["moderation", "Moderation", ["hero", "events-moderation", "promotions"]],
    ["insights", "Insights", ["analytics"]],
    ["settings", "Settings", ["categories-zones"]],
    ["reports", "Reports", ["reports"]],
    ["my-work", "My work", ["tasks", "activity", "security"]],
  ],
  support: [
    ["inbox", "Inbox", ["messaging"]],
    ["calls", "Calls", ["calls"]],
    ["queues", "Queues", ["contact-messages", "reviews", "disputes", "delivery"]],
    ["people", "People", ["users"]],
    ["my-work", "My work", ["approvals", "tasks", "activity", "security"]],
    ["reports", "Reports", ["reports"]],
  ],
  scout: [
    ["field", "Field", ["field-verification"]],
    ["calls", "Calls", ["calls"]],
    ["my-work", "My work", ["approvals", "tasks", "activity", "security"]],
    ["reports", "Reports", ["reports"]],
  ],
  delivery_manager: [
    ["live", "Live", ["delivery-coordination", "delivery"]],
    ["issues", "Issues", ["disputes"]],
    ["fleet", "Fleet", ["my-team"]],
    ["planning", "Planning", ["categories-zones"]],
    ["my-work", "My work", ["approvals", "tasks", "calls", "activity", "security"]],
    ["reports", "Reports", ["reports", "team-reports"]],
  ],
  dispatch: [
    ["jobs", "Jobs", ["my-deliveries"]],
    ["my-work", "My work", ["approvals", "tasks", "activity", "security"]],
    ["reports", "Reports", ["reports"]],
  ],
};

const ITEM_BY_ID = Object.fromEntries(NAV_ITEMS.map((item) => [item.id, item]));
const toNavItem = ({ id, icon, label }) => ({ id, icon, label });

export function buildNavGroups(auth) {
  const layout = ROLE_MENUS[auth.user?.role] || DEFAULT_GROUPS;
  const placed = new Set();
  const groups = layout.map(([id, label, itemIds]) => {
    const items = [];
    for (const itemId of itemIds) {
      const item = ITEM_BY_ID[itemId];
      if (!item || placed.has(itemId) || !item.show(auth)) continue;
      placed.add(itemId);
      items.push(toNavItem(item));
    }
    return { id, label, items };
  });
  const leftovers = NAV_ITEMS.filter((item) => !placed.has(item.id) && item.show(auth)).map(toNavItem);
  if (leftovers.length) groups.push({ id: "more", label: "More tools", items: leftovers });
  return groups.filter((group) => group.items.length > 0);
}

// Maps a nav item id → the key it reads from GET /api/notifications/
// staff-badges/ (item 10). Only tabs with genuine pending work appear here;
// a count > 0 renders a small badge next to that tab's label so staff see at
// a glance which tabs need attention. The badges query polls every 60s (see
// useStaffBadges) so newly-arrived work surfaces without a manual reload;
// live updates (lib/realtime.js) refresh it sooner when a socket is up.
export const BADGE_KEY_BY_TAB = {
  kyc: "kyc",
  tasks: "tasks_overdue",
  moderation: "listings",
  hero: "hero",
  "events-moderation": "events",
  reviews: "reviews",
  "subscription-plans-approval": "plan_approvals",
  "contact-messages": "contact_messages",
  escrow: "escrow",
};

// Badge lookup for a tab id against the GET /api/notifications/staff-badges/
// payload — 0 for tabs with no badge key or no data yet.
export function makeBadgeFor(staffBadges) {
  return (tabId) => {
    const key = BADGE_KEY_BY_TAB[tabId];
    return key ? (staffBadges?.[key] || 0) : 0;
  };
}

// Overview has no permission gate; every other tab must be one of the
// session's permitted nav items. Used to send unpermitted /staff/:panel URLs
// (or manifest shortcuts) back to Overview.
export function isPermittedTab(navGroups, tabId) {
  return tabId === "overview" || navGroups.some((group) => group.items.some((item) => item.id === tabId));
}

// Phone bottom-bar slots (spec §4.3): panels with pending work first, then
// the rest — both in nav order, never sorted by count, so icons only move
// when a queue empties or fills, not on every 60s badge poll.
export function pickBottomBarItems(navGroups, badgeFor, slots = 3) {
  const items = navGroups.flatMap((group) => group.items);
  const withWork = items.filter((item) => badgeFor(item.id) > 0);
  const rest = items.filter((item) => !(badgeFor(item.id) > 0));
  return [...withWork, ...rest].slice(0, slots);
}
```
Run the nav test again. Expected: PASS (the existing 1A nav tests too — `my-work` still holds `tasks, activity` for an empty permission set).

- [ ] **Step 3: Write the failing realtime-client tests**

`frontend/lib/__tests__/realtime.test.js`:
```javascript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BACKOFF_MS, PAUSED_AFTER_MS, createRealtimeClient, realtimeUrl } from '../realtime.js'

class FakeSocket {
  constructor(url) { this.url = url; this.closed = false; FakeSocket.all.push(this) }
  open() { this.onopen?.() }
  push(data) { this.onmessage?.({ data: JSON.stringify(data) }) }
  drop() { this.onclose?.() }
  close() { this.closed = true }
}

const failing = (status) => vi.fn(async () => { throw Object.assign(new Error(String(status)), { status }) })

function setup(getTicket = vi.fn(async () => 'tkt')) {
  const invalidated = []
  const client = createRealtimeClient({
    apiBase: 'https://api.example.com',
    getTicket,
    createSocket: (url) => new FakeSocket(url),
    onInvalidate: (keys) => invalidated.push(...keys),
  })
  return { client, invalidated, getTicket }
}

beforeEach(() => { vi.useFakeTimers(); FakeSocket.all = [] })
afterEach(() => vi.useRealTimers())

describe('realtimeUrl', () => {
  it('turns the API origin into a ws(s) URL carrying the ticket', () => {
    expect(realtimeUrl('https://api.example.com', 'a b')).toBe('wss://api.example.com/ws/staff/?ticket=a%20b')
    expect(realtimeUrl('http://localhost:8000/', 't')).toBe('ws://localhost:8000/ws/staff/?ticket=t')
  })
})

describe('createRealtimeClient', () => {
  it('connects with a fresh ticket and goes live', async () => {
    const { client } = setup()
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(FakeSocket.all[0].url).toBe('wss://api.example.com/ws/staff/?ticket=tkt')
    FakeSocket.all[0].open()
    expect(client.getStatus()).toEqual({ live: true, paused: false })
    client.stop()
  })

  it('hands invalidate keys to the query cache', async () => {
    const { client, invalidated } = setup()
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    FakeSocket.all[0].open()
    FakeSocket.all[0].push({ type: 'invalidate', invalidate: ['kyc-queue', 'staff-badges'], at: 'now' })
    FakeSocket.all[0].push({ type: 'activity', verb: 'kyc-approve', target: {}, actor: {}, at: 'now', invalidate: ['activity'] })
    expect(invalidated).toEqual(['kyc-queue', 'staff-badges', 'activity'])
    client.stop()
  })

  it('reconnects with backoff after the socket drops', async () => {
    const { client, getTicket } = setup()
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    FakeSocket.all[0].open()
    FakeSocket.all[0].drop()
    expect(client.getStatus().live).toBe(false)
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0] - 1)
    expect(FakeSocket.all).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(FakeSocket.all).toHaveLength(2)
    FakeSocket.all[1].drop()
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[1])
    expect(FakeSocket.all).toHaveLength(3)
    expect(getTicket).toHaveBeenCalledTimes(3)
    client.stop()
  })

  it('says "paused" only after 30 seconds without a live socket, and clears it once live', async () => {
    let up = false
    const getTicket = vi.fn(async () => {
      if (!up) throw Object.assign(new Error('503'), { status: 503 })
      return 'tkt'
    })
    const { client } = setup(getTicket)
    client.start()
    await vi.advanceTimersByTimeAsync(PAUSED_AFTER_MS - 1)
    expect(client.getStatus().paused).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(client.getStatus().paused).toBe(true)
    up = true
    await vi.advanceTimersByTimeAsync(BACKOFF_MS.at(-1))
    FakeSocket.all.at(-1).open()
    expect(client.getStatus()).toEqual({ live: true, paused: false })
    client.stop()
  })

  it('stops for good when the session has ended', async () => {
    const getTicket = failing(401)
    const { client } = setup(getTicket)
    client.start()
    await vi.advanceTimersByTimeAsync(60000)
    expect(getTicket).toHaveBeenCalledTimes(1)
    expect(client.getStatus().paused).toBe(false)
  })

  it('reconnects promptly when the server asks it to', async () => {
    const { client } = setup()
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    FakeSocket.all[0].open()
    FakeSocket.all[0].drop()
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0])
    FakeSocket.all[1].open()
    FakeSocket.all[1].push({ type: 'force_disconnect' })
    FakeSocket.all[1].drop()
    await vi.advanceTimersByTimeAsync(BACKOFF_MS[0])
    expect(FakeSocket.all).toHaveLength(3)
    client.stop()
  })

  it('stop() closes the socket and cancels every retry', async () => {
    const { client } = setup()
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    FakeSocket.all[0].open()
    client.stop()
    expect(FakeSocket.all[0].closed).toBe(true)
    FakeSocket.all[0].drop()
    await vi.advanceTimersByTimeAsync(60000)
    expect(FakeSocket.all).toHaveLength(1)
  })
})
```
Run: `cd frontend && npx vitest run lib/__tests__/realtime.test.js`
Expected: FAIL — cannot resolve `../realtime.js`.

- [ ] **Step 4: The realtime client**

`frontend/lib/realtime.js`:
```javascript
// Live updates for the staff shell (staff foundations F2/F10). Trades the
// signed-in token for a single-use ticket, opens wss://<api>/ws/staff/,
// reconnects with backoff and hands every `invalidate` list to the caller
// (useRealtime → React Query invalidateQueries). The 60-second polling runs
// regardless; after 30 s without a live socket the status reports `paused`
// so the header can say so.
export const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000]
export const PAUSED_AFTER_MS = 30000

export function realtimeUrl(apiBase, ticket) {
  const origin = apiBase.replace(/\/+$/, '').replace(/^http/, 'ws')
  return `${origin}/ws/staff/?ticket=${encodeURIComponent(ticket)}`
}

export function createRealtimeClient({
  apiBase, getTicket, onInvalidate, onEvent = () => {}, onStatus = () => {},
  createSocket = (url) => new WebSocket(url),
}) {
  let stopped = true
  let socket = null
  let attempt = 0
  let retryTimer = null
  let pauseTimer = null
  let status = { live: false, paused: false }

  const emit = (patch) => {
    const next = { ...status, ...patch }
    if (next.live === status.live && next.paused === status.paused) return
    status = next
    onStatus(status)
  }
  const armPause = () => {
    if (pauseTimer !== null || status.paused) return
    pauseTimer = setTimeout(() => { pauseTimer = null; emit({ paused: true }) }, PAUSED_AFTER_MS)
  }
  const clearPause = () => {
    if (pauseTimer !== null) { clearTimeout(pauseTimer); pauseTimer = null }
  }
  const scheduleRetry = () => {
    if (stopped) return
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
    attempt += 1
    retryTimer = setTimeout(() => { retryTimer = null; connect() }, delay)
  }
  const down = () => {
    socket = null
    emit({ live: false })
    armPause()
    scheduleRetry()
  }

  async function connect() {
    if (stopped) return
    let ticket
    try {
      ticket = await getTicket()
    } catch (error) {
      // 401/403: the session is over; apiClient's 401 handling signs out.
      if (error?.status === 401 || error?.status === 403) { stop(); return }
      down()
      return
    }
    if (stopped) return
    const ws = createSocket(realtimeUrl(apiBase, ticket))
    socket = ws
    ws.onopen = () => {
      if (socket !== ws) return
      attempt = 0
      clearPause()
      emit({ live: true, paused: false })
    }
    ws.onmessage = (message) => {
      let data
      try { data = JSON.parse(message.data) } catch { return }
      // The server closes right after this; reconnect without backing off.
      if (data?.type === 'force_disconnect') { attempt = 0; return }
      if (Array.isArray(data?.invalidate) && data.invalidate.length) onInvalidate(data.invalidate)
      if (data?.type === 'activity') onEvent(data)
    }
    ws.onerror = () => {} // onclose follows
    ws.onclose = () => { if (socket === ws) down() }
  }

  function start() {
    if (!stopped) return
    stopped = false
    armPause()
    connect()
  }

  function stop() {
    stopped = true
    clearPause()
    if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null }
    const ws = socket
    socket = null
    if (ws) {
      ws.onclose = null
      try { ws.close() } catch { /* already closed */ }
    }
  }

  return { start, stop, getStatus: () => status }
}
```
Run the realtime test again. Expected: PASS.

- [ ] **Step 5: Write the failing idle, indicator and session-ended tests**

`frontend/hooks/__tests__/useIdleSignOut.test.jsx`:
```javascript
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIdleSignOut } from '../useIdleSignOut.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useIdleSignOut', () => {
  it('signs out after 30 minutes without input, once', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleSignOut(onIdle))
    act(() => { vi.advanceTimersByTime(29 * 60 * 1000) })
    act(() => { window.dispatchEvent(new Event('keydown')) })
    act(() => { vi.advanceTimersByTime(29 * 60 * 1000) })
    expect(onIdle).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(2 * 60 * 1000) })
    expect(onIdle).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(60 * 60 * 1000) })
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it('checks straight away when a sleeping tab comes back', () => {
    const onIdle = vi.fn()
    renderHook(() => useIdleSignOut(onIdle))
    act(() => {
      vi.setSystemTime(Date.now() + 31 * 60 * 1000)
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(onIdle).toHaveBeenCalledTimes(1)
  })
})
```
`frontend/components/admin/shell/__tests__/LiveUpdates.test.jsx`:
```javascript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SESSION_ENDED_EVENT } from '../../../../apiClient.js'
import { AuthModal } from '../../../../App.jsx'
import { noteSignedOutReason } from '../../../../lib/signOutReason.js'
import AdminCommandCenter from '../../AdminCommandCenter.jsx'
import LiveUpdatesIndicator from '../LiveUpdatesIndicator.jsx'

const auth = {
  user: { token: 't', account_type: 'staff', id: 1, full_name: 'Esi Nyarko', role: 'support', permissions: [] },
  hasPermission: () => false,
}

describe('live updates in the staff shell', () => {
  it('shows "Live updates paused" only when paused', () => {
    const { rerender } = render(<LiveUpdatesIndicator paused={false} />)
    expect(screen.queryByText('Live updates paused')).not.toBeInTheDocument()
    rerender(<LiveUpdatesIndicator paused />)
    expect(screen.getByRole('status')).toHaveTextContent('Live updates paused')
  })

  it('signs out when the server says the session has ended', () => {
    const onExit = vi.fn()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><AdminCommandCenter auth={auth} onExit={onExit} /></QueryClientProvider>)
    act(() => { window.dispatchEvent(new Event(SESSION_ENDED_EVENT)) })
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(sessionStorage.getItem('ashantihub.signedOutReason')).toBe('ended')
  })

  it('the staff sign-in explains an idle sign-out, once', () => {
    noteSignedOutReason('idle')
    const fakeAuth = { login: vi.fn(), requestPasswordReset: vi.fn() }
    const { unmount } = render(<AuthModal authState="staff-login" auth={fakeAuth} onClose={() => {}} onSuccess={() => {}} />)
    expect(screen.getByText('You were signed out after 30 minutes without activity.')).toBeInTheDocument()
    unmount()
    render(<AuthModal authState="staff-login" auth={fakeAuth} onClose={() => {}} onSuccess={() => {}} />)
    expect(screen.queryByText('You were signed out after 30 minutes without activity.')).not.toBeInTheDocument()
  })
})
```
Append to `frontend/apiClient.test.js` (add `SESSION_ENDED_EVENT` to its import from `'./apiClient.js'` and `vi` to the vitest import):
```javascript
describe('session-ended event', () => {
  it('fires on a 401 only when a session was stored', async () => {
    const heard = vi.fn()
    window.addEventListener(SESSION_ENDED_EVENT, heard)
    server.use(http.get('http://localhost:8000/api/accounts/me/', () => new HttpResponse(null, { status: 401 })))
    setStoredAuth({ token: 'expired', account_type: 'staff', id: 1, full_name: 'Esi' })
    await expect(apiFetch('/api/accounts/me/')).rejects.toMatchObject({ status: 401 })
    await expect(apiFetch('/api/accounts/me/')).rejects.toMatchObject({ status: 401 })
    expect(heard).toHaveBeenCalledTimes(1)
    window.removeEventListener(SESSION_ENDED_EVENT, heard)
  })
})
```
Run: `cd frontend && npx vitest run hooks/__tests__/useIdleSignOut.test.jsx components/admin/shell/__tests__/LiveUpdates.test.jsx apiClient.test.js`
Expected: FAIL — modules not found / `SESSION_ENDED_EVENT` undefined.

- [ ] **Step 6: apiClient, sign-out reasons and the hooks**

In `frontend/apiClient.js` change `const API_BASE_URL = …` to `export const API_BASE_URL = …`, add under `AUTH_STORAGE_KEY`:
```javascript
// Fired when the API answers 401 for a signed-in session (an ended, idle or
// expired staff session, or a revoked token). The staff shell listens and
// signs out to the staff sign-in instead of failing panel by panel.
export const SESSION_ENDED_EVENT = 'ashantihub:session-ended'
```
and replace the first block of `handleResponse` with:
```javascript
  if (response.status === 401) {
    const hadSession = Boolean(getStoredAuth())
    setStoredAuth(null)
    if (hadSession && typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_ENDED_EVENT))
  }
```
`frontend/lib/signOutReason.js`:
```javascript
// Why the staff shell signed someone out, carried across the sign-out to the
// staff sign-in form (sessionStorage: this tab only, read once).
const KEY = 'ashantihub.signedOutReason'

export const SIGNED_OUT_MESSAGES = {
  idle: 'You were signed out after 30 minutes without activity.',
  ended: 'Your session ended. Sign in again to carry on.',
}

export function noteSignedOutReason(reason) {
  try { sessionStorage.setItem(KEY, reason) } catch { /* storage unavailable */ }
}

export function takeSignedOutMessage() {
  try {
    const reason = sessionStorage.getItem(KEY)
    sessionStorage.removeItem(KEY)
    return SIGNED_OUT_MESSAGES[reason] || null
  } catch {
    return null
  }
}
```
`frontend/hooks/useIdleSignOut.js`:
```javascript
import { useEffect, useRef } from 'react'

// Staff sessions end after 30 minutes without input (spec F9). The server
// enforces 30 minutes without requests, but background polling keeps a tab
// "requesting", so the browser watches for real input itself.
export const IDLE_LIMIT_MS = 30 * 60 * 1000
const CHECK_EVERY_MS = 15 * 1000
const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart']

export function useIdleSignOut(onIdle, { limitMs = IDLE_LIMIT_MS, enabled = true } = {}) {
  const onIdleRef = useRef(onIdle)
  useEffect(() => { onIdleRef.current = onIdle }, [onIdle])

  useEffect(() => {
    if (!enabled) return undefined
    let lastInput = Date.now()
    let fired = false
    const mark = () => { lastInput = Date.now() }
    const check = () => {
      if (!fired && Date.now() - lastInput >= limitMs) {
        fired = true
        onIdleRef.current?.()
      }
    }
    INPUT_EVENTS.forEach((name) => window.addEventListener(name, mark, { passive: true }))
    document.addEventListener('visibilitychange', check)
    const timer = setInterval(check, CHECK_EVERY_MS)
    return () => {
      INPUT_EVENTS.forEach((name) => window.removeEventListener(name, mark))
      document.removeEventListener('visibilitychange', check)
      clearInterval(timer)
    }
  }, [enabled, limitMs])
}
```
`frontend/hooks/useRealtime.js`:
```javascript
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { API_BASE_URL, apiPost } from '../apiClient.js'
import { createRealtimeClient } from '../lib/realtime.js'

// The staff shell's live connection: each server `invalidate` key refetches
// every query whose key starts with it, through the normal REST endpoints.
export function useRealtime(enabled = true) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState({ live: false, paused: false })
  useEffect(() => {
    if (!enabled) return undefined
    const client = createRealtimeClient({
      apiBase: API_BASE_URL,
      getTicket: () => apiPost('/api/realtime/ticket/', {}).then((data) => data.ticket),
      onInvalidate: (keys) => keys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      onStatus: setStatus,
    })
    client.start()
    return () => client.stop()
  }, [enabled, queryClient])
  return status
}
```

- [ ] **Step 7: The indicator, the header slot and the shell wiring**

`frontend/components/admin/shell/LiveUpdatesIndicator.jsx`:
```javascript
import { D } from "../theme.js";

// "Live updates paused" (spec F2): only after 30 s without a live socket.
// Lists still refresh every minute meanwhile, so it informs, not alarms.
export default function LiveUpdatesIndicator({ paused }) {
  if (!paused) return null;
  return (
    <span role="status" title="Reconnecting. Lists still refresh every minute."
      style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${D.amber}`, borderRadius: 999, padding: "3px 10px", fontSize: "0.66rem", fontWeight: 700, color: D.text, background: "#fff", whiteSpace: "nowrap" }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: D.amber }} />
      Live updates paused
    </span>
  );
}
```
In `frontend/components/admin/shell/StaffHeader.jsx` add `status` to the destructured props (after `actions`) and render it first in the right-hand cluster, on every breakpoint:
```javascript
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
          {status}
          {actions}
```
In `frontend/components/admin/AdminCommandCenter.jsx`:
- change the React import to `import { useCallback, useEffect, useRef, useState } from "react";` and add:
```javascript
import { SESSION_ENDED_EVENT } from "../../apiClient.js";
import { useIdleSignOut } from "../../hooks/useIdleSignOut.js";
import { useRealtime } from "../../hooks/useRealtime.js";
import { noteSignedOutReason } from "../../lib/signOutReason.js";
import LiveUpdatesIndicator from "./shell/LiveUpdatesIndicator.jsx";
```
- after `const showToast = …` add:
```javascript
  const live = useRealtime();
  // Idle (30 min without input) and "the server ended this session" both
  // sign out through the normal staff sign-out, which clears cached data.
  const onExitRef = useRef(onExit);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);
  const signOutBecause = useCallback((reason) => {
    noteSignedOutReason(reason);
    onExitRef.current?.();
  }, []);
  useIdleSignOut(() => signOutBecause("idle"));
  useEffect(() => {
    const ended = () => signOutBecause("ended");
    window.addEventListener(SESSION_ENDED_EVENT, ended);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, ended);
  }, [signOutBecause]);
```
- pass the indicator to the header: add `status={<LiveUpdatesIndicator paused={live.paused} />}` to `<StaffHeader … />`.

- [ ] **Step 8: The sign-in notice and the MSW default**

In `frontend/App.jsx` add `import { takeSignedOutMessage } from "./lib/signOutReason.js";` next to the other `./lib/` imports. In `AuthModal`, after `const [submitting,setSubmitting]=useState(false);` add:
```javascript
  // Why the staff shell just signed this tab out (idle / session ended); read once.
  const [signedOutNotice]=useState(()=>lockedAccountType ? takeSignedOutMessage() : null);
```
and directly above `{error && <div …>{error}</div>}` add:
```javascript
        {signedOutNotice && <div role="status" style={{background:C.cream,border:`1px solid ${C.gold}`,color:C.darkBrown,borderRadius:10,padding:"10px 12px",marginBottom:14,fontSize:"0.78rem"}}>{signedOutNotice}</div>}
```
In `frontend/mocks/handlers.js` add next to the staff defaults:
```javascript
  // The staff shell asks for a live-updates ticket on mount; answering 503
  // keeps every test off real WebSockets (the client just retries later).
  http.post('http://localhost:8000/api/realtime/ticket/', () => HttpResponse.json({ detail: 'Live updates are off in tests.' }, { status: 503 })),
```

- [ ] **Step 9: Run the frontend suite**

```bash
cd frontend && npx vitest run 2>&1 | tail -8
```
Expected: all pass, `StaffDashboard.test.jsx` unchanged.

- [ ] **Step 10: Commit**

```bash
git add frontend
git commit -m "feat(staff): per-role staff menus, live-updates client and idle / ended-session sign-out"
```

---
### Task 12: Approvals inbox and request detail

**Files:**
- Create: `frontend/hooks/useApprovals.js`, `frontend/lib/timeAgo.js`
- Create: `frontend/components/admin/panels/ApprovalsPanel.jsx`, `frontend/components/admin/panels/__tests__/ApprovalsPanel.test.jsx`
- Modify: `frontend/components/admin/shell/navModel.js` (`approvals` item, badge key), `frontend/components/admin/shell/__tests__/navModel.test.js`
- Modify: `frontend/components/admin/AdminCommandCenter.jsx` (detail state, render the panel)
- Modify: `frontend/App.jsx` (`/staff/:panel/:detail`; `StaffDashboard` passes `activeDetail`)
- Modify: `frontend/App.routing.test.jsx`
- Modify: `frontend/mocks/handlers.js`

**Interfaces:**
- Consumes: Task 6 (`/api/approvals/…`, badge `approvals_waiting`), Task 11 (menus already place `approvals`).
- Produces:
  - hooks: `useApprovals(box, status = '')` → DRF page (key `['approvals', box, status]`); `useApprovalCounts()` → `{mine, made, team, decided, can_view_all}` (key `['approval-counts']`); `useApproval(id)` → detail (key `['approval', String(id)]`)
  - `lib/timeAgo.js`: `formatDuration(ms)`, `timeAgo(iso, now?)`, `describeWait(dueIso, now?)`
  - `ApprovalsPanel({ detailId, onOpenDetail })` — inbox when `detailId` is null, else the request; `onOpenDetail(id | null)`
  - nav id `approvals` ("Approvals", every staffer), badge key `approvals → approvals_waiting`
  - routing: `/staff/approvals/<id>` opens the request (notification links `approvals/<id>` land here); `AdminCommandCenter` props gain `activeDetail`; `onTabChange("approvals/<id>")` navigates there
  - `StaffDashboard({auth, onExit, onViewSite, activeTab, activeDetail, onTabChange})`

- [ ] **Step 1: Write the failing tests**

`frontend/components/admin/panels/__tests__/ApprovalsPanel.test.jsx`:
```javascript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ApprovalsPanel from '../ApprovalsPanel.jsx'

const HOUR = 3600 * 1000
const STALE = 'This changed since it was requested — ask for a fresh request.'

const approval = (overrides = {}) => ({
  id: 7, kind: 'business.update', kind_label: 'Business info change', title: 'Adwoa Fabrics', status: 'pending',
  stage: 'manager', maker: { id: 3, full_name: 'Kwame Asante', role: 'scout' },
  assigned_to: { id: 2, full_name: 'Ama Boateng', role: 'operations' }, pool_permission: 'kyc.approve',
  target: { type: 'accounts.businessowner', id: '5', label: 'Adwoa Fabrics' }, maker_note: 'The owner changed her phone',
  decided_by: null, decided_at: null, decision_note: '', due_at: new Date(Date.now() + 19 * HOUR).toISOString(),
  escalation_level: 0, created_at: new Date(Date.now() - 5 * HOUR).toISOString(), can_decide: true, can_cancel: false,
  ...overrides,
})
const detail = (overrides = {}) => ({
  ...approval(), payload: { phone: '0554000402' }, before: { phone: '0244000118' },
  diff: [{ field: 'phone', before: '0244000118', after: '0554000402' }], stale: false, ...overrides,
})

function renderPanel(props = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <ApprovalsPanel detailId={null} onOpenDetail={() => {}} {...props} />
    </QueryClientProvider>,
  )
}

describe('ApprovalsPanel inbox', () => {
  it('shows counts on the boxes and opens a waiting request', async () => {
    const onOpenDetail = vi.fn()
    server.use(
      http.get('http://localhost:8000/api/approvals/counts/', () => HttpResponse.json({ mine: 1, made: 0, team: 1, decided: 0, can_view_all: false })),
      http.get('http://localhost:8000/api/approvals/', () => HttpResponse.json({ count: 1, next: null, previous: null, results: [approval()] })),
    )
    renderPanel({ onOpenDetail })
    expect(await screen.findByText('Adwoa Fabrics')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Waiting for me · 1' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /Everything/ })).not.toBeInTheDocument()
    expect(screen.getByText(/moves on in 1[89] h/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Adwoa Fabrics' }))
    expect(onOpenDetail).toHaveBeenCalledWith(7)
  })

  it('asks for the box the user picks and says honestly when it is empty', async () => {
    let lastUrl = ''
    server.use(http.get('http://localhost:8000/api/approvals/', ({ request }) => {
      lastUrl = request.url
      return HttpResponse.json({ count: 0, next: null, previous: null, results: [] })
    }))
    renderPanel()
    expect(await screen.findByText(/Nothing is waiting for your decision/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Made by me' }))
    await waitFor(() => expect(lastUrl).toContain('box=made'))
    expect(await screen.findByText(/You haven't asked for any approvals/)).toBeInTheDocument()
  })
})

describe('ApprovalsPanel request', () => {
  it('shows what would change and approves it with a note', async () => {
    let body = null
    server.use(
      http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail())),
      http.post('http://localhost:8000/api/approvals/7/approve/', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json(detail({ status: 'approved', can_decide: false }))
      }),
    )
    renderPanel({ detailId: '7' })
    expect(await screen.findByRole('table', { name: 'What would change' })).toBeInTheDocument()
    expect(screen.getByText('0244000118')).toBeInTheDocument()
    expect(screen.getByText('0554000402')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Note to Kwame Asante/), { target: { value: 'Checked with the owner' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(body).toEqual({ note: 'Checked with the owner' }))
  })

  it('needs a note to return a request', async () => {
    let returned = null
    server.use(
      http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail())),
      http.post('http://localhost:8000/api/approvals/7/reject/', async ({ request }) => {
        returned = await request.json()
        return HttpResponse.json(detail({ status: 'rejected', can_decide: false }))
      }),
    )
    renderPanel({ detailId: '7' })
    const returnButton = await screen.findByRole('button', { name: 'Return with note' })
    expect(returnButton).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Note to Kwame Asante/), { target: { value: 'Ask the owner for a photo' } })
    fireEvent.click(returnButton)
    await waitFor(() => expect(returned).toEqual({ note: 'Ask the owner for a photo' }))
  })

  it('blocks approving a request whose target changed', async () => {
    server.use(http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail({ stale: true }))))
    renderPanel({ detailId: '7' })
    expect(await screen.findByText(STALE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  })

  it("tells the maker they can't approve their own request and lets them cancel", async () => {
    let cancelled = false
    server.use(
      http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail({ can_decide: false, can_cancel: true }))),
      http.post('http://localhost:8000/api/approvals/7/cancel/', () => { cancelled = true; return HttpResponse.json(detail({ status: 'cancelled', can_cancel: false })) }),
    )
    renderPanel({ detailId: '7' })
    expect(await screen.findByText("You can't approve your own requests.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(cancelled).toBe(true))
  })

  it('shows the server reason when a decision is refused', async () => {
    server.use(
      http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail())),
      http.post('http://localhost:8000/api/approvals/7/approve/', () => HttpResponse.json({ detail: STALE }, { status: 409 })),
    )
    renderPanel({ detailId: '7' })
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(STALE)
  })

  it('goes back to the inbox', async () => {
    const onOpenDetail = vi.fn()
    server.use(http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json(detail())))
    renderPanel({ detailId: '7', onOpenDetail })
    fireEvent.click(await screen.findByRole('button', { name: '← Approvals' }))
    expect(onOpenDetail).toHaveBeenCalledWith(null)
  })
})
```
Append to the `describe('AshantiHub routing — /staff/:panel', …)` block in `frontend/App.routing.test.jsx`:
```javascript
  it('/staff/approvals/<id> opens that request, and Back returns to the inbox URL', async () => {
    signInStaff(['messaging.manage'])
    server.use(http.get('http://localhost:8000/api/approvals/7/', () => HttpResponse.json({
      id: 7, kind: 'business.update', kind_label: 'Business info change', title: 'Adwoa Fabrics', status: 'pending',
      stage: 'manager', maker: { id: 3, full_name: 'Kwame Asante', role: 'scout' }, assigned_to: null, pool_permission: '',
      target: { type: '', id: '', label: '' }, maker_note: '', decided_by: null, decided_at: null, decision_note: '',
      due_at: '2030-01-01T00:00:00Z', escalation_level: 0, created_at: '2026-10-07T06:46:00Z', can_decide: false,
      can_cancel: false, payload: {}, before: {}, diff: [], stale: false,
    })))
    renderStaffAt('/staff/approvals/7')
    expect(await screen.findByRole('table', { name: 'What would change' }, { timeout: 3000 })).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe('/staff/approvals/7')
    fireEvent.click(screen.getByRole('button', { name: '← Approvals' }))
    expect(screen.getByTestId('location').textContent).toBe('/staff/approvals')
  }, 8000)
```
Update the 1A "My Work group" expectations in `navModel.test.js` (Approvals is now on every staffer's menu):
```javascript
  it('gives every staffer Approvals, Tasks and Activity', () => {
    expect(myWork([]).items.map((i) => i.id)).toEqual(['approvals', 'tasks', 'activity'])
  })

  it('adds Call Log and My Team for the permissions that unlock them', () => {
    expect(myWork(['calls.log', 'staff.invite_team']).items.map((i) => i.id)).toEqual(['approvals', 'tasks', 'calls', 'activity', 'my-team'])
  })
```
and add:
```javascript
  it('maps the approvals badge to approvals_waiting', () => {
    expect(makeBadgeFor({ approvals_waiting: 4 })('approvals')).toBe(4)
  })
```
Run: `cd frontend && npx vitest run components/admin/panels/__tests__/ApprovalsPanel.test.jsx components/admin/shell/__tests__/navModel.test.js`
Expected: FAIL — `ApprovalsPanel.jsx` not found; nav lacks `approvals`.

- [ ] **Step 2: Nav item, badge and MSW defaults**

In `navModel.js` add to `NAV_ITEMS`, directly before the `tasks` entry:
```javascript
  { id: "approvals", icon: "🗳️", label: "Approvals", show: () => true },
```
and `approvals: "approvals_waiting",` to `BADGE_KEY_BY_TAB`. In `frontend/mocks/handlers.js` add:
```javascript
  http.get('http://localhost:8000/api/approvals/', () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
  http.get('http://localhost:8000/api/approvals/counts/', () => HttpResponse.json({ mine: 0, made: 0, team: 0, decided: 0, can_view_all: false })),
```
and `approvals_waiting: 0,` to the staff-badges default object.

- [ ] **Step 3: Hooks and time helpers**

`frontend/hooks/useApprovals.js`:
```javascript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/approvals/?box= — a DRF page; read data?.results.
// box: mine | made | team | decided | all (all = Super Admin only).
export function useApprovals(box = 'mine', status = '') {
  const query = new URLSearchParams(Object.entries({ box, status }).filter(([, v]) => v)).toString()
  return useQuery({ queryKey: ['approvals', box, status], queryFn: () => apiFetch(`/api/approvals/?${query}`) })
}

// GET /api/approvals/counts/ — {mine, made, team, decided, can_view_all}.
export function useApprovalCounts() {
  return useQuery({ queryKey: ['approval-counts'], queryFn: () => apiFetch('/api/approvals/counts/') })
}

// GET /api/approvals/<id>/ — one request with its before/after diff.
export function useApproval(id) {
  return useQuery({
    queryKey: ['approval', String(id)],
    queryFn: () => apiFetch(`/api/approvals/${id}/`),
    enabled: id != null,
  })
}
```
`frontend/lib/timeAgo.js`:
```javascript
// Compact durations for staff screens: "40 min", "5 h", "3 d".
export function formatDuration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000))
  if (minutes < 1) return 'under a minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.floor(hours / 24)} d`
}

export function timeAgo(iso, now = Date.now()) {
  return formatDuration(now - new Date(iso).getTime())
}

// A pending approval's clock: when it moves to the next approver, or how
// long it has been overdue.
export function describeWait(dueIso, now = Date.now()) {
  const left = new Date(dueIso).getTime() - now
  return left >= 0 ? `moves on in ${formatDuration(left)}` : `overdue by ${formatDuration(-left)}`
}
```

- [ ] **Step 4: The panel**

`frontend/components/admin/panels/ApprovalsPanel.jsx`:
```javascript
import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useApproval, useApprovalCounts, useApprovals } from "../../../hooks/useApprovals.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { describeWait, timeAgo } from "../../../lib/timeAgo.js";
import { D, glassCard } from "../theme.js";

const BOXES = [
  ["mine", "Waiting for me"],
  ["made", "Made by me"],
  ["team", "My team's"],
  ["decided", "Decided by me"],
  ["all", "Everything"],
];
const EMPTY = {
  mine: "Nothing is waiting for your decision.",
  made: "You haven't asked for any approvals.",
  team: "Nobody in your team has asked for an approval.",
  decided: "You haven't decided any requests yet.",
  all: "There are no approval requests yet.",
};
const STATUS = {
  pending: ["Waiting", D.amber],
  approved: ["Approved", D.green],
  rejected: ["Returned", D.red],
  cancelled: ["Cancelled", D.textFaint],
  expired: ["Expired", D.textFaint],
};
const dim = { color: D.textDim, fontSize: "0.75rem" };
const chip = (color) => ({ background: `${color}1f`, color: D.text, border: `1px solid ${color}55`, borderRadius: 999, padding: "2px 9px", fontSize: "0.66rem", fontWeight: 800, whiteSpace: "nowrap" });
const pill = (active) => ({ background: active ? D.text : "transparent", color: active ? "#fff" : D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "6px 12px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const button = (bg, color, disabled) => ({ background: bg, color, border: bg === "#fff" ? `1px solid ${D.cardBorder}` : "none", borderRadius: 10, padding: "8px 14px", fontSize: "0.8rem", fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "inherit" });
const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: "#fff", resize: "vertical" };
const show = (value) => (value === null || value === undefined || value === "" ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value));
const roleName = (role) => (role || "").replace("_", " ");

function stageText(a) {
  if (a.stage === "manager") return `With ${a.assigned_to?.full_name || "their manager"}`;
  if (a.stage === "pool") return "With anyone who can approve this";
  return "With a Super Admin";
}

// /staff/approvals (inbox) and /staff/approvals/<id> (one request).
export default function ApprovalsPanel({ detailId, onOpenDetail }) {
  if (detailId != null) return <ApprovalRequest id={detailId} onBack={() => onOpenDetail(null)} />;
  return <ApprovalsInbox onOpen={(id) => onOpenDetail(id)} />;
}

function ApprovalsInbox({ onOpen }) {
  const [box, setBox] = useState("mine");
  const { data: counts } = useApprovalCounts();
  const { data, isLoading, isError } = useApprovals(box);
  const rows = data?.results || [];
  const label = (id, text) => (counts?.[id] ? `${text} · ${counts[id]}` : text);
  const boxes = BOXES.filter(([id]) => id !== "all" || counts?.can_view_all);
  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Approvals</div>
      <div role="group" aria-label="Which requests" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {boxes.map(([id, text]) => (
          <button key={id} type="button" aria-pressed={box === id} onClick={() => setBox(id)} style={pill(box === id)}>{label(id, text)}</button>
        ))}
      </div>
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load approvals.</div>}
      {!isLoading && !isError && rows.length === 0 && (
        <div style={dim}>{EMPTY[box]} Requests appear here when a change needs someone else's approval.</div>
      )}
      {rows.map((a) => (
        <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "10px 0", borderTop: `1px solid ${D.divider}`, flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 260px" }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <span style={chip(D.blue)}>{a.kind_label}</span>
              <span style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>{a.title}</span>
            </div>
            <div style={{ ...dim, marginTop: 2 }}>
              {a.maker.full_name} · {roleName(a.maker.role)} · {timeAgo(a.created_at)} ago · {a.status === "pending" ? describeWait(a.due_at) : (STATUS[a.status]?.[0] || a.status)}
            </div>
          </div>
          <button type="button" aria-label={`Open ${a.title}`} onClick={() => onOpen(a.id)} style={button("#fff", D.text)}>Open</button>
        </div>
      ))}
    </div>
  );
}

function ApprovalRequest({ id, onBack }) {
  const { data: a, isLoading, isError, refetch } = useApproval(id);
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  const act = async (action, body) => {
    setActionError(null);
    setBusy(true);
    try {
      await apiPost(`/api/approvals/${id}/${action}/`, body);
      setNote("");
      refetch();
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not save the decision."));
    } finally {
      setBusy(false);
    }
  };

  const back = <button type="button" onClick={onBack} style={{ ...button("#fff", D.text), alignSelf: "flex-start" }}>← Approvals</button>;
  const card = { ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 };
  if (isLoading) return <div style={card}>{back}<div style={dim}>Loading…</div></div>;
  if (isError || !a) return <div style={card}>{back}<div style={{ color: D.red, fontSize: "0.8rem" }}>This request doesn't exist, or isn't one you can see.</div></div>;

  const [statusLabel, statusColor] = STATUS[a.status] || [a.status, D.textDim];
  return (
    <div style={card}>
      {back}
      <div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span style={chip(D.blue)}>{a.kind_label}</span>
          <span style={chip(statusColor)}>{statusLabel}</span>
        </div>
        <h2 style={{ color: D.text, fontSize: "1.05rem", margin: "8px 0 4px" }}>{a.title}</h2>
        <div style={dim}>Made by {a.maker.full_name} · {roleName(a.maker.role)} · {new Date(a.created_at).toLocaleString("en-GH")} ({timeAgo(a.created_at)} ago)</div>
        {a.status === "pending" && <div style={dim}>{stageText(a)} · {describeWait(a.due_at)}</div>}
        {a.target.label && <div style={dim}>About: {a.target.label}</div>}
      </div>
      {a.maker_note && <div style={{ background: D.panelBg2, borderRadius: 10, padding: "8px 12px", color: D.text, fontSize: "0.8rem" }}>“{a.maker_note}”</div>}
      <table aria-label="What would change" style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.8rem", fontVariantNumeric: "tabular-nums" }}>
        <thead>
          <tr style={{ color: D.textDim, textAlign: "left" }}>
            <th style={{ padding: "6px 8px" }}>Field</th><th style={{ padding: "6px 8px" }}>Now</th><th style={{ padding: "6px 8px" }}>After approval</th>
          </tr>
        </thead>
        <tbody>
          {a.diff.map((row) => (
            <tr key={row.field || "value"} style={{ borderTop: `1px solid ${D.divider}`, color: D.text }}>
              <td style={{ padding: "6px 8px", fontWeight: 700 }}>{row.field.replace(/_/g, " ")}</td>
              <td style={{ padding: "6px 8px" }}>{show(row.before)}</td>
              <td style={{ padding: "6px 8px" }}>{show(row.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {a.stale && <div role="alert" style={{ color: D.red, fontWeight: 700, fontSize: "0.8rem" }}>This changed since it was requested — ask for a fresh request.</div>}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      {a.can_decide && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text }}>
            Note to {a.maker.full_name} (required to return)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={field} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={busy || a.stale} onClick={() => act("approve", { note })} style={button(D.green, "#fff", busy || a.stale)}>Approve</button>
            <button type="button" disabled={busy || !note.trim()} onClick={() => act("reject", { note })} style={button("#fff", D.red, busy || !note.trim())}>Return with note</button>
          </div>
        </div>
      )}
      {a.status === "pending" && a.can_cancel && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={dim}>You can't approve your own requests.</span>
          <button type="button" disabled={busy} onClick={() => act("cancel", {})} style={button("#fff", D.text, busy)}>Cancel request</button>
        </div>
      )}
      {a.status !== "pending" && a.decided_by && (
        <div style={dim}>{statusLabel} by {a.decided_by.full_name} on {new Date(a.decided_at).toLocaleString("en-GH")}{a.decision_note ? `: “${a.decision_note}”` : ""}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: `/staff/approvals/<id>` routing**

In `frontend/App.jsx` replace the two lines
```javascript
  const staffPanelMatch = useMatch("/staff/:panel");
  const staffPanel = staffPanelMatch && !STAFF_STANDALONE_PAGES.has(staffPanelMatch.params.panel) ? staffPanelMatch.params.panel : null;
```
with
```javascript
  const staffPanelMatch = useMatch("/staff/:panel");
  // /staff/:panel/:detail — one record inside a panel, e.g. /staff/approvals/12
  // (notification links deep-link here; the panel re-checks access on load).
  const staffDetailMatch = useMatch("/staff/:panel/:detail");
  const staffPanelParam = (staffPanelMatch || staffDetailMatch)?.params.panel;
  const staffPanel = staffPanelParam && !STAFF_STANDALONE_PAGES.has(staffPanelParam) ? staffPanelParam : null;
  const staffDetail = staffPanel && staffDetailMatch ? staffDetailMatch.params.detail : null;
```
Pass `activeDetail={staffDetail}` to `<StaffDashboard …>` (next to `activeTab=`), and change `StaffDashboard` to:
```javascript
export function StaffDashboard({auth,onExit,onViewSite,activeTab,activeDetail,onTabChange}) {
  return <AdminCommandCenter auth={auth} onExit={onExit} onViewSite={onViewSite} activeTab={activeTab} activeDetail={activeDetail} onTabChange={onTabChange} />;
}
```
In `frontend/components/admin/AdminCommandCenter.jsx`:
- add `activeDetail` to the destructured props;
- after `const [internalTab, setInternalTab] = useState("overview");` add:
```javascript
  // A record inside the active panel (e.g. one approval): from the
  // /staff/:panel/:detail URL when controlled, local state otherwise.
  const [internalDetail, setInternalDetail] = useState(null);
  const detail = isControlled ? (activeDetail ?? null) : internalDetail;
```
- replace `selectTab` with:
```javascript
  const selectTab = (id) => {
    setDrawerOpen(false);
    if (id === activeTab && detail == null) return;
    setInternalDetail(null);
    if (isControlled) onTabChange?.(id);
    else setInternalTab(id);
  };
  const openDetail = (id) => {
    if (isControlled) onTabChange?.(id == null ? activeTab : `${activeTab}/${id}`);
    else setInternalDetail(id);
  };
```
- import the panel (`import ApprovalsPanel from "./panels/ApprovalsPanel.jsx";`) and render it after the `my-team` line:
```javascript
          {activeTab === "approvals" && <ApprovalsPanel detailId={detail} onOpenDetail={openDetail} />}
```

- [ ] **Step 6: Run the frontend suite**

```bash
cd frontend && npx vitest run 2>&1 | tail -8
```
Expected: all pass, `StaffDashboard.test.jsx` unchanged.

- [ ] **Step 7: Commit**

```bash
git add frontend
git commit -m "feat(staff): approvals inbox and request screen with /staff/approvals/<id> links"
```

---
### Task 13: My Reports (composer, history, exports) and Team Reports

**Files:**
- Create: `frontend/hooks/useReports.js`
- Create: `frontend/components/admin/panels/reportParts.jsx`, `frontend/components/admin/panels/ReportsPanel.jsx`, `frontend/components/admin/panels/TeamReportsPanel.jsx`
- Create: `frontend/components/admin/panels/__tests__/ReportsPanel.test.jsx`, `frontend/components/admin/panels/__tests__/TeamReportsPanel.test.jsx`
- Modify: `frontend/apiClient.js` (`apiDownload`: error body, 202 → JSON)
- Modify: `frontend/components/admin/shell/navModel.js` (`reports`, `team-reports`), `frontend/components/admin/shell/__tests__/navModel.test.js`
- Modify: `frontend/components/admin/AdminCommandCenter.jsx`, `frontend/mocks/handlers.js`

**Interfaces:**
- Consumes: Tasks 8–9 (`/api/reports/…` payloads and exports), Task 11 (menus place `reports`, `team-reports`).
- Produces:
  - hooks: `useCurrentReport(period, date)` (key `['report', 'current', period, date]`), `useMyReports(period)` (key `['my-reports', period]`, DRF page), `useTeamReports(period, date, scope)` (key `['team-reports', period, date, scope]`), `useReport(id)` (key `['report', String(id)]`), `useReportExports()` (key `['report-exports']`)
  - `reportParts.jsx`: `PERIODS`, `STATUS_META`, `localISODate(date?)`, `StatusChip`, `SystemSections({sections, live})`, `ReportNarrative({report})`, `ExportButtons({path, stem, onError})`
  - `ReportsPanel({ auth })`, `TeamReportsPanel({ auth })`
  - nav ids `reports` ("My Reports", everyone) and `team-reports` ("Team Reports", `staff.invite_team` or `reports.view_all`)
  - `apiDownload(path, filename)` resolves to the JSON body when the server answers 202 (queued), and throws errors carrying `.body`
  - URLs: `/staff/reports` and `/staff/team-reports` (the spec's `/staff/reports/team` would read as a record id under the Task 12 detail route, and the canvas menus list "My reports" and "My team" as separate items)
  - `linked_targets` stays API-only: the composer offers no picker yet, because the records it links (businesses, cases, targets) arrive in phase 2 — no placeholder picker is shown

- [ ] **Step 1: Write the failing tests**

`frontend/components/admin/panels/__tests__/ReportsPanel.test.jsx`:
```javascript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import ReportsPanel from '../ReportsPanel.jsx'

const sections = [
  { key: 'activity', title: 'Activity', rows: [{ label: 'Actions recorded', value: 4 }, { label: 'kyc-approve', value: 2 }] },
  { key: 'calls', title: 'Calls', rows: [{ label: 'Calls logged', value: 3 }] },
]
const report = (overrides = {}) => ({
  id: null, staff: { id: 3, full_name: 'Kwame Asante', role: 'scout' }, period: 'day', period_start: '2026-10-07',
  period_end: '2026-10-07', status: 'draft', submitted_at: null, is_late: false, due_at: '2026-10-07T19:00:00Z',
  achievements: '', blockers: '', plan_next: [], plan_results: [{ item: 'Visit Ejisu', result: '' }], linked_targets: [],
  reviewer: null, reviewed_at: null, review_note: '', similarity: 0, similar_warning: false, can_edit: true,
  can_review: false, system_is_live: true, system: sections, ...overrides,
})
const auth = { user: { id: 3, role: 'scout' }, hasPermission: () => false }

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><ReportsPanel auth={auth} /></QueryClientProvider>)
}
const current = (body) => http.get('http://localhost:8000/api/reports/current/', () => HttpResponse.json(body))

describe('ReportsPanel', () => {
  it("shows the locked system numbers and the previous plan to mark", async () => {
    server.use(current(report()))
    renderPanel()
    expect(await screen.findByText('Calls logged')).toBeInTheDocument()
    expect(screen.getByText('kyc approve')).toBeInTheDocument()
    expect(screen.getByLabelText('Result for "Visit Ejisu"')).toBeInTheDocument()
  })

  it('saves the draft, then submits it', async () => {
    const calls = []
    server.use(
      current(report()),
      http.post('http://localhost:8000/api/reports/', async ({ request }) => { calls.push(await request.json()); return HttpResponse.json(report({ id: 12 })) }),
      http.post('http://localhost:8000/api/reports/12/submit/', () => { calls.push('submit'); return HttpResponse.json(report({ id: 12, status: 'submitted', can_edit: false })) }),
    )
    renderPanel()
    fireEvent.change(await screen.findByLabelText('What went well'), { target: { value: 'Registered Kejetia Beads' } })
    fireEvent.change(screen.getByLabelText('Plan line 1'), { target: { value: 'Visit Bonwire' } })
    fireEvent.change(screen.getByLabelText('Result for "Visit Ejisu"'), { target: { value: 'partly' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[0]).toMatchObject({
      period: 'day', date: '2026-10-07', achievements: 'Registered Kejetia Beads',
      plan_next: ['Visit Bonwire'], plan_results: [{ item: 'Visit Ejisu', result: 'partly' }],
    })
    expect(calls[1]).toBe('submit')
  })

  it('warns when the narrative reads like an earlier report', async () => {
    server.use(current(report({ id: 12, achievements: 'Same as always', similar_warning: true, similarity: 0.91 })))
    renderPanel()
    expect(await screen.findByText(/reads a lot like one of your last five reports/)).toBeInTheDocument()
  })

  it('locks a submitted report', async () => {
    server.use(current(report({ id: 12, status: 'submitted', can_edit: false, achievements: 'Done', system_is_live: false })))
    renderPanel()
    expect(await screen.findByLabelText('What went well')).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
  })

  it('shows a returned report with the reviewer note, editable again', async () => {
    server.use(current(report({ id: 12, status: 'returned', review_note: 'Which weavers?', reviewer: { id: 2, full_name: 'Ama Boateng', role: 'operations' } })))
    renderPanel()
    expect(await screen.findByText(/Which weavers\?/)).toBeInTheDocument()
    expect(screen.getByLabelText('What went well')).not.toHaveAttribute('readonly')
  })

  it('queues a long export and says the bell will tell them', async () => {
    let url = ''
    server.use(http.get('http://localhost:8000/api/reports/export/', ({ request }) => {
      url = request.url
      return HttpResponse.json({ id: 4, status: 'queued' }, { status: 202 })
    }))
    renderPanel()
    fireEvent.change(await screen.findByLabelText('From'), { target: { value: '2026-08-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-07' } })
    fireEvent.click(screen.getByRole('button', { name: 'Export reports' }))
    expect(await screen.findByText(/preparing that file/)).toBeInTheDocument()
    expect(url).toContain('from=2026-08-01')
    expect(url).toContain('staff=3')
  })
})
```
`frontend/components/admin/panels/__tests__/TeamReportsPanel.test.jsx`:
```javascript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import TeamReportsPanel from '../TeamReportsPanel.jsx'

const yaws = {
  id: 21, staff: { id: 5, full_name: 'Yaw Owusu', role: 'scout' }, period: 'day', period_start: '2026-10-06',
  period_end: '2026-10-06', status: 'submitted', submitted_at: '2026-10-06T21:12:00Z', is_late: true,
  due_at: '2026-10-06T19:00:00Z', achievements: 'Visited three weavers in Bonwire', blockers: 'Network was poor',
  plan_next: ['Register Bonwire Kente Looms'], plan_results: [], linked_targets: [], reviewer: null, reviewed_at: null,
  review_note: '', similarity: 0.86, similar_warning: true, can_edit: false, can_review: true, system_is_live: false,
}
const team = (rows) => http.get('http://localhost:8000/api/reports/team/', () => HttpResponse.json({ period: 'day', period_start: '2026-10-06', rows }))

function renderPanel(auth = { hasPermission: () => false }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><TeamReportsPanel auth={auth} /></QueryClientProvider>)
}

describe('TeamReportsPanel', () => {
  it('lists the team with its flags and returns a report with a comment', async () => {
    let returned = null
    server.use(
      team([{ staff: yaws.staff, report: yaws }, { staff: { id: 6, full_name: 'Efua Mensah', role: 'scout' }, report: null }]),
      http.get('http://localhost:8000/api/reports/21/', () => HttpResponse.json({ ...yaws, system: [{ key: 'calls', title: 'Calls', rows: [{ label: 'Calls logged', value: 2 }] }] })),
      http.post('http://localhost:8000/api/reports/21/return/', async ({ request }) => {
        returned = await request.json()
        return HttpResponse.json({ ...yaws, status: 'returned', can_review: false })
      }),
    )
    renderPanel()
    expect(await screen.findByText('Not submitted yet')).toBeInTheDocument()
    expect(screen.getByText('Waiting for you · 1')).toBeInTheDocument()
    expect(screen.getByText('Late')).toBeInTheDocument()
    expect(screen.getByText('Copy check 86%')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: "Open Yaw Owusu's report" }))
    expect(await screen.findByText('Visited three weavers in Bonwire')).toBeInTheDocument()
    expect(screen.getByText('Calls logged')).toBeInTheDocument()
    const returnButton = screen.getByRole('button', { name: 'Return with comment' })
    expect(returnButton).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Comment to Yaw Owusu/), { target: { value: 'Which weavers?' } })
    fireEvent.click(returnButton)
    await waitFor(() => expect(returned).toEqual({ note: 'Which weavers?' }))
  })

  it('acknowledges a report', async () => {
    let acknowledged = false
    server.use(
      team([{ staff: yaws.staff, report: yaws }]),
      http.get('http://localhost:8000/api/reports/21/', () => HttpResponse.json({ ...yaws, system: [] })),
      http.post('http://localhost:8000/api/reports/21/acknowledge/', () => { acknowledged = true; return HttpResponse.json({ ...yaws, status: 'acknowledged', can_review: false }) }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: "Open Yaw Owusu's report" }))
    fireEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))
    await waitFor(() => expect(acknowledged).toBe(true))
  })

  it("offers everyone's reports to a Super Admin", async () => {
    let lastUrl = ''
    server.use(http.get('http://localhost:8000/api/reports/team/', ({ request }) => {
      lastUrl = request.url
      return HttpResponse.json({ period: 'day', period_start: '2026-10-07', rows: [] })
    }))
    renderPanel({ hasPermission: (c) => c === 'reports.view_all' })
    fireEvent.click(await screen.findByRole('button', { name: 'Everyone' }))
    await waitFor(() => expect(lastUrl).toContain('scope=all'))
    expect(await screen.findByText('Nobody to show for this period.')).toBeInTheDocument()
  })
})
```
Update the "My Work group" expectations in `navModel.test.js`:
```javascript
  it('gives every staffer Approvals, Tasks, My Reports and Activity', () => {
    expect(myWork([]).items.map((i) => i.id)).toEqual(['approvals', 'tasks', 'reports', 'activity'])
  })

  it('adds Call Log, Team Reports and My Team for the permissions that unlock them', () => {
    expect(myWork(['calls.log', 'staff.invite_team']).items.map((i) => i.id)).toEqual(['approvals', 'tasks', 'calls', 'reports', 'team-reports', 'activity', 'my-team'])
  })
```
(These replace the two Task 12 versions of the same tests.)
Run: `cd frontend && npx vitest run components/admin/panels/__tests__/ReportsPanel.test.jsx components/admin/panels/__tests__/TeamReportsPanel.test.jsx components/admin/shell/__tests__/navModel.test.js`
Expected: FAIL — modules not found; nav lacks `reports`.

- [ ] **Step 2: Nav items, downloads and MSW defaults**

In `navModel.js` add to `NAV_ITEMS`, after the `calls` entry:
```javascript
  { id: "reports", icon: "📝", label: "My Reports", show: () => true },
  { id: "team-reports", icon: "🗂️", label: "Team Reports", show: (auth) => auth.hasPermission("staff.invite_team") || auth.hasPermission("reports.view_all") },
```
In `frontend/apiClient.js` replace `apiDownload` with:
```javascript
// Authenticated file download (the business sales CSV, staff report
// exports): fetches with the auth header — which a plain <a download> can't
// send — and saves the body as `filename`. A 202 means the server queued the
// file to build in the background: nothing is saved and the JSON body
// ({id, status}) is returned instead.
export async function apiDownload(path, filename) {
  const response = await request(path, { headers: authHeaders() })
  if (response.status === 202) return response.json()
  if (!response.ok) {
    let body = null
    try {
      body = await response.clone().json()
    } catch {
      // Not JSON — leave body null.
    }
    const error = new Error(`Download of ${path} failed with status ${response.status}`)
    error.status = response.status
    error.body = body
    throw error
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return null
}
```
In `frontend/mocks/handlers.js` add:
```javascript
  http.get('http://localhost:8000/api/reports/current/', () => HttpResponse.json({
    id: null, staff: { id: 1, full_name: 'Staff', role: 'support' }, period: 'day', period_start: '2026-10-07',
    period_end: '2026-10-07', status: 'draft', submitted_at: null, is_late: false, due_at: '2026-10-07T19:00:00Z',
    achievements: '', blockers: '', plan_next: [], plan_results: [], linked_targets: [], reviewer: null,
    reviewed_at: null, review_note: '', similarity: 0, similar_warning: false, can_edit: true, can_review: false,
    system_is_live: true, system: [],
  })),
  http.get('http://localhost:8000/api/reports/', () => HttpResponse.json({ count: 0, next: null, previous: null, results: [] })),
  http.get('http://localhost:8000/api/reports/team/', () => HttpResponse.json({ period: 'day', period_start: '2026-10-07', rows: [] })),
  http.get('http://localhost:8000/api/reports/exports/', () => HttpResponse.json([])),
```

- [ ] **Step 3: Hooks**

`frontend/hooks/useReports.js`:
```javascript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/reports/current/ — my report for a period: the saved one, or an
// unsaved draft (id null) with live system numbers. A plain object.
export function useCurrentReport(period, date) {
  return useQuery({
    queryKey: ['report', 'current', period, date],
    queryFn: () => apiFetch(`/api/reports/current/?period=${period}&date=${date}`),
  })
}

// GET /api/reports/?period= — my report history, a DRF page (data?.results).
export function useMyReports(period) {
  return useQuery({ queryKey: ['my-reports', period], queryFn: () => apiFetch(`/api/reports/?period=${period}`) })
}

// GET /api/reports/team/ — {period, period_start, rows: [{staff, report|null}]}.
export function useTeamReports(period, date, scope = 'team') {
  const everyone = scope === 'all' ? '&scope=all' : ''
  return useQuery({
    queryKey: ['team-reports', period, date, scope],
    queryFn: () => apiFetch(`/api/reports/team/?period=${period}&date=${date}${everyone}`),
  })
}

// GET /api/reports/<id>/ — one report with its system numbers.
export function useReport(id) {
  return useQuery({ queryKey: ['report', String(id)], queryFn: () => apiFetch(`/api/reports/${id}/`), enabled: id != null })
}

// GET /api/reports/exports/ — my background exports, a plain array.
export function useReportExports() {
  return useQuery({ queryKey: ['report-exports'], queryFn: () => apiFetch('/api/reports/exports/') })
}
```

- [ ] **Step 4: Shared report pieces**

`frontend/components/admin/panels/reportParts.jsx`:
```javascript
import { apiDownload } from "../../../apiClient.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D } from "../theme.js";

export const PERIODS = [["day", "Day"], ["week", "Week"], ["month", "Month"]];
export const STATUS_META = {
  draft: { label: "Draft", color: D.textDim },
  submitted: { label: "Submitted", color: D.blue },
  acknowledged: { label: "Acknowledged", color: D.green },
  returned: { label: "Returned", color: D.amber },
};
const RESULT_TEXT = { done: "Done", partly: "Partly done", not_done: "Not done", "": "Not marked" };
const dim = { color: D.textDim, fontSize: "0.75rem" };
const smallButton = { background: "#fff", color: D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "5px 12px", fontSize: "0.72rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const humanise = (label) => String(label).replace(/[._-]+/g, " ").trim();

// The browser's local date as YYYY-MM-DD (not UTC's).
export function localISODate(date = new Date()) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

export function StatusChip({ status }) {
  const meta = STATUS_META[status] || { label: status, color: D.textDim };
  return <span style={{ background: `${meta.color}1f`, border: `1px solid ${meta.color}55`, color: D.text, borderRadius: 999, padding: "2px 9px", fontSize: "0.66rem", fontWeight: 800 }}>{meta.label}</span>;
}

// "From the system": numbers counted from AshantiHub's records, never typed.
export function SystemSections({ sections, live }) {
  return (
    <section aria-label="From the system" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>From the system</div>
      <div style={dim}>{live ? "Counted from AshantiHub's records and updated until you submit. You can't edit these." : "Frozen when the report was submitted."}</div>
      {(sections || []).length === 0 && <div style={dim}>Nothing recorded for this period.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(200px,100%),1fr))", gap: 10, fontVariantNumeric: "tabular-nums" }}>
        {(sections || []).map((section) => (
          <div key={section.key} style={{ background: D.panelBg2, borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ color: D.text, fontWeight: 700, fontSize: "0.78rem", marginBottom: 4 }}>{section.title}</div>
            {section.rows.map((row) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 8, color: D.text, fontSize: "0.75rem" }}>
                <span>{humanise(row.label)}</span><span style={{ fontWeight: 700 }}>{row.value}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ReportNarrative({ report }) {
  const block = (title, text) => (
    <div>
      <div style={{ color: D.textDim, fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>{title}</div>
      <div style={{ color: D.text, fontSize: "0.82rem", whiteSpace: "pre-wrap" }}>{text || "—"}</div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {report.plan_results.length > 0 && (
        <div>
          <div style={{ color: D.textDim, fontSize: "0.7rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em" }}>Previous plan</div>
          {report.plan_results.map((row) => <div key={row.item} style={{ color: D.text, fontSize: "0.8rem" }}>{row.item}: {RESULT_TEXT[row.result] || row.result}</div>)}
        </div>
      )}
      {block("What went well", report.achievements)}
      {block("What got in the way", report.blockers)}
      {block("Plan", report.plan_next.join("\n"))}
    </div>
  );
}

export function ExportButtons({ path, stem, onError }) {
  const download = async (format) => {
    try {
      await apiDownload(`${path}${path.includes("?") ? "&" : "?"}format=${format}`, `${stem}.${format}`);
    } catch (err) {
      onError?.(apiErrorMessage(err, "Could not export the report."));
    }
  };
  return (
    <div role="group" aria-label="Export" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {[["xlsx", "Excel"], ["csv", "CSV"], ["pdf", "PDF"]].map(([format, label]) => (
        <button key={format} type="button" onClick={() => download(format)} style={smallButton}>{label}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: My Reports**

`frontend/components/admin/panels/ReportsPanel.jsx`:
```javascript
import { useState } from "react";
import { apiDownload, apiPost } from "../../../apiClient.js";
import { useCurrentReport, useMyReports, useReportExports } from "../../../hooks/useReports.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { ExportButtons, PERIODS, StatusChip, SystemSections, localISODate } from "./reportParts.jsx";

const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: "#fff" };
const labelStyle = { display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text };
const dim = { color: D.textDim, fontSize: "0.75rem" };
const pill = (active) => ({ background: active ? D.text : "transparent", color: active ? "#fff" : D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "6px 12px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const button = (bg, color, disabled) => ({ background: bg, color, border: bg === "#fff" ? `1px solid ${D.cardBorder}` : "none", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: "0.8rem", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "inherit" });
const PERIOD_TITLE = { day: "End of day report", week: "Week report", month: "Month report" };
// Orange marks a warning, but small orange text fails contrast, so the text
// stays dark brown inside an orange edge (DESIGN.md: orange = warning).
const warnChip = { color: D.text, background: `${D.amber}1f`, border: `1px solid ${D.amber}`, borderRadius: 999, padding: "1px 8px", fontWeight: 800, fontSize: "0.68rem" };
const warnNote = { color: D.text, background: `${D.amber}14`, border: `1px solid ${D.amber}`, borderRadius: 10, padding: "8px 12px", fontWeight: 700, fontSize: "0.8rem" };
const range = (r) => (r.period_start === r.period_end ? r.period_start : `${r.period_start} to ${r.period_end}`);

export default function ReportsPanel({ auth }) {
  const [period, setPeriod] = useState("day");
  const today = localISODate();
  const { data: report, isLoading, isError, refetch } = useCurrentReport(period, today);
  const { data: history, refetch: refetchHistory } = useMyReports(period);
  const refresh = () => { refetch(); refetchHistory(); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>My reports</div>
          <div role="group" aria-label="Report period" style={{ display: "flex", gap: 6 }}>
            {PERIODS.map(([id, label]) => <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)} style={pill(period === id)}>{label}</button>)}
          </div>
        </div>
        {isLoading && <div style={dim}>Loading…</div>}
        {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your report.</div>}
        {report && <ReportComposer key={period} report={report} period={period} onSaved={refresh} />}
      </div>
      <History rows={history?.results || []} />
      <RangeExport auth={auth} />
    </div>
  );
}

function ReportComposer({ report, period, onSaved }) {
  const [achievements, setAchievements] = useState(report.achievements);
  const [blockers, setBlockers] = useState(report.blockers);
  const [plan, setPlan] = useState(report.plan_next.length ? report.plan_next : [""]);
  const [results, setResults] = useState(report.plan_results);
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const locked = !report.can_edit;
  const due = new Date(report.due_at).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" });

  const body = () => ({
    period, date: report.period_start, achievements, blockers,
    plan_next: plan.map((line) => line.trim()).filter(Boolean), plan_results: results,
  });
  const save = async () => {
    setActionError(null); setMessage(null); setBusy(true);
    try {
      const saved = await apiPost("/api/reports/", body());
      setMessage("Draft saved.");
      onSaved();
      return saved;
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not save the report."));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    try {
      await apiPost(`/api/reports/${saved.id}/submit/`, {});
      setMessage("Submitted.");
      onSaved();
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not submit the report."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ color: D.text, fontWeight: 800 }}>{PERIOD_TITLE[report.period]} · {range(report)}</span>
        <StatusChip status={report.status} />
        {report.is_late && <span style={warnChip}>Late</span>}
        {!locked && <span style={dim}>Due by {due}</span>}
      </div>
      {report.status === "returned" && report.review_note && (
        <div style={{ background: D.panelBg2, borderRadius: 10, padding: "8px 12px", fontSize: "0.8rem", color: D.text }}>
          Returned by {report.reviewer?.full_name || "your manager"}: “{report.review_note}”
        </div>
      )}
      <SystemSections sections={report.system} live={report.system_is_live} />
      {results.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>Your last plan — how did it go?</div>
          {results.map((row, index) => (
            <label key={row.item} style={{ ...labelStyle, flexDirection: "row", alignItems: "center", justifyContent: "space-between", fontWeight: 600 }}>
              <span>{row.item}</span>
              <select aria-label={`Result for "${row.item}"`} disabled={locked} value={row.result}
                onChange={(e) => setResults(results.map((r, i) => (i === index ? { ...r, result: e.target.value } : r)))} style={field}>
                <option value="">Not marked</option><option value="done">Done</option><option value="partly">Partly done</option><option value="not_done">Not done</option>
              </select>
            </label>
          ))}
        </div>
      )}
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.85rem" }}>In your words</div>
      <label style={labelStyle}>What went well<textarea value={achievements} readOnly={locked} onChange={(e) => setAchievements(e.target.value)} rows={4} style={{ ...field, resize: "vertical" }} /></label>
      <label style={labelStyle}>What got in the way<textarea value={blockers} readOnly={locked} onChange={(e) => setBlockers(e.target.value)} rows={3} style={{ ...field, resize: "vertical" }} /></label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ ...labelStyle }}>Plan for next {report.period === "day" ? "day" : report.period}</div>
        {plan.map((line, index) => (
          <input key={index} aria-label={`Plan line ${index + 1}`} value={line} readOnly={locked}
            onChange={(e) => setPlan(plan.map((l, i) => (i === index ? e.target.value : l)))} style={field} maxLength={300} />
        ))}
        {!locked && plan.length < 20 && <button type="button" onClick={() => setPlan([...plan, ""])} style={{ ...button("#fff", D.text), alignSelf: "flex-start" }}>Add a line</button>}
      </div>
      {report.similar_warning && (
        <div role="alert" style={warnNote}>
          This reads a lot like one of your last five reports. Write what actually happened this time — your manager sees the same flag.
        </div>
      )}
      {message && <div role="status" style={{ color: D.green, fontSize: "0.8rem" }}>{message}</div>}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {!locked && <button type="button" disabled={busy} onClick={save} style={button("#fff", D.text, busy)}>Save draft</button>}
        {!locked && <button type="button" disabled={busy} onClick={submit} style={button(D.gold, D.text, busy)}>Submit</button>}
        {report.id && <ExportButtons path={`/api/reports/${report.id}/export/`} stem={`report-${report.period}-${report.period_start}`} onError={setActionError} />}
      </div>
    </div>
  );
}

function History({ rows }) {
  return (
    <div style={{ ...glassCard, padding: 18 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem", marginBottom: 8 }}>History</div>
      {rows.length === 0 && <div style={dim}>No reports yet for this period.</div>}
      {rows.map((r) => (
        <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${D.divider}`, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>{range(r)}</span>
            <StatusChip status={r.status} />
            {r.is_late && <span style={warnChip}>Late</span>}
            {r.review_note && <span style={dim}>“{r.review_note}”</span>}
          </div>
          <ExportButtons path={`/api/reports/${r.id}/export/`} stem={`report-${r.period}-${r.period_start}`} />
        </div>
      ))}
    </div>
  );
}

function RangeExport({ auth }) {
  const today = localISODate();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [format, setFormat] = useState("xlsx");
  const [includeTeam, setIncludeTeam] = useState(false);
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const { data: exportsList, refetch } = useReportExports();
  const canIncludeTeam = auth?.hasPermission?.("staff.invite_team") || auth?.hasPermission?.("reports.view_all");

  const run = async () => {
    setMessage(null); setActionError(null);
    const staff = includeTeam ? "" : `&staff=${auth?.user?.id}`;
    try {
      const queued = await apiDownload(`/api/reports/export/?from=${from}&to=${to}&format=${format}${staff}`, `ashantihub-reports-${from}-${to}.${format}`);
      if (queued?.status === "queued") {
        setMessage("We're preparing that file. The bell tells you when it's ready, and it appears below.");
        refetch();
      }
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not export those reports."));
    }
  };

  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Export</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={labelStyle}>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={field} /></label>
        <label style={labelStyle}>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={field} /></label>
        <label style={labelStyle}>Format<select value={format} onChange={(e) => setFormat(e.target.value)} style={field}><option value="xlsx">Excel</option><option value="csv">CSV</option><option value="pdf">PDF</option></select></label>
        {canIncludeTeam && <label style={{ ...labelStyle, flexDirection: "row", alignItems: "center" }}><input type="checkbox" checked={includeTeam} onChange={(e) => setIncludeTeam(e.target.checked)} />Include my team's reports</label>}
        <button type="button" onClick={run} style={button(D.gold, D.text)}>Export reports</button>
      </div>
      <div style={dim}>Large ranges are prepared in the background; the bell tells you when the file is ready. Every export is recorded.</div>
      {message && <div role="status" style={{ color: D.green, fontSize: "0.8rem" }}>{message}</div>}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      {(exportsList || []).map((item) => (
        <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "6px 0", borderTop: `1px solid ${D.divider}`, fontSize: "0.78rem", color: D.text, flexWrap: "wrap" }}>
          <span>{item.file_name} · {item.status === "ready" ? `${item.row_count} reports` : item.status === "failed" ? `Failed: ${item.error}` : item.status}</span>
          {item.download_url && <button type="button" onClick={() => apiDownload(item.download_url, item.file_name).catch((err) => setActionError(apiErrorMessage(err, "That download link has expired.")))} style={button("#fff", D.text)}>Download</button>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Team Reports**

`frontend/components/admin/panels/TeamReportsPanel.jsx`:
```javascript
import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useReport, useTeamReports } from "../../../hooks/useReports.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, glassCard } from "../theme.js";
import { ExportButtons, PERIODS, ReportNarrative, StatusChip, SystemSections, localISODate } from "./reportParts.jsx";

const dim = { color: D.textDim, fontSize: "0.75rem" };
// Orange marks a warning, but small orange text fails contrast, so the text
// stays dark brown on an orange-edged chip (DESIGN.md: orange = warning).
const flag = { color: D.text, background: `${D.amber}1f`, border: `1px solid ${D.amber}`, borderRadius: 999, padding: "1px 8px", fontWeight: 800, fontSize: "0.68rem", alignSelf: "flex-start" };
const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "8px 10px", fontSize: "0.82rem", fontFamily: "inherit", color: D.text, background: "#fff" };
const pill = (active) => ({ background: active ? D.text : "transparent", color: active ? "#fff" : D.text, border: `1px solid ${D.cardBorder}`, borderRadius: 20, padding: "6px 12px", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" });
const button = (bg, color, disabled) => ({ background: bg, color, border: bg === "#fff" ? `1px solid ${D.cardBorder}` : "none", borderRadius: 10, padding: "8px 14px", fontWeight: 800, fontSize: "0.8rem", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "inherit" });

export default function TeamReportsPanel({ auth }) {
  const [period, setPeriod] = useState("day");
  const [date, setDate] = useState(localISODate());
  const [scope, setScope] = useState("team");
  const [openId, setOpenId] = useState(null);
  const { data, isLoading, isError, refetch } = useTeamReports(period, date, scope);
  const canSeeEveryone = auth?.hasPermission?.("reports.view_all");
  const rows = data?.rows || [];
  const waiting = rows.filter((row) => row.report?.status === "submitted").length;

  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>{scope === "all" ? "Everyone's reports" : "My team's reports"}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {PERIODS.map(([id, label]) => <button key={id} type="button" aria-pressed={period === id} onClick={() => setPeriod(id)} style={pill(period === id)}>{label}</button>)}
          <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} style={field} />
          {canSeeEveryone && (
            <>
              <button type="button" aria-pressed={scope === "team"} onClick={() => setScope("team")} style={pill(scope === "team")}>My team</button>
              <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")} style={pill(scope === "all")}>Everyone</button>
            </>
          )}
        </div>
      </div>
      {waiting > 0 && <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>Waiting for you · {waiting}</div>}
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load the team's reports.</div>}
      {!isLoading && !isError && rows.length === 0 && <div style={dim}>Nobody to show for this period.</div>}
      {rows.map(({ staff, report }) => (
        <div key={staff.id} style={{ borderTop: `1px solid ${D.divider}`, padding: "10px 0", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>{staff.full_name}</span>
              <span style={dim}>{staff.role.replace("_", " ")}</span>
              {report ? <StatusChip status={report.status} /> : <span style={dim}>Not submitted yet</span>}
              {report?.submitted_at && <span style={dim}>{new Date(report.submitted_at).toLocaleString("en-GH")}</span>}
              {report?.is_late && <span style={flag}>Late</span>}
              {report?.similar_warning && <span style={flag}>Copy check {Math.round(report.similarity * 100)}%</span>}
            </div>
            {report && (
              <button type="button" aria-label={openId === report.id ? `Close ${staff.full_name}'s report` : `Open ${staff.full_name}'s report`}
                onClick={() => setOpenId(openId === report.id ? null : report.id)} style={button("#fff", D.text)}>
                {openId === report.id ? "Close" : "Open"}
              </button>
            )}
          </div>
          {report && openId === report.id && <ReportReview id={report.id} onReviewed={refetch} />}
        </div>
      ))}
    </div>
  );
}

function ReportReview({ id, onReviewed }) {
  const { data: report, isLoading, isError, refetch } = useReport(id);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  if (isLoading) return <div style={dim}>Loading…</div>;
  if (isError || !report) return <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not open this report.</div>;

  const review = async (action) => {
    setActionError(null);
    setBusy(true);
    try {
      await apiPost(`/api/reports/${id}/${action}/`, { note });
      setNote("");
      refetch();
      onReviewed();
    } catch (err) {
      setActionError(apiErrorMessage(err, "Could not save your review."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ background: D.pageBg, borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <SystemSections sections={report.system} live={report.system_is_live} />
      <ReportNarrative report={report} />
      {report.similar_warning && <div style={flag}>Copy check: the narrative reads {Math.round(report.similarity * 100)}% like one of their earlier reports.</div>}
      {report.is_late && <div style={flag}>Submitted after the deadline.</div>}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      <ExportButtons path={`/api/reports/${id}/export/`} stem={`report-${report.staff.full_name}-${report.period_start}`} onError={setActionError} />
      {report.can_review && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text }}>
            Comment to {report.staff.full_name} (required to return)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={{ ...field, resize: "vertical" }} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={busy} onClick={() => review("acknowledge")} style={button(D.green, "#fff", busy)}>Acknowledge</button>
            <button type="button" disabled={busy || !note.trim()} onClick={() => review("return")} style={button("#fff", D.red, busy || !note.trim())}>Return with comment</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Render the panels**

In `frontend/components/admin/AdminCommandCenter.jsx` import both panels and add after the `approvals` line:
```javascript
          {activeTab === "reports" && <ReportsPanel auth={auth} />}
          {activeTab === "team-reports" && <TeamReportsPanel auth={auth} />}
```

- [ ] **Step 8: Run the frontend suite and the build**

```bash
cd frontend && npx vitest run 2>&1 | tail -8 && npm run build 2>&1 | tail -3
```
Expected: all pass, build succeeds.

- [ ] **Step 9: Commit**

```bash
git add frontend
git commit -m "feat(staff): My Reports composer with history and exports, and Team Reports review"
```

---
### Task 14: Password prompt, Sign-in & Security, Sessions & Devices, and the 2-step sign-in screen

**Files:**
- Modify: `frontend/apiClient.js` (`setSudoHandler`; every request retries once after a password prompt)
- Create: `frontend/components/admin/SudoPrompt.jsx`, `frontend/components/admin/__tests__/SudoPrompt.test.jsx`
- Create: `frontend/components/admin/TwoFactorSetup.jsx` (`TwoFactorSetup`, `RecoveryCodes`)
- Create: `frontend/components/admin/StaffTwoStepSignIn.jsx`, `frontend/components/admin/__tests__/StaffTwoStepSignIn.test.jsx`
- Create: `frontend/hooks/useStaffSessions.js`, `frontend/hooks/useTwoFactorStatus.js`
- Create: `frontend/components/admin/panels/SecurityPanel.jsx`, `frontend/components/admin/panels/SessionsPanel.jsx`
- Create: `frontend/components/admin/panels/__tests__/SecurityPanel.test.jsx`, `frontend/components/admin/panels/__tests__/SessionsPanel.test.jsx`
- Modify: `frontend/hooks/useAuth.js`, `frontend/hooks/__tests__/useAuth.test.jsx`
- Modify: `frontend/App.jsx` (`AuthModal` second step)
- Modify: `frontend/components/admin/shell/navModel.js` (`security`, `sessions`), `frontend/components/admin/shell/__tests__/navModel.test.js`
- Modify: `frontend/components/admin/AdminCommandCenter.jsx`, `frontend/mocks/handlers.js`

**Interfaces:**
- Consumes: Task 3 (`/api/accounts/staff/reauth/`, `/sessions/…`, `/sign-out-everywhere/`, the `sudo_required` 403), Task 4 (2-step endpoints and login challenge).
- Produces:
  - `apiClient.setSudoHandler(handler: () => Promise<boolean>) -> unregister`; `apiFetch`/`apiPost`/`apiPatch`/`apiPostForm`/`apiPatchForm`/`apiDelete`/`apiDownload` retry once when a 403 `{code: "sudo_required"}` is answered by a handler resolving `true`
  - `SudoPrompt` (mounted once in the staff shell; parallel requests share one prompt; unmounting cancels)
  - `useAuth()` gains `completeSignIn(data)`, `verifyTwoFactor(mfaToken, {code} | {recoveryCode})`, `startTwoFactorEnrolment(mfaToken)`, `confirmTwoFactorEnrolment(mfaToken, code) -> {recoveryCodes, login}`; `login()` returns the challenge object (nothing stored) when the server asks for a second step
  - `StaffTwoStepSignIn({challenge, auth, onSuccess, onCancel})`; `TwoFactorSetup({secret, otpauthUri, onConfirm, busy, error})`; `RecoveryCodes({codes, onDone, doneLabel})`
  - hooks `useMySessions()` (key `['my-sessions']`), `useActiveSessions()` (key `['active-sessions']`), `useTwoFactorStatus()` (key `['two-factor']`)
  - nav ids `security` ("Sign-in & Security", everyone) and `sessions` ("Sessions & Devices", `staff.manage`)

- [ ] **Step 1: Write the failing tests**

`frontend/components/admin/__tests__/SudoPrompt.test.jsx`:
```javascript
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPost } from '../../../apiClient.js'
import { server } from '../../../mocks/server.js'
import SudoPrompt from '../SudoPrompt.jsx'

const SUSPEND = 'http://localhost:8000/api/accounts/staff/9/suspend/'
const PERMISSIONS = 'http://localhost:8000/api/accounts/staff/9/permissions/'
const REAUTH = 'http://localhost:8000/api/accounts/staff/reauth/'
const needSudo = () => HttpResponse.json({ detail: 'Re-enter your password to continue.', code: 'sudo_required' }, { status: 403 })

describe('SudoPrompt', () => {
  it('asks for the password and retries the action once', async () => {
    let attempts = 0
    let reauth = null
    server.use(
      http.post(SUSPEND, () => { attempts += 1; return attempts === 1 ? needSudo() : HttpResponse.json({ id: 9, status: 'suspended' }) }),
      http.post(REAUTH, async ({ request }) => { reauth = await request.json(); return HttpResponse.json({ sudo_until: '2026-10-07T12:00:00Z' }) }),
    )
    render(<SudoPrompt />)
    const action = apiPost('/api/accounts/staff/9/suspend/', { reason: 'x' })
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'correct-horse-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await expect(action).resolves.toEqual({ id: 9, status: 'suspended' })
    expect(reauth).toEqual({ password: 'correct-horse-1' })
    expect(attempts).toBe(2)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('keeps the prompt open on a wrong password', async () => {
    server.use(
      http.post(SUSPEND, needSudo),
      http.post(REAUTH, () => HttpResponse.json({ password: ["That password isn't right."] }, { status: 400 })),
    )
    render(<SudoPrompt />)
    apiPost('/api/accounts/staff/9/suspend/', {}).catch(() => {})
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("That password isn't right.")
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('cancelling fails the action without retrying it', async () => {
    let attempts = 0
    server.use(http.post(SUSPEND, () => { attempts += 1; return needSudo() }))
    render(<SudoPrompt />)
    const action = apiPost('/api/accounts/staff/9/suspend/', {})
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await expect(action).rejects.toMatchObject({ status: 403 })
    expect(attempts).toBe(1)
  })

  it('shows one prompt for two protected actions at once and retries both', async () => {
    let unlocked = false
    const calls = { suspend: 0, permissions: 0 }
    server.use(
      http.post(SUSPEND, () => { calls.suspend += 1; return unlocked ? HttpResponse.json({ ok: 'suspend' }) : needSudo() }),
      http.post(PERMISSIONS, () => { calls.permissions += 1; return unlocked ? HttpResponse.json({ ok: 'permissions' }) : needSudo() }),
      http.post(REAUTH, () => { unlocked = true; return HttpResponse.json({ sudo_until: 'later' }) }),
    )
    render(<SudoPrompt />)
    const both = Promise.all([
      apiPost('/api/accounts/staff/9/suspend/', {}),
      apiPost('/api/accounts/staff/9/permissions/', { grant: [], revoke: [] }),
    ])
    await waitFor(() => expect(calls.suspend + calls.permissions).toBe(2))
    expect(await screen.findAllByRole('dialog')).toHaveLength(1)
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await expect(both).resolves.toEqual([{ ok: 'suspend' }, { ok: 'permissions' }])
    expect(calls).toEqual({ suspend: 2, permissions: 2 })
  })
})
```
`frontend/components/admin/__tests__/StaffTwoStepSignIn.test.jsx`:
```javascript
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StaffTwoStepSignIn from '../StaffTwoStepSignIn.jsx'

const signedIn = { token: 't', account_type: 'staff', id: 1, full_name: 'Simon Peter', role: 'super_admin' }

describe('StaffTwoStepSignIn', () => {
  it('signs in with the code from the app', async () => {
    const auth = { verifyTwoFactor: vi.fn(async () => signedIn) }
    const onSuccess = vi.fn()
    render(<StaffTwoStepSignIn challenge={{ two_factor_required: true, mfa_token: 'mfa' }} auth={auth} onSuccess={onSuccess} onCancel={() => {}} />)
    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(signedIn))
    expect(auth.verifyTwoFactor).toHaveBeenCalledWith('mfa', { code: '123456' })
  })

  it('can use a recovery code instead, and shows a wrong code inline', async () => {
    const auth = { verifyTwoFactor: vi.fn(async () => { throw Object.assign(new Error('400'), { status: 400, body: { detail: "That code isn't right. Check your authenticator app and try again." } }) }) }
    render(<StaffTwoStepSignIn challenge={{ two_factor_required: true, mfa_token: 'mfa' }} auth={auth} onSuccess={() => {}} onCancel={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Lost your phone? Use a recovery code' }))
    fireEvent.change(screen.getByLabelText('Recovery code'), { target: { value: 'abcde-fghjk' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("That code isn't right.")
    expect(auth.verifyTwoFactor).toHaveBeenCalledWith('mfa', { recoveryCode: 'abcde-fghjk' })
  })

  it('walks a Super Admin through setting it up, then shows the recovery codes once', async () => {
    const codes = Array.from({ length: 10 }, (_, i) => `code${i}-xxxxx`)
    const auth = {
      startTwoFactorEnrolment: vi.fn(async () => ({ secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/AshantiHub:boss%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=AshantiHub' })),
      confirmTwoFactorEnrolment: vi.fn(async () => ({ recoveryCodes: codes, login: { token: 't' } })),
      completeSignIn: vi.fn(async () => signedIn),
    }
    const onSuccess = vi.fn()
    render(<StaffTwoStepSignIn challenge={{ two_factor_setup_required: true, mfa_token: 'mfa' }} auth={auth} onSuccess={onSuccess} onCancel={() => {}} />)
    expect(await screen.findByLabelText('Setup key')).toHaveTextContent('JBSW Y3DP EHPK 3PXP')
    fireEvent.change(screen.getByLabelText('6-digit code from the app'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'Turn on 2-step sign-in' }))
    expect(await screen.findByRole('list', { name: 'Recovery codes' })).toHaveTextContent('code0-xxxxx')
    const next = screen.getByRole('button', { name: 'Continue to the dashboard' })
    expect(next).toBeDisabled()
    fireEvent.click(screen.getByLabelText("I've saved these codes"))
    fireEvent.click(next)
    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(signedIn))
    expect(auth.completeSignIn).toHaveBeenCalledWith({ token: 't' })
  })
})
```
`frontend/components/admin/panels/__tests__/SecurityPanel.test.jsx`:
```javascript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SecurityPanel from '../SecurityPanel.jsx'

const session = (id, overrides = {}) => ({
  id, device_label: 'Chrome on Windows computer', ip: '41.66.212.18', created_at: '2026-10-07T07:40:00Z',
  last_seen_at: '2026-10-07T11:40:00Z', ends_at: '2026-10-07T19:40:00Z', idle_ends_at: '2026-10-07T12:10:00Z',
  revoked_at: null, revoked_reason: '', is_active: true, is_current: false, two_factor: false,
  staff: { id: 1, full_name: 'Esi Nyarko', role: 'support' }, ...overrides,
})
const off = { enabled: false, required: false, enabled_at: null, recovery_codes_left: 0 }

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={queryClient}><SecurityPanel /></QueryClientProvider>)
}

describe('SecurityPanel', () => {
  it('lists my sessions and signs out the other devices', async () => {
    let endedOthers = false
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/sessions/', () => HttpResponse.json([
        session(1, { is_current: true, two_factor: true }),
        session(2, { device_label: 'Chrome on Android device', ip: '154.160.24.91' }),
      ])),
      http.post('http://localhost:8000/api/accounts/staff/sessions/end-others/', () => { endedOthers = true; return HttpResponse.json({ ended: 1 }) }),
    )
    renderPanel()
    expect(await screen.findByText('This device')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'End the session on Chrome on Android device' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out other devices' }))
    await waitFor(() => expect(endedOthers).toBe(true))
  })

  it('sets up 2-step sign-in and shows the recovery codes', async () => {
    let confirmed = null
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/two-factor/', () => HttpResponse.json(off)),
      http.post('http://localhost:8000/api/accounts/staff/two-factor/setup/', () => HttpResponse.json({ secret: 'JBSWY3DPEHPK3PXP', otpauth_uri: 'otpauth://totp/AshantiHub:esi%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=AshantiHub' })),
      http.post('http://localhost:8000/api/accounts/staff/two-factor/setup/confirm/', async ({ request }) => {
        confirmed = await request.json()
        return HttpResponse.json({ recovery_codes: ['abcde-fghjk', 'mnpqr-stuvw'] })
      }),
    )
    renderPanel()
    fireEvent.click(await screen.findByRole('button', { name: 'Set up 2-step sign-in' }))
    fireEvent.change(await screen.findByLabelText('6-digit code from the app'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Turn on 2-step sign-in' }))
    expect(await screen.findByRole('list', { name: 'Recovery codes' })).toHaveTextContent('abcde-fghjk')
    expect(confirmed).toEqual({ code: '123456' })
  })

  it("never offers to turn it off for a Super Admin", async () => {
    server.use(http.get('http://localhost:8000/api/accounts/staff/two-factor/', () => HttpResponse.json({ enabled: true, required: true, enabled_at: '2026-10-02T08:00:00Z', recovery_codes_left: 9 })))
    renderPanel()
    expect(await screen.findByText(/Recovery codes left: 9 of 10/)).toBeInTheDocument()
    expect(screen.getByText("2-step sign-in can't be turned off for a Super Admin.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument()
  })
})
```
`frontend/components/admin/panels/__tests__/SessionsPanel.test.jsx`:
```javascript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../../../../mocks/server.js'
import SessionsPanel from '../SessionsPanel.jsx'

const session = (id, staff, overrides = {}) => ({
  id, device_label: 'Chrome on Android device', ip: '154.160.24.91', created_at: '2026-10-07T07:58:00Z',
  last_seen_at: '2026-10-07T11:45:00Z', ends_at: '2026-10-07T19:58:00Z', idle_ends_at: '2026-10-07T12:15:00Z',
  revoked_at: null, revoked_reason: '', is_active: true, is_current: false, two_factor: false, staff, ...overrides,
})
const simon = { id: 1, full_name: 'Simon Peter', role: 'super_admin' }
const ama = { id: 2, full_name: 'Ama Boateng', role: 'operations' }

describe('SessionsPanel', () => {
  it("lists everyone signed in and signs a person out of every device", async () => {
    let signedOut = null
    server.use(
      http.get('http://localhost:8000/api/accounts/staff/sessions/active/', () => HttpResponse.json([
        session(1, simon, { is_current: true, device_label: 'Chrome on Windows computer', two_factor: true }),
        session(2, ama), session(3, ama, { device_label: 'Edge on Windows computer' }),
      ])),
      http.post('http://localhost:8000/api/accounts/staff/2/sign-out-everywhere/', () => { signedOut = 2; return HttpResponse.json({ ended: 2 }) }),
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={queryClient}><SessionsPanel /></QueryClientProvider>)
    expect(await screen.findByText('3 sessions on 2 people\'s devices')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out all of Simon Peter\'s devices' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out all of Ama Boateng\'s devices' }))
    await waitFor(() => expect(signedOut).toBe(2))
  })
})
```
Append to `frontend/hooks/__tests__/useAuth.test.jsx`, inside `describe('useAuth', …)`:
```javascript
  it('returns the 2-step challenge from login without storing anything', async () => {
    server.use(http.post('http://localhost:8000/api/accounts/staff/login/', () => HttpResponse.json({ two_factor_required: true, mfa_token: 'mfa' })))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    let challenge
    await act(async () => { challenge = await result.current.login('staff', 'boss@example.com', 'pw') })
    expect(challenge).toEqual({ two_factor_required: true, mfa_token: 'mfa' })
    expect(result.current.user).toBeNull()
    expect(localStorage.getItem('ashantihub.auth')).toBeNull()
  })

  it('finishes a 2-step sign-in with the code', async () => {
    server.use(
      http.post('http://localhost:8000/api/accounts/staff/login/two-factor/', () => HttpResponse.json({ token: 'tok', account_type: 'staff', id: 1, full_name: 'Simon Peter', role: 'super_admin', permissions: [] })),
      http.get('http://localhost:8000/api/accounts/me/', () => HttpResponse.json({ account_type: 'staff', id: 1, full_name: 'Simon Peter', role: 'super_admin', permissions: [] })),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await act(async () => { await result.current.verifyTwoFactor('mfa', { code: '123456' }) })
    expect(result.current.user).toMatchObject({ token: 'tok', full_name: 'Simon Peter' })
  })
```
Update `navModel.test.js`'s "My Work group" tests once more (Sign-in & Security is on every staffer's menu):
```javascript
  it('gives every staffer Approvals, Tasks, My Reports, Activity and Sign-in & Security', () => {
    expect(myWork([]).items.map((i) => i.id)).toEqual(['approvals', 'tasks', 'reports', 'activity', 'security'])
  })

  it('adds Call Log, Team Reports and My Team for the permissions that unlock them', () => {
    expect(myWork(['calls.log', 'staff.invite_team']).items.map((i) => i.id)).toEqual(['approvals', 'tasks', 'calls', 'reports', 'team-reports', 'activity', 'my-team', 'security'])
  })

  it('shows Sessions & Devices to staff.manage only', () => {
    const ids = (perms) => buildNavGroups({ hasPermission: (c) => perms.includes(c) }).flatMap((g) => g.items.map((i) => i.id))
    expect(ids([])).not.toContain('sessions')
    expect(ids(['staff.manage'])).toContain('sessions')
  })
```
Run: `cd frontend && npx vitest run components/admin hooks/__tests__/useAuth.test.jsx`
Expected: FAIL — the new modules don't exist; `login` stores a token-less session; nav lacks `security`.

- [ ] **Step 2: apiClient retries once after a password prompt**

In `frontend/apiClient.js`, add after `request()`:
```javascript
// Password re-entry (staff foundations F9). The staff shell registers a
// handler (SudoPrompt) that asks for the password; a 403 {code:
// "sudo_required"} then prompts and retries the request once. With no
// handler, or if the prompt is cancelled, the 403 surfaces as usual.
let sudoHandler = null

export function setSudoHandler(handler) {
  sudoHandler = handler
  return () => {
    if (sudoHandler === handler) sudoHandler = null
  }
}

async function send(path, makeInit) {
  let response = await request(path, makeInit())
  if (response.status === 403 && sudoHandler) {
    let body = null
    try {
      body = await response.clone().json()
    } catch {
      body = null
    }
    if (body?.code === 'sudo_required' && (await sudoHandler())) {
      response = await request(path, makeInit())
    }
  }
  return response
}
```
Then route every helper through `send`, passing a function that builds the init (so the retry re-reads the token):
- `apiFetch`: `const response = await send(path, () => ({ headers: authHeaders() }))`
- `apiDownload`: `const response = await send(path, () => ({ headers: authHeaders() }))`
- `apiPost`: `const response = await send(path, () => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) }))`
- `apiPatch`: the same with `method: 'PATCH'`
- `apiPostForm`: `const response = await send(path, () => ({ method: 'POST', headers: authHeaders(), body: formData }))`
- `apiPatchForm`: the same with `method: 'PATCH'`
- `apiDelete`: `const response = await send(path, () => ({ method: 'DELETE', headers: authHeaders() }))`

- [ ] **Step 3: The password prompt**

`frontend/components/admin/SudoPrompt.jsx`:
```javascript
import { useEffect, useRef, useState } from "react";
import { apiPost, setSudoHandler } from "../../apiClient.js";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";
import { D } from "./theme.js";

const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "9px 10px", fontSize: "0.85rem", fontFamily: "inherit", color: D.text, background: "#fff" };
const button = (bg, color, disabled) => ({ background: bg, color, border: bg === "#fff" ? `1px solid ${D.cardBorder}` : "none", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: "0.8rem", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "inherit" });

// The password prompt for sensitive staff actions (F9: suspending staff,
// changing permissions or managers, exporting other people's reports, 2-step
// changes). Mounted once in the staff shell; apiClient calls it on a 403
// {code: "sudo_required"} and retries the request after a correct password.
// Requests that need it at the same time share one prompt.
export default function SudoPrompt() {
  const pending = useRef(null);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setSudoHandler(() => {
    if (!pending.current) {
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      pending.current = { promise, resolve };
      setPassword("");
      setError(null);
      setOpen(true);
    }
    return pending.current.promise;
  }), []);

  // Signing out (unmount) cancels a prompt that is still open.
  useEffect(() => () => pending.current?.resolve(false), []);

  const finish = (ok) => {
    const current = pending.current;
    pending.current = null;
    setOpen(false);
    setPassword("");
    current?.resolve(ok);
  };

  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/accounts/staff/reauth/", { password });
      finish(true);
    } catch (err) {
      setError(apiErrorMessage(err, "That password isn't right."));
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(44,24,16,0.45)", zIndex: 4000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <form role="dialog" aria-modal="true" aria-labelledby="sudo-title" onSubmit={confirm}
        style={{ background: "#fff", borderRadius: 16, padding: 20, width: "100%", maxWidth: 380, display: "flex", flexDirection: "column", gap: 12, boxShadow: D.shadow }}>
        <div id="sudo-title" style={{ color: D.text, fontWeight: 800, fontSize: "1rem" }}>Confirm it's you</div>
        <div style={{ color: D.textDim, fontSize: "0.8rem", lineHeight: 1.5 }}>Enter your password to carry on. It unlocks sensitive actions on this device for 10 minutes.</div>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text }}>
          Password
          <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={field} />
        </label>
        {error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={() => finish(false)} style={button("#fff", D.text)}>Cancel</button>
          <button type="submit" disabled={busy || !password} style={button(D.gold, D.text, busy || !password)}>Confirm</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: 2-step setup pieces and the sign-in step**

`frontend/components/admin/TwoFactorSetup.jsx`:
```javascript
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { D } from "./theme.js";

const mono = "'JetBrains Mono', ui-monospace, monospace";
const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "9px 10px", fontSize: "0.95rem", fontFamily: mono, color: D.text, background: "#fff", letterSpacing: "0.12em" };
const button = (bg, color, disabled) => ({ background: bg, color, border: bg === "#fff" ? `1px solid ${D.cardBorder}` : "none", borderRadius: 10, padding: "9px 16px", fontWeight: 800, fontSize: "0.8rem", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "inherit" });
const text = { color: D.text, fontSize: "0.8rem", lineHeight: 1.5 };

// Scan the QR code (drawn on the device; the secret never goes to a QR
// service) or type the key, then confirm with the first 6-digit code.
export function TwoFactorSetup({ secret, otpauthUri, onConfirm, busy, error }) {
  const [qr, setQr] = useState(null);
  const [code, setCode] = useState("");
  useEffect(() => {
    let live = true;
    QRCode.toString(otpauthUri, { type: "svg", errorCorrectionLevel: "M", margin: 2 })
      .then((svg) => { if (live) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`); })
      .catch(() => { if (live) setQr(null); });
    return () => { live = false; };
  }, [otpauthUri]);
  const ready = code.replace(/\D/g, "").length === 6;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onConfirm(code); }} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={text}>Open an authenticator app (Google Authenticator, Microsoft Authenticator or similar) and scan this code.</div>
      {qr && <img src={qr} alt="QR code for your authenticator app" width={168} height={168} style={{ background: "#fff", borderRadius: 8, alignSelf: "flex-start" }} />}
      <div style={text}>Can't scan it? Type this key: <span aria-label="Setup key" style={{ fontFamily: mono, fontWeight: 700 }}>{secret.replace(/(.{4})/g, "$1 ").trim()}</span></div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text }}>
        6-digit code from the app
        <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} style={field} />
      </label>
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{error}</div>}
      <button type="submit" disabled={busy || !ready} style={{ ...button(D.gold, D.text, busy || !ready), alignSelf: "flex-start" }}>Turn on 2-step sign-in</button>
    </form>
  );
}

// The 10 single-use recovery codes, shown once.
export function RecoveryCodes({ codes, onDone, doneLabel = "Done" }) {
  const [saved, setSaved] = useState(false);
  const download = () => {
    const blob = new Blob([`AshantiHub recovery codes. Each one works once.\n\n${codes.join("\n")}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ashantihub-recovery-codes.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.9rem" }}>Save your recovery codes</div>
      <div style={text}>If you lose your phone, each code signs you in once. Keep them somewhere other than the phone. You won't see them again.</div>
      <ol aria-label="Recovery codes" style={{ fontFamily: mono, fontSize: "0.85rem", columns: 2, margin: 0, paddingLeft: 22, color: D.text, background: D.panelBg2, borderRadius: 10, paddingTop: 8, paddingBottom: 8 }}>
        {codes.map((code) => <li key={code}>{code}</li>)}
      </ol>
      <button type="button" onClick={download} style={{ ...button("#fff", D.text), alignSelf: "flex-start" }}>Download</button>
      <label style={{ display: "flex", gap: 8, alignItems: "center", ...text }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I've saved these codes
      </label>
      <button type="button" disabled={!saved} onClick={onDone} style={{ ...button(D.gold, D.text, !saved), alignSelf: "flex-start" }}>{doneLabel}</button>
    </div>
  );
}
```
`frontend/components/admin/StaffTwoStepSignIn.jsx`:
```javascript
import { useEffect, useState } from "react";
import { apiErrorMessage } from "../../lib/apiErrorMessage.js";
import { RecoveryCodes, TwoFactorSetup } from "./TwoFactorSetup.jsx";
import { D } from "./theme.js";

const title = { color: D.text, fontWeight: 800, fontSize: "0.95rem" };
const text = { color: D.text, fontSize: "0.8rem", lineHeight: 1.5 };
const field = { border: `1px solid ${D.cardBorder}`, borderRadius: 10, padding: "10px 12px", fontSize: "0.9rem", fontFamily: "inherit", color: D.text, background: "#fff" };
const link = { background: "none", border: "none", color: D.deepGold, fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit", padding: 0, alignSelf: "flex-start" };
const primary = (disabled) => ({ background: D.gold, color: D.text, border: "none", borderRadius: 20, padding: "12px", fontWeight: 900, fontSize: "0.85rem", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1, fontFamily: "inherit" });

// The second step of a staff sign-in (F9), shown by AuthModal when the
// password step answers with a challenge instead of a token:
//   two_factor_required        → the 6-digit code, or a recovery code
//   two_factor_setup_required  → a Super Admin without 2-step sets it up now
export default function StaffTwoStepSignIn({ challenge, auth, onSuccess, onCancel }) {
  if (challenge.two_factor_setup_required) return <Enrol challenge={challenge} auth={auth} onSuccess={onSuccess} onCancel={onCancel} />;
  return <Verify challenge={challenge} auth={auth} onSuccess={onSuccess} onCancel={onCancel} />;
}

function Verify({ challenge, auth, onSuccess, onCancel }) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await auth.verifyTwoFactor(challenge.mfa_token, useRecovery ? { recoveryCode: value } : { code: value });
      onSuccess(result);
    } catch (err) {
      setError(apiErrorMessage(err, "That code isn't right."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={title}>2-step sign-in</div>
      <div style={text}>{useRecovery ? "Type one of your recovery codes. Each one works once." : "Open your authenticator app and type the 6-digit code for AshantiHub."}</div>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.75rem", fontWeight: 700, color: D.text }}>
        {useRecovery ? "Recovery code" : "6-digit code"}
        <input value={value} onChange={(e) => setValue(e.target.value)} autoFocus inputMode={useRecovery ? "text" : "numeric"} autoComplete="one-time-code" style={field} />
      </label>
      {error && <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{error}</div>}
      <button type="submit" disabled={busy || !value.trim()} style={primary(busy || !value.trim())}>{busy ? "Checking…" : "Sign in"}</button>
      <button type="button" onClick={() => { setUseRecovery(!useRecovery); setValue(""); setError(null); }} style={link}>
        {useRecovery ? "Use the authenticator app instead" : "Lost your phone? Use a recovery code"}
      </button>
      <button type="button" onClick={onCancel} style={link}>Start again</button>
    </form>
  );
}

function Enrol({ challenge, auth, onSuccess, onCancel }) {
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [login, setLogin] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    auth.startTwoFactorEnrolment(challenge.mfa_token)
      .then((data) => { if (live) setSetup(data); })
      .catch((err) => { if (live) setError(apiErrorMessage(err, "Could not start setting up 2-step sign-in.")); });
    return () => { live = false; };
  }, [challenge.mfa_token]);

  const confirm = async (code) => {
    setBusy(true);
    setError(null);
    try {
      const result = await auth.confirmTwoFactorEnrolment(challenge.mfa_token, code);
      setCodes(result.recoveryCodes);
      setLogin(result.login);
    } catch (err) {
      setError(apiErrorMessage(err, "That code isn't right."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={title}>Set up 2-step sign-in</div>
      {!codes && <div style={text}>Super Admins must use 2-step sign-in. It takes a minute; after that, each sign-in also asks for a code from your phone.</div>}
      {codes ? (
        <RecoveryCodes codes={codes} doneLabel="Continue to the dashboard" onDone={async () => onSuccess(await auth.completeSignIn(login))} />
      ) : setup ? (
        <TwoFactorSetup secret={setup.secret} otpauthUri={setup.otpauth_uri} onConfirm={confirm} busy={busy} error={error} />
      ) : error ? (
        <div role="alert" style={{ color: D.red, fontSize: "0.78rem" }}>{error}</div>
      ) : (
        <div style={text}>Preparing…</div>
      )}
      {!codes && <button type="button" onClick={onCancel} style={link}>Start again</button>}
    </div>
  );
}
```

- [ ] **Step 5: useAuth and the sign-in modal**

In `frontend/hooks/useAuth.js` replace `login` with:
```javascript
  // Stores a sign-in response and merges /me/ into it (shared by the
  // password sign-in and the 2-step sign-in's last step).
  const completeSignIn = useCallback(async (data) => {
    setStoredAuth(data)
    let merged = data
    try {
      const me = await apiFetch('/api/accounts/me/')
      merged = { ...data, ...me }
      setStoredAuth(merged)
    } catch {
      // /me/ failed after a successful login — keep the user logged in with
      // what the login response gave us; the next page load's session-restore
      // effect will retry /me/ and fill in the rest.
    }
    setUser(merged)
    return merged
  }, [])

  const login = useCallback(async (accountType, identifier, password) => {
    const data = await apiPost(LOGIN_PATHS[accountType], { identifier, password })
    // A staffer with 2-step sign-in (or a Super Admin who must set it up)
    // gets a short-lived challenge instead of a token. Nothing is stored
    // until the second step succeeds.
    if (data?.two_factor_required || data?.two_factor_setup_required) return data
    return completeSignIn(data)
  }, [completeSignIn])

  const verifyTwoFactor = useCallback(async (mfaToken, { code, recoveryCode } = {}) => {
    const body = recoveryCode ? { mfa_token: mfaToken, recovery_code: recoveryCode } : { mfa_token: mfaToken, code }
    return completeSignIn(await apiPost('/api/accounts/staff/login/two-factor/', body))
  }, [completeSignIn])

  const startTwoFactorEnrolment = useCallback(
    (mfaToken) => apiPost('/api/accounts/staff/two-factor/enrol/start/', { mfa_token: mfaToken }),
    [],
  )

  // Returns the recovery codes and the sign-in payload WITHOUT signing in, so
  // the codes can be shown before the dashboard replaces the sign-in form;
  // the caller finishes with completeSignIn(login).
  const confirmTwoFactorEnrolment = useCallback(async (mfaToken, code) => {
    const { recovery_codes: recoveryCodes, ...login } = await apiPost(
      '/api/accounts/staff/two-factor/enrol/confirm/', { mfa_token: mfaToken, code },
    )
    return { recoveryCodes, login }
  }, [])
```
and add `completeSignIn, verifyTwoFactor, startTwoFactorEnrolment, confirmTwoFactorEnrolment` to the returned object.

In `frontend/App.jsx` add `import StaffTwoStepSignIn from "./components/admin/StaffTwoStepSignIn.jsx";` next to the other `./components/admin/` imports. In `AuthModal`:
- after `const [submitting,setSubmitting]=useState(false);` add `const [twoStep,setTwoStep]=useState(null);`
- in `handleLogin`, replace `onSuccess(result);` with:
```javascript
      if(result?.two_factor_required||result?.two_factor_setup_required){setTwoStep(result);return;}
      onSuccess(result);
```
- change `{mode==="login" && <form onSubmit={handleLogin}>` to `{mode==="login" && !twoStep && <form onSubmit={handleLogin}>` and add directly above it:
```javascript
        {mode==="login" && twoStep && <StaffTwoStepSignIn challenge={twoStep} auth={auth} onSuccess={onSuccess} onCancel={()=>{setTwoStep(null);setPassword("");}}/>}
```

- [ ] **Step 6: Hooks and the two panels**

`frontend/hooks/useStaffSessions.js`:
```javascript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/staff/sessions/ — my sessions (newest first), a plain array.
export function useMySessions() {
  return useQuery({ queryKey: ['my-sessions'], queryFn: () => apiFetch('/api/accounts/staff/sessions/') })
}

// GET /api/accounts/staff/sessions/active/ — everyone signed in now (staff.manage), a plain array.
export function useActiveSessions() {
  return useQuery({ queryKey: ['active-sessions'], queryFn: () => apiFetch('/api/accounts/staff/sessions/active/') })
}
```
`frontend/hooks/useTwoFactorStatus.js`:
```javascript
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../apiClient.js'

// GET /api/accounts/staff/two-factor/ — {enabled, required, enabled_at, recovery_codes_left}.
export function useTwoFactorStatus() {
  return useQuery({ queryKey: ['two-factor'], queryFn: () => apiFetch('/api/accounts/staff/two-factor/') })
}
```
`frontend/components/admin/panels/SecurityPanel.jsx`:
```javascript
import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useMySessions } from "../../../hooks/useStaffSessions.js";
import { useTwoFactorStatus } from "../../../hooks/useTwoFactorStatus.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { RecoveryCodes, TwoFactorSetup } from "../TwoFactorSetup.jsx";
import { D, glassCard } from "../theme.js";

const dim = { color: D.textDim, fontSize: "0.75rem" };
const heading = { color: D.text, fontWeight: 800, fontSize: "0.95rem", margin: 0 };
const chip = (color) => ({ background: `${color}1f`, border: `1px solid ${color}55`, color: D.text, borderRadius: 999, padding: "2px 8px", fontSize: "0.64rem", fontWeight: 800, marginLeft: 6 });
const button = (bg, color, disabled) => ({ background: bg, color, border: bg === "#fff" ? `1px solid ${D.cardBorder}` : "none", borderRadius: 10, padding: "8px 14px", fontWeight: 800, fontSize: "0.78rem", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, fontFamily: "inherit" });
const at = (iso) => new Date(iso).toLocaleString("en-GH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// Sign-in & Security (F9) for every staffer: their own sessions and their
// 2-step sign-in. Sensitive steps ask for the password through SudoPrompt.
export default function SecurityPanel() {
  const { data: sessions, isLoading, isError, refetch } = useMySessions();
  const { data: twoFactor, refetch: refetchTwoFactor } = useTwoFactorStatus();
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn, okText, failText) => {
    setMessage(null);
    setActionError(null);
    setBusy(true);
    try {
      await fn();
      if (okText) setMessage(okText);
      refetch();
      refetchTwoFactor();
    } catch (err) {
      setActionError(apiErrorMessage(err, failText));
    } finally {
      setBusy(false);
    }
  };
  const startSetup = () => run(async () => setSetup(await apiPost("/api/accounts/staff/two-factor/setup/", {})), null, "Could not start setting up 2-step sign-in.");
  const confirmSetup = (code) => run(async () => {
    const result = await apiPost("/api/accounts/staff/two-factor/setup/confirm/", { code });
    setSetup(null);
    setCodes(result.recovery_codes);
  }, null, "That code isn't right. Check the app shows AshantiHub and try again.");

  const active = (sessions || []).filter((s) => s.is_active);
  const others = active.filter((s) => !s.is_current);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section aria-labelledby="sessions-heading" style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 id="sessions-heading" style={heading}>Your sessions</h2>
        <div style={dim}>A session ends after 30 minutes without activity, and after 12 hours at the latest.</div>
        {isLoading && <div style={dim}>Loading…</div>}
        {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load your sessions.</div>}
        {active.map((s) => (
          <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", padding: "8px 0", borderTop: `1px solid ${D.divider}`, flexWrap: "wrap" }}>
            <div>
              <div style={{ color: D.text, fontWeight: 700, fontSize: "0.82rem" }}>
                {s.device_label}{s.is_current && <span style={chip(D.green)}>This device</span>}{s.two_factor && <span style={chip(D.blue)}>2-step</span>}
              </div>
              <div style={dim}>Signed in {at(s.created_at)} · last active {at(s.last_seen_at)}{s.ip ? ` · ${s.ip}` : ""} · ends by {at(s.ends_at)}</div>
            </div>
            {!s.is_current && (
              <button type="button" aria-label={`End the session on ${s.device_label}`} disabled={busy}
                onClick={() => run(() => apiPost(`/api/accounts/staff/sessions/${s.id}/end/`, {}), "Session ended.", "Could not end that session.")}
                style={button("#fff", D.red, busy)}>End session</button>
            )}
          </div>
        ))}
        {others.length > 0 && (
          <button type="button" disabled={busy} onClick={() => run(() => apiPost("/api/accounts/staff/sessions/end-others/", {}), "Signed out of your other devices.", "Could not sign out your other devices.")} style={{ ...button("#fff", D.text, busy), alignSelf: "flex-start" }}>Sign out other devices</button>
        )}
        {!isLoading && !isError && others.length === 0 && <div style={dim}>No other devices are signed in.</div>}
      </section>

      <section aria-labelledby="two-step-heading" style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 id="two-step-heading" style={heading}>2-step sign-in</h2>
        {codes ? (
          <RecoveryCodes codes={codes} onDone={() => setCodes(null)} />
        ) : setup ? (
          <TwoFactorSetup secret={setup.secret} otpauthUri={setup.otpauth_uri} onConfirm={confirmSetup} busy={busy} error={actionError} />
        ) : twoFactor?.enabled ? (
          <>
            <div style={{ color: D.text, fontSize: "0.82rem" }}>On since {new Date(twoFactor.enabled_at).toLocaleDateString("en-GH")}. Recovery codes left: {twoFactor.recovery_codes_left} of 10.</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" disabled={busy} onClick={startSetup} style={button("#fff", D.text, busy)}>Move to a new phone</button>
              <button type="button" disabled={busy} onClick={() => run(async () => setCodes((await apiPost("/api/accounts/staff/two-factor/recovery-codes/", {})).recovery_codes), null, "Could not make new codes.")} style={button("#fff", D.text, busy)}>Make new recovery codes</button>
              {!twoFactor.required && <button type="button" disabled={busy} onClick={() => run(() => apiPost("/api/accounts/staff/two-factor/disable/", {}), "2-step sign-in is off.", "Could not turn it off.")} style={button("#fff", D.red, busy)}>Turn off</button>}
            </div>
            {twoFactor.required && <div style={dim}>2-step sign-in can't be turned off for a Super Admin.</div>}
            <div style={dim}>Making new codes cancels the old ones.</div>
          </>
        ) : (
          <>
            <div style={{ color: D.text, fontSize: "0.82rem" }}>Off. With 2-step sign-in, signing in also asks for a 6-digit code from an app on your phone, so a stolen password isn't enough.</div>
            <button type="button" disabled={busy} onClick={startSetup} style={{ ...button(D.gold, D.text, busy), alignSelf: "flex-start" }}>Set up 2-step sign-in</button>
          </>
        )}
        {message && <div role="status" style={{ color: D.green, fontSize: "0.8rem" }}>{message}</div>}
        {actionError && !setup && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      </section>
    </div>
  );
}
```
`frontend/components/admin/panels/SessionsPanel.jsx`:
```javascript
import { useState } from "react";
import { apiPost } from "../../../apiClient.js";
import { useActiveSessions } from "../../../hooks/useStaffSessions.js";
import { apiErrorMessage } from "../../../lib/apiErrorMessage.js";
import { D, ROLE_ACCENTS, ROLE_BADGE_TEXT, glassCard } from "../theme.js";

const dim = { color: D.textDim, fontSize: "0.75rem" };
const button = (bg, color) => ({ background: bg, color, border: bg === "#fff" ? `1px solid ${D.cardBorder}` : "none", borderRadius: 10, padding: "6px 12px", fontWeight: 800, fontSize: "0.72rem", cursor: "pointer", fontFamily: "inherit" });
const time = (iso) => new Date(iso).toLocaleTimeString("en-GH", { hour: "2-digit", minute: "2-digit" });

// Sessions & Devices (F9, staff.manage): everyone signed in now. Ending a
// session or signing someone out of every device takes effect at once — the
// next request is refused and any live connection is dropped.
export default function SessionsPanel() {
  const { data, isLoading, isError, refetch } = useActiveSessions();
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const sessions = data || [];
  const people = [];
  const byPerson = new Map();
  for (const s of sessions) {
    if (!byPerson.has(s.staff.id)) {
      byPerson.set(s.staff.id, { staff: s.staff, sessions: [] });
      people.push(byPerson.get(s.staff.id));
    }
    byPerson.get(s.staff.id).sessions.push(s);
  }
  const run = async (fn, okText, failText) => {
    setMessage(null);
    setActionError(null);
    try { await fn(); setMessage(okText); refetch(); }
    catch (err) { setActionError(apiErrorMessage(err, failText)); }
  };

  return (
    <div style={{ ...glassCard, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ color: D.text, fontWeight: 800, fontSize: "0.95rem" }}>Everyone signed in now</div>
      {!isLoading && !isError && <div style={{ color: D.text, fontSize: "0.82rem", fontVariantNumeric: "tabular-nums" }}>{sessions.length} sessions on {people.length} people's devices</div>}
      <div style={dim}>Ending a session signs that device out at once. Both actions are recorded.</div>
      {isLoading && <div style={dim}>Loading…</div>}
      {isError && <div style={{ color: D.red, fontSize: "0.8rem" }}>Could not load sessions.</div>}
      {message && <div role="status" style={{ color: D.green, fontSize: "0.8rem" }}>{message}</div>}
      {actionError && <div role="alert" style={{ color: D.red, fontSize: "0.8rem" }}>{actionError}</div>}
      {people.map(({ staff, sessions: own }) => {
        const isMe = own.some((s) => s.is_current);
        return (
          <div key={staff.id} style={{ borderTop: `1px solid ${D.divider}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: D.text, fontWeight: 700, fontSize: "0.85rem" }}>{staff.full_name}</span>
                <span style={{ background: ROLE_ACCENTS[staff.role] || D.textDim, color: ROLE_BADGE_TEXT[staff.role] || "#fff", borderRadius: 999, padding: "2px 8px", fontSize: "0.62rem", fontWeight: 800 }}>{staff.role.replace("_", " ")}</span>
              </div>
              {!isMe && (
                <button type="button" aria-label={`Sign out all of ${staff.full_name}'s devices`}
                  onClick={() => run(() => apiPost(`/api/accounts/staff/${staff.id}/sign-out-everywhere/`, {}), `${staff.full_name} is signed out of every device.`, "Could not sign them out.")}
                  style={button("#fff", D.red)}>Sign out all devices</button>
              )}
            </div>
            {own.map((s) => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: "0.75rem", color: D.text }}>
                <span>{s.device_label}{s.is_current ? " · this device" : ""}{s.two_factor ? " · 2-step" : ""} · {s.ip || "no IP"} · signed in {time(s.created_at)} · last seen {time(s.last_seen_at)} · idle sign-out {time(s.idle_ends_at)} · ends {time(s.ends_at)}</span>
                {!s.is_current && (
                  <button type="button" aria-label={`End ${staff.full_name}'s session on ${s.device_label}`}
                    onClick={() => run(() => apiPost(`/api/accounts/staff/sessions/${s.id}/end/`, {}), "Session ended.", "Could not end that session.")}
                    style={button("#fff", D.text)}>End session</button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7: Nav, shell and MSW defaults**

In `navModel.js` add to `NAV_ITEMS`, after the `staff` entry:
```javascript
  { id: "sessions", icon: "💻", label: "Sessions & Devices", show: (auth) => auth.hasPermission("staff.manage") },
```
and at the end of the list:
```javascript
  { id: "security", icon: "🔐", label: "Sign-in & Security", show: () => true },
```
In `AdminCommandCenter.jsx` import `SudoPrompt` (`./SudoPrompt.jsx`), `SecurityPanel` and `SessionsPanel`; render the panels after the `team-reports` line:
```javascript
          {activeTab === "security" && <SecurityPanel />}
          {activeTab === "sessions" && <SessionsPanel />}
```
and mount the prompt once, next to `<UpdateToast … />`:
```javascript
      <SudoPrompt />
```
In `frontend/mocks/handlers.js` add:
```javascript
  http.get('http://localhost:8000/api/accounts/staff/sessions/', () => HttpResponse.json([])),
  http.get('http://localhost:8000/api/accounts/staff/sessions/active/', () => HttpResponse.json([])),
  http.get('http://localhost:8000/api/accounts/staff/two-factor/', () => HttpResponse.json({ enabled: false, required: false, enabled_at: null, recovery_codes_left: 0 })),
```

- [ ] **Step 8: Run the frontend suite and the build**

```bash
cd frontend && npx vitest run 2>&1 | tail -8 && npm run build 2>&1 | tail -3
```
Expected: all pass (`StaffDashboard.test.jsx` unchanged); build succeeds.

- [ ] **Step 9: Commit**

```bash
git add frontend
git commit -m "feat(staff): password prompt, Sign-in & Security, Sessions & Devices and 2-step sign-in screens"
```

---

### Task 15: Verify end to end, update the docs, ship to staging

**Files:**
- Modify: `backend/CLAUDE.md`, `frontend/CLAUDE.md`, `CLAUDE.md` (root), `infra/README.md`
- Modify: `docs/superpowers/specs/2026-10-07-staff-foundations-design.md` (status line)

**Interfaces:**
- Consumes: Tasks 1–14.
- Produces: a branch ready for the PR flow, and the conventions future sessions need.

- [ ] **Step 1: Full verification**

```bash
$BT build web
$BT run --rm web python manage.py test --noinput 2>&1 | tail -5
$BT run --rm web python manage.py makemigrations --check --dry-run
cd frontend && npx vitest run 2>&1 | tail -6 && npm run build 2>&1 | tail -3
```
Expected: backend `OK`, `No changes detected`, frontend all green, build passes.

- [ ] **Step 2: Record the conventions**

Append to `backend/CLAUDE.md` under "Correctness cores — change with care":
```markdown
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
- **Approvals: the maker never decides.** A new kind registers an `ApprovalKind` in its app's
  `ready()`; `approvals.services.submit()` is the only way in, and `approve()` re-reads the target,
  refuses a stale one (409) and runs `apply` inside the decision's transaction.
- **`?format=` is DRF's renderer override.** An endpoint taking `?format=csv|xlsx|pdf` must set
  `content_negotiation_class = reports.exports.ExportNegotiation`, or DRF answers 404 before the
  view runs.
- **Background jobs and live updates run in-process under `manage.py test`** (eager Celery,
  in-memory channel layer, local-memory `realtime` cache). On-commit work needs
  `captureOnCommitCallbacks(execute=True)` in a `TestCase`; consumer tests that read the database
  need `TransactionTestCase` with `serialized_rollback = True`.
- **Live updates come from the activity log.** `realtime.publish.publish_activity` runs on commit
  of every `ActivityEvent`; a queue that should refresh live goes in `QUEUE_INVALIDATIONS`. Feed
  events reach only staff who could read that event through `GET /api/activity/`; permission
  groups get query keys, never labels. An `APIView` with `activity_exempt = True` is skipped by the
  activity middleware (used only for the realtime ticket).
```
Append to `frontend/CLAUDE.md` under "Gotchas that have already bitten":
```markdown
- **Staff menus are per role.** A new panel goes into `NAV_ITEMS` in
  `components/admin/shell/navModel.js` and its id into the right group of each role in
  `ROLE_MENUS` (and `DEFAULT_GROUPS`); anything a role's menu doesn't place shows under "More
  tools". Group labels must not repeat an item label.
- **Live updates refetch by query key.** `lib/realtime.js` (through `hooks/useRealtime.js` in the
  staff shell) calls `invalidateQueries({queryKey: [key]})` for each key the server names, so a
  staff hook's first query-key element is what `backend/realtime/publish.py` must send. The MSW
  default for `/api/realtime/ticket/` answers 503 so tests never open a socket.
- **Password re-entry is automatic.** A `403 {code: "sudo_required"}` from any `apiClient` call
  opens `SudoPrompt` and retries once; panels just show their usual error if it's cancelled.
```
In the root `CLAUDE.md` "Commands" section, after the backend line, add:
```markdown
Production compose runs `db`, `redis`, `web` (gunicorn + uvicorn workers, ASGI), `worker` and
`beat` (Celery). Locally, `docker compose up` needs no Redis (Django falls back to in-process
jobs and an in-memory channel layer); `--profile jobs` adds `redis`, `worker` and `beat`.
```
In `infra/README.md`:
- in "What runs where" add under the API rows: `Each environment's stack: db, redis (no host port), web (ASGI: HTTP + /ws/), worker, beat.`
- in "Files", change the compose row to "The `db`, `redis`, `web`, `worker` and `beat` stack, parameterised per environment; web, worker and beat share one image (`APP_IMAGE`)."
- in "Scheduled jobs", replace the activity-log sentences with: the nightly chain check now runs in Celery beat at 01:45 (`ACTIVITY_SEAL_EMAIL=True` in production emails the seal); beat also runs approval escalation (every 5 minutes), report reminders (18:00), session cleanup (03:30) and expired-export purging (04:00); **after this deploy reinstall the cron file** (the activity lines were removed) with the install line already in that section.
- add a "Live updates" section: the `/ws/` location in the API templates (plain prefix, never `^~`); clients connect with a single-use ticket; `docker compose -p <project> logs -f worker beat` for the job processes; `backend/private/` holds report exports and is bind-mounted into web and worker.
- add to the env-var notes: `REDIS_PASSWORD`, `REDIS_URL`, `STAFF_SECRETS_KEY` (required; the app refuses to start without it when `DJANGO_DEBUG=False`), `ACTIVITY_SEAL_EMAIL`.
In the spec, change the **Status** line to: `Design approved in conversation 2026-10-07 (Section 1). Implemented: plan 1A (F1, F3, F4, F7, F8) and plan 1B (F2, F5, F6, F9, F10).`

- [ ] **Step 3: Commit**

```bash
git add backend/CLAUDE.md frontend/CLAUDE.md CLAUDE.md infra/README.md docs/superpowers/specs/2026-10-07-staff-foundations-design.md
git commit -m "docs(staff): sessions, sudo, approvals, exports and live-update conventions; Redis, worker and beat ops"
```

- [ ] **Step 4: Ship to staging (needs the user's go-ahead for push and merge)**

This deploy signs every staffer out once: tokens minted before it have no session row. The spec (F5) says phases 1 and 2 reach staging together so the approvals inbox is never empty in use: ask the user whether to deploy 1B now (the inbox shows its honest empty state) or hold it for phase 2. Then follow the `deploy` skill (PR into `righteoushack`, then into `main`, staging deploy). Before the staging deploy, on the server add to `/opt/ashantihub-staging/backend/.env`: `REDIS_PASSWORD`, `REDIS_URL=redis://:<that password>@redis:6379/0` and `STAFF_SECRETS_KEY` (a fresh Fernet key). The deploy then brings up `redis`, `web`, `worker` and `beat` and waits for the worker. After it: reinstall the cron file; sign in with each `staging-<role>@example.com` account; as the Super Admin account, set up 2-step sign-in (it is now required) and save the recovery codes; check Approvals (empty, honest), write and submit a day report, review it from the Operations account, export it as CSV, Excel and PDF, and confirm Sessions & Devices lists the sessions.

**`/ws/` on staging needs an nginx template install, which this plan does not decide.** `deploy.sh` reinstalls templates only on production, and `install-hestia-templates.sh` renders the API template for *both* environments from whichever checkout runs it, so installing from the staging checkout also adds the (unused, harmless) `/ws/` location to the production API vhost. This plan changes only the API templates — confirm with `git diff origin/production -- infra/hestia/templates/ashantihub-spa.*` (must print nothing) — but changing production's nginx still needs the user's explicit go-ahead. Until then staging runs without live updates: the header shows "Live updates paused" after 30 s and the 60-second polling carries on. After any template install, confirm Let's Encrypt renewal still works before promoting. Production waits for the user.

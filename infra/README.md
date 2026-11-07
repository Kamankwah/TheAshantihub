# Server & deployment

Everything needed to run AshantiHub on the Hetzner server. Before this
existed, the deploy scripts and nginx configs lived only on the server
itself — when that server went away, so did they. Nothing in here should
ever exist only on the server again.

## What runs where

```
Hetzner CX33 (Ubuntu 26.04 LTS) — HestiaCP owns nginx, TLS and the firewall
│
├── theashantihub.com, www      static Vite build   /home/admin/web/theashantihub.com/public_html
├── api.theashantihub.com       proxy → 127.0.0.1:8000 (/ws/ → 8100)   /opt/ashantihub
└── api-test.theashantihub.com  proxy → 127.0.0.1:8001 (/ws/ → 8101)   /opt/ashantihub-staging

test.theashantihub.com is NOT on this server — Vercel builds it from `main`.
```

Each environment is a full git checkout with its own compose project, its own
database volume and its own `.env`. They share nothing, so a staging mistake
cannot reach production data.

Each environment's stack: `db`, `redis` (no host port), `web` (sync gunicorn, WSGI: all HTTP),
`realtime` (gunicorn with one uvicorn worker on `ashantihub.asgi:application`: `/ws/` only),
`worker`, `worker-money` and `beat`. `web` stays WSGI so a hung view is still killed by `--timeout` and Postgres
connections stay capped.

| | Production | Staging |
|---|---|---|
| Checkout | `/opt/ashantihub` | `/opt/ashantihub-staging` |
| Branch | `production` | `main` |
| Compose project | `ashantihub` | `ashantihub-staging` |
| API port (loopback) | 8000 | 8001 |
| Realtime port (loopback, `APP_PORT + 100`) | 8100 | 8101 |
| Gunicorn workers | 4 | 2 |
| Builds the frontend | yes | no (Vercel does) |

## Files

| Path | Purpose |
|---|---|
| `backend/Dockerfile.prod` | Production image: gunicorn, non-root. (`backend/Dockerfile` remains the dev image.) |
| `infra/compose/docker-compose.yml` | The `db`, `redis`, `web`, `realtime`, `worker`, `worker-money` and `beat` stack, parameterised per environment; all but `db` and `redis` share one image (`APP_IMAGE`, no default). |
| `infra/scripts/deploy.sh` | The deploy. Backs up, pulls, builds, migrates, publishes; on production also reinstalls the nginx templates when they changed. |
| `infra/scripts/backup-db.sh` | Verified private `pg_dump` + encrypted off-site copy (dump, media, private). Before every deploy and nightly. |
| `infra/scripts/restore-drill.sh` | Restores a dump into a throwaway Postgres and checks it (monthly). |
| `infra/scripts/install-hestia-templates.sh` | Installs the nginx templates below into HestiaCP. |
| `infra/hestia/templates/` | nginx vhost templates (SPA + API, plain and SSL). |
| `infra/env/backend.env.example` | Every environment variable the server needs, documented. |

## Deploying

Production only ever deploys the `production` branch, and `production` only
ever fast-forwards from `main`:

```bash
# from a laptop, after main is green and staging has been verified
git push origin origin/main:refs/heads/production

# on the server
ssh -i ~/.ssh/ashantihub_launch root@<server-ip>
bash /opt/ashantihub/infra/scripts/deploy.sh
```

Staging deploys `main` the same way, via
`/opt/ashantihub-staging/infra/scripts/deploy.sh`.

The script refuses to run without `.deploy.conf` and `backend/.env`, dumps the
database before migrating, and fails loudly with the last 60 log lines if the
API does not answer its health check afterwards.

Both `REDIS_URL` (a `redis://` URL) and `STAFF_SECRETS_KEY` must be set in
each environment's `backend/.env` before deploying (with `REDIS_PASSWORD`, and
neither still holding a `PASTE_` placeholder); `deploy.sh` exits with a `FATAL`
naming whatever is missing. It also brings up `redis`, `realtime` (the
WebSocket service, on `APP_PORT + 100`), `worker` and `beat`, and fails if the
Celery worker does not answer a ping.

The order is fixed: `db` and `redis`, migrations and static files, then `web`
and its health check; then (production) the frontend build and publish and the
HestiaCP template install; only then `realtime`, `worker` and `beat` with their
health check and worker ping. A fault in the job or live-update processes
therefore stops the deploy after the API and its matching frontend are already
live, never between them.

### Rolling out live updates (plan 1B)

Do each environment in turn, staging first.

1. Add `REDIS_PASSWORD`, `REDIS_URL` (the same password inside it) and
   `STAFF_SECRETS_KEY` to `backend/.env`. Generate the password with
   `openssl rand -hex 32` and the Fernet key (32 random bytes, URL-safe
   base64) with the host's Python, no image needed:
   `python3 -c "import base64,os;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"`
2. Production only: set `ACTIVITY_SEAL_EMAIL=True`. The old cron passed
   `--email-seal`; beat now reads this setting instead.
3. Run `deploy.sh`. The first run is still the previous script (it re-execs
   from a copy), which stops at compose with the `APP_IMAGE` error, by design.
   Run it again.
4. Reinstall `infra/cron/ashantihub.cron` by hand
   (`install -m 644 /opt/ashantihub/infra/cron/ashantihub.cron /etc/cron.d/ashantihub`);
   the activity-chain lines moved to beat.
5. Remove the old image: `docker image rm ashantihub-web` (staging:
   `ashantihub-staging-web`).
6. `/ws/` needs `install-hestia-templates.sh`, which renders BOTH API vhosts
   from the production checkout. Installing it for staging therefore also adds
   an inert `/ws/` to production: it answers 502 until production runs
   `realtime`, and the staff UI falls back to polling. Needs the owner's
   go-ahead.

Production deploys (`SERVE_FRONTEND=yes`) also run
`install-hestia-templates.sh` automatically when the current
`infra/hestia/templates/` tree differs from the one recorded in the untracked
`.templates-installed` marker at the checkout root. The marker is written only
after a successful install, so a retry after a failed deploy still installs,
and a missing marker (first run) installs too; installing is idempotent. This
is how template changes (such as the no-cache headers for `/sw.js`) take effect
without a manual step. Set `FORCE_TEMPLATES` to `1`, `yes` or `true` (any case)
to reinstall regardless:
`FORCE_TEMPLATES=1 bash /opt/ashantihub/infra/scripts/deploy.sh`. If the
installer fails, the deploy exits non-zero after the app is already live; the
on-disk vhosts may be invalid, so do not reload nginx until the templates are
fixed and the deploy re-run.

The installer sets Hestia's environment itself (`HESTIA=/usr/local/hestia`, `$HESTIA/bin` on `PATH`), because a non-login SSH shell has neither, and it fails with `FATAL` if `v-rebuild-web-domains` is missing instead of silently skipping the rebuild.

The first promotion that includes this change still runs the previous deploy.sh (the script re-execs itself before pulling). Afterwards run `bash /opt/ashantihub/infra/scripts/deploy.sh` once more (no marker yet, so it installs), or run `bash /opt/ashantihub/infra/scripts/install-hestia-templates.sh` by hand; then confirm `/opt/ashantihub/.templates-installed` exists.

Staging never runs the installer: it installs the SPA templates from whichever
checkout runs it and rebuilds every domain, so running it from staging would
push unreleased templates onto the production domain. Note the reverse
coupling: a production template install also re-renders the **staging** API
vhost from the production checkout's `ashantihub-api.tpl.in`, so a staging
API-template change that has not been promoted can be reverted by a production
deploy.

## Provisioning a checkout

Only needed when building a new server or adding an environment.

```bash
git clone https://github.com/Kamankwah/TheAshantihub.git /opt/ashantihub
cd /opt/ashantihub && git checkout production
git config --global --add safe.directory /opt/ashantihub

cp infra/env/backend.env.example backend/.env   # then fill in the secrets

cat > .deploy.conf <<'CONF'
ENV_NAME=production
BRANCH=production
PROJECT=ashantihub
APP_PORT=8000
GUNICORN_WORKERS=4
SERVE_FRONTEND=yes
WEB_ROOT=/home/admin/web/theashantihub.com/public_html
WEB_USER=admin
BACKUP_RETENTION_DAYS=14
CONF

bash infra/scripts/install-hestia-templates.sh
bash infra/scripts/deploy.sh
```

Staging is identical with `ENV_NAME=staging`, `BRANCH=main`,
`PROJECT=ashantihub-staging`, `APP_PORT=8001`, `GUNICORN_WORKERS=2`,
`SERVE_FRONTEND=no`.

Two optional keys in the production `.deploy.conf` set the map tiles of the SPA that
`deploy.sh` builds (they are passed to the frontend build container; nothing is committed):

```bash
VITE_MAPBOX_TOKEN=pk.<your public token>   # a public Mapbox token restricted to the site's URL
VITE_MAP_TILES_PROVIDER=mapbox             # defaults to osm when absent
VITE_SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>   # browser error reporting; absent = off (a DSN is public)
VITE_SENTRY_ENVIRONMENT=production         # defaults to the ENV_NAME above
```

Both are public values baked into the page (the token is a public `pk.` token, never a
secret one, so restrict it by URL in the Mapbox dashboard: for production list **both**
`https://theashantihub.com/*` and `https://www.theashantihub.com/*` (the Hestia vhost serves the
www alias too, and a token restricted to the bare host gets 403s on it), and for staging
`https://test.theashantihub.com/*`, the Vercel host named above).
Leave them unset and every map shows OpenStreetMap streets, with no satellite switch. Staging
has `SERVE_FRONTEND=no`; its SPA is on Vercel, so set the same two names in the Vercel project
environment instead.

The first deploy creates an empty database. Create the first staff login with:

```bash
docker compose -p ashantihub -f /opt/ashantihub/infra/compose/docker-compose.yml \
  run --rm web python manage.py create_super_admin
```

## Day-to-day operations

Commands assume production; swap the project name and path for staging.

```bash
C="docker compose -p ashantihub -f /opt/ashantihub/infra/compose/docker-compose.yml"

$C ps                        # what is running
$C logs -f --tail=100 web    # application log (gunicorn + Django)
$C restart web               # restart the app only
$C run --rm web python manage.py <command>

tail -f /var/log/nginx/domains/api.theashantihub.com.error.log
```

Logs are captured by Docker and capped at 10MB x 5 files per container, so
they cannot fill the disk.

Those `docker compose` commands rely on `infra/compose/.env`, which `deploy.sh`
writes from `.deploy.conf`. It carries `APP_PORT` and `GUNICORN_WORKERS`, and
Compose picks it up automatically because it sits next to the compose file. If
it is missing, a manual `up -d` falls back to the built-in defaults and
publishes the wrong port — staging lands on production's, or on nothing at all
and the site 502s. Re-run `deploy.sh` rather than recreating it by hand.

## Database roles

The application does **not** connect to Postgres as the owner (review DB-05). Two roles:

| Role | Used by | Can |
|---|---|---|
| `POSTGRES_USER` (owner, the container's bootstrap superuser) | `migrate`, `provision_db_roles`, backups; only ever passed to those one-off tasks | everything |
| `POSTGRES_APP_USER` (runtime) | gunicorn, realtime, both Celery workers, beat, cron jobs, `compose run web ...` | read/write rows. Not a superuser; owns nothing; cannot create objects, drop or disable the append-only triggers, `TRUNCATE`, `DELETE` from the ledger / activity log / consent tables, or run `COPY ... PROGRAM` |

How it fits together: `deploy.sh` reads both pairs from `backend/.env`, writes the runtime pair into `infra/compose/.env`
(`DB_USER`, `DB_PASSWORD`, mode 0600), and `docker-compose.yml` sets `POSTGRES_USER` / `POSTGRES_PASSWORD` for every app
container from them - `environment` outranks `env_file`, so the owner's password in `backend/.env` never reaches a container.
Each deploy then runs, in order: `migrate` as the owner (`DJANGO_DB_ROLE=owner`), `provision_db_roles` as the owner
(idempotent; default privileges make tables a later migration creates usable by the runtime role), and
`manage.py check --database default` **as the runtime role**, which fails the deploy (`core.E004`) if that role can connect as a
superuser. All of this happens before the new containers start.

**One-time setup per server:** add `POSTGRES_APP_USER=ashantihub_app` and `POSTGRES_APP_PASSWORD=$(openssl rand -hex 24)` to
`backend/.env` (see `infra/env/backend.env.example`) and deploy. Until you do, `deploy.sh` stops at the start with the missing keys
named. Between writing `infra/compose/.env` and the role being created (a few minutes, first deploy only) the host cron's
`expire_events` run would fail to connect and be retried the next hour.

**A one-off task that needs DDL** (rare - normally a migration does it) runs as the owner:
`POSTGRES_USER=<owner> POSTGRES_PASSWORD=<owner pw> docker compose -p <project> -f infra/compose/docker-compose.yml run --rm -e POSTGRES_USER -e POSTGRES_PASSWORD -e DJANGO_DB_ROLE=owner web python manage.py <command>`.
Rotating the runtime password: change it in `backend/.env`, deploy (`provision_db_roles` applies it, the containers restart with it).
Still true after this change: the owner is the container's bootstrap superuser (Postgres will not demote it), so the protection is
that no running application process holds its password. The staging database must use its own pair of passwords.

## Database behaviour and visibility

Review DB-09. In a deployed process (not DEBUG, not tests, not the owner tasks) `settings.py` gives every connection:

- a **reused connection** (`DB_CONN_MAX_AGE`, default 60 s; `realtime` sets 0 because ASGI threads would leak persistent
  connections) that is health-checked before reuse;
- **`statement_timeout` 60 s** (`DB_STATEMENT_TIMEOUT_MS`; Celery workers and beat run with 600 s, the task limit),
  **`lock_timeout` 20 s** (`DB_LOCK_TIMEOUT_MS`; workers 60 s) and **`idle_in_transaction_session_timeout` 60 s**
  (`DB_IDLE_IN_TRANSACTION_TIMEOUT_MS`). A request that hits one gets a 500 and a log line instead of holding a worker and its
  locks indefinitely; a *money* request that times out on a lock did not move money (it is in a transaction), so the client retries
  with the same `request_id`;
- no development password fallback: a process without `POSTGRES_PASSWORD` refuses to start.

The `db` container runs with `pg_stat_statements` preloaded, `log_min_duration_statement=500` (anything slower than half a second
is in `docker logs <project>-db-1`), `log_lock_waits=on`, and modest memory settings for the shared server (`shared_buffers=256MB`,
`work_mem=8MB`, ...). Changing any of those flags restarts Postgres, so **the deploy that first ships this recreates the `db`
container: do it at a quiet time**. See what is slow: as the owner,
`docker compose -p ashantihub -f infra/compose/docker-compose.yml exec db psql -U ashantihub -c "select calls, round(total_exec_time) ms, left(query,90) from pg_stat_statements order by total_exec_time desc limit 15"`.
Not done: pinning the Postgres minor version. Check `select version()` on each server and set `image: postgres:16.x` to what is
running now (never to an older minor).

**Ledger integrity (review DB-06).** The database refuses, at commit, any transaction that leaves a ledger journal with credits
different from debits (ledger migration 0015, a deferred constraint trigger). Every night at 02:00 `ledger.tasks.verify_ledger_integrity`
re-derives each journal, each cached account balance and the trial balance from the journal lines
(`ledger/integrity.py`); a difference is logged at ERROR (Sentry), opens one fraud case for the day and notifies `wallets.view`
holders. It corrects nothing: investigate, and do not post to the ledger until it is understood. It runs whether or not the
ledger switch is on.

## Personal data encryption

Review DB-03. Ghana Card and TIN numbers, bank and mobile-money numbers (business profiles and payout destinations), customers'
dates of birth and rider document numbers are stored as `enc1:<Fernet token>` (`core/pii.py`); the application sees plain values, a
dump or a read-only SQL account sees ciphertext. Duplicate checks (one Ghana Card per business, one payout account per holder, a
phone already used as a payout number) run on HMAC "blind indexes" in `*_idx` columns.

- **Keys.** `PII_ENCRYPTION_KEYS` (Fernet, newest first) and `PII_INDEX_KEY` in each server's `backend/.env`; `deploy.sh` refuses to
  run without them. **Keep both in the owner's password manager, outside the server and outside the backups.** Without them the
  encrypted columns and every backup of them are unreadable. Staging and production use different keys. The restore drill needs the
  production keys (it reads them from `backend/.env`), and so does any restore onto a new server: restore `backend/.env` first.
- **First deploy.** Migrations change the columns to `text` (existing values stay readable as legacy plaintext); `deploy.sh` then
  runs `manage.py encrypt_pii`, which encrypts the rest and fills the indexes. It is idempotent and safe to interrupt; run it by
  hand with `--dry-run` first if you want the counts. Take the pre-deploy dump (automatic) - it is the way back.
- **Rotating a key.** Put the new key first in `PII_ENCRYPTION_KEYS` (keep the old one after it), deploy, run
  `manage.py encrypt_pii --reencrypt`, then remove the old key. Test the order on staging.
- **Not covered:** phone numbers and e-mail addresses (they are the sign-in identifiers and are searched constantly), names, delivery
  addresses, and uploaded images (those are private files, `core/private_files.py`).

## Retention and data requests

Review DB-04. `accounts.tasks.scrub_expired_personal_data` runs daily at 03:15: delivery details on orders and support-conversation
text are blanked once the account has been deleted for `PII_DELETED_ACCOUNT_GRACE_DAYS` (default 90) or the order is older than
`PII_ORDER_RETENTION_DAYS` (default 6 years); notifications older than `NOTIFICATION_RETENTION_DAYS` (default 365) are deleted. Money
records are untouched. These periods are the dev's defaults - the owner and counsel set the real ones in `backend/.env`. A person's
own data comes from `GET /api/accounts/me/export/`. Customer and owner IPs in the activity log are stored truncated; rows written
before this change keep the full address (the hash chain covers them), and the lawful basis for the log is for counsel to document.

## Duplicate accounts

Review DB-13. Two accounts cannot share an e-mail that differs only by case, or a phone that is the same number written two ways.
The migration that creates those unique indexes skips one (with a `WARNING ... NOT created` line in the `migrate` output) when old
rows already collide. After a deploy, run `manage.py find_identity_duplicates`: if it lists anything, merge or fix those accounts, then
re-run `migrate` after unapplying that migration (`migrate accounts 0083` then `migrate`) to create the index.

## Backups

**Targets (set by the owner, review DB-01):** lose at most **24 hours** of data today (nightly dump) - **15 minutes** once
WAL archiving is added (below); be serving again within **4 hours**. The restore drill measures the real figure.

`backup-db.sh` runs before every deploy and nightly at 02:30 by cron. Each run:

1. writes a verified, gzipped dump to `<checkout>/backups/` (directory `0700`, files `0600`; kept 14 days). The dump holds
   every payout number and Ghana Card number, so it is never world-readable;
2. copies that dump **and** `backend/media` and `backend/private` (ID photos, listing photos) to an **encrypted off-site
   restic repository**, keeping 14 daily, 8 weekly and 12 monthly snapshots;
3. pings `BACKUP_PING_URL` when all of that worked, and `<url>/fail` when it did not. Make the URL a dead-man's-switch
   check (healthchecks.io or similar, period 1 day, grace 2 hours): a backup that silently stops running then alerts too.

A nightly run fails (non-zero, `/fail` ping) when the db container is down, the dump is bad, or the off-site copy fails.
`deploy.sh` runs it with `BACKUP_OFFSITE_OPTIONAL=1`, so the off-site service being down warns but never blocks a deploy.

**One-time setup per server (owner action - this is what makes the backup real):**

```bash
apt install restic
install -d -m 700 /etc/ashantihub
cat > /etc/ashantihub/backup.env <<'ENV'      # root-only; shared by production and staging, which use separate tags
RESTIC_REPOSITORY=sftp:u123456@u123456.your-storagebox.de:ashantihub   # a Hetzner Storage Box / another provider or region
RESTIC_PASSWORD=<long random string>      # ALSO store this in the owner's password manager: without it the copies are unreadable
BACKUP_PING_URL=https://hc-ping.com/<uuid>
DRILL_PING_URL=https://hc-ping.com/<another-uuid>   # monthly drill check, period 35 days
ENV
chmod 600 /etc/ashantihub/backup.env
# SFTP target: add root's public key to the Storage Box, then `ssh -p 23 u123456@... ls` once to accept the host key.
bash /opt/ashantihub/infra/scripts/backup-db.sh        # first run creates the repository
```

An S3-style target needs `RESTIC_REPOSITORY=s3:https://...` plus `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in the same file.
Until `RESTIC_REPOSITORY` is set, every run prints `OFF-SITE BACKUP IS NOT CONFIGURED` and pings `/fail`.

**Restoring.** Always into an empty database; never pipe a dump into a populated one.

```bash
cd /opt/ashantihub && C="docker compose -p ashantihub -f infra/compose/docker-compose.yml"
$C stop web realtime worker worker-money beat               # nothing may write while we restore
$C exec -T db psql -U ashantihub -d postgres -c 'DROP DATABASE ashantihub' -c 'CREATE DATABASE ashantihub OWNER ashantihub'
gunzip -c backups/production-YYYYMMDD-HHMMSS.sql.gz | $C exec -T db psql -U ashantihub -d ashantihub -v ON_ERROR_STOP=1 --single-transaction
$C up -d                                                    # then check /api/readyz/
# From the off-site copy instead (new server, lost disk):
#   restic restore latest --tag production --host ashantihub --target /restore     # dump, backend/media, backend/private
```

**Restore drill.** `infra/scripts/restore-drill.sh [offsite|<dump>]` restores a dump into a throwaway Postgres container on
its own network (the live database is never touched), checks that every ledger journal balances, runs `manage.py check`
against the restored data with the release image, and logs the result and the time taken to `backups/restore-drill.log`.
`offsite` restores the newest dump out of the encrypted repository and runs `restic check` on a sample, so it proves the
off-site copy too. Cron runs it monthly on production. Record the first real run in `backups/restore-drill.log` and compare
its time with the 4-hour target.

**Still outstanding:** point-in-time recovery. It needs WAL archiving (`archive_mode=on`, pgBackRest or WAL-G shipping to the
same off-site target) and a change to the `db` service; until then the worst case is the 24 hours since the last dump.

## Scheduled jobs

`infra/cron/ashantihub.cron` holds the host cron jobs (backups, `expire_events`
and the monthly OSRM data refresh); output goes to `/var/log/ashantihub-cron.log`, except the OSRM
refresh, which logs to `/var/log/ashantihub-osrm.log`. The activity
log (`activity_activityevent`) is append-only and hash-chained: Postgres
triggers refuse `UPDATE`/`DELETE`, so never "fix" a row by hand. Its nightly
chain check now runs in Celery beat at 01:45 (`ACTIVITY_SEAL_EMAIL=True` in
production emails the seal to Super Admins; staging only verifies). Beat also
runs approval escalation (every 5 minutes), day-report reminders (18:00),
staff-session cleanup (03:30), expired-export purging (04:00), the
stuck-export reaper (every 15 minutes), the subscription clock (hourly, at
minute 5), the nightly business-health snapshot (02:15) and staged-photo
purging (04:30). The schedule is `CELERY_BEAT_SCHEDULE` in
`backend/ashantihub/settings.py`.

**Rolling out phase 2A.** No new services. One new setting,
`SUBSCRIPTION_PAUSE_ENABLED` (backend env, default `False`): it switches the
subscription clock's pause. Leave it off - no business is ever paused or
hidden for an unpaid subscription, so the first run carries no mass-pause
risk. Turn it on only when real payments (the planned in-app wallet) can renew
automatically; while it is on, a business unpaid 14 days after its
subscription lapsed has its listings and events hidden until it pays.
Switching it on pauses every subscription already 14+ days overdue on the next
hourly run, and those owners were never warned about hiding: turn it on only
together with automatic renewal, or first reset `overdue_since` to the
switch-on time.

The first subscription-clock run (minute 5 of the first hour after the deploy)
marks every lapsed subscription overdue (with the pause on, one that lapsed
more than a day earlier gets its full 14-day grace from that run, so nothing
is hidden at once). Each owner is told in the app, and owners with an email on
file are emailed on that first run. A business with no working account
manager (none, or one who left or is suspended) notifies **every
`portfolio.manage` holder** on days 1, 7 and 13; a managed one gives its
account manager a task instead.

**Before promoting 2A to production,** count what the first run will touch
with this read-only query (it changes nothing):

```bash
docker compose -p ashantihub -f /opt/ashantihub/infra/compose/docker-compose.yml run --rm --no-deps web python manage.py shell -c "from django.db.models import Q; from django.utils import timezone; from billing.models import Subscription; s = Subscription.objects.filter(overdue_since__isnull=True, paused_at__isnull=True, current_period_end__lte=timezone.now()); m = Q(business_owner__account_manager__isnull=True) | Q(business_owner__account_manager__is_active=False) | Q(business_owner__account_manager__is_suspended=True); print('lapsed:', s.count(), '| no working account manager:', s.filter(m).count(), '| owner has an email:', s.exclude(business_owner__email__isnull=True).exclude(business_owner__email='').count())"
```

`lapsed` subscriptions go overdue on the first run; `owner has an email` is
how many owner emails that run sends; each one with `no working account
manager` sends a notification to every Operations lead (and Super Admin) on
days 1, 7 and 13 — assign scouts first if that number is large. Check that
`SUBSCRIPTION_PAUSE_ENABLED` is unset or `False` in the environment's backend
env file before the deploy.

To give the staging scout demo businesses, run once on staging only. First
check that staging's `SENTRY_ENVIRONMENT` is `staging` (the command refuses
otherwise), then choose a demo-owner password (never commit it) and pass it:

```bash
docker compose -p ashantihub-staging -f /opt/ashantihub-staging/infra/compose/docker-compose.yml \
  run --rm --no-deps web python manage.py seed_phase2_demo --password '<chosen password>'
```

**After the plan 1B deploy, reinstall the cron file on the server** (the
activity-chain lines were removed from it; the install line is in the file's
header):

```bash
install -m 644 /opt/ashantihub/infra/cron/ashantihub.cron /etc/cron.d/ashantihub
```

## Road routing (OSRM)

Delivery distances and ETAs come from an OSRM container (`osrm` in the compose
file) serving road data for the Ashanti Region. It is in the `routing` compose
profile, so `deploy.sh` never starts it and never waits on it: a deploy is safe
before any data exists. The build script starts it.

**First build, per environment** (staging is built by hand once; production's
first build is also by hand, cron only does the monthly refresh):

```bash
bash /opt/ashantihub/infra/scripts/build-osrm-data.sh ashantihub /opt/ashantihub/infra/compose/docker-compose.yml
# staging
bash /opt/ashantihub-staging/infra/scripts/build-osrm-data.sh ashantihub-staging /opt/ashantihub-staging/infra/compose/docker-compose.yml
```

It downloads Ghana from Geofabrik, clips it to the Ashanti bounding box,
builds the routing graph into the `osrm-data` volume and starts `osrm`
(a few minutes; needs a couple of GB of free disk and RAM while it runs). Then
set `OSRM_URL=http://osrm:5000` in that checkout's `backend/.env` (never
committed; `OSRM_TIMEOUT_S` defaults to 2.0; both are in `infra/env/backend.env.example`) and
recreate the app services so they read it. A plain `restart` is not enough: it
keeps the container's old environment and does not re-read `env_file`, so use
`up -d --force-recreate` (or re-run `deploy.sh`):

```bash
docker compose -p ashantihub -f /opt/ashantihub/infra/compose/docker-compose.yml up -d --force-recreate web realtime worker worker-money beat
```

**Service area.** `routing/region.py` refuses checkouts outside an approximate
rectangle around Ashanti. The rectangle is about 1.9 times the area of the
region itself and is known to admit parts of neighbouring regions (for example
Sunyani, Goaso, Sefwi Wiawso, Berekum, Bibiani, Nkawkaw, Akim Oda and Kade). It
must be replaced by the OpenStreetMap administrative boundary plus a small
buffer before delivery coverage is relied on.

**Fallback.** With `OSRM_URL` blank, or OSRM stopped or failing, every screen
falls back to the straight-line estimate and labels it "estimate" instead of
"road route"; the delivery manager screens show a routing note. Nothing breaks
and nothing is hidden. Recovery is automatic within about 30 seconds of OSRM
coming back.

**Monthly refresh.** `infra/cron/ashantihub.cron` runs the build script at
04:30 on the 1st, production only, under `flock` so two builds never overlap,
logging to `/var/log/ashantihub-osrm.log`. Each build goes into its own
`build-<timestamp>` directory in the `osrm-data` volume, and the `current`
symlink that `osrm` serves is switched only after extract, partition and
customize all succeed; then `osrm` is recreated to load it. A failed build
removes its partial directory and leaves `current` (and so the running or
rebooted routing) on the last good data; check the log and rerun. Only the
newest build and the previous one are kept. Reinstall the cron file after
pulling this change (install line in its header).

Two builds at once are unsafe: cron is protected by `flock`, so run a manual
build under the same lock (`flock -n /var/lock/ashantihub-osrm.lock bash ...`).

`docker compose down` ignores profiled services unless `--profile routing` is
passed, so `osrm` keeps running through a normal `down`/`up` of the app.

## Live updates

- Staff dashboards receive live updates over WebSocket. The API templates
  carry a `/ws/` location proxying to `127.0.0.1:__REALTIME_PORT__` (the
  `realtime` service). It is a plain prefix location, never `^~`, and has
  `access_log off` because the URL carries a single-use ticket. Clients obtain
  the ticket from `POST /api/realtime/ticket/`.
- Job processes: `docker compose -p <project> logs -f worker beat`.
- `backend/private/` holds report exports, rider papers and (under `kyc/`) the owners' Ghana Card photos and
  registration certificates. It is bind-mounted into `web` and `worker`, and only a permission-checked view or a
  15-minute signed link (`/api/core/private-file/`) serves it. nginx never serves it, and the API templates return 404
  for the old `/media/ghana_cards/` and `/media/business_reg_certificates/` paths. `deploy.sh` runs
  `manage.py move_identity_files_private` after migrating (moves any identity file still under `backend/media/` into
  `backend/private/kyc/`; safe to repeat). **`backend/private/` must be in the backup** (see the backup section).
- Env vars in `backend/.env`: `REDIS_PASSWORD`, `REDIS_URL`,
  `STAFF_SECRETS_KEY` (required: the app refuses to start without it when
  `DJANGO_DEBUG=False`) and `ACTIVITY_SEAL_EMAIL` (production `True`).
  `deploy.sh` writes `APP_IMAGE`, `APP_PORT` and `REALTIME_PORT` to the
  compose `.env` itself.

## Mail

**Mailboxes live at 20i, not here.** `theashantihub.com` MX points at
`mx.stackmail.com`, so 20i receives all mail for the domain and staff read it
through 20i webmail. `demarbells.com` is on the same 20i account and is
untouched. This server hosts no mailboxes: Dovecot is installed but disabled
and ClamAV was removed, because with no inbound mail there is nothing to serve
or scan. Inbound mail ports (25, 143, 465, 587, 993, 995) are closed at the
firewall.

Exim stays, for one job: the app's outbound queue. Django hands mail to it
(`EMAIL_HOST=host.docker.internal`, see the `extra_hosts` entry in
`infra/compose/docker-compose.yml`) and Exim relays it to
`smtp.stackmail.com:587`, authenticating as `no-reply@theashantihub.com`.
Queuing is the point: if 20i is briefly unreachable, mail waits and retries
instead of being lost inside a web request. Hetzner blocks outbound port 25 on
Cloud servers, so relaying is not optional — direct delivery is impossible
until they lift that block.

**Every sender must be `no-reply@theashantihub.com`.** 20i rejects anything
else outright (`550 Cannot send a message as <addr>`), which is why
`DEFAULT_FROM_EMAIL` and `SERVER_EMAIL` are both set to it, and why a rewrite
rule maps locally generated system mail (cron, unattended-upgrades, root) onto
it. Without that rule every cron failure notice would bounce.

Three changes to `/etc/exim4/exim4.conf.template` are hand-made and will be
silently lost if a HestiaCP upgrade rewrites that file:

1. `hostlist relay_from_hosts` has `172.16.0.0/12` appended, so the app
   containers may submit mail. Without it Django gets `550 relay not permitted`.
2. The `begin rewrite` section maps `*@server.theashantihub.com` and
   `*@localhost` to `no-reply@theashantihub.com`.
3. The three `.ifdef CLAMD` blocks are renamed `CLAMD_DISABLED`, since ClamAV
   is gone.

After any Hestia upgrade: `exim4 -bV` to check it parses, then confirm all
three are still present and send one test message.

The relay credentials are stored twice, both root-only: `/etc/exim4/smtp_relay.conf`
(written by `v-add-sys-smtp-relay`, which Exim reads) and
`/etc/ashantihub/smtp-relay.conf` (a copy kept for reference). Mail DNS lives
at GoDaddy — MX to `mx.stackmail.com`, SPF `include:spf.stackmail.com`, DKIM on
20i's `s1` selector, and DMARC.

```bash
exim4 -bp                     # queue (empty is healthy)
exim4 -qff                    # force a queue run
exim4 -Mrm <id>               # drop a frozen message
tail -f /var/log/exim4/mainlog
```

## Container secrets

`deploy.sh` copies only `POSTGRES_*` into `infra/compose/db.env` and `REDIS_PASSWORD` into `infra/compose/redis.env`
(mode 0600, untracked) for the `db` and `redis` containers; only the app containers read the full `backend/.env`. Run a
deploy before any hand-written `docker compose` command on a checkout that predates this, or compose will not find the
two files.

## Background job queues

`worker` consumes the `celery` (default) and `slow` queues; `worker-money` consumes `money` only, so payment expiry,
refunds, withdrawals, ledger postings and the subscription clock never wait behind report exports, video conversions or
bulk texts. The routing is `CELERY_TASK_ROUTES` in `backend/ashantihub/settings.py`; a new queue must be added there
and to a worker's `-Q` list, or its tasks silently never run. Every task has a 10-minute soft / 11-minute hard time
limit. Redis keeps an append-only file on the `redis-data` volume, so queued jobs survive a restart. The first deploy
after this change re-creates Redis (jobs queued at that instant are lost - deploy at a quiet time) and starts
`worker-money` (about 150 MB more memory per environment).

## Releases and rollback

- Each deploy builds `<project>-app:<git sha>` (web, realtime, worker and beat all run that one image); the five most
  recent stay on the server. `bash infra/scripts/rollback.sh` lists them and `rollback.sh <sha>` restarts the four
  services on an earlier one in about a minute, without a rebuild. It swaps code only - the database is not touched.
- That is safe because migrations must work for both the new and the previous release: `core/migration_lint.py` (run
  by CI on every pull request) rejects a migration that removes or renames a column or table, rewrites a column, adds a
  NOT NULL column with no default, or builds an index under a lock, unless a reviewer marks it
  `# lint-migrations: ok <reason>`. Remove a column in a *later* release than the one that stops using it.
- `deploy.sh` runs `migrate` with `lock_timeout=15s` while the old containers still serve: a migration that cannot get
  its lock fails the deploy and the site stays up on the previous release.
- If a bad release damaged data, restoring the pre-deploy dump (`Backups`, below) is a separate, deliberate step.

## Health and uptime

- `GET /api/health/` is **liveness**: the process answers (Docker's healthcheck uses it). `GET /api/readyz/` is **readiness**:
  200 only when the database answers, else 503 (Redis is reported but not required). `deploy.sh` waits on `readyz`, so a
  deploy whose database is unreachable fails instead of reporting success.
- External probe: `.github/workflows/uptime.yml` checks `/api/readyz/` for production and staging every 5 minutes from
  GitHub's machines (3 tries, 20 s apart); a failed run emails the repo's notification recipients, and the repository
  secret `ALERT_WEBHOOK_URL` (Slack / Discord / ntfy) adds a chat alert. GitHub runs schedules only from the default
  branch, so it starts once this is merged to `main`. `infra/scripts/uptime_probe.sh` is the same check as a cron job
  for a second host (it also alerts on recovery).

## Error reporting

Sentry receives every unhandled exception, tagged with the environment
(`SENTRY_ENVIRONMENT`). It is off wherever `SENTRY_DSN` is blank, which
includes dev and the test suite.

Django's `mail_admins` handler is wired up but silent: it needs both
`DJANGO_ADMIN_EMAILS` and a real SMTP backend, and email is not configured
yet.

## Known gaps

- **All mail depends on one 20i mailbox.** Everything the app sends is
  authenticated as `no-reply@theashantihub.com` and rejected under any other
  sender, so changing that mailbox's password without updating
  `/etc/exim4/smtp_relay.conf` stops every password reset, staff invite and
  error report. The failure is quiet from the app's side — Django reports
  success and Exim accepts the message; the rejection only shows up in
  `/var/log/exim4/mainlog`. Worth a queue check (`exim4 -bp`) after any change
  to that mailbox.
- **Backups are on the same disk as the database.** A disk failure loses
  both. They should be copied to Hetzner Object Storage or a Storage Box.

## Browser security headers (review FE-03)

`ashantihub-spa.stpl` sends `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`
(camera and geolocation for this origin only) and a **`Content-Security-Policy-Report-Only`**. nginx drops inherited
`add_header` lines inside any location that sets its own, so the block is repeated in every location; keep the copies identical
(`frontend/__tests__/securityHeaders.test.js` checks it). HSTS still comes from Hestia's `nginx.hsts.conf`.

Rolling out: the new template reaches the server through the normal production deploy (`install-hestia-templates.sh` runs when the
templates tree changed). Browse staging with the console open and note every CSP violation; once none remain, rename the header to
`Content-Security-Policy` in both files and tighten `connect-src` from `https: wss:` to the API and realtime origins.
Never add a `^~ /.well-known/` location to this file.

## Mobile minimum version (review MOB-01)

`MOBILE_MIN_VERSION` (blank = off) and `MOBILE_STORE_URL` in the server `.env` make the API answer a too-old mobile build with
`426 upgrade_required` (`core/app_version.py`; `/api/core/health/`, webhooks and web/staff traffic are exempt). Procedure and the
OTA rollback steps: `docs/mobile-release/UPDATES_AND_ROLLBACK.md`.

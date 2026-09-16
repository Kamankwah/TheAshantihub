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
├── api.theashantihub.com       proxy → 127.0.0.1:8000   /opt/ashantihub
└── api-test.theashantihub.com  proxy → 127.0.0.1:8001   /opt/ashantihub-staging

test.theashantihub.com is NOT on this server — Vercel builds it from `main`.
```

Each environment is a full git checkout with its own compose project, its own
database volume and its own `.env`. They share nothing, so a staging mistake
cannot reach production data.

| | Production | Staging |
|---|---|---|
| Checkout | `/opt/ashantihub` | `/opt/ashantihub-staging` |
| Branch | `production` | `main` |
| Compose project | `ashantihub` | `ashantihub-staging` |
| API port (loopback) | 8000 | 8001 |
| Gunicorn workers | 4 | 2 |
| Builds the frontend | yes | no (Vercel does) |

## Files

| Path | Purpose |
|---|---|
| `backend/Dockerfile.prod` | Production image: gunicorn, non-root. (`backend/Dockerfile` remains the dev image.) |
| `infra/compose/docker-compose.yml` | The `web` + `db` stack, parameterised per environment. |
| `infra/scripts/deploy.sh` | The deploy. Backs up, pulls, builds, migrates, publishes. |
| `infra/scripts/backup-db.sh` | Verified gzipped `pg_dump`. Runs before every deploy and nightly. |
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

## Backups

`backup-db.sh` writes verified, gzipped dumps to `<checkout>/backups/` and
keeps 14 days. It runs before every deploy, and nightly at 02:30 by cron.

```bash
# restore a dump into the running database (destructive — take a dump first)
gunzip -c /opt/ashantihub/backups/production-YYYYMMDD-HHMMSS.sql.gz \
  | docker compose -p ashantihub -f /opt/ashantihub/infra/compose/docker-compose.yml \
    exec -T db psql -U ashantihub -d ashantihub
```

These dumps sit on the same disk as the database. Copying them off the server
is still outstanding — see below.

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

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

The server runs its own mail stack: **Exim 4.99** (SMTP), **Dovecot 2.4** (IMAP/POP3)
and **ClamAV 1.5** (attachment scanning), managed through HestiaCP. It hosts
mailboxes for `theashantihub.com` only — `demarbells.com` stays with its own
provider and is untouched.

Django does not talk to an external mail provider directly. It hands mail to
the host's Exim (`EMAIL_HOST=host.docker.internal`, see the `extra_hosts` entry
in `infra/compose/docker-compose.yml`), which queues it, signs it with DKIM and
relays it onward. Queuing is the point: if the upstream relay is briefly down,
mail waits and retries instead of being lost inside a request.

**Outbound requires a relay.** Hetzner blocks outbound ports 25 and 465 on
Cloud servers, so this machine cannot deliver to the internet directly — it
relays through an authenticated smarthost on port 587, which is open.
Requesting the unblock from Hetzner (possible after the first paid invoice)
would remove that dependency.

Two things here are **not** package-managed and will be silently lost if
HestiaCP is upgraded and rewrites the Exim config:

1. `hostlist relay_from_hosts` in `/etc/exim4/exim4.conf.template` has
   `172.16.0.0/12` appended, so the app containers may submit mail. Without it
   Django gets `550 relay not permitted`.
2. The smarthost router and its credentials (see `/etc/exim4/` and the
   provisioning notes below).

After any Hestia upgrade, check `exim4 -bV` still parses and that
`grep relay_from_hosts /etc/exim4/exim4.conf.template` still lists the Docker
range.

DNS for mail lives at GoDaddy, not on this server (no BIND installed): an `A`
record for `mail`, an `MX` pointing at it, plus SPF, DKIM (selector `mail`,
key generated by Hestia in `/home/admin/conf/mail/<domain>/dkim.pem`) and
DMARC. `mail.theashantihub.com` is also a **web alias** of the main domain —
not decoration, it is what gives Let's Encrypt an nginx vhost to answer the
challenge on, since no webmail is installed. Removing it breaks mail
certificate renewal.

```bash
v-list-mail-accounts admin theashantihub.com      # mailboxes
v-add-mail-account admin theashantihub.com <name> <password>
exim4 -bp                                          # queue (empty is healthy)
exim4 -qff                                         # force a queue run
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

- **No outgoing email.** Password resets, staff invites and verification
  emails are written to the container log instead of being delivered. This
  needs an SMTP provider before real users sign up. Configuration only, no
  code change.
- **Backups are on the same disk as the database.** A disk failure loses
  both. They should be copied to Hetzner Object Storage or a Storage Box.

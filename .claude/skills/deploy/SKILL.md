---
name: deploy
description: Use when shipping AshantiHub to the test/staging or production environment, running a deploy script, promoting a branch, SSH-ing to the server, running Django management commands against a deployed environment, or diagnosing a deploy/mail/nginx/TLS failure on the Hetzner server. Covers the verify-before-merge gate, the PR flow into righteoushack/main, the staging deploy, the production promotion procedure, the environment/compose-project table, and the deployment gotchas.
---

# AshantiHub deploy & release

**GOLDEN RULE — never deploy to production without an explicit instruction from the user.** (Also stated in the root `CLAUDE.md`; it holds whether or not this skill is loaded.) Approval to deploy to test is **not** approval to deploy to production.

### 1. Verify before merging (always)

Before opening/merging any PR, run and pass:
- `cd frontend && npx vitest run` — the full Vitest suite. **Run it from the `frontend/` directory.** If run from the repo root, Vitest globs stale `.worktrees/**` and `.claude/worktrees/**` copies (leftover git worktrees) that lack `node_modules` and produces a spurious mass failure ("hundreds of test files failed", `import` times in the thousands of seconds). That is an environment artifact, not a real failure — re-run scoped to `frontend/`. A **second** mass-failure artifact looks different and has a different cause: hundreds of `[MSW] Error: intercepted a request without a matching request handler` lines. `frontend/mocks/handlers.js` hardcodes `http://localhost:8000`, so a local `frontend/.env` pointing `VITE_API_BASE_URL` anywhere else (e.g. `:8010` for a non-default docker port) makes every network-touching test miss its handler. Temporarily move `.env` aside to confirm, and treat it as a local-environment problem, not a regression.
- `cd frontend && npm run build` — the production build (this is what both Vercel and the prod `deploy.sh` run).
- `docker compose run --rm web python manage.py test` — the full Django suite (run the specific app(s) touched for speed, then the whole suite before a release).
- `docker compose run --rm web python manage.py makemigrations --check --dry-run` — catch model changes with no migration.

Add/adjust tests for any behavior change; `frontend/StaffDashboard.test.jsx` (~100 assertions) is treated as a behavioral contract — only change it when the change is intentional and note why.

### 2. Ship to test / staging (the normal flow)

Two remote branches gate integration: **`righteoushack`** (integration) and **`main`**. The per-change flow, established across sessions, is:

1. Work on a feature branch (e.g. `feature/launch-day-hardening`); commit with the repo's commit-message convention.
2. `git push origin <feature-branch>` → open a PR **into `righteoushack`**, merge it.
3. Open a PR **into `main`**, merge it.
4. **Test deploys automatically + manually:**
   - **Frontend**: Vercel watches `main` and rebuilds **test.theashantihub.com** on merge (Vercel "Root Directory" = `frontend`, per `frontend/vercel.json`). No action needed beyond the merge. This is the one piece still hosted off-server.
   - **Backend (staging)**: SSH in and run the staging deploy:
     `ssh -i ~/.ssh/ashantihub_launch root@2.28.125.94` then `bash /opt/ashantihub-staging/infra/scripts/deploy.sh`. It pulls `main`, migrates the **staging** DB, and restarts the staging stack (→ **api-test.theashantihub.com**). Skip it only when the change is frontend-only (no backend/migration diff).
5. Verify on test (endpoints return the expected status, migrations applied, the actual flow works in the browser). Then **stop** — production waits for the user.

### 3. Promote to production (only on the user's explicit say-so)

Production is **theashantihub.com** / **api.theashantihub.com**, served from **`/opt/ashantihub/`**. The `production` git branch tracks what's live. When — and only when — the user asks to promote:

1. **Fast-forward `production` → `main`:** `git push origin origin/main:refs/heads/production` (a clean fast-forward — no `--force`; production is always an ancestor of main under this flow).
2. **Run the prod deploy:** `ssh -i ~/.ssh/ashantihub_launch root@2.28.125.94` then `bash /opt/ashantihub/infra/scripts/deploy.sh`. Unlike the old server's script, **this one dumps the database itself before migrating** (`infra/scripts/backup-db.sh` → `/opt/ashantihub/backups/`, verified and 14-day retained), so no manual pre-promote `pg_dump` is needed. It then resets to `origin/production`, rebuilds the app image, migrates, collects static, **builds the frontend on the server** (in a `node:20-alpine` container, rsynced to the Hestia docroot — production frontend is server-built, *not* Vercel), and fails loudly with container logs if the API doesn't answer its health check. If `infra/hestia/templates/` changed in the deploy it also **reinstalls the Hestia nginx templates automatically** when the `infra/hestia/templates/` tree differs from the `.templates-installed` marker (missing marker = install; written only after a successful install; `FORCE_TEMPLATES=1|yes|true` forces it). The install also re-renders the staging API vhost from the production checkout.
3. **Verify production** (frontend 200, a public API endpoint 200, a spot-check of the shipped feature). Flag any data migrations that delete/alter live data *before* running (e.g. a seed-clearing migration) so the user knows.

### The server

A single Hetzner CX33 (4 vCPU / 8 GB / 80 GB, Ubuntu 26.04 LTS) at **2.28.125.94**, SSH `ssh -i ~/.ssh/ashantihub_launch root@2.28.125.94`. **HestiaCP** (panel on `:8083`) owns nginx, TLS and the firewall; **Docker Compose** runs the app. `infra/README.md` is the full operational reference — read it before touching the server.

Each environment is a separate git checkout with its own compose project, database volume and `.env`:

| | Frontend | Backend API | Checkout | Compose project / port |
|---|---|---|---|---|
| **Test/staging** | test.theashantihub.com (Vercel, auto on `main`) | api-test.theashantihub.com | `/opt/ashantihub-staging/` (`main`) | `ashantihub-staging` / 8001 |
| **Production** | theashantihub.com (server-built) | api.theashantihub.com | `/opt/ashantihub/` (`production`) | `ashantihub` / 8000 |

Run Django management commands against an environment through its compose project — **not** a venv, there isn't one on the server:

```bash
docker compose -p ashantihub -f /opt/ashantihub/infra/compose/docker-compose.yml \
  run --rm --no-deps web python manage.py <cmd>
```

### Deployment gotchas

- **Server-side `.env` is not in git.** Settings like `GPS_REMOTE_VALIDATION`, `SENTRY_DSN` and the database password live only in `<checkout>/backend/.env`. They survive deploys (`git reset --hard` doesn't touch ignored files), but must be set per-environment by hand; restart with `docker compose -p <project> -f <checkout>/infra/compose/docker-compose.yml up -d web` afterward.
- **`.deploy.conf` decides which environment a deploy targets**, not a command-line flag. It is untracked and lives at the root of each checkout. A missing one aborts the deploy rather than guessing.
- **`deploy.sh` re-execs itself from `/tmp` on purpose.** It git-resets the checkout it is stored in, and bash reads scripts by byte offset — without the re-exec, the file changing mid-run makes bash resume at the wrong offset and silently skip steps. Do not "simplify" that block away; it already caused two failed deploys.
- **nginx vhosts are HestiaCP templates**, in `infra/hestia/templates/`. Editing a generated config under `/etc/nginx/conf.d/domains/` is pointless — Hestia rewrites those from the templates on any panel change. Edit the repo copies; a production deploy reinstalls them automatically when they differ from the `.templates-installed` marker (staging never does — run `infra/scripts/install-hestia-templates.sh` by hand only for out-of-band installs). In particular, **never add an `^~ /.well-known/` location**: Hestia answers the Let's Encrypt challenge from a regex location, and a `^~` prefix location outranks it and breaks issuance and every renewal.
- **Migrations run against live data on promote.** They applied cleanly on staging first (same ordered sequence), which is the safety net — always deploy to staging before production so migrations are proven against a real (separate) DB.
- The prod frontend is built on the server by `deploy.sh`; a stale browser cache can make a just-shipped UI change look "not deployed" — hard-refresh before diagnosing.
- **Errors go to Sentry** (`SENTRY_DSN` per environment, tagged by `SENTRY_ENVIRONMENT`), and application logs to stdout — `docker compose ... logs web`.
- **Outgoing mail goes through 20i, and every sender must be `no-reply@theashantihub.com`.** Mailboxes for the domain live at 20i (MX `mx.stackmail.com`), not on the server; Django hands mail to the host's Exim, which relays to `smtp.stackmail.com:587` authenticated as that one mailbox. 20i rejects any other sender with `550 Cannot send a message as <addr>`, so `DEFAULT_FROM_EMAIL` and `SERVER_EMAIL` are both set to it and an Exim rewrite rule maps system mail (cron, root) onto it too. Password resets, staff invites and admin error reports all deliver. The failure mode to know: a rejected sender fails **silently** from Django's side — it reports success, Exim accepts, and the `550` only appears in `/var/log/exim4/mainlog`. See `infra/README.md` for the three hand-made Exim changes a HestiaCP upgrade would revert.


## Two gotchas that also live in the root CLAUDE.md

These are repeated there on purpose, because they bite during ordinary infra edits when this skill may not be loaded:

- Never add an `^~ /.well-known/` location to a Hestia nginx template — it outranks Hestia's own regex location and breaks Let's Encrypt issuance and every renewal.
- Do not "simplify" `deploy.sh`'s `/tmp` re-exec away — it already caused two failed deploys.

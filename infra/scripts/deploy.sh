#!/usr/bin/env bash
#
# AshantiHub deploy. Run on the server as root:
#
#   bash /opt/ashantihub/infra/scripts/deploy.sh            # production
#   bash /opt/ashantihub-staging/infra/scripts/deploy.sh    # staging
#
# Which environment is deployed comes from the checkout's own .deploy.conf
# (untracked, written once when the server was provisioned) rather than from
# an argument, so a production deploy cannot be aimed at staging — or the
# reverse — by mistyping a flag.
#
# The database is dumped before migrations run. That dump is the rollback.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONF="$APP_DIR/.deploy.conf"

[[ -f "$CONF" ]] || {
	echo "FATAL: $CONF not found — this checkout has not been provisioned." >&2
	exit 1
}
# shellcheck source=/dev/null
source "$CONF"
: "${ENV_NAME:?missing in .deploy.conf}"
: "${BRANCH:?missing in .deploy.conf}"
: "${PROJECT:?missing in .deploy.conf}"
: "${APP_PORT:?missing in .deploy.conf}"
: "${GUNICORN_WORKERS:?missing in .deploy.conf}"

[[ -f "$APP_DIR/backend/.env" ]] || {
	echo "FATAL: $APP_DIR/backend/.env not found — nothing to configure the app with." >&2
	exit 1
}

# Consumed by docker-compose.yml's ${APP_PORT} / ${GUNICORN_WORKERS}.
export APP_PORT GUNICORN_WORKERS
COMPOSE=(docker compose -p "$PROJECT" -f "$APP_DIR/infra/compose/docker-compose.yml")

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

log "Deploying $ENV_NAME from origin/$BRANCH ($APP_DIR)"

log "Backing up the database"
bash "$APP_DIR/infra/scripts/backup-db.sh"

log "Fetching origin/$BRANCH"
git -C "$APP_DIR" fetch --prune origin
OLD_SHA="$(git -C "$APP_DIR" rev-parse --short HEAD)"
git -C "$APP_DIR" reset --hard "origin/$BRANCH"
NEW_SHA="$(git -C "$APP_DIR" rev-parse --short HEAD)"
echo "  $OLD_SHA -> $NEW_SHA"

log "Building the application image"
"${COMPOSE[@]}" build web

log "Starting the database"
"${COMPOSE[@]}" up -d db

# Compose only enforces service_healthy for services it starts as a
# dependency, so the one-off `run` calls below need their own wait.
log "Waiting for the database to accept connections"
for _ in $(seq 1 60); do
	if "${COMPOSE[@]}" exec -T db pg_isready -q 2>/dev/null; then break; fi
	sleep 2
done
"${COMPOSE[@]}" exec -T db pg_isready || {
	echo "FATAL: database did not become ready." >&2
	exit 1
}

log "Applying migrations"
"${COMPOSE[@]}" run --rm --no-deps web python manage.py migrate --noinput

log "Collecting static files"
"${COMPOSE[@]}" run --rm --no-deps web python manage.py collectstatic --noinput

# The bind-mounted host directories must be writable by the image's
# non-root uid (see backend/Dockerfile.prod), or uploads fail at runtime.
# Docker creates them root-owned on first mount, hence the chown every time.
mkdir -p "$APP_DIR/backend/media" "$APP_DIR/backend/staticfiles"
chown -R 10001:10001 "$APP_DIR/backend/media" "$APP_DIR/backend/staticfiles"

log "Starting the application"
"${COMPOSE[@]}" up -d web

log "Waiting for the API to answer"
for _ in $(seq 1 45); do
	if curl -fsS -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$APP_PORT/api/health/" >/dev/null 2>&1; then
		echo "  API healthy on 127.0.0.1:$APP_PORT"
		break
	fi
	sleep 2
done
curl -fsS -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$APP_PORT/api/health/" >/dev/null || {
	echo "FATAL: API did not come up. Recent logs:" >&2
	"${COMPOSE[@]}" logs --tail=60 web >&2
	exit 1
}

if [[ "${SERVE_FRONTEND:-no}" == "yes" ]]; then
	: "${WEB_ROOT:?SERVE_FRONTEND=yes requires WEB_ROOT in .deploy.conf}"
	: "${WEB_USER:?SERVE_FRONTEND=yes requires WEB_USER in .deploy.conf}"

	log "Building the frontend"
	# Built in a container so the host needs no Node toolchain. Vite reads
	# frontend/.env.production for VITE_API_BASE_URL.
	docker run --rm \
		-v "$APP_DIR/frontend":/app \
		-w /app \
		node:20-alpine \
		sh -c "npm ci --no-audit --no-fund && npm run build"

	log "Publishing the frontend to $WEB_ROOT"
	mkdir -p "$WEB_ROOT"
	rsync -a --delete "$APP_DIR/frontend/dist/" "$WEB_ROOT/"
	chown -R "$WEB_USER":"$WEB_USER" "$WEB_ROOT"
fi

log "Removing unused images"
docker image prune -f >/dev/null

log "Deployed $ENV_NAME: $OLD_SHA -> $NEW_SHA"
"${COMPOSE[@]}" ps

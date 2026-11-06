#!/usr/bin/env bash
#
# Roll the application back to an earlier release image (review ARC-04). Run on the server as root:
#
#   bash /opt/ashantihub/infra/scripts/rollback.sh            # lists the releases still on this server
#   bash /opt/ashantihub/infra/scripts/rollback.sh <sha>      # runs that release's image
#
# This swaps the CODE only (web, realtime, worker, beat); it does not touch the database. Migrations are written to be
# backward-compatible (backend/core/management/commands/lint_migrations.py enforces it), so the previous code runs
# against the newer schema. If the bad release ALSO damaged data, restore the dump deploy.sh took before it ran
# (infra/scripts/backup-db.sh; see "Backups" in infra/README.md) - that is a separate, deliberate step.
#
# The frontend is not rolled back here: production's is built into WEB_ROOT by deploy.sh, so roll it back by checking
# out the same sha and running deploy.sh from it, or restore the previous build.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONF="$APP_DIR/.deploy.conf"
[[ -f "$CONF" ]] || { echo "FATAL: $CONF not found - this checkout has not been provisioned." >&2; exit 1; }
# shellcheck source=/dev/null
source "$CONF"
: "${PROJECT:?missing in .deploy.conf}"
: "${APP_PORT:?missing in .deploy.conf}"
: "${GUNICORN_WORKERS:?missing in .deploy.conf}"

if [[ $# -eq 0 ]]; then
	echo "Releases available on this server (newest first):"
	docker image ls "$PROJECT-app" --format '  {{.Tag}}   built {{.CreatedSince}}'
	echo "Run: bash $0 <tag>"
	exit 0
fi

TAG="$1"
IMAGE="$PROJECT-app:$TAG"
docker image inspect "$IMAGE" >/dev/null 2>&1 || { echo "FATAL: image $IMAGE is not on this server." >&2; exit 1; }

REALTIME_PORT=$((APP_PORT + 100))
export APP_PORT GUNICORN_WORKERS REALTIME_PORT
sed -i "s|^APP_IMAGE=.*|APP_IMAGE=$IMAGE|" "$APP_DIR/infra/compose/.env"
COMPOSE=(docker compose -p "$PROJECT" -f "$APP_DIR/infra/compose/docker-compose.yml")

echo "==> Rolling back to $IMAGE"
"${COMPOSE[@]}" up -d --no-build web realtime worker beat

echo "==> Waiting for the API"
for _ in $(seq 1 45); do
	if curl -fsS -H 'X-Forwarded-Proto: https' "http://127.0.0.1:$APP_PORT/api/readyz/" >/dev/null 2>&1; then
		echo "  API healthy on 127.0.0.1:$APP_PORT, running $IMAGE"
		exit 0
	fi
	sleep 2
done
echo "FATAL: the API did not come back on $IMAGE. Recent logs:" >&2
"${COMPOSE[@]}" logs --tail=60 web >&2
exit 1

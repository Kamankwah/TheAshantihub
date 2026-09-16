#!/usr/bin/env bash
#
# Dump this environment's Postgres database, gzipped and verified, into
# <checkout>/backups. Called by deploy.sh before every deploy and nightly by
# cron (see infra/README.md).
#
# Exits 0 without a dump when the database container isn't running — that is
# the first-deploy case, where there is nothing to back up yet, and it must
# not block the deploy.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONF="$APP_DIR/.deploy.conf"

[[ -f "$CONF" ]] || {
	echo "FATAL: $CONF not found." >&2
	exit 1
}
# shellcheck source=/dev/null
source "$CONF"
: "${ENV_NAME:?missing in .deploy.conf}"
: "${PROJECT:?missing in .deploy.conf}"

ENV_FILE="$APP_DIR/backend/.env"
BACKUP_DIR="$APP_DIR/backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

# Strips surrounding quotes, which django-environ tolerates in .env but
# pg_dump would take literally as part of the name.
read_env() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d "\"'"; }
PG_USER="$(read_env POSTGRES_USER)"
PG_DB="$(read_env POSTGRES_DB)"
: "${PG_USER:?POSTGRES_USER not set in backend/.env}"
: "${PG_DB:?POSTGRES_DB not set in backend/.env}"

COMPOSE=(docker compose -p "$PROJECT" -f "$APP_DIR/infra/compose/docker-compose.yml")

if ! "${COMPOSE[@]}" ps --services --filter status=running 2>/dev/null | grep -qx db; then
	echo "Database container not running — skipping backup (first deploy?)."
	exit 0
fi

mkdir -p "$BACKUP_DIR"
OUT="$BACKUP_DIR/${ENV_NAME}-$(date +%Y%m%d-%H%M%S).sql.gz"

# pg_dump's exit status, not gzip's, decides success.
set -o pipefail
"${COMPOSE[@]}" exec -T db pg_dump -U "$PG_USER" -d "$PG_DB" | gzip -9 >"$OUT"

# A dump that can't be decompressed, or that is suspiciously small, is not a
# backup — fail loudly now rather than at restore time.
gzip -t "$OUT"
SIZE="$(stat -c %s "$OUT")"
if ((SIZE < 2000)); then
	echo "FATAL: $OUT is only ${SIZE} bytes — that is not a real dump." >&2
	exit 1
fi

find "$BACKUP_DIR" -name "${ENV_NAME}-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete

echo "Backup written: $OUT ($((SIZE / 1024)) KB, keeping ${RETENTION_DAYS} days)"

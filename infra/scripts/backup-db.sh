#!/usr/bin/env bash
#
# Back up this environment (review DB-01 / ARC-01):
#   1. a verified, gzipped pg_dump in <checkout>/backups (private: 0700 dir, 0600 files);
#   2. an encrypted copy of that dump plus backend/media and backend/private (ID photos, listing photos) to an
#      off-site restic repository, when one is configured;
#   3. a ping to a dead-man's-switch URL when everything worked (and to <url>/fail when it did not), so silence alerts.
#
# Called by deploy.sh before every deploy and nightly by cron (see infra/README.md "Backups").
#
# Off-site settings live OUTSIDE the checkout, root-only, in $BACKUP_ENV_FILE (default /etc/ashantihub/backup.env):
#   RESTIC_REPOSITORY=sftp:u123@u123.your-storagebox.de:ashantihub     (or s3:https://...)
#   RESTIC_PASSWORD=...             (or RESTIC_PASSWORD_FILE=/etc/ashantihub/restic.pass; keep a copy off the server)
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   (S3-style targets only)
#   BACKUP_PING_URL=https://hc-ping.com/<uuid>  (healthchecks.io or similar; set the check's period to 1 day, grace 2 h)
#   BACKUP_RETENTION=--keep-daily 14 --keep-weekly 8 --keep-monthly 12   (optional)
#
# Environment switches (deploy.sh sets both to 1, because a deploy must not be blocked by the off-site service):
#   BACKUP_ALLOW_MISSING_DB=1   exit 0 when the db container is not running (the first-deploy case)
#   BACKUP_OFFSITE_OPTIONAL=1   an off-site failure warns instead of failing the run (the local dump still counts)
set -euo pipefail
umask 077

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

BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/ashantihub/backup.env}"
if [[ -f "$BACKUP_ENV_FILE" ]]; then
	set -a
	# shellcheck source=/dev/null
	source "$BACKUP_ENV_FILE"
	set +a
fi

ENV_FILE="$APP_DIR/backend/.env"
BACKUP_DIR="$APP_DIR/backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
PING="${BACKUP_PING_URL:-}"

ping_backup() { # $1 = "" on success, "/fail" on failure
	[[ -n "$PING" ]] || return 0
	curl -fsS -m 10 --retry 3 -o /dev/null "${PING}${1:-}" || echo "WARNING: could not reach the backup ping URL." >&2
}
fail() {
	echo "FATAL: $*" >&2
	ping_backup /fail
	exit 1
}

# Strips surrounding quotes, which django-environ tolerates in .env but
# pg_dump would take literally as part of the name.
read_env() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d "\"'"; }
PG_USER="$(read_env POSTGRES_USER)"
PG_DB="$(read_env POSTGRES_DB)"
: "${PG_USER:?POSTGRES_USER not set in backend/.env}"
: "${PG_DB:?POSTGRES_DB not set in backend/.env}"

COMPOSE=(docker compose -p "$PROJECT" -f "$APP_DIR/infra/compose/docker-compose.yml")

if ! "${COMPOSE[@]}" ps --services --filter status=running 2>/dev/null | grep -qx db; then
	if [[ "${BACKUP_ALLOW_MISSING_DB:-0}" == 1 ]]; then
		echo "Database container not running — skipping backup (first deploy?)."
		exit 0
	fi
	fail "the db container is not running, so tonight's backup did not happen."
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
chmod 600 "$BACKUP_DIR"/*.sql.gz 2>/dev/null || true # dumps written before this script set a private umask
OUT="$BACKUP_DIR/${ENV_NAME}-$(date +%Y%m%d-%H%M%S).sql.gz"
PARTIAL="$OUT.partial"
trap 'rm -f "$PARTIAL"' EXIT

# pg_dump's exit status, not gzip's, decides success.
set -o pipefail
"${COMPOSE[@]}" exec -T db pg_dump -U "$PG_USER" -d "$PG_DB" | gzip -9 >"$PARTIAL" || fail "pg_dump failed."

# A dump that can't be decompressed, or that is suspiciously small, is not a
# backup — fail loudly now rather than at restore time.
gzip -t "$PARTIAL" || fail "$PARTIAL is not a valid gzip file."
SIZE="$(stat -c %s "$PARTIAL")"
if ((SIZE < 2000)); then
	fail "$OUT is only ${SIZE} bytes — that is not a real dump."
fi
mv "$PARTIAL" "$OUT"

find "$BACKUP_DIR" -name "${ENV_NAME}-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete
echo "Backup written: $OUT ($((SIZE / 1024)) KB, keeping ${RETENTION_DAYS} days)"

# ── Off-site copy ───────────────────────────────────────────────────────────
offsite() {
	command -v restic >/dev/null || {
		echo "restic is not installed (apt install restic)." >&2
		return 1
	}
	local paths=("$OUT")
	local dir
	for dir in "$APP_DIR/backend/media" "$APP_DIR/backend/private"; do
		[[ -d "$dir" ]] && paths+=("$dir")
	done
	restic snapshots --no-lock --quiet >/dev/null 2>&1 || restic init --quiet || return 1
	restic backup --quiet --tag "$ENV_NAME" --host "$PROJECT" "${paths[@]}" || return 1
	# shellcheck disable=SC2086
	restic forget --quiet --tag "$ENV_NAME" --host "$PROJECT" --prune ${BACKUP_RETENTION:---keep-daily 14 --keep-weekly 8 --keep-monthly 12} || return 1
}

if [[ -z "${RESTIC_REPOSITORY:-}" ]]; then
	echo "WARNING: OFF-SITE BACKUP IS NOT CONFIGURED ($BACKUP_ENV_FILE has no RESTIC_REPOSITORY). This dump is on the same disk as the database." >&2
	[[ "${BACKUP_OFFSITE_OPTIONAL:-0}" == 1 ]] || ping_backup /fail
	exit 0
fi

if offsite; then
	echo "Off-site copy written to $RESTIC_REPOSITORY (dump + media + private)."
else
	if [[ "${BACKUP_OFFSITE_OPTIONAL:-0}" == 1 ]]; then
		echo "WARNING: the off-site copy FAILED; the local dump above is the only copy." >&2
		exit 0
	fi
	fail "the off-site copy failed; the local dump is the only copy."
fi
ping_backup ""

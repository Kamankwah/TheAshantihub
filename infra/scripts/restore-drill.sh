#!/usr/bin/env bash
#
# Restore drill (review DB-01): prove that a backup can be restored, and time it. A backup nobody has restored is a
# hypothesis. Restores into a THROWAWAY Postgres container on a private Docker network - it never touches the live
# database - then checks the result:
#   * the dump loads cleanly (psql ON_ERROR_STOP, one transaction);
#   * the ledger balances (every journal's debits = credits; the trial balance is zero; cached balances sum to zero);
#   * `manage.py check` passes against the restored data with the release image;
#   * with `offsite`, the dump came out of the encrypted off-site repository, so that copy is proven too.
#
# Usage:  restore-drill.sh                  restore the newest local dump
#         restore-drill.sh /path/to/x.sql.gz
#         restore-drill.sh offsite          restore the newest dump from the restic repository
# Run it monthly (infra/cron/ashantihub.cron) and after any change to backups. Exit 0 = the restore worked. The result and
# timing are appended to <checkout>/backups/restore-drill.log, and DRILL_PING_URL (in $BACKUP_ENV_FILE) gets a ping.
set -euo pipefail
umask 077

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=/dev/null
source "$APP_DIR/.deploy.conf"
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
LOG="$BACKUP_DIR/restore-drill.log"
read_env() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d "\"'"; }
PG_USER="$(read_env POSTGRES_USER)"
PG_DB="$(read_env POSTGRES_DB)"
PG_PASSWORD="drill-$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
APP_IMAGE="$(grep -E '^APP_IMAGE=' "$APP_DIR/infra/compose/.env" 2>/dev/null | tail -1 | cut -d= -f2- || true)"

TAG="drill-$$"
NET="$TAG-net"
DB="$TAG-db"
WORK="$(mktemp -d)"
STARTED=$SECONDS
mkdir -p "$BACKUP_DIR"

say() { echo "[restore-drill] $*"; }
ping_drill() { [[ -n "${DRILL_PING_URL:-}" ]] && { curl -fsS -m 10 --retry 3 -o /dev/null "${DRILL_PING_URL}${1:-}" || true; }; return 0; }
cleanup() {
	docker rm -f "$DB" >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
	rm -rf "$WORK"
}
fail() {
	say "FAILED: $*" >&2
	echo "$(date -Is) $ENV_NAME FAILED: $*" >>"$LOG"
	ping_drill /fail
	exit 1
}
trap cleanup EXIT

# 1. Find the dump.
SOURCE="${1:-}"
if [[ "$SOURCE" == offsite ]]; then
	: "${RESTIC_REPOSITORY:?set RESTIC_REPOSITORY in $BACKUP_ENV_FILE}"
	restic restore latest --quiet --tag "$ENV_NAME" --host "$PROJECT" --target "$WORK/restic" --include '**/*.sql.gz' ||
		fail "could not restore the newest snapshot from the off-site repository."
	DUMP="$(find "$WORK/restic" -name '*.sql.gz' | sort | tail -1)"
	restic check --quiet --read-data-subset=5% || fail "restic check found a problem in the off-site repository."
elif [[ -n "$SOURCE" ]]; then
	DUMP="$SOURCE"
else
	DUMP="$(ls -1 "$BACKUP_DIR/${ENV_NAME}"-*.sql.gz 2>/dev/null | sort | tail -1 || true)"
fi
[[ -n "${DUMP:-}" && -f "$DUMP" ]] || fail "no dump found to restore."
gzip -t "$DUMP" || fail "$DUMP is not a valid gzip file."
say "restoring $(basename "$DUMP") ($(($(stat -c %s "$DUMP") / 1024)) KB)"

# 2. A scratch Postgres of the same major version, on a network of its own (no published port).
docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" -e POSTGRES_USER="$PG_USER" -e POSTGRES_PASSWORD="$PG_PASSWORD" \
	-e POSTGRES_DB="$PG_DB" --tmpfs /var/lib/postgresql/data postgres:16 >/dev/null
for _ in $(seq 1 60); do
	docker exec "$DB" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1 && break
	sleep 1
done
docker exec "$DB" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1 || fail "the scratch database did not start."

# 3. Load it, all or nothing.
gunzip -c "$DUMP" | docker exec -i "$DB" psql -q -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 --single-transaction >/dev/null ||
	fail "the dump did not load cleanly."
SQL() { docker exec "$DB" psql -At -U "$PG_USER" -d "$PG_DB" -c "$1"; }
TABLES="$(SQL "select count(*) from information_schema.tables where table_schema='public'")"
((TABLES > 20)) || fail "only $TABLES tables came back - that is not the database."

# 4. The ledger must balance (skipped on a database that predates the ledger tables).
LEDGER_NOTE="ledger tables absent (skipped)"
if [[ "$(SQL "select to_regclass('public.ledger_journalline') is not null")" == t ]]; then
	SIGNED="case side when 'credit' then amount else -amount end"
	TRIAL="$(SQL "select coalesce(sum($SIGNED),0) from ledger_journalline")"
	UNBALANCED="$(SQL "select count(*) from (select journal_id from ledger_journalline group by journal_id having sum($SIGNED) <> 0) x")"
	CACHED="$(SQL "select coalesce(sum(net_credit),0) from ledger_account")"
	[[ "$TRIAL" == 0 && "$UNBALANCED" == 0 && "$CACHED" == 0 ]] ||
		fail "the ledger does not balance (trial balance $TRIAL, unbalanced journals $UNBALANCED, cached balances $CACHED)."
	LEDGER_NOTE="ledger balanced ($(SQL 'select count(*) from ledger_journal') journals)"
fi

# 5. The application's own checks against the restored data.
CHECK_NOTE="manage.py check skipped (no APP_IMAGE in infra/compose/.env)"
if [[ -n "$APP_IMAGE" ]]; then
	docker run --rm --network "$NET" --env-file "$ENV_FILE" -e POSTGRES_HOST="$DB" -e POSTGRES_PORT=5432 \
		-e POSTGRES_USER="$PG_USER" -e POSTGRES_DB="$PG_DB" -e POSTGRES_PASSWORD="$PG_PASSWORD" "$APP_IMAGE" \
		python manage.py check >/dev/null 2>&1 || fail "manage.py check failed against the restored database."
	CHECK_NOTE="manage.py check passed"
fi

TOOK=$((SECONDS - STARTED))
SUMMARY="$(date -Is) $ENV_NAME OK: $(basename "$DUMP"), $TABLES tables, $LEDGER_NOTE, $CHECK_NOTE, ${TOOK}s"
echo "$SUMMARY" | tee -a "$LOG"
ping_drill ""

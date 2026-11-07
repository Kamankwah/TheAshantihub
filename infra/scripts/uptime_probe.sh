#!/usr/bin/env bash
# External uptime probe (review ARC-03). Run it from a machine that is NOT the app server (a second VPS, a home box,
# a free cron service) every minute:  * * * * * /path/to/uptime_probe.sh
# It checks the public readiness URL and posts to ALERT_WEBHOOK_URL (a Slack/Discord/ntfy URL) when the state
# changes - down after 2 consecutive failures, and recovered - never on every failed minute.
set -u
URL="${PROBE_URL:-https://api.theashantihub.com/api/readyz/}"
WEBHOOK="${ALERT_WEBHOOK_URL:-}"
STATE_FILE="${PROBE_STATE_FILE:-/tmp/ashantihub-probe.state}"

fails=0; was_down=0
[ -f "$STATE_FILE" ] && read -r fails was_down < "$STATE_FILE"

if curl -fsS --max-time 10 "$URL" >/dev/null 2>&1; then
	if [ "$was_down" = 1 ] && [ -n "$WEBHOOK" ]; then
		curl -fsS --max-time 10 -H 'Content-Type: application/json' -d "{\"text\":\"AshantiHub API recovered: $URL\"}" "$WEBHOOK" >/dev/null 2>&1
	fi
	echo "0 0" > "$STATE_FILE"
else
	fails=$((fails + 1))
	if [ "$fails" -ge 2 ] && [ "$was_down" = 0 ]; then
		[ -n "$WEBHOOK" ] && curl -fsS --max-time 10 -H 'Content-Type: application/json' -d "{\"text\":\"AshantiHub API is DOWN (readiness failing): $URL\"}" "$WEBHOOK" >/dev/null 2>&1
		was_down=1
	fi
	echo "$fails $was_down" > "$STATE_FILE"
fi

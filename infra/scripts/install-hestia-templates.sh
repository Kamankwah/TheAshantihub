#!/usr/bin/env bash
#
# Install AshantiHub's nginx templates into HestiaCP and rebuild the domain
# configs from them. Production deploys (deploy.sh with SERVE_FRONTEND=yes) run
# this automatically when the infra/hestia/templates/ tree differs from the
# .templates-installed marker (or the marker is missing), so run it by hand
# only for out-of-band installs, as root, from the production checkout:
#
#   bash /opt/ashantihub/infra/scripts/install-hestia-templates.sh
#
# Never run it from the staging checkout: it installs the SPA templates from
# whichever checkout runs it and rebuilds every domain.
#
# The API template is rendered once per environment because each one proxies
# to a different port and serves media/static out of a different checkout.
set -euo pipefail

# Hestia's v-* commands live in $HESTIA/bin and expect HESTIA in the
# environment. A non-login SSH shell (ssh root@host 'bash ...') has neither, so
# set both here rather than relying on the caller's shell.
export HESTIA="${HESTIA:-/usr/local/hestia}"
export PATH="$HESTIA/bin:$PATH"

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../hestia/templates" && pwd)"
DST=/usr/local/hestia/data/templates/web/nginx/php-fpm
HESTIA_USER="${HESTIA_USER:-admin}"

[[ -d "$DST" ]] || {
	echo "FATAL: $DST not found — is HestiaCP installed with nginx?" >&2
	exit 1
}

# render <template-name> <app-dir> <upstream-port> <realtime-port>
render() {
	local name="$1" app_dir="$2" port="$3" rt_port="$4" ext
	for ext in tpl stpl; do
		sed -e "s#__APP_DIR__#${app_dir}#g" \
			-e "s#__UPSTREAM_PORT__#${port}#g" \
			-e "s#__REALTIME_PORT__#${rt_port}#g" \
			"$SRC/ashantihub-api.${ext}.in" >"$DST/${name}.${ext}"
		chmod 644 "$DST/${name}.${ext}"
	done
	echo "  rendered ${name}.tpl/.stpl  ->  127.0.0.1:${port}, /ws/ -> ${rt_port}  (${app_dir})"
}

echo "Installing templates into $DST"
install -m 644 "$SRC/ashantihub-spa.tpl" "$DST/ashantihub-spa.tpl"
install -m 644 "$SRC/ashantihub-spa.stpl" "$DST/ashantihub-spa.stpl"
echo "  installed ashantihub-spa.tpl/.stpl"

render ashantihub-api-prod /opt/ashantihub 8000 8100
render ashantihub-api-staging /opt/ashantihub-staging 8001 8101

# Regenerates every domain's config from its assigned template. Safe to run
# with no domains yet - it simply has nothing to rebuild. Hestia's CLI is
# required: skipping the rebuild would leave stale vhosts while the install
# still looked successful.
[[ -x "$HESTIA/bin/v-rebuild-web-domains" ]] || {
	echo "FATAL: $HESTIA/bin/v-rebuild-web-domains not found or not executable - is HestiaCP installed?" >&2
	exit 1
}
echo "Rebuilding web domains for user '$HESTIA_USER'"
v-rebuild-web-domains "$HESTIA_USER" no

echo "Testing nginx configuration"
nginx -t
systemctl reload nginx
echo "Done."

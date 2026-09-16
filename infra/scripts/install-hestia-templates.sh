#!/usr/bin/env bash
#
# Install AshantiHub's nginx templates into HestiaCP and rebuild the domain
# configs from them. Run as root after changing anything in
# infra/hestia/templates/:
#
#   bash /opt/ashantihub/infra/scripts/install-hestia-templates.sh
#
# The API template is rendered once per environment because each one proxies
# to a different port and serves media/static out of a different checkout.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../hestia/templates" && pwd)"
DST=/usr/local/hestia/data/templates/web/nginx/php-fpm
HESTIA_USER="${HESTIA_USER:-admin}"

[[ -d "$DST" ]] || {
	echo "FATAL: $DST not found — is HestiaCP installed with nginx?" >&2
	exit 1
}

# render <template-name> <app-dir> <upstream-port>
render() {
	local name="$1" app_dir="$2" port="$3" ext
	for ext in tpl stpl; do
		sed -e "s#__APP_DIR__#${app_dir}#g" \
			-e "s#__UPSTREAM_PORT__#${port}#g" \
			"$SRC/ashantihub-api.${ext}.in" >"$DST/${name}.${ext}"
		chmod 644 "$DST/${name}.${ext}"
	done
	echo "  rendered ${name}.tpl/.stpl  ->  127.0.0.1:${port}  (${app_dir})"
}

echo "Installing templates into $DST"
install -m 644 "$SRC/ashantihub-spa.tpl" "$DST/ashantihub-spa.tpl"
install -m 644 "$SRC/ashantihub-spa.stpl" "$DST/ashantihub-spa.stpl"
echo "  installed ashantihub-spa.tpl/.stpl"

render ashantihub-api-prod /opt/ashantihub 8000
render ashantihub-api-staging /opt/ashantihub-staging 8001

# Regenerates every domain's config from its assigned template. Safe to run
# with no domains yet — it simply has nothing to rebuild.
if command -v v-rebuild-web-domains >/dev/null; then
	echo "Rebuilding web domains for user '$HESTIA_USER'"
	v-rebuild-web-domains "$HESTIA_USER" no
fi

echo "Testing nginx configuration"
nginx -t
systemctl reload nginx
echo "Done."

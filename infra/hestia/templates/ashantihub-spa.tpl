#=========================================================================#
# AshantiHub — React SPA (static build)                                   #
#                                                                         #
# Installed into HestiaCP's template directory by                         #
# infra/scripts/install-hestia-templates.sh. Edit the copy in the repo,   #
# never the installed one: Hestia rewrites domain configs from templates  #
# on every panel change, so edits made to the generated config are lost.  #
#                                                                         #
# Serves the Vite build that deploy.sh rsyncs into the domain's docroot.  #
# No PHP anywhere — this vhost is static files plus the SPA fallback.     #
#=========================================================================#

server {
	listen      %ip%:%web_port%;
	server_name %domain_idn% %alias_idn%;
	root        %docroot%;
	index       index.html;
	access_log  /var/log/nginx/domains/%domain%.log combined;
	access_log  /var/log/nginx/domains/%domain%.bytes bytes;
	error_log   /var/log/nginx/domains/%domain%.error.log error;

	include %home%/%user%/conf/web/%domain%/nginx.forcessl.conf*;

	# Dotfiles stay hidden, except .well-known: Hestia answers the Let's
	# Encrypt challenge from a regex location injected through the
	# nginx.conf_* include at the end of this block, and this deny rule
	# must not swallow it. Do not add an "^~ /.well-known/" location
	# either — it would outrank that regex and break renewals.
	location ~ /\.(?!well-known\/) {
		deny all;
		return 404;
	}

	location / {
		# Client-side routing: every unknown path is a React route
		# (/business/12, /staff, ...), so hand it index.html rather than 404.
		try_files $uri $uri/ /index.html;
	}

	# Vite fingerprints these filenames, so they can be cached forever.
	location /assets/ {
		expires    max;
		add_header Cache-Control "public, immutable";
	}

	# index.html must never be cached: it names the current asset hashes,
	# and a stale copy points the browser at files a deploy has deleted.
	location = /index.html {
		expires   -1;
		add_header Cache-Control "no-cache, must-revalidate";
	}

	location /error/ {
		alias %home%/%user%/web/%domain%/document_errors/;
	}

	include %home%/%user%/conf/web/%domain%/nginx.conf_*;
}

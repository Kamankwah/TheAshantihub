import base64
import hashlib
from pathlib import Path
import sys
import environ

from celery.schedules import crontab
from cryptography.fernet import Fernet
from django.core.exceptions import ImproperlyConfigured

from accounts.mixins import AnonymousUser

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(DJANGO_DEBUG=(bool, False))
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-only-insecure-key")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["*"])

if not DEBUG and SECRET_KEY == "dev-only-insecure-key":
    raise ImproperlyConfigured("DJANGO_SECRET_KEY must be set when DJANGO_DEBUG=False")

# Encrypts staff 2-step sign-in secrets at rest (accounts/two_factor.py) and
# keys the recovery-code hashes. A Fernet key — generate with:
#   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# Changing it locks every enrolled staffer out of the second step until each is
# reset with `manage.py reset_staff_two_factor <email>`, so set it once and back
# it up with the database password.
STAFF_SECRETS_KEY = env("STAFF_SECRETS_KEY", default="")
if not STAFF_SECRETS_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("STAFF_SECRETS_KEY must be set when DJANGO_DEBUG=False")
    STAFF_SECRETS_KEY = base64.urlsafe_b64encode(hashlib.sha256(SECRET_KEY.encode()).digest()).decode()
try:
    Fernet(STAFF_SECRETS_KEY.encode())
except ValueError as exc:
    raise ImproperlyConfigured(
        "STAFF_SECRETS_KEY is not a valid Fernet key — generate one with: "
        "python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
    ) from exc

# When True, business-registration GPS addresses are additionally verified as
# real Ghana Post addresses via the public ghana-api.dev validator (best-effort;
# never blocks on network failure). Off by default — the Ashanti-Region rule is
# enforced deterministically from the address prefix regardless (accounts.gps).
GPS_REMOTE_VALIDATION = env.bool("GPS_REMOTE_VALIDATION", default=False)

# Nginx terminates TLS in front of Gunicorn in production — trust its
# X-Forwarded-Proto/Host so request.is_secure()/build_absolute_uri() (e.g.
# avatar/media URLs) generate https:// links rather than http://.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True

# ── Security response headers (manage.py check --deploy hardening) ──────────
# Always-safe headers (no redirect, no HTTPS requirement) — applied everywhere.
SECURE_CONTENT_TYPE_NOSNIFF = True          # X-Content-Type-Options: nosniff
SECURE_REFERRER_POLICY = "same-origin"      # Referrer-Policy
X_FRAME_OPTIONS = "DENY"                     # X-Frame-Options (clickjacking)

# HTTPS-enforcing headers — production only. DEBUG is read from the env at
# import time (True in dev/docker via backend/.env), so these evaluate False
# there and never 301-redirect the test client / dev server; in production
# (DEBUG=False) they take effect. Safe behind nginx via SECURE_PROXY_SSL_HEADER.
SECURE_SSL_REDIRECT = not DEBUG
SECURE_HSTS_SECONDS = 0 if DEBUG else 31536000  # 1 year
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = not DEBUG

# This is a stateless DRF API authenticated via JWT in the Authorization header
# — no session/cookie auth anywhere — so Django's cookie-based CSRF middleware
# isn't applicable. Silence its deploy-check warning rather than adding
# middleware that would do nothing here (security.W003).
SILENCED_SYSTEM_CHECKS = ["security.W003"]

INSTALLED_APPS = [
    # Makes the local `manage.py runserver` serve ASGI, WebSockets included
    # (staff foundations F2). Production runs gunicorn + uvicorn workers.
    "daphne",
    "django.contrib.contenttypes",
    # Required transitively: rest_framework_simplejwt.tokens imports AbstractBaseUser at module load time
    "django.contrib.auth",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "rest_framework",
    "corsheaders",
    "core",
    "contact",
    "accounts",
    "listings",
    "billing",
    "credit",
    "cart",
    "orders",
    "services",
    "bookings",
    "events",
    "reviews",
    "qa",
    "disputes",
    "messaging",
    "payments",
    "notifications",
    "activity",
    "staff_tasks",
    "calls",
    "approvals",
    "reports",
    "portfolio",
    "realtime",
]

MIDDLEWARE = [
    # SecurityMiddleware first so its HTTPS/HSTS handling wraps everything
    # (manage.py check --deploy W001). CorsMiddleware stays high (before
    # CommonMiddleware, per corsheaders docs). XFrameOptionsMiddleware last —
    # it just stamps X-Frame-Options on the response (W002).
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "activity.middleware.StaffActivityMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "ashantihub.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": []},
    },
]

WSGI_APPLICATION = "ashantihub.wsgi.application"
ASGI_APPLICATION = "ashantihub.asgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", default="ashantihub"),
        "USER": env("POSTGRES_USER", default="ashantihub"),
        "PASSWORD": env("POSTGRES_PASSWORD", default="ashantihub_dev"),
        "HOST": env("POSTGRES_HOST", default="localhost"),
        "PORT": env("POSTGRES_PORT", default="5432"),
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Ghana time (GMT, no DST). Left unset, Django defaults to America/Chicago and
# every API timestamp and local-date boundary lands five hours off.
TIME_ZONE = "Africa/Accra"
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

# Dev keeps the historical allow-all default (backend/.env sets it True);
# production sets DJANGO_CORS_ALLOW_ALL_ORIGINS=False plus an explicit
# DJANGO_CORS_ALLOWED_ORIGINS list of the real frontend origins.
CORS_ALLOW_ALL_ORIGINS = env.bool("DJANGO_CORS_ALLOW_ALL_ORIGINS", default=True)
CORS_ALLOWED_ORIGINS = env.list("DJANGO_CORS_ALLOWED_ORIGINS", default=[])

# Email — defaults to Django's console backend so nothing breaks locally
# without SMTP configured; set EMAIL_BACKEND (and the SMTP vars below) in
# production to actually deliver staff-invite/password-reset/verification
# emails (see accounts/emails.py).
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="no-reply@theashantihub.com")

# ── Error reporting ─────────────────────────────────────────────────────────
# Who receives Django's unhandled-exception mail. Empty by default, which
# makes the mail_admins handler below a no-op — so this is safe to leave unset
# while EMAIL_BACKEND is still the console backend, and starts delivering the
# moment real SMTP credentials and DJANGO_ADMIN_EMAILS are both filled in,
# with no code change. Sentry (below) is the alerting path until then.
ADMINS = [("AshantiHub Ops", address) for address in env.list("DJANGO_ADMIN_EMAILS", default=[])]
MANAGERS = ADMINS
SERVER_EMAIL = env("SERVER_EMAIL", default=DEFAULT_FROM_EMAIL)

# Logging goes to stdout/stderr, not to a file: in production the app runs
# under Docker, so the container runtime owns capture and rotation
# (infra/compose/docker-compose.yml caps it at 10MB x 5). A file handler here
# would need a writable path inside an otherwise read-only, non-root
# container and would rotate independently of that.
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {
            "format": "{asctime} {levelname} {name} {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "standard",
        },
        "mail_admins": {
            "class": "django.utils.log.AdminEmailHandler",
            "level": "ERROR",
            # HTML bodies embed a full traceback page including local
            # variables — too much to put in an inbox.
            "include_html": False,
        },
    },
    "root": {
        "handlers": ["console"],
        "level": env("DJANGO_LOG_LEVEL", default="INFO"),
    },
    "loggers": {
        # Unhandled 500s land here. Django's own default config would drop
        # the console copy once LOGGING is defined at all, so both handlers
        # are listed explicitly.
        "django.request": {
            "handlers": ["console", "mail_admins"],
            "level": "ERROR",
            "propagate": False,
        },
        # Every SQL statement at DEBUG level otherwise drowns the log.
        "django.db.backends": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
        # WeasyPrint logs each PDF's layout steps at INFO (report exports).
        "weasyprint": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": False,
        },
    },
}

# Sentry — the live error-alerting path. Inert unless SENTRY_DSN is set, so
# dev, CI and the test suite never phone home.
SENTRY_DSN = env("SENTRY_DSN", default="")
if SENTRY_DSN:
    import sentry_sdk

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        # Tells staging errors apart from production ones in the same project.
        environment=env("SENTRY_ENVIRONMENT", default="production"),
        # Errors only. Performance tracing on every request would cost quota
        # this project has no use for yet.
        traces_sample_rate=0.0,
        # Never ship user emails/phone numbers/request bodies to Sentry.
        send_default_pii=False,
    )

# Public base URL of the deployed frontend (e.g. https://theashantihub.com) —
# used to build Hubtel's returnUrl/cancellationUrl (payments/hubtel_client.py)
# so a customer redirected off-app to pay lands back on /payment/return.
# Blank in dev, where the Hubtel path is never actually exercised anyway
# (see PAYMENTS_PROVIDER below).
FRONTEND_BASE_URL = env("FRONTEND_BASE_URL", default="http://localhost:5173")

# Hubtel payments (docs/HUBTEL_INTEGRATION.md, plan Workstream E). Every
# HUBTEL_* var is blank by default — PAYMENTS_PROVIDER is *derived* from
# whether HUBTEL_CLIENT_ID is actually set, not a separate manually-toggled
# flag, so the app automatically flips from the pre-existing simulated-
# payment behavior to real Hubtel Checkout the moment real credentials are
# added and the process restarts, with no code change/redeploy needed for
# that flip. See payments/services.py's process_payment() for what each
# mode actually does.
HUBTEL_CLIENT_ID = env("HUBTEL_CLIENT_ID", default="")
HUBTEL_CLIENT_SECRET = env("HUBTEL_CLIENT_SECRET", default="")
HUBTEL_MERCHANT_ACCOUNT = env("HUBTEL_MERCHANT_ACCOUNT", default="")
HUBTEL_WEBHOOK_SECRET = env("HUBTEL_WEBHOOK_SECRET", default="")
HUBTEL_CALLBACK_URL = env("HUBTEL_CALLBACK_URL", default="")
PAYMENTS_PROVIDER = "hubtel" if HUBTEL_CLIENT_ID else "simulated"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "accounts.authentication.MultiAccountJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [],
    # DRF's request.user falls back to this callable when no authenticator
    # succeeds. We use a custom AnonymousUser from our mixins that duck-types
    # Django's auth.models.AnonymousUser for DRF's IsAuthenticated checks.
    "UNAUTHENTICATED_USER": AnonymousUser,
    "EXCEPTION_HANDLER": "accounts.authentication.exception_handler",
    "DEFAULT_THROTTLE_CLASSES": ["rest_framework.throttling.ScopedRateThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        "customer_register": "5/min",
        "business_owner_register": "5/min",
        "staff_activate": "5/min",
        "login": "5/min",
        "two_factor": "10/min",
        "password_reset_request": "5/min",
        # The Hubtel webhook is a public, unauthenticated endpoint (Hubtel
        # calls it from the internet, not a logged-in app user) — generous
        # but not unlimited, since it's dark/unexercised until HUBTEL_* env
        # vars are set (see settings.PAYMENTS_PROVIDER).
        "hubtel_webhook": "60/min",
        # Support chat — open to anonymous guests (keyed per-IP when
        # anonymous, per-account when signed in), so rate-limited to keep
        # guest spam bounded without getting in the way of a real
        # back-and-forth conversation.
        "messaging": "60/hour",
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": __import__("datetime").timedelta(hours=12),
}

# ── Live updates and background jobs (staff foundations F2) ─────────────────
# One Redis per environment (infra/compose/docker-compose.yml) carries the
# Channels layer, the realtime-ticket cache and the Celery broker. With
# REDIS_URL unset (plain local dev) — and ALWAYS under `manage.py test`, so
# the suite never needs Redis — everything runs in-process instead: the
# in-memory channel layer, a local-memory ticket cache and eager Celery.
#
# The "default" cache deliberately stays local-memory even in production:
# the login throttles read it, and a Redis outage must never take sign-in
# down (spec §3: "Redis down: sockets fail, polling continues"). Short socket
# timeouts keep a hung Redis from stalling the ticket cache (staff-only use);
# the channel layer and broker need longer read timeouts, noted where set.
TESTING = len(sys.argv) > 1 and sys.argv[1] == "test"
REDIS_URL = env("REDIS_URL", default="")
# Production without Redis would quietly run jobs inside web requests and keep
# a separate in-memory channel layer per process (no live updates): refuse.
if not DEBUG and not TESTING and not REDIS_URL.startswith(("redis://", "rediss://")):
    raise ImproperlyConfigured("REDIS_URL must be set when DJANGO_DEBUG=False")
USE_REDIS = bool(REDIS_URL) and not TESTING

CACHES = {
    "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
    "realtime": (
        {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
            "KEY_PREFIX": "ah",
            "OPTIONS": {"socket_connect_timeout": 1, "socket_timeout": 2},
        }
        if USE_REDIS
        else {"BACKEND": "django.core.cache.backends.locmem.LocMemCache", "LOCATION": "realtime"}
    ),
}
CHANNEL_LAYERS = {
    "default": (
        {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            # channels-redis blocks in BZPOPMIN for 5 s per receive, so the read
            # timeout must exceed that or idle sockets would error.
            "CONFIG": {"hosts": [{"address": REDIS_URL, "socket_connect_timeout": 1, "socket_timeout": 10}]},
        }
        if USE_REDIS
        else {"BACKEND": "channels.layers.InMemoryChannelLayer"}
    )
}

CELERY_BROKER_URL = REDIS_URL if USE_REDIS else "memory://"
CELERY_TASK_ALWAYS_EAGER = not USE_REDIS
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_TASK_IGNORE_RESULT = True
CELERY_TIMEZONE = TIME_ZONE
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
# kombu's Redis transport blocks in BRPOP for 1 s at a time, so a 5 s read
# timeout never trips on an idle worker. Publishing gives up after one retry
# instead of hanging a request when Redis is unreachable.
CELERY_BROKER_TRANSPORT_OPTIONS = {"socket_connect_timeout": 1, "socket_timeout": 5}
CELERY_TASK_PUBLISH_RETRY_POLICY = {"max_retries": 1, "interval_start": 0, "interval_step": 0.5, "interval_max": 0.5}
# Each job's owning app adds its own entry; core/tests/test_background_jobs.py
# fails if an entry names a task that doesn't exist. Times are Africa/Accra.
CELERY_BEAT_SCHEDULE = {
    "activity-verify-chain": {
        "task": "activity.tasks.verify_activity_chain_nightly",
        "schedule": crontab(hour=1, minute=45),
    },
    "sessions-cleanup": {
        "task": "accounts.tasks.cleanup_staff_sessions",
        "schedule": crontab(hour=3, minute=30),
    },
    "reports-purge-exports": {
        "task": "reports.tasks.purge_expired_exports",
        "schedule": crontab(hour=4, minute=0),
    },
    "reports-reap-stuck-exports": {
        "task": "reports.tasks.reap_stuck_exports",
        "schedule": 900.0,  # every 15 minutes
    },
    "approvals-escalate": {
        "task": "approvals.tasks.escalate_due_approvals",
        "schedule": 300.0,  # every 5 minutes
    },
    "reports-day-reminders": {
        "task": "reports.tasks.send_day_report_reminders",
        "schedule": crontab(hour=18, minute=0),
    },
    "billing-subscription-clock": {
        "task": "billing.tasks.run_subscription_clock",
        "schedule": crontab(minute=5),  # hourly, at five past
    },
}

# Production sets this True so the nightly activity check emails its seal to
# every Super Admin; staging only verifies.
ACTIVITY_SEAL_EMAIL = env.bool("ACTIVITY_SEAL_EMAIL", default=False)

# Files only a permission-checked view may serve (report exports, F6). Never
# under MEDIA_ROOT, which nginx serves to anyone.
PRIVATE_MEDIA_ROOT = BASE_DIR / "private"

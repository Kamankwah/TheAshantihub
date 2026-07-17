from pathlib import Path
import environ

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

# Nginx terminates TLS in front of Gunicorn in production — trust its
# X-Forwarded-Proto/Host so request.is_secure()/build_absolute_uri() (e.g.
# avatar/media URLs) generate https:// links rather than http://.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = True

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    # Required transitively: rest_framework_simplejwt.tokens imports AbstractBaseUser at module load time
    "django.contrib.auth",
    "django.contrib.staticfiles",
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
    "events",
    "reviews",
    "qa",
    "disputes",
    "messaging",
    "payments",
    "notifications",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
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

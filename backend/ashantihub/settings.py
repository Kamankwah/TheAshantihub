from pathlib import Path
import environ

from accounts.mixins import AnonymousUser

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(DJANGO_DEBUG=(bool, False))
environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY", default="dev-only-insecure-key")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    # Required transitively: rest_framework_simplejwt.tokens imports AbstractBaseUser at module load time
    "django.contrib.auth",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "core",
    "accounts",
    "listings",
    "billing",
    "credit",
    "cart",
    "orders",
    "events",
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
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"

CORS_ALLOW_ALL_ORIGINS = True

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
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": __import__("datetime").timedelta(hours=12),
}

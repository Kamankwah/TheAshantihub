"""Deploy-time checks that a production process is not running with development-open settings (review ARC-07).

They run on every ``migrate`` (so every deploy, before the new containers take traffic), ``check`` and ``test``. Each
is skipped when ``DEBUG`` is on, and under ``manage.py test``."""
from django.conf import settings
from django.core import checks


@checks.register()
def check_open_dev_defaults(app_configs, **kwargs):
    if settings.DEBUG or getattr(settings, "TESTING", False):
        return []
    errors = []
    if "*" in settings.ALLOWED_HOSTS:
        errors.append(checks.Error(
            "ALLOWED_HOSTS contains '*' with DEBUG off, so any Host header is accepted.",
            hint="Set DJANGO_ALLOWED_HOSTS to the real hostnames (e.g. api.theashantihub.com).", id="core.E001",
        ))
    if settings.CORS_ALLOW_ALL_ORIGINS:
        errors.append(checks.Error(
            "CORS_ALLOW_ALL_ORIGINS is on with DEBUG off, so any website may call the API from a browser.",
            hint="Set DJANGO_CORS_ALLOW_ALL_ORIGINS=False and list the real origins in DJANGO_CORS_ALLOWED_ORIGINS.",
            id="core.E002",
        ))
    elif not settings.CORS_ALLOWED_ORIGINS:
        errors.append(checks.Error(
            "CORS has no allowed origins with DEBUG off, so the web app cannot call the API.",
            hint="Set DJANGO_CORS_ALLOWED_ORIGINS.", id="core.E003",
        ))
    return errors

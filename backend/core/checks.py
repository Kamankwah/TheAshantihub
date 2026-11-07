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


@checks.register(checks.Tags.database)
def check_runtime_database_role(app_configs, databases=None, **kwargs):
    """Review DB-05: the application must not run as a Postgres superuser (or one that can create roles/databases), or one
    injected query can rewrite the "tamper-proof" ledger. ``deploy.sh`` runs ``check --database default`` as the runtime
    role before the new containers start. Skipped for the owner-role tasks (``DJANGO_DB_ROLE=owner``: migrate and
    provisioning), in DEBUG and under test."""
    import os

    from django.db import connection

    if settings.DEBUG or getattr(settings, "TESTING", False) or os.environ.get("DJANGO_DB_ROLE") == "owner" or not databases:
        return []
    from core import db_roles

    superuser, create_role, create_db = db_roles.is_runtime_superuser()
    if not (superuser or create_role or create_db):
        return []
    return [checks.Error(
        f"The application is connected to Postgres as {connection.settings_dict['USER']!r}, which is a superuser or can create "
        "roles/databases.",
        hint="Set POSTGRES_APP_USER and POSTGRES_APP_PASSWORD in backend/.env and deploy; deploy.sh creates the restricted "
             "role (manage.py provision_db_roles) and starts the app as it. See infra/README.md 'Database roles'.",
        id="core.E004",
    )]

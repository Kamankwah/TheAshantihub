"""Helpers for tests across apps (not test cases themselves)."""
from rest_framework_simplejwt.tokens import AccessToken

from . import sessions
from .authentication import issue_token
from .models import Role, StaffSession, StaffUser


def make_staff(role, email, *, password_hash="x", **extra):
    """A StaffUser in the named role (the role must already be seeded)."""
    return StaffUser.objects.create(
        full_name=email.split("@")[0].title(),
        email=email,
        password_hash=password_hash,
        role=Role.objects.get(name=role),
        **extra,
    )


def session_of(token):
    """The StaffSession row a staff access token names."""
    return StaffSession.objects.get(jti=AccessToken(token)["jti"])


def staff_token(staff, *, sudo=False):
    """A staff access token with a live session. sudo=True also unlocks
    password-protected actions for 10 minutes, as POST staff/reauth/ would."""
    token = issue_token(staff, "staff")
    if sudo:
        sessions.grant_sudo(session_of(token))
    return token


def apps_at(app_label, migration_name):
    """The model registry exactly as ``migration_name`` left it, for running an old data migration's function in a test. The
    live models now encrypt some columns (DB-03); a migration written before that must see the plain columns it was written for."""
    from django.db import connection
    from django.db.migrations.loader import MigrationLoader

    loader = MigrationLoader(connection)
    return loader.project_state((app_label, migration_name)).apps

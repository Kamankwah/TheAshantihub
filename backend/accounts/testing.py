"""Helpers for tests across apps (not test cases themselves)."""
from datetime import timedelta

from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken

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
        StaffSession.objects.filter(jti=AccessToken(token)["jti"]).update(
            sudo_until=timezone.now() + timedelta(minutes=10)
        )
    return token

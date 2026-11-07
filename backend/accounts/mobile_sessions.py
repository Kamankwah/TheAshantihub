"""Refreshable sessions for the native app and the web app (customers and business owners).

The access token is a short JWT (settings.CUSTOMER_ACCESS_TOKEN_MINUTES); this adds an opaque refresh token per phone or
browser (review BE-09). It is issued only to clients that say what they are with `X-Client`. The app (`mobile`) keeps it in
the phone's secure storage and sends it in the request body. The web app (`web`) never sees it: it lives in an HttpOnly,
SameSite=Lax cookie scoped to the refresh endpoints, so a script injected into the page cannot read it, and a refresh by
cookie also needs the `X-Client: web` header, which a cross-site form cannot send.

A session ends when its token expires, when it is revoked (sign-out, account deletion), when a rotated token comes
back after the retry window (it leaked), or when the account's password changes: each session remembers a fingerprint
of the password hash it signed in with, so every password path, present and future, ends it."""

import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from .models import MobileSession

MOBILE_HEADER = "X-Client"
WEB_COOKIE = "ah_refresh"
WEB_COOKIE_PATH = "/api/accounts/session/"
REFRESH_LIFETIME = timedelta(days=30)
# A rotated token presented again this soon is a retry after a dropped response, not theft: it gets a fresh token.
REUSE_WINDOW = timedelta(seconds=60)


class InvalidRefresh(Exception):
    """The refresh token is unknown, expired, revoked, reused, or its account can no longer sign in."""


def _hash(raw):
    return hashlib.sha256((raw if isinstance(raw, str) else "").encode()).hexdigest()


def fingerprint(account):
    return hashlib.sha256((account.password_hash or "").encode()).hexdigest()[:32]


def client_kind(request):
    """"mobile", "web", or None for a client that did not say."""
    kind = request.headers.get(MOBILE_HEADER) if request is not None else None
    return kind if kind in ("mobile", "web") else None


def token_from(request):
    """The refresh token in a request body (the app) or, for the web app, in its cookie; "" when there is none."""
    data = request.data
    value = data.get("refresh_token", "") if hasattr(data, "get") else ""
    if isinstance(value, str) and value:
        return value
    if client_kind(request) == "web":
        return request.COOKIES.get(WEB_COOKIE, "")
    return ""


def set_cookie(response, raw):
    response.set_cookie(
        WEB_COOKIE, raw, max_age=int(REFRESH_LIFETIME.total_seconds()), path=WEB_COOKIE_PATH,
        httponly=True, secure=not settings.DEBUG, samesite="Lax",
    )


def clear_cookie(response):
    response.delete_cookie(WEB_COOKIE, path=WEB_COOKIE_PATH, samesite="Lax")


def deliver(request, response):
    """For the web app, move `refresh_token` out of a sign-in body into the cookie (the page never sees it). The app's
    response keeps it in the body. Returns the response."""
    data = getattr(response, "data", None)
    if client_kind(request) == "web" and isinstance(data, dict) and "refresh_token" in data:
        set_cookie(response, data.pop("refresh_token"))
    return response


def _new_row(account_type, account, family, device_name=""):
    raw = secrets.token_urlsafe(48)
    MobileSession.objects.create(
        account_type=account_type, account_id=account.pk, family=family, token_hash=_hash(raw),
        password_fingerprint=fingerprint(account), device_name=device_name[:100],
        expires_at=timezone.now() + REFRESH_LIFETIME,
    )
    return raw


def issue(request, account, account_type):
    """A new refresh token for a sign-in from the app or the web app, or None for any other client."""
    kind = client_kind(request)
    if kind is None:
        return None
    data = getattr(request, "data", None)
    device_name = str(data.get("device_name", "")) if hasattr(data, "get") else ""
    if kind == "web":
        device_name = "web browser"
    return _new_row(account_type, account, secrets.token_hex(16), device_name)


def revoke(raw_token):
    MobileSession.objects.filter(token_hash=_hash(raw_token), revoked_at__isnull=True).update(revoked_at=timezone.now())


def revoke_family(family):
    return MobileSession.objects.filter(family=family, revoked_at__isnull=True).update(revoked_at=timezone.now())


def revoke_all(account_type, account_id):
    return MobileSession.objects.filter(
        account_type=account_type, account_id=account_id, revoked_at__isnull=True
    ).update(revoked_at=timezone.now())


def _can_sign_in(account):
    return not (getattr(account, "is_suspended", False) or getattr(account, "deleted_at", None))


def rotate(raw_token):
    """Trade a refresh token for (account, account_type, new refresh token). Raises InvalidRefresh."""
    from .authentication import ACCOUNT_MODELS

    now = timezone.now()
    outcome = None
    with transaction.atomic():
        row = MobileSession.objects.select_for_update().filter(token_hash=_hash(raw_token)).first()
        if row is None or row.revoked_at or row.expires_at <= now:
            raise InvalidRefresh()
        model = ACCOUNT_MODELS.get(row.account_type)
        account = model.objects.filter(pk=row.account_id).first() if model else None
        if account is None or not _can_sign_in(account) or row.password_fingerprint != fingerprint(account):
            revoke_family(row.family)  # inside the transaction, so a concurrent rotation cannot slip a child past it
        elif row.rotated_at and now - row.rotated_at > REUSE_WINDOW:
            revoke_family(row.family)
        else:
            if not row.rotated_at:
                row.rotated_at = now
            row.last_used_at = now
            row.save(update_fields=["rotated_at", "last_used_at"])
            outcome = (account, row.account_type, _new_row(row.account_type, account, row.family, row.device_name))
    if outcome is None:
        raise InvalidRefresh()
    return outcome

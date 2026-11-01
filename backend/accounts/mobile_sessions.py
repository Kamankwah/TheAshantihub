"""Refreshable sessions for the native app (customers and business owners).

The access token is the existing 12-hour JWT; this adds an opaque refresh token per phone. It is issued only to
clients that send `X-Client: mobile`, so the web responses are unchanged."""

import hashlib
import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import MobileSession

MOBILE_HEADER = "X-Client"
REFRESH_LIFETIME = timedelta(days=30)


class InvalidRefresh(Exception):
    """The refresh token is unknown, expired, revoked, reused, or its account can no longer sign in."""


def _hash(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def _new_row(account_type, account_id, family, device_name=""):
    raw = secrets.token_urlsafe(48)
    MobileSession.objects.create(
        account_type=account_type, account_id=account_id, family=family, token_hash=_hash(raw),
        device_name=device_name[:100], expires_at=timezone.now() + REFRESH_LIFETIME,
    )
    return raw


def issue(request, account, account_type):
    """A new refresh token for a mobile sign-in, or None when the request is not from the app."""
    if request is None or request.headers.get(MOBILE_HEADER) != "mobile":
        return None
    data = getattr(request, "data", None)
    device_name = str(data.get("device_name", "")) if hasattr(data, "get") else ""
    return _new_row(account_type, account.pk, secrets.token_hex(16), device_name)


def revoke(raw_token):
    MobileSession.objects.filter(token_hash=_hash(raw_token or ""), revoked_at__isnull=True).update(
        revoked_at=timezone.now()
    )


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
    reused_family = None
    with transaction.atomic():
        row = MobileSession.objects.select_for_update().filter(token_hash=_hash(raw_token or "")).first()
        if row is None or row.revoked_at or row.expires_at <= now:
            raise InvalidRefresh()
        if row.rotated_at:
            reused_family = row.family
        else:
            model = ACCOUNT_MODELS.get(row.account_type)
            account = model.objects.filter(pk=row.account_id).first() if model else None
            if account is None or not _can_sign_in(account):
                row.revoked_at = now
                row.save(update_fields=["revoked_at"])
                account = None
            else:
                row.rotated_at = now
                row.last_used_at = now
                row.save(update_fields=["rotated_at", "last_used_at"])
                new_raw = _new_row(row.account_type, row.account_id, row.family, row.device_name)
                return account, row.account_type, new_raw
    if reused_family:
        revoke_family(reused_family)
    raise InvalidRefresh()

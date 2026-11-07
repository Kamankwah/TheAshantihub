"""Password-reset tokens (review BE-14). The raw token exists only in the emailed/texted link; the database keeps its
SHA-256, so a read of the table (a backup, a SQL injection, a curious admin) cannot be turned into account takeovers.
Issuing a token cancels the account's older unused ones, so only the newest link works."""
import hashlib
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import get_random_string

from .models import PasswordResetToken

LIFETIME = timedelta(hours=1)


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def link_for(raw, account_type):
    # In the #fragment: a browser never sends it to a server, so it stays out of nginx logs and Referer headers.
    return f"{settings.FRONTEND_BASE_URL}/reset-password#token={raw}&type={account_type}"


def issue(account_type, account_id):
    """Create a fresh token for the account and return the raw value (to put in the link; it is not stored)."""
    raw = get_random_string(43)
    with transaction.atomic():
        PasswordResetToken.objects.filter(account_type=account_type, account_id=account_id, used_at__isnull=True).update(
            used_at=timezone.now(),
        )
        PasswordResetToken.objects.create(
            account_type=account_type, account_id=account_id, token=hash_token(raw), expires_at=timezone.now() + LIFETIME,
        )
    return raw

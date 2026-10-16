"""Authenticator-app sign-in for customers and business owners (spec §9). Optional; once confirmed it replaces the
texted/emailed code whenever a sign-in code would be asked (otp.signin.sign_in_step). Reuses the staff module's
TOTP and recovery-code helpers (accounts.two_factor), so both behave the same: ±1 step of clock drift, no code
works twice, recovery codes shown once and kept hashed."""
import logging

import pyotp
from cryptography.fernet import InvalidToken
from django.db import transaction
from django.utils import timezone

from accounts.two_factor import (  # shared helpers; accounts.two_factor stays the staff module
    ISSUER,
    SecretUnreadable,
    _hash_code,
    _match_step,
    _new_recovery_codes,
    _normalise_code,
    decrypt_secret,
    encrypt_secret,
)

from .identity import BUSINESS_OWNER, CUSTOMER, contacts, ref
from .models import EMAIL, SMS, AccountAuthenticator

logger = logging.getLogger(__name__)

KINDS = (CUSTOMER, BUSINESS_OWNER)


def _rows(account):
    account_type, account_id = ref(account)
    return AccountAuthenticator.objects.filter(account_type=account_type, account_id=account_id)


def _open(account, token):
    try:
        return decrypt_secret(token)
    except InvalidToken as exc:
        logger.critical("An authenticator secret for %s %s cannot be decrypted; did STAFF_SECRETS_KEY change?", *ref(account))
        raise SecretUnreadable from exc


def is_enabled(account):
    if ref(account)[0] not in KINDS:
        return False
    row = _rows(account).first()
    return bool(row and row.confirmed_at and row.secret_encrypted)


def _label(account):
    found = contacts(account)
    return found.get(EMAIL) or found.get(SMS) or "AshantiHub account"


def begin(account):
    """A fresh secret waiting for its first code. One already confirmed keeps working until the new one is."""
    secret = pyotp.random_base32()
    account_type, account_id = ref(account)
    row, _ = AccountAuthenticator.objects.get_or_create(account_type=account_type, account_id=account_id)
    row.pending_secret_encrypted = encrypt_secret(secret)
    row.save(update_fields=["pending_secret_encrypted"])
    return secret, pyotp.TOTP(secret).provisioning_uri(name=_label(account), issuer_name=ISSUER)


def confirm(account, code, now=None):
    """Switch the pending secret on if `code` matches it. Returns 10 new recovery codes (shown once), or None."""
    with transaction.atomic():
        row = _rows(account).select_for_update().first()
        if row is None or not row.pending_secret_encrypted:
            return None
        step = _match_step(_open(account, row.pending_secret_encrypted), code, 0, now)
        if step is None:
            return None
        codes = _new_recovery_codes()
        row.secret_encrypted = row.pending_secret_encrypted
        row.pending_secret_encrypted = ""
        row.confirmed_at = timezone.now()
        row.last_used_step = step
        row.recovery_code_hashes = [_hash_code(_normalise_code(c)) for c in codes]
        row.save()
    return codes


def verify(account, code, now=None):
    with transaction.atomic():
        row = _rows(account).select_for_update().first()
        if row is None or not row.confirmed_at or not row.secret_encrypted:
            return False
        step = _match_step(_open(account, row.secret_encrypted), code, row.last_used_step, now)
        if step is None:
            return False
        row.last_used_step = step
        row.save(update_fields=["last_used_step"])
    return True


def use_recovery_code(account, code):
    normalised = _normalise_code(code) if isinstance(code, str) else ""
    if not normalised:
        return False
    with transaction.atomic():
        row = _rows(account).select_for_update().first()
        hashed = _hash_code(normalised)
        if row is None or not row.confirmed_at or hashed not in row.recovery_code_hashes:
            return False
        row.recovery_code_hashes = [h for h in row.recovery_code_hashes if h != hashed]
        row.save(update_fields=["recovery_code_hashes"])
    return True


def regenerate_recovery_codes(account):
    if not is_enabled(account):
        return None
    codes = _new_recovery_codes()
    _rows(account).update(recovery_code_hashes=[_hash_code(_normalise_code(c)) for c in codes])
    return codes


def disable(account):
    """Remove it (and any pending secret). True when there was one."""
    deleted, _ = _rows(account).delete()
    return bool(deleted)


def status(account):
    row = _rows(account).first()
    enabled = bool(row and row.confirmed_at and row.secret_encrypted)
    return {
        "enabled": enabled,
        "enabled_at": row.confirmed_at if enabled else None,
        "recovery_codes_left": len(row.recovery_code_hashes) if enabled else 0,
    }

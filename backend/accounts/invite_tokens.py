"""Staff invitation tokens and customers' short verification codes, kept hashed (review DB-14).

An invite token is a 43-character random string that lives only in the emailed link; the database keeps its SHA-256, so a read of
`accounts_staffuser` (a backup, a SQL injection) cannot be turned into a working activation link. A customer's six-digit
secondary-contact code is kept as an HMAC under the PII index key, which is not in the database: a dump alone does not reveal a
live code. Rows written before this change (a 43-character token, a six-digit code) still work until they expire or are replaced.
"""
import hmac

from django.utils.crypto import get_random_string

from core import pii

from .reset_tokens import hash_token


def new_invite_token():
    """(raw, stored): put `raw` in the link, save `stored` in `StaffUser.invite_token`."""
    raw = get_random_string(43)
    return raw, hash_token(raw)


def stored_invite_token(raw):
    """What to look an incoming invite token up by."""
    return hash_token(raw)


def new_verify_code():
    """(raw, stored) for a six-digit code to send to the customer."""
    raw = get_random_string(6, allowed_chars="0123456789")
    return raw, pii.blind_index("verify_code", raw)


def verify_code_matches(stored, given):
    """True when `given` is the code `stored` holds; a legacy plaintext six-digit value is compared as it is."""
    if not stored or not given:
        return False
    if len(stored) == 6:  # written before DB-14
        return hmac.compare_digest(stored, given)
    return hmac.compare_digest(stored, pii.blind_index("verify_code", given) or "")

"""Trusted devices (spec §9). After a code, a customer may trust the browser. The raw token is returned once, in
the response body; the frontend keeps it (local storage — the API is on another origin, so no cookie) and sends it
back as `device_token` with the password. The row keeps its SHA-256. A device skips the customer's sign-in code
only while it is not revoked, its password fingerprint matches the account's current password (so ANY password
change ends it) and its last code is newer than the customer gap (staffsecurity.policy, default 30 days)."""
import hashlib
import secrets
from datetime import timedelta

from django.utils import timezone

from accounts.sessions import describe_device

from . import audit
from .identity import fingerprint, ref
from .models import OtpEvent, TrustedDevice


def _hash(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def _gap():
    from staffsecurity import policy

    return timedelta(days=policy.otp_customer_gap_days())


def _mine(account):
    account_type, account_id = ref(account)
    return TrustedDevice.objects.filter(account_type=account_type, account_id=account_id, revoked_at__isnull=True)


def find(account, raw, now=None):
    """The live device row this raw token names for this account, or None."""
    if not isinstance(raw, str) or not raw or len(raw) > 200:
        return None
    now = now or timezone.now()
    device = _mine(account).filter(token_hash=_hash(raw)).first()
    if device is None or device.password_fingerprint != fingerprint(account) or device.verified_at < now - _gap():
        return None
    return device


def is_trusted(account, raw, now=None):
    now = now or timezone.now()
    device = find(account, raw, now)
    if device is None:
        return False
    TrustedDevice.objects.filter(pk=device.pk).update(last_seen_at=now)
    return True


def trust(account, request, *, existing="", now=None):
    """After a code was accepted: refresh the device the client already holds (`existing`, if it is this account's
    and not revoked) or create a new one. Returns the raw token for the client."""
    now = now or timezone.now()
    if isinstance(existing, str) and existing:
        device = _mine(account).filter(token_hash=_hash(existing)).first()
        if device is not None:
            TrustedDevice.objects.filter(pk=device.pk).update(
                verified_at=now, last_seen_at=now, password_fingerprint=fingerprint(account),
            )
            return existing
    account_type, account_id = ref(account)
    raw = secrets.token_urlsafe(32)
    django_request = getattr(request, "_request", request)
    agent = django_request.META.get("HTTP_USER_AGENT", "")[:300] if django_request is not None else ""
    device = TrustedDevice.objects.create(
        account_type=account_type, account_id=account_id, token_hash=_hash(raw), label=describe_device(agent)[:120],
        password_fingerprint=fingerprint(account), created_at=now, verified_at=now, last_seen_at=now,
    )
    audit.log(OtpEvent.DEVICE_TRUSTED, account=account, note=device.label, request=request, now=now)
    return raw


def revoke_all(account, reason, *, request=None, now=None):
    """End every trusted device of this account (password reset, staff recovery, "remove all")."""
    now = now or timezone.now()
    ended = _mine(account).update(revoked_at=now, revoked_reason=reason)
    if ended:
        audit.log(OtpEvent.DEVICE_REVOKED, account=account, note=f"{ended} device(s): {reason}", request=request, now=now)
    return ended


def live(account, now=None):
    """This account's devices that would skip a code now, most recently seen first."""
    now = now or timezone.now()
    rows = _mine(account).filter(password_fingerprint=fingerprint(account), verified_at__gte=now - _gap())
    return list(rows.order_by("-last_seen_at", "-id"))

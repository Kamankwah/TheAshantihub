"""Email confirmation for business owners (self-serve onboarding, phase 2, Task 1).

The owner proves they receive their email by opening a mailed link. It is a bearer token made like the shop-location
one (`accounts.location_capture`): `secrets.token_urlsafe(32)`, stored only as its SHA-256 hash, single use, 48 hours,
and a newer link for the same business revokes the older live ones. The raw token lives only in the email body and
the owner's browser; it is never logged, put in an activity event or returned by any response.

Confirming writes an `otp.VerifiedContact` (the same record an accepted emailed code writes), matched on the lower-cased
address, so a changed email is unconfirmed until a new link is opened.

Lock order: the BusinessOwner row, then the token row. The public confirm finds the row by hash WITHOUT a lock, locks the
owner, then re-reads and locks the row and checks it again, so a replay and a new link cannot deadlock.
"""
import secrets
from datetime import datetime, time, timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from otp.models import EMAIL, VerifiedContact

from .claims import ClaimError, hash_token
from .emails import send_email_confirmation_email
from .models import BusinessOwner, EmailConfirmationToken

LINK_TTL = timedelta(hours=48)
DAILY_LINKS = 5  # links per business per Accra day
ACCOUNT_TYPE = "business_owner"

INVALID = "This link isn't valid. Check you opened the whole link, or ask for a new one from your dashboard."
USED = "This link has already been used. If your email still shows as unconfirmed, ask for a new one from your dashboard."
REVOKED = "This link has been replaced by a newer one. Open the newest email from AshantiHub, or ask for a new one."
EXPIRED = "This link has expired. Ask for a new one from your dashboard."
TOO_MANY = "Five confirmation emails a day is the most one business can be sent. Try again tomorrow."
NO_EMAIL = "Add an email address to your account first."


def normalise(email):
    return (email or "").strip().lower()


def link_url(raw):
    """The token rides in the URL fragment: a browser never sends it to the frontend host, so it stays out of that
    host's request logs. The page reads it, strips it from the address bar and POSTs it."""
    return f"{settings.FRONTEND_BASE_URL}/confirm-email#token={raw}"


def send(owner):
    """Mail the owner a fresh link and revoke the older live ones. Raises ClaimError `no_email` (400) or `too_many_links`
    (429). Call it outside any transaction of your own where you can (or from `transaction.on_commit`): the mail goes as
    soon as the link row is committed."""
    with transaction.atomic():
        locked = BusinessOwner.objects.select_for_update().get(pk=owner.pk)  # 1. the owner
        email = normalise(locked.email)
        if not email:
            raise ClaimError(NO_EMAIL, code="no_email", status_code=400)
        now = timezone.now()
        start = timezone.make_aware(datetime.combine(timezone.localdate(now), time.min))
        if EmailConfirmationToken.objects.filter(business_owner=locked, created_at__gte=start).count() >= DAILY_LINKS:
            raise ClaimError(TOO_MANY, code="too_many_links", status_code=429)
        EmailConfirmationToken.objects.filter(
            business_owner=locked, used_at__isnull=True, revoked_at__isnull=True,
        ).update(revoked_at=now)  # 2. the older live links
        raw = secrets.token_urlsafe(32)
        EmailConfirmationToken.objects.create(
            business_owner=locked, email=email, token_hash=hash_token(raw), expires_at=now + LINK_TTL,
        )
    send_email_confirmation_email(locked.email, link_url(raw))


def _find(raw):
    raw = raw.strip() if isinstance(raw, str) else ""
    row = EmailConfirmationToken.objects.filter(token_hash=hash_token(raw)).first() if raw else None
    if row is None:
        raise ClaimError(INVALID, code="invalid", status_code=400)
    return row


def _check_usable(row, now):
    if row.used_at is not None:
        raise ClaimError(USED, code="used", status_code=410)
    if row.revoked_at is not None:
        raise ClaimError(REVOKED, code="revoked", status_code=410)
    if row.expires_at <= now:
        raise ClaimError(EXPIRED, code="expired", status_code=410)


def confirm(raw):
    """Open the link: use it up and record that the owner receives the address it was sent to. Returns the owner."""
    with transaction.atomic():
        now = timezone.now()
        found = _find(raw)
        owner = BusinessOwner.objects.select_for_update().get(pk=found.business_owner_id)  # 1. the owner
        row = EmailConfirmationToken.objects.select_for_update().get(pk=found.pk)  # 2. the link
        _check_usable(row, now)
        row.used_at = now
        row.save(update_fields=["used_at"])
        VerifiedContact.objects.bulk_create(
            [VerifiedContact(
                account_type=ACCOUNT_TYPE, account_id=owner.pk, channel=EMAIL, destination=row.email, verified_at=now,
            )],
            ignore_conflicts=True,
        )
    return owner


def is_confirmed(owner):
    """True when the owner's current email has been confirmed (matched on the lower-cased address)."""
    email = normalise(owner.email)
    return bool(email) and VerifiedContact.objects.filter(
        account_type=ACCOUNT_TYPE, account_id=owner.pk, channel=EMAIL, destination=email,
    ).exists()

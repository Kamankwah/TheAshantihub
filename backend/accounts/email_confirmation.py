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

from .claims import ClaimError, hash_token, mask_email
from .emails import send_email_confirmation_email
from .serializers import EMAIL_TAKEN
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
EMAIL_CONFIRMED = (
    "Your email address is already confirmed, so it can only be changed with our team's check. "
    "Open Profile & Settings and choose Request a change."
)


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


def address_taken(owner, address):
    """True when `address` is already another contact in the system: another business owner's email (any letter case),
    a staff member's email, or a customer's verified recovery email (a place that account's codes go). One answer for all
    three, so the refusal never says which kind it was."""
    from portfolio.detail_changes import _recovery_clash
    from portfolio.proposals import contact_duplicate_errors

    return bool(contact_duplicate_errors(owner, {"email": address}).get("email") or _recovery_clash("email", address))


def set_email(owner, address, *, request=None):
    """Let the signed-in owner add or correct their own email, but ONLY while none is on file or the one on file has not
    been confirmed (a confirmed address is the staff-verified change path: `portfolio.detail_changes`). Raises ClaimError
    `email_confirmed` (403), or `email_taken` (400) when the address is another contact's (see `address_taken`).

    The address is a password-reset destination and a sign-in code channel, so an ACTUAL change (not the same address
    typed again) does what the staff-checked route does (`portfolio.detail_changes.approval_apply`): payout destinations
    wait the cooling period again, trusted devices and every phone session end (owner web tokens are stateless and
    cannot be revoked), the OLD contact (old email, else the sign-in phone) is told after commit, and
    `business.email_changed` is recorded with masked values, last, because record() holds the activity chain lock until
    commit. Normalised address saved; every live confirmation link (made for the old address) is revoked either way.

    Call it inside the view's transaction, after the step-up check, and then call `send` outside it. The owner row is
    locked first, as in `send`, so a confirm and a correction cannot interleave. Returns the locked owner."""
    from activity.services import record
    from otp import devices, notices
    from otp.models import SMS, TrustedDevice
    from wallets.holder_details import restart_cooling

    from . import mobile_sessions

    address = normalise(address)
    with transaction.atomic():
        locked = BusinessOwner.objects.select_for_update().get(pk=owner.pk)  # 1. the owner
        if is_confirmed(locked):
            raise ClaimError(EMAIL_CONFIRMED, code="email_confirmed", status_code=403)
        if address_taken(locked, address):
            raise ClaimError(EMAIL_TAKEN, code="email_taken", status_code=400)
        before = normalise(locked.email)
        now = timezone.now()
        EmailConfirmationToken.objects.filter(
            business_owner=locked, used_at__isnull=True, revoked_at__isnull=True,
        ).update(revoked_at=now)  # 2. the live links for the old address
        if before == address:
            return locked
        locked.email = address
        locked.save(update_fields=["email"])
        cooling = restart_cooling(locked, now)
        devices_ended = devices.revoke_all(locked, TrustedDevice.STAFF_RECOVERY, now=now)
        sessions_ended = mobile_sessions.revoke_all("business_owner", locked.pk)
        if before:
            transaction.on_commit(lambda: notices.contact_changed(locked, EMAIL, before, now=now))
        elif (locked.login_phone or "").strip():
            phone = locked.login_phone
            transaction.on_commit(
                lambda: notices.contact_changed(locked, SMS, phone, now=now, text=notices.EMAIL_ADDED_TEXT)
            )
        record(
            locked, "business.email_changed", target=locked,
            summary="Added or corrected the business's own email before confirming it",
            before={"email": mask_email(before) if before else None},
            after={"email": mask_email(address), "destinations_cooling": cooling, "trusted_devices_ended": devices_ended,
                   "phone_sessions_ended": sessions_ended},
            request=request,
        )
    return locked


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

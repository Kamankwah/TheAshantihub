"""Notify-me: people who asked to be told when the marketplace opens. Capture is idempotent; the opening send
is batched and exactly-once per channel: rows are claimed (a lease) in a short transaction, the provider is
called outside any transaction, then the row is stamped sent - or the claim is released so a later tick retries."""
import logging
import secrets
import time
from datetime import timedelta
from urllib.parse import urlsplit

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from accounts.phones import normalize_gh_phone, phone_key
from otp.senders import send_email, send_sms

from . import opening
from .models import NotifyRequest

logger = logging.getLogger(__name__)

NOTIFY_BATCH = 100
LEASE = timedelta(minutes=10)
DEFAULT_SITE_HOST = "theashantihub.com"


def stop_link(token):
    return f"{settings.FRONTEND_BASE_URL.rstrip('/')}/notify/stop/{token}"


def clean_phone(raw):
    """E.164 or None when blank; ValueError (with the form message) when unusable."""
    if raw is None or not str(raw).strip():
        return None
    return normalize_gh_phone(raw)


def clean_email(raw):
    if raw is None or not str(raw).strip():
        return None
    email = str(raw).strip().lower()
    try:
        validate_email(email)
    except ValidationError:
        raise ValueError("Enter a valid email address.")
    return email


def subscribe(phone=None, email=None):
    """Save (or merge into) the request. At least one of phone/email is required (ValueError). A phone or email
    that already belongs to another row is never moved: when the two given values sit on different rows, the
    phone's row wins and nothing is changed."""
    e164 = clean_phone(phone)
    email_lower = clean_email(email)
    if not e164 and not email_lower:
        raise ValueError("Give a phone number or an email address.")
    key = phone_key(e164) if e164 else None
    for _ in range(2):
        by_phone = NotifyRequest.objects.filter(phone_key=key).first() if key else None
        by_email = NotifyRequest.objects.filter(email_lower=email_lower).first() if email_lower else None
        row = by_phone or by_email
        if row is None:
            try:
                with transaction.atomic():
                    return NotifyRequest.objects.create(
                        phone_key=key, phone=e164 or "", email_lower=email_lower, token=secrets.token_urlsafe(24),
                    )
            except IntegrityError:
                continue  # a concurrent submit made the row; find it on the next pass
        changed = []
        if e164 and not row.phone_key and by_phone is None:
            row.phone_key, row.phone = key, e164
            changed += ["phone_key", "phone"]
        if email_lower and not row.email_lower and by_email is None:
            row.email_lower = email_lower
            changed.append("email_lower")
        if changed:
            try:
                with transaction.atomic():
                    row.save(update_fields=changed)
            except IntegrityError:
                continue
        return row
    match = Q()
    if key:
        match |= Q(phone_key=key)
    if email_lower:
        match |= Q(email_lower=email_lower)
    return NotifyRequest.objects.filter(match).first()


def opt_out(token):
    """True when a row with this token was found (and is now opted out)."""
    if not token or not isinstance(token, str):
        return False
    return bool(NotifyRequest.objects.filter(token=token, opted_out_at__isnull=True).update(opted_out_at=timezone.now())
                or NotifyRequest.objects.filter(token=token).exists())


def site_host():
    """The bare host of FRONTEND_BASE_URL for the text; an unset or unusable value (no dotted host, e.g. the
    localhost dev default) falls back to DEFAULT_SITE_HOST so the text never carries a broken link."""
    raw = str(getattr(settings, "FRONTEND_BASE_URL", "") or "").strip()
    try:
        host = urlsplit(raw if "//" in raw else f"//{raw}").hostname or ""
    except ValueError:
        host = ""
    if "." not in host or not host.isascii() or " " in host:
        return DEFAULT_SITE_HOST
    return host


def sms_body(token=None):
    # One GSM-7 segment, no emoji. No stop link: the email carries it and a reply STOP is handled by the carrier.
    return f"AshantiHub is open! Shop now: {site_host()}"


def email_parts(token):
    base = settings.FRONTEND_BASE_URL.rstrip("/")
    subject = "The AshantiHub marketplace is open"
    body = (
        "Good news: the AshantiHub marketplace is now open.\n\n"
        f"Start shopping: {base}\n\n"
        f"You asked us to tell you when it opened. To stop these messages: {stop_link(token)}\n"
    )
    return subject, body


def _claim(now, limit):
    """Lease up to `limit` rows' unsent channels; returns [(pk, token, phone or None, email or None)]."""
    stale = now - LEASE
    sms_due = Q(phone_key__isnull=False, sms_sent_at__isnull=True) & (Q(sms_claimed_at__isnull=True) | Q(sms_claimed_at__lt=stale))
    email_due = Q(email_lower__isnull=False, email_sent_at__isnull=True) & (Q(email_claimed_at__isnull=True) | Q(email_claimed_at__lt=stale))
    claimed = []
    with transaction.atomic():
        if not (opening.gate_enabled() and now >= opening.opens_at()):
            return claimed  # re-checked inside the claim: a delay may have landed since the caller looked
        rows = list(
            NotifyRequest.objects.select_for_update(skip_locked=True)
            .filter(opted_out_at__isnull=True).filter(sms_due | email_due).order_by("id")[:limit]
        )
        for row in rows:
            phone = row.phone if row.phone_key and not row.sms_sent_at and (row.sms_claimed_at is None or row.sms_claimed_at < stale) else None
            email = row.email_lower if row.email_lower and not row.email_sent_at and (row.email_claimed_at is None or row.email_claimed_at < stale) else None
            updates = {}
            if phone:
                updates["sms_claimed_at"] = now
            if email:
                updates["email_claimed_at"] = now
            NotifyRequest.objects.filter(pk=row.pk).update(**updates)
            claimed.append((row.pk, row.token, phone, email))
    return claimed


def _deliver(send):
    try:
        return bool(send().ok)
    except Exception as exc:  # a provider bug must not strand the claim
        logger.warning("Opening notice not sent: %s", type(exc).__name__)
        return False


def _still_mine(pk, channel, claim, require_open=True):
    """Atomically re-check that this batch still owns the channel's claim (no one reclaimed it, nothing sent
    yet, not opted out). A no-op write whose row count is the answer, so there is no check-then-act gap."""
    rows = NotifyRequest.objects.filter(pk=pk, **{f"{channel}_claimed_at": claim, f"{channel}_sent_at__isnull": True})
    if require_open:
        rows = rows.filter(opted_out_at__isnull=True)
    return rows.update(**{f"{channel}_claimed_at": claim}) == 1


def _finish(pk, channel, claim, ok):
    """Stamp sent on success or release the claim on failure - only if the claim is still this batch's."""
    rows = NotifyRequest.objects.filter(pk=pk, **{f"{channel}_claimed_at": claim})
    rows.update(**({f"{channel}_sent_at": timezone.now()} if ok else {f"{channel}_claimed_at": None}))


def _send_channel(pk, channel, claim, send):
    if not _still_mine(pk, channel, claim):
        return False
    ok = _deliver(send)
    _finish(pk, channel, claim, ok)
    return ok


def send_batch(now=None, limit=NOTIFY_BATCH):
    """Send the opening notices to up to `limit` people; returns how many received at least one. Sends only when
    the gate is on and the opening time has been reached. Before every send the batch re-checks it still owns the
    claim; past half the lease it stops and releases what is left, so a slow provider cannot cause a double send."""
    now = now or timezone.now()
    if not (opening.gate_enabled() and now >= opening.opens_at()):
        return 0
    started = time.monotonic()
    claimed = _claim(now, limit)
    delivered = 0
    for index, (pk, token, phone, email) in enumerate(claimed):
        if time.monotonic() - started > LEASE.total_seconds() / 2:
            for rpk, _, rphone, remail in claimed[index:]:
                if rphone:
                    _finish(rpk, "sms", now, False)
                if remail:
                    _finish(rpk, "email", now, False)
            break
        ok_any = False
        if phone:
            ok_any = _send_channel(pk, "sms", now, lambda: send_sms(phone, sms_body(token))) or ok_any
        if email:
            subject, body = email_parts(token)
            ok_any = _send_channel(pk, "email", now, lambda: send_email(email, subject, body)) or ok_any
        delivered += ok_any
    return delivered

"""Writes the sign-in history. Every function here swallows its own failure: a
history line must never stop someone signing in, out, or being refused."""
import logging
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .models import StaffSignInRecord

logger = logging.getLogger(__name__)

RETENTION_DAYS = 400
COALESCE_WINDOW = timedelta(minutes=10)
FAILURES = (
    StaffSignInRecord.SIGN_IN_FAILED, StaffSignInRecord.TWO_STEP_FAILED, StaffSignInRecord.PASSWORD_REENTRY_FAILED,
)


def purge_old(now=None):
    """Delete sign-in lines older than RETENTION_DAYS (nightly job)."""
    cutoff = (now or timezone.now()) - timedelta(days=RETENTION_DAYS)
    deleted, _ = StaffSignInRecord.objects.filter(at__lt=cutoff).delete()
    return deleted


def mask_identifier(value):
    """What was typed in the address box, kept only in part ("ko***@example.com").
    Never the password, and the same treatment whether or not an account matched."""
    text = value.strip()[:120] if isinstance(value, str) else ""
    if not text:
        return ""
    local, at, domain = text.partition("@")
    shown = local[:2] if len(local) > 2 else local[:1]
    return f"{shown}***{at}{domain}"


def log(kind, request=None, *, staff=None, identifier="", note="", two_factor=False):
    from accounts.sessions import describe_device
    from activity.services import client_ip

    try:
        django_request = getattr(request, "_request", request)
        agent = django_request.META.get("HTTP_USER_AGENT", "")[:300] if django_request is not None else ""
        ip = client_ip(django_request) if django_request is not None else None
        masked = mask_identifier(identifier)
        with transaction.atomic():  # a savepoint: a failed insert must not poison the caller's transaction
            if kind in FAILURES:
                now = timezone.now()
                recent = (
                    StaffSignInRecord.objects.select_for_update()
                    .filter(kind=kind, identifier_masked=masked, ip=ip, staff=staff, at__gte=now - COALESCE_WINDOW)
                    .order_by("-id").first()
                )
                if recent is not None:
                    StaffSignInRecord.objects.filter(pk=recent.pk).update(attempts=F("attempts") + 1, at=now)
                    recent.refresh_from_db()
                    return recent
            return StaffSignInRecord.objects.create(
                kind=kind, staff=staff, identifier_masked=masked, note=note[:200],
                two_factor=two_factor, user_agent=agent, device_label=describe_device(agent) if agent else "",
                ip=ip,
            )
    except Exception:
        logger.exception("Could not write the %s sign-in history line", kind)
        return None

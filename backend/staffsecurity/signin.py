"""Writes the sign-in history. Every function here swallows its own failure: a
history line must never stop someone signing in, out, or being refused."""
import logging

from django.db import transaction

from .models import StaffSignInRecord

logger = logging.getLogger(__name__)


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
        with transaction.atomic():  # a savepoint: a failed insert must not poison the caller's transaction
            return StaffSignInRecord.objects.create(
                kind=kind, staff=staff, identifier_masked=mask_identifier(identifier), note=note[:200],
                two_factor=two_factor, user_agent=agent, device_label=describe_device(agent) if agent else "",
                ip=client_ip(django_request) if django_request is not None else None,
            )
    except Exception:
        logger.exception("Could not write the %s sign-in history line", kind)
        return None

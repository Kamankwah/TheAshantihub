"""Server-side staff sessions (staff foundations F9).

Every staff access token carries a `jti` naming one StaffSession row. The row
is what gives otherwise stateless JWTs a real sign-out, "sign out all
devices", the 30-minute idle limit, the 12-hour absolute limit and password
re-entry ("sudo"). MultiAccountJWTAuthentication calls validate() and touch()
on every staff request.
"""
from datetime import timedelta

from django.utils import timezone
from rest_framework import exceptions

from .models import StaffSession

IDLE_LIMIT = timedelta(minutes=30)
ABSOLUTE_LIMIT = timedelta(hours=12)
SEEN_WRITE_INTERVAL = timedelta(minutes=1)
SUDO_WINDOW = timedelta(minutes=10)
RETENTION = timedelta(days=90)
ENDED_MESSAGE = "Your session has ended. Sign in again."
SUDO_MESSAGE = "Re-enter your password to continue."


def describe_device(user_agent):
    """"Chrome on Android device", "Safari on iPhone", … from a User-Agent."""
    ua = user_agent or ""
    if "Edg/" in ua:
        browser = "Edge"
    elif "Firefox/" in ua or "FxiOS/" in ua:
        browser = "Firefox"
    elif "Chrome/" in ua or "CriOS/" in ua:
        browser = "Chrome"
    elif "Safari/" in ua:
        browser = "Safari"
    else:
        browser = ""
    if "iPhone" in ua:
        device = "iPhone"
    elif "iPad" in ua:
        device = "iPad"
    elif "Android" in ua:
        device = "Android device"
    elif "Windows" in ua:
        device = "Windows computer"
    elif "Macintosh" in ua or "Mac OS X" in ua:
        device = "Mac"
    elif "Linux" in ua:
        device = "Linux computer"
    else:
        device = ""
    if browser and device:
        return f"{browser} on {device}"
    return browser or device or "Unknown device"


def start(staff, jti, request=None, *, two_factor=False):
    # Imported here: activity.services imports accounts.serializers, which
    # imports accounts.authentication, which imports this module.
    from activity.services import client_ip

    django_request = getattr(request, "_request", request)
    user_agent = django_request.META.get("HTTP_USER_AGENT", "")[:300] if django_request is not None else ""
    return StaffSession.objects.create(
        staff=staff,
        jti=jti,
        device_label=describe_device(user_agent),
        user_agent=user_agent,
        ip=client_ip(django_request) if django_request is not None else None,
        two_factor=two_factor,
    )


def end_reason_if_invalid(session, now=None):
    """None while the session may still be used, else why it ended."""
    now = now or timezone.now()
    if session.revoked_at is not None:
        return session.revoked_reason or StaffSession.SIGNED_OUT
    if now - session.created_at > ABSOLUTE_LIMIT:
        return StaffSession.EXPIRED
    if now - session.last_seen_at > IDLE_LIMIT:
        return StaffSession.IDLE
    return None


def validate(staff, token):
    """The live session behind a staff access token, or AuthenticationFailed."""
    session = StaffSession.objects.filter(jti=token.get("jti", ""), staff_id=staff.pk).first()
    if session is None:
        raise exceptions.AuthenticationFailed(ENDED_MESSAGE)
    reason = end_reason_if_invalid(session)
    if reason:
        if session.revoked_at is None:
            StaffSession.objects.filter(pk=session.pk, revoked_at__isnull=True).update(
                revoked_at=timezone.now(), revoked_reason=reason
            )
        raise exceptions.AuthenticationFailed(ENDED_MESSAGE)
    return session


def touch(session, now=None):
    """Record activity, at most one write a minute per session."""
    now = now or timezone.now()
    if now - session.last_seen_at >= SEEN_WRITE_INTERVAL:
        StaffSession.objects.filter(pk=session.pk).update(last_seen_at=now)
        session.last_seen_at = now


def current(request):
    """The session that authenticated this request (staff only), or None."""
    return getattr(getattr(request, "auth", None), "staff_session", None)


def revoke(session, reason):
    return StaffSession.objects.filter(pk=session.pk, revoked_at__isnull=True).update(
        revoked_at=timezone.now(), revoked_reason=reason
    )


def revoke_all(staff, reason, *, except_session=None):
    sessions = StaffSession.objects.filter(staff=staff, revoked_at__isnull=True)
    if except_session is not None:
        sessions = sessions.exclude(pk=except_session.pk)
    return sessions.update(revoked_at=timezone.now(), revoked_reason=reason)


def grant_sudo(session, now=None):
    until = (now or timezone.now()) + SUDO_WINDOW
    StaffSession.objects.filter(pk=session.pk).update(sudo_until=until)
    session.sudo_until = until
    return until


def has_sudo(request):
    session = current(request)
    return bool(session and session.sudo_until and session.sudo_until > timezone.now())


def require_sudo(request):
    if not has_sudo(request):
        raise exceptions.PermissionDenied({"detail": SUDO_MESSAGE, "code": "sudo_required"})


def cleanup(now=None):
    """Mark sessions that timed out as ended and forget rows older than 90
    days (sign-ins older than that live on in the activity log)."""
    now = now or timezone.now()
    StaffSession.objects.filter(revoked_at__isnull=True, created_at__lt=now - ABSOLUTE_LIMIT).update(
        revoked_at=now, revoked_reason=StaffSession.EXPIRED
    )
    StaffSession.objects.filter(revoked_at__isnull=True, last_seen_at__lt=now - IDLE_LIMIT).update(
        revoked_at=now, revoked_reason=StaffSession.IDLE
    )
    deleted, _ = StaffSession.objects.filter(created_at__lt=now - RETENTION).delete()
    return deleted

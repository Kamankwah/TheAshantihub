import logging

from .models import Notification

logger = logging.getLogger(__name__)


def _create(recipient, kind, title, body="", link="", icon=""):
    """Create one Notification. Never raises — a notification is a side
    effect of the triggering request (a KYC approval, a listing submission,
    an order update), and must never break it. Mirrors accounts.emails._send's
    best-effort "log the failure, swallow the exception" convention.

    `recipient` is a single {field: instance} kwarg dict identifying exactly
    one of customer/business_owner/staff.
    """
    try:
        return Notification.objects.create(
            kind=kind, title=title, body=body or "", link=link or "", icon=icon or "", **recipient
        )
    except Exception:
        logger.exception("Failed to create %s notification (title: %s)", kind, title)
        return None


def notify_customer(customer, kind, title, body="", link="", icon=""):
    """Notify a single Customer. No-op (returns None) if customer is falsy —
    callers can pass a maybe-None recipient (e.g. a guest support thread has
    no account) without guarding first."""
    if not customer:
        return None
    return _create({"customer": customer}, kind, title, body, link, icon)


def notify_business_owner(business_owner, kind, title, body="", link="", icon=""):
    if not business_owner:
        return None
    return _create({"business_owner": business_owner}, kind, title, body, link, icon)


def notify_staff(staff, kind, title, body="", link="", icon=""):
    if not staff:
        return None
    return _create({"staff": staff}, kind, title, body, link, icon)


def notify_staff_role(permission_codename, kind, title, body="", link="", icon=""):
    """Fan out one Notification to every StaffUser whose role holds
    `permission_codename` — e.g. everyone who can approve KYC when a new
    submission lands. Best-effort per staffer (a single failed row is logged
    and skipped, the rest still send). Returns the list of created rows.

    Imported lazily to avoid an import cycle (accounts.models is imported by
    notifications.models, and some accounts views import this module).
    """
    from accounts.models import StaffUser

    created = []
    try:
        recipients = StaffUser.objects.filter(
            role__permissions__codename=permission_codename
        ).distinct()
    except Exception:
        logger.exception("Failed to resolve staff for permission %s", permission_codename)
        return created
    for staff in recipients:
        notification = _create({"staff": staff}, kind, title, body, link, icon)
        if notification is not None:
            created.append(notification)
    return created

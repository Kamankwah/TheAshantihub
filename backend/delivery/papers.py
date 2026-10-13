"""Expiry and reminders for riders' papers (run by ``delivery.tasks.run_paper_checks``).

* An approved paper whose date has passed becomes ``expired``.
* A rider with an expired or missing required paper is suspended (``Rider.suspension_source =
  "documents"``), but never while they have a job on the road: the check runs again the next hour.
* Reminders go out 30, 14 and 7 days before a paper expires, once each, as in-app notices to the
  rider and their manager. SMS and push are not connected, and the screens say so."""
from django.utils import timezone

from accounts import sessions
from accounts.models import StaffSession
from notifications.services import notify_staff
from orders.models import DeliveryAssignment

from . import services
from .models import Rider, RiderDocument

REMINDER_DAYS = (30, 14, 7)


def run(now=None):
    now = now or timezone.now()
    today = timezone.localdate(now)
    expired = 0
    for doc in RiderDocument.objects.select_related("rider__staff").filter(status=RiderDocument.APPROVED, expires_on__lt=today):
        doc.status = RiderDocument.EXPIRED
        doc.save(update_fields=["status"])
        expired += 1
    reminded = _remind(today)
    suspended = _suspend(today)
    return {"expired": expired, "reminded": reminded, "suspended": suspended}


def _remind(today):
    sent = 0
    docs = RiderDocument.objects.select_related("rider__staff__manager").filter(
        status=RiderDocument.APPROVED, expires_on__isnull=False, expires_on__gte=today, rider__staff__is_active=True, rider__staff__is_suspended=False,
    )
    for doc in docs:
        days = (doc.expires_on - today).days
        due = [d for d in REMINDER_DAYS if days <= d and d not in doc.reminders_sent]
        if not due:
            continue
        # Only the tightest window that is now due is sent (a paper first seen 5 days out gets one notice, not three).
        window = min(due)
        doc.reminders_sent = sorted({*doc.reminders_sent, *due})
        doc.save(update_fields=["reminders_sent"])
        staff = doc.rider.staff
        body = f"Your {doc.get_kind_display()} expires on {doc.expires_on:%-d %b %Y} ({days} days). Upload the renewed paper in Documents."
        notify_staff(staff, "delivery_document", f"Your {doc.get_kind_display()} expires in {days} days", body=body, link="/staff/documents", icon="🪪")
        if staff.manager_id:
            notify_staff(
                staff.manager, "delivery_document", f"{staff.full_name}: {doc.get_kind_display()} expires in {days} days",
                body=f"{window}-day reminder sent to the rider.", link="/staff/documents", icon="🪪",
            )
        sent += 1
    return sent


def _suspend(today):
    count = 0
    riders = Rider.objects.select_related("staff").filter(staff__is_active=True, staff__is_suspended=False, staff__invite_token__isnull=True)
    for rider in riders:
        # A rider with no papers at all has simply not started; only a lapsed paper suspends.
        lapsed = rider.documents.filter(kind__in=services.REQUIRED_DOCUMENTS, status=RiderDocument.EXPIRED).exists()
        if not lapsed or not services.required_documents_missing(rider, today):
            continue
        if DeliveryAssignment.objects.filter(dispatch=rider.staff, status__in=DeliveryAssignment.ACTIVE_STATUSES).exists():
            continue  # never in the middle of a job; the next run catches it
        staff = rider.staff
        staff.is_suspended = True
        staff.suspension_reason = "A required paper has expired."
        staff.save(update_fields=["is_suspended", "suspension_reason"])
        rider.suspension_source = Rider.DOCUMENTS
        rider.save(update_fields=["suspension_source"])
        services.end_shift(rider, "suspended")
        sessions.revoke_all(staff, StaffSession.SUSPENDED)
        if staff.manager_id:
            notify_staff(staff.manager, "delivery_document", f"{staff.full_name} was suspended: a paper expired", body="Approve the renewed paper to reinstate them.", link="/staff/documents", icon="🪪")
        count += 1
    return count

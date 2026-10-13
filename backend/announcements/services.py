import logging

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.emails import _send
from accounts.models import StaffUser
from activity.services import record
from notifications.services import notify_staff

from .models import Announcement, AnnouncementReceipt

logger = logging.getLogger(__name__)
KIND = "announcement"
REMIND_EVERY_SECONDS = 3600


def audience(announcement):
    """Active, unsuspended staff in the chosen roles or reporting to the chosen
    team lead. The sender is not sent their own announcement."""
    match = Q()
    if announcement.roles:
        match |= Q(role__name__in=announcement.roles)
    if announcement.team_manager_id:
        match |= Q(manager_id=announcement.team_manager_id)
    if not match:
        return StaffUser.objects.none()
    people = StaffUser.objects.filter(match, is_active=True, is_suspended=False)
    if announcement.created_by_id:
        people = people.exclude(pk=announcement.created_by_id)
    return people.select_related("role").distinct()


def email_configured():
    return bool(getattr(settings, "EMAIL_HOST", ""))


def _email(announcement, person):
    if not person.email:
        return False
    _send(
        f"AshantiHub staff notice: {announcement.title}",
        f"Hi {person.full_name},\n\n{announcement.body}\n\n"
        + ("Please open the staff app and tap \"I've read this\".\n\n" if announcement.require_confirm else "")
        + "This is a staff notice from AshantiHub. It is also in your staff app.",
        person.email,
    )
    return True


def send(announcement, *, request=None):
    """Deliver now: one receipt and one bell notification per recipient, plus an
    e-mail each if asked. Only a draft or scheduled announcement can be sent, and
    only once (the row is locked). Returns the announcement, or None if it was not
    sendable."""
    with transaction.atomic():
        locked = Announcement.objects.select_for_update().get(pk=announcement.pk)
        if locked.status not in (Announcement.DRAFT, Announcement.SCHEDULED):
            return None
        people = list(audience(locked))
        AnnouncementReceipt.objects.bulk_create([AnnouncementReceipt(announcement=locked, staff=p) for p in people], ignore_conflicts=True)
        emailed = 0
        for person in people:
            notify_staff(person, KIND, locked.title, body=locked.body[:200], link="", icon="📣")
            if locked.send_email and email_configured():
                transaction.on_commit(lambda p=person: _email(locked, p), robust=True)
                emailed += 1
        locked.status = Announcement.SENT
        locked.sent_at = timezone.now()
        locked.recipient_count = len(people)
        locked.emailed_count = emailed
        locked.save(update_fields=["status", "sent_at", "recipient_count", "emailed_count"])
        record(
            locked.created_by, "announcement.sent", target=locked, method="POST" if request else "",
            summary=f"Sent to {len(people)} {'person' if len(people) == 1 else 'people'}" + ("" if request else " on schedule"),
            after={"recipients": len(people), "require_confirm": locked.require_confirm, "emailed": emailed},
            request=request,
        )
    return locked


def remind(announcement, *, now=None):
    """Nudge everyone who has not done what was asked (confirmed, or opened if it
    asks for no confirmation). At most once an hour. Returns how many were told."""
    now = now or timezone.now()
    if announcement.status != Announcement.SENT:
        return 0
    if announcement.last_reminded_at and (now - announcement.last_reminded_at).total_seconds() < REMIND_EVERY_SECONDS:
        return -1
    waiting = announcement.receipts.select_related("staff")
    waiting = waiting.filter(confirmed_at__isnull=True) if announcement.require_confirm else waiting.filter(opened_at__isnull=True)
    count = 0
    for receipt in waiting:
        notify_staff(receipt.staff, KIND, f"Reminder: {announcement.title}", body=announcement.body[:200], link="", icon="📣")
        count += 1
    announcement.last_reminded_at = now
    announcement.save(update_fields=["last_reminded_at"])
    return count


def send_due(now=None):
    now = now or timezone.now()
    sent = 0
    for pk in list(Announcement.objects.filter(status=Announcement.SCHEDULED, send_at__lte=now).values_list("pk", flat=True)):
        try:
            if send(Announcement.objects.get(pk=pk)):
                sent += 1
        except Exception:
            logger.exception("Could not send announcement %s", pk)
    return sent

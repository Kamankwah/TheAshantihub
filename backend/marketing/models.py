"""Marketing (the Marketing dashboard, canvas of 2026-10-13).

Nothing here sends anything to a real person: SMS and WhatsApp have no provider
connected (core.integrations says so) and the only working transport is email.
The models below are records of what staff decided, never of delivery that did
not happen."""
from datetime import time

from django.db import models
from django.utils import timezone

# Monday=0 .. Sunday=6, as datetime.weekday().
DEFAULT_SEND_DAYS = [0, 1, 2, 3, 4, 5]


def default_send_days():
    return list(DEFAULT_SEND_DAYS)


class SendPolicy(models.Model):
    """When marketing messages may go out and how often one person may get one
    (one row, pk=1, created on first read). Read by the composer and the dispatcher.
    Service and transactional messages are exempt. Changed only through the
    `marketing.send_policy` approval, which a Super Admin applies at once."""

    window_start = models.TimeField(default=time(8, 0))
    window_end = models.TimeField(default=time(19, 0))
    send_days = models.JSONField(default=default_send_days)
    per_person_cap_days = models.PositiveSmallIntegerField(default=3)
    quiet_public_holidays = models.BooleanField(default=True)
    updated_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    updated_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return "Quiet hours and limits"

    @classmethod
    def current(cls):
        """The one row; before anyone has changed it, an unsaved row holding the defaults
        (a read must never write: GETs run under step-in, which refuses writes)."""
        return cls.objects.filter(pk=1).first() or cls(pk=1)

    def touch(self, staff):
        self.updated_by = staff
        self.updated_at = timezone.now()

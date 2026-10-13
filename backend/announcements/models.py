from django.db import models

from accounts.models import StaffUser


class Announcement(models.Model):
    """A notice from Super Admin to staff only (Super Admin 16). It is shown to
    each recipient as a notice in the staff app and as a bell notification; it
    never reaches customers or businesses. Optional e-mail is a plain best-effort
    message. SMS, WhatsApp and push are not connected."""

    DRAFT = "draft"
    SCHEDULED = "scheduled"
    SENT = "sent"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [(DRAFT, "Draft"), (SCHEDULED, "Scheduled"), (SENT, "Sent"), (CANCELLED, "Cancelled")]

    title = models.CharField(max_length=150)
    body = models.TextField(max_length=2000)
    roles = models.JSONField(default=list, blank=True)
    team_manager = models.ForeignKey(StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    require_confirm = models.BooleanField(default=False)
    send_email = models.BooleanField(default=False)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=DRAFT)
    send_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    recipient_count = models.PositiveIntegerField(default=0)
    emailed_count = models.PositiveIntegerField(default=0)
    last_reminded_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(StaffUser, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-id"]
        indexes = [models.Index(fields=["status", "send_at"])]

    def __str__(self):
        return self.title


class AnnouncementReceipt(models.Model):
    """One recipient of a sent announcement: when they saw it (opened) and, if
    it asked, when they tapped "I've read this" (confirmed)."""

    announcement = models.ForeignKey(Announcement, on_delete=models.CASCADE, related_name="receipts")
    staff = models.ForeignKey(StaffUser, on_delete=models.CASCADE, related_name="+")
    opened_at = models.DateTimeField(null=True, blank=True)
    confirmed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["announcement", "staff"], name="one_receipt_per_person")]

"""Campaigns, templates and the sender-ID register (Marketing M3).

Nothing here sends by itself. A recipient row records what the provider answered; a provider that
is not connected answers "not connected" and the campaign cannot be sent. Delivery is never assumed:
only a provider that reports it can mark a recipient delivered."""
import secrets

from django.db import models
from django.utils import timezone

__all__ = ["Template", "SenderId", "ProviderStep", "Campaign", "CampaignRecipient"]


def new_token():
    return secrets.token_urlsafe(9)


class Template(models.Model):
    """A reusable SMS text, or a WhatsApp template with Meta's review outcome as recorded BY STAFF
    (there is no Meta connection: the status is never set by a machine)."""

    SMS, WHATSAPP = "sms", "whatsapp"
    CHANNEL_CHOICES = [(SMS, "SMS"), (WHATSAPP, "WhatsApp")]
    UTILITY, MARKETING = "utility", "marketing"
    CATEGORY_CHOICES = [(UTILITY, "Utility"), (MARKETING, "Marketing")]
    NOT_SUBMITTED, WAITING, APPROVED, REJECTED = "not_submitted", "waiting", "approved", "rejected"
    META_CHOICES = [(NOT_SUBMITTED, "Not submitted to Meta"), (WAITING, "Waiting for Meta"), (APPROVED, "Approved"), (REJECTED, "Rejected")]

    channel = models.CharField(max_length=10, choices=CHANNEL_CHOICES)
    name = models.CharField(max_length=80)
    body = models.CharField(max_length=1000)
    category = models.CharField(max_length=10, choices=CATEGORY_CHOICES, default=MARKETING)
    buttons = models.JSONField(default=list, blank=True)     # WhatsApp button labels, e.g. ["Shop now", "Stop offers"]
    meta_status = models.CharField(max_length=14, choices=META_CHOICES, blank=True, default="")   # WhatsApp only
    meta_note = models.CharField(max_length=300, blank=True)
    meta_recorded_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    meta_recorded_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    updated_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["channel", "name"]

    def __str__(self):
        return self.name


class SenderId(models.Model):
    """A register of sender IDs and where each network has got to, updated BY HAND: AshantiHub cannot call the networks."""

    MTN, TELECEL, AIRTELTIGO = "mtn", "telecel", "airteltigo"
    NETWORK_CHOICES = [(MTN, "MTN"), (TELECEL, "Telecel"), (AIRTELTIGO, "AirtelTigo")]
    DRAFT, SUBMITTED, APPROVED, REJECTED = "draft", "submitted", "approved", "rejected"
    STATUS_CHOICES = [(DRAFT, "Not submitted"), (SUBMITTED, "Waiting"), (APPROVED, "Approved"), (REJECTED, "Rejected")]

    name = models.CharField(max_length=11)
    network = models.CharField(max_length=12, choices=NETWORK_CHOICES)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=DRAFT)
    used_for = models.CharField(max_length=120, blank=True)
    note = models.CharField(max_length=200, blank=True)
    submitted_on = models.DateField(null=True, blank=True)
    decided_on = models.DateField(null=True, blank=True)
    recorded_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["name", "network"]
        constraints = [models.UniqueConstraint(fields=["name", "network"], name="mk_senderid_name_network")]

    def __str__(self):
        return f"{self.name} / {self.get_network_display()}"


class ProviderStep(models.Model):
    """A step of a provider's setup checklist (WhatsApp), ticked by a person who did it. Never ticked by a machine."""

    TODO, IN_REVIEW, DONE = "todo", "in_review", "done"
    STATUS_CHOICES = [(TODO, "To do"), (IN_REVIEW, "In review"), (DONE, "Done")]

    provider = models.CharField(max_length=20, default="whatsapp")
    position = models.PositiveSmallIntegerField()
    title = models.CharField(max_length=80)
    detail = models.CharField(max_length=300, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=TODO)
    note = models.CharField(max_length=300, blank=True)
    recorded_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    recorded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["provider", "position"]
        constraints = [models.UniqueConstraint(fields=["provider", "position"], name="mk_providerstep_position")]


class Campaign(models.Model):
    DRAFT, WAITING, SCHEDULED, SENDING, SENT, WITHDRAWN, FAILED = "draft", "waiting_approval", "scheduled", "sending", "sent", "withdrawn", "failed"
    STATUS_CHOICES = [
        (DRAFT, "Draft"), (WAITING, "Waiting for Super Admin"), (SCHEDULED, "Scheduled"), (SENDING, "Sending"),
        (SENT, "Sent"), (WITHDRAWN, "Withdrawn"), (FAILED, "Failed"),
    ]
    EDITABLE = (DRAFT, WITHDRAWN)

    name = models.CharField(max_length=120)
    channel = models.CharField(max_length=10)                     # sms | whatsapp | email | inapp
    segment = models.ForeignKey("marketing.Segment", on_delete=models.PROTECT, null=True, blank=True, related_name="campaigns")
    audience = models.CharField(max_length=20, blank=True)       # copied from the segment when it is chosen
    filters = models.JSONField(default=dict, blank=True)         # a copy of the segment's rules: later edits to the segment don't change a sent campaign
    template = models.ForeignKey(Template, on_delete=models.SET_NULL, null=True, blank=True, related_name="campaigns")
    subject = models.CharField(max_length=150, blank=True)       # email subject / in-app title
    body = models.TextField(blank=True)                          # what the person writes; the stop link is added on top at send time
    link_path = models.CharField(max_length=200, blank=True)     # an AshantiHub page the {link} in the message points to (tracked)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=DRAFT)
    send_at = models.DateTimeField(null=True, blank=True)
    est_recipients = models.PositiveIntegerField(default=0)
    est_cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    cost_known = models.BooleanField(default=True)               # False: no price for this channel, so the estimate is a floor of 0
    actual_cost = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)   # only a provider that reports a cost sets it
    approval = models.ForeignKey("approvals.ApprovalRequest", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(default=timezone.now)
    sent_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=300, blank=True)          # why it went back to draft, a withdrawal reason, a failure
    provider_state = models.CharField(max_length=20, blank=True)  # simulated | sent_by_mail | in_app | not_connected, from the last dispatch

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["status", "send_at"])]

    def __str__(self):
        return self.name


class CampaignRecipient(models.Model):
    QUEUED, SENT, DELIVERED, FAILED, SKIPPED, SIMULATED = "queued", "sent", "delivered", "failed", "skipped", "simulated"
    STATUS_CHOICES = [(QUEUED, "Queued"), (SENT, "Sent"), (DELIVERED, "Delivered"), (FAILED, "Failed"), (SKIPPED, "Left out"), (SIMULATED, "Simulated")]
    # Why someone was left out.
    CAP, OPTED_OUT, NO_CONTACT, FAILED_TWICE = "cap", "opted_out", "no_contact", "failed_twice"

    campaign = models.ForeignKey(Campaign, on_delete=models.CASCADE, related_name="recipients")
    customer = models.ForeignKey("accounts.Customer", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    business_owner = models.ForeignKey("accounts.BusinessOwner", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=QUEUED)
    skip_reason = models.CharField(max_length=20, blank=True)
    network = models.CharField(max_length=12, blank=True)
    error = models.CharField(max_length=200, blank=True)
    provider_ref = models.CharField(max_length=80, blank=True)
    click_token = models.CharField(max_length=20, default=new_token, unique=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    first_click_at = models.DateTimeField(null=True, blank=True)
    click_count = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["id"]
        indexes = [models.Index(fields=["campaign", "status"]), models.Index(fields=["customer", "sent_at"]), models.Index(fields=["business_owner", "sent_at"])]
        constraints = [
            models.UniqueConstraint(fields=["campaign", "customer"], condition=models.Q(customer__isnull=False), name="mk_recipient_once_customer"),
            models.UniqueConstraint(fields=["campaign", "business_owner"], condition=models.Q(business_owner__isnull=False), name="mk_recipient_once_business"),
            models.CheckConstraint(
                condition=(models.Q(customer__isnull=False, business_owner__isnull=True) | models.Q(customer__isnull=True, business_owner__isnull=False)),
                name="mk_recipient_one_subject",
            ),
        ]

    @property
    def subject(self):
        return self.customer or self.business_owner

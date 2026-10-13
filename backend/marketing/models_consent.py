"""The consent ledger and audiences (Marketing M2).

ConsentRecord is append-only: a change of mind adds a new line and the latest line per
person and channel is the current answer. It starts EMPTY: nothing is backfilled from
Customer.sms_notifications_enabled, which is a service-message preference (a different
thing). Wordings are versioned; each record keeps the exact words the person saw."""
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone

__all__ = ["ConsentWording", "ConsentRecord", "Segment", "AppendOnlyError", "CHANNEL_LABELS"]

SMS, WHATSAPP, EMAIL, INAPP = "sms", "whatsapp", "email", "inapp"
CHANNELS = [(SMS, "SMS"), (WHATSAPP, "WhatsApp"), (EMAIL, "Email"), (INAPP, "In-app")]
CHANNEL_LABELS = dict(CHANNELS)
CUSTOMER, BUSINESS = "customer", "business_owner"
AUDIENCES = [(CUSTOMER, "Customers"), (BUSINESS, "Businesses")]


class ConsentWording(models.Model):
    """The words a person agrees to for one channel. A new wording is a new version; a
    retired version stays so old records can show what was agreed."""

    code = models.CharField(max_length=40)           # e.g. "sms-offers"
    version = models.PositiveSmallIntegerField(default=1)
    channel = models.CharField(max_length=10, choices=CHANNELS)
    audience = models.CharField(max_length=20, choices=AUDIENCES)
    text = models.CharField(max_length=500)
    live_from = models.DateTimeField(default=timezone.now)
    retired_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["code", "-version"]
        constraints = [models.UniqueConstraint(fields=["code", "version"], name="mk_wording_code_version")]

    def __str__(self):
        return f"{self.code} v{self.version}"

    @property
    def label(self):
        return f"{self.code} v{self.version}"


class AppendOnlyError(Exception):
    pass


class _AppendOnlyQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise AppendOnlyError("The consent ledger is append-only.")

    def delete(self):
        raise AppendOnlyError("The consent ledger is append-only.")

    def bulk_update(self, *args, **kwargs):
        raise AppendOnlyError("The consent ledger is append-only.")


class ConsentRecord(models.Model):
    OPTED_IN, OPTED_OUT = "opted_in", "opted_out"
    STATUS_CHOICES = [(OPTED_IN, "Opted in"), (OPTED_OUT, "Opted out")]

    # Where the answer came from.
    SIGNUP, SETTINGS, CHECKOUT, UNSUBSCRIBE_LINK, STAFF, HANDOVER = "signup", "settings", "checkout", "unsubscribe_link", "staff", "handover"
    SOURCE_CHOICES = [
        (SIGNUP, "Sign-up form"), (SETTINGS, "Account settings"), (CHECKOUT, "Checkout tickbox"),
        (UNSUBSCRIBE_LINK, "Stop or unsubscribe link"), (STAFF, "Recorded by staff"), (HANDOVER, "Hand-over with a scout"),
    ]

    customer = models.ForeignKey("accounts.Customer", on_delete=models.PROTECT, null=True, blank=True, related_name="consent_records")
    business_owner = models.ForeignKey("accounts.BusinessOwner", on_delete=models.PROTECT, null=True, blank=True, related_name="consent_records")
    channel = models.CharField(max_length=10, choices=CHANNELS)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES)
    source = models.CharField(max_length=20, choices=SOURCE_CHOICES)
    source_detail = models.CharField(max_length=200, blank=True)
    wording = models.ForeignKey(ConsentWording, on_delete=models.PROTECT, null=True, blank=True, related_name="records")
    wording_text = models.CharField(max_length=500, blank=True)   # what the person saw, copied at the time
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=200, blank=True)
    at = models.DateTimeField(default=timezone.now, db_index=True)
    recorded_by = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    campaign_id = models.PositiveBigIntegerField(null=True, blank=True)   # the campaign a stop link came from, once campaigns exist

    objects = _AppendOnlyQuerySet.as_manager()

    class Meta:
        ordering = ["-at", "-id"]
        constraints = [
            models.CheckConstraint(
                condition=(Q(customer__isnull=False, business_owner__isnull=True) | Q(customer__isnull=True, business_owner__isnull=False)),
                name="mk_consent_exactly_one_subject",
            ),
        ]
        indexes = [
            models.Index(fields=["customer", "channel", "-at"]),
            models.Index(fields=["business_owner", "channel", "-at"]),
        ]

    def __str__(self):
        return f"{self.get_status_display()} · {self.get_channel_display()} · {self.subject_label}"

    @property
    def subject(self):
        return self.customer or self.business_owner

    @property
    def subject_kind(self):
        return CUSTOMER if self.customer_id else BUSINESS

    @property
    def subject_label(self):
        subject = self.subject
        return getattr(subject, "display_name", None) or getattr(subject, "full_name", "") if subject else ""

    def save(self, *args, **kwargs):
        if self.pk is not None and not self._state.adding:
            raise AppendOnlyError("The consent ledger is append-only: add a new line instead of changing one.")
        if self.customer_id is None and self.business_owner_id is None:
            raise ValidationError("A consent record belongs to one person.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise AppendOnlyError("The consent ledger is append-only.")


class Segment(models.Model):
    """A saved audience: who (customers or businesses), the filters and one channel. Only
    people whose latest consent record for that channel is 'opted in' are ever counted."""

    name = models.CharField(max_length=120)
    audience = models.CharField(max_length=20, choices=AUDIENCES)
    channel = models.CharField(max_length=10, choices=CHANNELS)
    # {"zones": [zone ids], "categories": [category ids], "activity": "any|active|signed_up|inactive", "days": int}
    filters = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return self.name

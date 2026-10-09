from django.db import models
from django.db.models import Q


class FraudFlag(models.Model):
    """A fraud case (spec S9). Raised by the system (registration checks, an
    owner's "This wasn't me", check-ins) or by hand by Support and Operations;
    confirmed or dismissed — always with a note — by fraud.manage holders
    (fraud/services.py)."""

    DUPLICATE = "duplicate"
    SIMILAR_NEARBY = "similar_nearby"
    SELF_DEALING = "self_dealing"
    OWNER_OBJECTED = "owner_objected"
    OUTSIDE_RADIUS = "outside_radius"
    FAKE_BUSINESS = "fake_business"
    OTHER = "other"
    KIND_CHOICES = [
        (DUPLICATE, "Duplicate registration"),
        (SIMILAR_NEARBY, "Similar business nearby"),
        (SELF_DEALING, "Self-dealing"),
        (OWNER_OBJECTED, "Owner said “This wasn't me”"),
        (OUTSIDE_RADIUS, "Repeated outside-radius check-ins"),
        (FAKE_BUSINESS, "Fake business"),
        (OTHER, "Other"),
    ]
    # Kinds whose confirmation may also suspend the business (confirm(suspend=True)).
    SUSPENDABLE = frozenset({DUPLICATE, SIMILAR_NEARBY, SELF_DEALING, FAKE_BUSINESS})
    # Kinds a person may raise by hand (POST /api/fraud/flags/).
    STAFF_RAISABLE = (FAKE_BUSINESS, DUPLICATE, OTHER)

    OPEN = "open"
    CONFIRMED = "confirmed"
    DISMISSED = "dismissed"
    STATUS_CHOICES = [(OPEN, "Open"), (CONFIRMED, "Confirmed"), (DISMISSED, "Dismissed")]

    SYSTEM = "system"
    STAFF = "staff"
    OWNER = "owner"
    SOURCE_CHOICES = [(SYSTEM, "The system"), (STAFF, "Staff"), (OWNER, "The owner")]

    kind = models.CharField(max_length=30, choices=KIND_CHOICES)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=OPEN)
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES)
    title = models.CharField(max_length=200)
    detail = models.TextField(blank=True, default="")
    # Short strings shown as bullets. Never a raw payout or MoMo number —
    # callers mask with accounts.serializers.mask_but_last(value, keep=3).
    evidence = models.JSONField(default=list, blank=True)
    business_owner = models.ForeignKey(
        "accounts.BusinessOwner", on_delete=models.SET_NULL, null=True, blank=True, related_name="fraud_flags",
    )
    related_business_owner = models.ForeignKey(
        "accounts.BusinessOwner", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    staff_subject = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="fraud_flags_about",
    )
    raised_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="fraud_flags_raised",
    )
    # Non-empty for system cases that must not repeat while open (e.g. "undo:<id>").
    dedupe_key = models.CharField(max_length=120, blank=True, default="")
    resolved_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolution_note = models.TextField(blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["status", "-created_at"], name="fraud_flag_status_idx")]
        constraints = [
            models.UniqueConstraint(
                fields=["dedupe_key"],
                condition=Q(status="open") & ~Q(dedupe_key=""),
                name="one_open_fraud_flag_per_key",
            ),
        ]

    def __str__(self):
        return self.title

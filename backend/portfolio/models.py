"""Field account management (staff phase 2, spec S3/S4): who manages each
business and the history of that, photos a scout staged for an approval,
the changes a scout's approved request made (so the owner can undo them for
7 days), and the nightly health snapshot."""
from django.db import models
from django.db.models import Q
from django.utils import timezone

from accounts.models import BusinessOwner, StaffUser
from accounts.validators import validate_image_content_type


class AccountManagerAssignment(models.Model):
    """One spell of a scout managing a business. The open row (ended_at null)
    mirrors BusinessOwner.account_manager; portfolio.services
    .assign_account_manager() keeps the two in step."""

    business_owner = models.ForeignKey(BusinessOwner, on_delete=models.CASCADE, related_name="manager_assignments")
    scout = models.ForeignKey(StaffUser, on_delete=models.PROTECT, related_name="portfolio_assignments")
    assigned_by = models.ForeignKey(StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    reason = models.CharField(max_length=300, blank=True, default="")
    started_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["business_owner"], condition=Q(ended_at__isnull=True), name="one_open_account_manager",
            ),
        ]


class StagedPhoto(models.Model):
    """A photo a scout took for a business, waiting for the approval that
    attaches it (used_at set then). Unused ones are purged after 7 days."""

    business_owner = models.ForeignKey(BusinessOwner, on_delete=models.CASCADE, related_name="staged_photos")
    uploaded_by = models.ForeignKey(StaffUser, on_delete=models.PROTECT, related_name="+")
    image = models.ImageField(upload_to="staged_photos/", validators=[validate_image_content_type])
    taken_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    taken_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    taken_accuracy_m = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    used_at = models.DateTimeField(null=True, blank=True)


class AppliedChange(models.Model):
    """What a scout's approved request changed on a business, so the owner
    can see it and press "This wasn't me" until undo_until."""

    approval = models.OneToOneField(
        "approvals.ApprovalRequest", on_delete=models.PROTECT, related_name="applied_change",
    )
    business_owner = models.ForeignKey(BusinessOwner, on_delete=models.CASCADE, related_name="applied_changes")
    kind = models.CharField(max_length=40)
    summary = models.CharField(max_length=200)
    applied_at = models.DateTimeField()
    undo_until = models.DateTimeField()
    result = models.JSONField(default=dict, blank=True)
    undone_at = models.DateTimeField(null=True, blank=True)
    undo_failed = models.CharField(max_length=200, blank=True, default="")
    fraud_flag_id = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["-applied_at"]


class BusinessHealthSnapshot(models.Model):
    """The nightly copy of a business's health rating, for reports."""

    business_owner = models.ForeignKey(BusinessOwner, on_delete=models.CASCADE, related_name="health_snapshots")
    date = models.DateField()
    rating = models.CharField(max_length=20)
    reasons = models.JSONField(default=list, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["business_owner", "date"], name="one_health_snapshot_per_day"),
        ]


# The statuses of a request still in progress (one per business and field): module-level so Meta can use it.
DETAIL_CHANGE_LIVE_STATUSES = ("requested", "assigned", "verified")


class BusinessDetailChangeRequest(models.Model):
    """A business asking to change its owner's name, sign-in phone or email (plan 7F-C, ruling R3). The business files
    it itself (portfolio.detail_changes); Operations assigns a scout who is not its registrar or account manager; the
    scout verifies it on site; then two people approve it with the password (business.detail_change). `new_value` is
    kept unmasked because applying needs it: it never goes into a log, notice, approval title or activity body."""

    FULL_NAME, LOGIN_PHONE, EMAIL = "full_name", "login_phone", "email"
    FIELD_CHOICES = [(FULL_NAME, "Name"), (LOGIN_PHONE, "Sign-in phone"), (EMAIL, "Email")]
    REQUESTED, ASSIGNED, VERIFIED = "requested", "assigned", "verified"
    NOT_VERIFIED, APPROVED, REJECTED, WITHDRAWN = "not_verified", "approved", "rejected", "withdrawn"
    STATUS_CHOICES = [
        (REQUESTED, "Requested"), (ASSIGNED, "Scout assigned"), (VERIFIED, "Verified on site"),
        (NOT_VERIFIED, "Not verified"), (APPROVED, "Approved"), (REJECTED, "Rejected"), (WITHDRAWN, "Withdrawn"),
    ]
    LIVE_STATUSES = DETAIL_CHANGE_LIVE_STATUSES
    WITHDRAWABLE_STATUSES = (REQUESTED, ASSIGNED)

    business_owner = models.ForeignKey(BusinessOwner, on_delete=models.CASCADE, related_name="detail_change_requests")
    field = models.CharField(max_length=20, choices=FIELD_CHOICES)
    new_value = models.CharField(max_length=254)
    reason = models.CharField(max_length=300)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=REQUESTED)
    requested_at = models.DateTimeField(default=timezone.now)
    assigned_scout = models.ForeignKey(StaffUser, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    assigned_by = models.ForeignKey(StaffUser, on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    assigned_at = models.DateTimeField(null=True, blank=True)
    visit = models.ForeignKey("field.VisitCheckIn", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    verified_at = models.DateTimeField(null=True, blank=True)
    verification_note = models.CharField(max_length=500, blank=True, default="")
    approval = models.ForeignKey(
        "approvals.ApprovalRequest", on_delete=models.PROTECT, null=True, blank=True, related_name="+",
    )
    # When the request ended: approved, rejected, not verified or withdrawn.
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-requested_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["business_owner", "field"], condition=Q(status__in=DETAIL_CHANGE_LIVE_STATUSES),
                name="one_live_detail_change_per_field",
            ),
        ]

    def __str__(self):
        return f"{self.get_field_display()} change for business owner {self.business_owner_id} ({self.status})"

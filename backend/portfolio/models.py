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

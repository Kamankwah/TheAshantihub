from django.db import models
from django.utils import timezone


class ApprovalRequest(models.Model):
    """One staged change waiting for someone other than its maker (staff
    foundations F5). Its kind's registry entry (approvals/registry.py) reads
    the target's current state, applies the change and renders the diff."""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    STATUS_CHOICES = [
        (PENDING, "Pending"),
        (APPROVED, "Approved"),
        (REJECTED, "Returned"),
        (CANCELLED, "Cancelled"),
        (EXPIRED, "Expired"),
    ]
    MANAGER = "manager"
    POOL = "pool"
    SUPER_ADMIN = "super_admin"
    STAGE_CHOICES = [
        (MANAGER, "The maker's manager"),
        (POOL, "Anyone holding the kind's permission"),
        (SUPER_ADMIN, "A Super Admin"),
    ]
    STAGE_ORDER = [MANAGER, POOL, SUPER_ADMIN]

    kind = models.CharField(max_length=60)
    title = models.CharField(max_length=200)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    stage = models.CharField(max_length=12, choices=STAGE_CHOICES, default=SUPER_ADMIN)
    maker = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="approval_requests_made")
    assigned_to = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.PROTECT, null=True, blank=True, related_name="approval_requests_assigned"
    )
    pool_permission = models.CharField(max_length=100, blank=True, default="")
    target_type = models.CharField(max_length=50, blank=True, default="")
    target_id = models.CharField(max_length=64, blank=True, default="")
    target_label = models.CharField(max_length=200, blank=True, default="")
    payload = models.JSONField(default=dict, blank=True)
    before = models.JSONField(default=dict, blank=True)
    maker_note = models.TextField(blank=True, default="")
    decided_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.PROTECT, null=True, blank=True, related_name="approval_requests_decided"
    )
    decided_at = models.DateTimeField(null=True, blank=True)
    decision_note = models.TextField(blank=True, default="")
    due_at = models.DateTimeField()
    stage_started_at = models.DateTimeField(default=timezone.now)
    reminded_at = models.DateTimeField(null=True, blank=True)
    escalation_level = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["status", "stage", "due_at"]),
            models.Index(fields=["maker", "status"]),
            models.Index(fields=["assigned_to", "status"]),
        ]

    def __str__(self):
        return self.title

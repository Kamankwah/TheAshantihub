from decimal import Decimal

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
    # Money the request would move or commit, in GH₵, for the kinds that carry
    # an amount (ApprovalKind.amount_of). Null for every other kind: never 0.
    amount = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    # 2 when the amount is above the co-sign threshold at the time of the request
    # (approvals/rules.py): one approver plus an external co-signer. 1 otherwise.
    required_approvals = models.PositiveSmallIntegerField(default=1)
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


class ApprovalDecision(models.Model):
    """One person's sign-off on a request. A request needing two approvals holds
    one row in the "approver" slot (anyone the chain allows) and one in the
    "cosigner" slot (a holder of approvals.cosign); nobody holds two rows."""

    APPROVER = "approver"
    COSIGNER = "cosigner"
    SLOT_CHOICES = [(APPROVER, "Approver"), (COSIGNER, "Co-signer")]
    APPROVED = "approved"
    RETURNED = "returned"

    request = models.ForeignKey(ApprovalRequest, on_delete=models.CASCADE, related_name="decisions")
    staff = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="approval_decisions")
    slot = models.CharField(max_length=10, choices=SLOT_CHOICES)
    decision = models.CharField(max_length=10, default=APPROVED)
    note = models.TextField(blank=True, default="")
    decided_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["decided_at", "id"]
        constraints = [
            # The same person can never count twice on one request.
            models.UniqueConstraint(fields=["request", "staff"], name="approval_decision_one_per_person"),
            # Each slot is filled once by an approval.
            models.UniqueConstraint(
                fields=["request", "slot"], condition=models.Q(decision="approved"), name="approval_decision_one_approval_per_slot"
            ),
        ]


class ApprovalSettings(models.Model):
    """The money limits and reminder point Super Admin edits on the rules screen
    (one row, pk=1, created on first read with the values that were hard-coded
    before: nothing changes until someone edits it)."""

    DEFAULT_COSIGN_THRESHOLD = Decimal("20000.00")
    DEFAULT_REFUND_THRESHOLD = Decimal("500.00")
    DEFAULT_CAMPAIGN_THRESHOLD = Decimal("25.00")
    DEFAULT_REMIND_FRACTION = Decimal("0.75")

    # Requests above this need a second sign-off from a co-signer.
    cosign_threshold = models.DecimalField(max_digits=12, decimal_places=2, default=DEFAULT_COSIGN_THRESHOLD)
    # Stored for the Accounting and Marketing phases; no refund or campaign flow reads them yet.
    refund_threshold = models.DecimalField(max_digits=12, decimal_places=2, default=DEFAULT_REFUND_THRESHOLD)
    campaign_threshold = models.DecimalField(max_digits=12, decimal_places=2, default=DEFAULT_CAMPAIGN_THRESHOLD)
    remind_fraction = models.DecimalField(max_digits=3, decimal_places=2, default=DEFAULT_REMIND_FRACTION)
    updated_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    updated_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return "Approval rules and timers"


class ApprovalRule(models.Model):
    """A response-time override for one approval kind. No row = the kind's own
    response_hours in code."""

    kind = models.CharField(max_length=60, unique=True)
    response_hours = models.PositiveSmallIntegerField()
    updated_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    updated_at = models.DateTimeField(default=timezone.now)

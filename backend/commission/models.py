"""Commission records (spec S8). Amounts are Decimal GH₵ and come only from an
approved CommissionPolicy: nothing is hard-coded, and with no policy in force
nothing accrues (and nothing is backfilled when one is approved later)."""
from datetime import timedelta

from django.db import models

HOLD_DAYS = 90


class CommissionPolicy(models.Model):
    """One approved amount for a kind, from `effective_from` on. Rows exist only
    once approved (the approval engine applies a proposal by creating one) and
    are never edited: the policy in force on a date is the latest row on or
    before it."""

    REGISTRATION = "registration"
    BONUS = "three_paid_months_bonus"
    KIND_CHOICES = [(REGISTRATION, "Registration"), (BONUS, "3-paid-months bonus")]

    kind = models.CharField(max_length=30, choices=KIND_CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    effective_from = models.DateField()
    proposed_by = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="+")
    approved_by = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="+")
    approval_id = models.PositiveBigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-effective_from", "-id"]
        indexes = [models.Index(fields=["kind", "-effective_from"])]

    def __str__(self):
        return f"{self.kind} GH₵{self.amount} from {self.effective_from}"


class CommissionAccrual(models.Model):
    ON_HOLD = "on_hold"
    PAYABLE = "payable"
    IN_BATCH = "in_batch"
    PAID = "paid"
    REVERSED = "reversed"
    STATUS_CHOICES = [
        (ON_HOLD, "On hold"), (PAYABLE, "Approved to pay"), (IN_BATCH, "In a payout batch"),
        (PAID, "Paid"), (REVERSED, "Reversed"),
    ]

    staff = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="commission_accruals")
    business_owner = models.ForeignKey("accounts.BusinessOwner", on_delete=models.PROTECT, related_name="commission_accruals")
    kind = models.CharField(max_length=30, choices=CommissionPolicy.KIND_CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    policy = models.ForeignKey(CommissionPolicy, on_delete=models.PROTECT, related_name="accruals")
    earned_at = models.DateTimeField()
    hold_until = models.DateTimeField()
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=ON_HOLD)
    reversed_reason = models.CharField(max_length=40, blank=True, default="")
    reversed_at = models.DateTimeField(null=True, blank=True)
    source_type = models.CharField(max_length=50, blank=True, default="")
    source_id = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        ordering = ["-earned_at", "-id"]
        constraints = [models.UniqueConstraint(fields=["business_owner", "kind"], name="commission_one_per_business_and_kind")]
        indexes = [models.Index(fields=["staff", "-earned_at"]), models.Index(fields=["status", "hold_until"])]

    def __str__(self):
        return f"{self.kind} GH₵{self.amount} to {self.staff_id} for {self.business_owner_id} ({self.status})"

    @staticmethod
    def hold_end(earned_at):
        return earned_at + timedelta(days=HOLD_DAYS)

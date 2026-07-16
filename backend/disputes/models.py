from django.db import models

from accounts.models import Customer, StaffUser
from orders.models import Order


class Dispute(models.Model):
    """A customer dispute over an order (a delivery/quality/payment issue,
    etc), triaged and financially resolved by staff. Two staff permissions
    gate two different halves of the same 4-state linear flow — mirrors
    `contact.ContactMessage`'s new -> read -> resolved convention, extended
    to a 4th `rejected` outcome since a dispute (unlike a contact message)
    can be investigated and found not to warrant action:

        open -> investigating -> resolved
                              \\-> rejected

    `order` is nullable — most disputes originate from a customer's own
    order via `POST /api/orders/{id}/dispute/`, but staff can also log one
    manually with no order attached (e.g. a dispute raised over the phone/
    email before it's tied to a specific transaction). `raised_by` is
    likewise nullable for the same "staff can log one manually" reason.
    """

    ORDER_ISSUE = "order_issue"
    PAYMENT_ISSUE = "payment_issue"
    DELIVERY_ISSUE = "delivery_issue"
    QUALITY_ISSUE = "quality_issue"
    OTHER = "other"
    REASON_CHOICES = [
        (ORDER_ISSUE, "Order Issue"),
        (PAYMENT_ISSUE, "Payment Issue"),
        (DELIVERY_ISSUE, "Delivery Issue"),
        (QUALITY_ISSUE, "Quality Issue"),
        (OTHER, "Other"),
    ]

    OPEN = "open"
    INVESTIGATING = "investigating"
    RESOLVED = "resolved"
    REJECTED = "rejected"
    STATUS_CHOICES = [
        (OPEN, "Open"),
        (INVESTIGATING, "Investigating"),
        (RESOLVED, "Resolved"),
        (REJECTED, "Rejected"),
    ]

    # Both final states — a dispute in either must never be re-actionable
    # via DisputeFlagView/DisputeResolveView (see views.py).
    FINAL_STATUSES = (RESOLVED, REJECTED)

    order = models.ForeignKey(
        Order, on_delete=models.SET_NULL, null=True, blank=True, related_name="disputes"
    )
    raised_by = models.ForeignKey(
        Customer, on_delete=models.SET_NULL, null=True, blank=True, related_name="disputes_raised"
    )
    reason = models.CharField(max_length=20, choices=REASON_CHOICES)
    description = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=OPEN)

    resolution_notes = models.TextField(null=True, blank=True)
    refund_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    flagged_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="disputes_flagged"
    )
    resolved_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="disputes_resolved"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Dispute #{self.id} ({self.get_status_display()})"

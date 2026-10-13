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

    # Support intake (Support dashboard). `problem_type` is what went wrong in
    # Support's words; there is no rider-raised type (no rider path exists).
    FAULTY_ITEM = "faulty_item"
    NOT_RECEIVED = "not_received"
    DAMAGED = "damaged_in_transit"
    WRONG_OR_MISSING = "wrong_or_missing"
    RETURN_REQUEST = "return_request"
    PROBLEM_CHOICES = [
        (FAULTY_ITEM, "Faulty item"),
        (NOT_RECEIVED, "Not received"),
        (DAMAGED, "Damaged on the way"),
        (WRONG_OR_MISSING, "Wrong or missing item"),
        (RETURN_REQUEST, "Return"),
    ]
    MONEY_BACK = "money_back"
    REPLACEMENT = "replacement"
    REPAIR = "repair"
    RETURN_ITEM = "return_item"
    ASK_CHOICES = [
        (MONEY_BACK, "Money back"),
        (REPLACEMENT, "A replacement"),
        (REPAIR, "A repair"),
        (RETURN_ITEM, "To return it"),
    ]
    # problem_type -> the `reason` the older queue already shows.
    REASON_FOR_PROBLEM = {
        FAULTY_ITEM: QUALITY_ISSUE, NOT_RECEIVED: DELIVERY_ISSUE, DAMAGED: DELIVERY_ISSUE,
        WRONG_OR_MISSING: ORDER_ISSUE, RETURN_REQUEST: ORDER_ISSUE,
    }

    order = models.ForeignKey(
        Order, on_delete=models.SET_NULL, null=True, blank=True, related_name="disputes"
    )
    raised_by = models.ForeignKey(
        Customer, on_delete=models.SET_NULL, null=True, blank=True, related_name="disputes_raised"
    )
    reason = models.CharField(max_length=20, choices=REASON_CHOICES)
    description = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=OPEN)

    problem_type = models.CharField(max_length=24, choices=PROBLEM_CHOICES, blank=True, default="")
    customer_ask = models.CharField(max_length=16, choices=ASK_CHOICES, blank=True, default="")
    # Support's summary for Accounting; flagging needs it.
    intake_summary = models.TextField(blank=True, default="")
    conversation = models.ForeignKey(
        "messaging.Conversation", on_delete=models.SET_NULL, null=True, blank=True, related_name="disputes"
    )
    # Set when staff logged the dispute on the customer's behalf (raised_by stays null).
    logged_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="disputes_logged"
    )

    resolution_notes = models.TextField(null=True, blank=True)
    refund_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    flagged_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="disputes_flagged"
    )
    resolved_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True, related_name="disputes_resolved"
    )

    # Delivery cases (Delivery Manager build). Null/blank for every other dispute.
    NOT_RECEIVED, DAMAGED, WRONG_ITEM, UNREACHABLE, RETURN = "not_received", "damaged", "wrong_item", "unreachable", "return"
    CASE_TYPE_CHOICES = [
        ("", "Not a delivery case"), (NOT_RECEIVED, "Not received"), (DAMAGED, "Damaged"), (WRONG_ITEM, "Wrong item"),
        (UNREACHABLE, "Customer unreachable"), (RETURN, "Return"),
    ]
    case_type = models.CharField(max_length=14, choices=CASE_TYPE_CHOICES, blank=True, default="")
    answer_due_at = models.DateTimeField(null=True, blank=True)
    rider = models.ForeignKey(StaffUser, null=True, blank=True, on_delete=models.SET_NULL, related_name="disputes_as_rider")
    # The recorded decision: outcome, who was at fault, and what was asked of other teams.
    outcome = models.CharField(max_length=20, blank=True, default="")
    fault = models.CharField(max_length=12, blank=True, default="")
    decided_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Dispute #{self.id} ({self.get_status_display()})"


class DisputeEvidence(models.Model):
    """One piece of evidence Support attached to a dispute: a typed note or a
    photo/PDF. Append-only: it can be added, never edited or deleted (the model
    refuses both), so what Accounting sees is what Support saw. The delivery
    record is not stored here; it is read from the order's own stamps."""

    NOTE = "note"
    FILE = "file"
    KIND_CHOICES = [(NOTE, "Note"), (FILE, "Photo or document")]

    dispute = models.ForeignKey(Dispute, on_delete=models.CASCADE, related_name="evidence")
    kind = models.CharField(max_length=8, choices=KIND_CHOICES, default=NOTE)
    title = models.CharField(max_length=150)
    body = models.TextField(blank=True, default="")
    file = models.FileField(upload_to="dispute_evidence/", null=True, blank=True)
    added_by = models.ForeignKey(StaffUser, null=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def save(self, *args, **kwargs):
        if self.pk is not None and not self._state.adding:
            raise RuntimeError("Dispute evidence is append-only.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("Dispute evidence is append-only.")

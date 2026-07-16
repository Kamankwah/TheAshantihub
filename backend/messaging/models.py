from django.db import models

from accounts.models import BusinessOwner, Customer, StaffUser


class Conversation(models.Model):
    """A staff support ticket thread — a signed-in Customer or BusinessOwner
    messaging AshantiHub support, and staff replying. This is NEVER a
    business-owner-to-customer direct-contact channel — see CLAUDE.md's
    "Businesses cannot be contacted directly" section, a hard fraud-
    prevention boundary already established elsewhere in this codebase. Both
    a Customer and a BusinessOwner reach staff through this exact same
    model/API; nothing here lets either party see or message the other.

    Exactly one of `customer`/`business_owner` is set per row — same
    "exactly one of two nullable FKs" shape as billing.Transaction's
    business_owner/customer pair, enforced by the CheckConstraint below.
    """

    OPEN = "open"
    CLOSED = "closed"
    STATUS_CHOICES = [(OPEN, "Open"), (CLOSED, "Closed")]

    customer = models.ForeignKey(
        Customer, on_delete=models.CASCADE, null=True, blank=True, related_name="conversations"
    )
    business_owner = models.ForeignKey(
        BusinessOwner, on_delete=models.CASCADE, null=True, blank=True, related_name="conversations"
    )
    subject = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=OPEN)

    created_at = models.DateTimeField(auto_now_add=True)
    # Bumped (a plain re-save, not update_fields-limited) on every new
    # Message so the staff queue can order by "most recently active" —
    # see messaging.views.
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(customer__isnull=False, business_owner__isnull=True)
                    | models.Q(customer__isnull=True, business_owner__isnull=False)
                ),
                name="conversation_exactly_one_of_customer_or_business_owner",
            ),
        ]

    def __str__(self):
        starter = self.customer.full_name if self.customer_id else self.business_owner.full_name
        return f"Conversation with {starter} ({self.status})"


class Message(models.Model):
    CUSTOMER = "customer"
    BUSINESS_OWNER = "business_owner"
    STAFF = "staff"
    SENDER_TYPE_CHOICES = [
        (CUSTOMER, "Customer"),
        (BUSINESS_OWNER, "Business Owner"),
        (STAFF, "Staff"),
    ]

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender_type = models.CharField(max_length=15, choices=SENDER_TYPE_CHOICES)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.sender_type} message in conversation {self.conversation_id}"

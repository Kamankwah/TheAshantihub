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
    # Anonymous guest support chat: a browser-generated random token
    # (persisted in localStorage) stands in for an account. Exactly one of
    # customer/business_owner/guest_token is set per row — the constraint
    # below. NULL (never "") when unused so the exactly-one check stays a
    # clean isnull test.
    guest_token = models.CharField(max_length=64, null=True, blank=True, db_index=True)
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
                    models.Q(customer__isnull=False, business_owner__isnull=True, guest_token__isnull=True)
                    | models.Q(customer__isnull=True, business_owner__isnull=False, guest_token__isnull=True)
                    | models.Q(customer__isnull=True, business_owner__isnull=True, guest_token__isnull=False)
                ),
                name="conversation_exactly_one_starter",
            ),
        ]

    @property
    def starter_display_name(self):
        if self.customer_id:
            return self.customer.full_name
        if self.business_owner_id:
            return self.business_owner.full_name
        return "Guest"

    def __str__(self):
        return f"Conversation with {self.starter_display_name} ({self.status})"


class Message(models.Model):
    CUSTOMER = "customer"
    BUSINESS_OWNER = "business_owner"
    STAFF = "staff"
    GUEST = "guest"
    SENDER_TYPE_CHOICES = [
        (CUSTOMER, "Customer"),
        (BUSINESS_OWNER, "Business Owner"),
        (STAFF, "Staff"),
        (GUEST, "Guest"),
    ]

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name="messages")
    sender_type = models.CharField(max_length=15, choices=SENDER_TYPE_CHOICES)
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self):
        return f"{self.sender_type} message in conversation {self.conversation_id}"

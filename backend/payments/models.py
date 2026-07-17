from django.db import models
from django.utils.crypto import get_random_string

from accounts.models import BusinessOwner, Customer
from billing.models import Transaction


def _generate_reference(kind):
    # "AH-{KIND}-{10 random uppercase chars}", matching this codebase's
    # existing AH-... reference convention (orders/events/listings all
    # already mint `f"AH-...-{get_random_string(8).upper()}"`-style refs) —
    # sent to Hubtel as `clientReference` once real credentials exist, and
    # is what CheckoutSession/Transaction/WebhookEvent all key idempotency
    # off of.
    return f"AH-{kind.upper()}-{get_random_string(10).upper()}"


class CheckoutSession(models.Model):
    """Owns *how* a payment gets initiated/confirmed — created for every
    payment attempt regardless of provider, and is what a webhook resolves
    against. Distinct from billing.Transaction, which stays the actual
    ledger row and is only ever created once a payment is confirmed
    (immediately in simulated mode, or by the Hubtel webhook in real mode).
    See docs/HUBTEL_INTEGRATION.md and payments/services.py's
    process_payment().

    Deliberately NOT a GenericForeignKey to the thing being paid for (order/
    event/ticket type/etc.) — `metadata` (a plain JSONField, e.g.
    `{"order_id": 5}`) carries whatever a kind's finalizer needs instead, to
    avoid the extra migration/query-complexity risk of a real GFK on a
    same-day launch.
    """

    ORDER_CHECKOUT = "order_checkout"
    EVENT_PAY = "event_pay"
    TICKET_PURCHASE = "ticket_purchase"
    SUBSCRIPTION = "subscription"
    HERO_EXTEND = "hero_extend"
    LISTING_PROMOTION = "listing_promotion"
    SERVICE_REQUEST = "service_request"
    BOOKING = "booking"
    EVENT_RENEW = "event_renew"
    KIND_CHOICES = [
        (ORDER_CHECKOUT, "Order Checkout"),
        (EVENT_PAY, "Event Pay"),
        (TICKET_PURCHASE, "Ticket Purchase"),
        (SUBSCRIPTION, "Subscription"),
        (HERO_EXTEND, "Hero Extend"),
        (LISTING_PROMOTION, "Listing Promotion"),
        (SERVICE_REQUEST, "Service Request"),
        (BOOKING, "Booking"),
        (EVENT_RENEW, "Event Renewal"),
    ]

    PENDING = "pending"
    SUCCESS = "success"
    FAILED = "failed"
    EXPIRED = "expired"
    STATUS_CHOICES = [
        (PENDING, "Pending"),
        (SUCCESS, "Success"),
        (FAILED, "Failed"),
        (EXPIRED, "Expired"),
    ]

    # Exactly-one-of business_owner/customer, mirroring billing.Transaction's
    # own CheckConstraint (backend/billing/models.py) exactly.
    business_owner = models.ForeignKey(
        BusinessOwner, on_delete=models.CASCADE, related_name="checkout_sessions",
        null=True, blank=True,
    )
    customer = models.ForeignKey(
        Customer, on_delete=models.CASCADE, related_name="checkout_sessions",
        null=True, blank=True,
    )

    kind = models.CharField(max_length=20, choices=KIND_CHOICES)
    # Matches billing.Transaction.amount's field definition exactly (same
    # max_digits/decimal_places) since this is the amount that field is
    # eventually populated from.
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    purpose = models.CharField(max_length=255)
    # Our own id, sent to Hubtel as `clientReference` — this is what webhook
    # processing looks the session up by (see views.HubtelWebhookView), and
    # what billing.Transaction.reference is set to on success, so a
    # Transaction can always be traced back to the CheckoutSession that
    # produced it.
    reference = models.CharField(max_length=64, unique=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    provider = models.CharField(max_length=20, default="simulated")
    hubtel_checkout_id = models.CharField(max_length=128, null=True, blank=True)
    checkout_url = models.URLField(null=True, blank=True)

    transaction = models.ForeignKey(
        Transaction, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="checkout_sessions",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(business_owner__isnull=False, customer__isnull=True)
                    | models.Q(business_owner__isnull=True, customer__isnull=False)
                ),
                name="checkout_session_exactly_one_of_business_owner_or_customer",
            ),
        ]

    def save(self, *args, **kwargs):
        if not self.reference:
            self.reference = _generate_reference(self.kind)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.reference} — {self.kind} GHS {self.amount} ({self.status})"


class WebhookEvent(models.Model):
    """Logs every raw inbound Hubtel webhook payload — even ones that fail
    signature verification — before any processing decision is made, per
    docs/HUBTEL_INTEGRATION.md §4/§8's "log every raw payload for
    reconciliation and dispute handling" requirement. Never mutated after
    creation except to flip `processed`/`processing_note` once handling
    finishes.
    """

    provider = models.CharField(max_length=20, default="hubtel")
    raw_payload = models.JSONField()
    signature_valid = models.BooleanField(default=False)
    hubtel_reference = models.CharField(max_length=128, db_index=True, blank=True)
    processed = models.BooleanField(default=False)
    processing_note = models.TextField(blank=True)
    received_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-received_at"]

    def __str__(self):
        return f"WebhookEvent {self.id} ({self.hubtel_reference or 'no ref'})"

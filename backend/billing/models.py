from django.db import models

from accounts.models import BusinessOwner, Customer


class SubscriptionPlan(models.Model):
    BASIC = "basic"
    STANDARD = "standard"
    PREMIUM = "premium"
    TIER_CHOICES = [
        (BASIC, "Basic"),
        (STANDARD, "Standard"),
        (PREMIUM, "Premium"),
    ]

    tier = models.CharField(max_length=20, choices=TIER_CHOICES, unique=True)
    name = models.CharField(max_length=100)
    monthly_price = models.DecimalField(max_digits=10, decimal_places=2)
    annual_price = models.DecimalField(max_digits=10, decimal_places=2)
    # Marketing copy only — NOT the source of truth for gating. Use the
    # structured entitlement fields below for anything that enforces a limit.
    features = models.JSONField(default=list, blank=True)
    is_recommended = models.BooleanField(default=False)

    # Structured entitlements (Phase 1 of docs/BUSINESS_EVENTS_ROADMAP.md).
    max_active_listings = models.PositiveIntegerField(default=0)
    # How many days an approved hero-media submission stays live for this tier.
    hero_days = models.PositiveIntegerField(default=0)
    boost_credits_per_month = models.PositiveIntegerField(default=0)

    def __str__(self):
        return self.name


class Subscription(models.Model):
    MONTHLY = "monthly"
    ANNUAL = "annual"
    BILLING_CYCLE_CHOICES = [
        (MONTHLY, "Monthly"),
        (ANNUAL, "Annual"),
    ]

    ACTIVE = "active"
    INACTIVE = "inactive"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (ACTIVE, "Active"),
        (INACTIVE, "Inactive"),
        (CANCELLED, "Cancelled"),
    ]

    # One current subscription record per business owner — "change plan"
    # updates this row in place rather than creating subscription history.
    business_owner = models.OneToOneField(
        BusinessOwner, on_delete=models.CASCADE, related_name="subscription"
    )
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT, related_name="subscriptions")
    billing_cycle = models.CharField(max_length=10, choices=BILLING_CYCLE_CHOICES, default=MONTHLY)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=ACTIVE)
    current_period_start = models.DateTimeField()
    current_period_end = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.business_owner.full_name} — {self.plan.name} ({self.status})"


class Transaction(models.Model):
    """
    A record of a (currently simulated) payment event, e.g. a MoMo subscription
    payment. Real Hubtel-verified transactions/webhooks are out of scope here —
    see docs/HUBTEL_INTEGRATION.md, owned separately. This model just gives the
    PaymentDashboard frontend stub something real to read/write instead of an
    in-memory mock array.
    """

    SUCCESS = "success"
    PENDING = "pending"
    FAILED = "failed"
    REFUNDED = "refunded"
    STATUS_CHOICES = [
        (SUCCESS, "Success"),
        (PENDING, "Pending"),
        (FAILED, "Failed"),
        (REFUNDED, "Refunded"),
    ]

    # A Transaction now represents either a business-owner subscription
    # payment OR a customer order payment (cart/orders app), never both on
    # the same row — enforced by the CheckConstraint below. Both FKs are
    # nullable so exactly one is set per row.
    business_owner = models.ForeignKey(
        BusinessOwner, on_delete=models.CASCADE, related_name="transactions",
        null=True, blank=True,
    )
    customer = models.ForeignKey(
        Customer, on_delete=models.CASCADE, related_name="transactions",
        null=True, blank=True,
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    purpose = models.CharField(max_length=255)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=SUCCESS)
    reference = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(business_owner__isnull=False, customer__isnull=True)
                    | models.Q(business_owner__isnull=True, customer__isnull=False)
                ),
                name="transaction_exactly_one_of_business_owner_or_customer",
            ),
        ]

    def __str__(self):
        return f"{self.reference} — GHS {self.amount} ({self.status})"

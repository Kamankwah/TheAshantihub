from django.core.validators import RegexValidator
from django.db import models

from accounts.models import BusinessOwner, Customer


class SubscriptionPlan(models.Model):
    PRODUCT_BASIC = "product_basic"
    PRODUCT_UNLIMITED = "product_unlimited"
    SERVICE = "service"
    # TIER_CHOICES documents the 3 plans seeded as this platform's baseline —
    # it is NOT passed as the tier field's `choices=`, since the accountant
    # role must be able to create genuinely new plans (a fixed choices= enum
    # would make "create" only ever able to reuse these 3 slugs). `tier` is a
    # free-form unique slug instead, constrained by the validator below.
    TIER_CHOICES = [
        (PRODUCT_BASIC, "Product Basic"),
        (PRODUCT_UNLIMITED, "Product Unlimited"),
        (SERVICE, "Service"),
    ]
    TIER_SLUG_VALIDATOR = RegexValidator(
        r"^[a-z][a-z0-9_]*$",
        "Tier must be lowercase letters, numbers, and underscores only, starting with a letter.",
    )

    # Same string values as listings.Category.kind ("product"/"service") so
    # they can be compared directly against a BusinessOwnerProfile.business_kind
    # or a Category.kind elsewhere without a translation table. (Note KIND_PRODUCT/
    # KIND_SERVICE are distinct constants from the TIER_CHOICES ones above even
    # though KIND_SERVICE and SERVICE happen to share the string "service".)
    KIND_PRODUCT = "product"
    KIND_SERVICE = "service"
    KIND_CHOICES = [
        (KIND_PRODUCT, "Product"),
        (KIND_SERVICE, "Service"),
    ]

    PENDING_APPROVAL = "pending_approval"
    ACTIVE_STATUS = "active"
    REJECTED_STATUS = "rejected"
    STATUS_CHOICES = [
        (PENDING_APPROVAL, "Pending Approval"),
        (ACTIVE_STATUS, "Active"),
        (REJECTED_STATUS, "Rejected"),
    ]

    tier = models.CharField(max_length=20, unique=True, validators=[TIER_SLUG_VALIDATOR])
    name = models.CharField(max_length=100)
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    monthly_price = models.DecimalField(max_digits=10, decimal_places=2)
    # Marketing copy only — NOT the source of truth for gating. Use the
    # structured entitlement fields below for anything that enforces a limit.
    features = models.JSONField(default=list, blank=True)
    is_recommended = models.BooleanField(default=False)

    # Plan creation/editing is done by the `accountant` role and requires
    # `super_admin` approval before it's usable — mirrors listings.HeroMediaSubmission's
    # pending/approved/rejected pattern.
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=PENDING_APPROVAL)
    rejection_reason = models.CharField(max_length=500, null=True, blank=True)

    # Who last approved/rejected this plan and when — the canonical pair
    # shared with Listing/Event/HeroMediaSubmission/BusinessOwner, driving the
    # Approved/Rejected tabs' attribution line.
    reviewed_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reviewed_subscription_plans",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    # This model had no timestamp at all, so the pending queue ordered by id
    # as a stand-in for "oldest first". Nullable because rows predating the
    # column keep NULL — auto_now_add only stamps new rows, it does not
    # backfill. Those legacy rows are by definition the *oldest*, so the
    # pending queue sorts them first explicitly (nulls_first=True); Postgres
    # would otherwise sort NULLs last on an ascending order_by and show the
    # seeded plans as the newest. See SubscriptionPlanPendingQueueView.
    created_at = models.DateTimeField(auto_now_add=True, null=True)

    # Structured entitlements (Phase 1 of docs/BUSINESS_EVENTS_ROADMAP.md).
    # null = unlimited listings (matches frontend/components/dashboard/charts/
    # UsageMeters.jsx's/AnalyticsPanel.jsx's existing `max_active_listings ?? null` convention).
    max_active_listings = models.PositiveIntegerField(null=True, blank=True, default=None)
    # How many days an approved hero-media submission stays live for this tier.
    hero_days = models.PositiveIntegerField(default=0)
    boost_credits_per_month = models.PositiveIntegerField(default=0)

    def __str__(self):
        return self.name


class Subscription(models.Model):
    ACTIVE = "active"
    INACTIVE = "inactive"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (ACTIVE, "Active"),
        (INACTIVE, "Inactive"),
        (CANCELLED, "Cancelled"),
    ]

    CYCLE_CHOICES = [
        (1, "1 month"),
        (3, "3 months"),
        (6, "6 months"),
        (12, "12 months"),
    ]

    # One current subscription record per business owner — "change plan"
    # updates this row in place rather than creating subscription history.
    business_owner = models.OneToOneField(
        BusinessOwner, on_delete=models.CASCADE, related_name="subscription"
    )
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT, related_name="subscriptions")
    # Period-length calculations (a later task, not this one): python-dateutil
    # is NOT currently a pinned dependency (see backend/requirements.txt), so
    # that later task's fallback will be timedelta(days=30*cycle_months)
    # rather than dateutil.relativedelta(months=cycle_months).
    cycle_months = models.PositiveSmallIntegerField(choices=CYCLE_CHOICES, default=1)
    # True for a business owner's free first billing cycle before they're
    # prompted to choose a renewal cycle (1/3/6/12 months) and pay.
    is_trial = models.BooleanField(default=False)
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

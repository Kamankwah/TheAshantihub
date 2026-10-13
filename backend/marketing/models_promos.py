"""Coupons and flash sales (Marketing canvas 08 to 11).

Everything here is inert until settings.MARKETING_PROMOS_ENABLED is switched on: staff
can draft, edit and schedule, but checkout neither prices a flash sale nor accepts a
code (marketing/checkout.py is the only place that reads these rows at checkout).

Money rules, decided with the owner:
- A coupon is paid for by AshantiHub; the seller is paid the full line price. The order's
  total_amount stays NET; the discount lives on Order.discount_amount / Order.coupon.
- A flash sale is paid for by the sellers who agreed to it. The sale price is written to
  OrderItem.unit_price (with OrderItem.flash_sale) and Listing.price_amount never changes.
- "AshantiHub pays" for a flash sale needs a payout ledger that does not exist; it is not
  offered (payer is always "sellers")."""
from decimal import Decimal

from django.db import models
from django.db.models import Q, Sum
from django.db.models.functions import Upper
from django.utils import timezone


class Coupon(models.Model):
    PERCENT = "percent"
    FIXED = "fixed"
    KIND_CHOICES = [(PERCENT, "% off"), (FIXED, "GH₵ off")]

    SHARED = "shared"
    SINGLE_USE = "single_use"
    MODE_CHOICES = [(SHARED, "One shared code"), (SINGLE_USE, "Single-use codes")]

    DRAFT = "draft"
    WAITING = "waiting_approval"
    ACTIVE = "active"
    PAUSED = "paused"
    EXPIRED = "expired"
    STATUS_CHOICES = [
        (DRAFT, "Draft"), (WAITING, "Waiting for Super Admin"), (ACTIVE, "Live"),
        (PAUSED, "Paused"), (EXPIRED, "Ended"),
    ]

    # Stored upper-case. For single-use coupons this is the prefix of the generated codes
    # ("WB" for "WB-7KQ2M") and is never itself accepted at checkout.
    code = models.CharField(max_length=40)
    name = models.CharField(max_length=120, blank=True)
    code_mode = models.CharField(max_length=10, choices=MODE_CHOICES, default=SHARED)
    kind = models.CharField(max_length=8, choices=KIND_CHOICES)
    value = models.DecimalField(max_digits=10, decimal_places=2)
    # A percent coupon's ceiling per order ("15% off, up to GH₵ 30.00").
    max_discount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    min_spend = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal("0.00"))
    usage_limit = models.PositiveIntegerField()
    per_customer_limit = models.PositiveSmallIntegerField(default=1)
    starts_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    category = models.ForeignKey("listings.Category", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=DRAFT)
    # The most this coupon may cost AshantiHub, in total. Checkout refuses a use that would
    # pass it and the coupon pauses itself when it is reached.
    budget_cap = models.DecimalField(max_digits=12, decimal_places=2)
    paused_reason = models.CharField(max_length=200, blank=True)
    paused_at = models.DateTimeField(null=True, blank=True)
    activated_at = models.DateTimeField(null=True, blank=True)
    activated_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [models.UniqueConstraint(Upper("code"), name="marketing_coupon_code_ci_unique")]

    def __str__(self):
        return self.code

    def save(self, *args, **kwargs):
        self.code = (self.code or "").strip().upper()
        super().save(*args, **kwargs)

    # ── derived ──
    def redemptions_in_force(self):
        return self.redemptions.filter(released_at__isnull=True)

    def uses(self):
        return self.redemptions_in_force().count()

    def cost_to_date(self):
        """The discount AshantiHub has paid on orders still standing (a cancelled order's
        redemption is released and no longer counts)."""
        return self.redemptions_in_force().aggregate(total=Sum("amount"))["total"] or Decimal("0.00")

    def effective_status(self, now=None):
        """Ended is derived from the window and the use count, never trusted from `status`."""
        now = now or timezone.now()
        if self.status == self.ACTIVE and ((self.expires_at and self.expires_at <= now) or self.uses() >= self.usage_limit):
            return self.EXPIRED
        return self.status

    def per_use_ceiling(self):
        """The most one order can take off, or None when it cannot be bounded."""
        if self.kind == self.FIXED:
            return self.value
        return self.max_discount


class CouponCode(models.Model):
    """One generated single-use code (the coupon's code is the prefix)."""

    coupon = models.ForeignKey(Coupon, on_delete=models.CASCADE, related_name="codes")
    code = models.CharField(max_length=60)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        constraints = [models.UniqueConstraint(Upper("code"), name="marketing_couponcode_code_ci_unique")]

    def __str__(self):
        return self.code

    def save(self, *args, **kwargs):
        self.code = (self.code or "").strip().upper()
        super().save(*args, **kwargs)


class CouponRedemption(models.Model):
    coupon = models.ForeignKey(Coupon, on_delete=models.PROTECT, related_name="redemptions")
    code_row = models.ForeignKey(CouponCode, on_delete=models.PROTECT, null=True, blank=True, related_name="redemptions")
    order = models.OneToOneField("orders.Order", on_delete=models.PROTECT, related_name="coupon_redemption")
    customer = models.ForeignKey("accounts.Customer", on_delete=models.PROTECT, related_name="+")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    code_used = models.CharField(max_length=60)
    created_at = models.DateTimeField(auto_now_add=True)
    # Set when the order never completed (payment failed or expired): the use is given back
    # and the discount is not counted as paid.
    released_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            # Backstop for the row lock: one standing redemption per single-use code.
            models.UniqueConstraint(
                fields=["code_row"], condition=Q(released_at__isnull=True) & Q(code_row__isnull=False),
                name="marketing_one_standing_redemption_per_code",
            ),
        ]


class FlashSale(models.Model):
    DRAFT = "draft"
    WAITING = "waiting_sellers"
    SCHEDULED = "scheduled"
    LIVE = "live"
    ENDED = "ended"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (DRAFT, "Draft"), (WAITING, "Waiting for sellers"), (SCHEDULED, "Scheduled"),
        (LIVE, "Live"), (ENDED, "Ended"), (CANCELLED, "Cancelled"),
    ]
    SELLERS_PAY = "sellers"

    name = models.CharField(max_length=120)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    discount_pct = models.PositiveSmallIntegerField()
    # Items that may be sold at the sale price across the whole sale.
    stock_cap = models.PositiveIntegerField()
    per_customer_limit = models.PositiveSmallIntegerField(default=1)
    payer = models.CharField(max_length=10, default=SELLERS_PAY)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default=DRAFT)
    asked_at = models.DateTimeField(null=True, blank=True)
    ended_early_at = models.DateTimeField(null=True, blank=True)
    ended_early_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-starts_at", "-id"]
        constraints = [models.CheckConstraint(condition=Q(ends_at__gt=models.F("starts_at")), name="marketing_flashsale_window_ordered")]

    def __str__(self):
        return self.name


class FlashSaleListing(models.Model):
    """One listing in a sale. The seller's yes/no is recorded here; the prices are what the
    seller agreed to (checkout stops using the sale price if the listing's price changes)."""

    sale = models.ForeignKey(FlashSale, on_delete=models.CASCADE, related_name="listings")
    listing = models.ForeignKey("listings.Listing", on_delete=models.PROTECT, related_name="flash_sale_rows")
    normal_price = models.DecimalField(max_digits=10, decimal_places=2)
    sale_price = models.DecimalField(max_digits=10, decimal_places=2)
    asked_at = models.DateTimeField(null=True, blank=True)
    agreed_at = models.DateTimeField(null=True, blank=True)
    declined_at = models.DateTimeField(null=True, blank=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["id"]
        constraints = [models.UniqueConstraint(fields=["sale", "listing"], name="marketing_one_row_per_listing_in_sale")]

    @property
    def state(self):
        if self.declined_at:
            return "withdrawn" if self.withdrawn_at else "declined"
        if self.agreed_at:
            return "agreed"
        return "asked" if self.asked_at else "not_asked"

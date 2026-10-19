"""Free-delivery promos (a business waives the delivery fee on its own items for a window).

Who pays: the business (`funded_by` business, the only kind any endpoint creates today) or AshantiHub (`platform`, paid
from the promo subsidy account; the field and the ledger path exist so a staff-created AshantiHub promo needs no money-code
change). The waived fee is written on the order (Order.delivery_fee = 0 and the
original amount in delivery_fee_breakdown["waived"]) so the cost is recorded. With the ledger on
(LEDGER_ENABLED) the fee is charged to the business's Available balance when Support releases the order
(ledger.escrow.charge_waiver) and given back on a whole refund; with it off nothing is charged.

Moderation follows the queue contract: an owner-submitted promo is `pending` until staff with
site_promo.manage approve it; a promo staff create on a business's behalf is active at once.
"Live" is derived from the window (status=active AND starts_at <= now < ends_at), never read
off status alone."""
from django.db import models
from django.db.models import Q
from django.utils import timezone


class DeliveryWaiver(models.Model):
    PENDING = "pending"
    ACTIVE = "active"
    PAUSED = "paused"
    ENDED = "ended"
    REJECTED = "rejected"
    STATUS_CHOICES = [
        (PENDING, "Waiting for review"), (ACTIVE, "Approved"), (PAUSED, "Paused"),
        (ENDED, "Ended"), (REJECTED, "Not approved"),
    ]
    OWNER = "owner"
    STAFF = "staff"
    FUNDER_BUSINESS = "business"
    FUNDER_PLATFORM = "platform"
    FUNDER_CHOICES = [(FUNDER_BUSINESS, "Business"), (FUNDER_PLATFORM, "AshantiHub")]

    business_owner = models.ForeignKey("accounts.BusinessOwner", on_delete=models.PROTECT, related_name="delivery_waivers")
    name = models.CharField(max_length=120)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    # True: every listing the business has. False: only `listings`.
    all_items = models.BooleanField(default=False)
    listings = models.ManyToManyField("listings.Listing", blank=True, related_name="delivery_waivers")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    source = models.CharField(max_length=5, default=OWNER)
    # Who pays for the waived fee. Copied onto each WaivedFeeCharge at checkout, so editing it later changes no order.
    funded_by = models.CharField(max_length=8, choices=FUNDER_CHOICES, default=FUNDER_BUSINESS)
    created_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    reviewed_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    reviewed_at = models.DateTimeField(null=True, blank=True)
    rejection_reason = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [models.CheckConstraint(condition=Q(ends_at__gt=models.F("starts_at")), name="marketing_waiver_window_ordered")]

    def __str__(self):
        return self.name

    def is_live(self, now=None):
        now = now or timezone.now()
        return self.status == self.ACTIVE and self.starts_at <= now < self.ends_at

    def effective_status(self, now=None):
        now = now or timezone.now()
        if self.status in (self.ACTIVE, self.PAUSED) and self.ends_at <= now:
            return self.ENDED
        return self.status


class WaivedFeeCharge(models.Model):
    """The delivery fee a promo covered on one order (paid by `funded_by`: the business, or AshantiHub): one row per
    waived order, written in the checkout transaction. `owed` is a recorded charge against the funder
    that has not yet been taken or cancelled: with the ledger on it is charged to the funder at release
    (ledger.escrow.charge_waiver, which leaves the row `owed` as the record of what was charged), with it off
    nothing moves; `reversed` means the order was cancelled, its payment failed or it was fully refunded, so the
    funder owes nothing for it. Rows are never deleted or edited otherwise."""

    OWED = "owed"
    REVERSED = "reversed"
    STATUS_CHOICES = [(OWED, "Owed by the business"), (REVERSED, "Reversed")]

    order = models.OneToOneField("orders.Order", on_delete=models.PROTECT, related_name="waived_fee_charge")
    waiver = models.ForeignKey(DeliveryWaiver, on_delete=models.PROTECT, related_name="charges")
    business_owner = models.ForeignKey("accounts.BusinessOwner", on_delete=models.PROTECT, related_name="waived_fee_charges")
    amount = models.DecimalField(max_digits=8, decimal_places=2)
    # Who pays: copied from the waiver when the charge is written (never read from the waiver later).
    funded_by = models.CharField(max_length=8, choices=DeliveryWaiver.FUNDER_CHOICES, default=DeliveryWaiver.FUNDER_BUSINESS)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=OWED)
    reversed_at = models.DateTimeField(null=True, blank=True)
    reversed_reason = models.CharField(max_length=40, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [models.CheckConstraint(condition=Q(amount__gt=0), name="marketing_waivedfee_positive")]

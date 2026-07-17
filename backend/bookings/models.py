from django.db import models

from accounts.models import BusinessOwner, Customer
from listings.models import Listing


class Booking(models.Model):
    """A date-based reservation for an accommodation listing (business item 2 /
    Wave H3 — hotel/real-estate/Airbnb). Distinct from an order (product) and a
    service request (service): it's booked for a date range with per-night
    pricing, availability-checked against the listing's units_total, and paid
    up front.

    Lifecycle:
      pending → confirmed (paid) → checked_in → checked_out
              → cancelled  (frees the dates)

    Dates are half-open [check_in, check_out): a guest occupies the nights from
    check_in up to (but not including) check_out, the standard hotel convention.
    Only PENDING/CONFIRMED/CHECKED_IN bookings hold inventory — a cancelled or
    checked-out booking frees its nights for others.
    """

    PENDING = "pending"
    CONFIRMED = "confirmed"
    CHECKED_IN = "checked_in"
    CHECKED_OUT = "checked_out"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (PENDING, "Pending payment"),
        (CONFIRMED, "Confirmed"),
        (CHECKED_IN, "Checked in"),
        (CHECKED_OUT, "Checked out"),
        (CANCELLED, "Cancelled"),
    ]
    # Statuses that occupy inventory for their date range.
    ACTIVE_STATUSES = (PENDING, CONFIRMED, CHECKED_IN)

    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="bookings")
    listing = models.ForeignKey(Listing, on_delete=models.PROTECT, related_name="bookings")
    business_owner = models.ForeignKey(
        BusinessOwner, on_delete=models.CASCADE, related_name="incoming_bookings"
    )

    check_in = models.DateField()
    check_out = models.DateField()
    units = models.PositiveIntegerField(default=1)
    # Snapshotted at booking: nights × nightly rate × units. The listing's
    # price can change later without rewriting a past booking's total.
    nightly_rate = models.DecimalField(max_digits=10, decimal_places=2)
    total_price = models.DecimalField(max_digits=12, decimal_places=2)

    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=PENDING)
    paid_at = models.DateTimeField(null=True, blank=True)
    checked_in_at = models.DateTimeField(null=True, blank=True)
    checked_out_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    @property
    def nights(self):
        return (self.check_out - self.check_in).days

    def __str__(self):
        return f"Booking {self.id} — {self.listing_id} {self.check_in}→{self.check_out} ({self.status})"

from django.db import models

from accounts.models import Customer
from listings.models import Listing


class Order(models.Model):
    PENDING = "pending"
    PAID = "paid"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (PENDING, "Pending"),
        (PAID, "Paid"),
        (CANCELLED, "Cancelled"),
    ]

    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="orders")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    total_amount = models.DecimalField(max_digits=10, decimal_places=2)
    placed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-placed_at"]

    def __str__(self):
        return f"Order {self.id} — {self.customer.full_name} ({self.status})"


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    # PROTECT: an order line is a historical record of what was bought — a
    # listing referenced by a past order should not be hard-deletable out
    # from under that history. (Nothing in the codebase currently hard-deletes
    # a Listing anyway; moderation/removal is done via `status`.)
    listing = models.ForeignKey(Listing, on_delete=models.PROTECT, related_name="order_items")
    quantity = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    line_total = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return f"{self.quantity} x {self.listing.name} (Order {self.order_id})"

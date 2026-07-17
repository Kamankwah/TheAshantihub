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

    PROCESSING = "processing"
    SHIPPED = "shipped"
    OUT_FOR_DELIVERY = "out_for_delivery"
    DELIVERED = "delivered"
    DELIVERY_STATUS_CHOICES = [
        (PROCESSING, "Processing"),
        (SHIPPED, "Shipped"),
        (OUT_FOR_DELIVERY, "Out for Delivery"),
        (DELIVERED, "Delivered"),
    ]

    # How the customer wants the order fulfilled, chosen at checkout (Wave F,
    # the fulfilment spine item 11's Delivery Manager is built around).
    # store_pickup is the default and needs no address; door_to_door requires
    # a delivery address + phone (enforced in OrderCheckoutView).
    DOOR_TO_DOOR = "door_to_door"
    STORE_PICKUP = "store_pickup"
    DELIVERY_METHOD_CHOICES = [
        (DOOR_TO_DOOR, "Door-to-door delivery"),
        (STORE_PICKUP, "Store pickup"),
    ]

    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="orders")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    delivery_status = models.CharField(
        max_length=20, choices=DELIVERY_STATUS_CHOICES, default=PROCESSING
    )
    delivery_method = models.CharField(
        max_length=20, choices=DELIVERY_METHOD_CHOICES, default=STORE_PICKUP
    )
    # Only meaningful for door_to_door. A free-text address (customer addresses
    # are free text platform-wide), a contact phone for the delivery, and
    # optional coordinates. lat/lng are optional because a free-text address
    # can't be geocoded reliably — item 11's dispatch map falls back to a
    # manual pin/address when they're absent (there is no geocoding service).
    delivery_address = models.CharField(max_length=500, blank=True)
    delivery_phone = models.CharField(max_length=20, blank=True)
    delivery_lat = models.FloatField(null=True, blank=True)
    delivery_lng = models.FloatField(null=True, blank=True)
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

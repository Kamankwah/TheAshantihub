from django.db import models

from accounts.models import Customer
from listings.models import Listing


class Cart(models.Model):
    """One-to-one with Customer. Created lazily (get-or-create) the first time
    a customer touches the cart — there is no separate "create cart" step.
    """

    customer = models.OneToOneField(Customer, on_delete=models.CASCADE, related_name="cart")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Cart for {self.customer.full_name}"


class CartItem(models.Model):
    cart = models.ForeignKey(Cart, on_delete=models.CASCADE, related_name="items")
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="cart_items")
    quantity = models.PositiveIntegerField(default=1)
    # Copied from listing.price_amount at add-time so a later price change on
    # the listing doesn't retroactively alter an existing cart line.
    unit_price_snapshot = models.DecimalField(max_digits=10, decimal_places=2)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["added_at"]
        constraints = [
            models.UniqueConstraint(fields=["cart", "listing"], name="unique_listing_per_cart"),
        ]

    def __str__(self):
        return f"{self.quantity} x {self.listing.name}"

    @property
    def line_total(self):
        return self.unit_price_snapshot * self.quantity

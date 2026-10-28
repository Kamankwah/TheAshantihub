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
    # Set when the listing has variants: one line per variant bought.
    variant = models.ForeignKey("listings.ListingVariant", on_delete=models.CASCADE, null=True, blank=True, related_name="cart_items")
    quantity = models.PositiveIntegerField(default=1)
    # Copied from listing.effective_price (sale price when a real discount) at add-time so a later price change on
    # the listing doesn't retroactively alter an existing cart line.
    unit_price_snapshot = models.DecimalField(max_digits=10, decimal_places=2)
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["added_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["cart", "listing"], condition=models.Q(variant__isnull=True), name="unique_novariant_listing_per_cart",
            ),
            models.UniqueConstraint(
                fields=["cart", "variant"], condition=models.Q(variant__isnull=False), name="unique_variant_per_cart",
            ),
        ]

    def __str__(self):
        label = f" ({self.variant.label})" if self.variant_id else ""
        return f"{self.quantity} x {self.listing.name}{label}"

    @property
    def line_total(self):
        return self.unit_price_snapshot * self.quantity

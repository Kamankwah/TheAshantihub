"""Catalogue entries, grouping requests and stock-alert state (catalogue plan 6; spec §1 rows 7, 8 and 15, §10).

Every Listing is an offer (its own price, stock, cart line, fee and pickup). A branded or barcoded product may be grouped
with a CatalogueProduct so customers see every business selling it; unbranded goods, services, stays and events stand
alone (Listing.catalogue_product null)."""
from django.db import models

from . import identity


class CatalogueProduct(models.Model):
    """One branded or barcoded product several businesses sell. Made only when staff approve a grouping request
    (catalogue.attach.approve); a barcode belongs to one entry, and an entry needs a brand or a barcode."""

    brand = models.CharField(max_length=100, blank=True, default="")
    name = models.CharField(max_length=150)
    normalised_name = models.CharField(max_length=300, db_index=True, editable=False)
    barcode = models.CharField(max_length=14, blank=True, default="")
    created_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["normalised_name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["barcode"], condition=~models.Q(barcode=""), name="catalogue_product_barcode_unique",
            ),
            models.CheckConstraint(
                condition=~models.Q(brand="") | ~models.Q(barcode=""), name="catalogue_product_brand_or_barcode",
            ),
        ]

    def save(self, *args, **kwargs):
        self.normalised_name = identity.normalise_name(self.brand, self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return " ".join(part for part in (self.brand, self.name) if part)


def product_row(product):
    """A catalogue entry as the API shows it; None for no entry."""
    if product is None:
        return None
    return {"id": product.pk, "brand": product.brand, "name": product.name, "barcode": product.barcode}

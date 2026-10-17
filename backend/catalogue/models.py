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


class CatalogueAttachRequest(models.Model):
    """A request to group one listing with a catalogue product (spec §1 row 8): an existing entry (`catalogue_product`)
    or a new one described by `brand` and `name`. Staff with listings.moderate decide it through the moderated-queue
    contract (backend/CLAUDE.md). `barcode` is the listing's own barcode when it was asked (never a store's own code). A
    backfill request (`source=backfill`) was filed by the barcode matcher; it is decided the same way and never applied
    by itself. At most one request waits per listing."""

    PENDING, APPROVED, REJECTED, WITHDRAWN = "pending", "approved", "rejected", "withdrawn"
    STATUS_CHOICES = [(PENDING, "Pending"), (APPROVED, "Approved"), (REJECTED, "Rejected"), (WITHDRAWN, "Withdrawn")]
    VENDOR, BACKFILL = "vendor", "backfill"
    SOURCE_CHOICES = [(VENDOR, "Asked by the business"), (BACKFILL, "Matched by barcode")]

    listing = models.ForeignKey("listings.Listing", on_delete=models.CASCADE, related_name="catalogue_requests")
    catalogue_product = models.ForeignKey(
        CatalogueProduct, on_delete=models.PROTECT, null=True, blank=True, related_name="requests",
    )
    brand = models.CharField(max_length=100, blank=True, default="")
    name = models.CharField(max_length=150, blank=True, default="")
    barcode = models.CharField(max_length=14, blank=True, default="")
    source = models.CharField(max_length=10, choices=SOURCE_CHOICES, default=VENDOR)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    rejection_reason = models.CharField(max_length=500, null=True, blank=True)
    reviewed_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="reviewed_catalogue_requests",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    # Set when staff ungroup the listing this request grouped: the request stays approved, and the barcode matcher
    # must not file the same listing for the same entry again.
    ungrouped_at = models.DateTimeField(null=True, blank=True)
    ungrouped_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["listing"], condition=models.Q(status="pending"), name="catalogue_request_one_pending_per_listing",
            ),
        ]

    def __str__(self):
        return f"Catalogue request {self.pk} for listing {self.listing_id} ({self.status})"


class StockAlertState(models.Model):
    """Where one offer's low-stock and sold-out alerts stand (catalogue.alerts) and the business's own low-stock line for
    it (catalogue.stock). One row per offer, made the first time it is measured or given a line. Moved only by
    conditional UPDATEs, so two runs at once never tell a business twice."""

    listing = models.OneToOneField("listings.Listing", on_delete=models.CASCADE, related_name="stock_alert")
    # The business's own line in units for this offer; null = AshantiHub's default (days of cover, else units).
    threshold_units = models.PositiveIntegerField(null=True, blank=True)
    low_alerted_at = models.DateTimeField(null=True, blank=True)
    # The stock when the low alert was told: the alert re-arms only once stock is back above it (a restock).
    low_alerted_stock = models.PositiveIntegerField(null=True, blank=True)
    sold_out_alerted_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Stock alerts for listing {self.listing_id}"

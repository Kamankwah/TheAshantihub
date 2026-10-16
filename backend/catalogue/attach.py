"""Grouping a business's listing with a catalogue product (catalogue plan 6; spec §1 row 8, §10).

A listing is an offer; grouping sets `Listing.catalogue_product` so customers see the other businesses selling the same
product. The business asks (`propose`) and may take back a request still waiting (`withdraw`); staff with
listings.moderate decide it and may ungroup a listing (the moderated-queue contract in backend/CLAUDE.md). Nothing is
grouped without a staff decision.

* Only products and food group (cart.guard DELIVERABLE); services, stays and events always stand alone (events are not
  listings at all).
* A request names an existing entry, or describes a new one by brand and name (each defaults to the listing's own). A
  new entry needs a brand or the listing's barcode; a store's own code (catalogue.identity.is_store_code) never counts.
* One request waits per listing: the check runs under the listing's row lock and a database constraint backs it.
* Lock order: a request row before its listing row (approve, reject, re-review); propose locks only the listing.
* The barcode matcher (Task 8) files requests without the listing lock, so `propose` and `re_review` catch the
  constraint's IntegrityError and answer 409 request_pending.
* A business may withdraw only a request it filed itself; a barcode match AshantiHub filed (source=backfill) is decided
  by staff alone (owner-confirmed: a business cannot opt out of one)."""
from django.db import IntegrityError, transaction

from cart import guard
from listings.models import Listing
from notifications.services import notify_staff_role

from . import identity
from .errors import CatalogueError
from .models import CatalogueAttachRequest, CatalogueProduct, product_row

NEEDS_REVIEW = "catalogue_needs_review"
NOT_GROUPABLE = "Only products can be grouped with other businesses' offers. Services, stays and events always stand alone."
ALREADY_GROUPED = "This listing is already grouped with a catalogue product."
REQUEST_PENDING = "A grouping request for this listing is already waiting for AshantiHub."
NEEDS_BRAND = "Give the product's brand, or add the barcode printed on the pack to the listing. Unbranded goods stand alone."
NEEDS_NAME = "Give the product's name."
UNKNOWN_PRODUCT = "That catalogue product does not exist."
BARCODE_MISMATCH = "That catalogue product has a different barcode from this listing."
NOT_PENDING = "Only a request still waiting can be changed."
NOT_WITHDRAWABLE = "AshantiHub matched this listing by its barcode; AshantiHub decides it."
NOT_FOUND = "Request not found."


def groupable(listing):
    """True for a product or food listing (cart.guard DELIVERABLE). Reads listing.category."""
    return guard.kind_of(listing) in guard.DELIVERABLE


def grouping_barcode(listing):
    """The listing's barcode when it may group (never a store's own code), else ""."""
    return "" if identity.is_store_code(listing.barcode) else listing.barcode


def _text(data, key, default, length):
    value = data.get(key)
    return str(default if value is None else value).strip()[:length]


def describe(request):
    """What a request asks to join, in words: the entry's brand and name, or the new entry's."""
    product = request.catalogue_product
    parts = (product.brand, product.name) if product is not None else (request.brand, request.name)
    return " ".join(part for part in parts if part)


def propose(listing, data):
    """File the business's request to group `listing` (the caller checked it is theirs). `data`: {"catalogue_product":
    id} for an existing entry, or {"brand", "name"} for a new one. Returns the request; raises CatalogueError."""
    with transaction.atomic():
        listing = Listing.objects.select_for_update(of=("self",)).select_related("category").get(pk=listing.pk)
        if not groupable(listing):
            raise CatalogueError(NOT_GROUPABLE, "not_groupable")
        if listing.catalogue_product_id is not None:
            raise CatalogueError(ALREADY_GROUPED, "already_grouped", 409)
        if CatalogueAttachRequest.objects.filter(listing=listing, status=CatalogueAttachRequest.PENDING).exists():
            raise CatalogueError(REQUEST_PENDING, "request_pending", 409)
        barcode = grouping_barcode(listing)
        product, brand, name = None, "", ""
        if data.get("catalogue_product") not in (None, ""):
            try:
                product = CatalogueProduct.objects.get(pk=int(data["catalogue_product"]))
            except (CatalogueProduct.DoesNotExist, TypeError, ValueError):
                raise CatalogueError(UNKNOWN_PRODUCT, "unknown_product") from None
            if product.barcode and barcode and product.barcode != barcode:
                raise CatalogueError(BARCODE_MISMATCH, "barcode_mismatch", 409)
        else:
            brand = _text(data, "brand", listing.brand, 100)
            name = _text(data, "name", listing.name, 150)
            if not name:
                raise CatalogueError(NEEDS_NAME, "name_required")
            if not brand and not barcode:
                raise CatalogueError(NEEDS_BRAND, "brand_or_barcode_required")
        try:
            with transaction.atomic():
                request = CatalogueAttachRequest.objects.create(
                    listing=listing, catalogue_product=product, brand=brand, name=name, barcode=barcode,
                )
        except IntegrityError:
            # The barcode matcher (it takes no listing lock) filed one meanwhile: one request waits per listing.
            raise CatalogueError(REQUEST_PENDING, "request_pending", 409) from None
    notify_staff_role(
        "listings.moderate", NEEDS_REVIEW, "Catalogue grouping to review",
        body=f"“{listing.name}” asks to be grouped with {describe(request)}.", link="catalogue", icon="🏷️",
    )
    return request


def withdraw(owner, request_id):
    """The business takes back a request it filed itself while it still waits (not a barcode match AshantiHub filed).
    Returns it; raises CatalogueError (404 for a request on another business's listing)."""
    with transaction.atomic():
        request = (
            CatalogueAttachRequest.objects.select_for_update(of=("self",))
            .filter(pk=request_id, listing__business_owner=owner)
            .first()
        )
        if request is None:
            raise CatalogueError(NOT_FOUND, "not_found", 404)
        if request.status != CatalogueAttachRequest.PENDING:
            raise CatalogueError(NOT_PENDING, "not_pending", 409)
        if request.source != CatalogueAttachRequest.VENDOR:
            raise CatalogueError(NOT_WITHDRAWABLE, "not_withdrawable", 409)
        request.status = CatalogueAttachRequest.WITHDRAWN
        request.save(update_fields=["status"])
    return request


def request_row(request):
    """A request as its business sees it (no staff names)."""
    return {
        "id": request.pk, "status": request.status, "source": request.source,
        "catalogue_product": product_row(request.catalogue_product),
        "brand": request.brand, "name": request.name, "barcode": request.barcode,
        "rejection_reason": request.rejection_reason, "created_at": request.created_at, "reviewed_at": request.reviewed_at,
    }


def state(listing):
    """What the business's listing can do and where its grouping stands (its latest request, if any)."""
    latest = listing.catalogue_requests.select_related("catalogue_product").order_by("-created_at", "-id").first()
    return {
        "listing": listing.pk, "groupable": groupable(listing), "barcode": listing.barcode,
        "store_code": identity.is_store_code(listing.barcode),
        "catalogue_product": product_row(listing.catalogue_product),
        "request": None if latest is None else request_row(latest),
    }

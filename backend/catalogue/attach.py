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
* The barcode matcher (Task 8) locks the listing row first, as `propose` does, files its request in a tiny transaction
  of its own and re-checks the listing under the lock. `re_review` locks request then listing and the matcher only inserts
  a new request row, so they cannot deadlock; the constraint's IntegrityError is still caught everywhere as a last
  resort (`propose` and `re_review` answer 409 request_pending, the matcher skips the listing).
* A business may withdraw only a request it filed itself; a barcode match AshantiHub filed (source=backfill) is decided
  by staff alone (owner-confirmed: a business cannot opt out of one)."""
import logging

from django.db import IntegrityError, OperationalError, connection, transaction
from django.db.models import Q
from django.utils import timezone

from activity import services as activity
from cart import guard
from listings.models import Listing
from notifications.services import notify_business_owner, notify_staff_role

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
ACCOUNT_SUSPENDED = "Your account is suspended, so it cannot ask for grouping."

logger = logging.getLogger(__name__)


def groupable(listing):
    """True for a product or food listing (cart.guard DELIVERABLE). Reads listing.category."""
    return guard.kind_of(listing) in guard.DELIVERABLE


def grouping_barcode(listing):
    """The listing's barcode when it may group (never a store's own code), else ""."""
    return "" if identity.is_store_code(listing.barcode) else listing.barcode


def _entry_id(raw):
    """The catalogue entry id a body names; ints and plain digit strings only (never bool, float, huge or odd input).
    Raises CatalogueError unknown_product."""
    if isinstance(raw, str) and raw.strip().isascii() and raw.strip().isdigit() and len(raw.strip()) <= 18:
        return int(raw.strip())
    if isinstance(raw, int) and not isinstance(raw, bool) and 0 < raw < 2**62:
        return raw
    raise CatalogueError(UNKNOWN_PRODUCT, "unknown_product")


def _entry(raw):
    try:
        return CatalogueProduct.objects.get(pk=_entry_id(raw))
    except CatalogueProduct.DoesNotExist:
        raise CatalogueError(UNKNOWN_PRODUCT, "unknown_product") from None


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
        listing = Listing.objects.select_for_update(of=("self",)).select_related("category", "business_owner").get(pk=listing.pk)
        if listing.business_owner.is_suspended:
            raise CatalogueError(ACCOUNT_SUSPENDED, "account_suspended", 403)
        if not groupable(listing):
            raise CatalogueError(NOT_GROUPABLE, "not_groupable")
        if listing.catalogue_product_id is not None:
            raise CatalogueError(ALREADY_GROUPED, "already_grouped", 409)
        if CatalogueAttachRequest.objects.filter(listing=listing, status=CatalogueAttachRequest.PENDING).exists():
            raise CatalogueError(REQUEST_PENDING, "request_pending", 409)
        barcode = grouping_barcode(listing)
        product, brand, name = None, "", ""
        if data.get("catalogue_product") not in (None, ""):
            product = _entry(data["catalogue_product"])
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
    try:
        notify_staff_role(
            "listings.moderate", NEEDS_REVIEW, "Catalogue grouping to review",
            body=f"“{listing.name}” asks to be grouped with {describe(request)}.", link="catalogue", icon="🏷️",
        )
    except Exception as exc:  # the request is committed; a notice failure must not turn it into a 500
        logger.warning("catalogue review notice failed: %s", type(exc).__name__)
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
        request.withdrawn_at = timezone.now()
        request.save(update_fields=["status", "withdrawn_at"])
    return request


def request_row(request):
    """A request as its business sees it (no staff names)."""
    return {
        "id": request.pk, "status": request.status, "source": request.source,
        "catalogue_product": product_row(request.catalogue_product),
        "brand": request.brand, "name": request.name, "barcode": request.barcode,
        "rejection_reason": request.rejection_reason, "created_at": request.created_at, "reviewed_at": request.reviewed_at,
        "withdrawn_at": request.withdrawn_at,
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


# --- Staff decisions (listings.moderate; the moderated-queue contract) ----------------------------------------------

GROUPED, NOT_GROUPED, UNGROUPED = "catalogue_grouped", "catalogue_not_grouped", "catalogue_ungrouped"
REASON_REQUIRED = "A reason is required."
NOT_REJECTED = "Only a rejected request can be sent back for re-review."
NOT_GROUPED_MESSAGE = "This listing is not grouped."
LISTING_NOT_FOUND = "Listing not found."
MATCH_LIMIT = 5
OWNER_SUSPENDED = "This business is suspended, so its listing cannot be grouped."
BARCODE_CHANGED = "The listing's barcode changed after it asked. Name the catalogue product to join, or reject."
MATCH_EXISTS = "A catalogue entry with this name already exists. Join it (catalogue_product) or send new=true."


def _locked_request(request_id):
    request = CatalogueAttachRequest.objects.select_for_update().filter(pk=request_id).first()
    if request is None:
        raise CatalogueError(NOT_FOUND, "not_found", 404)
    return request


def _product_for(request, listing, staff, data):
    """The entry the listing joins, and whether it was made now: the one staff name, else the one already named by the
    request, else the one holding the listing's barcode, else a new one from the request (staff may correct its brand
    and name). The listing's barcode is read now (approve refuses a change unless staff name the entry). A new entry
    whose normalised name already exists is refused (409 match_exists) unless staff send new=true; creation is
    serialised per name by an advisory lock so two approvals cannot both pass the check."""
    barcode = grouping_barcode(listing)
    product = request.catalogue_product
    if data.get("catalogue_product") not in (None, ""):
        product = _entry(data["catalogue_product"])
    if product is None and barcode:
        product = CatalogueProduct.objects.filter(barcode=barcode).first()
    if product is not None:
        if product.barcode and barcode and product.barcode != barcode:
            raise CatalogueError(BARCODE_MISMATCH, "barcode_mismatch", 409)
        return product, False
    brand = _text(data, "brand", request.brand, 100)
    name = _text(data, "name", request.name, 150)
    if not name:
        raise CatalogueError(NEEDS_NAME, "name_required")
    if not brand and not barcode:
        raise CatalogueError(NEEDS_BRAND, "brand_or_barcode_required")
    key = identity.normalise_name(brand, name)
    with connection.cursor() as cursor:
        cursor.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", ["catalogue:" + key])
    if data.get("new") is not True:
        found = list(CatalogueProduct.objects.filter(normalised_name=key).order_by("pk")[:MATCH_LIMIT])
        if found:
            raise CatalogueError(MATCH_EXISTS, "match_exists", 409, {"matches": [product_row(p) for p in found]})
    if barcode:
        # get_or_create: two approvals racing on one new barcode make one entry (the unique constraint decides).
        return CatalogueProduct.objects.get_or_create(
            barcode=barcode, defaults={"brand": brand, "name": name, "created_by": staff},
        )
    return CatalogueProduct.objects.create(brand=brand, name=name, created_by=staff), True


def _check_open(listing):
    """Under the listing lock: a listing staff may still group (not grouped, still goods, owner not suspended)."""
    if listing.catalogue_product_id is not None:
        raise CatalogueError(ALREADY_GROUPED, "already_grouped", 409)
    if not groupable(listing):
        raise CatalogueError(NOT_GROUPABLE, "not_groupable", 409)
    if listing.business_owner.is_suspended:
        raise CatalogueError(OWNER_SUSPENDED, "account_suspended", 409)


def approve(request_id, staff, data=None):
    """Group the request's listing. Locks the request, then the listing; re-checks both. Returns (request, product);
    raises CatalogueError (409 when it was decided already or the listing was grouped meanwhile)."""
    data = data or {}
    with transaction.atomic():
        request = _locked_request(request_id)
        if request.status != CatalogueAttachRequest.PENDING:
            raise CatalogueError(NOT_PENDING, "not_pending", 409)
        listing = (
            Listing.objects.select_for_update(of=("self",)).select_related("category", "business_owner")
            .get(pk=request.listing_id)
        )
        _check_open(listing)
        if data.get("catalogue_product") in (None, "") and grouping_barcode(listing) != request.barcode:
            raise CatalogueError(BARCODE_CHANGED, "barcode_changed", 409)
        product, created = _product_for(request, listing, staff, data)
        listing.catalogue_product = product
        listing.save(update_fields=["catalogue_product"])
        request.catalogue_product = product
        request.status = CatalogueAttachRequest.APPROVED
        request.rejection_reason = None
        request.reviewed_by = staff
        request.reviewed_at = timezone.now()
        request.save(update_fields=["catalogue_product", "status", "rejection_reason", "reviewed_by", "reviewed_at"])
        if created and product.barcode:
            # A new barcoded entry: other ungrouped listings carrying that barcode get a request to review (staff decide
            # each one; nothing is grouped here). Only after the whole approval has committed: filing a request
            # key-share-locks that listing, which must never wait on a checkout or another approval while this one
            # still holds its own listing row.
            transaction.on_commit(lambda: _match_after_commit(product), robust=True)
    notify_business_owner(
        listing.business_owner, GROUPED, "Listing grouped with other sellers",
        body=f"Your listing “{listing.name}” is now part of the catalogue entry {describe(request)}.",
        link="/business-dashboard", icon="🏷️",
    )
    return request, product


def reject(request_id, staff, reason):
    """Turn a waiting request down with a reason the business is told. Raises CatalogueError."""
    reason = (reason or "").strip()
    if not reason:
        raise CatalogueError(REASON_REQUIRED, "reason_required")
    with transaction.atomic():
        request = _locked_request(request_id)
        if request.status != CatalogueAttachRequest.PENDING:
            raise CatalogueError(NOT_PENDING, "not_pending", 409)
        request.status = CatalogueAttachRequest.REJECTED
        request.rejection_reason = reason[:500]
        request.reviewed_by = staff
        request.reviewed_at = timezone.now()
        request.save(update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at"])
    listing = request.listing
    if request.source == CatalogueAttachRequest.BACKFILL:
        return request  # AshantiHub's own barcode match: the business never asked, so it is not told it was turned down
    notify_business_owner(
        listing.business_owner, NOT_GROUPED, "Grouping not approved",
        body=f"“{listing.name}” stays on its own: {request.rejection_reason}", link="/business-dashboard", icon="⚠️",
    )
    return request


def re_review(request_id):
    """Send a rejected request back to pending, clearing the reason and the reviewer pair. Refused (409) while another
    request for the listing waits: one waits per listing. Locks the request, then the listing (as approve does)."""
    with transaction.atomic():
        request = _locked_request(request_id)
        if request.status != CatalogueAttachRequest.REJECTED:
            raise CatalogueError(NOT_REJECTED, "not_rejected")
        listing = (
            Listing.objects.select_for_update(of=("self",)).select_related("category", "business_owner")
            .get(pk=request.listing_id)
        )
        _check_open(listing)
        if CatalogueAttachRequest.objects.filter(
            listing_id=request.listing_id, status=CatalogueAttachRequest.PENDING,
        ).exists():
            raise CatalogueError(REQUEST_PENDING, "request_pending", 409)
        request.status = CatalogueAttachRequest.PENDING
        request.rejection_reason = None
        request.reviewed_by = None
        request.reviewed_at = None
        try:
            with transaction.atomic():
                request.save(update_fields=["status", "rejection_reason", "reviewed_by", "reviewed_at"])
        except IntegrityError:
            # The barcode matcher (it takes no listing lock) filed one meanwhile: one request waits per listing.
            raise CatalogueError(REQUEST_PENDING, "request_pending", 409) from None
    notify_staff_role(
        "listings.moderate", NEEDS_REVIEW, "Catalogue grouping re-opened",
        body=f"“{request.listing.name}” is waiting for a decision again.", link="catalogue", icon="🏷️",
    )
    return request


def detach(listing_id, reason, staff=None):
    """Ungroup a listing (staff only); the entry stays for the other offers. Raises CatalogueError."""
    reason = (reason or "").strip()
    if not reason:
        raise CatalogueError(REASON_REQUIRED, "reason_required")
    with transaction.atomic():
        listing = (
            Listing.objects.select_for_update(of=("self",)).select_related("catalogue_product", "business_owner")
            .filter(pk=listing_id).first()
        )
        if listing is None:
            raise CatalogueError(LISTING_NOT_FOUND, "not_found", 404)
        product = listing.catalogue_product
        if product is None:
            raise CatalogueError(NOT_GROUPED_MESSAGE, "not_grouped", 409)
        listing.catalogue_product = None
        listing.save(update_fields=["catalogue_product"])
        # Remember that staff took it out, so the barcode matcher does not file it for this entry again.
        CatalogueAttachRequest.objects.filter(
            listing=listing, catalogue_product=product, status=CatalogueAttachRequest.APPROVED, ungrouped_at__isnull=True,
        ).update(ungrouped_at=timezone.now(), ungrouped_by=staff)
        if staff is not None:
            activity.record(
                staff, "catalogue-staff-detach", target=listing, method="POST", summary=reason[:300],
                before={"catalogue_product": product.pk}, after={"catalogue_product": None},
            )
    notify_business_owner(
        listing.business_owner, UNGROUPED, "Listing ungrouped",
        body=f"“{listing.name}” no longer shows with other sellers of {product}: {reason[:500]}",
        link="/business-dashboard", icon="🏷️",
    )
    return listing


def matches(request, limit=MATCH_LIMIT):
    """Entries a reviewer should see before a new one is made: the same barcode, or the same normalised brand and name
    (exact only), apart from the entry the request already names."""
    name = identity.normalise_name(request.brand, request.name)
    condition = Q(normalised_name=name) if name else Q(pk__in=[])
    if request.barcode:
        condition |= Q(barcode=request.barcode)
    queryset = CatalogueProduct.objects.filter(condition)
    if request.catalogue_product_id:
        queryset = queryset.exclude(pk=request.catalogue_product_id)
    return list(queryset.order_by("pk")[:limit])


def matches_for(requests, limit=MATCH_LIMIT):
    """{request id: entries} for a page of pending requests in one query (the staff queue); as `matches`."""
    keys = {r.pk: (identity.normalise_name(r.brand, r.name), r.barcode)
            for r in requests if r.status == CatalogueAttachRequest.PENDING}
    names = sorted({name for name, _ in keys.values() if name})
    codes = sorted({code for _, code in keys.values() if code})
    if not names and not codes:
        return {}
    entries = list(CatalogueProduct.objects.filter(Q(normalised_name__in=names) | Q(barcode__in=codes)).order_by("pk"))
    found = {}
    for request in requests:
        if request.pk in keys:
            name, code = keys[request.pk]
            found[request.pk] = [
                e for e in entries if e.pk != request.catalogue_product_id
                and ((name and e.normalised_name == name) or (code and e.barcode == code))
            ][:limit]
    return found


def staff_row(request, found=None):
    """A request as the staff queue shows it: the listing (no contact details), the ask, and matches while pending
    (`found`: the entries `matches_for` worked out for a whole page; else looked up for this one request)."""
    listing = request.listing
    return {
        "id": request.pk, "status": request.status, "source": request.source,
        "brand": request.brand, "name": request.name, "barcode": request.barcode,
        "catalogue_product": product_row(request.catalogue_product),
        "rejection_reason": request.rejection_reason, "created_at": request.created_at,
        "reviewed_at": request.reviewed_at,
        "reviewed_by_name": request.reviewed_by.full_name if request.reviewed_by_id else None,
        "listing": {
            "id": listing.pk, "name": listing.name, "brand": listing.brand, "barcode": listing.barcode,
            "status": listing.status,
            "price_amount": None if listing.price_amount is None else str(listing.price_amount),
            "business_name": listing.business_owner.display_name,
            "business_suspended": listing.business_owner.is_suspended,
            "grouped_with": product_row(listing.catalogue_product),
        },
        "matches": (
            [product_row(p) for p in (found if found is not None else matches(request))]
            if request.status == CatalogueAttachRequest.PENDING else []
        ),
    }


# --- The barcode matcher (backfill; never groups) --------------------------------------------------------------------

TURNED_DOWN = (CatalogueAttachRequest.REJECTED, CatalogueAttachRequest.WITHDRAWN)
BATCH_SIZE = 500


def _declined(listing_ids):
    """{listing id: [(entry id, barcode)]} for requests staff or the business turned down (rejected or withdrawn) or whose
    grouping staff undid, for one chunk of listings in one query."""
    found = {}
    rows = (
        CatalogueAttachRequest.objects.filter(listing_id__in=listing_ids)
        .filter(Q(status__in=TURNED_DOWN) | Q(ungrouped_at__isnull=False))
        .values_list("listing_id", "catalogue_product_id", "barcode")
    )
    for listing_id, entry_id, barcode in rows:
        found.setdefault(listing_id, []).append((entry_id, barcode))
    return found


def _is_declined(declined, listing_id, entry):
    """A decision on this entry, or on this barcode (a new-entry request names no entry yet), is honoured."""
    return any(
        entry_id == entry.pk or (barcode and barcode == entry.barcode)
        for entry_id, barcode in declined.get(listing_id, ())
    )


def _file_match(listing_id, entry):
    """Lock the listing first (the order `propose` uses), re-check it, then file the request in a tiny transaction of its
    own. Returns "filed" or "skipped" (it changed, or a decision stands); raises IntegrityError/OperationalError."""
    with transaction.atomic():
        listing = (
            Listing.objects.select_for_update(of=("self",)).select_related("category", "business_owner")
            .filter(pk=listing_id).first()
        )
        if (
            listing is None or listing.catalogue_product_id is not None or listing.status != Listing.PUBLISHED
            or not groupable(listing) or listing.business_owner.is_suspended or listing.barcode != entry.barcode
            or CatalogueAttachRequest.objects.filter(listing=listing, status=CatalogueAttachRequest.PENDING).exists()
            or _is_declined(_declined([listing.pk]), listing.pk, entry)
        ):
            return "skipped"
        CatalogueAttachRequest.objects.create(
            listing=listing, catalogue_product=entry, barcode=listing.barcode, source=CatalogueAttachRequest.BACKFILL,
        )
    return "filed"


def propose_barcode_matches(product=None, *, dry_run=False, batch_size=BATCH_SIZE, stats=None):
    """File a backfill request for every ungrouped, published product or food listing whose barcode equals an entry's
    (every barcoded entry, or just `product`). Skipped: a store's own code, a suspended owner, a listing with a request
    waiting, and a listing with a rejected or withdrawn request, or a grouping staff undid, for that entry or that
    barcode. Never groups anything. Works in pk-ordered chunks of `batch_size` listings, each with fresh queries. Each
    request is filed under the listing's row lock in a tiny transaction of its own (as `propose` does); a lost race
    (IntegrityError on the one-pending constraint) or a rare deadlock (OperationalError) skips that listing, never
    raises. Returns how many were filed (or would be, with dry_run); `stats` (a dict) receives filed/skipped/raced/failed
    counts; tells listings.moderate holders once when any were filed."""
    stats = {} if stats is None else stats
    stats.update(filed=0, skipped=0, raced=0, failed=0)
    entries = CatalogueProduct.objects.exclude(barcode="")
    if product is not None:
        entries = entries.filter(pk=product.pk)
    last = 0
    while True:
        chunk = list(
            Listing.objects.filter(
                pk__gt=last, barcode__in=entries.values("barcode"), catalogue_product__isnull=True,
                status=Listing.PUBLISHED, business_owner__is_suspended=False,
            )
            .filter(guard.deliverable_q())
            .exclude(catalogue_requests__status=CatalogueAttachRequest.PENDING)
            .only("pk", "barcode").order_by("pk")[:batch_size]
        )
        if not chunk:
            break
        last = chunk[-1].pk
        by_barcode = {e.barcode: e for e in entries.filter(barcode__in={c.barcode for c in chunk})}
        declined = _declined([c.pk for c in chunk])
        for listing in chunk:
            entry = by_barcode.get(listing.barcode)
            if entry is None or identity.is_store_code(entry.barcode) or _is_declined(declined, listing.pk, entry):
                stats["skipped"] += 1
                continue
            if dry_run:
                stats["filed"] += 1
                continue
            try:
                stats[_file_match(listing.pk, entry)] += 1
            except IntegrityError:
                stats["raced"] += 1  # the business asked for this listing meanwhile: one request waits per listing
            except OperationalError as exc:  # a rare deadlock with another writer: skip, the next run retries
                stats["failed"] += 1
                logger.warning("catalogue barcode match skipped for listing %s: %s", listing.pk, type(exc).__name__)
    filed = stats["filed"]
    if filed and not dry_run:
        try:
            notify_staff_role(
                "listings.moderate", NEEDS_REVIEW, "Barcode matches to review",
                body=f"{filed} listing{'' if filed == 1 else 's'} share a barcode with a catalogue product.",
                link="catalogue", icon="🏷️",
            )
        except Exception as exc:  # the requests are committed; a notice failure must not fail the run
            logger.warning("catalogue barcode match notice failed: %s", type(exc).__name__)
    return filed


def _match_after_commit(product):
    """The on-commit hook of `approve`: never lets a matcher failure reach the approval (which has committed)."""
    try:
        propose_barcode_matches(product)
    except Exception as exc:
        logger.warning("catalogue barcode matching after approval failed: %s", type(exc).__name__)

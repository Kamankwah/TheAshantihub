"""Editing an approved listing: pending revisions.

An approved listing keeps serving its approved version. Only price, sale price and stock go live at once (LIVE_FIELDS,
through the `manage`, `restock` and variant-live endpoints). Every other change is saved as a `ListingRevision`, sent
to staff, and copied over in one transaction when they approve (`apply_revision`). The listing row is not touched
before that.

Variant operations (`ListingRevision.variants`, a JSON list; the owner screens and the staff panel use this shape):

    {"op": "add", "label": str (optional when attributes are sent), "attributes": {name: text} (at most 4),
     "price_amount": "25.00", "stock_quantity": int or null}
    {"op": "update", "id": <variant id>, "label"?: str, "attributes"?: {..}, "position"?: int}
    {"op": "remove", "id": <variant id>}

`update` never carries a price or stock (V7): an existing variant's price and stock are live edits and a revision
never touches them. `add` carries the new variant's first price and stock. Ids must be this listing's active variants.
The rules (at most 40 variants, active labels unique ignoring case, goods and food only) are checked against the
result the operations would produce. On apply: add creates, update changes label/attributes/position, remove switches
the row off (never deleted), then `variants.sync_listing`.

`diff(revision)` answers {"fields": {name: {"old", "new"}}, "media": {...}, "variants": [ops]} for the staff detail."""
from django.core.exceptions import ObjectDoesNotExist
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Max
from django.utils import timezone

from notifications.services import notify_business_owner, notify_staff_role

from . import pricing, variants
from .models import Listing, ListingPhoto, ListingRevision, ListingVariant

# Live at once, outside any revision (price, the live discount, stock).
LIVE_FIELDS = {"price_amount", "price_unit", "stock_quantity", "sale_price"}
# Every other editable field of OwnerListingSerializer; tests pin this against the serializer.
REVISABLE_FIELDS = {
    "category", "zone", "name", "description", "tag", "contact_phone", "lat", "lng", "specs", "service_duration",
    "units_total", "has_warranty", "warranty_details", "has_expiry", "expiry_date", "return_policy", "brand",
    "condition", "dimensions", "weight", "whats_included", "requirements", "revisions", "delivery_time", "barcode",
    "cancellation_policy",
}
# A revision applies to these; a dropped listing stays dropped.
REVISABLE_STATUSES = (Listing.PUBLISHED, Listing.DROPPED)
OWN_APPROVAL_MESSAGE = "You made this, so someone else must approve it."
LIVE_FIELD_MESSAGE = "Price and stock change at once; edit them with the price and stock controls."
NOT_REVISABLE_MESSAGE = "This field cannot be changed here."
WRONG_STATUS_MESSAGE = "Only a published or dropped listing is edited this way. Edit other listings directly."
OPEN_MESSAGE = "This edit is waiting for review."
NOTHING_MESSAGE = "There is nothing to send. Make a change first."
NO_VARIANTS_MESSAGE = "Only products and food can have variants."
VARIANT_OP_KEYS = {
    "add": {"op", "label", "attributes", "price_amount", "stock_quantity"},
    "update": {"op", "id", "label", "attributes", "position"},
    "remove": {"op", "id"},
}


class RevisionError(Exception):
    """A revision change the input or the listing's state does not allow. `payload` is the 400 body."""

    def __init__(self, message, field="detail"):
        super().__init__(message if isinstance(message, str) else str(message))
        self.payload = message if isinstance(message, dict) else {field: message}


def cannot_decide(staff, obj):
    """True when `staff` made `obj` (a listing or revision) and so must not approve it (maker-checker)."""
    return staff is not None and getattr(obj, "created_by_staff_id", None) is not None and obj.created_by_staff_id == staff.id


def open_revision(listing):
    """The listing's draft or pending revision, else its rejected one (edited again in place), else None."""
    rows = list(ListingRevision.objects.filter(listing=listing).exclude(status=ListingRevision.APPROVED).order_by("-id"))
    for row in rows:
        if row.status in (ListingRevision.DRAFT, ListingRevision.PENDING):
            return row
    return rows[0] if rows else None


# ── validation ──────────────────────────────────────────────────────────────────────────────────────────────────────


def _clean_changes(listing, owner, changes, adds_variants):
    """Validate `changes` the way an edit of the listing is validated; answer them as JSON-safe values."""
    from .serializers import OwnerListingSerializer

    if not isinstance(changes, dict):
        raise RevisionError("Send the changes as an object of field values.", "changes")
    errors = {}
    for key in changes:
        if key in LIVE_FIELDS:
            errors[key] = LIVE_FIELD_MESSAGE
        elif key not in REVISABLE_FIELDS:
            errors[key] = NOT_REVISABLE_MESSAGE
    if errors:
        raise RevisionError(errors)
    serializer = OwnerListingSerializer(
        listing, data=changes, partial=True,
        context={"owner": owner, "revising": True, "adds_variants": adds_variants},
    )
    if not serializer.is_valid():
        raise RevisionError(serializer.errors)
    clean = {}
    for key, value in serializer.validated_data.items():
        clean[key] = None if value is None else serializer.fields[key].to_representation(value)
    return clean


def _text_attributes(value):
    from .serializers import ListingVariantSerializer
    from rest_framework import serializers

    try:
        return ListingVariantSerializer().validate_attributes(value)
    except serializers.ValidationError as exc:
        raise RevisionError(" ".join(str(item) for item in exc.detail), "attributes") from None


def _label_for(label, attributes):
    label = (label or "").strip() if isinstance(label, (str, type(None))) else None
    if label is None:
        raise RevisionError("The name must be text.", "label")
    label = label or " / ".join(attributes.values())[:variants.MAX_LABEL]
    if len(label) > variants.MAX_LABEL:
        raise RevisionError(f"A name can have at most {variants.MAX_LABEL} characters.", "label")
    return label


def clean_variant_ops(listing, ops):
    """Validate the variant operations against the listing's active variants and the result they would produce.
    Answers the normalised operations (JSON-safe). Raises RevisionError."""
    if not isinstance(ops, list):
        raise RevisionError("Send the variant changes as a list.", "variants")
    current = {row.pk: row for row in variants.active(listing)}
    clean, seen = [], set()
    for position, op in enumerate(ops):
        where = f"variants[{position}]"
        if not isinstance(op, dict) or op.get("op") not in VARIANT_OP_KEYS:
            raise RevisionError("Each variant change needs op: add, update or remove.", where)
        kind = op["op"]
        extra = sorted(set(op) - VARIANT_OP_KEYS[kind])
        if extra:
            message = (
                "A variant's price and stock change at once with the price and stock controls."
                if kind == "update" and set(extra) & {"price_amount", "stock_quantity"}
                else f"Not allowed here: {extra[0]}."
            )
            raise RevisionError(message, where)
        if kind == "add":
            attributes = _text_attributes(op["attributes"]) if "attributes" in op else {}
            label = _label_for(op.get("label"), attributes)
            if not label:
                raise RevisionError("Give the variant a name or at least one attribute.", where)
            try:
                price = variants.positive_price(op.get("price_amount"))
                stock = None if op.get("stock_quantity") is None else variants._whole(op["stock_quantity"], "stock_quantity", 0, variants.MAX_STOCK)
            except variants.VariantError as exc:
                raise RevisionError(next(iter(exc.payload.values())), where) from None
            clean.append({
                "op": "add", "label": label, "attributes": attributes, "price_amount": str(price), "stock_quantity": stock,
            })
            continue
        target = op.get("id")
        if isinstance(target, bool) or not isinstance(target, int) or target not in current:
            raise RevisionError("That variant is not on this listing.", where)
        if target in seen:
            raise RevisionError("One variant can have only one change.", where)
        seen.add(target)
        if kind == "remove":
            clean.append({"op": "remove", "id": target})
            continue
        item = {"op": "update", "id": target}
        if "attributes" in op:
            item["attributes"] = _text_attributes(op["attributes"])
        if "label" in op:
            item["label"] = _label_for(op["label"], item.get("attributes", {}))
            if not item["label"]:
                raise RevisionError("The name cannot be empty.", where)
        if "position" in op:
            try:
                item["position"] = variants._whole(op["position"], "position", 0, variants.MAX_POSITION)
            except variants.VariantError as exc:
                raise RevisionError(next(iter(exc.payload.values())), where) from None
        clean.append(item)
    _check_result(current, clean)
    return clean


def _result_labels(current, ops):
    labels = {pk: row.label for pk, row in current.items()}
    for op in ops:
        if op["op"] == "remove":
            labels.pop(op["id"], None)
        elif op["op"] == "update" and "label" in op:
            labels[op["id"]] = op["label"]
    return list(labels.values()) + [op["label"] for op in ops if op["op"] == "add"]


def _check_result(current, ops):
    labels = _result_labels(current, ops)
    if len(labels) > variants.MAX_VARIANTS:
        raise RevisionError(f"A listing can have at most {variants.MAX_VARIANTS} variants.", "variants")
    lowered = [label.lower() for label in labels]
    if len(set(lowered)) != len(lowered):
        raise RevisionError("Two variants would have the same name.", "variants")


def _adds_variants(listing, ops):
    """True when the listing would have an active variant after `ops` (new ones added, or old ones kept)."""
    return bool(_result_labels({row.pk: row for row in variants.active(listing)}, ops))


def _clean_photo_ids(listing, ids):
    if not isinstance(ids, list) or any(isinstance(i, bool) or not isinstance(i, int) for i in ids):
        raise RevisionError("Send a list of photo ids.", "remove_photo_ids")
    ids = list(dict.fromkeys(ids))
    owned = set(ListingPhoto.objects.filter(listing=listing, pk__in=ids).values_list("pk", flat=True))
    if set(ids) - owned:
        raise RevisionError("That photo is not on this listing.", "remove_photo_ids")
    return ids


def _check_category_for_variants(listing, changes, ops):
    category = listing.category
    if "category" in changes:
        from .models import Category

        category = Category.objects.get(pk=changes["category"])
    if _adds_variants(listing, ops) and not pricing.sale_allowed(category):
        raise RevisionError(NO_VARIANTS_MESSAGE, "category")


def _validate(listing, owner, changes, ops):
    """The whole revision, checked together; answers (changes, ops)."""
    ops = clean_variant_ops(listing, ops)
    adds = _adds_variants(listing, ops)
    changes = _clean_changes(listing, owner, changes, adds)
    _check_category_for_variants(listing, changes, ops)
    return changes, ops


# ── the owner's side ─────────────────────────────────────────────────────────────────────────────────────────────────


def save_draft(listing, owner, data, *, new_main_photo=None, clear_main_photo=False, staff=None):
    """Create or update the listing's one open revision from the keys of `data` that were sent (changes, variants,
    remove_photo_ids, remove_video_ids). A rejected revision goes back to draft. Nothing here touches the listing."""
    with transaction.atomic():
        row = Listing.objects.select_for_update().get(pk=listing.pk)
        if row.status not in REVISABLE_STATUSES:
            raise RevisionError(WRONG_STATUS_MESSAGE, "status")
        revision = open_revision(row)
        if revision is not None and revision.status == ListingRevision.PENDING:
            raise RevisionError(OPEN_MESSAGE, "status")
        if revision is None:
            revision = ListingRevision(listing=row, created_by=owner if staff is None else None, created_by_staff=staff)
        changes = data.get("changes", revision.changes)
        ops = data.get("variants", revision.variants)
        changes, ops = _validate(row, owner, changes, ops)
        revision.changes, revision.variants = changes, ops
        if "remove_photo_ids" in data:
            revision.remove_photo_ids = _clean_photo_ids(row, data["remove_photo_ids"])
        if "remove_video_ids" in data:
            ids = data["remove_video_ids"]
            if not isinstance(ids, list) or any(isinstance(i, bool) or not isinstance(i, int) for i in ids):
                raise RevisionError("Send a list of video ids.", "remove_video_ids")
            revision.remove_video_ids = list(dict.fromkeys(ids))
        if new_main_photo is not None:
            from accounts.validators import validate_image_content_type

            try:
                validate_image_content_type(new_main_photo)
            except DjangoValidationError as exc:
                raise RevisionError(" ".join(exc.messages), "new_main_photo") from None
            _drop_staged_main_photo(revision)
            revision.new_main_photo = new_main_photo
        elif clear_main_photo:
            _drop_staged_main_photo(revision)
        if revision.status == ListingRevision.REJECTED:
            revision.status = ListingRevision.DRAFT
        revision.save()
    return revision


def _drop_staged_main_photo(revision):
    if revision.new_main_photo:
        revision.new_main_photo.delete(save=False)
        revision.new_main_photo = None


def is_empty(revision):
    """Nothing proposed. (Later tasks add staged photos and videos to what counts.)"""
    return not (
        revision.changes or revision.variants or revision.remove_photo_ids or revision.remove_video_ids
        or revision.new_main_photo
    )


def submit(revision):
    """Send a draft revision to staff. Re-checks it against the listing as it is now."""
    with transaction.atomic():
        row = Listing.objects.select_for_update().get(pk=revision.listing_id)
        revision = ListingRevision.objects.select_for_update().get(pk=revision.pk)
        if row.status not in REVISABLE_STATUSES:
            raise RevisionError(WRONG_STATUS_MESSAGE, "status")
        if revision.status == ListingRevision.PENDING:
            raise RevisionError(OPEN_MESSAGE, "status")
        if revision.status != ListingRevision.DRAFT:
            raise RevisionError("Change the edit first, then send it again.", "status")
        if is_empty(revision):
            raise RevisionError(NOTHING_MESSAGE)
        revision.changes, revision.variants = _validate(row, row.business_owner, revision.changes, revision.variants)
        revision.status = ListingRevision.PENDING
        revision.submitted_at = timezone.now()
        revision.rejection_reason = None
        revision.reviewed_by = None
        revision.reviewed_at = None
        revision.save()
    notify_staff_role(
        "listings.moderate", "listing_needs_moderation", "Listing edit for review",
        body=f"Changes to “{row.name}” have been submitted for approval.", link="moderation", icon="📋",
    )
    return revision


def discard(revision):
    """Throw an unsent or rejected revision away, with the files it staged."""
    with transaction.atomic():
        revision = ListingRevision.objects.select_for_update().get(pk=revision.pk)
        if revision.status == ListingRevision.PENDING:
            raise RevisionError(OPEN_MESSAGE, "status")
        _delete_staged(revision)
        revision.delete()


def delete_open(listing):
    """Delete the listing's draft and pending revisions with the files they staged (a discontinued listing is final)."""
    for revision in ListingRevision.objects.filter(listing=listing, status__in=(ListingRevision.DRAFT, ListingRevision.PENDING)):
        _delete_staged(revision)
        revision.delete()


def _delete_staged(revision):
    """The files a revision holds. Task 5 adds staged gallery photos and videos here."""
    _drop_staged_main_photo(revision)


# ── staff decisions ──────────────────────────────────────────────────────────────────────────────────────────────────


def apply_revision(revision, staff):
    """Copy a pending revision onto its listing in one transaction and mark it approved. The listing's status is
    unchanged (a dropped listing stays dropped). Existing variants' price and stock are never touched."""
    with transaction.atomic():
        listing = Listing.objects.select_for_update().get(pk=revision.listing_id)
        try:
            revision = ListingRevision.objects.select_for_update().get(pk=revision.pk)
        except ListingRevision.DoesNotExist:
            raise RevisionError("This edit is no longer there.", "status") from None
        if revision.status != ListingRevision.PENDING:
            raise RevisionError("Only a pending edit can be approved.", "status")
        if listing.status not in REVISABLE_STATUSES:
            raise RevisionError(WRONG_STATUS_MESSAGE, "status")
        # Checked again under the lock, with the rules used at save: the world may have moved since it was sent.
        try:
            revision.changes, ops = _validate(listing, listing.business_owner, revision.changes, revision.variants)
        except ObjectDoesNotExist:
            raise RevisionError("Part of this edit no longer exists. Ask the owner to edit and send it again.") from None
        _apply_changes(listing, revision)
        _apply_photos(listing, revision)
        _apply_variants(listing, ops)
        revision.status = ListingRevision.APPROVED
        revision.reviewed_by = staff
        revision.reviewed_at = timezone.now()
        revision.save()
    notify_business_owner(
        listing.business_owner, "listing_approved", "Changes published",
        body=(
            f"Your changes to “{listing.name}” are saved. They show once you restore it."
            if listing.status == Listing.DROPPED else f"Your changes to “{listing.name}” are now live."
        ),
        link="/business-dashboard", icon="✅",
    )
    return revision


def _apply_changes(listing, revision):
    fields = []
    for key, value in revision.changes.items():
        field = Listing._meta.get_field(key)
        if field.is_relation:
            setattr(listing, field.attname, value)
            fields.append(field.name)
        else:
            setattr(listing, key, None if value is None else field.to_python(value))
            fields.append(key)
    if revision.new_main_photo:
        old = listing.main_photo.name if listing.main_photo else None
        # The staged file becomes the listing's file; the revision lets go of it so it is not removed with the revision.
        listing.main_photo.name = revision.new_main_photo.name
        revision.new_main_photo = None
        fields.append("main_photo")
        if old and old != listing.main_photo.name:
            storage = Listing._meta.get_field("main_photo").storage
            transaction.on_commit(lambda: storage.delete(old))
    if fields:
        listing.save(update_fields=[*fields, "updated_at"])


def _apply_photos(listing, revision):
    if revision.remove_photo_ids:
        ListingPhoto.objects.filter(listing=listing, pk__in=revision.remove_photo_ids).delete()


def _apply_variants(listing, ops):
    if not ops:
        return
    rows = {row.pk: row for row in ListingVariant.objects.select_for_update().filter(listing=listing, is_active=True).order_by("pk")}
    top = listing.variants.aggregate(top=Max("position"))["top"]
    next_position = 0 if top is None else top + 1
    for op in ops:
        if op["op"] == "add":
            ListingVariant.objects.create(
                listing=listing, label=op["label"], attributes=op["attributes"],
                price_amount=pricing.dec(op["price_amount"]), stock_quantity=op["stock_quantity"], position=next_position,
            )
            next_position += 1
            continue
        row = rows.get(op["id"])
        if row is None:
            continue
        if op["op"] == "remove":
            row.is_active = False
            row.save(update_fields=["is_active"])
        else:
            fields = [key for key in ("label", "attributes", "position") if key in op]
            for key in fields:
                setattr(row, key, op[key])
            row.save(update_fields=fields)
    variants.sync_listing(listing)


def reject_revision(revision, staff, reason):
    with transaction.atomic():
        revision = ListingRevision.objects.select_for_update().select_related("listing__business_owner").get(pk=revision.pk)
        if revision.status != ListingRevision.PENDING:
            raise RevisionError("Only a pending edit can be rejected.", "status")
        revision.status = ListingRevision.REJECTED
        revision.rejection_reason = reason
        revision.reviewed_by = staff
        revision.reviewed_at = timezone.now()
        revision.save()
    notify_business_owner(
        revision.listing.business_owner, "listing_rejected", "Listing edit needs changes",
        body=f"Your changes to “{revision.listing.name}” were not approved: {reason}", link="/business-dashboard", icon="⚠️",
    )
    return revision


def re_review(revision):
    with transaction.atomic():
        revision = ListingRevision.objects.select_for_update().select_related("listing").get(pk=revision.pk)
        if revision.status != ListingRevision.REJECTED:
            raise RevisionError("Only a rejected edit can be sent back for re-review.")
        if revision.listing.status not in REVISABLE_STATUSES:
            raise RevisionError(WRONG_STATUS_MESSAGE, "status")
        revision.status = ListingRevision.PENDING
        revision.rejection_reason = None
        revision.reviewed_by = None
        revision.reviewed_at = None
        revision.save()
    notify_staff_role(
        "listings.moderate", "listing_needs_moderation", "Listing edit re-opened for review",
        body=f"Changes to “{revision.listing.name}” need review again.", link="moderation", icon="📋",
    )
    return revision


# ── what staff see ───────────────────────────────────────────────────────────────────────────────────────────────────


def _url(request, file):
    if not file:
        return None
    return request.build_absolute_uri(file.url) if request is not None else file.url


def diff(revision, request=None):
    """{"fields": {name: {"old", "new"}} (changed scalar fields only), "media": {...}, "variants": [ops]}."""
    from .serializers import OwnerListingSerializer

    listing = revision.listing
    fields = OwnerListingSerializer().fields
    changed = {}
    for key, new in revision.changes.items():
        value = getattr(listing, key)
        old = None if value is None else fields[key].to_representation(value)
        if old != new:
            changed[key] = {"old": old, "new": new}
    removed = ListingPhoto.objects.filter(listing=listing, pk__in=revision.remove_photo_ids)
    names = {row.pk: row.label for row in variants.active(listing)}
    ops = [{**op, "current_label": names.get(op.get("id"))} if "id" in op else op for op in revision.variants]
    return {
        "fields": changed,
        "media": {
            "current_main_photo": _url(request, listing.main_photo),
            "new_main_photo": _url(request, revision.new_main_photo),
            "remove_photos": [{"id": photo.pk, "image": _url(request, photo.image)} for photo in removed],
            "remove_video_ids": list(revision.remove_video_ids),
        },
        "variants": ops,
    }

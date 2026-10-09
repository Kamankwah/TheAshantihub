"""Scout-proposed changes (staff phase 2A, spec S4).

A scout who is a business's account manager proposes a change to its details
(`business.update`), a new product or service (`listing.create`) or photos for
an existing listing (`listing.photos`). Each goes through the approvals engine
to the scout's Operations lead; `apply` makes the change inside the decision's
transaction, writes an AppliedChange the owner can undo for 7 days
(portfolio.undo) and tells the owner. Photos are staged first (StagedPhoto)
and copied onto the listing only when the change applies.

Validation runs twice: when the scout proposes (so they see problems before
Operations does) and again when Operations approves (the business may have
changed since). Payout details are never editable here.
"""
import json
import math
import os
from datetime import timedelta
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.base import ContentFile
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError

from accounts.gps import validate_ashanti_gps
from accounts.models import BusinessOwner, BusinessOwnerProfile, StaffUser
from accounts.phones import normalize_gh_phone
from activity.services import record
from approvals.services import ApprovalError, submit
from billing.clock import subscription_state
from listings.models import Category, Listing, ListingPhoto, Zone
from listings.serializers import LISTING_DECISION_FIELDS, PRODUCT_ANSWER_MESSAGES, validate_listing_for_owner
from notifications.services import notify_business_owner

from .checks import exact_duplicates, staff_phone_matches
from .models import AppliedChange, StagedPhoto

BUSINESS_UPDATE_KEY = "business.update"
LISTING_CREATE_KEY = "listing.create"
LISTING_PHOTOS_KEY = "listing.photos"

UNDO_WINDOW = timedelta(days=7)
MAX_PHOTOS = 8  # the scout canvas: "up to 8"
MAX_PIN_ACCURACY_M = 100
GHANA_LAT = (Decimal("4.5"), Decimal("11.2"))
GHANA_LNG = (Decimal("-3.3"), Decimal("1.3"))
SIX_PLACES = Decimal("0.000001")

EDITABLE_FIELDS = (
    "full_name", "login_phone", "email", "business_name", "business_contact_phone", "gps_address",
    "lat", "lng", "location_accuracy_m", "location_is_manual", "zone_id", "business_description",
    "opening_hours",
)
OWNER_FIELDS = ("full_name", "login_phone", "email")  # on BusinessOwner; the rest are on its profile
PIN_FIELDS = ("lat", "lng", "location_accuracy_m", "location_is_manual")  # always proposed together
PHONE_FIELDS = ("login_phone", "business_contact_phone")

FIELD_LABELS = {
    "full_name": "Owner's name",
    "login_phone": "Sign-in phone",
    "email": "Email",
    "business_name": "Business name",
    "business_contact_phone": "Business phone",
    "gps_address": "Ghana Post address",
    "lat": "Pin latitude",
    "lng": "Pin longitude",
    "location_accuracy_m": "Pin accuracy (metres)",
    "location_is_manual": "Pin placed by hand",
    "zone_id": "Area",
    "business_description": "Description",
    "opening_hours": "Opening hours",
}
SUMMARY_WORDS = {
    "full_name": "owner's name",
    "login_phone": "sign-in phone",
    "email": "email",
    "business_name": "business name",
    "business_contact_phone": "business phone",
    "gps_address": "Ghana Post address",
    "lat": "map pin",
    "lng": "map pin",
    "location_accuracy_m": "map pin",
    "location_is_manual": "map pin",
    "zone_id": "area",
    "business_description": "description",
    "opening_hours": "opening hours",
}

PROPOSED_LISTING_FIELDS = (
    "category", "zone", "name", "description", "price_amount", "price_unit", "tag", "contact_phone",
    "lat", "lng", "specs", "service_duration", "units_total", *LISTING_DECISION_FIELDS,
)
LISTING_LABELS = (
    ("name", "Name"), ("category", "Category"), ("zone", "Area"), ("description", "Description"),
    ("price_amount", "Price (GH₵)"), ("price_unit", "Price per"), ("tag", "Tag"), ("contact_phone", "Contact phone"),
    ("brand", "Brand"), ("condition", "Condition"), ("stock_quantity", "In stock"), ("dimensions", "Size"),
    ("weight", "Weight"), ("has_warranty", "Warranty"), ("warranty_details", "Warranty details"),
    ("has_expiry", "Can expire"), ("expiry_date", "Expiry date"), ("return_policy", "Return policy"),
    ("service_duration", "How long it takes"), ("whats_included", "What's included"),
    ("requirements", "What the customer provides"), ("revisions", "Revisions"), ("delivery_time", "Delivery time"),
    ("units_total", "Rooms or units"), ("specs", "Specs"), ("lat", "Pin latitude"), ("lng", "Pin longitude"),
)

NOT_ACCOUNT_MANAGER = "Only the business's account manager can propose changes."
PAYOUT_MESSAGE = "Payout details can't be changed by scouts. The owner changes them in their dashboard."
NOT_EDITABLE = "This detail can't be changed here."
NO_FIELDS = "Choose at least one detail to change."
NOTHING_CHANGED = "Nothing changed — these are already the business's details."
REASON_REQUIRED = "Say why — the approver sees it."
DUPLICATE_PHONE = "Another business already uses this phone number — ask Operations."
DUPLICATE_GPS = "Another business already has this Ghana Post address — ask Operations."
DUPLICATE_EMAIL = "That email already belongs to another account."
KYC_FIRST = "Approve the business's KYC first."
SUBSCRIPTION_PAUSED = (
    "The business's subscription is paused — the owner renews it in the app before new products can go live."
)
SUBSCRIPTION_INACTIVE = (
    "The business's subscription isn't active — the owner renews it in the app before new products can go live."
)
LISTING_LIMIT = "The business has reached its plan's listing limit — the owner can upgrade their plan in the app."
PHOTOS_UNAVAILABLE = "Some of these photos are missing or already used — take them again."
TOO_MANY_PHOTOS = f"Add up to {MAX_PHOTOS} photos at a time."
NO_PHOTOS = "Add at least one photo."
LISTING_MOVED = "This listing isn't this business's any more."
STAFF_PHONE = "That number belongs to a staff member — ask Operations."
STAFF_EMAIL = "That email belongs to a staff member — ask Operations."
OWNER_HAS_LOGIN = {
    "email": "Sign-in email is changed by the owner once they have a login.",
    "login_phone": "Sign-in phone is changed by the owner once they have a login.",
}
UNDO_HINT = "Not you? Press “This wasn't me” in your dashboard within 7 days."


class _Invalid(Exception):
    """One field's value is wrong; the message is shown under that field."""


# ── Small shared helpers (portfolio.undo uses several) ──────────────────────

def jsonable(value):
    """The JSON form the approvals engine stores payloads and snapshots in
    (the same round trip as approvals.services._normalise), so values read
    from the database compare equal to values stored in a request."""
    return json.loads(json.dumps(value, default=str, sort_keys=True))


def first_message(errors):
    """The first human message in a DRF-style error dict."""
    for value in errors.values():
        while isinstance(value, (list, tuple)) and value:
            value = value[0]
        if isinstance(value, dict):
            return first_message(value)
        if value:
            return str(value)
    return "This change can't be applied."


def ordered_fields(fields):
    return [field for field in EDITABLE_FIELDS if field in fields]


def join_words(words):
    if len(words) <= 1:
        return "".join(words)
    return f"{', '.join(words[:-1])} and {words[-1]}"


def summary_words(fields):
    words = []
    for field in ordered_fields(fields):
        if SUMMARY_WORDS[field] not in words:
            words.append(SUMMARY_WORDS[field])
    return join_words(words)


def current_value(owner, profile, field):
    return getattr(owner, field) if field in OWNER_FIELDS else getattr(profile, field)


def model_value(field, value):
    """A stored (JSON) value back in the form the model field takes."""
    if field in ("lat", "lng") and value is not None:
        return Decimal(str(value))
    return value


def _owner_target_type():
    return BusinessOwner._meta.label_lower


def _fresh(owner):
    return BusinessOwner.objects.select_related("profile").get(pk=owner.pk)


def _require_account_manager(staff, owner):
    if owner.account_manager_id != staff.pk:
        raise PermissionDenied(NOT_ACCOUNT_MANAGER)


def _require_reason(reason):
    text = "" if reason is None else str(reason).strip()
    if not text:
        raise ValidationError({"reason": [REASON_REQUIRED]})
    return text[:500]


def _photo_count(count):
    return f"{count} photo{'s' if count != 1 else ''}"


# ── Photos ──────────────────────────────────────────────────────────────────

def _taken_coordinate(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or abs(number) > 180:
        return None
    return Decimal(str(number)).quantize(SIX_PLACES)


def _taken_accuracy(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or number < 0:
        return None
    return int(round(number))


def stage_photo(business_owner, staff, image, *, lat=None, lng=None, accuracy_m=None):
    """Keep one photo the account manager took (server time, and where the
    phone said it was taken) until a proposal uses it. The caller checks who
    may stage and records the event."""
    return StagedPhoto.objects.create(
        business_owner=business_owner, uploaded_by=staff, image=image,
        taken_lat=_taken_coordinate(lat), taken_lng=_taken_coordinate(lng),
        taken_accuracy_m=_taken_accuracy(accuracy_m),
    )


def _photo_id_list(value, field):
    if value in (None, ""):
        return []
    if not isinstance(value, (list, tuple)):
        raise ValidationError({field: ["Send the photos as a list."]})
    ids = []
    for item in value:
        try:
            pk = int(item)
        except (TypeError, ValueError):
            raise ValidationError({field: ["Send the photos as a list."]})
        if pk not in ids:
            ids.append(pk)
    return ids


def _one_photo_id(value, field):
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValidationError({field: ["Choose one of the photos you took."]})


def photo_errors(owner, ids, field="photo_ids"):
    """Every id must be an unused staged photo of this business."""
    if not ids:
        return {}
    usable = set(
        StagedPhoto.objects.filter(pk__in=ids, business_owner=owner, used_at__isnull=True).values_list("pk", flat=True)
    )
    return {} if usable >= set(ids) else {field: [PHOTOS_UNAVAILABLE]}


def _locked_staged(owner, ids):
    rows = {
        photo.pk: photo
        for photo in StagedPhoto.objects.select_for_update().filter(
            pk__in=ids, business_owner=owner, used_at__isnull=True
        )
    }
    if set(ids) - set(rows):
        raise ApprovalError(PHOTOS_UNAVAILABLE)
    return rows


def _copy_image(source, target):
    """Copy a staged photo into a listing's image field as a new file (the
    HeroSubmitView pattern), so the two records stay independent."""
    source.open("rb")
    try:
        target.save(os.path.basename(source.name), ContentFile(source.read()), save=False)
    finally:
        source.close()


def _image_urls(ids):
    by_pk = {photo.pk: photo for photo in StagedPhoto.objects.filter(pk__in=ids)}
    return [by_pk[pk].image.url for pk in ids if pk in by_pk]


# ── Applying (shared by the three kinds) ────────────────────────────────────

def _applied(approval, owner, *, summary, result, applied_at):
    return AppliedChange.objects.create(
        approval=approval, business_owner=owner, kind=approval.kind, summary=summary[:200],
        applied_at=applied_at, undo_until=applied_at + UNDO_WINDOW, result=result,
    )


def _tell_owner(owner, approval, what, body):
    notify_business_owner(
        owner, "account_manager_change", f"Your account manager {approval.maker.full_name} {what}"[:200],
        body=body, link="/business-dashboard", icon="🧑‍💼",
    )


# ── business.update ─────────────────────────────────────────────────────────

def _text(value, *, max_length, required):
    text = "" if value is None else str(value).strip()
    if required and not text:
        raise _Invalid("This can't be empty.")
    if len(text) > max_length:
        raise _Invalid(f"Keep this under {max_length} characters.")
    return text


def _phone(value):
    try:
        return normalize_gh_phone("" if value is None else str(value))
    except ValueError as exc:
        raise _Invalid(str(exc))


def _email(value):
    text = "" if value is None else str(value).strip()
    if not text:
        return None
    try:
        validate_email(text)
    except DjangoValidationError:
        raise _Invalid("Enter a valid email address.")
    return text


def _gps(value):
    try:
        return validate_ashanti_gps(value)
    except ValidationError as exc:
        raise _Invalid(str(exc.detail[0]))


def _zone(value):
    try:
        pk = int(value)
    except (TypeError, ValueError):
        raise _Invalid("Choose an area from the list.")
    if not Zone.objects.filter(pk=pk).exists():
        raise _Invalid("Choose an area from the list.")
    return pk


_CLEANERS = {
    "full_name": lambda value: _text(value, max_length=150, required=True),
    "login_phone": _phone,
    "email": _email,
    "business_name": lambda value: _text(value, max_length=150, required=True),
    "business_contact_phone": _phone,
    "gps_address": _gps,
    "zone_id": _zone,
    "business_description": lambda value: _text(value, max_length=2000, required=False),
    "opening_hours": lambda value: _text(value, max_length=120, required=False),
}


def _coordinate(value, low, high, label):
    try:
        number = Decimal(str(value))
        if not number.is_finite():
            raise InvalidOperation
        number = number.quantize(SIX_PLACES)  # raises InvalidOperation for absurdly large numbers
    except (InvalidOperation, ValueError, TypeError):
        raise _Invalid(f"Enter the pin's {label} as a number.")
    if not (low <= number <= high):
        raise _Invalid("That pin isn't in Ghana — check the location and try again.")
    return str(number)


def _boolean(value):
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    text = str(value).strip().lower()
    if text in ("true", "1", "yes"):
        return True
    if text in ("false", "0", "no", ""):
        return False
    raise _Invalid("Answer yes or no.")


def _accuracy(value):
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise _Invalid("Enter the accuracy in metres.")
    if not math.isfinite(number) or number < 0 or number > 100000:
        raise _Invalid("Enter the accuracy in metres.")
    return int(round(number))


def _clean_pin(fields):
    """A pin change always carries all four PIN_FIELDS (lat, lng, accuracy,
    placed-by-hand). A pin worse than 100 m is refused unless placed by hand."""
    if "lat" not in fields or "lng" not in fields:
        return {}, {"lat": ["Send both latitude and longitude for the pin."]}
    pin, errors = {}, {}
    for key, low, high, label in (("lat", *GHANA_LAT, "latitude"), ("lng", *GHANA_LNG, "longitude")):
        try:
            pin[key] = _coordinate(fields[key], low, high, label)
        except _Invalid as exc:
            errors[key] = [str(exc)]
    try:
        manual = _boolean(fields.get("location_is_manual", False))
    except _Invalid as exc:
        errors["location_is_manual"] = [str(exc)]
        manual = False
    try:
        accuracy = _accuracy(fields.get("location_accuracy_m"))
    except _Invalid as exc:
        errors["location_accuracy_m"] = [str(exc)]
        accuracy = None
    if not manual and "location_accuracy_m" not in errors:
        if accuracy is None:
            errors["location_accuracy_m"] = ["Take the pin from the phone's location, or place it by hand."]
        elif accuracy > MAX_PIN_ACCURACY_M:
            errors["location_accuracy_m"] = [
                f"Location too rough: ±{accuracy} m. Try again, or place the pin by hand."
            ]
    pin["location_accuracy_m"] = accuracy
    pin["location_is_manual"] = manual
    return pin, errors


def _only_changes(owner, profile, cleaned):
    def same(field):
        return jsonable(current_value(owner, profile, field)) == jsonable(cleaned[field])

    pin_moved = any(field in cleaned and not same(field) for field in PIN_FIELDS)
    changed = {}
    for field in ordered_fields(cleaned):
        if field in PIN_FIELDS:
            if pin_moved:
                changed[field] = cleaned[field]
        elif not same(field):
            changed[field] = cleaned[field]
    return changed


def clean_update_fields(owner, fields):
    """Check and normalise a scout's proposed detail changes (phones to
    +233…, Ghana Post code upper-cased, coordinates to 6 places). Returns only
    the fields that actually change; raises ValidationError with per-field
    messages."""
    if not isinstance(fields, dict) or not fields:
        raise ValidationError({"fields": [NO_FIELDS]})
    errors = {}
    for key in fields:
        if str(key).startswith("payout_") or key == "default_payout_method":
            errors[key] = [PAYOUT_MESSAGE]
        elif key not in EDITABLE_FIELDS:
            errors[key] = [NOT_EDITABLE]
    if errors:
        raise ValidationError(errors)
    cleaned = {}
    for key in ordered_fields(fields):
        if key in PIN_FIELDS:
            continue
        try:
            cleaned[key] = _CLEANERS[key](fields[key])
        except _Invalid as exc:
            errors[key] = [str(exc)]
    if any(key in fields for key in PIN_FIELDS):
        pin, pin_errors = _clean_pin(fields)
        errors.update(pin_errors)
        cleaned.update(pin)
    if errors:
        raise ValidationError(errors)
    changed = _only_changes(owner, owner.profile, cleaned)
    if not changed:
        raise ValidationError({"fields": [NOTHING_CHANGED]})
    return changed


def update_duplicate_errors(owner, fields):
    """The checks a detail change re-runs at proposal and approval: sign-in
    details only before the owner has a login, then duplicates, then staff
    emails and phones (self-dealing)."""
    errors = {}
    if not owner.needs_claim:
        for field, message in OWNER_HAS_LOGIN.items():
            if field in fields:
                errors[field] = [message]
    for field in PHONE_FIELDS:
        if field in errors or not fields.get(field):
            continue
        if exact_duplicates(phone=fields[field], exclude_owner_id=owner.pk):
            errors[field] = [DUPLICATE_PHONE]
        elif staff_phone_matches(fields[field]):
            errors[field] = [STAFF_PHONE]
    if fields.get("gps_address") and exact_duplicates(gps_address=fields["gps_address"], exclude_owner_id=owner.pk):
        errors["gps_address"] = [DUPLICATE_GPS]
    if fields.get("email") and "email" not in errors:
        if BusinessOwner.objects.filter(email__iexact=fields["email"]).exclude(pk=owner.pk).exists():
            errors["email"] = [DUPLICATE_EMAIL]
        elif StaffUser.objects.filter(email__iexact=fields["email"]).exists():
            errors["email"] = [STAFF_EMAIL]
    return errors


def propose_update(scout, owner, fields, *, reason, http_request=None):
    owner = _fresh(owner)
    _require_account_manager(scout, owner)
    reason = _require_reason(reason)
    cleaned = clean_update_fields(owner, fields)
    errors = update_duplicate_errors(owner, cleaned)
    if errors:
        raise ValidationError(errors)
    words = summary_words(cleaned)
    with transaction.atomic():
        approval = submit(
            scout, BUSINESS_UPDATE_KEY, title=f"Change {words} — {owner.display_name}",
            payload={"business_owner_id": owner.pk, "reason": reason, "fields": cleaned},
            target_type=_owner_target_type(), target_id=str(owner.pk), target_label=owner.display_name,
            maker_note=reason, request=http_request,
        )
        record(scout, "business.change_proposed", target=owner,
               after={"approval_id": approval.pk, "kind": BUSINESS_UPDATE_KEY, "fields": list(cleaned)},
               request=http_request)
    return approval


def _owner_and_profile(owner_id):
    profile = BusinessOwnerProfile.objects.select_related("business_owner").get(business_owner_id=owner_id)
    return profile.business_owner, profile


def update_state(approval):
    owner, profile = _owner_and_profile(approval.payload["business_owner_id"])
    return {field: current_value(owner, profile, field) for field in approval.payload.get("fields") or {}}


def validate_update(approval):
    owner = BusinessOwner.objects.get(pk=approval.payload["business_owner_id"])
    errors = update_duplicate_errors(owner, approval.payload.get("fields") or {})
    if errors:
        raise ApprovalError(first_message(errors))


def apply_update(approval):
    payload = approval.payload
    owner = BusinessOwner.objects.select_for_update().get(pk=payload["business_owner_id"])
    profile = BusinessOwnerProfile.objects.select_for_update().get(business_owner=owner)
    fields = payload.get("fields") or {}
    now = timezone.now()
    result = {}
    owner_fields, profile_fields = [], []
    if any(field in fields for field in PIN_FIELDS):
        # Kept so an undo can put the pin's "set by" back too.
        result = {
            "location_set_by_before": profile.location_set_by,
            "location_set_at_before": profile.location_set_at.isoformat() if profile.location_set_at else None,
        }
        profile.location_set_by = "scout"
        profile.location_set_at = now
        profile_fields += ["location_set_by", "location_set_at"]
    if "gps_address" in fields:
        # The address decision was about the old address; a new one needs its
        # own (a scout business can't be KYC-approved without it). Kept so an
        # undo can put the decision back with the address.
        result.update({
            "address_verified_before": profile.address_verified,
            "address_verified_by_id_before": profile.address_verified_by_id,
            "address_verified_at_before": profile.address_verified_at.isoformat() if profile.address_verified_at else None,
        })
        profile.address_verified = False
        profile.address_verified_by = None
        profile.address_verified_at = None
        profile_fields += ["address_verified", "address_verified_by", "address_verified_at"]
    for field in ordered_fields(fields):
        value = model_value(field, fields[field])
        if field in OWNER_FIELDS:
            setattr(owner, field, value)
            owner_fields.append(field)
        else:
            setattr(profile, field, value)
            profile_fields.append(field)
    if owner_fields:
        owner.save(update_fields=owner_fields)
    if profile_fields:
        profile.save(update_fields=profile_fields)
    words = summary_words(fields)
    _applied(approval, owner, summary=f"Changed {words}", result=result, applied_at=now)
    _tell_owner(owner, approval, f"changed your {words}", f"Approved by AshantiHub Operations. {UNDO_HINT}")


def _shown(field, value):
    if field == "zone_id":
        return Zone.objects.filter(pk=value).values_list("name", flat=True).first() if value else None
    if field == "location_is_manual":
        return "Yes" if value else "No"
    return value


def update_diff(approval):
    fields = approval.payload.get("fields") or {}
    before = approval.before if isinstance(approval.before, dict) else {}
    return [
        {"field": FIELD_LABELS[field], "before": _shown(field, before.get(field)), "after": _shown(field, fields[field])}
        for field in ordered_fields(fields)
    ]


# ── listing.create ──────────────────────────────────────────────────────────

class ProposedListingSerializer(serializers.ModelSerializer):
    """The shape of a listing a scout proposes: the owner form's fields minus
    photos (staged separately) and status (the approval publishes it)."""

    class Meta:
        model = Listing
        fields = list(PROPOSED_LISTING_FIELDS)
        extra_kwargs = {"contact_phone": {"required": False}, "units_total": {"required": False}}


def _scout_wording(owner, detail):
    if not isinstance(detail, dict):
        return {"listing": detail if isinstance(detail, list) else [detail]}
    errors = {}
    for key, value in detail.items():
        if key == "subscription":
            errors[key] = [SUBSCRIPTION_INACTIVE]
        elif key == "max_active_listings":
            errors[key] = [LISTING_LIMIT]
        elif key == "category":
            errors[key] = [f"This business is registered for {owner.profile.business_kind} listings only."]
        else:
            errors[key] = value if isinstance(value, list) else [value]
    return errors


def check_listing(owner, listing):
    """(validated_data, errors) for a listing this business would add now:
    KYC approved, subscription not paused, then the owner's own listing rules
    (listings.serializers.validate_listing_for_owner) in scout wording."""
    if owner.kyc_status != BusinessOwner.VERIFIED:
        return None, {"business": [KYC_FIRST]}
    if subscription_state(getattr(owner, "subscription", None))["state"] == "paused":
        return None, {"subscription": [SUBSCRIPTION_PAUSED]}
    serializer = ProposedListingSerializer(data=listing)
    if not serializer.is_valid():
        return None, dict(serializer.errors)
    data = dict(serializer.validated_data)
    if data.get("contact_phone") and staff_phone_matches(data["contact_phone"]):
        return None, {"contact_phone": [STAFF_PHONE]}
    try:
        validate_listing_for_owner(owner, data, initial_data=listing)
    except ValidationError as exc:
        return None, _scout_wording(owner, exc.detail)
    return data, {}


def _listing_photo_ids(payload):
    main_id = payload.get("main_photo_id")
    return ([main_id] if main_id else []) + [pk for pk in payload.get("photo_ids") or [] if pk != main_id]


def propose_listing(scout, owner, listing_data, *, main_photo_id, photo_ids, reason, http_request=None):
    owner = _fresh(owner)
    _require_account_manager(scout, owner)
    reason = _require_reason(reason)
    if not isinstance(listing_data, dict):
        raise ValidationError({"listing": ["Send the product's details."]})
    listing = {key: listing_data[key] for key in PROPOSED_LISTING_FIELDS if key in listing_data}
    if listing.get("contact_phone") not in (None, ""):
        # Stored +233… like every phone this plan writes; check_listing then
        # refuses a staff member's number, now and again at approval.
        try:
            listing["contact_phone"] = _phone(listing["contact_phone"])
        except _Invalid as exc:
            raise ValidationError({"contact_phone": [str(exc)]})
    main_id = _one_photo_id(main_photo_id, "main_photo_id")
    gallery = _photo_id_list(photo_ids, "photo_ids")
    every_photo = _listing_photo_ids({"main_photo_id": main_id, "photo_ids": gallery})
    if len(every_photo) > MAX_PHOTOS:
        raise ValidationError({"photo_ids": [TOO_MANY_PHOTOS]})
    data, errors = check_listing(owner, listing)
    if not errors:
        errors = photo_errors(owner, every_photo)
    if errors:
        raise ValidationError(errors)
    word = "service" if data["category"].kind == Category.SERVICE else "product"
    with transaction.atomic():
        approval = submit(
            scout, LISTING_CREATE_KEY, title=f"New {word}: {data['name']} — {owner.display_name}",
            payload={
                "business_owner_id": owner.pk, "reason": reason, "listing": listing,
                "main_photo_id": main_id, "photo_ids": gallery,
            },
            target_type=_owner_target_type(), target_id=str(owner.pk), target_label=owner.display_name,
            maker_note=reason, request=http_request,
        )
        record(scout, "business.change_proposed", target=owner,
               after={"approval_id": approval.pk, "kind": LISTING_CREATE_KEY, "listing_name": data["name"],
                      "photos": len(every_photo)},
               request=http_request)
    return approval


def listing_create_state(approval):
    return {"business_owner_id": BusinessOwner.objects.get(pk=approval.payload["business_owner_id"]).pk}


def validate_listing_create(approval):
    payload = approval.payload
    owner = BusinessOwner.objects.select_related("profile").get(pk=payload["business_owner_id"])
    _, errors = check_listing(owner, payload.get("listing") or {})
    if not errors:
        errors = photo_errors(owner, _listing_photo_ids(payload))
    if errors:
        raise ApprovalError(first_message(errors))


def apply_listing_create(approval):
    """Publish the listing: this approval is its moderation (spec S4)."""
    payload = approval.payload
    owner = BusinessOwner.objects.select_for_update().get(pk=payload["business_owner_id"])
    serializer = ProposedListingSerializer(data=payload.get("listing") or {})
    if not serializer.is_valid():
        raise ApprovalError(first_message(serializer.errors))
    data = dict(serializer.validated_data)
    profile = owner.profile
    if not data.get("contact_phone"):
        data["contact_phone"] = profile.business_contact_phone or owner.login_phone
    if data.get("lat") is None and data.get("lng") is None and profile.lat is not None:
        data["lat"], data["lng"] = profile.lat, profile.lng
    now = timezone.now()
    main_id = payload.get("main_photo_id")
    gallery = payload.get("photo_ids") or []
    staged = _locked_staged(owner, _listing_photo_ids(payload))
    listing = Listing(
        business_owner=owner, status=Listing.PUBLISHED, created_by_staff=approval.maker,
        reviewed_by=approval.decided_by, reviewed_at=now, **data,
    )
    if main_id:
        _copy_image(staged[main_id].image, listing.main_photo)
    listing.save()
    for order, pk in enumerate(gallery, start=1):
        photo = ListingPhoto(listing=listing, order=order)
        _copy_image(staged[pk].image, photo.image)
        photo.save()
    StagedPhoto.objects.filter(pk__in=list(staged)).update(used_at=now)
    _applied(approval, owner, summary=f"Added “{listing.name}”", result={"listing_id": listing.pk}, applied_at=now)
    _tell_owner(owner, approval, f"added “{listing.name}”", f"It's live on AshantiHub now. {UNDO_HINT}")


def _listing_shown(key, value):
    if key == "category":
        return Category.objects.filter(pk=value).values_list("label", flat=True).first()
    if key == "zone":
        return Zone.objects.filter(pk=value).values_list("name", flat=True).first()
    if isinstance(value, bool):
        return "Yes" if value else "No"
    return value


def listing_create_diff(approval):
    payload = approval.payload
    listing = payload.get("listing") or {}
    rows = [
        {"field": label, "before": None, "after": _listing_shown(key, listing[key])}
        for key, label in LISTING_LABELS
        if key in listing
    ]
    if payload.get("main_photo_id"):
        rows.append({"field": "Main photo", "before": None, "after": {"images": _image_urls([payload["main_photo_id"]])}})
    if payload.get("photo_ids"):
        rows.append({"field": "Photos", "before": None, "after": {"images": _image_urls(payload["photo_ids"])}})
    return rows


# ── listing.photos ──────────────────────────────────────────────────────────

def propose_photos(scout, listing, *, photo_ids, reason, http_request=None):
    listing = Listing.objects.select_related("business_owner").get(pk=listing.pk)
    owner = _fresh(listing.business_owner)
    _require_account_manager(scout, owner)
    reason = _require_reason(reason)
    ids = _photo_id_list(photo_ids, "photo_ids")
    if not ids:
        raise ValidationError({"photo_ids": [NO_PHOTOS]})
    if len(ids) > MAX_PHOTOS:
        raise ValidationError({"photo_ids": [TOO_MANY_PHOTOS]})
    errors = photo_errors(owner, ids)
    if errors:
        raise ValidationError(errors)
    with transaction.atomic():
        approval = submit(
            scout, LISTING_PHOTOS_KEY, title=f"{_photo_count(len(ids))} for {listing.name} — {owner.display_name}",
            payload={"business_owner_id": owner.pk, "reason": reason, "listing_id": listing.pk, "photo_ids": ids},
            target=listing, maker_note=reason, request=http_request,
        )
        record(scout, "business.change_proposed", target=owner,
               after={"approval_id": approval.pk, "kind": LISTING_PHOTOS_KEY, "listing_id": listing.pk,
                      "photos": len(ids)},
               request=http_request)
    return approval


def listing_photos_state(approval):
    return {"listing_id": Listing.objects.get(pk=approval.payload["listing_id"]).pk}


def validate_listing_photos(approval):
    payload = approval.payload
    owner = BusinessOwner.objects.get(pk=payload["business_owner_id"])
    if not Listing.objects.filter(pk=payload["listing_id"], business_owner=owner).exists():
        raise ApprovalError(LISTING_MOVED)
    errors = photo_errors(owner, payload.get("photo_ids") or [])
    if errors:
        raise ApprovalError(first_message(errors))


def apply_listing_photos(approval):
    payload = approval.payload
    owner = BusinessOwner.objects.select_for_update().get(pk=payload["business_owner_id"])
    listing = Listing.objects.select_for_update().get(pk=payload["listing_id"], business_owner=owner)
    ids = payload.get("photo_ids") or []
    staged = _locked_staged(owner, ids)
    now = timezone.now()
    start = (listing.photos.aggregate(top=Max("order"))["top"] or 0) + 1
    created = []
    for offset, pk in enumerate(ids):
        photo = ListingPhoto(listing=listing, order=start + offset)
        _copy_image(staged[pk].image, photo.image)
        photo.save()
        created.append(photo.pk)
    result = {"photo_ids": created, "set_main_photo": not listing.main_photo}
    if result["set_main_photo"]:
        _copy_image(staged[ids[0]].image, listing.main_photo)
        listing.save(update_fields=["main_photo"])
        result["main_photo"] = listing.main_photo.name  # so an undo clears only the main photo this set
    StagedPhoto.objects.filter(pk__in=list(staged)).update(used_at=now)
    count = _photo_count(len(ids))
    _applied(approval, owner, summary=f"Added {count} to “{listing.name}”", result=result, applied_at=now)
    _tell_owner(owner, approval, f"added {count}", f"To “{listing.name}”. {UNDO_HINT}")


def listing_photos_diff(approval):
    payload = approval.payload
    name = Listing.objects.filter(pk=payload.get("listing_id")).values_list("name", flat=True).first()
    return [
        {"field": "Listing", "before": None, "after": name},
        {"field": "Photos", "before": None, "after": {"images": _image_urls(payload.get("photo_ids") or [])}},
    ]


# ── The Add-a-product form ──────────────────────────────────────────────────

def listing_form_meta(owner):
    profile = getattr(owner, "profile", None)
    kind = getattr(profile, "business_kind", None)
    kinds = [kind] if kind in (Category.PRODUCT, Category.SERVICE) else [Category.PRODUCT, Category.SERVICE]
    return {
        "categories": [
            {"id": category.id, "name": category.label}
            for category in Category.objects.filter(kind__in=kinds).order_by("label")
        ],
        "zones": [{"id": zone.id, "name": zone.name} for zone in Zone.objects.order_by("name")],
        "required_answers": dict(PRODUCT_ANSWER_MESSAGES) if kind == Category.PRODUCT else {},
        "business_kind": kind,
        "max_photos": MAX_PHOTOS,
    }

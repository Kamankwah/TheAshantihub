"""Minimal auto-publish at submit (self-serve onboarding, spec section 6, owner decision 1).

`evaluate(listing)` is a pure verdict on a listing the owner is submitting: it reads the listing, its stored main
photo header and the owner's other listings, and changes nothing. The submit view applies the verdict. Only the
checks the owner approved are here (photo size, name, description, price, category kind, contact details, prohibited
words, daily volume for a business whose location has not been checked); photo background, sharpness, duplicate
image and price outlier checks are deliberately not built.

* `pass`: publish at once.
* `fix`:  the owner changes something and submits again; each reason is one plain sentence saying what to change.
* `hold`: goes to the moderation queue as before; reasons are for staff and are never shown as a refusal.
"""
import re
from dataclasses import dataclass, field

from django.conf import settings
from django.utils import timezone

from accounts import location_tier
from accounts.models import BusinessOwner

from .models import Listing
from .moderation_checks import contact_details_in

PASS, FIX, HOLD = "pass", "fix", "hold"

MIN_PHOTO_SIDE = 800
MIN_NAME_LENGTH = 3
MIN_DESCRIPTION_LENGTH = 40

NO_PHOTO = "Add a main photo that is at least 800 by 800 pixels."
UNREADABLE_PHOTO = "We could not read your main photo. Upload it again as a JPEG or PNG."
SHORT_NAME = "Give the listing a name of at least 3 characters."
SHORT_DESCRIPTION = "Describe the listing in at least 40 characters so shoppers know what they are buying."
NO_PRICE = "Set a price above zero."
CONTACT_IN_TEXT = (
    "Remove phone numbers, email addresses, web links and WhatsApp details from the name and description. "
    "Shoppers contact AshantiHub Support, never the business directly."
)


@dataclass
class Verdict:
    outcome: str
    reasons: list = field(default_factory=list)


def prohibited_terms():
    return [term.strip().lower() for term in getattr(settings, "LISTING_PROHIBITED_TERMS", []) if term and term.strip()]


def _photo_reason(listing):
    """None when the stored original of the main photo is at least 800 px each way. Only the image header is read,
    so a huge file costs nothing, and any failure (missing file, corrupt, zero bytes) is a reason, never an error."""
    from PIL import Image

    name = listing.main_photo.name if listing.main_photo else ""
    if not name:
        return NO_PHOTO
    try:
        with listing.main_photo.storage.open(name, "rb") as handle:
            with Image.open(handle) as image:
                width, height = image.size
    except Exception:  # noqa: BLE001 - a bad upload is the owner's to fix, never a server error
        return UNREADABLE_PHOTO
    if width < MIN_PHOTO_SIDE or height < MIN_PHOTO_SIDE:
        return (
            f"Your main photo is {width} by {height} pixels. "
            f"Upload one that is at least {MIN_PHOTO_SIDE} by {MIN_PHOTO_SIDE} pixels."
        )
    return None


def _category_reason(listing):
    owner = listing.business_owner
    profile = getattr(owner, "profile", None)
    category = listing.category
    if owner.is_company or profile is None or not profile.business_kind or category is None or not category.kind:
        return None
    if category.kind != profile.business_kind:
        return f"Your business is registered for {profile.business_kind} listings only. Choose a {profile.business_kind} category."
    return None


def fix_reasons(listing):
    reasons = []
    photo = _photo_reason(listing)
    if photo:
        reasons.append(photo)
    if len((listing.name or "").strip()) < MIN_NAME_LENGTH:
        reasons.append(SHORT_NAME)
    if len((listing.description or "").strip()) < MIN_DESCRIPTION_LENGTH:
        reasons.append(SHORT_DESCRIPTION)
    if listing.price_amount is None or listing.price_amount <= 0:
        reasons.append(NO_PRICE)
    category = _category_reason(listing)
    if category:
        reasons.append(category)
    if contact_details_in(listing.name) or contact_details_in(listing.description):
        reasons.append(CONTACT_IN_TEXT)
    return reasons


def _prohibited_hit(listing):
    text = f"{listing.name or ''} {listing.description or ''}".lower()
    for term in prohibited_terms():
        if re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text):
            return term
    return None


def submitted_today(owner, *, exclude_pk=None):
    """How many of this business's listings were moved to review or published today (Accra day). Listing has no
    submitted-at stamp, so this counts the ones in those two states whose row was last saved today: the submit door
    saves `updated_at` when it moves a listing, so a submit today is always counted. A listing edited later today
    counts too, which only ever sends one more listing to a person instead of publishing it."""
    midnight = timezone.localtime().replace(hour=0, minute=0, second=0, microsecond=0)
    rows = Listing.objects.filter(
        business_owner=owner, status__in=(Listing.PENDING_REVIEW, Listing.PUBLISHED), updated_at__gte=midnight,
    )
    if exclude_pk is not None:
        rows = rows.exclude(pk=exclude_pk)
    return rows.count()


def hold_reasons(listing):
    reasons = []
    term = _prohibited_hit(listing)
    if term:
        reasons.append(f"The name or description contains the word “{term}”, which needs a staff check.")
    owner = listing.business_owner
    limit = settings.UNVERIFIED_DAILY_LISTING_LIMIT
    profile = getattr(owner, "profile", None)
    if location_tier.tier(profile) != location_tier.VERIFIED and submitted_today(owner, exclude_pk=listing.pk) >= limit:
        reasons.append(f"This business has already submitted {limit} listings today and its location is not verified.")
    return reasons


def evaluate(listing):
    reasons = fix_reasons(listing)
    if reasons:
        return Verdict(FIX, reasons)
    reasons = hold_reasons(listing)
    if reasons:
        return Verdict(HOLD, reasons)
    return Verdict(PASS, [])


def eligible(request_user, listing):
    """Auto-publish applies only when the business owner submits their own listing. Ashanti Direct's company owner
    and anything a staff member touched keep the four-eyes rule (the person who drafted it never approves it)."""
    owner = listing.business_owner
    return (
        isinstance(request_user, BusinessOwner)
        and request_user.pk == owner.pk
        and not owner.is_company
        and listing.created_by_staff_id is None
        and not listing.staff_contributors.exists()
    )


def first_listing_key(owner):
    return f"first-listing-{owner.pk}"


def spot_check_first_listing(listing):
    """One low-priority case the first time a business's listing is published without a person looking at it, so
    staff can spot-check it afterwards. Kind `other` is neutral (it reverses no commission and cannot suspend), and a
    failure here never blocks the owner's listing. Returns the case, or None when this is not the first."""
    import logging

    from fraud.models import FraudFlag
    from fraud.services import raise_flag

    owner = listing.business_owner
    key = first_listing_key(owner)
    try:
        if FraudFlag.objects.filter(dedupe_key=key).exists():
            return None
        if Listing.objects.filter(business_owner=owner, status=Listing.PUBLISHED).exclude(pk=listing.pk).exists():
            return None
        return raise_flag(
            FraudFlag.OTHER, title="First listing published without review",
            detail=f"“{listing.name}” was published at once under auto-publish. Spot-check it.",
            evidence=[f"Listing {listing.pk}: {listing.name}"], business_owner=owner,
            source=FraudFlag.SYSTEM, dedupe_key=key,
        )
    except Exception:  # noqa: BLE001 - a spot check must never stop a publish
        logging.getLogger(__name__).exception("first-listing spot check failed for owner %s", owner.pk)
        return None

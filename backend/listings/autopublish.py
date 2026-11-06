"""Minimal auto-publish at submit (self-serve onboarding, spec section 6, owner decision 1).

`evaluate(listing)` is a pure verdict on a listing the owner is submitting: it reads the listing, its stored main
photo header and the owner's other listings, and changes nothing. The submit view applies the verdict. Only the
checks the owner approved are here (photo size, name, description, price, category kind, contact details, prohibited
words, daily volume for a business whose location has not been checked); photo background, sharpness, duplicate
image and price outlier checks are deliberately not built.

* `pass`: publish at once.
* `fix`:  the owner changes something and submits again; each reason is one plain sentence saying what to change.
* `hold`: goes to the moderation queue as before; reasons are for staff and are never shown as a refusal.

Every reason is a `{code, message}` pair (`Verdict.details`); the submit door stores them on `Listing.hold_reasons`, so
staff see why a listing is held. The owner sees the fix sentences for a fix and only `OWNER_HOLD_NOTICE` for a hold.
"""
import io
import logging
import re
from dataclasses import dataclass, field

from django.conf import settings
from django.utils import timezone

from accounts import location_tier
from accounts.models import BusinessOwner

from .models import Listing
from .moderation_checks import contact_details_in

logger = logging.getLogger(__name__)

PASS, FIX, HOLD = "pass", "fix", "hold"

MIN_PHOTO_SIDE = 800
MIN_NAME_LENGTH = 3
MIN_DESCRIPTION_LENGTH = 40

OWNER_HOLD_NOTICE = "We need to check this listing."

# Codes stored on Listing.hold_reasons. A hold code is staff-only; a fix code's message is the sentence the owner is shown.
PHOTO_MISSING, PHOTO_UNREADABLE, PHOTO_TOO_SMALL = "photo_missing", "photo_unreadable", "photo_too_small"
NAME_TOO_SHORT, DESCRIPTION_TOO_SHORT, PRICE_MISSING = "name_too_short", "description_too_short", "price_missing"
CATEGORY_KIND_MISMATCH, CONTACT_DETAILS = "category_kind_mismatch", "contact_details_in_text"
PROHIBITED_TERM, DAILY_LIMIT, PHOTO_CHECK_FAILED = "prohibited_term", "daily_limit", "photo_check_unavailable"
HOLD_CODES = frozenset({PROHIBITED_TERM, DAILY_LIMIT, PHOTO_CHECK_FAILED})
# The only codes whose message may be shown to the owner: an allow-list, so a hold code added later is never leaked.
FIX_CODES = frozenset({
    PHOTO_MISSING, PHOTO_UNREADABLE, PHOTO_TOO_SMALL, NAME_TOO_SHORT, DESCRIPTION_TOO_SHORT, PRICE_MISSING,
    CATEGORY_KIND_MISMATCH, CONTACT_DETAILS,
})

NO_PHOTO = "Add a main photo that is at least 800 by 800 pixels."
UNREADABLE_PHOTO = "We could not read your main photo. Upload it again as a JPEG or PNG."
PHOTO_CHECK_UNAVAILABLE = "The main photo could not be checked because file storage failed. Look at the photo yourself."
SHORT_NAME = "Give the listing a name of at least 3 characters."
SHORT_DESCRIPTION = "Describe the listing in at least 40 characters so shoppers know what they are buying."
NO_PRICE = "Set a price above zero."
CONTACT_IN_TEXT = (
    "Remove phone numbers, email addresses, web links and WhatsApp details from the name and description. "
    "Shoppers contact AshantiHub Support, never the business directly."
)


def detail(code, message):
    return {"code": code, "message": message}


@dataclass
class Verdict:
    outcome: str
    details: list = field(default_factory=list)

    @property
    def reasons(self):
        return [item["message"] for item in self.details]


def prohibited_terms():
    return [term.strip().lower() for term in getattr(settings, "LISTING_PROHIBITED_TERMS", []) if term and term.strip()]


class PhotoCheckUnavailable(Exception):
    """The photo could not be checked for a reason that is not the owner's: the storage itself failed."""


class _StorageStream:
    """Wraps the file object a storage backend gave us so that anything its reads raise is told apart from Pillow's own
    decode failures: ConnectionError and TimeoutError are OSErrors, exactly as Pillow's are, so the exception type alone
    cannot say whose fault a failed read is. `AttributeError` and `io.UnsupportedOperation` (a stream that cannot seek)
    pass through untouched: Pillow reads those as "not seekable" and falls back to reading the whole file."""

    def __init__(self, handle):
        self._handle = handle

    def _guard(self, name, *args):
        try:
            return getattr(self._handle, name)(*args)
        except (AttributeError, io.UnsupportedOperation):
            raise
        except Exception as exc:  # noqa: BLE001
            raise PhotoCheckUnavailable from exc

    def read(self, *args):
        return self._guard("read", *args)

    def readline(self, *args):
        return self._guard("readline", *args)

    def readinto(self, *args):
        return self._guard("readinto", *args)

    def seek(self, *args):
        return self._guard("seek", *args)

    def tell(self):
        return self._guard("tell")

    def close(self):
        return self._guard("close")

    def __getattr__(self, name):
        return getattr(self._handle, name)


def _photo_reason(listing):
    """None when the stored original of the main photo is at least 800 px each way, else a (code, message) pair. Only the
    image header is read, so a huge file costs nothing. Opening and decoding are told apart:

    * a file that is missing (`FileNotFoundError`), empty, truncated or
      not an image (Pillow's `UnidentifiedImageError`, `DecompressionBombError`, and the `OSError`/`ValueError`/
      `SyntaxError` it raises while parsing) is the owner's to fix;
    * anything else - the storage backend failing on open or on a read (connection, timeout, botocore-style or generic
      errors), or an unexpected error from the decoder - is not: it raises `PhotoCheckUnavailable`, so the listing goes to
      staff with a logged warning instead of a 500 or telling the owner to re-upload a fine photo."""
    from PIL import Image, UnidentifiedImageError

    name = listing.main_photo.name if listing.main_photo else ""
    if not name:
        return PHOTO_MISSING, NO_PHOTO
    try:
        handle = listing.main_photo.storage.open(name, "rb")
    except FileNotFoundError:
        logger.warning("main photo %r of listing %s is missing from storage", name, listing.pk)
        return PHOTO_UNREADABLE, UNREADABLE_PHOTO
    except Exception as exc:  # noqa: BLE001 - anything else (a ValueError from a misconfigured storage too) is the storage, not a bad upload
        logger.warning("storage failed opening main photo %r of listing %s", name, listing.pk, exc_info=True)
        raise PhotoCheckUnavailable from exc
    try:
        with handle:
            with Image.open(_StorageStream(handle)) as image:
                width, height = image.size
    except PhotoCheckUnavailable:
        logger.warning("storage failed reading main photo %r of listing %s", name, listing.pk, exc_info=True)
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError, EOFError):
        logger.warning("could not read main photo %r of listing %s", name, listing.pk, exc_info=True)
        return PHOTO_UNREADABLE, UNREADABLE_PHOTO
    except Exception as exc:  # noqa: BLE001 - an error we do not recognise is not proof the owner's photo is bad
        logger.warning("unexpected error checking main photo %r of listing %s", name, listing.pk, exc_info=True)
        raise PhotoCheckUnavailable from exc
    if width < MIN_PHOTO_SIDE or height < MIN_PHOTO_SIDE:
        return PHOTO_TOO_SMALL, (
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
        return CATEGORY_KIND_MISMATCH, (
            f"Your business is registered for {profile.business_kind} listings only. Choose a {profile.business_kind} category."
        )
    return None


def _fix_checks(listing):
    """(fix details, photo_unavailable)."""
    found = []
    photo_unavailable = False
    try:
        photo = _photo_reason(listing)
    except PhotoCheckUnavailable:
        photo, photo_unavailable = None, True
    if photo:
        found.append(detail(*photo))
    if len((listing.name or "").strip()) < MIN_NAME_LENGTH:
        found.append(detail(NAME_TOO_SHORT, SHORT_NAME))
    if len((listing.description or "").strip()) < MIN_DESCRIPTION_LENGTH:
        found.append(detail(DESCRIPTION_TOO_SHORT, SHORT_DESCRIPTION))
    if listing.price_amount is None or listing.price_amount <= 0:
        found.append(detail(PRICE_MISSING, NO_PRICE))
    category = _category_reason(listing)
    if category:
        found.append(detail(*category))
    if contact_details_in(listing.name) or contact_details_in(listing.description):
        found.append(detail(CONTACT_DETAILS, CONTACT_IN_TEXT))
    return found, photo_unavailable


def fix_reasons(listing):
    return [item["message"] for item in _fix_checks(listing)[0]]


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
        reasons.append(detail(PROHIBITED_TERM, f"The name or description contains the word “{term}”, which needs a staff check."))
    owner = listing.business_owner
    limit = settings.UNVERIFIED_DAILY_LISTING_LIMIT
    profile = getattr(owner, "profile", None)
    if location_tier.tier(profile) != location_tier.VERIFIED and submitted_today(owner, exclude_pk=listing.pk) >= limit:
        reasons.append(detail(
            DAILY_LIMIT, f"This business has already submitted {limit} listings today and its location is not verified.",
        ))
    return reasons


def evaluate(listing):
    reasons, photo_unavailable = _fix_checks(listing)
    if reasons:
        return Verdict(FIX, reasons)
    reasons = hold_reasons(listing)
    if photo_unavailable:
        return Verdict(HOLD, [detail(PHOTO_CHECK_FAILED, PHOTO_CHECK_UNAVAILABLE), *reasons])
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
        logger.exception("first-listing spot check failed for owner %s", owner.pk)
        return None

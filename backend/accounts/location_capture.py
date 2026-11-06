"""Shop location capture (plan "shop location and address verification", Task 1).

The owner shares the shop's exact GPS fix from the shop, by a texted link (staff send it) or from the dashboard. The
coordinates on `BusinessOwnerProfile` are the truth; a `LocationCapture` row records each share.

* The link is a bearer token made like the owner-confirmation one (`portfolio.confirmations`): `secrets.token_urlsafe(32)`,
  stored only as its SHA-256 hash, single use, 48 hours, and a newer link for the same business revokes the older ones.
  The raw token lives only in the text body, in the creation response staff may copy (ruling 5) and in the owner's
  browser. It is never logged, put in an activity event or a notice, or returned by any other response.
* Lock order for every mutation: the BusinessOwner row, then the LocationCapture row, then the profile row, then the
  activity chain (last). The public capture finds the row by hash WITHOUT a lock, locks the owner, then re-reads and
  locks the row and checks it again, so a replay and a new link cannot deadlock.
* The text goes after the transaction through `otp.senders` (the one door for texts), never inside one, to the owner's
  login number, and never to a number that belongs to a staff account.
* Every path applies the same fix rules (`FixSerializer`): finite numbers, a device fix of 100 m or better, inside the
  Ashanti Region box. Only the owner's own `POST me/location/` may place the pin by hand (`OwnerFixSerializer`: `manual`,
  no accuracy figure, and an optional `landmark`); the staff link uses the base serializer, which has no such fields, so
  a link capture can never be manual.
* After any capture, another business pinned within 25 m raises a staff case (never a refusal): shops share buildings.
"""
import logging
import math
import secrets
from datetime import datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers

from activity.services import record
from fraud.models import FraudFlag
from fraud.services import raise_flag
from otp import senders
from otp.models import SMS
from portfolio.checks import METRES_PER_DEGREE_LAT, distance_m
from portfolio.serializers import FiniteFloatField

from . import location_tier, pluscode
from .claims import ClaimError, hash_token
from .gps import ASHANTI_LAT, ASHANTI_LNG
from .models import BusinessOwner, BusinessOwnerProfile, LocationCapture, StaffUser
from .phones import filter_by_phone, mask_phone, normalize_gh_phone

logger = logging.getLogger(__name__)

LINK_TTL = timedelta(hours=48)
DAILY_LINKS = 5  # links per business per Accra day
MAX_ACCURACY_M = 100
NEAR_PIN_M = 25  # another business pinned this close is flagged for staff
NEAR_PIN_FLAGS = 10  # at most this many cases from one capture (a market building)
LANDMARK_MAX = 200

INVALID = "This link isn't valid. Check you opened the whole link, or ask AshantiHub for a new one."
USED = "This link has already been used. Ask AshantiHub for a new one if you still need to share your location."
REVOKED = "This link has been replaced by a newer one. Open the newest text from AshantiHub, or ask for a new one."
EXPIRED = "This link has expired. Ask AshantiHub to send a new one."
CLOSED = "This business can no longer share a location this way. Contact AshantiHub Support."
KYC_REJECTED = "This business's registration was rejected, so a location link can't be sent."
KYC_REJECTED_OWN = "Your registration was rejected, so your shop's location can't be shared. Contact AshantiHub Support."
TOO_MANY = "Five location links a day is the most one business can be sent. Try again tomorrow."
VERIFIED = "Your shop's location is verified. To change it, contact AshantiHub Support."
OUTSIDE_ASHANTI = "This location isn't in the Ashanti Region. Share it from your shop."
SMS_TEXT = (
    "AshantiHub: open this link on your phone while you are at your shop to share its location: {url} . "
    "It works once and expires in 48 hours."
)


def too_coarse(accuracy):
    return (
        f"Your phone's location is only accurate to ±{accuracy} m. We need {MAX_ACCURACY_M} m or better: "
        "step outside or near a window and try again."
    )


def link_url(raw):
    """The token rides in the URL fragment: a browser never sends it to the frontend host, so it stays out of that
    host's request logs. The page reads it, strips it from the address bar and POSTs it."""
    return f"{settings.FRONTEND_BASE_URL}/share-location#token={raw}"


# --- the fix rules every path shares ------------------------------------------------------------------------------

class FixSerializer(serializers.Serializer):
    """A device fix: lat, lng and the phone's accuracy. The base the staff link uses: it has no `manual` or `landmark`
    field, so those keys in a link body are ignored and a fix without an accuracy is refused."""

    lat = FiniteFloatField(min_value=-90, max_value=90)
    lng = FiniteFloatField(min_value=-180, max_value=180)
    accuracy_m = FiniteFloatField(min_value=0)  # no ceiling: a 400 km IP-based "fix" must read as too coarse

    def accuracy_of(self, attrs, errors):
        """The accuracy to store (whole metres, rounded up), or None for a hand-placed pin. Adds to `errors` when the fix is
        too coarse."""
        accuracy = math.ceil(attrs["accuracy_m"])
        if accuracy > MAX_ACCURACY_M:
            errors["accuracy_m"] = [too_coarse(accuracy)]
        return accuracy

    def validate(self, attrs):
        errors = {}
        if not (ASHANTI_LAT[0] <= attrs["lat"] <= ASHANTI_LAT[1] and ASHANTI_LNG[0] <= attrs["lng"] <= ASHANTI_LNG[1]):
            errors["lat"] = [OUTSIDE_ASHANTI]
        accuracy = self.accuracy_of(attrs, errors)
        if errors:
            raise serializers.ValidationError(errors)
        six = Decimal("0.000001")
        return {
            "lat": Decimal(repr(attrs["lat"])).quantize(six, ROUND_HALF_UP),
            "lng": Decimal(repr(attrs["lng"])).quantize(six, ROUND_HALF_UP),
            "accuracy_m": accuracy,
        }


class OwnerFixSerializer(FixSerializer):
    """What the owner's own `POST me/location/` accepts: a device fix, or a pin placed by hand (`manual`: no accuracy
    ceiling and none stored, but still inside the Ashanti box), and an optional landmark."""

    accuracy_m = FiniteFloatField(min_value=0, required=False)
    manual = serializers.BooleanField(required=False, default=False)
    landmark = serializers.CharField(required=False, allow_blank=True, max_length=LANDMARK_MAX)

    def accuracy_of(self, attrs, errors):
        if attrs["manual"]:
            return None
        if "accuracy_m" not in attrs:
            errors["accuracy_m"] = ["Share your phone's location, or place the pin by hand."]
            return None
        return super().accuracy_of(attrs, errors)

    def validate(self, attrs):
        fix = super().validate(attrs)
        fix["manual"] = attrs["manual"]
        if "landmark" in attrs:
            fix["landmark"] = attrs["landmark"]  # trimmed by the field; empty clears it
        return fix


def validated_fix(data, *, allow_manual=False):
    """The cleaned fix {lat, lng, accuracy_m} (plus manual and landmark for the owner) or a DRF ValidationError keyed by
    field. `allow_manual` is for the owner's own capture only."""
    serializer_class = OwnerFixSerializer if allow_manual else FixSerializer
    serializer = serializer_class(data=data if hasattr(data, "get") else {})
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


def clear_address_decision(profile):
    """A new pin is new evidence: any address decision (verified or marked wrong) is cleared so the business returns to
    the verification queue: the decision, who made it, when, and how and why (method and note). `address_first_verified_at`
    is never cleared: it records that a video call once happened, so a later verification may rest on the fresh pin alone."""
    profile.address_verified, profile.address_verified_by, profile.address_verified_at = False, None, None
    profile.address_verification_method, profile.address_verification_note = "", ""


def _apply_fix(owner, fix, source, now, row=None, request=None):
    """Write the fix. The caller holds the owner row lock (and `row`'s) inside a transaction; the activity record is
    last. Returns the capture row."""
    profile = BusinessOwnerProfile.objects.select_for_update().filter(business_owner=owner).first()
    if profile is None:
        profile = BusinessOwnerProfile(business_owner=owner)
    manual = fix.get("manual", False)
    profile.lat, profile.lng, profile.location_accuracy_m = fix["lat"], fix["lng"], fix["accuracy_m"]  # None when by hand
    profile.location_set_by, profile.location_set_at = BusinessOwnerProfile.LOCATION_BY_OWNER, now
    profile.location_is_manual, profile.location_set_by_staff = manual, None
    if "landmark" in fix:
        profile.landmark = fix["landmark"]
    if profile.address_verified_at is not None:
        clear_address_decision(profile)
    profile.save()
    if row is None:
        row = LocationCapture(business_owner=owner, source=source)
    row.lat, row.lng, row.accuracy_m = fix["lat"], fix["lng"], fix["accuracy_m"]
    row.captured_at = row.used_at = now  # a link is used up by its capture; an owner_app row is done at once
    row.save()
    record(
        owner, "address-location-captured", target=owner, summary="The owner shared the shop's location",
        after={"accuracy_m": fix["accuracy_m"], "source": source, **({"manual": True} if manual else {})},
        request=request,
    )
    flag_close_pins(owner, profile)
    return row


def _close_pins(owner, profile):
    """(distance in metres, profile) for every other business pinned within `NEAR_PIN_M`, nearest first."""
    lat, lng = float(profile.lat), float(profile.lng)
    d_lat = NEAR_PIN_M / METRES_PER_DEGREE_LAT
    d_lng = NEAR_PIN_M / (METRES_PER_DEGREE_LAT * max(math.cos(math.radians(lat)), 0.01))
    six = Decimal("0.000001")
    box = BusinessOwnerProfile.objects.filter(
        lat__gte=Decimal(lat - d_lat).quantize(six), lat__lte=Decimal(lat + d_lat).quantize(six),
        lng__gte=Decimal(lng - d_lng).quantize(six), lng__lte=Decimal(lng + d_lng).quantize(six),
    ).exclude(business_owner_id=owner.pk).select_related("business_owner")
    found = [(distance_m(lat, lng, other.lat, other.lng), other) for other in box]
    found = [pair for pair in found if pair[0] <= NEAR_PIN_M]
    found.sort(key=lambda pair: (pair[0], pair[1].business_owner_id))
    return found


def flag_close_pins(owner, profile):
    """Open a staff case for every other business pinned within `NEAR_PIN_M` of this one. A bounding box (a range on the two
    columns) narrows the rows first, then the exact great-circle distance decides: no scan of every business. A case is
    keyed on the pair, so sharing again never opens a second one while the first is open. Never raises: the capture has
    already succeeded and a flag is only a note for staff."""
    try:
        with transaction.atomic():  # a savepoint: a failure here must not poison the capture's own transaction
            mine = owner.display_name
            for distance, other in _close_pins(owner, profile)[:NEAR_PIN_FLAGS]:
                low, high = sorted([owner.pk, other.business_owner_id])
                theirs, metres = other.business_owner.display_name, round(distance)
                raise_flag(
                    FraudFlag.SIMILAR_NEARBY,
                    title=f"{mine} is pinned {metres} m from {theirs}"[:200],
                    detail=(
                        f"{mine} shared a shop location {metres} m from {theirs}. Shops in one building or market "
                        "often share a spot: check they are different businesses."
                    ),
                    evidence=[f"{metres} m apart", "Pin placed by hand" if profile.location_is_manual else "Pin from the phone"],
                    business_owner=owner,
                    related_business_owner=other.business_owner,
                    dedupe_key=f"pin-near-{low}-{high}",
                )
    except Exception:  # noqa: BLE001 - the capture already succeeded
        logger.exception("Close-pin check failed for business owner %s", owner.pk)


# --- staff send a link ----------------------------------------------------------------------------------------------

def create_link(owner, staff, request=None):
    """Issue a link for `owner`: revokes every older live one and returns (capture, raw_token). The caller sends the
    text afterwards with `send_link_text`, outside this transaction."""
    with transaction.atomic():
        locked = BusinessOwner.objects.select_for_update().get(pk=owner.pk)  # 1. the owner
        now = timezone.now()
        if locked.kyc_status == BusinessOwner.REJECTED:
            raise ClaimError(KYC_REJECTED, code="kyc_rejected", status_code=409)
        start = timezone.make_aware(datetime.combine(timezone.localdate(now), time.min))
        sent_today = LocationCapture.objects.filter(
            business_owner=locked, source=LocationCapture.LINK, created_at__gte=start,
        ).count()
        if sent_today >= DAILY_LINKS:
            raise ClaimError(TOO_MANY, code="too_many_links", status_code=429)
        LocationCapture.objects.filter(
            business_owner=locked, source=LocationCapture.LINK, used_at__isnull=True, revoked_at__isnull=True,
        ).update(revoked_at=now)  # 2. the older live links
        raw = secrets.token_urlsafe(32)
        capture = LocationCapture.objects.create(
            business_owner=locked, source=LocationCapture.LINK, token_hash=hash_token(raw), created_by=staff,
            expires_at=now + LINK_TTL,
        )
        record(
            staff, "address-location-link-sent", target=locked, summary="Sent the owner a link to share the shop's location",
            after={"expires_at": capture.expires_at.isoformat()}, request=request,
        )  # 4. the activity chain, last
    return capture, raw


def _recipient(owner):
    """The owner's login number, normalised, or "" when there is none; and whether it belongs to a staff account (a staff
    member's own number must never receive a token)."""
    try:
        phone = normalize_gh_phone(owner.login_phone)
    except ValueError:
        return "", False
    return phone, bool(filter_by_phone(StaffUser.objects.filter(is_active=True), "phone", phone).exists())


def send_link_text(owner, raw):
    """Text the link to the owner. Never raises, and must be called outside any transaction. Returns
    (sms_state, phone_masked): sent | simulated | failed | no_phone (no usable number, or one that is a staff member's:
    no text goes and the number is not shown)."""
    phone, is_staff_number = _recipient(owner)
    if not phone or is_staff_number:
        return "no_phone", ""
    body = SMS_TEXT.format(url=link_url(raw))
    delivery = senders.deliver(SMS, phone, "", body)
    if not delivery.ok:
        return "failed", mask_phone(phone)
    if delivery.provider == "simulated":
        return "simulated", mask_phone(phone)  # nothing left the building: never pretend
    return "sent", mask_phone(phone)


# --- the public link --------------------------------------------------------------------------------------------------

def _find(raw):
    raw = raw.strip() if isinstance(raw, str) else ""
    row = LocationCapture.objects.filter(token_hash=hash_token(raw), source=LocationCapture.LINK).first() if raw else None
    if row is None:
        raise ClaimError(INVALID, code="invalid")
    return row


def _check_usable(row, owner, now):
    if row.used_at is not None:
        raise ClaimError(USED, code="used", status_code=410)
    if row.revoked_at is not None:
        raise ClaimError(REVOKED, code="revoked", status_code=410)
    if row.expires_at <= now:
        raise ClaimError(EXPIRED, code="expired", status_code=410)
    if owner.kyc_status == BusinessOwner.REJECTED:
        raise ClaimError(CLOSED, code="closed", status_code=410)


def preview(raw):
    """What the owner sees before sharing: the business name and when the link expires. Does not use the link up."""
    row = _find(raw)
    owner = BusinessOwner.objects.select_related("profile").get(pk=row.business_owner_id)
    _check_usable(row, owner, timezone.now())
    return {"business_name": owner.display_name, "valid": True, "expires_at": row.expires_at}


def capture_with_link(raw, data, request=None):
    """The owner shares the fix through the link. Single use: the link is used up only by a fix that passes the rules."""
    with transaction.atomic():
        now = timezone.now()
        found = _find(raw)
        owner = BusinessOwner.objects.select_for_update().get(pk=found.business_owner_id)  # 1. the owner
        row = LocationCapture.objects.select_for_update().get(pk=found.pk)  # 2. the link
        _check_usable(row, owner, now)
        fix = validated_fix(data)
        _apply_fix(owner, fix, LocationCapture.LINK, now, row=row, request=request)  # 3. the profile, 4. activity
        name = owner.display_name
    return {"business_name": name, "accuracy_m": fix["accuracy_m"], "captured_at": now}


# --- the owner's own capture ----------------------------------------------------------------------------------------

def address_status(profile):
    if profile is None or profile.address_verified_at is None:
        return "not_verified"
    return "verified" if profile.address_verified else "wrong"


def has_pin(profile):
    return profile is not None and profile.lat is not None and profile.lng is not None


def owner_locked(profile):
    """The owner may not change a location staff verified. A "verified" with no pin (an old door once allowed it) protects
    nothing, so it does not lock: sharing a pin there clears the pinless decision and returns the business to the queue."""
    return address_status(profile) == "verified" and has_pin(profile)


def own_state(owner):
    """`GET me/location/`: the pin the owner has, the address decision as the owner may see it, and whether they may
    share a new fix. The wrong-reason is the staff note, shown only while the address is marked wrong."""
    owner = BusinessOwner.objects.select_related("profile").get(pk=owner.pk)
    profile = getattr(owner, "profile", None)
    status = address_status(profile)
    pin = None
    if has_pin(profile):
        pin = {
            "lat": float(profile.lat), "lng": float(profile.lng), "accuracy_m": profile.location_accuracy_m,
            "set_by": profile.location_set_by or None, "set_at": profile.location_set_at,
            "is_manual": profile.location_is_manual,
        }
    note = profile.address_verification_note if status == "wrong" else ""
    return {
        "pin": pin,
        "plus_code": pluscode.encode(profile.lat, profile.lng) if pin else None,
        "landmark": profile.landmark if profile is not None else "",
        "tier": location_tier.tier(profile),
        "tier_label": location_tier.label(profile),
        "is_manual": bool(pin and profile.location_is_manual),
        "address_status": status,
        "wrong_reason": note or None,
        "can_capture": not owner_locked(profile) and owner.kyc_status != BusinessOwner.REJECTED,
    }


def capture_for_owner(owner, data, request=None):
    """`POST me/location/`: the owner shares a fix from the dashboard. 409 once the address is verified with a pin (staff change it)
    or the business's KYC was rejected."""
    with transaction.atomic():
        locked = BusinessOwner.objects.select_for_update().get(pk=owner.pk)  # 1. the owner
        profile = BusinessOwnerProfile.objects.select_for_update().filter(business_owner=locked).first()
        if owner_locked(profile):
            raise ClaimError(VERIFIED, code="address_verified", status_code=409)
        if locked.kyc_status == BusinessOwner.REJECTED:
            raise ClaimError(KYC_REJECTED_OWN, code="kyc_rejected", status_code=409)
        fix = validated_fix(data, allow_manual=True)
        _apply_fix(locked, fix, LocationCapture.OWNER_APP, timezone.now(), request=request)
    return own_state(owner)


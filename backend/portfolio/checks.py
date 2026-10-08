"""Duplicate, look-alike and self-dealing checks for a business being
registered by a scout (staff phase 2A, S1). Phones compare by their last 9
digits (accounts.phones), because older rows hold whatever owners typed."""
import math
from decimal import Decimal

from django.contrib.postgres.search import TrigramSimilarity

from accounts.gps import normalize_gps
from accounts.models import BusinessOwner, BusinessOwnerProfile, StaffUser
from accounts.phones import filter_by_phone, phone_key

EARTH_RADIUS_M = 6_371_000
METRES_PER_DEGREE_LAT = 2 * math.pi * EARTH_RADIUS_M / 360  # about 111 195 m
NEAR_RADIUS_M = 50
SIMILAR_NAME_THRESHOLD = 0.6


def distance_m(lat1, lng1, lat2, lng2):
    """Great-circle (haversine) distance in metres; accepts floats or Decimals."""
    phi1, phi2 = math.radians(float(lat1)), math.radians(float(lat2))
    d_phi = phi2 - phi1
    d_lambda = math.radians(float(lng2) - float(lng1))
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def _excluding(queryset, field, owner_id):
    return queryset if owner_id is None else queryset.exclude(**{field: owner_id})


def exact_duplicates(*, phone=None, gps_address=None, ghana_card_number=None, exclude_owner_id=None):
    """The names of the checks another business already matches: "phone"
    (its sign-in phone, contact phone or MoMo number), "gps_address" or
    "ghana_card". Only the names — never which business — leave this module."""
    matched = []
    if phone and phone_key(phone):
        # One query per column: filter_by_phone annotates a digits-only copy
        # of the column, so "024 123 4567" and "+233241234567" both match.
        owners = _excluding(BusinessOwner.objects.all(), "pk", exclude_owner_id)
        profiles = _excluding(BusinessOwnerProfile.objects.all(), "business_owner_id", exclude_owner_id)
        if (
            filter_by_phone(owners, "login_phone", phone).exists()
            or filter_by_phone(profiles, "business_contact_phone", phone).exists()
            or filter_by_phone(profiles, "payout_momo_number", phone).exists()
        ):
            matched.append("phone")
    code = normalize_gps(gps_address)
    if code:
        profiles = _excluding(
            BusinessOwnerProfile.objects.filter(gps_address__iexact=code), "business_owner_id", exclude_owner_id,
        )
        if profiles.exists():
            matched.append("gps_address")
    card = (ghana_card_number or "").strip()
    if card:
        profiles = _excluding(
            BusinessOwnerProfile.objects.filter(ghana_card_number__iexact=card), "business_owner_id", exclude_owner_id,
        )
        if profiles.exists():
            matched.append("ghana_card")
    return matched


def _six(value):
    return Decimal(f"{value:.6f}")


def similar_nearby(name, lat, lng, *, exclude_owner_id=None, radius_m=NEAR_RADIUS_M, threshold=SIMILAR_NAME_THRESHOLD):
    """Businesses with a pin within `radius_m` whose name is trigram-similar
    (pg_trgm, >= `threshold`), nearest first. A bounding box narrows the rows
    before the exact distance is computed."""
    name = (name or "").strip()
    if not name or lat is None or lng is None:
        return []
    lat, lng = float(lat), float(lng)
    d_lat = radius_m / METRES_PER_DEGREE_LAT
    d_lng = radius_m / (METRES_PER_DEGREE_LAT * max(math.cos(math.radians(lat)), 0.01))
    candidates = (
        BusinessOwnerProfile.objects.filter(
            lat__isnull=False, lng__isnull=False,
            lat__gte=_six(lat - d_lat), lat__lte=_six(lat + d_lat),
            lng__gte=_six(lng - d_lng), lng__lte=_six(lng + d_lng),
        )
        .exclude(business_name="")
        .annotate(similarity=TrigramSimilarity("business_name", name))
        .filter(similarity__gte=threshold)
    )
    candidates = _excluding(candidates, "business_owner_id", exclude_owner_id)
    matches = []
    for profile in candidates:
        distance = distance_m(lat, lng, profile.lat, profile.lng)
        if distance <= radius_m:
            matches.append({
                "business_owner_id": profile.business_owner_id,
                "business_name": profile.business_name,
                "distance_m": int(round(distance)),
                "similarity": round(float(profile.similarity), 2),
            })
    matches.sort(key=lambda match: (match["distance_m"], -match["similarity"]))
    return matches


def staff_phone_matches(phone):
    """Active staff whose phone has the same key — compared in Python, so a
    staff phone typed with spaces still matches (the staff table is small)."""
    key = phone_key(phone)
    if not key:
        return []
    staff = (
        StaffUser.objects.filter(is_active=True)
        .exclude(phone__isnull=True).exclude(phone="")
        .select_related("role").order_by("pk")
    )
    return [member for member in staff if phone_key(member.phone) == key]


def registration_checks(*, owner_phone=None, business_name=None, gps_address=None, lat=None, lng=None,
                        ghana_card_number=None, exclude_owner_id=None):
    """The three checks the Register wizard's Review step (and the KYC review
    sheet) shows."""
    return {
        "exact": exact_duplicates(
            phone=owner_phone, gps_address=gps_address, ghana_card_number=ghana_card_number,
            exclude_owner_id=exclude_owner_id,
        ),
        "similar": similar_nearby(business_name, lat, lng, exclude_owner_id=exclude_owner_id),
        "staff_match": bool(staff_phone_matches(owner_phone)),
    }

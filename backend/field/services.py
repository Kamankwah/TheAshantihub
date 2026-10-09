"""Visit check-in rules (spec S5): the distance maths, one open visit per
scout, the outside-radius fraud rule and the 12-hour abandon sweep.

record() is always the LAST thing in a transaction (it holds the activity
chain lock until commit)."""
import math
from datetime import timedelta
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.utils import timezone

from accounts.models import BusinessOwner, ScoutAssignment
from activity.services import record
from fraud.models import FraudFlag
from fraud.services import raise_flag

from .models import RADIUS_M, VisitCheckIn

ABANDON_AFTER = timedelta(hours=12)
FLAG_WINDOW = timedelta(days=7)
FLAGS_BEFORE_REVIEW = 3
MAX_PHOTOS = 10
EARTH_RADIUS_M = 6371008.8

LOCATION_NEEDED = "Location is needed to check in"
CHECKOUT_LOCATION_NEEDED = "Location is needed to check out"
VISIT_CLOSED = "This visit is already closed."


class VisitError(Exception):
    def __init__(self, message, status_code=400, code="invalid"):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


def haversine_m(lat1, lng1, lat2, lng2):
    """Great-circle distance in metres."""
    phi1, phi2 = math.radians(float(lat1)), math.radians(float(lat2))
    d_phi = phi2 - phi1
    d_lambda = math.radians(float(lng2) - float(lng1))
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def business_pin(owner):
    """(lat, lng) of the business pin, or None. A pin at 0,0 is never real."""
    profile = getattr(owner, "profile", None)
    lat, lng = getattr(profile, "lat", None), getattr(profile, "lng", None)
    if lat is None or lng is None or (float(lat) == 0 and float(lng) == 0):
        return None
    return lat, lng


def measure(owner, lat, lng):
    """(distance_m, outside_radius) from a fix to a business pin; (None,
    False) when the business has no pin — the distance can't be measured."""
    pin = business_pin(owner) if owner is not None else None
    if pin is None:
        return None, False
    distance = round(haversine_m(lat, lng, pin[0], pin[1]))
    return distance, distance > RADIUS_M


def _decimal(value):
    return Decimal(str(round(float(value), 6)))


def open_visit(scout):
    return VisitCheckIn.objects.select_related("business_owner", "business_owner__profile", "prospect").filter(
        scout=scout, status=VisitCheckIn.OPEN,
    ).first()


def visit_target(scout, *, business_owner_id=None, scout_assignment_id=None, prospect_id=None):
    """(business_owner, assignment, prospect) the scout may check in at, else
    a 404 — so a scout can't learn which other places exist. A managed
    business needs businesses.manage_portfolio; a verification needs
    scouts.verify and the scout's own open assignment; a prospect needs
    businesses.register and to be the scout's own, not yet registered."""
    perms = scout.effective_permission_codenames()
    if prospect_id:
        from .models import Prospect

        prospect = Prospect.objects.filter(pk=prospect_id, scout=scout).exclude(status=Prospect.REGISTERED).first()
        if prospect is None or "businesses.register" not in perms:
            raise VisitError("We couldn't find that place.", 404, "not_found")
        return None, None, prospect
    if scout_assignment_id:
        assignment = ScoutAssignment.objects.select_related("business_owner__profile").filter(
            pk=scout_assignment_id, scout=scout, status=ScoutAssignment.ASSIGNED,
        ).first()
        if assignment is None or "scouts.verify" not in perms:
            raise VisitError("We couldn't find that place.", 404, "not_found")
        return assignment.business_owner, assignment, None
    owner = BusinessOwner.objects.select_related("profile").filter(
        pk=business_owner_id, account_manager=scout,
    ).exclude(kyc_status=BusinessOwner.REJECTED).first()
    if owner is None or "businesses.manage_portfolio" not in perms:
        raise VisitError("We couldn't find that place.", 404, "not_found")
    return owner, None, None


def prospect_pin(prospect):
    """(lat, lng) of a prospect's pin, or None. A pin at 0,0 is never real."""
    lat, lng = prospect.lat, prospect.lng
    if lat is None or lng is None or (float(lat) == 0 and float(lng) == 0):
        return None
    return lat, lng


def check_in(scout, *, business_owner_id=None, scout_assignment_id=None, prospect_id=None, purpose, lat, lng,
             accuracy_m, request=None):
    if lat is None or lng is None or accuracy_m is None:
        raise VisitError(LOCATION_NEEDED)
    owner, assignment, prospect = visit_target(
        scout, business_owner_id=business_owner_id, scout_assignment_id=scout_assignment_id,
        prospect_id=prospect_id,
    )
    if assignment is not None:
        purpose = VisitCheckIn.VERIFICATION
    elif purpose == VisitCheckIn.VERIFICATION:
        raise VisitError("A verification visit starts from a verification assignment.")
    now = timezone.now()
    if prospect is not None:
        pin = prospect_pin(prospect)
        distance = round(haversine_m(lat, lng, pin[0], pin[1])) if pin else None
        outside = distance is not None and distance > RADIUS_M
    else:
        distance, outside = measure(owner, lat, lng)
    try:
        with transaction.atomic():
            current = VisitCheckIn.objects.select_for_update().filter(scout=scout, status=VisitCheckIn.OPEN).first()
            if current is not None:
                raise VisitError(f"Check out of {_place(current)} first", 409, "open_visit")
            visit = VisitCheckIn.objects.create(
                scout=scout, business_owner=owner, scout_assignment=assignment, prospect=prospect, purpose=purpose,
                checked_in_at=now, lat=_decimal(lat), lng=_decimal(lng), accuracy_m=round(accuracy_m),
                distance_m=distance, outside_radius=outside,
            )
            if prospect is not None and prospect_pin(prospect) is None:
                # The first check-in at a prospect gives it its map pin.
                prospect.lat, prospect.lng, prospect.accuracy_m = _decimal(lat), _decimal(lng), round(accuracy_m)
                prospect.save(update_fields=["lat", "lng", "accuracy_m", "updated_at"])
            if outside:
                _maybe_open_review(scout, visit, now)
            record(scout, "visit.check_in", target=visit,
                   after={"business_owner_id": owner.pk if owner else None,
                          "prospect_id": prospect.pk if prospect else None, "purpose": purpose,
                          "distance_m": distance,
                          "outside_radius": outside}, request=request)
    except IntegrityError:
        # Two check-ins at once: the partial unique constraint kept the first.
        raise VisitError("Check out of your open visit first", 409, "open_visit") from None
    return visit


def _place(visit):
    if visit.business_owner_id:
        return visit.business_owner.display_name
    return visit.prospect.name if visit.prospect_id else "your open visit"


def _place_name(visit):
    if visit.business_owner_id:
        return visit.business_owner.display_name
    return visit.prospect.name if visit.prospect_id else "Visit"


def _maybe_open_review(scout, visit, now):
    """Spec S9: three outside-radius check-ins in 7 days open a fraud case,
    once. An open case for this scout stands in for any later ones."""
    recent = VisitCheckIn.objects.filter(
        scout=scout, outside_radius=True, checked_in_at__gte=now - FLAG_WINDOW,
    ).exclude(status=VisitCheckIn.ABANDONED).select_related("business_owner", "prospect").order_by("checked_in_at", "id")
    rows = list(recent)
    if len(rows) < FLAGS_BEFORE_REVIEW:
        return None
    if FraudFlag.objects.filter(
        kind=FraudFlag.OUTSIDE_RADIUS, staff_subject=scout, status=FraudFlag.OPEN,
    ).exists():
        return None
    third = rows[FLAGS_BEFORE_REVIEW - 1]
    evidence = [
        f"{_place_name(row)} · {row.distance_m} m · "
        f"{timezone.localtime(row.checked_in_at):%d %b %H:%M}"
        for row in rows[-5:]
    ]
    return raise_flag(
        FraudFlag.OUTSIDE_RADIUS,
        title=f"{scout.full_name}: {len(rows)} check-ins outside the {RADIUS_M} m radius in 7 days",
        detail="Repeated check-ins further than the allowed radius from the business pin.",
        evidence=evidence, staff_subject=scout, source=FraudFlag.SYSTEM,
        dedupe_key=f"outside-radius:{scout.pk}:{timezone.localtime(third.checked_in_at).date().isoformat()}",
    )


def update_open_visit(visit, *, purpose=None, notes=None, request=None):
    if visit.status != VisitCheckIn.OPEN:
        raise VisitError(VISIT_CLOSED, 409, "closed")
    before = {"purpose": visit.purpose, "notes": visit.notes}
    if purpose is not None:
        if visit.scout_assignment_id and purpose != VisitCheckIn.VERIFICATION:
            raise VisitError("A verification visit keeps its purpose.")
        if purpose == VisitCheckIn.VERIFICATION and not visit.scout_assignment_id:
            raise VisitError("A verification visit starts from a verification assignment.")
        visit.purpose = purpose
    if notes is not None:
        visit.notes = notes
    with transaction.atomic():
        visit.save(update_fields=["purpose", "notes"])
        record(visit.scout, "visit.update", target=visit, before={"purpose": before["purpose"]},
               after={"purpose": visit.purpose}, request=request)
    return visit


def check_out(visit, *, lat, lng, accuracy_m, notes=None, request=None):
    if lat is None or lng is None or accuracy_m is None:
        raise VisitError(CHECKOUT_LOCATION_NEEDED)
    with transaction.atomic():
        locked = VisitCheckIn.objects.select_for_update().get(pk=visit.pk)
        if locked.status != VisitCheckIn.OPEN:
            raise VisitError(VISIT_CLOSED, 409, "closed")
        locked.status = VisitCheckIn.DONE
        locked.checked_out_at = timezone.now()
        locked.out_lat, locked.out_lng, locked.out_accuracy_m = _decimal(lat), _decimal(lng), round(accuracy_m)
        if notes is not None:
            locked.notes = notes
        locked.save(update_fields=["status", "checked_out_at", "out_lat", "out_lng", "out_accuracy_m", "notes"])
        record(locked.scout, "visit.check_out", target=locked, after={"minutes": locked.minutes}, request=request)
    return locked


def abandon_stale_visits(now=None):
    """Open visits older than 12 hours become abandoned and never count.
    Idempotent; returns how many it closed."""
    cutoff = (now or timezone.now()) - ABANDON_AFTER
    return VisitCheckIn.objects.filter(status=VisitCheckIn.OPEN, checked_in_at__lt=cutoff).update(
        status=VisitCheckIn.ABANDONED,
    )


def add_photo(visit, image, *, lat=None, lng=None, accuracy_m=None, request=None):
    from .models import VisitPhoto

    with transaction.atomic():
        photo = VisitPhoto.objects.create(
            visit=visit, image=image,
            lat=_decimal(lat) if lat is not None else None, lng=_decimal(lng) if lng is not None else None,
            accuracy_m=round(accuracy_m) if accuracy_m is not None else None,
        )
        record(visit.scout, "visit.photo", target=visit,
               after={"photo_id": photo.pk, "located": lat is not None}, request=request)
    return photo

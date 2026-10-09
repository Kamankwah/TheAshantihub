"""Request and response shapes for the visit endpoints (spec S5)."""
from rest_framework import serializers

from accounts.validators import validate_image_content_type
from portfolio.serializers import FiniteFloatField

from .models import RADIUS_M, VisitCheckIn
from .services import business_pin

MAX_ACCURACY_M = 100
ROUGH_FIX = "Your location is too rough (about {} m). Move to open sky or wait a moment, then try again."
OUTSIDE_GHANA = "This location isn't in Ghana. Check your phone's location and try again."
GHANA_LAT = (4.5, 11.2)
GHANA_LNG = (-3.3, 1.3)


class FixSerializer(serializers.Serializer):
    """One reading of the phone's position. Required: a missing fix is the
    view's "Location is needed" answer, so the fields are optional here."""

    lat = FiniteFloatField(required=False, allow_null=True, min_value=-90, max_value=90)
    lng = FiniteFloatField(required=False, allow_null=True, min_value=-180, max_value=180)
    accuracy_m = FiniteFloatField(required=False, allow_null=True, min_value=0, max_value=1000000)

    def validate(self, attrs):
        lat, lng, accuracy = attrs.get("lat"), attrs.get("lng"), attrs.get("accuracy_m")
        if lat is None or lng is None or accuracy is None:
            return attrs  # the view answers "Location is needed"
        if not (GHANA_LAT[0] <= lat <= GHANA_LAT[1] and GHANA_LNG[0] <= lng <= GHANA_LNG[1]):
            raise serializers.ValidationError({"detail": OUTSIDE_GHANA})
        if accuracy > MAX_ACCURACY_M:
            raise serializers.ValidationError({"detail": ROUGH_FIX.format(round(accuracy))})
        return attrs


class CheckInSerializer(FixSerializer):
    business_owner = serializers.IntegerField(required=False, allow_null=True)
    scout_assignment = serializers.IntegerField(required=False, allow_null=True)
    purpose = serializers.ChoiceField(choices=VisitCheckIn.PURPOSE_CHOICES, required=False)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if bool(attrs.get("business_owner")) == bool(attrs.get("scout_assignment")):
            raise serializers.ValidationError({"detail": "Pick the place you are visiting."})
        if not attrs.get("scout_assignment") and not attrs.get("purpose"):
            raise serializers.ValidationError({"purpose": "Pick a purpose for the visit."})
        return attrs


class CheckOutSerializer(FixSerializer):
    notes = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class VisitUpdateSerializer(serializers.Serializer):
    purpose = serializers.ChoiceField(choices=VisitCheckIn.PURPOSE_CHOICES, required=False)
    notes = serializers.CharField(required=False, allow_blank=True, max_length=2000)


class VisitPhotoSerializer(serializers.Serializer):
    image = serializers.ImageField(validators=[validate_image_content_type])
    lat = FiniteFloatField(required=False, allow_null=True, min_value=-90, max_value=90)
    lng = FiniteFloatField(required=False, allow_null=True, min_value=-180, max_value=180)
    accuracy_m = FiniteFloatField(required=False, allow_null=True, min_value=0, max_value=100000)


def _float(value):
    return float(value) if value is not None else None


def visit_item(visit, request=None):
    """One visit as the screens show it."""
    owner = visit.business_owner
    profile = getattr(owner, "profile", None) if owner is not None else None
    pin = business_pin(owner) if owner is not None else None
    zone = getattr(profile, "zone", None)
    return {
        "id": visit.pk,
        "status": visit.status,
        "purpose": visit.purpose,
        "purpose_label": visit.get_purpose_display(),
        "business": {
            "id": owner.pk, "name": owner.display_name, "area": zone.name if zone else None,
            "has_pin": pin is not None,
        } if owner is not None else None,
        "scout_assignment_id": visit.scout_assignment_id,
        "scout_name": visit.scout.full_name,
        "checked_in_at": visit.checked_in_at,
        "checked_out_at": visit.checked_out_at,
        "minutes": visit.minutes,
        "distance_m": visit.distance_m,
        "outside_radius": visit.outside_radius,
        "radius_m": RADIUS_M,
        "accuracy_m": visit.accuracy_m,
        "fix": {"lat": _float(visit.lat), "lng": _float(visit.lng)},
        "pin": {"lat": _float(pin[0]), "lng": _float(pin[1])} if pin else None,
        "notes": visit.notes,
        "photos": [
            {
                "id": photo.pk,
                "url": request.build_absolute_uri(photo.image.url) if request else photo.image.url,
                "taken_at": photo.taken_at,
            }
            for photo in visit.photos.all()
        ],
    }

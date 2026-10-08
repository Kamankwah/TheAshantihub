"""Request shapes for the portfolio endpoints (staff phase 2A)."""
import math

from rest_framework import serializers

from accounts.gps import validate_ashanti_gps
from accounts.models import BusinessOwner, BusinessOwnerProfile
from accounts.phones import normalize_gh_phone
from accounts.validators import validate_image_content_type
from listings.models import Category, Zone

GHANA_LAT = (4.5, 11.2)
GHANA_LNG = (-3.3, 1.3)
MAX_ACCURACY_M = 100
OUTSIDE_GHANA = "This pin isn't in Ghana. Check the location and try again."
EMAIL_TAKEN = "That email already belongs to another account."


def flag_brief(flag):
    """The short form of a fraud flag shown on registration results and, in
    Task 8, on the business review sheet."""
    return {"id": flag.pk, "kind": flag.kind, "kind_label": flag.get_kind_display(), "title": flag.title}


class ScoutRegistrationSerializer(serializers.Serializer):
    owner_full_name = serializers.CharField(max_length=150)
    owner_phone = serializers.CharField(max_length=40)
    owner_email = serializers.EmailField(required=False, allow_blank=True)
    business_name = serializers.CharField(max_length=150)
    business_kind = serializers.ChoiceField(choices=BusinessOwnerProfile.BUSINESS_KIND_CHOICES)
    business_category = serializers.PrimaryKeyRelatedField(queryset=Category.objects.all())
    zone = serializers.PrimaryKeyRelatedField(queryset=Zone.objects.all())
    gps_address = serializers.CharField(max_length=20)
    lat = serializers.FloatField()
    lng = serializers.FloatField()
    location_accuracy_m = serializers.FloatField(required=False, allow_null=True, min_value=0)
    location_is_manual = serializers.BooleanField(required=False, default=False)
    signboard_photo = serializers.ImageField(validators=[validate_image_content_type])
    ghana_card_front = serializers.ImageField(validators=[validate_image_content_type])
    ghana_card_number = serializers.CharField(required=False, allow_blank=True, max_length=30)
    maker_note = serializers.CharField(required=False, allow_blank=True, max_length=1000)

    def validate_owner_phone(self, value):
        try:
            return normalize_gh_phone(value)
        except ValueError as exc:
            raise serializers.ValidationError(str(exc)) from exc

    def validate_owner_email(self, value):
        value = (value or "").strip()
        if not value:
            return None
        if BusinessOwner.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError(EMAIL_TAKEN)
        return value

    def validate_gps_address(self, value):
        return validate_ashanti_gps(value)

    def validate_lat(self, value):
        if not GHANA_LAT[0] <= value <= GHANA_LAT[1]:
            raise serializers.ValidationError(OUTSIDE_GHANA)
        return value

    def validate_lng(self, value):
        if not GHANA_LNG[0] <= value <= GHANA_LNG[1]:
            raise serializers.ValidationError(OUTSIDE_GHANA)
        return value

    def validate_location_accuracy_m(self, value):
        return None if value is None else int(math.ceil(value))

    def validate_ghana_card_number(self, value):
        return (value or "").strip().upper() or None

    def validate(self, attrs):
        if attrs["business_category"].kind != attrs["business_kind"]:
            raise serializers.ValidationError(
                {"business_category": ["Choose a category for this kind of business."]}
            )
        if not attrs.get("location_is_manual"):
            accuracy = attrs.get("location_accuracy_m")
            if accuracy is None:
                raise serializers.ValidationError(
                    {"location_accuracy_m": ["Say how accurate the location is, or place the pin by hand."]}
                )
            if accuracy > MAX_ACCURACY_M:
                raise serializers.ValidationError({"lat": [
                    f"Location isn't accurate enough (±{accuracy} m). "
                    "Wait for a better fix, or place the pin by hand."
                ]})
        return attrs


class KycResubmitSerializer(serializers.Serializer):
    signboard_photo = serializers.ImageField(required=False, validators=[validate_image_content_type])
    ghana_card_front = serializers.ImageField(required=False, validators=[validate_image_content_type])
    maker_note = serializers.CharField(required=False, allow_blank=True, max_length=1000)

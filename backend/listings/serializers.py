from rest_framework import serializers

from .models import Category, HeroMediaSubmission, Listing, ListingPhoto, Zone


class ListingPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingPhoto
        fields = ["id", "image", "order"]


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "slug", "icon", "label", "color", "kind"]


class ZoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = Zone
        fields = ["id", "name"]


class PublicListingSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)
    zone = ZoneSerializer(read_only=True)
    photos = ListingPhotoSerializer(many=True, read_only=True)

    class Meta:
        model = Listing
        fields = [
            "id", "name", "description", "category", "zone", "price_amount", "price_unit",
            "tag", "contact_phone", "lat", "lng", "main_photo", "photos", "created_at",
        ]


class OwnerListingSerializer(serializers.ModelSerializer):
    # Read-only nested gallery so a business owner's own listing view (used by
    # the "Submit for Hero" flow to pick a photo) can show the gallery without
    # a second round-trip — same shape as PublicListingSerializer/
    # ModerationListingSerializer's `photos` field.
    photos = ListingPhotoSerializer(many=True, read_only=True)

    class Meta:
        model = Listing
        fields = [
            "id", "category", "zone", "name", "description", "price_amount", "price_unit",
            "tag", "contact_phone", "lat", "lng", "main_photo", "photos", "status",
            "rejection_reason", "created_at", "updated_at",
        ]
        read_only_fields = ["status", "rejection_reason", "created_at", "updated_at"]
        extra_kwargs = {"contact_phone": {"required": False}}

    def validate(self, data):
        if self.instance is not None and self.instance.status == Listing.PUBLISHED:
            raise serializers.ValidationError(
                {"status": "Cannot edit a published listing."}
            )
        return data

    def create(self, validated_data):
        owner = self.context["request"].user
        if not validated_data.get("contact_phone"):
            validated_data["contact_phone"] = owner.profile.business_contact_phone
        return Listing.objects.create(business_owner=owner, **validated_data)


class ModerationListingSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)
    zone = ZoneSerializer(read_only=True)
    photos = ListingPhotoSerializer(many=True, read_only=True)

    class Meta:
        model = Listing
        fields = [
            "id", "business_owner", "name", "description", "category", "zone", "price_amount",
            "price_unit", "tag", "contact_phone", "lat", "lng", "main_photo", "photos",
            "status", "rejection_reason", "created_at",
        ]


class HeroMediaModerationSerializer(serializers.ModelSerializer):
    """Staff-facing shape for the hero-media approval queue/detail views —
    mirrors ModerationListingSerializer's field selection.
    """

    business_owner_name = serializers.CharField(source="business_owner.full_name", read_only=True)

    class Meta:
        model = HeroMediaSubmission
        fields = [
            "id", "business_owner", "business_owner_name", "media", "media_type", "caption",
            "status", "rejection_reason", "submitted_at", "approved_at", "expires_at",
            "extended_days",
        ]


class HeroActiveSerializer(serializers.ModelSerializer):
    """Public shape for the live hero slider — GET /api/hero/active/."""

    business_name = serializers.CharField(source="business_owner.full_name", read_only=True)

    class Meta:
        model = HeroMediaSubmission
        fields = [
            "id", "media", "media_type", "caption", "business_name", "approved_at", "expires_at",
        ]


class HeroSubmitSerializer(serializers.Serializer):
    """Input shape for POST /api/hero/submit/ — references an existing
    ListingPhoto (by id) the business already owns, plus a caption. Ownership
    and outstanding-submission checks happen in the view (HeroSubmitView),
    not here, so they can return distinct 403/400 status codes rather than a
    generic 400 validation error — this serializer only validates shape.
    """

    listing_photo = serializers.IntegerField()
    caption = serializers.CharField(max_length=140)

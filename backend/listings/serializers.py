from rest_framework import serializers

from .models import Category, Listing, ListingPhoto, Zone


class ListingPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingPhoto
        fields = ["id", "image", "order"]


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "slug", "icon", "label", "color"]


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
    class Meta:
        model = Listing
        fields = [
            "id", "category", "zone", "name", "description", "price_amount", "price_unit",
            "tag", "contact_phone", "lat", "lng", "main_photo", "status", "rejection_reason",
            "created_at", "updated_at",
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

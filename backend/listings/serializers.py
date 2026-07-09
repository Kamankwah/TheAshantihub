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

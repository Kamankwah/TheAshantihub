from rest_framework import serializers

from .models import ListingPhoto


class ListingPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingPhoto
        fields = ["id", "image", "order"]

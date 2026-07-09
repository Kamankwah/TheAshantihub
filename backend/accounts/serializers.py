from django.contrib.auth.hashers import make_password
from rest_framework import serializers

from .models import Customer


class CustomerRegistrationSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = Customer
        fields = ["id", "full_name", "phone", "email", "password"]

    def validate(self, attrs):
        phone = attrs.get("phone")
        email = attrs.get("email")
        if not phone and not email:
            raise serializers.ValidationError(
                "At least one of phone or email is required."
            )
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        validated_data["password_hash"] = make_password(password)
        return Customer.objects.create(**validated_data)

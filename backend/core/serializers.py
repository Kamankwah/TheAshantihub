from rest_framework import serializers

from .models import SiteSettings


class SiteSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = SiteSettings
        fields = [
            "contact_email",
            "contact_phone",
            "contact_address",
            "facebook_url",
            "instagram_url",
            "linkedin_url",
            "twitter_url",
            "warranty_returns_policy",
            "service_dispute_policy",
        ]

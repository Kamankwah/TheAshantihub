from django.conf import settings
from rest_framework import serializers

from .models import SiteSettings


class SiteSettingsSerializer(serializers.ModelSerializer):
    # Read-only, derived straight from settings.PAYMENTS_PROVIDER (itself
    # derived from whether HUBTEL_CLIENT_ID is set, not a separately-toggled
    # flag — see backend/ashantihub/settings.py) — rides this already-
    # publicly-fetched-everywhere endpoint (useSiteSettings()) so the
    # frontend's MoMoPayment/MoMoModal (frontend/App.jsx) can branch on it
    # without a dedicated endpoint. Can never drift from or be overridden
    # independent of the backend's actual env-driven state.
    payments_provider = serializers.SerializerMethodField()

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
            "tiktok_url",
            "youtube_url",
            "whatsapp_number",
            "support_hours",
            "warranty_returns_policy",
            "service_dispute_policy",
            "payments_provider",
        ]

    def get_payments_provider(self, obj):
        return settings.PAYMENTS_PROVIDER

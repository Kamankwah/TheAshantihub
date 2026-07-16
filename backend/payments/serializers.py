from rest_framework import serializers

from .models import CheckoutSession


class CheckoutSessionStatusSerializer(serializers.ModelSerializer):
    """Backs GET /api/payments/checkout-sessions/{reference}/ — the
    frontend's /payment/return polling page. Deliberately narrow: no
    metadata (may carry internal ids not meant for the client), no
    business_owner/customer/transaction FKs.
    """

    class Meta:
        model = CheckoutSession
        fields = ["reference", "kind", "amount", "purpose", "status", "checkout_url", "created_at"]

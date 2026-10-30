from rest_framework import serializers

from .models import CheckoutSession


class CheckoutSessionStatusSerializer(serializers.ModelSerializer):
    """Backs GET /api/payments/checkout-sessions/{reference}/ — the
    frontend's /payment/return polling page. Deliberately narrow: no
    metadata (may carry internal ids not meant for the client), no
    business_owner/customer/transaction FKs.
    """

    # processing_fee: the collection charge already inside `amount` ("0.00" for a wallet payment). wallet: paid from the
    # AshantiHub wallet. order_id: the order an order checkout is paying for (null for any other kind). Each reads one
    # stored value; the metadata itself is never exposed.
    wallet = serializers.SerializerMethodField()
    order_id = serializers.SerializerMethodField()

    def get_wallet(self, obj):
        return obj.provider == CheckoutSession.WALLET

    def get_order_id(self, obj):
        order_id = (obj.metadata or {}).get("order_id")
        return order_id if isinstance(order_id, int) and not isinstance(order_id, bool) else None

    class Meta:
        model = CheckoutSession
        fields = [
            "reference", "kind", "amount", "purpose", "status", "checkout_url", "created_at",
            "processing_fee", "wallet", "order_id",
        ]

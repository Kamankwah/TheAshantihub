from rest_framework import serializers

from .models import Dispute


class DisputeSerializer(serializers.ModelSerializer):
    """Read shape used both by the staff queue (DisputeListView) and as the
    response body for the customer-facing create endpoint
    (orders.views.OrderDisputeCreateView) — same "one serializer, multiple
    callers" convention as reviews.ReviewSerializer.
    """

    raised_by_name = serializers.CharField(source="raised_by.full_name", read_only=True, default=None)
    flagged_by_name = serializers.CharField(source="flagged_by.full_name", read_only=True, default=None)
    resolved_by_name = serializers.CharField(source="resolved_by.full_name", read_only=True, default=None)
    order_total_amount = serializers.SerializerMethodField()
    order_status = serializers.SerializerMethodField()

    class Meta:
        model = Dispute
        fields = [
            "id", "order", "order_total_amount", "order_status",
            "raised_by", "raised_by_name", "reason", "description", "status",
            "resolution_notes", "refund_amount",
            "flagged_by", "flagged_by_name", "resolved_by", "resolved_by_name",
            "created_at", "updated_at",
        ]
        read_only_fields = fields

    def get_order_total_amount(self, obj):
        # str(), not the raw Decimal — DRF's JSONRenderer would otherwise
        # serialize a bare Decimal via float and drop trailing zeros
        # (e.g. "150.00" -> 150.0), matching billing.TransactionReportSerializer's
        # SerializerMethodField-for-a-nullable-FK-attribute convention.
        return str(obj.order.total_amount) if obj.order_id else None

    def get_order_status(self, obj):
        return obj.order.status if obj.order_id else None


class DisputeResolveSerializer(serializers.Serializer):
    """Input shape for POST /api/disputes/{id}/resolve/. `outcome` defaults
    to "resolved" — pass "rejected" for a dispute investigated and found not
    to warrant a refund/action, the 4th status value Dispute.STATUS_CHOICES
    defines. Shape validation only; the "already resolved/rejected" business
    rule lives in the view (mirrors ReviewSubmitSerializer/
    PromotionPurchaseSerializer's split).
    """

    outcome = serializers.ChoiceField(choices=["resolved", "rejected"], required=False, default="resolved")
    refund_amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, allow_null=True, default=None
    )
    resolution_notes = serializers.CharField(required=False, allow_blank=True, default="")

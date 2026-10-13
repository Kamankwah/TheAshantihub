from rest_framework import serializers

from .models import Dispute, DisputeEvidence


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


class DisputeEvidenceSerializer(serializers.ModelSerializer):
    added_by_name = serializers.CharField(source="added_by.full_name", read_only=True, default=None)
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = DisputeEvidence
        fields = ["id", "kind", "title", "body", "file_url", "added_by_name", "created_at"]
        read_only_fields = fields

    def get_file_url(self, obj):
        if not obj.file:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(obj.file.url) if request else obj.file.url


class DisputeStaffSerializer(DisputeSerializer):
    """The staff queue's shape: DisputeSerializer plus the intake fields. Never
    used for the customer's own response, which must not carry Support's
    internal summary."""

    raised_by_kind = serializers.SerializerMethodField()
    customer_id = serializers.SerializerMethodField()
    customer_name = serializers.SerializerMethodField()
    businesses = serializers.SerializerMethodField()
    logged_by_name = serializers.CharField(source="logged_by.full_name", read_only=True, default=None)
    conversation_label = serializers.SerializerMethodField()

    class Meta(DisputeSerializer.Meta):
        fields = DisputeSerializer.Meta.fields + [
            "problem_type", "customer_ask", "intake_summary", "conversation", "conversation_label",
            "logged_by", "logged_by_name", "raised_by_kind", "customer_id", "customer_name", "businesses",
        ]
        read_only_fields = fields

    def _customer(self, obj):
        if obj.raised_by_id:
            return obj.raised_by
        return obj.order.customer if obj.order_id else None

    def get_raised_by_kind(self, obj):
        return "customer" if obj.raised_by_id else "staff"

    def get_customer_id(self, obj):
        customer = self._customer(obj)
        return customer.pk if customer else None

    def get_customer_name(self, obj):
        customer = self._customer(obj)
        return customer.full_name if customer else None

    def get_businesses(self, obj):
        if not obj.order_id:
            return []
        return sorted({line.listing.business_owner.display_name for line in obj.order.items.all()})

    def get_conversation_label(self, obj):
        return obj.conversation.subject if obj.conversation_id else None


class DisputeDetailSerializer(DisputeStaffSerializer):
    """One dispute with its evidence: what Support attached, plus the records
    that attach themselves (the customer's words, the delivery stamps, calls
    logged against the order). Only what exists is listed."""

    evidence = DisputeEvidenceSerializer(many=True, read_only=True)
    records = serializers.SerializerMethodField()

    class Meta(DisputeStaffSerializer.Meta):
        fields = DisputeStaffSerializer.Meta.fields + ["evidence", "records"]
        read_only_fields = fields

    def get_records(self, obj):
        records = []
        if obj.description:
            records.append({"key": "words", "title": "Customer's own words", "detail": obj.description, "at": obj.created_at})
        if obj.order_id:
            from calls.models import CallLog
            from orders.support import delivery_events_for

            stamps = [e for e in delivery_events_for(obj.order) if e["key"] in ("assigned", "picked_up", "delivered", "confirmed")]
            if stamps:
                records.append({
                    "key": "delivery", "title": "Delivery record",
                    "detail": "; ".join(f"{e['label']}" for e in stamps), "at": stamps[-1]["at"],
                })
            calls = CallLog.objects.filter(related_type="orders.order", related_id=str(obj.order_id))
            if calls.exists():
                records.append({
                    "key": "calls", "title": "Calls logged on this order",
                    "detail": f"{calls.count()} logged", "at": calls.first().started_at,
                })
        return records


class DisputeIntakeSerializer(serializers.Serializer):
    problem_type = serializers.ChoiceField(choices=Dispute.PROBLEM_CHOICES, required=False)
    customer_ask = serializers.ChoiceField(choices=Dispute.ASK_CHOICES, required=False)
    intake_summary = serializers.CharField(required=False, allow_blank=True, max_length=4000)
    conversation = serializers.IntegerField(required=False, allow_null=True)


class DisputeLogSerializer(DisputeIntakeSerializer):
    order = serializers.IntegerField()
    description = serializers.CharField(max_length=4000)


class DisputeEvidenceInputSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=150)
    body = serializers.CharField(required=False, allow_blank=True, max_length=4000, default="")
    file = serializers.FileField(required=False)

    def validate_file(self, file):
        from accounts.validators import validate_document_content_type

        validate_document_content_type(file)
        if file.size > 10 * 1024 * 1024:
            raise serializers.ValidationError("The file is over 10 MB.")
        return file

    def validate(self, data):
        if not data.get("body", "").strip() and not data.get("file"):
            raise serializers.ValidationError("Add a note or a file.")
        return data

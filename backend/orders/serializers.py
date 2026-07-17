from rest_framework import serializers

from disputes.models import Dispute

from .models import Order, OrderItem


class OrderItemSerializer(serializers.ModelSerializer):
    listing_name = serializers.CharField(source="listing.name", read_only=True)

    class Meta:
        model = OrderItem
        fields = ["id", "listing", "listing_name", "quantity", "unit_price", "line_total"]


DELIVERY_FIELDS = [
    "delivery_method", "delivery_address", "delivery_phone", "delivery_lat", "delivery_lng",
]


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = [
            "id", "status", "delivery_status", "total_amount", "placed_at", "items",
            *DELIVERY_FIELDS,
        ]


class StaffOrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source="customer.full_name", read_only=True)

    class Meta:
        model = Order
        fields = [
            "id", "customer", "customer_name", "status", "delivery_status",
            "total_amount", "placed_at", "items", *DELIVERY_FIELDS,
        ]


class OwnerOrderSerializer(serializers.ModelSerializer):
    """A business owner's view of an order that contains their listings (Wave
    F). Exposes ONLY the caller's own line items (a shared order may span
    multiple businesses) and an owner_subtotal over just those lines — not the
    order's full total, which would include other businesses' items. Carries
    the delivery info the owner needs to fulfil or hand off.
    """

    items = serializers.SerializerMethodField()
    owner_subtotal = serializers.SerializerMethodField()
    customer_name = serializers.CharField(source="customer.full_name", read_only=True)

    class Meta:
        model = Order
        fields = [
            "id", "customer_name", "status", "delivery_status", "placed_at",
            "items", "owner_subtotal", *DELIVERY_FIELDS,
        ]

    def _own_items(self, obj):
        owner = self.context["owner"]
        return [i for i in obj.items.all() if i.listing.business_owner_id == owner.id]

    def get_items(self, obj):
        return OrderItemSerializer(self._own_items(obj), many=True).data

    def get_owner_subtotal(self, obj):
        return str(sum((i.line_total for i in self._own_items(obj)), 0))


class OrderDeliveryStatusUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Order
        fields = ["delivery_status"]


class OrderDisputeCreateSerializer(serializers.Serializer):
    """Input shape for POST /api/orders/{id}/dispute/ — shape validation
    only, same convention as ReviewSubmitSerializer/ContactMessageSubmitSerializer.
    The view creates the disputes.Dispute row directly (order/raised_by/
    status aren't caller-supplied)."""

    reason = serializers.ChoiceField(choices=Dispute.REASON_CHOICES)
    description = serializers.CharField()

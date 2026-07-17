from rest_framework import serializers

from disputes.models import Dispute

from .models import DeliveryAssignment, Order, OrderItem


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


class DeliveryAssignmentSerializer(serializers.ModelSerializer):
    dispatch_name = serializers.CharField(source="dispatch.full_name", read_only=True, default=None)

    class Meta:
        model = DeliveryAssignment
        fields = [
            "id", "dispatch", "dispatch_name", "status", "notes",
            "assigned_at", "picked_up_at", "delivered_at", "confirmed_at",
        ]
        read_only_fields = fields


class DeliveryOrderSerializer(serializers.ModelSerializer):
    """The Delivery Manager's view of a paid door-to-door order (item 11):
    what was bought, the customer's delivery details, and the current
    assignment (if any). The Delivery Manager assigns a dispatch to unassigned
    ones.
    """

    items = OrderItemSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source="customer.full_name", read_only=True)
    delivery_assignment = DeliveryAssignmentSerializer(read_only=True)

    class Meta:
        model = Order
        fields = [
            "id", "customer_name", "status", "delivery_status", "placed_at",
            "items", "total_amount", "delivery_assignment", *DELIVERY_FIELDS,
        ]
        read_only_fields = fields


class DispatchDeliverySerializer(serializers.ModelSerializer):
    """A Dispatch's view of their assigned delivery (item 11) — the order's
    items plus BOTH the business pickup location(s) and the customer's delivery
    location/phone, which is what a courier needs to run the job.
    """

    order_id = serializers.IntegerField(source="order.id", read_only=True)
    customer_name = serializers.CharField(source="order.customer.full_name", read_only=True)
    delivery_address = serializers.CharField(source="order.delivery_address", read_only=True)
    delivery_phone = serializers.CharField(source="order.delivery_phone", read_only=True)
    delivery_lat = serializers.FloatField(source="order.delivery_lat", read_only=True, default=None)
    delivery_lng = serializers.FloatField(source="order.delivery_lng", read_only=True, default=None)
    pickups = serializers.SerializerMethodField()

    class Meta:
        model = DeliveryAssignment
        fields = [
            "id", "order_id", "status", "customer_name",
            "delivery_address", "delivery_phone", "delivery_lat", "delivery_lng",
            "pickups", "assigned_at", "picked_up_at", "delivered_at", "confirmed_at",
        ]
        read_only_fields = fields

    def get_pickups(self, obj):
        """One pickup point per distinct business in the order — the courier
        collects each business's items from its location.
        """
        seen = {}
        for item in obj.order.items.all():
            owner = item.listing.business_owner
            if owner.id not in seen:
                seen[owner.id] = {
                    "business_name": owner.full_name,
                    "phone": item.listing.contact_phone,
                    "lat": float(item.listing.lat) if item.listing.lat is not None else None,
                    "lng": float(item.listing.lng) if item.listing.lng is not None else None,
                    "items": [],
                }
            seen[owner.id]["items"].append(f"{item.listing.name} × {item.quantity}")
        return list(seen.values())

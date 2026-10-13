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
# A business owner gets the customer's name and address but never their phone:
# AshantiHub's delivery team runs door-to-door fulfilment, and a phone number
# would open the direct business-to-customer channel the platform forbids.
OWNER_DELIVERY_FIELDS = [f for f in DELIVERY_FIELDS if f != "delivery_phone"]


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    # The courier assignment's status (item 11), so the customer's order card
    # can show progress and reveal the "confirm receipt" button once it's
    # been delivered. SerializerMethodField, not a nested serializer, to avoid
    # a circular reference (DeliveryAssignmentSerializer is defined below) and
    # because the customer only needs the status string, not the courier's id.
    delivery_assignment_status = serializers.SerializerMethodField()
    # The four-digit code the customer reads to the rider at the door. Shown only while a rider holds
    # the job and has not yet delivered it; it is the customer's, never the business's or a manager's.
    delivery_code = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id", "status", "delivery_status", "total_amount", "placed_at", "items",
            "delivery_assignment_status", "delivery_code", "delivery_fee", *DELIVERY_FIELDS,
        ]

    def get_delivery_assignment_status(self, obj):
        assignment = getattr(obj, "delivery_assignment", None)
        return assignment.status if assignment else None

    def get_delivery_code(self, obj):
        assignment = getattr(obj, "delivery_assignment", None)
        if assignment is None or assignment.status not in DeliveryAssignment.ACTIVE_STATUSES:
            return None
        return assignment.drop_code or None

    def to_representation(self, obj):
        data = super().to_representation(obj)
        # Only an order that used a coupon carries these, so every other response is unchanged.
        if obj.coupon_id:
            data["discount_amount"] = str(obj.discount_amount)
            data["coupon_code"] = obj.coupon.code
        return data


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
    the delivery info the owner needs to fulfil or hand off — name and
    address only, never the customer's phone (see OWNER_DELIVERY_FIELDS).
    """

    items = serializers.SerializerMethodField()
    owner_subtotal = serializers.SerializerMethodField()
    customer_name = serializers.CharField(source="customer.full_name", read_only=True)
    # The four-digit code the rider asks this business for at the counter. Only the business the rider
    # collects from (the order's first, v1 delivers one pickup per order) sees it, and only until pickup.
    pickup_code = serializers.SerializerMethodField()
    # True while a rider is heading to THIS business (same gate as the owner tracking endpoint:
    # assigned/accepted/at_pickup and this owner is the pickup business). Tells the owner nothing the
    # tracking endpoint would not.
    rider_heading_here = serializers.SerializerMethodField()

    class Meta:
        model = Order
        fields = [
            "id", "customer_name", "status", "delivery_status", "placed_at",
            "items", "owner_subtotal", "pickup_code", "rider_heading_here", *OWNER_DELIVERY_FIELDS,
        ]

    def _heading_assignment(self, obj):
        """The order's assignment when a rider is heading to this owner's shop, else None."""
        assignment = getattr(obj, "delivery_assignment", None)
        if assignment is None or assignment.status not in (
            DeliveryAssignment.ASSIGNED, DeliveryAssignment.ACCEPTED, DeliveryAssignment.AT_PICKUP,
        ):
            return None
        first = min(obj.items.all(), key=lambda i: i.pk, default=None)
        if first is None or first.listing.business_owner_id != self.context["owner"].id:
            return None
        return assignment

    def get_pickup_code(self, obj):
        assignment = self._heading_assignment(obj)
        return (assignment.pickup_code or None) if assignment else None

    def get_rider_heading_here(self, obj):
        return self._heading_assignment(obj) is not None

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

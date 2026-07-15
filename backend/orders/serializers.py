from rest_framework import serializers

from .models import Order, OrderItem


class OrderItemSerializer(serializers.ModelSerializer):
    listing_name = serializers.CharField(source="listing.name", read_only=True)

    class Meta:
        model = OrderItem
        fields = ["id", "listing", "listing_name", "quantity", "unit_price", "line_total"]


class OrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = ["id", "status", "delivery_status", "total_amount", "placed_at", "items"]


class StaffOrderSerializer(serializers.ModelSerializer):
    items = OrderItemSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source="customer.full_name", read_only=True)

    class Meta:
        model = Order
        fields = [
            "id", "customer", "customer_name", "status", "delivery_status",
            "total_amount", "placed_at", "items",
        ]


class OrderDeliveryStatusUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Order
        fields = ["delivery_status"]

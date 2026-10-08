from decimal import Decimal

from rest_framework import serializers

from listings.models import Listing
from listings.visibility import hidden_business_q

from .models import Cart, CartItem


class CartItemSerializer(serializers.ModelSerializer):
    listing_name = serializers.CharField(source="listing.name", read_only=True)
    line_total = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model = CartItem
        fields = [
            "id", "listing", "listing_name", "quantity",
            "unit_price_snapshot", "line_total", "added_at",
        ]
        read_only_fields = ["id", "listing", "listing_name", "unit_price_snapshot", "line_total", "added_at"]


class CartItemUpdateSerializer(serializers.ModelSerializer):
    """Update-only serializer for PATCH /api/cart/items/{id}/ — quantity is
    the only mutable field on an existing cart line (changing the listing
    itself is "remove + add a new line", not an update).
    """

    class Meta:
        model = CartItem
        fields = ["quantity"]
        extra_kwargs = {"quantity": {"min_value": 1}}


class CartSerializer(serializers.ModelSerializer):
    items = CartItemSerializer(many=True, read_only=True)
    total = serializers.SerializerMethodField()

    class Meta:
        model = Cart
        fields = ["id", "items", "total", "created_at", "updated_at"]

    def get_total(self, obj):
        # str(), not the raw Decimal — a SerializerMethodField bypasses
        # DecimalField's own str-coercion, and DRF's JSONEncoder falls back
        # to float() for any Decimal it encounters directly (see
        # rest_framework.utils.encoders.JSONEncoder.default), which would
        # silently lose precision/trailing zeros.
        total = sum((item.line_total for item in obj.items.all()), Decimal("0.00"))
        return str(total)


# A hidden business's listing is out of browse, so only a stale page leads
# here; the customer is told plainly without being told why.
HIDDEN_LISTING_MESSAGE = "This item isn't available right now."


class CartItemCreateSerializer(serializers.Serializer):
    """Input serializer for POST /api/cart/items/. Only published listings may
    be added — the queryset filter below rejects anything else with a 400
    "object does not exist" validation error. A listing whose business is
    suspended or paused by the subscription clock (listings.visibility) is
    refused with HIDDEN_LISTING_MESSAGE.
    """

    listing = serializers.PrimaryKeyRelatedField(
        queryset=Listing.objects.filter(status=Listing.PUBLISHED)
    )
    quantity = serializers.IntegerField(min_value=1, default=1)

    def validate_listing(self, listing):
        if Listing.objects.filter(pk=listing.pk).filter(hidden_business_q()).exists():
            raise serializers.ValidationError(HIDDEN_LISTING_MESSAGE)
        return listing

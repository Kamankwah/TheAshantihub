from decimal import Decimal

from django.db.models import Prefetch
from rest_framework import serializers

from accounts import direct
from listings import variants
from listings.models import Listing
from listings.visibility import hidden_business_q

from .models import Cart, CartItem


class CartItemSerializer(serializers.ModelSerializer):
    listing_name = serializers.CharField(source="listing.name", read_only=True)
    line_total = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    variant_label = serializers.SerializerMethodField()
    # What the cart and checkout pages show beside each line. seller_name is what "Sold by" shows (the business name);
    # stock_quantity is the variant's for a variant line, else the listing's, null when stock is not counted.
    listing_photo = serializers.ImageField(source="listing.main_photo", read_only=True)
    seller_name = serializers.CharField(source="listing.business_owner.display_name", read_only=True)
    is_ashanti_direct = serializers.SerializerMethodField()
    in_stock = serializers.SerializerMethodField()
    stock_quantity = serializers.SerializerMethodField()

    def get_variant_label(self, obj):
        return obj.variant.label if obj.variant_id else ""

    def get_is_ashanti_direct(self, obj):
        return direct.is_direct(obj.listing.business_owner)

    def get_stock_quantity(self, obj):
        return obj.variant.stock_quantity if obj.variant_id else obj.listing.stock_quantity

    def get_in_stock(self, obj):
        stock = self.get_stock_quantity(obj)
        return stock is None or stock > 0

    class Meta:
        model = CartItem
        fields = [
            "id", "listing", "listing_name", "variant", "variant_label", "quantity",
            "unit_price_snapshot", "line_total", "added_at",
            "listing_photo", "seller_name", "is_ashanti_direct", "in_stock", "stock_quantity",
        ]
        read_only_fields = ["id", "listing", "listing_name", "variant", "unit_price_snapshot", "line_total", "added_at"]


def cart_with_lines(cart_id):
    """The cart with each line's listing, seller and variant loaded up front (no query per line)."""
    return Cart.objects.prefetch_related(
        Prefetch("items", queryset=CartItem.objects.select_related("listing", "listing__business_owner__profile", "variant"))
    ).get(pk=cart_id)


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
    # A variant listing is bought through `variant` (+ quantity) or `lines` ([{variant, quantity}, ...]).
    variant = serializers.IntegerField(required=False, allow_null=True)
    lines = serializers.ListField(
        child=serializers.DictField(), required=False, allow_empty=False, max_length=variants.MAX_VARIANTS,
    )

    def validate_listing(self, listing):
        if Listing.objects.filter(pk=listing.pk).filter(hidden_business_q()).exists():
            raise serializers.ValidationError(HIDDEN_LISTING_MESSAGE)
        return listing

    def validate(self, attrs):
        """Resolve what is being bought into attrs["entries"]: [(variant or None, quantity)], all valid or an error."""
        listing = attrs["listing"]
        asked = []  # (variant id or None, quantity)
        if attrs.get("lines") is not None:
            if attrs.get("variant") is not None:
                raise serializers.ValidationError({"lines": "Send either variant or lines, not both."})
            for line in attrs["lines"]:
                asked.append((self._whole(line.get("variant"), "variant"), self._whole(line.get("quantity", 1), "quantity")))
        else:
            asked.append((attrs.get("variant"), attrs["quantity"]))
        rows = {row.pk: row for row in variants.active(listing)}
        if not rows:
            if any(variant_id is not None for variant_id, _ in asked):
                raise serializers.ValidationError({"variant": "This listing has no variants."})
            return {**attrs, "entries": [(None, quantity) for _, quantity in asked]}
        merged = {}
        for variant_id, quantity in asked:
            if variant_id is None:
                raise serializers.ValidationError({"variant": "Choose which version of this listing you want."})
            if variant_id not in rows:
                raise serializers.ValidationError({"variant": "That version is not available for this listing."})
            merged[variant_id] = merged.get(variant_id, 0) + quantity
        return {**attrs, "entries": [(rows[pk], quantity) for pk, quantity in merged.items()]}

    @staticmethod
    def _whole(value, field):
        if value is None and field == "variant":
            return None
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise serializers.ValidationError({field: "Must be a whole number of 1 or more."})
        return value


class BulkAddSerializer(serializers.Serializer):
    """Input for POST /api/cart/items/bulk/. Body-level problems (no such listing, no variants, no lines, a variant
    named twice) are a plain 400; a line that is not a variant id and a whole quantity is named by its index."""

    listing = serializers.PrimaryKeyRelatedField(queryset=Listing.objects.filter(status=Listing.PUBLISHED))
    lines = serializers.ListField(child=serializers.DictField(), allow_empty=False, max_length=variants.MAX_VARIANTS)

    def validate_listing(self, listing):
        if Listing.objects.filter(pk=listing.pk).filter(hidden_business_q()).exists():
            raise serializers.ValidationError(HIDDEN_LISTING_MESSAGE)
        return listing

    def validate(self, attrs):
        if not variants.has_variants(attrs["listing"]):
            raise serializers.ValidationError({"detail": "This listing has no variants."})
        asked, errors, seen = [], [], set()
        for index, line in enumerate(attrs["lines"]):
            variant, quantity = line.get("variant"), line.get("quantity", 1)
            if not self._whole(variant) or not self._whole(quantity):
                errors.append({"index": index, "detail": "Each line needs a variant and a whole quantity of 1 or more."})
                continue
            if variant in seen:
                raise serializers.ValidationError({"detail": "Each version can appear only once."})
            seen.add(variant)
            asked.append((index, variant, quantity))
        return {**attrs, "asked": asked, "line_errors": errors}  # line errors are answered by the view (integer indexes)

    @staticmethod
    def _whole(value):
        return isinstance(value, int) and not isinstance(value, bool) and value >= 1

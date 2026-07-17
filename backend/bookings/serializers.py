from rest_framework import serializers

from .models import Booking


class BookingSerializer(serializers.ModelSerializer):
    listing_name = serializers.CharField(source="listing.name", read_only=True)
    customer_name = serializers.CharField(source="customer.full_name", read_only=True)
    nights = serializers.IntegerField(read_only=True)

    class Meta:
        model = Booking
        fields = [
            "id", "listing", "listing_name", "customer_name",
            "check_in", "check_out", "nights", "units",
            "nightly_rate", "total_price", "status",
            "paid_at", "checked_in_at", "checked_out_at", "cancelled_at", "created_at",
        ]
        read_only_fields = fields


class BookingCreateSerializer(serializers.Serializer):
    """Input for a customer booking. Availability, pricing, and listing
    validation happen in the view so they can return specific errors.
    """

    listing = serializers.IntegerField()
    check_in = serializers.DateField()
    check_out = serializers.DateField()
    units = serializers.IntegerField(min_value=1, default=1)

    def validate(self, data):
        if data["check_out"] <= data["check_in"]:
            raise serializers.ValidationError({"check_out": "Check-out must be after check-in."})
        return data

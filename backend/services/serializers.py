from rest_framework import serializers

from .models import ServiceRequest


class ServiceRequestSerializer(serializers.ModelSerializer):
    """Read shape for both the customer's own requests and the owner's incoming
    queue.
    """

    listing_name = serializers.CharField(source="listing.name", read_only=True)
    customer_name = serializers.CharField(source="customer.full_name", read_only=True)
    business_owner_name = serializers.CharField(source="business_owner.full_name", read_only=True)

    class Meta:
        model = ServiceRequest
        fields = [
            "id", "listing", "listing_name", "customer_name", "business_owner_name",
            "message", "budget", "agreed_price", "decline_reason", "progress_note",
            "status", "responded_at", "paid_at", "completed_at", "created_at",
        ]
        read_only_fields = fields


class ServiceRequestCreateSerializer(serializers.ModelSerializer):
    """Input shape for a customer opening a request. customer/business_owner/
    status are set by the view, never trusted from the body.
    """

    class Meta:
        model = ServiceRequest
        fields = ["listing", "message", "budget"]

    def validate_listing(self, listing):
        # Only a published service listing can be requested.
        from listings.models import Listing

        if listing.status != Listing.PUBLISHED:
            raise serializers.ValidationError("This listing isn't available for requests.")
        if listing.category and listing.category.kind != "service":
            raise serializers.ValidationError("Only a service can be requested this way.")
        return listing

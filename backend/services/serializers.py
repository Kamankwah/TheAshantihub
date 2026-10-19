from rest_framework import serializers

from .models import ServiceRequest


class ServiceRequestSerializer(serializers.ModelSerializer):
    """Read shape for both the customer's own requests and the owner's incoming
    queue.
    """

    listing_name = serializers.CharField(source="listing.name", read_only=True)
    customer_name = serializers.CharField(source="customer.full_name", read_only=True)
    business_owner_name = serializers.CharField(source="business_owner.full_name", read_only=True)
    # Ledger Plan 7E: when the service is accepted by itself, whether its money is settled, and whether a problem is open.
    auto_accept_at = serializers.SerializerMethodField()
    settled = serializers.SerializerMethodField()
    problem_reported = serializers.SerializerMethodField()

    class Meta:
        model = ServiceRequest
        fields = [
            "id", "listing", "listing_name", "customer_name", "business_owner_name",
            "message", "budget", "agreed_price", "decline_reason", "progress_note",
            "status", "responded_at", "paid_at", "completed_at", "created_at",
            "auto_accept_at", "settled", "problem_reported",
        ]
        read_only_fields = fields


    def _sale(self, obj):
        return getattr(obj, "sale", None)

    def get_auto_accept_at(self, obj):
        from ledger import sales

        sale = self._sale(obj)
        if sale is None or sale.released_at is not None or sale.reversed_at is not None or obj.completed_at is None:
            return None
        at = sales.release_at(sale)
        return serializers.DateTimeField().to_representation(at) if at else None

    def get_settled(self, obj):
        sale = self._sale(obj)
        return bool(sale and (sale.released_at is not None or sale.reversed_at is not None))

    def get_problem_reported(self, obj):
        from ledger import sales

        sale = self._sale(obj)
        return bool(sale and sales.has_open_dispute(sale))


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

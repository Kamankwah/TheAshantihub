import re

from rest_framework import serializers

from .models import Review


class ReviewSerializer(serializers.ModelSerializer):
    """Public read shape for GET /api/reviews/{target}/{pk}/ list endpoints.
    Deliberately no phone/email exposed — matches this app's existing
    privacy posture on public lists (see PublicListingSerializer et al).
    """

    author_name = serializers.CharField(source="author.full_name", read_only=True)

    class Meta:
        model = Review
        fields = ["id", "target_type", "rating", "comment", "verified", "author_name", "created_at"]
        read_only_fields = fields


class ReviewSubmitSerializer(serializers.Serializer):
    """Input shape for POST /api/reviews/ — shape validation only, not
    business rules. Eligibility/duplicate/target-existence checks happen in
    the view (ReviewSubmitView), same convention as
    PromotionPurchaseSerializer/HeroSubmitSerializer.
    """

    target_type = serializers.ChoiceField(choices=Review.TARGET_TYPE_CHOICES)
    target_id = serializers.IntegerField()
    # Only required/meaningful when target_type="organizer" — disambiguates
    # whether target_id refers to a BusinessOwner or a Customer, since
    # Review.business_owner is shared between target_type="seller" and
    # target_type="organizer".
    organizer_kind = serializers.ChoiceField(
        choices=["business", "customer"], required=False
    )
    rating = serializers.IntegerField(min_value=1, max_value=5)
    comment = serializers.CharField(required=False, allow_blank=True)

    def validate(self, data):
        target_type = data.get("target_type")
        organizer_kind = data.get("organizer_kind")
        if target_type == Review.ORGANIZER and not organizer_kind:
            raise serializers.ValidationError(
                {"organizer_kind": "organizer_kind ('business' or 'customer') is required when target_type is 'organizer'."}
            )
        if target_type != Review.ORGANIZER and organizer_kind:
            raise serializers.ValidationError(
                {"organizer_kind": "organizer_kind is only valid when target_type is 'organizer'."}
            )
        data["comment"] = data.get("comment", "")
        return data


_PHONE_RUN = re.compile(r"\+?\d[\d\s\-.()]{7,}\d")


def contains_phone_number(text):
    """True when the text holds a run of at least 9 digits (spaces, dashes and
    dots between them allowed): a Ghana number written the usual ways."""
    return any(sum(ch.isdigit() for ch in run) >= 9 for run in _PHONE_RUN.findall(text or ""))


class ReviewModerationSerializer(serializers.ModelSerializer):
    """Staff-facing shape for the moderation queue — everything
    ReviewSerializer has, plus the id(s) of whichever target it points at
    and `status`, so staff can see what they're looking at (mirrors
    ModerationListingSerializer's field selection).
    """

    author_name = serializers.CharField(source="author.full_name", read_only=True)
    hidden_by_name = serializers.CharField(source="hidden_by.full_name", read_only=True, default=None)
    # Who last actioned this review (approved or rejected) and when — drives
    # the Approved/Rejected tabs' attribution line.
    reviewed_by_name = serializers.CharField(
        source="reviewed_by.full_name", read_only=True, default=None
    )
    # Enough context to identify what is being reviewed without a second
    # request — the raw target ids alone are unreadable in a queue.
    target_name = serializers.SerializerMethodField()
    reviewed_by_role = serializers.CharField(source="reviewed_by.role.get_name_display", read_only=True, default=None)
    # Flags for the moderator, computed from the record: the comment carries
    # something that reads as a phone number, and the author has a dispute still
    # open on an order with this business.
    contains_phone = serializers.SerializerMethodField()
    open_dispute_order = serializers.SerializerMethodField()
    order_id = serializers.SerializerMethodField()
    about_name = serializers.SerializerMethodField()

    class Meta:
        model = Review
        fields = [
            "id", "target_type", "listing", "event", "business_owner", "organizer_customer",
            "author", "author_name", "rating", "comment", "verified", "status",
            "hidden_reason", "hidden_reason_code", "hidden_message", "hidden_by", "hidden_by_name",
            "reviewed_by_name", "reviewed_by_role", "reviewed_at", "target_name", "created_at",
            "contains_phone", "open_dispute_order", "order_id", "about_name",
        ]
        read_only_fields = fields

    def get_contains_phone(self, obj):
        return contains_phone_number(obj.comment)

    def get_open_dispute_order(self, obj):
        """The id of the author's order, with the reviewed business, that has an
        open dispute (open or investigating), or None."""
        from disputes.models import Dispute

        if obj.listing_id:
            owner_id = obj.listing.business_owner_id
        elif obj.business_owner_id and obj.target_type == Review.SELLER:
            owner_id = obj.business_owner_id
        else:
            return None
        dispute = (
            Dispute.objects.filter(
                status__in=[Dispute.OPEN, Dispute.INVESTIGATING],
                order__customer_id=obj.author_id, order__items__listing__business_owner_id=owner_id,
            )
            .order_by("-created_at").values_list("order_id", flat=True).first()
        )
        return dispute

    def get_order_id(self, obj):
        """The order behind a verified purchase review, only when it is
        unambiguous: the author has exactly one paid order with this listing (or
        this seller). Otherwise None and the screen says "Verified purchase"."""
        if not obj.verified or obj.target_type not in (Review.LISTING, Review.SELLER):
            return None
        from orders.models import Order

        orders = Order.objects.filter(customer_id=obj.author_id, status=Order.PAID)
        if obj.listing_id:
            orders = orders.filter(items__listing_id=obj.listing_id)
        elif obj.business_owner_id:
            orders = orders.filter(items__listing__business_owner_id=obj.business_owner_id)
        else:
            return None
        ids = list(orders.values_list("pk", flat=True).distinct()[:2])
        return ids[0] if len(ids) == 1 else None

    def get_about_name(self, obj):
        """The business the review concerns, for the "About ..." line."""
        if obj.listing_id:
            return obj.listing.business_owner.display_name
        if obj.business_owner_id:
            return obj.business_owner.display_name
        return None

    def get_target_name(self, obj):
        if obj.listing_id:
            return obj.listing.name
        if obj.event_id:
            return obj.event.name
        if obj.business_owner_id:
            return obj.business_owner.full_name
        if obj.organizer_customer_id:
            return obj.organizer_customer.full_name
        return None

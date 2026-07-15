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


class ReviewModerationSerializer(serializers.ModelSerializer):
    """Staff-facing shape for the moderation queue — everything
    ReviewSerializer has, plus the id(s) of whichever target it points at
    and `status`, so staff can see what they're looking at (mirrors
    ModerationListingSerializer's field selection).
    """

    author_name = serializers.CharField(source="author.full_name", read_only=True)
    hidden_by_name = serializers.CharField(source="hidden_by.full_name", read_only=True, default=None)

    class Meta:
        model = Review
        fields = [
            "id", "target_type", "listing", "event", "business_owner", "organizer_customer",
            "author", "author_name", "rating", "comment", "verified", "status",
            "hidden_reason", "hidden_by", "hidden_by_name", "created_at",
        ]
        read_only_fields = fields

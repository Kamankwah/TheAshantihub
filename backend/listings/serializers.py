from rest_framework import serializers

from accounts.models import BusinessOwner

from .models import Category, HeroMediaSubmission, Listing, ListingPhoto, Promotion, Zone


class ListingPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingPhoto
        fields = ["id", "image", "order"]


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "slug", "icon", "label", "color", "kind"]


class ZoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = Zone
        fields = ["id", "name"]


class BusinessOwnerMiniSerializer(serializers.ModelSerializer):
    """Minimal public-facing shape of a listing's seller — needed so the
    frontend knows *whose* seller-rating to fetch (reviews/ratings/Q&A plan,
    docs/PROJECT_SCOPE.md). Deliberately no phone/email/payout info exposed.
    """

    class Meta:
        model = BusinessOwner
        fields = ["id", "full_name", "kyc_status"]


class PublicListingSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)
    zone = ZoneSerializer(read_only=True)
    photos = ListingPhotoSerializer(many=True, read_only=True)
    business_owner = BusinessOwnerMiniSerializer(read_only=True)
    # Only present (True) when the queryset annotated it — PublicListingListView
    # (docs/BUSINESS_EVENTS_ROADMAP.md Phase 5's search-ranking annotation) does
    # this; PublicListingDetailView/RelatedListingsView don't, so this safely
    # defaults to False there via getattr rather than erroring on a missing
    # attribute.
    is_promoted = serializers.SerializerMethodField()
    # Same "annotated but not always present" safety pattern — populated by
    # the reviews-count/avg-rating queryset annotation added to every view
    # backing this serializer (reviews/ratings/Q&A plan, docs/PROJECT_SCOPE.md).
    avg_rating = serializers.SerializerMethodField()
    review_count = serializers.SerializerMethodField()

    class Meta:
        model = Listing
        fields = [
            "id", "name", "description", "category", "zone", "price_amount", "price_unit",
            "tag", "contact_phone", "lat", "lng", "main_photo", "photos", "created_at",
            "is_promoted", "specs", "service_duration", "avg_rating", "review_count",
            "business_owner",
        ]

    def get_is_promoted(self, obj):
        return bool(getattr(obj, "is_promoted", False))

    def get_avg_rating(self, obj):
        return getattr(obj, "avg_rating", None)

    def get_review_count(self, obj):
        return getattr(obj, "review_count", 0)


class OwnerListingSerializer(serializers.ModelSerializer):
    # Read-only nested gallery so a business owner's own listing view (used by
    # the "Submit for Hero" flow to pick a photo) can show the gallery without
    # a second round-trip — same shape as PublicListingSerializer/
    # ModerationListingSerializer's `photos` field.
    photos = ListingPhotoSerializer(many=True, read_only=True)

    class Meta:
        model = Listing
        fields = [
            "id", "category", "zone", "name", "description", "price_amount", "price_unit",
            "tag", "contact_phone", "lat", "lng", "main_photo", "photos", "specs",
            "service_duration", "status", "rejection_reason", "created_at", "updated_at",
        ]
        read_only_fields = ["status", "rejection_reason", "created_at", "updated_at"]
        extra_kwargs = {"contact_phone": {"required": False}}

    def validate(self, data):
        if self.instance is not None and self.instance.status == Listing.PUBLISHED:
            raise serializers.ValidationError(
                {"status": "Cannot edit a published listing."}
            )
        return data

    def create(self, validated_data):
        owner = self.context["request"].user
        if not validated_data.get("contact_phone"):
            validated_data["contact_phone"] = owner.profile.business_contact_phone
        return Listing.objects.create(business_owner=owner, **validated_data)


class ModerationListingSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)
    zone = ZoneSerializer(read_only=True)
    photos = ListingPhotoSerializer(many=True, read_only=True)

    class Meta:
        model = Listing
        fields = [
            "id", "business_owner", "name", "description", "category", "zone", "price_amount",
            "price_unit", "tag", "contact_phone", "lat", "lng", "main_photo", "photos",
            "status", "rejection_reason", "created_at",
        ]


class HeroMediaModerationSerializer(serializers.ModelSerializer):
    """Staff-facing shape for the hero-media approval queue/detail views —
    mirrors ModerationListingSerializer's field selection.
    """

    business_owner_name = serializers.CharField(source="business_owner.full_name", read_only=True)

    class Meta:
        model = HeroMediaSubmission
        fields = [
            "id", "business_owner", "business_owner_name", "media", "media_type", "caption",
            "status", "rejection_reason", "submitted_at", "approved_at", "expires_at",
            "extended_days",
        ]


class HeroActiveSerializer(serializers.ModelSerializer):
    """Public shape for the live hero slider — GET /api/hero/active/."""

    business_name = serializers.CharField(source="business_owner.full_name", read_only=True)

    class Meta:
        model = HeroMediaSubmission
        fields = [
            "id", "media", "media_type", "caption", "business_name", "approved_at", "expires_at",
        ]


class HeroSubmitSerializer(serializers.Serializer):
    """Input shape for POST /api/hero/submit/ — references an existing
    ListingPhoto (by id) the business already owns, plus a caption. Ownership
    and outstanding-submission checks happen in the view (HeroSubmitView),
    not here, so they can return distinct 403/400 status codes rather than a
    generic 400 validation error — this serializer only validates shape.
    """

    listing_photo = serializers.IntegerField()
    caption = serializers.CharField(max_length=140)


class PromotionSerializer(serializers.ModelSerializer):
    """Response shape for POST /api/listings/{id}/promote/."""

    class Meta:
        model = Promotion
        fields = [
            "id", "listing", "kind", "starts_at", "ends_at", "keywords", "amount_paid", "status",
        ]
        read_only_fields = fields


class PromotionPurchaseSerializer(serializers.Serializer):
    """Input shape for POST /api/listings/{id}/promote/. Ownership, listing-
    status, and stacking checks happen in the view (ListingPromoteView), not
    here, so they can return distinct, clearly-worded 400s rather than a
    generic validation error — this serializer only validates shape plus the
    boost-requires-keywords rule, which is a property of the input itself
    rather than of existing state.
    """

    kind = serializers.ChoiceField(choices=Promotion.KIND_CHOICES)
    days = serializers.IntegerField(min_value=1)
    keywords = serializers.CharField(required=False, allow_blank=True, max_length=255)

    def validate(self, data):
        keywords = (data.get("keywords") or "").strip()
        if data["kind"] == Promotion.BOOST and not keywords:
            raise serializers.ValidationError(
                {"keywords": "Keywords are required for a boost promotion."}
            )
        data["keywords"] = keywords
        return data

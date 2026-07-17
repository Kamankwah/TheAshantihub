from django.utils import timezone
from rest_framework import serializers

from accounts.models import BusinessOwner
from billing.models import Subscription

from .models import Category, HeroMediaSubmission, Listing, ListingPhoto, Promotion, Zone

# The product/service decision fields added by the comprehensive listing-
# creation work — shared between the owner-facing (writable) and public
# (read-only) serializers so the two field lists can't drift apart.
LISTING_DECISION_FIELDS = [
    # Product-oriented
    "has_warranty", "warranty_details", "has_expiry", "expiry_date", "return_policy",
    "brand", "condition", "dimensions", "weight", "stock_quantity",
    # Service-oriented (service_duration predates this work and stays where
    # it already was in each serializer's field list)
    "whats_included", "requirements", "revisions", "delivery_time",
]


class ListingPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ListingPhoto
        fields = ["id", "image", "order"]


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "slug", "icon", "label", "color", "kind"]
        # `kind` has a model-level default (PRODUCT), which would otherwise
        # make it optional on create — but staff must consciously choose
        # Product vs Service when creating a category (the admin form forces
        # the choice), so require it explicitly here. On a PATCH (partial
        # update) DRF skips required-field enforcement, so editing name/icon/
        # label/color without re-sending `kind` still works.
        extra_kwargs = {"kind": {"required": True}}


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
            "business_owner", *LISTING_DECISION_FIELDS,
        ]
        # This serializer only ever backs read-only views (list/detail/
        # related), but mark the decision fields read-only explicitly anyway
        # so a future write usage can't accept them unvalidated.
        read_only_fields = LISTING_DECISION_FIELDS

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
            "service_duration", *LISTING_DECISION_FIELDS,
            "status", "rejection_reason", "created_at", "updated_at",
        ]
        read_only_fields = ["status", "rejection_reason", "created_at", "updated_at"]
        extra_kwargs = {"contact_phone": {"required": False}}

    def validate(self, data):
        if self.instance is not None and self.instance.status == Listing.PUBLISHED:
            raise serializers.ValidationError(
                {"status": "Cannot edit a published listing."}
            )

        owner = self.context["request"].user
        profile = getattr(owner, "profile", None)

        # Category-kind restriction — applies to both create and edit, since
        # an edit can change a listing's category just as easily as a create
        # can pick the wrong one in the first place.
        category = data.get("category", getattr(self.instance, "category", None))
        if (
            profile is not None
            and profile.business_kind
            and category is not None
            and category.kind
            and category.kind != profile.business_kind
        ):
            raise serializers.ValidationError(
                {"category": f"Your business is registered for {profile.business_kind} listings only."}
            )

        if self.instance is None:
            subscription = getattr(owner, "subscription", None)
            if (
                subscription is None
                or subscription.status != Subscription.ACTIVE
                or subscription.current_period_end < timezone.now()
            ):
                raise serializers.ValidationError(
                    {
                        "subscription": (
                            "Your subscription isn't active. Choose or renew a plan "
                            "before adding new listings."
                        )
                    }
                )

            max_active_listings = subscription.plan.max_active_listings
            if max_active_listings is not None:
                active_count = Listing.objects.filter(
                    business_owner=owner, status=Listing.PUBLISHED
                ).count()
                if active_count >= max_active_listings:
                    raise serializers.ValidationError(
                        {
                            "max_active_listings": (
                                "You've reached your plan's active-listing limit. "
                                "Upgrade your plan to add more."
                            )
                        }
                    )

        # ── Product decision-field enforcement (comprehensive listing-
        # creation work). "Mandatory" here means "the form makes the user
        # consciously answer at creation time", not "reject pre-existing
        # rows": a CREATE of a product-kind listing must explicitly provide
        # has_warranty/has_expiry (booleans the owner must answer either way
        # — presence is checked against initial_data since a missing
        # BooleanField would otherwise just silently default) and a non-empty
        # return_policy. An EDIT only rejects explicitly blanking
        # return_policy on a product — a PATCH that doesn't touch these
        # fields keeps working against old rows created before this feature.
        # warranty_details/expiry_date are only required when their toggle is
        # actually true (effective value, instance-aware for PATCHes).
        errors = {}
        is_product = category is not None and category.kind == Category.PRODUCT
        if is_product:
            if self.instance is None:
                if "has_warranty" not in self.initial_data:
                    errors["has_warranty"] = "State whether this product comes with a warranty."
                if "has_expiry" not in self.initial_data:
                    errors["has_expiry"] = "State whether this product has an expiry date."
                if not (data.get("return_policy") or "").strip():
                    errors["return_policy"] = "A return policy is required for a product listing."
            elif "return_policy" in data and not (data.get("return_policy") or "").strip():
                errors["return_policy"] = "A return policy is required for a product listing."

            has_warranty = data.get(
                "has_warranty", getattr(self.instance, "has_warranty", False)
            )
            warranty_details = data.get(
                "warranty_details", getattr(self.instance, "warranty_details", "")
            )
            if has_warranty and not (warranty_details or "").strip():
                errors["warranty_details"] = (
                    "Describe the warranty since this product comes with one."
                )

            has_expiry = data.get("has_expiry", getattr(self.instance, "has_expiry", False))
            expiry_date = data.get("expiry_date", getattr(self.instance, "expiry_date", None))
            if has_expiry and not expiry_date:
                errors["expiry_date"] = (
                    "Provide the expiry date since this product can expire."
                )

        if errors:
            raise serializers.ValidationError(errors)

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
    # business_owner_name (staff moderation-queue restructuring, item 2) lets
    # the panel group/identify listings by their owning business without a
    # second lookup. reviewed_by_name/reviewed_at (approver attribution) back
    # the Approved/Rejected tabs' "who actioned this" line.
    business_owner_name = serializers.CharField(source="business_owner.full_name", read_only=True)
    reviewed_by_name = serializers.CharField(source="reviewed_by.full_name", read_only=True, default=None)

    class Meta:
        model = Listing
        fields = [
            "id", "business_owner", "business_owner_name", "name", "description", "category",
            "zone", "price_amount", "price_unit", "tag", "contact_phone", "lat", "lng",
            "main_photo", "photos", "status", "rejection_reason", "created_at",
            "reviewed_by_name", "reviewed_at",
        ]


class HeroMediaModerationSerializer(serializers.ModelSerializer):
    """Staff-facing shape for the hero-media approval queue/detail views —
    mirrors ModerationListingSerializer's field selection.
    """

    business_owner_name = serializers.CharField(source="business_owner.full_name", read_only=True)
    # Approver attribution (staff moderation-queue restructuring) — backs the
    # Approved/Rejected tabs' "who actioned this" line.
    reviewed_by_name = serializers.CharField(source="reviewed_by.full_name", read_only=True, default=None)

    class Meta:
        model = HeroMediaSubmission
        fields = [
            "id", "business_owner", "business_owner_name", "media", "media_type", "caption",
            "status", "rejection_reason", "submitted_at", "approved_at", "expires_at",
            "extended_days", "reviewed_by_name", "reviewed_at",
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


class PromotionAdminSerializer(serializers.ModelSerializer):
    """Staff-facing shape for the promotions management queue
    (promotions.manage). Adds the listing/business names a raw listing id
    can't convey in a queue, and `is_currently_active` so the client doesn't
    re-derive the live/expired distinction from timestamps itself.
    """

    listing_name = serializers.CharField(source="listing.name", read_only=True)
    business_owner_name = serializers.CharField(
        source="listing.business_owner.full_name", read_only=True
    )
    is_currently_active = serializers.BooleanField(read_only=True)

    class Meta:
        model = Promotion
        fields = [
            "id", "listing", "listing_name", "business_owner_name", "kind",
            "starts_at", "ends_at", "keywords", "amount_paid", "status",
            "is_currently_active", "created_at",
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

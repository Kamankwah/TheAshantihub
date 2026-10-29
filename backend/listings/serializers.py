from decimal import Decimal

from django.db.models import Q
from django.utils import timezone
from rest_framework import serializers

from accounts import direct
from accounts.models import BusinessOwner
from billing.models import Subscription

from . import pricing, services, variants
from .models import Category, HeroMediaSubmission, Listing, ListingPhoto, ListingVariant, ListingVideo, Promotion, Zone

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


class OwnerPhotoSerializer(ListingPhotoSerializer):
    """A gallery photo as its owner sees it: `staged` is true while it waits in an open edit of an approved listing."""

    staged = serializers.SerializerMethodField()

    class Meta(ListingPhotoSerializer.Meta):
        fields = [*ListingPhotoSerializer.Meta.fields, "staged"]

    def get_staged(self, obj):
        return obj.revision_id is not None


def _file_url(serializer, file):
    if not file:
        return None
    request = serializer.context.get("request")
    return request.build_absolute_uri(file.url) if request is not None else file.url


class PublicVideoSerializer(serializers.ModelSerializer):
    """Exactly {id, kind, url | youtube_id, poster, position}: the shopper's view of a ready video."""

    class Meta:
        model = ListingVideo
        fields = ["id", "kind", "poster", "position"]

    def to_representation(self, obj):
        data = {"id": obj.pk, "kind": obj.kind}
        if obj.kind == ListingVideo.YOUTUBE:
            data["youtube_id"] = obj.youtube_id
        else:
            data["url"] = _file_url(self, obj.web_file)
        data["poster"] = _file_url(self, obj.poster)
        data["position"] = obj.position
        return data


class OwnerVideoSerializer(serializers.ModelSerializer):
    """A video as its owner sees it: staged flag, conversion status, and fixed words when conversion failed."""

    url = serializers.SerializerMethodField()
    poster = serializers.SerializerMethodField()
    staged = serializers.SerializerMethodField()
    error = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()

    class Meta:
        model = ListingVideo
        fields = ["id", "kind", "status", "youtube_id", "url", "poster", "duration_seconds", "position", "staged", "error"]

    def get_url(self, obj):
        return _file_url(self, obj.web_file) if obj.status == ListingVideo.READY else None

    def get_poster(self, obj):
        return _file_url(self, obj.poster)

    def get_staged(self, obj):
        return obj.revision_id is not None

    def get_status(self, obj):
        return obj.owner_status

    def get_error(self, obj):
        from .media import FAILED_TEXT

        return FAILED_TEXT if obj.status == ListingVideo.FAILED else None


def live_photos(obj, context):
    """The photos the public may see: never one staged in an open edit."""
    return ListingPhotoSerializer([p for p in obj.photos.all() if p.revision_id is None], many=True, context=context).data


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        # `parent` (the parent category's id, or null for a department / top-level row) lets business and staff
        # forms group the ~300 flat rows under their department (ruling R34). Read-only: the tree is set by migration.
        fields = ["id", "slug", "icon", "label", "color", "kind", "is_accommodation", "is_food", "parent"]
        # `kind` has a model-level default (PRODUCT), which would otherwise
        # make it optional on create — but staff must consciously choose
        # Product vs Service when creating a category (the admin form forces
        # the choice), so require it explicitly here. On a PATCH (partial
        # update) DRF skips required-field enforcement, so editing name/icon/
        # label/color without re-sending `kind` still works.
        extra_kwargs = {"kind": {"required": True}}
        # is_food (the delivery food rules, cart.guard) is set by migration only (listings 0020: food and beverages);
        # it is shown, never changed through the category screens.
        read_only_fields = ["is_food", "parent"]



class CategoryStaffSerializer(CategorySerializer):
    """Staff list shape: the public fields plus how many listings and events use
    the category. The counts come from queryset annotations (`listing_count`,
    `event_count`), so the list costs one query."""

    listing_count = serializers.IntegerField(read_only=True, default=0)
    event_count = serializers.IntegerField(read_only=True, default=0)

    class Meta(CategorySerializer.Meta):
        fields = CategorySerializer.Meta.fields + ["listing_count", "event_count"]


class ZoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = Zone
        fields = ["id", "name"]


class BusinessOwnerMiniSerializer(serializers.ModelSerializer):
    """Minimal public-facing shape of a listing's seller — needed so the
    frontend knows *whose* seller-rating to fetch (reviews/ratings/Q&A plan,
    docs/PROJECT_SCOPE.md). Deliberately no phone/email/payout info exposed.
    """

    # `name` is the business name the seller page shows (the owner's own name only when none is set), so "Sold by"
    # names the business; `is_ashanti_direct` marks the company's own shop.
    name = serializers.CharField(source="display_name", read_only=True)
    is_ashanti_direct = serializers.SerializerMethodField()

    class Meta:
        model = BusinessOwner
        fields = ["id", "full_name", "name", "kyc_status", "is_ashanti_direct"]

    def get_is_ashanti_direct(self, obj):
        return direct.is_direct(obj)


def live_sale_ends_at(obj):
    """The discount's end date, only while the discount is live (a listing or a variant)."""
    if obj.sale_ends_at is None or not pricing.is_discounted(obj):
        return None
    return serializers.DateTimeField().to_representation(obj.sale_ends_at)


class PublicVariantSerializer(serializers.ModelSerializer):
    effective_price = serializers.SerializerMethodField()
    sale_price = serializers.SerializerMethodField()
    was_price = serializers.SerializerMethodField()
    sale_ends_at = serializers.SerializerMethodField()

    class Meta:
        model = ListingVariant
        fields = [
            "id", "label", "attributes", "price_amount", "sale_price", "was_price", "sale_ends_at", "effective_price",
            "stock_quantity", "position",
        ]

    def get_effective_price(self, obj):
        return str(obj.effective_price)

    def get_sale_price(self, obj):
        return str(pricing.dec(obj.sale_price)) if pricing.is_discounted(obj) else None

    def get_was_price(self, obj):
        was = pricing.was_price(obj)
        return None if was is None else str(was)

    def get_sale_ends_at(self, obj):
        return live_sale_ends_at(obj)


class ListingVariantSerializer(PublicVariantSerializer):
    """The owner's view of a variant (adds `is_active`), and the validation of a new one."""

    label = serializers.CharField(max_length=100, required=False, allow_blank=True)
    price_amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))
    stock_quantity = serializers.IntegerField(min_value=0, max_value=variants.MAX_STOCK, required=False, allow_null=True)
    attributes = serializers.JSONField(required=False)

    class Meta(PublicVariantSerializer.Meta):
        fields = [*PublicVariantSerializer.Meta.fields, "is_active"]
        read_only_fields = ["position", "is_active"]

    def validate_attributes(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Send the attributes as a list of name and value pairs.")
        if len(value) > variants.MAX_ATTRIBUTES:
            raise serializers.ValidationError(f"At most {variants.MAX_ATTRIBUTES} attributes.")
        clean = {}
        for key, item in value.items():
            if not isinstance(item, str) or not item.strip() or not str(key).strip():
                raise serializers.ValidationError("Each attribute needs a name and a text value.")
            if len(str(key)) > 50 or len(item) > 100:
                raise serializers.ValidationError("An attribute name or value is too long.")
            clean[str(key).strip()] = item.strip()
        return clean

    def validate(self, data):
        label = (data.get("label") or "").strip()
        if not label:
            label = " / ".join((data.get("attributes") or {}).values())[:100]
        if not label:
            raise serializers.ValidationError({"label": "Give the variant a name or at least one attribute."})
        listing = self.context["listing"]
        if variants.active(listing).filter(label__iexact=label).exists():
            raise serializers.ValidationError({"label": "This listing already has a variant with that name."})
        data["label"] = label
        return data


class PublicListingSerializer(serializers.ModelSerializer):
    # No contact_phone (or any phone) here: businesses are never contacted directly, so a public response must not
    # let anyone recover a business number. Owner and staff serializers keep it.
    category = CategorySerializer(read_only=True)
    zone = ZoneSerializer(read_only=True)
    photos = serializers.SerializerMethodField()
    videos = serializers.SerializerMethodField()
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
    # Deals (Plan M1 Task 6): the sale price only while it is a real discount, and a "was" price only when the
    # regular price has stood 7 full days (listings.pricing) - otherwise null, never an invented value.
    sale_price = serializers.SerializerMethodField()
    was_price = serializers.SerializerMethodField()
    effective_price = serializers.SerializerMethodField()
    sale_ends_at = serializers.SerializerMethodField()
    variants = serializers.SerializerMethodField()
    has_variants = serializers.SerializerMethodField()

    class Meta:
        model = Listing
        fields = [
            "id", "name", "description", "category", "zone", "price_amount", "price_unit",
            "tag", "lat", "lng", "main_photo", "photos", "created_at",
            "is_promoted", "specs", "service_duration", "avg_rating", "review_count",
            "sale_price", "sale_ends_at", "was_price", "effective_price", "variants", "has_variants", "videos",
            "business_owner", *LISTING_DECISION_FIELDS, "cancellation_policy",
        ]
        # This serializer only ever backs read-only views (list/detail/
        # related), but mark the decision fields read-only explicitly anyway
        # so a future write usage can't accept them unvalidated.
        read_only_fields = LISTING_DECISION_FIELDS

    def get_photos(self, obj):
        return live_photos(obj, self.context)

    def get_videos(self, obj):
        """Ready uploads and YouTube links that are not staged in an open edit."""
        rows = [v for v in obj.videos.all() if v.revision_id is None and v.status == ListingVideo.READY]
        return PublicVideoSerializer(rows, many=True, context=self.context).data

    def get_variants(self, obj):
        return PublicVariantSerializer(variants.active_rows(obj), many=True).data

    def get_has_variants(self, obj):
        return bool(variants.active_rows(obj))

    def get_is_promoted(self, obj):
        return bool(getattr(obj, "is_promoted", False))

    def get_sale_price(self, obj):
        return str(pricing.dec(obj.sale_price)) if pricing.is_discounted(obj) else None

    def get_was_price(self, obj):
        was = pricing.was_price(obj)
        return None if was is None else str(was)

    def get_sale_ends_at(self, obj):
        return live_sale_ends_at(obj)

    def get_effective_price(self, obj):
        value = obj.effective_price
        return None if value is None else str(value)

    def get_avg_rating(self, obj):
        return getattr(obj, "avg_rating", None)

    def get_review_count(self, obj):
        return getattr(obj, "review_count", 0)


class CartTieredListingSerializer(PublicListingSerializer):
    """Search for a customer whose cart holds something (?cart_tiers=1, cart.guard): the tier of the listing's shop
    (1 in the cart, 2 near it, 3 everyone else; null for services, stays and events, which are not tiered), the distance
    label for tier 2 (labelled when it is the straight-line estimate), and why the cart cannot take it now, if so. Needs
    the guard context as context["cart_guard"], its near-shop map already measured."""

    cart_tier = serializers.SerializerMethodField()
    cart_label = serializers.SerializerMethodField()
    cart_blocked = serializers.SerializerMethodField()

    class Meta(PublicListingSerializer.Meta):
        fields = [*PublicListingSerializer.Meta.fields, "cart_tier", "cart_label", "cart_blocked"]

    @staticmethod
    def _deliverable(obj):
        from cart import guard

        return guard.kind_of(obj) in guard.DELIVERABLE

    def get_cart_tier(self, obj):
        return getattr(obj, "cart_tier", None) if self._deliverable(obj) else None

    def get_cart_label(self, obj):
        from routing import service as routing_service

        tier = self.get_cart_tier(obj)
        ctx = self.context["cart_guard"]
        if tier == 1:
            return "In your cart" if obj.pk in ctx["listing_ids"] else "From a shop in your cart"
        if tier == 2:
            near = ctx["near"].get(obj.business_owner_id)
            if near is None:  # the near map was re-measured while the page was being built: no label rather than a wrong one
                return None
            text = f"{near['km']:.1f} km from {near['from_name']}"
            return text if near["basis"] == routing_service.BASIS_ROAD else f"{text} (estimate)"
        return None

    def get_cart_blocked(self, obj):
        from cart import guard

        if not self._deliverable(obj):
            return None
        reason = guard.blocked_reason(self.context["cart_guard"], obj)
        return {"detail": reason[0], "code": reason[1]} if reason else None


GROUPED_BARCODE_MESSAGE = (
    "This listing is grouped with a catalogue product that has a different barcode. Ask AshantiHub Support to ungroup "
    "it first."
)


NOT_GOODS_MESSAGE = "Only goods carry a barcode. Leave it blank for a service, stay or event."


def clean_listing_barcode(value, instance=None, category=None):
    """A listing's barcode as its 14-digit GTIN (catalogue plan 6; spaces and hyphens may be typed). A grouped listing
    keeps its own barcode or takes its catalogue product's; it cannot change to another."""
    from cart import guard
    from catalogue.identity import BarcodeError, clean_barcode

    try:
        key = clean_barcode(value)
    except BarcodeError as exc:
        raise serializers.ValidationError(str(exc)) from None
    category = category or getattr(instance, "category", None)
    if key and category is not None and guard.kind_of_category(category) not in guard.DELIVERABLE:
        raise serializers.ValidationError(NOT_GOODS_MESSAGE)
    product = getattr(instance, "catalogue_product", None)
    if product is not None and product.barcode and key not in (product.barcode, instance.barcode):
        raise serializers.ValidationError(GROUPED_BARCODE_MESSAGE)
    return key


SALE_NOT_GOODS_MESSAGE = "Only goods and food can have a sale price. Services and stays are charged their regular price."
SALE_PRICE_MESSAGE = "A sale price must be above 0 and below the regular price."


def validate_sale_price(data, instance=None):
    """0 < sale_price < price_amount, using the incoming price_amount when both are sent. Null ends the sale. A sale
    goes live at once: this is the only check, there is no approval."""
    sale = data.get("sale_price")
    if sale is None:
        # Lowering the price to or under a stored sale price would leave an inert sale that revives when the price is
        # raised again: end it now. An explicit null already ends it.
        stored = getattr(instance, "sale_price", None)
        incoming = data.get("price_amount")
        if "sale_price" not in data and stored is not None and incoming is not None and incoming <= stored:
            data["sale_price"] = None
        return data
    category = data.get("category") or getattr(instance, "category", None)
    if category is not None and not pricing.sale_allowed(category):
        raise serializers.ValidationError({"sale_price": SALE_NOT_GOODS_MESSAGE})
    price = data["price_amount"] if "price_amount" in data else getattr(instance, "price_amount", None)
    if price is None or not (0 < sale < price):
        raise serializers.ValidationError({"sale_price": SALE_PRICE_MESSAGE})
    try:
        pricing.sale_for(pricing.dec(price), sale_price=sale)  # the discount endpoint's bounds: 1% to 90% off
    except pricing.PricingError as exc:
        raise serializers.ValidationError({"sale_price": str(exc)}) from None
    return data


# Moved to listings.services; kept importable from here for the callers that already use it.
save_sent_fields = services.save_sent_fields


class OwnerListingManageSerializer(serializers.ModelSerializer):
    """The live edit of a listing: price, the live sale price and the price unit, and nothing else.

    Narrowed in marketplace Plan 2 (decision V5). It used to also let `tag`, `contact_phone`, `specs`,
    `service_duration`, the warranty/expiry/return/brand/condition/dimensions/weight/barcode fields and the
    cancellation policy through without moderation, but a shopper sees those, so an approved listing now changes them
    only through a revision that staff approve (listings.revisions). Stock goes live through `restock` and the
    variants' own live endpoint. A field sent here that is not live is refused with a message, not ignored.
    """

    class Meta:
        model = Listing
        fields = ["id", "price_amount", "sale_price", "price_unit"]

    def to_internal_value(self, data):
        from .revisions import REVISABLE_FIELDS

        refused = sorted(set(getattr(data, "keys", lambda: [])()) - set(self.fields))
        if refused:
            raise serializers.ValidationError({
                key: "Changes to this are sent for approval; save them as an edit of the listing."
                if key in REVISABLE_FIELDS else "Stock is changed with the restock control." if key == "stock_quantity"
                else "This cannot be changed here."
                for key in refused
            })
        return super().to_internal_value(data)

    def validate(self, data):
        if self.instance is not None and self.instance.status == Listing.DISCONTINUED:
            raise serializers.ValidationError({"status": "A discontinued listing cannot be changed."})
        return validate_sale_price(data, self.instance)

    def update(self, instance, validated_data):
        return save_sent_fields(instance, validated_data)


# Owner-facing wording of the listing rules below. portfolio.proposals words
# the subscription/limit/category refusals for scouts, and the scout's
# Add-a-product form lists PRODUCT_ANSWER_MESSAGES as the answers it must ask.
SUBSCRIPTION_INACTIVE_MESSAGE = (
    "Your subscription isn't active. Choose or renew a plan "
    "before adding new listings."
)
LISTING_LIMIT_MESSAGE = (
    "You've reached your plan's active-listing limit. "
    "Upgrade your plan to add more."
)
PRODUCT_ANSWER_MESSAGES = {
    "has_warranty": "State whether this product comes with a warranty.",
    "has_expiry": "State whether this product has an expiry date.",
    "return_policy": "A return policy is required for a product listing.",
}


def subscriptions_on():
    from billing.switch import subscriptions_enabled

    return subscriptions_enabled()


def active_listing_cap_reached(owner):
    """True when the owner's plan caps active (published) listings and they already hold that many. Shared by the
    create rule below and by lifecycle.restore, so a drop cannot be used to get past the cap."""
    subscription = getattr(owner, "subscription", None)
    cap = subscription.plan.max_active_listings if subscription is not None else None
    if cap is None:
        return False
    return Listing.objects.filter(business_owner=owner, status=Listing.PUBLISHED).count() >= cap


def validate_listing_for_owner(owner, data, *, instance=None, initial_data=None, revising=False, adds_variants=False):
    """The rules a business's listing must meet — shared by the owner's own
    form (OwnerListingSerializer.validate) and a scout's proposed listing
    (portfolio.proposals), so the two paths can't drift apart.

    `data` is validated serializer data; `instance` the listing being edited
    (None on create); `initial_data` the raw input — the product answers
    check which keys were actually sent (defaults to `data`). Raises
    serializers.ValidationError; returns `data` unchanged.

    `revising` is the edit of an approved listing through a revision (listings.revisions): the published-listing
    refusal is skipped and a dropped listing is accepted, a discontinued one is still refused. `adds_variants` says the
    revision leaves the listing with variants, so its category must still allow them."""
    if initial_data is None:
        initial_data = data

    refused = (Listing.DISCONTINUED,) if revising else (Listing.DROPPED, Listing.DISCONTINUED)
    if instance is not None and instance.status in refused:
        raise serializers.ValidationError({"status": "A dropped or discontinued listing cannot be edited."})

    if instance is not None and instance.status == Listing.PUBLISHED and not revising:
        raise serializers.ValidationError(
            {"status": "Cannot edit a published listing."}
        )

    profile = getattr(owner, "profile", None)
    company = direct.is_direct(owner)  # Ashanti Direct sells across kinds and holds no plan; fees and payouts are unchanged

    # Category-kind restriction — applies to both create and edit, since
    # an edit can change a listing's category just as easily as a create
    # can pick the wrong one in the first place.
    category = data.get("category", getattr(instance, "category", None))
    if (
        not company
        and profile is not None
        and profile.business_kind
        and category is not None
        and category.kind
        and category.kind != profile.business_kind
    ):
        raise serializers.ValidationError(
            {"category": f"Your business is registered for {profile.business_kind} listings only."}
        )

    # Variants exist only on goods and food: a listing that has them (or will after this revision) cannot move to a
    # category of another kind.
    if (
        category is not None and ("category" in data or adds_variants) and not pricing.sale_allowed(category)
        and (adds_variants or (instance is not None and variants.has_variants(instance)))
    ):
        raise serializers.ValidationError({"category": "Only products and food can have variants. Remove the variants first."})

    if instance is None and not company and subscriptions_on():
        subscription = getattr(owner, "subscription", None)
        if (
            subscription is None
            or subscription.status != Subscription.ACTIVE
            or subscription.current_period_end < timezone.now()
        ):
            raise serializers.ValidationError({"subscription": SUBSCRIPTION_INACTIVE_MESSAGE})

        if active_listing_cap_reached(owner):
            raise serializers.ValidationError({"max_active_listings": LISTING_LIMIT_MESSAGE})

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
        if instance is None:
            if "has_warranty" not in initial_data:
                errors["has_warranty"] = PRODUCT_ANSWER_MESSAGES["has_warranty"]
            if "has_expiry" not in initial_data:
                errors["has_expiry"] = PRODUCT_ANSWER_MESSAGES["has_expiry"]
            if not (data.get("return_policy") or "").strip():
                errors["return_policy"] = PRODUCT_ANSWER_MESSAGES["return_policy"]
        elif "return_policy" in data and not (data.get("return_policy") or "").strip():
            errors["return_policy"] = PRODUCT_ANSWER_MESSAGES["return_policy"]

        has_warranty = data.get("has_warranty", getattr(instance, "has_warranty", False))
        warranty_details = data.get("warranty_details", getattr(instance, "warranty_details", ""))
        if has_warranty and not (warranty_details or "").strip():
            errors["warranty_details"] = (
                "Describe the warranty since this product comes with one."
            )

        has_expiry = data.get("has_expiry", getattr(instance, "has_expiry", False))
        expiry_date = data.get("expiry_date", getattr(instance, "expiry_date", None))
        if has_expiry and not expiry_date:
            errors["expiry_date"] = (
                "Provide the expiry date since this product can expire."
            )

    if errors:
        raise serializers.ValidationError(errors)

    return data


class OwnerListingSerializer(serializers.ModelSerializer):
    # Read-only nested gallery so a business owner's own listing view (used by
    # the "Submit for Hero" flow to pick a photo) can show the gallery without
    # a second round-trip — same shape as PublicListingSerializer/
    # ModerationListingSerializer's `photos` field.
    photos = serializers.SerializerMethodField()
    videos = serializers.SerializerMethodField()
    variants = ListingVariantSerializer(many=True, read_only=True)
    has_variants = serializers.SerializerMethodField()
    sale_ends_at = serializers.SerializerMethodField()
    pending_revision = serializers.SerializerMethodField()

    # The product's barcode (catalogue plan 6): typed with spaces or hyphens, kept as its 14-digit GTIN.
    barcode = serializers.CharField(required=False, allow_blank=True, max_length=40)

    class Meta:
        model = Listing
        fields = [
            "id", "variants", "has_variants", "pending_revision", "category", "zone", "name", "description", "price_amount", "sale_price", "sale_ends_at", "price_unit",
            "tag", "contact_phone", "lat", "lng", "main_photo", "photos", "videos", "specs",
            "service_duration", "units_total", *LISTING_DECISION_FIELDS, "barcode", "cancellation_policy",
            "status", "rejection_reason", "dropped_at", "discontinued_at", "created_at", "updated_at",
        ]
        read_only_fields = ["status", "rejection_reason", "dropped_at", "discontinued_at", "created_at", "updated_at"]
        extra_kwargs = {"contact_phone": {"required": False}, "units_total": {"required": False}}

    def get_has_variants(self, obj):
        return any(row.is_active for row in obj.variants.all())

    def get_sale_ends_at(self, obj):
        return live_sale_ends_at(obj)

    def to_representation(self, obj):
        data = super().to_representation(obj)
        if not pricing.is_discounted(obj):
            data["sale_price"] = None  # live-only, like sale_ends_at: an expired or inert sale price is not shown
        return data

    def get_photos(self, obj):
        return OwnerPhotoSerializer(list(obj.photos.all()), many=True, context=self.context).data

    def get_videos(self, obj):
        return OwnerVideoSerializer(list(obj.videos.all()), many=True, context=self.context).data

    def get_pending_revision(self, obj):
        """The open edit of this approved listing (draft, waiting, or rejected), small: enough for a banner."""
        rows = [row for row in obj.listing_revisions.all() if row.status != "approved"]
        if not rows:
            return None
        row = max(rows, key=lambda item: item.pk)
        return {"id": row.pk, "status": row.status, "rejection_reason": row.rejection_reason}

    def validate_barcode(self, value):
        return clean_listing_barcode(value, self.instance)

    def validate(self, data):
        if data.get("barcode"):
            clean_listing_barcode(data["barcode"], self.instance, data.get("category"))
        validate_sale_price(data, self.instance)
        if data.get("main_photo") and self.instance is not None and not self.instance.main_photo:
            from . import media

            if media.image_count(self.instance) >= media.MAX_IMAGES:
                raise serializers.ValidationError(
                    {"main_photo": f"A listing can have at most {media.MAX_IMAGES} images, the main photo included."}
                )
        # The owner is the signed-in business unless the caller names one (a company-run listing, Plan 2 Task 11).
        owner = self.context.get("owner") or self.context["request"].user
        return validate_listing_for_owner(
            owner, data, instance=self.instance, initial_data=self.initial_data,
            revising=self.context.get("revising", False), adds_variants=self.context.get("adds_variants", False),
        )

    def update(self, instance, validated_data):
        return save_sent_fields(instance, validated_data)

    def create(self, validated_data):
        owner = self.context.get("owner") or self.context["request"].user
        return services.create_listing(owner, validated_data, staff=self.context.get("staff"))


class ModerationListingSerializer(serializers.ModelSerializer):
    category = CategorySerializer(read_only=True)
    zone = ZoneSerializer(read_only=True)
    photos = serializers.SerializerMethodField()
    # Every video row with its status and playable url, so staff watch them before the listing goes public.
    videos = OwnerVideoSerializer(many=True, read_only=True)
    # Every variant row (switched-off ones too, with is_active): its name and attribute values are public text.
    variants = ListingVariantSerializer(many=True, read_only=True)
    # business_owner_name (staff moderation-queue restructuring, item 2) lets
    # the panel group/identify listings by their owning business without a
    # second lookup. reviewed_by_name/reviewed_at (approver attribution) back
    # the Approved/Rejected tabs' "who actioned this" line.
    business_owner_name = serializers.CharField(source="business_owner.full_name", read_only=True)
    reviewed_by_name = serializers.CharField(source="reviewed_by.full_name", read_only=True, default=None)
    # Chips for the reviewer: a fraud case still open on the business, and a
    # subscription that is overdue (day N). Both from the records, never guessed.
    open_fraud_cases = serializers.SerializerMethodField()
    subscription_overdue = serializers.SerializerMethodField()

    class Meta:
        model = Listing
        fields = [
            "id", "business_owner", "business_owner_name", "name", "description", "category",
            "zone", "price_amount", "price_unit", "tag", "contact_phone", "lat", "lng",
            "main_photo", "photos", "videos", "variants", "specs", "service_duration", *LISTING_DECISION_FIELDS,
            "status", "rejection_reason", "created_at",
            "reviewed_by_name", "reviewed_at", "open_fraud_cases", "subscription_overdue", "sponsored",
        ]
        # Read-only on this staff view; a reviewer sees every answer the owner gave.
        read_only_fields = LISTING_DECISION_FIELDS

    def get_photos(self, obj):
        return live_photos(obj, self.context)

    def get_open_fraud_cases(self, obj):
        from fraud.models import FraudFlag

        return FraudFlag.objects.filter(
            Q(business_owner_id=obj.business_owner_id) | Q(related_business_owner_id=obj.business_owner_id),
            status=FraudFlag.OPEN,
        ).count()

    def get_subscription_overdue(self, obj):
        from billing.clock import OVERDUE, subscription_state

        subscription = getattr(obj.business_owner, "subscription", None)
        if subscription is None:
            return None
        state = subscription_state(subscription)
        if state["state"] != OVERDUE:
            return None
        # "of 14" only while day 15 pauses the listings; with the pause off there is no deadline to name.
        return {"day": state["overdue_day"], "grace_days": 14 if state["pause_enabled"] else None}


class HeroMediaModerationSerializer(serializers.ModelSerializer):
    """Staff-facing shape for the hero-media approval queue/detail views —
    mirrors ModerationListingSerializer's field selection.
    """

    business_owner_name = serializers.CharField(source="business_owner.full_name", read_only=True, default=None)
    created_by_staff_name = serializers.CharField(source="created_by_staff.full_name", read_only=True, default=None)
    youtube_id = serializers.CharField(read_only=True)
    # Approver attribution (staff moderation-queue restructuring) — backs the
    # Approved/Rejected tabs' "who actioned this" line.
    reviewed_by_name = serializers.CharField(source="reviewed_by.full_name", read_only=True, default=None)
    reviewed_by_role = serializers.CharField(source="reviewed_by.role.get_name_display", read_only=True, default=None)

    class Meta:
        model = HeroMediaSubmission
        fields = [
            "id", "business_owner", "business_owner_name", "media", "media_type", "caption",
            "status", "rejection_reason", "submitted_at", "approved_at", "expires_at",
            "extended_days", "reviewed_by_name", "reviewed_by_role", "reviewed_at",
            "title", "video_file", "youtube_url", "youtube_id", "link_path", "starts_at", "ends_at",
            "created_by_staff_name",
        ]


class HeroMediaStaffSerializer(HeroMediaModerationSerializer):
    """The staff queue shape: the moderation shape plus the listing it promotes
    and the server-computed checklist (canvas 14). Checks are computed for rows
    still waiting for a decision only; a decided row carries an empty list."""

    listing_name = serializers.CharField(source="listing.name", read_only=True, default=None)
    checks = serializers.SerializerMethodField()
    can_approve = serializers.SerializerMethodField()

    class Meta(HeroMediaModerationSerializer.Meta):
        fields = HeroMediaModerationSerializer.Meta.fields + ["listing", "listing_name", "checks", "can_approve"]

    def _checks(self, obj):
        cached = getattr(obj, "_staff_checks", None)
        if cached is None:
            from .moderation_checks import hero_checks

            cached = hero_checks(obj) if obj.status == HeroMediaSubmission.PENDING else []
            obj._staff_checks = cached
        return cached

    def get_checks(self, obj):
        return self._checks(obj)

    def get_can_approve(self, obj):
        from .moderation_checks import blocking_failures

        return obj.status == HeroMediaSubmission.PENDING and not blocking_failures(self._checks(obj))


class HeroActiveSerializer(serializers.ModelSerializer):
    """Public shape for the live hero slider — GET /api/hero/active/. The first block is the
    slide itself; the second is what the older slider reads (`media`, the CTA fields, dates) and
    stays so it keeps working. No phone, email or owner id is ever exposed."""

    image = serializers.SerializerMethodField()
    video_url = serializers.SerializerMethodField()
    youtube_id = serializers.CharField(read_only=True, default=None)
    listing_id = serializers.IntegerField(read_only=True, default=None)
    # No `business_name`: it was the owner's personal full_name, and no slider shows it.
    # The listing behind this hero slide, so the slider's Buy Now / Engage
    # Service CTA can route to the cart (product) or the listing (service).
    listing_kind = serializers.CharField(source="listing.category.kind", read_only=True, default=None)
    price_amount = serializers.DecimalField(
        source="listing.price_amount", max_digits=10, decimal_places=2, read_only=True, default=None,
    )

    class Meta:
        model = HeroMediaSubmission
        fields = [
            "id", "media_type", "image", "video_url", "youtube_id", "title", "caption", "link_path", "listing_id",
            "media", "approved_at", "expires_at", "listing", "listing_kind", "price_amount",
        ]

    def _url(self, field):
        if not field:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(field.url) if request else field.url

    def get_image(self, obj):
        return self._url(obj.media)

    def get_video_url(self, obj):
        return self._url(obj.video_file)


class HeroSlideInputSerializer(serializers.Serializer):
    """Input for a new slide (business submission and staff-made): multipart, validated through
    listings.hero_rules. The same rules apply to both."""

    media_type = serializers.ChoiceField(choices=["image", "video"], default="image")
    media = serializers.FileField(required=False, allow_null=True)
    video_file = serializers.FileField(required=False, allow_null=True)
    youtube_url = serializers.CharField(required=False, allow_blank=True, max_length=300)
    title = serializers.CharField(required=False, allow_blank=True, max_length=140)
    caption = serializers.CharField(required=False, allow_blank=True, max_length=140)
    starts_at = serializers.DateTimeField()
    ends_at = serializers.DateTimeField()
    link_path = serializers.CharField(required=False, allow_blank=True, max_length=200)
    listing = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, data):
        from django.core.exceptions import ValidationError as DjangoValidationError

        from . import hero_rules
        from .moderation_checks import CONTACT_DETAILS_MESSAGE, contact_details_in

        media = data.get("media")
        if media is not None and media.size > 5 * 1024 * 1024:
            raise serializers.ValidationError({"media": "The photo must be 5 MB or smaller."})

        def fail(field, exc):
            raise serializers.ValidationError({field: exc.messages[0]})

        try:
            hero_rules.validate_window(data["starts_at"], data["ends_at"])
        except DjangoValidationError as exc:
            fail("ends_at", exc)
        try:
            data.update(hero_rules.validate_media(
                data["media_type"], data.get("media"), data.get("video_file"), (data.get("youtube_url") or "").strip(),
            ))
        except DjangoValidationError as exc:
            fail("media" if data["media_type"] == "image" else "video_file", exc)
        try:
            data["link_path"] = hero_rules.clean_link_path(data.get("link_path"))
        except DjangoValidationError as exc:
            fail("link_path", exc)
        for field in ("title", "caption"):
            if contact_details_in(data.get(field)):
                raise serializers.ValidationError({field: CONTACT_DETAILS_MESSAGE})
        return data


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
            "id", "listing", "kind", "starts_at", "ends_at", "keywords", "amount_paid",
            "status", "rejection_reason",
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
    checks = serializers.SerializerMethodField()
    fraud_hold = serializers.SerializerMethodField()
    days_left = serializers.SerializerMethodField()
    paid_days = serializers.SerializerMethodField()
    # Reserved for the Featured-listings package: which slot an approved
    # promotion was placed in. Always null until that package lands.
    slot = serializers.SerializerMethodField()

    class Meta:
        model = Promotion
        fields = [
            "id", "listing", "listing_name", "business_owner_name", "kind",
            "starts_at", "ends_at", "keywords", "amount_paid", "status",
            "rejection_reason", "is_currently_active", "created_at",
            "checks", "fraud_hold", "days_left", "paid_days", "slot",
        ]
        read_only_fields = fields

    def get_checks(self, obj):
        from .moderation_checks import promotion_checks

        return promotion_checks(obj)

    def get_fraud_hold(self, obj):
        from .moderation_checks import fraud_hold, open_fraud_flag

        if obj.status != Promotion.PENDING:
            return None
        return fraud_hold(open_fraud_flag(obj.listing.business_owner_id, self.context.get("fraud_flags")))

    def get_days_left(self, obj):
        from .moderation_checks import days_left

        return days_left(obj)

    def get_paid_days(self, obj):
        return max(1, round((obj.ends_at - obj.starts_at).total_seconds() / 86400))

    def get_slot(self, obj):
        return None


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

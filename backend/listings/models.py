from django.db import models
from django.utils import timezone

from accounts.models import BusinessOwner
from accounts.validators import validate_image_content_type

from .validators import validate_image_size


class Category(models.Model):
    PRODUCT = "product"
    SERVICE = "service"
    EVENT = "event"
    KIND_CHOICES = [
        (PRODUCT, "Product"),
        (SERVICE, "Service"),
        (EVENT, "Event"),
    ]

    slug = models.SlugField(max_length=50, unique=True)
    icon = models.CharField(max_length=10)
    label = models.CharField(max_length=100)
    color = models.CharField(max_length=20)
    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default=PRODUCT)
    # Accommodation categories (hotel, real estate, Airbnb) — business item 2 /
    # Wave H3. A listing in an is_accommodation category is booked by date
    # (check-in/out) through the booking engine, not requested (services) or
    # carted (products). Only ever meaningful for a service-kind category.
    is_accommodation = models.BooleanField(default=False)
    # Prepared food (chop bars, restaurants): carted and delivered like a product, but one delivery collects from at most
    # RateCard.max_food_shops food places and collects them last (spec 2026-10-14). Set on the "food" and "beverages"
    # categories by migration 0020; `kind` stays as it was.
    is_food = models.BooleanField(default=False)
    # The shopper department tree (Plan M1). A product department is a top-level product category
    # (`is_department`); its children are sub-categories, and the product categories that pre-date the tree
    # sit under the department they were mapped to (listings migration 0023). Service, stay and event categories
    # stay top-level. `sort_order` is the seed order within a parent.
    parent = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT, related_name="children")
    sort_order = models.PositiveIntegerField(default=0)

    @property
    def is_department(self):
        return self.parent_id is None and self.kind == self.PRODUCT

    def __str__(self):
        return self.label


class CategoryVisit(models.Model):
    """How many times shoppers opened a category on one day (Accra); feeds listings.visits.most_visited."""

    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name="visits")
    day = models.DateField()
    count = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["category", "day"], name="uniq_category_visit_day")]


class Zone(models.Model):
    name = models.CharField(max_length=50, unique=True)

    def __str__(self):
        return self.name


class Listing(models.Model):
    CONDITION_NEW = "new"
    CONDITION_USED = "used"
    CONDITION_REFURBISHED = "refurbished"
    CONDITION_CHOICES = [
        (CONDITION_NEW, "New"),
        (CONDITION_USED, "Used"),
        (CONDITION_REFURBISHED, "Refurbished"),
    ]

    DRAFT = "draft"
    PENDING_REVIEW = "pending_review"
    PUBLISHED = "published"
    REJECTED = "rejected"
    # Dropped: hidden by its owner, returns on restore with no re-approval. Discontinued: permanent.
    DROPPED = "dropped"
    DISCONTINUED = "discontinued"
    STATUS_CHOICES = [
        (DRAFT, "Draft"),
        (PENDING_REVIEW, "Pending Review"),
        (PUBLISHED, "Published"),
        (REJECTED, "Rejected"),
        (DROPPED, "Dropped"),
        (DISCONTINUED, "Discontinued"),
    ]

    business_owner = models.ForeignKey(BusinessOwner, on_delete=models.CASCADE, related_name="listings")
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="listings")
    zone = models.ForeignKey(Zone, on_delete=models.PROTECT, related_name="listings")

    name = models.CharField(max_length=150)
    description = models.TextField()
    price_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    # A live discount (Plan M1 Deals): goes live at once, valid only below price_amount (see listings.pricing).
    sale_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    # Optional end of the discount (listings.pricing.live_discount_q): read-time expiry, no job. Null = no end date.
    sale_ends_at = models.DateTimeField(null=True, blank=True)
    # Flagged by marketing/operations/super admin (`deals.manage`): appears in Deals even without a discount.
    sponsored = models.BooleanField(default=False)
    sponsored_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="sponsored_listings",
    )
    price_unit = models.CharField(max_length=30, null=True, blank=True)
    tag = models.CharField(max_length=50, null=True, blank=True)
    contact_phone = models.CharField(max_length=20)
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    main_photo = models.ImageField(
        upload_to="listing_photos/main/", null=True, blank=True,
        validators=[validate_image_content_type, validate_image_size],
    )

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=DRAFT)
    rejection_reason = models.CharField(max_length=500, null=True, blank=True)
    dropped_at = models.DateTimeField(null=True, blank=True)
    discontinued_at = models.DateTimeField(null=True, blank=True)

    # Approver attribution (staff moderation-queue restructuring) — which staff
    # member approved (published) OR rejected this listing, and when. Set by
    # ModerationApproveView/ModerationRejectView; cleared by
    # ModerationReReviewView when a rejected listing is re-opened to pending.
    # Same canonical reviewed_by/reviewed_at pair as BusinessOwner (KYC) and
    # HeroMediaSubmission.
    reviewed_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reviewed_listings",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    # A listing a scout proposed for the business (portfolio `listing.create`,
    # staff phase 2): the approval that published it is its moderation, and
    # this keeps who made it. Null for everything the owner made.
    created_by_staff = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="listings_created_for_owners",
    )

    # Structured (not freeform-text) spec table, per the reviews/ratings/Q&A
    # plan's ListingDetailPage "Specs" tab (docs/PROJECT_SCOPE.md) — a list
    # of {"label": ..., "value": ...} dicts so the frontend can render a real
    # table rather than parsing prose. service_duration is the service-kind
    # equivalent of a spec, kept as its own field (a single free-text value
    # like "45 minutes" or "2-3 business days") rather than folded into specs
    # since it's shown in its own dedicated tab for service listings.
    specs = models.JSONField(default=list, blank=True)
    service_duration = models.CharField(max_length=100, blank=True)

    # ── Product decision fields (comprehensive listing-creation work) ──────
    # All nullable/blank-defaulted so pre-existing rows are unaffected; the
    # "a product listing must consciously answer warranty/expiry/returns"
    # rule is enforced at creation time in OwnerListingSerializer.validate(),
    # not at the DB level (existing data stays valid).
    has_warranty = models.BooleanField(default=False)
    warranty_details = models.TextField(blank=True)
    has_expiry = models.BooleanField(default=False)
    expiry_date = models.DateField(null=True, blank=True)
    return_policy = models.TextField(blank=True)
    brand = models.CharField(max_length=100, blank=True)
    condition = models.CharField(max_length=15, choices=CONDITION_CHOICES, blank=True)
    # Freeform strings, not structured numerics — sellers describe these in
    # their own words/units (e.g. "30cm x 20cm x 5cm", "1.2 kg"), same
    # philosophy as price_unit/service_duration.
    dimensions = models.CharField(max_length=100, blank=True)
    weight = models.CharField(max_length=50, blank=True)
    stock_quantity = models.PositiveIntegerField(null=True, blank=True)
    # Catalogue plan 6 (spec §1 rows 7-8, §10): the product's barcode as its 14-digit GTIN (catalogue.identity), "" when
    # none; and the shared catalogue entry this offer belongs to, set only when staff approve a grouping request
    # (catalogue.attach). Null: the listing stands alone (unbranded goods, services, stays, and every listing made before
    # plan 6). Neither is in the public serializers.
    barcode = models.CharField(max_length=14, blank=True, default="")
    catalogue_product = models.ForeignKey(
        "catalogue.CatalogueProduct", on_delete=models.SET_NULL, null=True, blank=True, related_name="offers",
    )

    # ── Service decision fields ─────────────────────────────────────────────
    # Fiverr-style gig framing: what the buyer gets, what the seller needs
    # from them, revision allowance, and turnaround — all optional freeform.
    whats_included = models.TextField(blank=True)
    requirements = models.TextField(blank=True)
    revisions = models.CharField(max_length=100, blank=True)
    delivery_time = models.CharField(max_length=100, blank=True)

    # ── Accommodation (booking engine, Wave H3) ─────────────────────────────
    # How many rooms/units this accommodation listing has. The booking engine
    # prevents the units booked for any overlapping night from exceeding this.
    # price_amount doubles as the per-night rate for an accommodation listing.
    units_total = models.PositiveIntegerField(default=1)

    # What a customer gets back when they cancel a service or stay before it is delivered (ledger.cancellation, Plan 7E).
    # Copied onto the sale when it is paid, so an edit here never changes a sale already paid.
    cancellation_policy = models.CharField(
        max_length=10, choices=[("flexible", "Flexible"), ("moderate", "Moderate"), ("strict", "Strict")], default="flexible",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            # Only barcoded rows: most listings have none, and the matcher and the grouping check look up by code.
            models.Index(fields=["barcode"], name="listing_barcode_idx", condition=~models.Q(barcode="")),
        ]

    def __str__(self):
        return self.name

    _UNKNOWN = object()

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        # What the row held when loaded, to tell a price change from a plain save without a query.
        instance._loaded_price = instance.__dict__.get("price_amount", cls._UNKNOWN)
        return instance

    @property
    def effective_price(self):
        """The one price read: the sale price while it is a real discount, otherwise `price_amount`."""
        from . import pricing

        return pricing.effective_price(self)

    def save(self, *args, **kwargs):
        from . import pricing

        update_fields = kwargs.get("update_fields")
        adding = self._state.adding
        touches_price = update_fields is None or "price_amount" in update_fields
        loaded = getattr(self, "_loaded_price", self._UNKNOWN)
        changed = adding or loaded is self._UNKNOWN or pricing.dec(loaded) != pricing.dec(self.price_amount)
        super().save(*args, **kwargs)
        if touches_price and changed:
            pricing.record_price(self)
        if touches_price:
            self._loaded_price = self.price_amount


class ListingPriceHistory(models.Model):
    """One regular price a listing held, from `started_at` until `ended_at` (null while it is the current one).
    Recorded from the day Task 6 shipped; it backs the 7-day "was" price rule (listings.pricing)."""

    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="price_history")
    # Null for the listing's own price; set for one variant's regular price (listing queries filter variant__isnull).
    variant = models.ForeignKey("ListingVariant", on_delete=models.CASCADE, null=True, blank=True, related_name="price_history")
    price = models.DecimalField(max_digits=10, decimal_places=2)
    started_at = models.DateTimeField(default=timezone.now)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["listing", "ended_at"], name="listing_price_open_idx"),
            models.Index(fields=["variant", "ended_at"], name="listing_vprice_open_idx"),
        ]

    def __str__(self):
        return f"{self.listing_id}: {self.price} from {self.started_at:%Y-%m-%d}"


class ListingVariant(models.Model):
    """One buyable version of a listing (a flavour, a size) with its own price and stock. The listing keeps a derived
    "from" price and summed stock (listings.variants.sync_listing), so every reader of the listing stays correct.
    A variant is never deleted once an order may point at it: it is switched off (`is_active=False`)."""

    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="variants")
    label = models.CharField(max_length=100)
    attributes = models.JSONField(default=dict, blank=True)
    price_amount = models.DecimalField(max_digits=10, decimal_places=2)
    # A discount on this variant alone (same rules as Listing.sale_price / sale_ends_at; listings.pricing).
    sale_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    sale_ends_at = models.DateTimeField(null=True, blank=True)
    # None = stock is not counted for this variant.
    stock_quantity = models.PositiveIntegerField(null=True, blank=True)
    position = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "pk"]
        constraints = [
            models.UniqueConstraint(
                fields=["listing", "label"], condition=models.Q(is_active=True), name="listing_variant_label_active_uniq",
            ),
        ]

    def __str__(self):
        return f"{self.label} ({self.listing_id})"

    @property
    def effective_price(self):
        """What one unit of this variant costs now: its live sale price, otherwise its regular price."""
        from . import pricing

        return pricing.effective_price(self)

    def save(self, *args, **kwargs):
        from . import pricing

        update_fields = kwargs.get("update_fields")
        super().save(*args, **kwargs)
        if update_fields is None or "price_amount" in update_fields:
            pricing.record_variant_price(self)


class ListingRevision(models.Model):
    """A proposed edit of an approved listing. The listing row is untouched until staff approve it
    (listings.revisions.apply_revision copies it over in one transaction). `changes` holds the scalar fields,
    `variants` the variant structure operations, `remove_photo_ids`/`remove_video_ids` the gallery items to delete and
    `new_main_photo` a staged replacement main photo. One open (draft or pending) revision per listing.
    `draft` is outside the staff queue so an owner can prepare several changes before sending."""

    DRAFT = "draft"
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    STATUS_CHOICES = [(DRAFT, "Draft"), (PENDING, "Pending"), (APPROVED, "Approved"), (REJECTED, "Rejected")]

    # `Listing.revisions` is already a text field (a service's revision allowance), hence this related_name.
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="listing_revisions")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=DRAFT)
    changes = models.JSONField(default=dict, blank=True)
    variants = models.JSONField(default=list, blank=True)
    remove_photo_ids = models.JSONField(default=list, blank=True)
    remove_video_ids = models.JSONField(default=list, blank=True)
    new_main_photo = models.ImageField(
        upload_to="listing_photos/main/", null=True, blank=True,
        validators=[validate_image_content_type, validate_image_size],
    )
    created_by = models.ForeignKey(
        BusinessOwner, on_delete=models.SET_NULL, null=True, blank=True, related_name="listing_revisions",
    )
    created_by_staff = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="listing_revisions_created",
    )
    rejection_reason = models.CharField(max_length=500, null=True, blank=True)
    reviewed_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="reviewed_listing_revisions",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["listing"], condition=models.Q(status__in=["draft", "pending"]), name="listing_one_open_revision",
            ),
        ]

    def __str__(self):
        return f"Edit of {self.listing.name} ({self.status})"


class ListingPhoto(models.Model):
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="photos")
    image = models.ImageField(
        upload_to="listing_photos/gallery/", validators=[validate_image_content_type]
    )
    order = models.PositiveSmallIntegerField(default=0)
    # Set while the photo is staged in an open edit of an approved listing; the public never sees such a row.
    revision = models.ForeignKey(
        "ListingRevision", on_delete=models.CASCADE, null=True, blank=True, related_name="staged_photos",
    )

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return f"Photo {self.order} for {self.listing.name}"


class ListingVideo(models.Model):
    """A listing video: an uploaded file converted for the web, or a YouTube link (only its 11-character id is kept).
    `status` is processing -> converting -> ready | failed for uploads (a YouTube row is ready at once). `converting`
    is the claim a conversion task takes so a redelivered task cannot run twice. `revision` is set while the video is
    staged in an open edit of an approved listing."""

    UPLOAD = "upload"
    YOUTUBE = "youtube"
    KIND_CHOICES = [(UPLOAD, "Upload"), (YOUTUBE, "YouTube")]
    PROCESSING = "processing"
    CONVERTING = "converting"
    READY = "ready"
    FAILED = "failed"
    STATUS_CHOICES = [(PROCESSING, "Processing"), (CONVERTING, "Converting"), (READY, "Ready"), (FAILED, "Failed")]

    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="videos")
    revision = models.ForeignKey(
        "ListingRevision", on_delete=models.CASCADE, null=True, blank=True, related_name="staged_videos",
    )
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    source = models.FileField(upload_to="listing_videos/source/", null=True, blank=True)
    web_file = models.FileField(upload_to="listing_videos/web/", null=True, blank=True)
    poster = models.ImageField(upload_to="listing_videos/poster/", null=True, blank=True)
    youtube_id = models.CharField(max_length=11, blank=True)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=PROCESSING)
    duration_seconds = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    position = models.PositiveSmallIntegerField(default=0)
    claimed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["position", "id"]

    @property
    def owner_status(self):
        """`converting` is our own claim marker; to owners and staff it is still processing."""
        return self.PROCESSING if self.status == self.CONVERTING else self.status

    def __str__(self):
        return f"Video {self.pk} ({self.kind}, {self.status}) for {self.listing.name}"


class HeroMediaSubmission(models.Model):
    """A business's submission of one gallery item + caption for hero-slider
    consideration (docs/BUSINESS_EVENTS_ROADMAP.md Phase 2). Approved by any
    of marketing/admin/super_admin (`hero_media.approve`); how long it stays
    live is driven by the business's current subscription tier's
    `SubscriptionPlan.hero_days`.
    """

    IMAGE = "image"
    VIDEO = "video"
    MEDIA_TYPE_CHOICES = [
        (IMAGE, "Image"),
        (VIDEO, "Video"),
    ]

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    STATUS_CHOICES = [
        (PENDING, "Pending"),
        (APPROVED, "Approved"),
        (REJECTED, "Rejected"),
    ]

    # Null for a slide Marketing made itself (created_by_staff is set then).
    business_owner = models.ForeignKey(
        BusinessOwner, on_delete=models.CASCADE, related_name="hero_media_submissions", null=True, blank=True,
    )
    created_by_staff = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="hero_slides_created",
    )
    # The listing this hero media promotes (derived from the submitted
    # ListingPhoto's listing). Lets the public hero slider deep-link a "Buy Now"/
    # "Engage Service" CTA to the right listing, and lets the per-listing hero
    # slot rule (one live hero per listing, up to the plan's hero_slots) work.
    # SET_NULL so deleting the listing doesn't wipe an in-flight hero submission.
    listing = models.ForeignKey(
        "Listing", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="hero_submissions",
    )
    # Reuses the same content-type validation as ListingPhoto/Listing.main_photo
    # (jpeg/png only, sniffed via python-magic) — there is no video validator
    # in the codebase yet, so `media_type=video` submissions are accepted at
    # the model/choices level but not yet content-validated as video files.
    # Image slides carry `media`; video slides carry an uploaded `video_file` (mp4/webm) or a
    # normalised `youtube_url`. The views validate through listings.hero_rules.
    media = models.ImageField(
        upload_to="hero_media/", validators=[validate_image_content_type], null=True, blank=True,
    )
    video_file = models.FileField(upload_to="hero_media/video/", null=True, blank=True)
    youtube_url = models.URLField(blank=True)
    media_type = models.CharField(max_length=10, choices=MEDIA_TYPE_CHOICES, default=IMAGE)
    title = models.CharField(max_length=140, blank=True)
    caption = models.CharField(max_length=140)
    # A page on this site, never a full address (hero_rules.clean_link_path).
    link_path = models.CharField(max_length=200, blank=True)
    # The run dates the business picks (at most 30 days). Null on rows from before slides had dates.
    starts_at = models.DateTimeField(null=True, blank=True)
    ends_at = models.DateTimeField(null=True, blank=True)

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    rejection_reason = models.CharField(max_length=500, null=True, blank=True)

    # Approver attribution (staff moderation-queue restructuring) — which staff
    # member approved OR rejected this hero submission, and when. Set by
    # HeroApproveView/HeroRejectView; cleared by HeroReReviewView when a
    # rejected submission is re-opened to pending. Same canonical
    # reviewed_by/reviewed_at pair as BusinessOwner (KYC) and Listing. Distinct
    # from approved_at (the moment the visibility window starts), which stays a
    # separate field since it also drives expires_at.
    reviewed_by = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reviewed_hero_submissions",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    submitted_at = models.DateTimeField(auto_now_add=True)
    approved_at = models.DateTimeField(null=True, blank=True)
    # Computed on approval as approved_at + the business's current plan's
    # hero_days (0 if the business has no active subscription); bumped
    # further by HeroExtendView's simulated-payment extension flow.
    expires_at = models.DateTimeField(null=True, blank=True)
    # Running total of paid extension days (simulated payment), separate
    # from the base hero_days grant so both remain individually visible.
    extended_days = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-submitted_at"]

    def __str__(self):
        who = self.business_owner.full_name if self.business_owner_id else "AshantiHub"
        return f"Hero submission {self.id} for {who} ({self.status})"

    @property
    def youtube_id(self):
        from .hero_rules import youtube_id

        return youtube_id(self.youtube_url) if self.youtube_url else None


class Promotion(models.Model):
    """A business owner's paid purchase to rank a listing higher in search
    results (docs/BUSINESS_EVENTS_ROADMAP.md Phase 5) — distinct from
    subscription tier. Two kinds:

    - ``featured``: the listing always ranks first, regardless of search term.
    - ``boost``: the listing ranks first only for searches matching its
      ``keywords`` (e.g. a comma/space-separated string like "kente wedding
      gifts") — a lighter-weight, cheaper promotion than ``featured``.

    ``status`` is a small lifecycle field distinct from the ``starts_at``/
    ``ends_at`` time window: ``active`` is the normal state for a purchased,
    in-flight-or-live promotion; ``cancelled`` is an explicit early-stop (not
    currently exposed via any endpoint, reserved for a future staff/owner
    cancel action); ``expired`` is informational only — nothing in this app
    transitions a row to it automatically, since "is this promotion
    currently affecting ranking" is answered purely at query time via
    ``status=active`` AND ``starts_at <= now <= ends_at`` (see
    `is_currently_active` below and `PublicListingListView`'s ranking
    annotation). A row whose ``ends_at`` has simply passed still reads
    ``status=active`` unless something explicitly flips it — that's fine,
    since nothing reads `status` alone as "is this live" without also
    checking the timestamps. No cron/expiry job is needed for ranking to
    correctly stop reflecting an expired promotion (unlike Phase 6's
    `Event.expires_at`, which needs `expire_events` because expiry there
    also drives hide/delete behavior, not just ranking order).
    """

    FEATURED = "featured"
    BOOST = "boost"
    KIND_CHOICES = [
        (FEATURED, "Featured"),
        (BOOST, "Boost"),
    ]

    # A purchased promotion is now staff-moderated before it affects ranking
    # (pre-prod bug fix 7): the owner pays, the row is created ``pending``, and a
    # staffer with promotions.manage approves it (→ active, window reset to start
    # now) or rejects it (→ rejected, with a reason). ``active`` is the live
    # state; ``cancelled`` is an explicit early-stop; ``expired`` is informational
    # only (derived from the time window at query time, never written).
    PENDING = "pending"
    ACTIVE = "active"
    REJECTED = "rejected"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (PENDING, "Pending approval"),
        (ACTIVE, "Active"),
        (REJECTED, "Rejected"),
        (EXPIRED, "Expired"),
        (CANCELLED, "Cancelled"),
    ]

    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="promotions")
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    # Only meaningful for kind=boost — blank for kind=featured.
    keywords = models.CharField(max_length=255, blank=True)
    amount_paid = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    # Set when a staffer rejects a pending promotion.
    rejection_reason = models.CharField(max_length=255, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-starts_at"]

    def __str__(self):
        return f"{self.get_kind_display()} promotion for {self.listing.name} ({self.status})"

    @property
    def is_currently_active(self):
        """Whether this promotion should currently affect ranking — the same
        condition `PublicListingListView` evaluates at query time.
        """
        now = timezone.now()
        return self.status == self.ACTIVE and self.starts_at <= now <= self.ends_at

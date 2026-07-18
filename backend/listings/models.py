from django.db import models
from django.utils import timezone

from accounts.models import BusinessOwner
from accounts.validators import validate_image_content_type


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

    def __str__(self):
        return self.label


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
    STATUS_CHOICES = [
        (DRAFT, "Draft"),
        (PENDING_REVIEW, "Pending Review"),
        (PUBLISHED, "Published"),
        (REJECTED, "Rejected"),
    ]

    business_owner = models.ForeignKey(BusinessOwner, on_delete=models.CASCADE, related_name="listings")
    category = models.ForeignKey(Category, on_delete=models.PROTECT, related_name="listings")
    zone = models.ForeignKey(Zone, on_delete=models.PROTECT, related_name="listings")

    name = models.CharField(max_length=150)
    description = models.TextField()
    price_amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    price_unit = models.CharField(max_length=30, null=True, blank=True)
    tag = models.CharField(max_length=50, null=True, blank=True)
    contact_phone = models.CharField(max_length=20)
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    main_photo = models.ImageField(
        upload_to="listing_photos/main/", null=True, blank=True,
        validators=[validate_image_content_type],
    )

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=DRAFT)
    rejection_reason = models.CharField(max_length=500, null=True, blank=True)

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

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name


class ListingPhoto(models.Model):
    listing = models.ForeignKey(Listing, on_delete=models.CASCADE, related_name="photos")
    image = models.ImageField(
        upload_to="listing_photos/gallery/", validators=[validate_image_content_type]
    )
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return f"Photo {self.order} for {self.listing.name}"


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

    business_owner = models.ForeignKey(
        BusinessOwner, on_delete=models.CASCADE, related_name="hero_media_submissions"
    )
    # Reuses the same content-type validation as ListingPhoto/Listing.main_photo
    # (jpeg/png only, sniffed via python-magic) — there is no video validator
    # in the codebase yet, so `media_type=video` submissions are accepted at
    # the model/choices level but not yet content-validated as video files.
    media = models.ImageField(
        upload_to="hero_media/", validators=[validate_image_content_type]
    )
    media_type = models.CharField(max_length=10, choices=MEDIA_TYPE_CHOICES, default=IMAGE)
    caption = models.CharField(max_length=140)

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
        return f"Hero submission {self.id} for {self.business_owner.full_name} ({self.status})"


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

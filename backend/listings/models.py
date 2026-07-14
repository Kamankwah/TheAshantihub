from django.db import models

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

    def __str__(self):
        return self.label


class Zone(models.Model):
    name = models.CharField(max_length=50, unique=True)

    def __str__(self):
        return self.name


class Listing(models.Model):
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

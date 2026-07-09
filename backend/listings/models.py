from django.db import models

from accounts.models import BusinessOwner


class Category(models.Model):
    slug = models.SlugField(max_length=50, unique=True)
    icon = models.CharField(max_length=10)
    label = models.CharField(max_length=100)
    color = models.CharField(max_length=20)

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
    main_photo = models.ImageField(upload_to="listing_photos/main/", null=True, blank=True)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=DRAFT)
    rejection_reason = models.CharField(max_length=500, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.name

"""Site banners and paid featured slots (Marketing canvas 12 and 13).

Banners speak for AshantiHub and go live only once Super Admin approves them
(approval kind `marketing.banner`). Their view and click counters are first-party
and start at zero: nothing here is estimated or imported.

Featured slots tie a paid `listings.Promotion` (kind=featured) to a place on the
site for whole weeks. The weekly slot price is configuration on the FeaturedSlot
row; it is NOT the price the owner paid for the promotion (listings
PROMOTION_DAILY_RATES), and a booking never changes `Promotion.amount_paid`."""
from django.db import models
from django.db.models import Q
from django.utils import timezone

from accounts.validators import validate_image_content_type


class Banner(models.Model):
    HOME_HERO = "home_hero"
    HOME_STRIP = "home_strip"
    CATEGORY_TOP = "category_top"
    EVENTS_TOP = "events_top"
    SLOT_CHOICES = [
        (HOME_HERO, "Home page, hero"),
        (HOME_STRIP, "Home page, middle strip"),
        (CATEGORY_TOP, "Category page, top"),
        (EVENTS_TOP, "Events page, top"),
    ]

    DRAFT = "draft"
    WAITING = "waiting"
    APPROVED = "approved"
    REJECTED = "rejected"
    TAKEN_DOWN = "taken_down"
    STATE_CHOICES = [
        (DRAFT, "Draft"),
        (WAITING, "Waiting for Super Admin"),
        (APPROVED, "Approved"),
        (REJECTED, "Returned"),
        (TAKEN_DOWN, "Taken down"),
    ]

    slot = models.CharField(max_length=14, choices=SLOT_CHOICES)
    category = models.ForeignKey("listings.Category", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    title = models.CharField(max_length=140)
    alt_text = models.CharField(max_length=200)
    image = models.ImageField(upload_to="marketing/banners/", validators=[validate_image_content_type])
    # An internal path on this site ("/events"), never a full URL, phone or WhatsApp link.
    link_path = models.CharField(max_length=200, blank=True)
    sponsored = models.BooleanField(default=False)
    internal_note = models.CharField(max_length=300, blank=True)

    starts_at = models.DateTimeField()
    # Null: always on, until taken down.
    ends_at = models.DateTimeField(null=True, blank=True)

    state = models.CharField(max_length=10, choices=STATE_CHOICES, default=DRAFT)
    approval = models.ForeignKey("approvals.ApprovalRequest", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    approved_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    approved_at = models.DateTimeField(null=True, blank=True)
    return_note = models.CharField(max_length=500, blank=True)
    taken_down_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    taken_down_at = models.DateTimeField(null=True, blank=True)

    # First-party counters, written only by the count-only beacon endpoints.
    views = models.PositiveBigIntegerField(default=0)
    clicks = models.PositiveBigIntegerField(default=0)

    created_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-starts_at", "-id"]
        indexes = [models.Index(fields=["slot", "state", "starts_at"], name="mkt_banner_live_idx")]

    def __str__(self):
        return self.title

    @classmethod
    def live(cls, now=None):
        """Approved banners whose window is open now: the only ones the public sees."""
        now = now or timezone.now()
        return cls.objects.filter(state=cls.APPROVED, starts_at__lte=now).filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now))

    def is_live(self, now=None):
        now = now or timezone.now()
        return self.state == self.APPROVED and self.starts_at <= now and (self.ends_at is None or self.ends_at > now)

    def phase(self, now=None):
        """live | scheduled | ended | not_live, for an approved banner; '' otherwise."""
        if self.state != self.APPROVED:
            return ""
        now = now or timezone.now()
        if self.ends_at is not None and self.ends_at <= now:
            return "ended"
        return "live" if self.starts_at <= now else "scheduled"


class FeaturedSlot(models.Model):
    """A kind of paid place, with its weekly price as configuration (seeded by a data
    migration with the canvas values; a Super Admin edit screen is future work).
    Home slots hold one business each; `category-top` holds `capacity` per category."""

    HOME = "home"
    CATEGORY_TOP = "category_top"
    KIND_CHOICES = [(HOME, "Home featured row"), (CATEGORY_TOP, "Category top")]

    key = models.SlugField(max_length=30, unique=True)
    kind = models.CharField(max_length=14, choices=KIND_CHOICES)
    label = models.CharField(max_length=60)
    weekly_price = models.DecimalField(max_digits=8, decimal_places=2)
    capacity = models.PositiveSmallIntegerField(default=1)
    position = models.PositiveSmallIntegerField(default=1)
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["kind", "position", "key"]

    def __str__(self):
        return self.label


class FeaturedBooking(models.Model):
    """One slot position for one week (Monday to Sunday, Ghana time) given to a featured
    promotion. A several-week booking is several rows, so every week can be released alone."""

    BOOKED = "booked"
    RELEASED = "released"
    STATUS_CHOICES = [(BOOKED, "Booked"), (RELEASED, "Released")]

    slot = models.ForeignKey(FeaturedSlot, on_delete=models.PROTECT, related_name="bookings")
    category = models.ForeignKey("listings.Category", on_delete=models.PROTECT, null=True, blank=True, related_name="+")
    position = models.PositiveSmallIntegerField(default=1)
    promotion = models.ForeignKey("listings.Promotion", on_delete=models.PROTECT, related_name="featured_bookings")
    week_start = models.DateField()
    # The slot's list price for the week when it was booked; informational only.
    price_snapshot = models.DecimalField(max_digits=8, decimal_places=2)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=BOOKED)
    booked_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, related_name="+")
    booked_at = models.DateTimeField(auto_now_add=True)
    released_by = models.ForeignKey("accounts.StaffUser", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    released_at = models.DateTimeField(null=True, blank=True)
    release_note = models.CharField(max_length=300, blank=True)

    class Meta:
        ordering = ["week_start", "slot_id", "position", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["slot", "position", "week_start"], name="mkt_featured_home_once",
                condition=Q(status="booked", category__isnull=True),
            ),
            models.UniqueConstraint(
                fields=["slot", "category", "position", "week_start"], name="mkt_featured_cat_once",
                condition=Q(status="booked", category__isnull=False),
            ),
        ]

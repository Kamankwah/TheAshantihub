import secrets

from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from accounts.models import BusinessOwner, Customer, StaffUser
from accounts.validators import validate_image_content_type
from listings.models import Category, Zone


def _generate_unique_access_code():
    """Short alphanumeric code, per docs/BUSINESS_EVENTS_ROADMAP.md Phase 6
    ("secrets.token_urlsafe truncated/formatted"). token_hex is used instead
    of token_urlsafe directly since token_urlsafe's alphabet includes '-'/'_'
    which aren't alphanumeric — token_hex(4) gives 8 lowercase hex characters,
    ~4.3 billion possibilities, plenty for a human-shareable, low-volume code.
    Always present on every Event regardless of access_level (kept on public
    events too so nothing breaks if an organizer switches to private later).
    """
    while True:
        code = secrets.token_hex(4)
        if not Event.objects.filter(access_code=code).exists():
            return code


class Event(models.Model):
    """A submitted event listing (docs/BUSINESS_EVENTS_ROADMAP.md Phase 6):
    submitted by a customer or business owner, approved by staff
    (`event.approve`), then paid for by the submitter to go live for a
    `visibility_days`-long window.

    **Sequencing decision (confirmed against the roadmap doc's Phase 6
    "Backend" bullet and Frontend paragraph): approval happens before
    payment.** Submission creates a `pending` Event with no charge. Staff
    approval flips `status` to `approved` but does NOT by itself make the
    event live/paid — `paid_at`/`expires_at` stay null until the organizer
    pays (`POST /api/events/{id}/pay/`), which is the step that actually
    starts the paid visibility window (`expires_at = paid_at +
    visibility_days`). Public endpoints only ever surface an event once it is
    both `approved` AND paid-and-unexpired — an approved-but-unpaid event is
    not yet "live". `EventApproveView` still defensively computes
    `expires_at` if `paid_at` is somehow already set (defence-in-depth only;
    nothing in this app's normal flow sets `paid_at` before `status` is
    `approved`).

    **Expiry decision (confirmed, per the roadmap doc's "Needs sketching"
    section): soft-hide, not hard-delete.** `expire_events` flips `status` to
    `expired` rather than deleting the row (or its `EventMedia`) — reversible,
    keeps a record for appeals/analytics, and matches how `Listing` and
    `HeroMediaSubmission` already handle lifecycle via a `status` field rather
    than deletion anywhere else in this codebase.
    """

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"
    STATUS_CHOICES = [
        (PENDING, "Pending"),
        (APPROVED, "Approved"),
        (REJECTED, "Rejected"),
        (EXPIRED, "Expired"),
    ]

    PUBLIC = "public"
    PRIVATE = "private"
    ACCESS_LEVEL_CHOICES = [
        (PUBLIC, "Public"),
        (PRIVATE, "Private"),
    ]

    category = models.ForeignKey(
        Category, on_delete=models.PROTECT, related_name="events"
    )
    # General-area field, distinct from `address` — this is what the public
    # teaser (docs/BUSINESS_EVENTS_ROADMAP.md Phase 6) shows for every event
    # regardless of access_level, since `address` is a restricted field on
    # private events. Not explicitly named in the roadmap's Event field list,
    # but required by its own "teaser shows zone/general-area, not exact
    # address/lat-lng" spec — reuses listings.Zone rather than inventing a
    # parallel free-text area field.
    zone = models.ForeignKey(Zone, on_delete=models.PROTECT, related_name="events")

    # Exactly one of these two must be set — enforced at the DB level via the
    # CheckConstraint below (mirrors billing.Transaction's
    # business_owner/customer constraint) and at the model level via clean().
    submitted_by_customer = models.ForeignKey(
        Customer, on_delete=models.CASCADE, related_name="submitted_events",
        null=True, blank=True,
    )
    submitted_by_business = models.ForeignKey(
        BusinessOwner, on_delete=models.CASCADE, related_name="submitted_events",
        null=True, blank=True,
    )

    name = models.CharField(max_length=150)
    description = models.TextField()
    address = models.CharField(max_length=255)
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    event_date = models.DateTimeField()
    visibility_days = models.PositiveIntegerField(
        validators=[MinValueValidator(7), MaxValueValidator(90)]
    )

    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    rejection_reason = models.CharField(max_length=500, null=True, blank=True)

    paid_at = models.DateTimeField(null=True, blank=True)
    # Computed as paid_at + visibility_days once the organizer pays for an
    # approved event (see class docstring for the approval-before-payment
    # sequencing this reflects).
    expires_at = models.DateTimeField(null=True, blank=True)
    approved_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="approved_events",
    )

    access_level = models.CharField(max_length=10, choices=ACCESS_LEVEL_CHOICES, default=PUBLIC)
    # Always generated on creation regardless of access_level (see
    # _generate_unique_access_code's docstring). blank=True only so
    # full_clean() can run before save() assigns it; never actually blank
    # once persisted.
    access_code = models.CharField(max_length=16, unique=True, blank=True, editable=False)

    # Denormalized RSVP count — populated by Phase 7's EventRSVP model. Not
    # kept in sync by anything in this app yet; just the column.
    going_count = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(submitted_by_customer__isnull=False, submitted_by_business__isnull=True)
                    | models.Q(submitted_by_customer__isnull=True, submitted_by_business__isnull=False)
                ),
                name="event_exactly_one_of_customer_or_business",
            ),
        ]

    def __str__(self):
        return f"{self.name} ({self.status})"

    def clean(self):
        super().clean()
        has_customer = self.submitted_by_customer_id is not None
        has_business = self.submitted_by_business_id is not None
        if has_customer == has_business:
            raise ValidationError(
                "Exactly one of submitted_by_customer or submitted_by_business must be set."
            )

    def save(self, *args, **kwargs):
        if not self.access_code:
            self.access_code = _generate_unique_access_code()
        super().save(*args, **kwargs)

    @property
    def is_live(self):
        """Whether this event is currently visible to the public — approved,
        paid, and not yet past its expiry window. See class docstring for why
        `approved` alone isn't enough (payment hasn't started the window).
        """
        from django.utils import timezone

        return (
            self.status == self.APPROVED
            and self.paid_at is not None
            and self.expires_at is not None
            and self.expires_at > timezone.now()
        )


class EventMedia(models.Model):
    """Media attached to an Event. No separate submission/approval queue —
    approval folds into the single Event-approval step (roadmap Phase 6).
    """

    IMAGE = "image"
    VIDEO = "video"
    MEDIA_TYPE_CHOICES = [
        (IMAGE, "Image"),
        (VIDEO, "Video"),
    ]

    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="media")
    # Reuses the same content-type validation as ListingPhoto/HeroMediaSubmission
    # (jpeg/png only, sniffed via python-magic) — same caveat as
    # HeroMediaSubmission.media: media_type=video is accepted at the
    # choices level but not yet content-validated as video.
    media = models.ImageField(
        upload_to="event_media/", validators=[validate_image_content_type]
    )
    media_type = models.CharField(max_length=10, choices=MEDIA_TYPE_CHOICES, default=IMAGE)
    order = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["order"]

    def __str__(self):
        return f"Media {self.order} for {self.event.name}"

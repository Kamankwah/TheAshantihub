import secrets

from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from accounts.models import BusinessOwner, Customer, StaffUser
from accounts.validators import validate_image_content_type
from billing.models import Transaction
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
    # Who last made a moderation decision (approve *or* reject) and when —
    # the canonical pair shared with Listing/HeroMediaSubmission/BusinessOwner,
    # driving the Approved/Rejected tabs' attribution line.
    #
    # Kept alongside `approved_by` rather than replacing it: approved_by means
    # "who approved this event", which survives a later rejection, whereas
    # reviewed_by tracks the most recent decision either way.
    reviewed_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reviewed_events",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    access_level = models.CharField(max_length=10, choices=ACCESS_LEVEL_CHOICES, default=PUBLIC)
    # Always generated on creation regardless of access_level (see
    # _generate_unique_access_code's docstring). blank=True only so
    # full_clean() can run before save() assigns it; never actually blank
    # once persisted.
    access_code = models.CharField(max_length=16, unique=True, blank=True, editable=False)

    # Denormalized RSVP count, kept in sync by EventRSVP create/status-change/
    # delete (see sync_going_count below) — Phase 7
    # (docs/BUSINESS_EVENTS_ROADMAP.md). Avoids a COUNT() per event on every
    # list/teaser read.
    going_count = models.PositiveIntegerField(default=0)

    # Optional organizer-set attendance cap (Phase 7). Nullable = unlimited.
    # RSVP creation is rejected once the `going` count hits this value — no
    # waitlist in this phase, per the roadmap doc's explicit recommendation.
    capacity = models.PositiveIntegerField(null=True, blank=True)

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

    def sync_going_count(self):
        """Recompute going_count from the current EventRSVP rows and persist
        it. Called by the RSVP create/cancel views inside the same
        db_transaction.atomic() block as the EventRSVP write (Phase 7 —
        docs/BUSINESS_EVENTS_ROADMAP.md), matching this app's existing
        convention of explicit `with db_transaction.atomic():` blocks in
        views (e.g. EventPayView) rather than signals.
        """
        self.going_count = self.rsvps.filter(status=EventRSVP.GOING).count()
        self.save(update_fields=["going_count"])


class EventPricingTier(models.Model):
    """One of a fixed set of visibility-window durations an organizer can
    choose when submitting an event, replacing the old flat
    EVENT_DAILY_RATE-per-day constant. `live_price` is the total charge for
    the whole window (not a per-day rate).

    The set of durations is fixed by product decision — only `live_price` is
    ever edited, via a two-step propose/approve workflow (accountant
    proposes, super_admin approves/rejects): `pending_price` non-null means a
    proposal is outstanding; approving copies it into `live_price` and clears
    the pending fields, rejecting just clears them. No prior pattern for this
    two-step workflow existed elsewhere in this codebase — this is the first.
    """

    DAYS_7 = 7
    DAYS_15 = 15
    DAYS_30 = 30
    DAYS_60 = 60
    DAYS_90 = 90
    DURATION_CHOICES = [
        (DAYS_7, "7 days"),
        (DAYS_15, "15 days"),
        (DAYS_30, "30 days"),
        (DAYS_60, "60 days"),
        (DAYS_90, "90 days"),
    ]

    duration_days = models.PositiveIntegerField(choices=DURATION_CHOICES, unique=True)
    live_price = models.DecimalField(max_digits=10, decimal_places=2)

    pending_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    proposed_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="event_pricing_proposals",
    )
    proposed_at = models.DateTimeField(null=True, blank=True)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["duration_days"]

    def __str__(self):
        return f"{self.duration_days} days — GHS {self.live_price}"


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


class EventRSVP(models.Model):
    """A marketplace end-user's attendance record for an Event (Phase 7 —
    docs/BUSINESS_EVENTS_ROADMAP.md). `customer` only (not BusinessOwner) —
    the roadmap doc scopes RSVP to "the marketplace end-user account", the
    same `Customer` referenced by `cart.Cart`; a business owner submitting/
    organizing an event is not itself an attendee concept in this app.

    One row per (event, customer) — toggling status updates it in place
    rather than creating duplicate rows, so RSVP history (going -> cancelled
    -> going again) is preserved on a single row rather than accumulating.
    """

    GOING = "going"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (GOING, "Going"),
        (CANCELLED, "Cancelled"),
    ]

    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="rsvps")
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="event_rsvps")
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=GOING)
    rsvp_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-rsvp_at"]
        unique_together = ("event", "customer")

    def __str__(self):
        return f"{self.customer.full_name} -> {self.event.name} ({self.status})"


class EventTicketType(models.Model):
    """A paid ticket tier an organizer defines for their Event (event
    ticketing + escrow work). Distinct from the free `EventRSVP` "going"
    concept above — an event can carry ticket types on top of (or instead
    of) plain RSVP; nothing here disables RSVP.

    `quantity_total=None` means unlimited; `quantity_sold` is a denormalized
    counter (matching Event.going_count's `sync_going_count()` pattern
    above, though here it's incremented directly inside
    `TicketPurchaseView`'s `select_for_update()`-locked block rather than
    recomputed from a COUNT(), since ticket purchases are additive and the
    lock already prevents oversell races).
    """

    DIGITAL = "digital"
    PHYSICAL = "physical"
    DELIVERY_METHOD_CHOICES = [
        (DIGITAL, "Digital"),
        (PHYSICAL, "Physical"),
    ]

    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="ticket_types")
    name = models.CharField(max_length=100)
    description = models.CharField(max_length=500, blank=True, default="")
    price = models.DecimalField(max_digits=10, decimal_places=2)
    delivery_method = models.CharField(
        max_length=10, choices=DELIVERY_METHOD_CHOICES, default=DIGITAL
    )
    # null = unlimited.
    quantity_total = models.PositiveIntegerField(null=True, blank=True)
    quantity_sold = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["event", "name"], name="unique_ticket_type_name_per_event"
            ),
        ]

    def __str__(self):
        return f"{self.name} — {self.event.name} (GHS {self.price})"


def _generate_unique_ticket_code():
    """Per-ticket redemption code, mirroring _generate_unique_access_code
    above exactly (same rationale: token_hex avoids token_urlsafe's
    non-alphanumeric alphabet). token_hex(6) (12 hex characters) rather than
    token_hex(4) since tickets are a much higher-volume row than Events.
    """
    while True:
        code = secrets.token_hex(6)
        if not Ticket.objects.filter(code=code).exists():
            return code


class Ticket(models.Model):
    """A single purchased ticket (event ticketing + escrow work). Payment for
    a ticket is held in escrow (`escrow_status=held`) until the ticket is
    delivered/checked in (`EventCheckinView`), at which point it is
    auto-released — or a staff `accountant` (holding `escrow.release`/
    `escrow.hold`/`escrow.refund`) can manually override that lifecycle as
    an exception path (fraud, dispute, no-show, etc.).

    `delivery_method`/`price` are snapshotted from the `EventTicketType` at
    purchase time rather than FK'd live — mirrors how `cart`/`orders`
    already snapshot listing price at time of purchase elsewhere in this
    codebase, so a later edit to the ticket type's price/delivery method
    never retroactively changes an already-sold ticket.

    Business rules enforced in views, not here (matching this app's
    "business rules live in views, not model methods" convention elsewhere
    in this file): a ticket can only be refunded while
    `escrow_status=held` and undelivered; once `refunded_at` is set, a
    ticket can never subsequently be released or checked in.
    """

    HELD = "held"
    RELEASED = "released"
    ESCROW_STATUS_CHOICES = [
        (HELD, "Held"),
        (RELEASED, "Released"),
    ]

    ticket_type = models.ForeignKey(
        EventTicketType, on_delete=models.PROTECT, related_name="tickets"
    )
    purchased_by = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="tickets")
    transaction = models.ForeignKey(Transaction, on_delete=models.PROTECT, related_name="tickets")
    # Generated in save() via _generate_unique_ticket_code(), exactly
    # mirroring Event.access_code/_generate_unique_access_code above.
    code = models.CharField(max_length=24, unique=True, editable=False, blank=True)
    delivery_method = models.CharField(max_length=10, choices=EventTicketType.DELIVERY_METHOD_CHOICES)
    price = models.DecimalField(max_digits=10, decimal_places=2)

    delivered_at = models.DateTimeField(null=True, blank=True)
    delivered_by_staff = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="ticket_checkins",
    )

    escrow_status = models.CharField(max_length=10, choices=ESCROW_STATUS_CHOICES, default=HELD)
    escrow_held_at = models.DateTimeField(auto_now_add=True)
    escrow_released_at = models.DateTimeField(null=True, blank=True)
    # Null when the release happened automatically via check-in rather than
    # a staff override (see EventCheckinView) — a non-null value here means
    # an accountant manually intervened.
    escrow_released_by_staff = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="escrow_overrides",
    )
    escrow_override_note = models.CharField(max_length=500, blank=True, default="")

    refunded_at = models.DateTimeField(null=True, blank=True)
    refunded_by_staff = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="ticket_refunds",
    )
    refund_reason = models.CharField(max_length=500, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.code} ({self.escrow_status})"

    def save(self, *args, **kwargs):
        if not self.code:
            self.code = _generate_unique_ticket_code()
        super().save(*args, **kwargs)

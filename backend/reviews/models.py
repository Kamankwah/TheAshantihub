from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from accounts.models import BusinessOwner, Customer, StaffUser
from events.models import Event
from listings.models import Listing


class Review(models.Model):
    """A star rating + optional comment left by a verified customer against
    one of four possible targets, disambiguated by `target_type`
    (docs/PROJECT_SCOPE.md reviews/ratings/Q&A plan, Phase 1). One unified
    model rather than four separate ones — generalizes `Event`'s existing
    exactly-one-of-two-FK precedent (`event_exactly_one_of_customer_or_business`,
    see backend/events/models.py) to exactly-one-of-four targets.

    `business_owner` is deliberately reused for BOTH `target_type="seller"`
    (a business's trustworthiness as a seller of its listings) AND
    `target_type="organizer"` (the same business's trustworthiness as an
    event host) — these are independent reputation pools disambiguated by
    `target_type`, not two different things needing two different FK columns.
    `organizer_customer` is the alternate organizer target for the case where
    a `Customer` (not a `BusinessOwner`) submitted/organized the event being
    reviewed (mirrors `Event.submitted_by_customer`'s existence).

    **Moderation: pre-moderated, then reactively moderated.** A review is
    gated twice. First at creation, by a real verified purchase/attendance
    record (the strongest anti-spam signal this app has) — see
    `ReviewCreateView`. Second by staff: a new review lands in `pending` and
    is invisible to the public until someone holding `reviews.moderate`
    approves it.

    This second gate was added deliberately (staff moderation-queue
    restructuring, punch-list item 5) and reverses this model's original
    "publish immediately" design — the queue is now the same
    Pending/Approved/Rejected shape every other moderated surface uses.
    The trade-off is real and worth stating: a review no longer appears the
    moment it is written, so an unworked queue means reviews silently stop
    showing up.

    The three states map onto the fields that were already here rather than
    a fourth status: `pending` is new, `published` is the approved state, and
    `hidden` doubles as the rejected state (carrying `hidden_reason` and
    `hidden_by`, which is why those names stayed). `reviewed_by`/`reviewed_at`
    record the approval, matching the canonical pair on
    `Listing`/`HeroMediaSubmission`/`BusinessOwner`.

    Nothing downstream needed changing to keep `pending` private: the public
    list view and the `avg_rating`/`review_count` annotations already filter
    on `status="published"`, so a pending review is invisible and does not
    move any rating average.

    Sending a rejected review back to `pending` is restricted to
    `reviews.re_review` (super_admin only) — a tighter gate than the
    `reviews.moderate` needed to approve or reject in the first place.
    """

    LISTING = "listing"
    EVENT = "event"
    SELLER = "seller"
    ORGANIZER = "organizer"
    TARGET_TYPE_CHOICES = [
        (LISTING, "Listing"),
        (EVENT, "Event"),
        (SELLER, "Seller"),
        (ORGANIZER, "Organizer"),
    ]

    # `hidden` is also the rejected state — see the class docstring. Kept
    # under its original name so existing rows, `hidden_reason`/`hidden_by`,
    # and the hide/unhide endpoints all keep meaning the same thing.
    PENDING = "pending"
    PUBLISHED = "published"
    HIDDEN = "hidden"
    STATUS_CHOICES = [
        (PENDING, "Pending"),
        (PUBLISHED, "Published"),
        (HIDDEN, "Hidden"),
    ]

    target_type = models.CharField(max_length=10, choices=TARGET_TYPE_CHOICES)

    # Exactly one of these four must be set, consistent with target_type —
    # enforced at the DB level via the CheckConstraint below and at the
    # model level via clean(). See class docstring for why business_owner is
    # shared between target_type="seller" and target_type="organizer".
    listing = models.ForeignKey(
        Listing, on_delete=models.CASCADE, null=True, blank=True, related_name="reviews"
    )
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, null=True, blank=True, related_name="reviews"
    )
    business_owner = models.ForeignKey(
        BusinessOwner, on_delete=models.CASCADE, null=True, blank=True,
        related_name="reviews_received",
    )
    organizer_customer = models.ForeignKey(
        Customer, on_delete=models.CASCADE, null=True, blank=True,
        related_name="organizer_reviews_received",
    )

    author = models.ForeignKey(
        Customer, on_delete=models.CASCADE, related_name="reviews_written"
    )

    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    # Optional at the model level (rating-only reviews allowed) — the
    # frontend's minimum-length nudge is a soft UX rule only, not a hard
    # backend constraint.
    comment = models.TextField(blank=True)

    # Computed and enforced server-side at creation (Phase 2) — never
    # trusted from the request body. Persisted rather than derived at read
    # time so it can drive a "Verified Purchase/Attendee" badge on render.
    verified = models.BooleanField(default=False)

    # Defaults to PENDING so a newly written review waits for staff approval.
    # Changing the default does not touch existing rows, so every review that
    # was already published stays published.
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=PENDING)
    hidden_reason = models.TextField(null=True, blank=True)
    hidden_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="hidden_reviews",
    )

    # Who approved this review, and when — the canonical pair used by every
    # other moderated queue. Distinct from hidden_by/hidden_reason above,
    # which record the reject/hide side.
    reviewed_by = models.ForeignKey(
        StaffUser, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="reviewed_reviews",
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            # Exactly one of listing/event/business_owner/organizer_customer
            # must be non-null, AND it must be the field(s) consistent with
            # target_type. target_type="organizer" is the only branch with
            # two valid shapes (business_owner OR organizer_customer, never
            # both) since a customer-organized event's organizer has no
            # BusinessOwner row to point at.
            models.CheckConstraint(
                check=(
                    models.Q(
                        target_type="listing",
                        listing__isnull=False, event__isnull=True,
                        business_owner__isnull=True, organizer_customer__isnull=True,
                    )
                    | models.Q(
                        target_type="event",
                        listing__isnull=True, event__isnull=False,
                        business_owner__isnull=True, organizer_customer__isnull=True,
                    )
                    | models.Q(
                        target_type="seller",
                        listing__isnull=True, event__isnull=True,
                        business_owner__isnull=False, organizer_customer__isnull=True,
                    )
                    | models.Q(
                        target_type="organizer",
                        listing__isnull=True, event__isnull=True,
                        business_owner__isnull=False, organizer_customer__isnull=True,
                    )
                    | models.Q(
                        target_type="organizer",
                        listing__isnull=True, event__isnull=True,
                        business_owner__isnull=True, organizer_customer__isnull=False,
                    )
                ),
                name="review_exactly_one_target_matching_type",
            ),
            # One review per author per listing.
            models.UniqueConstraint(
                fields=["author", "listing"],
                condition=models.Q(listing__isnull=False),
                name="unique_review_per_author_listing",
            ),
            # One review per author per event.
            models.UniqueConstraint(
                fields=["author", "event"],
                condition=models.Q(event__isnull=False),
                name="unique_review_per_author_event",
            ),
            # One review per author per (business_owner, target_type) — the
            # same business_owner can validly get BOTH a seller review AND
            # an organizer review from the same author (different
            # reputation pools), so target_type must be part of this key.
            models.UniqueConstraint(
                fields=["author", "business_owner", "target_type"],
                condition=models.Q(business_owner__isnull=False),
                name="unique_review_per_author_business_owner_target_type",
            ),
            # One review per author per organizer_customer.
            models.UniqueConstraint(
                fields=["author", "organizer_customer"],
                condition=models.Q(organizer_customer__isnull=False),
                name="unique_review_per_author_organizer_customer",
            ),
        ]

    def __str__(self):
        return f"{self.get_target_type_display()} review by {self.author.full_name} ({self.rating}★)"

    def clean(self):
        super().clean()
        has_listing = self.listing_id is not None
        has_event = self.event_id is not None
        has_business_owner = self.business_owner_id is not None
        has_organizer_customer = self.organizer_customer_id is not None

        set_count = sum([has_listing, has_event, has_business_owner, has_organizer_customer])
        if set_count != 1:
            raise ValidationError(
                "Exactly one of listing, event, business_owner, or "
                "organizer_customer must be set."
            )

        if self.target_type == self.LISTING and not has_listing:
            raise ValidationError("target_type='listing' requires the listing field to be set.")
        if self.target_type == self.EVENT and not has_event:
            raise ValidationError("target_type='event' requires the event field to be set.")
        if self.target_type == self.SELLER and not has_business_owner:
            raise ValidationError(
                "target_type='seller' requires the business_owner field to be set."
            )
        if self.target_type == self.ORGANIZER and not (has_business_owner or has_organizer_customer):
            raise ValidationError(
                "target_type='organizer' requires business_owner or "
                "organizer_customer to be set."
            )

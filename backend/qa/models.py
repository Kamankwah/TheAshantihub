from django.core.exceptions import ValidationError
from django.db import models

from accounts.models import Customer
from events.models import Event
from listings.models import Listing


class Question(models.Model):
    """A customer's question about a listing or event, answered directly by
    the target's existing owner (docs/PROJECT_SCOPE.md reviews/ratings/Q&A
    plan, Phase 1). No separate `Answer` model — `answered_by` is always
    exactly the target's existing owner (`listing.business_owner` /
    `event.submitted_by_business`/`submitted_by_customer`), so storing it
    again on this model would be redundant. Phase 2's answer endpoint
    performs an ownership check against that derived owner rather than
    against a stored FK.
    """

    LISTING = "listing"
    EVENT = "event"
    TARGET_TYPE_CHOICES = [
        (LISTING, "Listing"),
        (EVENT, "Event"),
    ]

    target_type = models.CharField(max_length=10, choices=TARGET_TYPE_CHOICES)

    # Exactly one of these two must be set — same pattern as
    # Event.submitted_by_customer/submitted_by_business
    # (backend/events/models.py), enforced via the CheckConstraint below and
    # clean().
    listing = models.ForeignKey(
        Listing, on_delete=models.CASCADE, null=True, blank=True, related_name="questions"
    )
    event = models.ForeignKey(
        Event, on_delete=models.CASCADE, null=True, blank=True, related_name="questions"
    )

    asked_by = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="questions_asked")
    question_text = models.TextField()

    answer_text = models.TextField(null=True, blank=True)
    answered_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.CheckConstraint(
                check=(
                    models.Q(listing__isnull=False, event__isnull=True)
                    | models.Q(listing__isnull=True, event__isnull=False)
                ),
                name="question_exactly_one_of_listing_or_event",
            ),
        ]

    def __str__(self):
        return f"Question by {self.asked_by.full_name} ({self.target_type})"

    def clean(self):
        super().clean()
        has_listing = self.listing_id is not None
        has_event = self.event_id is not None
        if has_listing == has_event:
            raise ValidationError(
                "Exactly one of listing or event must be set."
            )

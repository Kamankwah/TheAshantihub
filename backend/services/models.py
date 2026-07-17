from django.db import models

from accounts.models import BusinessOwner, Customer
from listings.models import Listing


class ServiceRequest(models.Model):
    """A customer's enquiry for a service listing, Fiverr/Upwork-style
    (business item 2 / Wave H2). Deliberately a *separate* lifecycle from an
    order: the customer requests first, the owner accepts (quoting a price),
    the customer then pays, the owner does the work and marks it complete.

    Lifecycle:
      requested → accepted → in_progress → completed
                → declined (owner says no)
      (either side) → cancelled

    `agreed_price` is set by the owner on accept and is what the customer pays;
    `budget` is the customer's optional opening figure. Payment moves the
    request `accepted → in_progress` (see services.views + the SERVICE_REQUEST
    payment kind).
    """

    REQUESTED = "requested"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (REQUESTED, "Requested"),
        (ACCEPTED, "Accepted — awaiting payment"),
        (DECLINED, "Declined"),
        (IN_PROGRESS, "In progress"),
        (COMPLETED, "Completed"),
        (CANCELLED, "Cancelled"),
    ]
    # Terminal states — no further transitions.
    FINAL_STATUSES = (DECLINED, COMPLETED, CANCELLED)

    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="service_requests")
    listing = models.ForeignKey(Listing, on_delete=models.PROTECT, related_name="service_requests")
    # Denormalised from listing.business_owner so the owner's incoming queue is
    # a plain filter and survives even if the listing is later reassigned.
    business_owner = models.ForeignKey(
        BusinessOwner, on_delete=models.CASCADE, related_name="incoming_service_requests"
    )

    message = models.TextField()
    budget = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    agreed_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    decline_reason = models.CharField(max_length=500, blank=True)
    progress_note = models.TextField(blank=True)

    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=REQUESTED)

    responded_at = models.DateTimeField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"ServiceRequest {self.id} — {self.listing_id} ({self.status})"

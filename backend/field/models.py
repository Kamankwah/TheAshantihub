"""Scout field work (spec S5): visit check-ins. WP2 adds prospects here."""
from django.db import models
from django.db.models import Q

from accounts.validators import validate_image_content_type

RADIUS_M = 100  # a check-in further than this from the business pin is flagged


class VisitCheckIn(models.Model):
    """A scout's visit. Location is read only at check-in, check-out and when
    a photo is taken, never in between. A visit counts once it is `done`."""

    PROSPECTING = "prospecting"
    REGISTRATION = "registration"
    ONBOARDING_PHOTOS = "onboarding_photos"
    SUBSCRIPTION_FOLLOW_UP = "subscription_follow_up"
    DELIVERY_FOLLOW_UP = "delivery_follow_up"
    INFO_UPDATE = "info_update"
    VERIFICATION = "verification"
    PURPOSE_CHOICES = [
        (PROSPECTING, "Prospecting"),
        (REGISTRATION, "Registration"),
        (ONBOARDING_PHOTOS, "Onboarding & photos"),
        (SUBSCRIPTION_FOLLOW_UP, "Subscription follow-up"),
        (DELIVERY_FOLLOW_UP, "Delivery follow-up"),
        (INFO_UPDATE, "Info update"),
        (VERIFICATION, "Verification"),
    ]

    OPEN = "open"
    DONE = "done"
    ABANDONED = "abandoned"
    STATUS_CHOICES = [(OPEN, "Open"), (DONE, "Done"), (ABANDONED, "Abandoned")]

    scout = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="visits")
    business_owner = models.ForeignKey(
        "accounts.BusinessOwner", on_delete=models.SET_NULL, null=True, blank=True, related_name="visits",
    )
    scout_assignment = models.ForeignKey(
        "accounts.ScoutAssignment", on_delete=models.SET_NULL, null=True, blank=True, related_name="visits",
    )
    purpose = models.CharField(max_length=30, choices=PURPOSE_CHOICES)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=OPEN)
    checked_in_at = models.DateTimeField()
    lat = models.DecimalField(max_digits=9, decimal_places=6)
    lng = models.DecimalField(max_digits=9, decimal_places=6)
    accuracy_m = models.PositiveIntegerField()
    # None when the business has no map pin: the distance can't be measured.
    distance_m = models.PositiveIntegerField(null=True, blank=True)
    outside_radius = models.BooleanField(default=False)
    checked_out_at = models.DateTimeField(null=True, blank=True)
    out_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    out_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    out_accuracy_m = models.PositiveIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-checked_in_at", "-id"]
        indexes = [models.Index(fields=["scout", "-checked_in_at"]), models.Index(fields=["business_owner", "-checked_in_at"])]
        constraints = [
            models.UniqueConstraint(
                fields=["scout"], condition=Q(status="open"), name="one_open_visit_per_scout",
            ),
        ]

    def __str__(self):
        return f"Visit {self.pk} by {self.scout_id}"

    @property
    def minutes(self):
        if self.checked_out_at is None:
            return None
        return max(0, round((self.checked_out_at - self.checked_in_at).total_seconds() / 60))


class VisitPhoto(models.Model):
    """A photo taken during a visit, stamped with server time and the device
    location at capture."""

    visit = models.ForeignKey(VisitCheckIn, on_delete=models.CASCADE, related_name="photos")
    image = models.ImageField(upload_to="visit_photos/", validators=[validate_image_content_type])
    taken_at = models.DateTimeField(auto_now_add=True)
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    accuracy_m = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["taken_at", "id"]

from django.db import models


class SiteSettings(models.Model):
    """Singleton row holding editable footer contact info and social links.

    Always resolves to pk=1 regardless of how many times `.save()` or
    `.load()` is called — there is exactly one row, ever. Use `SiteSettings.load()`
    to get the row (self-healing: creates it if missing) rather than assuming
    one already exists.
    """

    contact_email = models.EmailField(blank=True)
    contact_phone = models.CharField(max_length=30, blank=True)
    contact_address = models.CharField(max_length=255, blank=True)
    facebook_url = models.URLField(blank=True)
    instagram_url = models.URLField(blank=True)
    linkedin_url = models.URLField(blank=True)
    twitter_url = models.URLField(blank=True)
    tiktok_url = models.URLField(blank=True)
    youtube_url = models.URLField(blank=True)
    # Digits-only, no leading "+" (e.g. "233244000000") — matches the
    # wa.me/{phone} convention the frontend's WABtn component already uses,
    # unlike contact_phone above which is human-formatted for display.
    whatsapp_number = models.CharField(max_length=30, blank=True)
    support_hours = models.CharField(max_length=100, blank=True)  # e.g. "Mon–Sat, 8:00am – 8:00pm GMT"

    # Static, platform-wide policy text for the reviews/ratings/Q&A plan's
    # product/service-detail "Warranty & Returns" / "Service satisfaction &
    # dispute" tabs (docs/PROJECT_SCOPE.md) — no per-listing fulfillment/
    # dispute system exists to source per-item promises from, so this is one
    # editable policy blurb per concept, same as every other SiteSettings
    # field.
    warranty_returns_policy = models.TextField(blank=True)
    service_dispute_policy = models.TextField(blank=True)

    # Where a store-pickup customer collects their order. Set only by a Super Admin
    # (PickupAddressView); blank until then, and never invented.
    pickup_office_address = models.CharField(max_length=300, blank=True)

    def save(self, *args, **kwargs):
        self.pk = 1
        # Force an upsert regardless of how save() was invoked (e.g.
        # `SiteSettings.objects.create()` passes force_insert=True, which
        # would otherwise raise IntegrityError on a second call since pk=1
        # already exists) so every save path always converges on one row.
        kwargs["force_insert"] = False
        kwargs["force_update"] = False
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "Site Settings"


class JobRun(models.Model):
    """The last run of each scheduled background job (one row per task), written
    by the Celery signal handlers in core.jobs. System health reads it, so a job
    that has never run shows "has not run yet" rather than an invented time."""

    STARTED, OK, FAILED = "started", "ok", "failed"
    STATUS_CHOICES = [(STARTED, "Running"), (OK, "Done"), (FAILED, "Failed")]

    task = models.CharField(max_length=200, unique=True)
    last_started_at = models.DateTimeField(null=True, blank=True)
    last_finished_at = models.DateTimeField(null=True, blank=True)
    last_status = models.CharField(max_length=10, choices=STATUS_CHOICES, default=STARTED)
    last_duration_ms = models.PositiveIntegerField(null=True, blank=True)
    last_error = models.CharField(max_length=300, blank=True, default="")

    def __str__(self):
        return f"{self.task}: {self.last_status}"

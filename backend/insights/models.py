from django.db import models
from django.utils import timezone


class ScheduledExport(models.Model):
    """A recurring export sent to named staff as a signed link (never an
    attachment). Each run is logged; a schedule that includes personal data was
    saved only after the Super Admin re-entered their password."""

    DAILY, WEEKLY, MONTHLY = "daily", "weekly", "monthly"
    FREQUENCY_CHOICES = [(DAILY, "Every day"), (WEEKLY, "Every week"), (MONTHLY, "Every month")]

    name = models.CharField(max_length=120)
    kind = models.CharField(max_length=30)
    filters = models.JSONField(default=dict, blank=True)
    format = models.CharField(max_length=4)
    frequency = models.CharField(max_length=8, choices=FREQUENCY_CHOICES)
    weekday = models.PositiveSmallIntegerField(null=True, blank=True)  # 0 = Monday
    day_of_month = models.PositiveSmallIntegerField(null=True, blank=True)  # 1-28
    run_time = models.TimeField()
    recipients = models.ManyToManyField("accounts.StaffUser", related_name="scheduled_exports_received")
    personal_data = models.BooleanField(default=False)
    paused_at = models.DateTimeField(null=True, blank=True)
    paused_by = models.ForeignKey("accounts.StaffUser", null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_by = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="scheduled_exports_created")
    password_confirmed_at = models.DateTimeField(null=True, blank=True)
    next_run_at = models.DateTimeField(null=True, blank=True, db_index=True)
    last_run_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self):
        return self.name


class ScheduledExportRun(models.Model):
    OK, PARTIAL, FAILED = "ok", "partial", "failed"
    STATUS_CHOICES = [(OK, "Finished"), (PARTIAL, "Finished with problems"), (FAILED, "Failed")]

    schedule = models.ForeignKey(ScheduledExport, on_delete=models.CASCADE, related_name="runs")
    started_at = models.DateTimeField(default=timezone.now)
    finished_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=8, choices=STATUS_CHOICES, default=OK)
    rows = models.PositiveIntegerField(default=0)
    error = models.CharField(max_length=300, blank=True, default="")

    class Meta:
        ordering = ["-started_at", "-id"]


class ScheduledExportFile(models.Model):
    """One run's file for one recipient. Served only to that person, signed in,
    through a signed link valid for 24 hours."""

    run = models.ForeignKey(ScheduledExportRun, on_delete=models.CASCADE, related_name="files")
    recipient = models.ForeignKey("accounts.StaffUser", on_delete=models.CASCADE, related_name="scheduled_export_files")
    file_name = models.CharField(max_length=120, blank=True, default="")
    download_name = models.CharField(max_length=160, blank=True, default="")
    row_count = models.PositiveIntegerField(default=0)
    error = models.CharField(max_length=300, blank=True, default="")
    expires_at = models.DateTimeField(null=True, blank=True)
    first_opened_at = models.DateTimeField(null=True, blank=True)
    purged = models.BooleanField(default=False)

    class Meta:
        ordering = ["id"]

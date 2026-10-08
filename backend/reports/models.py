from django.db import models


class StaffReport(models.Model):
    """A staffer's day, week or month report (staff foundations F6). The
    system section is computed live while the report is a draft and frozen
    into system_snapshot on submit; the narrative is the person's own."""

    DAY = "day"
    WEEK = "week"
    MONTH = "month"
    PERIOD_CHOICES = [(DAY, "Day"), (WEEK, "Week"), (MONTH, "Month")]
    DRAFT = "draft"
    SUBMITTED = "submitted"
    ACKNOWLEDGED = "acknowledged"
    RETURNED = "returned"
    STATUS_CHOICES = [
        (DRAFT, "Draft"),
        (SUBMITTED, "Submitted"),
        (ACKNOWLEDGED, "Acknowledged"),
        (RETURNED, "Returned"),
    ]

    staff = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="reports")
    period = models.CharField(max_length=5, choices=PERIOD_CHOICES)
    period_start = models.DateField()
    period_end = models.DateField()
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=DRAFT)
    submitted_at = models.DateTimeField(null=True, blank=True)
    is_late = models.BooleanField(default=False)
    system_snapshot = models.JSONField(null=True, blank=True)
    achievements = models.TextField(blank=True, default="")
    blockers = models.TextField(blank=True, default="")
    plan_next = models.JSONField(default=list, blank=True)
    plan_results = models.JSONField(default=list, blank=True)
    linked_targets = models.JSONField(default=list, blank=True)
    reviewer = models.ForeignKey(
        "accounts.StaffUser", on_delete=models.PROTECT, null=True, blank=True, related_name="reports_reviewed"
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_note = models.TextField(blank=True, default="")
    similarity = models.FloatField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-period_start", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["staff", "period", "period_start"], name="unique_staff_report_period")
        ]
        indexes = [models.Index(fields=["staff", "status"]), models.Index(fields=["period", "period_start"])]

    def narrative_text(self):
        parts = [self.achievements, self.blockers, *[str(item) for item in self.plan_next]]
        return "\n".join(part.strip() for part in parts if part and part.strip())

    def __str__(self):
        return f"{self.staff.full_name} · {self.get_period_display()} report · {self.period_start}"


class ReportExport(models.Model):
    """A background report export (staff foundations F6): built by a Celery
    job into PRIVATE_MEDIA_ROOT and downloadable by its requester through a
    signed link for 24 hours. A failed job leaves no file behind."""

    QUEUED = "queued"
    RUNNING = "running"
    READY = "ready"
    FAILED = "failed"
    EXPIRED = "expired"
    STATUS_CHOICES = [
        (QUEUED, "Queued"),
        (RUNNING, "Being prepared"),
        (READY, "Ready"),
        (FAILED, "Failed"),
        (EXPIRED, "Expired"),
    ]

    requester = models.ForeignKey("accounts.StaffUser", on_delete=models.CASCADE, related_name="report_exports")
    filters = models.JSONField(default=dict)
    format = models.CharField(max_length=4)
    status = models.CharField(max_length=8, choices=STATUS_CHOICES, default=QUEUED)
    file_name = models.CharField(max_length=120, blank=True, default="")
    row_count = models.PositiveIntegerField(default=0)
    error = models.CharField(max_length=300, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"Report export #{self.pk} ({self.format}, {self.status})"

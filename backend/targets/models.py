"""Targets, working days, holidays and leave (spec S6)."""
from django.db import models

REGISTRATIONS = "registrations"
VISITS = "visits"
CALLS = "calls"
RENEWALS = "renewals"
METRICS = (REGISTRATIONS, VISITS, CALLS, RENEWALS)
METRIC_CHOICES = [(REGISTRATIONS, "Registrations"), (VISITS, "Visits"), (CALLS, "Calls"), (RENEWALS, "Renewals")]
DEFAULT_WEEKDAYS = [0, 1, 2, 3, 4, 5]  # Monday to Saturday (0 = Monday)


class TargetPlan(models.Model):
    """A scout's daily target for one measure, from `effective_from` on. The
    plan in force on a date is the latest row on or before it; rows are never
    edited, so what was in force on any past day can always be read back."""

    staff = models.ForeignKey("accounts.StaffUser", on_delete=models.CASCADE, related_name="target_plans")
    metric = models.CharField(max_length=20, choices=METRIC_CHOICES)
    daily_value = models.PositiveIntegerField()
    effective_from = models.DateField()
    set_by = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-effective_from", "-id"]
        indexes = [models.Index(fields=["staff", "metric", "-effective_from"])]

    def __str__(self):
        return f"{self.metric} {self.daily_value}/day for {self.staff_id} from {self.effective_from}"


class TargetLimit(models.Model):
    """The lowest and highest daily target Operations may set for a measure."""

    metric = models.CharField(max_length=20, choices=METRIC_CHOICES, unique=True)
    min_daily = models.PositiveIntegerField()
    max_daily = models.PositiveIntegerField()
    set_by = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.metric}: {self.min_daily}-{self.max_daily} a day"


class WorkPattern(models.Model):
    """The weekdays a scout works (0 = Monday). Without a row: Monday to Saturday."""

    staff = models.OneToOneField("accounts.StaffUser", on_delete=models.CASCADE, related_name="work_pattern")
    weekdays = models.JSONField(default=list)
    set_by = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="+")
    updated_at = models.DateTimeField(auto_now=True)


class PublicHoliday(models.Model):
    """A public holiday on its observed date (maintained by Super Admin)."""

    date = models.DateField(unique=True)
    name = models.CharField(max_length=120)

    class Meta:
        ordering = ["date"]

    def __str__(self):
        return f"{self.name} ({self.date})"


class Leave(models.Model):
    ANNUAL = "annual"
    SICK = "sick"
    OTHER = "other"
    KIND_CHOICES = [(ANNUAL, "Annual leave"), (SICK, "Sick leave"), (OTHER, "Other")]

    staff = models.ForeignKey("accounts.StaffUser", on_delete=models.CASCADE, related_name="leaves")
    start = models.DateField()
    end = models.DateField()
    kind = models.CharField(max_length=10, choices=KIND_CHOICES, default=ANNUAL)
    note = models.CharField(max_length=300, blank=True, default="")
    recorded_by = models.ForeignKey("accounts.StaffUser", on_delete=models.PROTECT, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-start", "-id"]
        indexes = [models.Index(fields=["staff", "start", "end"])]
        constraints = [models.CheckConstraint(condition=models.Q(end__gte=models.F("start")), name="leave_end_not_before_start")]

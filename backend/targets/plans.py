"""Setting targets: validation against the limits, the mid-month cut rule and
the writes. Used by the API, the approval kind and the staging command."""
from datetime import date

from django.db import transaction
from django.utils import timezone

from accounts.models import Role

from .models import METRICS, TargetLimit, TargetPlan
from .services import Calendar, month_total_with

HARD_CAP = 1000  # a typing slip guard where Super Admin has set no limit for a measure


class PlanError(Exception):
    status_code = 400

    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.message = message
        if status_code:
            self.status_code = status_code


def in_scope(user, staff):
    """Operations act on their own team; a Super Admin on anyone."""
    return user.role.name == Role.SUPER_ADMIN or staff.manager_id == user.pk


def clean_values(values):
    """{metric: int} with unknown measures and non-integers refused."""
    if not isinstance(values, dict) or not values:
        raise PlanError("Give at least one daily target.")
    cleaned = {}
    for metric, value in values.items():
        if metric not in METRICS:
            raise PlanError(f"{metric} is not a measure.")
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise PlanError(f"The {metric} target must be a whole number, 0 or more.")
        cleaned[metric] = value
    return cleaned


def check_limits(values):
    limits = {limit.metric: limit for limit in TargetLimit.objects.filter(metric__in=values)}
    for metric, value in values.items():
        limit = limits.get(metric)
        low, high = (limit.min_daily, limit.max_daily) if limit else (0, HARD_CAP)
        if not low <= value <= high:
            raise PlanError(f"The {metric} target must be between {low} and {high} a day.")


def current_values(staff, metrics=METRICS, day=None):
    day = day or timezone.localdate()
    calendar = Calendar(staff, day, day)
    return {m: (calendar.plan_on(m, day).daily_value if calendar.plan_on(m, day) else None) for m in metrics}


def split_cuts(staff, values, effective_from, today=None):
    """(apply_now, needs_approval): a change that lowers the scout's total for
    the current month, after the 1st, is a cut and goes to Super Admin."""
    today = today or timezone.localdate()
    now, cuts = {}, {}
    for metric, value in values.items():
        before, after = month_total_with(staff, metric, value, effective_from, today)
        (cuts if today.day > 1 and after < before else now)[metric] = value
    return now, cuts


def write_plans(staff, values, effective_from, set_by):
    with transaction.atomic():
        return [TargetPlan.objects.create(staff=staff, metric=m, daily_value=v, effective_from=effective_from, set_by=set_by)
                for m, v in sorted(values.items())]


def parse_effective_from(value, today=None):
    today = today or timezone.localdate()
    if not value:
        return today
    try:
        day = date.fromisoformat(str(value))
    except ValueError:
        raise PlanError("Use YYYY-MM-DD for the start date.") from None
    if day < today:
        raise PlanError("A target can't start in the past. Pick today or a later day.")
    return day

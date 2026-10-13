"""The send policy as the rest of marketing reads it, and the check a proposal must pass."""
from datetime import datetime, time

from django.utils import timezone

from approvals.models import ApprovalSettings

from .models import SendPolicy

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
# A proposal outside this range is refused outright: nobody gets marketing at night.
EARLIEST, LATEST = time(6, 0), time(21, 0)
MAX_CAP_DAYS = 30


class PolicyError(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


def parse_time(value, label):
    if isinstance(value, time):
        return value
    try:
        return datetime.strptime(str(value), "%H:%M").time()
    except ValueError:
        raise PolicyError(f"{label} must be a time like 08:00.")


def clean_proposal(data):
    """Validated, normalised proposal fields (all four required): raises PolicyError."""
    start = parse_time(data.get("window_start"), "The window start")
    end = parse_time(data.get("window_end"), "The window end")
    if not start < end:
        raise PolicyError("The window must end after it starts.")
    if start < EARLIEST or end > LATEST:
        raise PolicyError(f"Marketing may only go out between {EARLIEST:%H:%M} and {LATEST:%H:%M}.")
    days = data.get("send_days")
    if not isinstance(days, list) or not days or any(isinstance(d, bool) or not isinstance(d, int) or not 0 <= d <= 6 for d in days):
        raise PolicyError("Choose at least one send day.")
    cap = data.get("per_person_cap_days")
    if isinstance(cap, bool) or not isinstance(cap, int) or not 1 <= cap <= MAX_CAP_DAYS:
        raise PolicyError(f"One message per person every 1 to {MAX_CAP_DAYS} days.")
    holidays = data.get("quiet_public_holidays")
    if not isinstance(holidays, bool):
        raise PolicyError("Say whether public holidays are quiet days.")
    return {
        "window_start": start.strftime("%H:%M"), "window_end": end.strftime("%H:%M"),
        "send_days": sorted(set(days)), "per_person_cap_days": cap, "quiet_public_holidays": holidays,
    }


def serialize(policy=None):
    policy = policy or SendPolicy.current()
    return {
        "window_start": policy.window_start.strftime("%H:%M"), "window_end": policy.window_end.strftime("%H:%M"),
        "send_days": sorted(policy.send_days), "send_day_names": [WEEKDAY_NAMES[d] for d in sorted(policy.send_days)],
        "per_person_cap_days": policy.per_person_cap_days, "quiet_public_holidays": policy.quiet_public_holidays,
        "timezone": timezone.get_current_timezone_name(),
        "updated_at": policy.updated_at, "updated_by": policy.updated_by.full_name if policy.updated_by_id else None,
    }


def approval_threshold():
    """GH₵ above which a campaign or coupon needs Super Admin (ApprovalSettings.campaign_threshold)."""
    row = ApprovalSettings.objects.filter(pk=1).first()
    return row.campaign_threshold if row else ApprovalSettings.DEFAULT_CAMPAIGN_THRESHOLD


def threshold_meta():
    row = ApprovalSettings.objects.filter(pk=1).select_related("updated_by").first()
    if not row or not row.updated_at:
        return {"updated_at": None, "updated_by": None}
    return {"updated_at": row.updated_at, "updated_by": row.updated_by.full_name if row.updated_by_id else None}


def send_moment_problem(when, policy=None):
    """Why a send time is outside the policy, or None. `when` is an aware datetime."""
    from targets.models import PublicHoliday

    policy = policy or SendPolicy.current()
    local = timezone.localtime(when)
    if local.weekday() not in policy.send_days:
        return f"{WEEKDAY_NAMES[local.weekday()]} is a quiet day."
    if not policy.window_start <= local.time() < policy.window_end:
        return f"Marketing goes out between {policy.window_start:%H:%M} and {policy.window_end:%H:%M}."
    if policy.quiet_public_holidays and PublicHoliday.objects.filter(date=local.date()).exists():
        return "That day is a public holiday, a quiet day."
    return None

"""Weekly business opening hours and pure scheduling (Africa/Accra local time).

A business with no BusinessHours rows falls back to the platform window in
delivery.config (live TimeLimits, else 07:00-20:00). That fallback is for
scheduling only and is never shown as the business's own hours.
"""
import datetime
from zoneinfo import ZoneInfo

from django.db import transaction

from .models import BusinessHours

ACCRA = ZoneInfo("Africa/Accra")
DEFAULT_OPENS = datetime.time(7, 0)
DEFAULT_CLOSES = datetime.time(20, 0)


class HoursError(ValueError):
    pass


def _to_time(value, label):
    if isinstance(value, datetime.time):
        return value.replace(second=0, microsecond=0, tzinfo=None)
    try:
        return datetime.time.fromisoformat(str(value)).replace(second=0, microsecond=0)
    except (TypeError, ValueError):
        raise HoursError(f"{label}: enter a time like 09:00.")


def set_week(owner, days):
    seen = {}
    for day in days:
        try:
            weekday = int(day["weekday"])
        except (KeyError, TypeError, ValueError):
            raise HoursError("Each day needs a weekday from 0 (Monday) to 6 (Sunday).")
        if weekday not in range(7) or weekday in seen:
            raise HoursError("Give each weekday from 0 (Monday) to 6 (Sunday) exactly once.")
        if day.get("closed"):
            seen[weekday] = (True, None, None)
            continue
        opens, closes = _to_time(day.get("opens"), "Opening time"), _to_time(day.get("closes"), "Closing time")
        if opens >= closes:
            raise HoursError("Opening time must be before closing time on the same day.")
        seen[weekday] = (False, opens, closes)
    if len(seen) != 7:
        raise HoursError("Hours are needed for all seven days of the week.")
    if all(closed for closed, _, _ in seen.values()):
        raise HoursError("The business must be open at least one day a week.")
    with transaction.atomic():
        BusinessHours.objects.filter(business_owner=owner).delete()
        BusinessHours.objects.bulk_create(
            BusinessHours(business_owner=owner, weekday=wd, closed=c, opens=o, closes=cl) for wd, (c, o, cl) in seen.items()
        )


def has_hours(owner):
    return BusinessHours.objects.filter(business_owner=owner).exists()


def _platform_window():
    try:
        from delivery.config import effective_limits  # lazy: accounts must not import delivery at module level
        row = effective_limits()
    except Exception:  # noqa: BLE001 - scheduling must never fail because config is unavailable
        row = None
    if row is None:
        return DEFAULT_OPENS, DEFAULT_CLOSES
    return row.opens_at, row.closes_at


def _week(owner):
    """{weekday: (opens, closes) or None if closed}."""
    rows = list(BusinessHours.objects.filter(business_owner=owner))
    if rows:
        return {r.weekday: (None if r.closed else (r.opens, r.closes)) for r in rows}
    window = _platform_window()
    return {d: window for d in range(7)}


def _local(at):
    if at.tzinfo is None:
        at = at.replace(tzinfo=ACCRA)
    return at.astimezone(ACCRA)


def is_open(owner, at):
    local = _local(at)
    window = _week(owner).get(local.weekday())
    return bool(window) and window[0] <= local.time().replace(tzinfo=None) < window[1]


def next_open(owner, at):
    """`at` itself when open; else the next opening instant (Accra tz-aware)."""
    local = _local(at)
    week = _week(owner)
    window = week.get(local.weekday())
    now = local.time().replace(tzinfo=None)
    if window and window[0] <= now < window[1]:
        return at
    if window and now < window[0]:
        return datetime.datetime.combine(local.date(), window[0], tzinfo=ACCRA)
    for offset in range(1, 8):
        day = local.date() + datetime.timedelta(days=offset)
        window = week.get(day.weekday())
        if window:
            return datetime.datetime.combine(day, window[0], tzinfo=ACCRA)
    raise HoursError("The business has no opening time.")

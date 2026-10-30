from datetime import datetime, timedelta

from django.utils import timezone

WHEN_VALUES = ("today", "week", "month")


def event_window(when, now=None):
    """The (start, end) instants of the browse rail's "When" choice, as calendar windows in the site time zone
    (settings.TIME_ZONE, Africa/Accra), both ends aware: [start, end). They all start at local midnight today
    (an event earlier today still counts). `week` ends at the coming Monday 00:00 (ISO week, so on a Sunday it is
    just today); `month` ends at 00:00 on the 1st of next month. An unknown value has no window (None)."""
    if when not in WHEN_VALUES:
        return None
    local = timezone.localtime(now or timezone.now())
    tz = local.tzinfo
    today = local.date()
    if when == "today":
        end_day = today + timedelta(days=1)
    elif when == "week":
        end_day = today + timedelta(days=7 - today.weekday())
    else:
        end_day = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
    midnight = lambda d: timezone.make_aware(datetime(d.year, d.month, d.day), tz)
    return midnight(today), midnight(end_day)

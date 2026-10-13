"""Support desk rules shared by the views, the beat tasks and the reports:
business-hours clocks and the per-priority time limits."""

import datetime

from django.utils import timezone

from .models import Conversation, SupportSettings


def add_business_minutes(start, minutes, settings=None):
    """`start` plus `minutes` of OPEN time: the clock only runs inside the desk's
    opening hours on its open days (SupportSettings), in the server's local
    timezone. With no open days configured the clock simply runs around the clock."""
    settings = settings or SupportSettings.load()
    days = set(settings.open_days or [])
    if not days:
        return start + datetime.timedelta(minutes=minutes)
    tz = timezone.get_current_timezone()
    current = timezone.localtime(start, tz)
    remaining = datetime.timedelta(minutes=minutes)
    for _ in range(400):  # a hard stop: 400 days is far beyond any sensible limit
        opens = current.replace(hour=settings.opens_at.hour, minute=settings.opens_at.minute, second=0, microsecond=0)
        closes = current.replace(hour=settings.closes_at.hour, minute=settings.closes_at.minute, second=0, microsecond=0)
        if current.weekday() in days and closes > opens:
            window_start = max(current, opens)
            if window_start < closes:
                available = closes - window_start
                if remaining <= available:
                    return window_start + remaining
                remaining -= available
        current = (current + datetime.timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return start + datetime.timedelta(minutes=minutes)


def stamp_clocks(conversation, start=None, save=True):
    """Set first_reply_due and resolve_due from the priority's limits. An already
    answered thread keeps its (met) first-reply target."""
    settings = SupportSettings.load()
    start = start or conversation.created_at or timezone.now()
    priority = conversation.priority or Conversation.MEDIUM
    first = (settings.first_reply_minutes or SupportSettings.DEFAULT_FIRST_REPLY).get(priority)
    resolve = (settings.resolve_minutes or SupportSettings.DEFAULT_RESOLVE).get(priority)
    if first is not None and conversation.first_reply_at is None:
        conversation.first_reply_due = add_business_minutes(start, first, settings)
    if resolve is not None:
        conversation.resolve_due = add_business_minutes(start, resolve, settings)
    if save and conversation.pk:
        conversation.save(update_fields=["first_reply_due", "resolve_due", "updated_at"])
    return conversation


def desk_counts(user, now=None):
    """The Support menu counts in ONE query: open threads that are Mine (assigned
    to `user`), Unassigned, All open, Past time limit and Snoozed. Snoozed threads
    are out of Mine / Unassigned / All open / Past limit until they wake."""
    from django.db.models import Count, Q

    now = now or timezone.now()
    awake = Q(status=Conversation.OPEN) & (Q(snoozed_until__isnull=True) | Q(snoozed_until__lte=now))
    past = awake & (
        Q(first_reply_at__isnull=True, first_reply_due__lt=now) | Q(resolve_due__lt=now)
    )
    return Conversation.objects.aggregate(
        mine=Count("pk", filter=awake & Q(assignee=user)),
        unassigned=Count("pk", filter=awake & Q(assignee__isnull=True)),
        all_open=Count("pk", filter=awake),
        past_limit=Count("pk", filter=past),
        snoozed=Count("pk", filter=Q(status=Conversation.OPEN, snoozed_until__gt=now)),
    )

"""The Support agent's "From the system" sections (screen 17): first reply
average, conversations handled and resolved, what is past its time limit, calls
by outcome, reviews moderated, disputes taken in and contact messages cleared.
Everything is counted from stamps and rows that exist (first_reply_at,
resolved_at/by, the author of a reply, CallLog, reviewed_by, the activity log)
over the whole local days start..end; the snapshot taken on submit freezes it.
Tasks done and overdue are in the generic "Tasks" section every role gets.
Called by reports.providers."""
from django.db.models import Q
from django.utils import timezone

from reports.providers import day_bounds


def _minutes(seconds):
    minutes = round(seconds / 60)
    hours, minutes = divmod(minutes, 60)
    if hours and minutes:
        return f"{hours} h {minutes} min"
    return f"{hours} h" if hours else f"{minutes} min"


def _plural(n, one, many):
    return f"{n} {one if n == 1 else many}"


def support_sections(staff, start, end):
    from activity.models import ActivityEvent
    from calls.models import CallLog
    from contact.models import ContactMessage
    from reviews.models import Review

    from .models import Conversation, Message

    low, high = day_bounds(start, end)
    now = timezone.now()

    replied = Message.objects.filter(
        author=staff, kind=Message.MESSAGE, sender_type=Message.STAFF, created_at__gte=low, created_at__lt=high
    ).values_list("conversation_id", flat=True)
    resolved = Conversation.objects.filter(resolved_by=staff, resolved_at__gte=low, resolved_at__lt=high)
    handled = Conversation.objects.filter(Q(pk__in=list(replied)) | Q(pk__in=resolved.values("pk"))).count()

    # First reply: threads whose first public reply (by anyone on the desk) landed in the
    # period and was written by this agent. Clock time from the customer's first message.
    seconds = []
    for conversation in Conversation.objects.filter(first_reply_at__gte=low, first_reply_at__lt=high):
        first = (
            Message.objects.filter(conversation=conversation, kind=Message.MESSAGE, sender_type=Message.STAFF)
            .order_by("created_at", "pk").first()
        )
        if first is not None and first.author_id == staff.pk:
            seconds.append(max(0, (conversation.first_reply_at - conversation.created_at).total_seconds()))
    reply_rows = [{"label": "Conversations answered first", "value": len(seconds)}]
    if seconds:
        reply_rows.insert(0, {"label": "First reply, average (clock time)", "value": _minutes(sum(seconds) / len(seconds))})

    awake = Q(status=Conversation.OPEN) & (Q(snoozed_until__isnull=True) | Q(snoozed_until__lte=now))
    past_now = Conversation.objects.filter(
        awake, assignee=staff
    ).filter(Q(first_reply_at__isnull=True, first_reply_due__lt=now) | Q(resolve_due__lt=now)).count()
    desk_rows = [
        {"label": "Conversations handled", "value": handled},
        {"label": "Resolved", "value": resolved.count()},
        {"label": "Yours past the time limit now", "value": past_now},
    ] + reply_rows

    calls = CallLog.objects.filter(staff=staff, started_at__gte=low, started_at__lt=high)
    # Support never records "Promised to pay" (it is not one of its outcomes); a count of 0 would only add noise.
    call_rows = [
        {"label": "Left voicemail" if value == "voicemail" else label, "value": calls.filter(outcome=value).count()}
        for value, label in CallLog.OUTCOME_CHOICES if value != "promised_to_pay"
    ]

    moderated = Review.objects.filter(reviewed_by=staff, reviewed_at__gte=low, reviewed_at__lt=high)
    flagged = ActivityEvent.objects.filter(
        actor_type=ActivityEvent.STAFF, actor_id=staff.pk, verb="dispute-flag", occurred_at__gte=low, occurred_at__lt=high
    ).count()
    queue_rows = [
        {"label": "Reviews published", "value": moderated.filter(status=Review.PUBLISHED).count()},
        {"label": "Reviews hidden", "value": moderated.filter(status=Review.HIDDEN).count()},
        {"label": "Disputes taken in", "value": flagged},
        {"label": "Contact messages cleared", "value": ContactMessage.objects.filter(
            resolved_by=staff, resolved_at__gte=low, resolved_at__lt=high).count()},
    ]

    return [
        {"key": "support_desk", "title": "Conversations", "rows": desk_rows},
        {"key": "support_calls_outcome", "title": "Calls by outcome", "rows": call_rows,
         "summary": f"{_plural(calls.count(), 'call', 'calls')} logged. Calls are only on record when someone logs them."},
        {"key": "support_queues", "title": "Queues", "rows": queue_rows},
    ]

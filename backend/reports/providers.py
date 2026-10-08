"""System sections of staff reports (foundations F6). The generic provider
runs for every role; phases 2–7 add role providers with register_provider().
A provider is fn(staff, start, end) -> [{"key", "title", "rows": [{"label",
"value"}]}] over whole local days start..end, so a week or month section is
the sum of its days."""
from datetime import datetime, time, timedelta

from django.db.models import Count
from django.utils import timezone

TOP_VERBS = 12
_ROLE_PROVIDERS = {}


def register_provider(role, fn):
    _ROLE_PROVIDERS.setdefault(role, []).append(fn)


def unregister_provider(role, fn):
    if fn in _ROLE_PROVIDERS.get(role, []):
        _ROLE_PROVIDERS[role].remove(fn)


def day_bounds(start, end):
    zone = timezone.get_current_timezone()
    low = timezone.make_aware(datetime.combine(start, time.min), zone)
    high = timezone.make_aware(datetime.combine(end + timedelta(days=1), time.min), zone)
    return low, high


def generic_sections(staff, start, end):
    from activity.models import ActivityEvent
    from approvals.models import ApprovalRequest
    from calls.models import CallLog
    from staff_tasks.models import Task

    low, high = day_bounds(start, end)
    events = ActivityEvent.objects.filter(
        actor_type=ActivityEvent.STAFF, actor_id=staff.pk, occurred_at__gte=low, occurred_at__lt=high
    )
    by_verb = list(events.values("verb").annotate(n=Count("id")).order_by("-n", "verb")[:TOP_VERBS])
    decided = ApprovalRequest.objects.filter(decided_by=staff, decided_at__gte=low, decided_at__lt=high)
    calls = CallLog.objects.filter(staff=staff, started_at__gte=low, started_at__lt=high)
    overdue_by = min(high, timezone.now())
    return [
        {
            "key": "activity",
            "title": "Activity",
            "rows": [{"label": "Actions recorded", "value": events.count()}]
            + [{"label": row["verb"], "value": row["n"]} for row in by_verb],
        },
        {
            "key": "approvals",
            "title": "Approvals",
            "rows": [
                {"label": "Requests made", "value": ApprovalRequest.objects.filter(
                    maker=staff, created_at__gte=low, created_at__lt=high).count()},
                {"label": "Approved by you", "value": decided.filter(status=ApprovalRequest.APPROVED).count()},
                {"label": "Returned by you", "value": decided.filter(status=ApprovalRequest.REJECTED).count()},
            ],
        },
        {
            "key": "calls",
            "title": "Calls",
            "rows": [
                {"label": "Calls logged", "value": calls.count()},
                {"label": "Connected", "value": calls.filter(outcome="connected").count()},
            ],
        },
        {
            "key": "tasks",
            "title": "Tasks",
            "rows": [
                {"label": "Done", "value": Task.objects.filter(
                    owner=staff, status=Task.DONE, done_at__gte=low, done_at__lt=high).count()},
                {"label": "Overdue and still open", "value": Task.objects.filter(
                    owner=staff, status=Task.OPEN, due_at__lt=overdue_by).count()},
            ],
        },
    ]


def system_sections(staff, start, end):
    sections = generic_sections(staff, start, end)
    for fn in _ROLE_PROVIDERS.get(staff.role.name, []):
        sections.extend(fn(staff, start, end))
    return sections

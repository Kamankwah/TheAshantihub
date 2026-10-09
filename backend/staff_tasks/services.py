from .models import Task

# What a task's source says about its kind when the caller doesn't say.
_KIND_BY_SOURCE = {
    "billing.subscription": Task.SUBSCRIPTION_OVERDUE,
    "calls.calllog": Task.CALL_FOLLOW_UP,
    "field.prospect": Task.PROSPECT_FOLLOW_UP,
}


def create_task(owner, title, due_at, *, notes="", source=None, created_by=None, kind=None, business=None):
    """`kind` says why the task exists (Follow-ups shows it as a chip); with
    no kind it follows the source, else the task is a plain "manual" one.
    `business` (a BusinessOwner) is the business the task is about."""
    source_type = source._meta.label_lower if source is not None else ""
    return Task.objects.create(
        owner=owner,
        title=title[:200],
        notes=notes,
        due_at=due_at,
        kind=kind or _KIND_BY_SOURCE.get(source_type, Task.MANUAL),
        business_owner=business,
        source_type=source_type,
        source_id=str(source.pk) if source is not None else "",
        created_by=created_by,
    )

from .models import Task

# What a task's source says about its kind when the caller doesn't say.
_KIND_BY_SOURCE = {
    "billing.subscription": Task.SUBSCRIPTION_OVERDUE,
    "calls.calllog": Task.CALL_FOLLOW_UP,
    "field.prospect": Task.PROSPECT_FOLLOW_UP,
}


# Chip text for each kind (also the choices' display names). Support kinds are
# created by the messaging desk; the label map is owned here.
KIND_LABELS = dict(Task.KIND_CHOICES)

# Where "open the source" goes: source model -> (dashboard tab for the Support
# role, query parameter that selects the record).
SOURCE_LINKS = {
    "messaging.conversation": ("support-all-open", "conversation"),
    "calls.calllog": ("calls", "call"),
    "disputes.dispute": ("disputes", "dispute"),
    "orders.order": ("support-order-status", "order"),
}


def source_link(task):
    """{type, id, tab, param} for a task whose source is a conversation, call,
    dispute or order; None otherwise (nothing is guessed)."""
    target = SOURCE_LINKS.get(task.source_type)
    if target is None or not task.source_id.isdigit():
        return None
    return {"type": task.source_type, "id": int(task.source_id), "tab": target[0], "param": target[1]}


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

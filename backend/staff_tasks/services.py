from .models import Task


def create_task(owner, title, due_at, *, notes="", source=None, created_by=None):
    return Task.objects.create(
        owner=owner,
        title=title[:200],
        notes=notes,
        due_at=due_at,
        source_type=source._meta.label_lower if source is not None else "",
        source_id=str(source.pk) if source is not None else "",
        created_by=created_by,
    )

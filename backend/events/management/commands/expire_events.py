from django.core.management.base import BaseCommand
from django.utils import timezone

from events.models import Event


class Command(BaseCommand):
    """Marks approved events whose paid visibility window has elapsed as
    `expired`. Run via system cron on the VPS (docs/BUSINESS_EVENTS_ROADMAP.md
    Phase 6 — there is no Celery/Redis in requirements.txt today; Celery beat
    is the future swap-in once Channels/Redis lands for Phase 2 messaging,
    same class of mechanism as the project's "basic cron backup" precedent).

    Soft-hide, not hard-delete (see Event's class docstring for the full
    rationale): this only flips `status` to `expired`. It does not delete the
    Event row or its EventMedia files — reversible, keeps a record for
    appeals/analytics, and matches how Listing/HeroMediaSubmission already
    handle lifecycle via `status` rather than deletion elsewhere in this
    codebase.

    Approved-but-never-paid events are untouched: `expires_at` is null for
    those (the paid visibility window never started), and Django's `__lt`
    lookup never matches a null value, so they're excluded by the queryset
    filter itself.
    """

    help = "Marks approved events whose paid visibility window has elapsed as expired."

    def handle(self, *args, **options):
        now = timezone.now()
        updated = Event.objects.filter(status=Event.APPROVED, expires_at__lt=now).update(
            status=Event.EXPIRED
        )
        self.stdout.write(self.style.SUCCESS(f"Expired {updated} event(s)."))

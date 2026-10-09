"""Portfolio background jobs (plan 2A Task 8). Both are idempotent."""
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

from approvals.models import ApprovalRequest

from . import health
from .models import StagedPhoto

STAGED_PHOTO_TTL = timedelta(days=7)
PHOTO_KINDS = ("listing.create", "listing.photos")


@shared_task
def snapshot_business_health():
    return health.snapshot(timezone.localdate())


def _photos_held_by_pending_requests():
    """Staged photos a pending listing.create / listing.photos request still
    names. Purging one would leave that request impossible to approve."""
    held = set()
    payloads = ApprovalRequest.objects.filter(
        status=ApprovalRequest.PENDING, kind__in=PHOTO_KINDS,
    ).values_list("payload", flat=True)
    for payload in payloads:
        if not isinstance(payload, dict):
            continue
        ids = list(payload.get("photo_ids") or [])
        if payload.get("main_photo_id"):
            ids.append(payload["main_photo_id"])
        for value in ids:
            try:
                held.add(int(value))
            except (TypeError, ValueError):
                continue
    return held


def purge_unused_staged_photos(now=None):
    """Delete unused staged photos older than 7 days, file first."""
    cutoff = (now or timezone.now()) - STAGED_PHOTO_TTL
    stale = StagedPhoto.objects.filter(used_at__isnull=True, created_at__lt=cutoff).exclude(
        pk__in=_photos_held_by_pending_requests()
    )
    purged = 0
    for photo in stale.iterator():
        # A missing file is fine on a rerun; a file left behind by a deleted row is not.
        photo.image.delete(save=False)
        photo.delete()
        purged += 1
    return purged


@shared_task
def purge_staged_photos():
    return purge_unused_staged_photos()

"""Listing video conversion (Celery). The row is claimed once, ffmpeg runs outside any transaction, and a failure
ends as `failed` with a fixed message: the tool's own output goes to the log only."""
import logging
import os
import tempfile
from datetime import timedelta

from celery import shared_task
from django.core.files import File
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from core import video as core_video

from .models import ListingVideo

logger = logging.getLogger(__name__)

STUCK_AFTER = timedelta(minutes=30)


def _claim(video_id):
    """processing -> converting, exactly once; a redelivered or concurrent task finds nothing to claim."""
    return ListingVideo.objects.filter(pk=video_id, status=ListingVideo.PROCESSING).update(
        status=ListingVideo.CONVERTING, claimed_at=timezone.now(),
    ) == 1


def _fail(video_id):
    ListingVideo.objects.filter(pk=video_id, status=ListingVideo.CONVERTING).update(status=ListingVideo.FAILED)


def _convert(video, workdir):
    """Run the tools on local copies; answers (web path, poster path, duration)."""
    src = os.path.join(workdir, "source")
    with video.source.open("rb") as handle, open(src, "wb") as out:
        for chunk in handle.chunks():
            out.write(chunk)
    web, poster = os.path.join(workdir, "web.mp4"), os.path.join(workdir, "poster.jpg")
    core_video.convert_to_web_mp4(src, web)
    core_video.poster_frame(web, poster)
    return web, poster, float(core_video.probe(web)["duration"])


@shared_task
def convert_listing_video(video_id):
    if not _claim(video_id):
        return "skipped"
    try:
        video = ListingVideo.objects.get(pk=video_id)
        with tempfile.TemporaryDirectory() as workdir:
            web, poster, seconds = _convert(video, workdir)
            with open(web, "rb") as web_handle, open(poster, "rb") as poster_handle:
                video.web_file.save(f"{video.pk}.mp4", File(web_handle), save=False)
                video.poster.save(f"{video.pk}.jpg", File(poster_handle), save=False)
    except Exception as exc:  # any failure ends the same way for the owner
        logger.warning("Listing video %s could not be converted: %s", video_id, getattr(exc, "detail", "") or exc)
        _fail(video_id)
        return "failed"
    with transaction.atomic():
        row = ListingVideo.objects.select_for_update().filter(pk=video_id, status=ListingVideo.CONVERTING).first()
        if row is None:  # deleted or reaped while ffmpeg ran: leave nothing behind
            video.web_file.delete(save=False)
            video.poster.delete(save=False)
            return "gone"
        row.web_file, row.poster = video.web_file.name, video.poster.name
        row.duration_seconds = round(seconds, 2)
        row.status = ListingVideo.READY
        row.save(update_fields=["web_file", "poster", "duration_seconds", "status"])
    return "ready"


@shared_task
def reap_stuck_videos():
    """A worker that died mid-conversion leaves a row in processing or converting for ever; fail those older than
    30 minutes so the owner can try again."""
    cutoff = timezone.now() - STUCK_AFTER
    return ListingVideo.objects.filter(
        Q(status=ListingVideo.PROCESSING, created_at__lt=cutoff) | Q(status=ListingVideo.CONVERTING, claimed_at__lt=cutoff)
    ).update(status=ListingVideo.FAILED)

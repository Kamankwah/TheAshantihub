"""Listing media rules: at most 9 images (the main photo counts) and 2 videos, uploads checked then converted.

Counts include rows staged in an open edit and leave out rows queued for removal there (V8). On a draft or rejected
listing a new file is a live row; on a published or dropped one it is staged in the open draft revision, which is made
if there is none (and refused while an edit is waiting for review, as `revisions.save_draft` also refuses). Callers
hold the listing row lock through `locked_listing()`, so two uploads cannot both take the last slot."""
import logging
import os
import re
import tempfile

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Max

from core import video as core_video

from . import hero_rules, revisions, validators
from .models import Listing, ListingPhoto, ListingRevision, ListingVideo

logger = logging.getLogger(__name__)

MAX_IMAGES = 9
MAX_VIDEOS = 2
MAX_IMAGE_BYTES = validators.MAX_IMAGE_BYTES
MAX_VIDEO_BYTES = 100 * 1024 * 1024
MAX_VIDEO_SECONDS = 60
FAILED_TEXT = "We could not process this video. Try another file."
STAGING_STATUSES = (Listing.PUBLISHED, Listing.DROPPED)
LIVE_STATUSES = (Listing.DRAFT, Listing.PENDING_REVIEW, Listing.REJECTED)


class MediaError(Exception):
    """A media change that is refused, in plain words. The view answers it as a 400 {"detail": ...}."""


# ── counting ────────────────────────────────────────────────────────────────────────────────────────────────────────


def _queued(revision, field):
    return list(getattr(revision, field) or []) if revision is not None else []


def image_count(listing):
    """Images the listing would show: one main photo (live, or a staged replacement) + gallery rows live and staged
    - gallery rows queued for removal."""
    revision = revisions.open_revision(listing)
    main = 1 if listing.main_photo or (revision is not None and revision.new_main_photo) else 0
    gallery = ListingPhoto.objects.filter(listing=listing)
    queued = gallery.filter(revision__isnull=True, pk__in=_queued(revision, "remove_photo_ids")).count()
    return main + gallery.count() - queued


def video_count(listing):
    """Videos of any kind, live and staged, minus those queued for removal."""
    revision = revisions.open_revision(listing)
    rows = ListingVideo.objects.filter(listing=listing)
    queued = rows.filter(revision__isnull=True, pk__in=_queued(revision, "remove_video_ids")).count()
    return rows.count() - queued


def check_limits(listing):
    """The whole listing, not one upload: at most 9 images and 2 videos as it would stand. MediaError otherwise."""
    if image_count(listing) > MAX_IMAGES:
        raise MediaError(f"A listing can have at most {MAX_IMAGES} images, the main photo included.")
    if video_count(listing) > MAX_VIDEOS:
        raise MediaError(f"A listing can have at most {MAX_VIDEOS} videos, uploads and YouTube links together.")


def waiting_for_video(listing, revision=None):
    """True when an upload that would go public with the coming decision is still converting: the live uploads of a
    draft or rejected listing (revision None), or the revision's staged uploads. Staff must be able to watch it."""
    rows = ListingVideo.objects.filter(
        listing=listing, kind=ListingVideo.UPLOAD, status__in=(ListingVideo.PROCESSING, ListingVideo.CONVERTING),
    )
    rows = rows.filter(revision=revision) if revision is not None else rows.filter(revision__isnull=True)
    return rows.exists()


# ── checks ──────────────────────────────────────────────────────────────────────────────────────────────────────────


def check_image(file):
    """5 MB at most, and really a JPEG or PNG."""
    from accounts.validators import validate_image_content_type

    try:
        validators.validate_image_size(file)
        validate_image_content_type(file)
    except DjangoValidationError as exc:
        raise MediaError(" ".join(exc.messages)) from None


def parse_youtube(url):
    """The 11-character video id of a YouTube link (watch?v=, youtu.be/, /shorts/, /embed/); MediaError otherwise."""
    video_id = hero_rules.youtube_id(url) if isinstance(url, str) else None
    if video_id is None or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):  # `$` would let a trailing newline in
        raise MediaError("Paste a YouTube link, like https://www.youtube.com/watch?v=… or https://youtu.be/…")
    return video_id


# ── adding ──────────────────────────────────────────────────────────────────────────────────────────────────────────


def locked_listing(listing):
    """Re-read the listing under a row lock (inside transaction.atomic) and refuse a discontinued one."""
    row = Listing.objects.select_for_update().get(pk=listing.pk)
    if row.status == Listing.DISCONTINUED:
        raise MediaError("This listing was discontinued, so its media cannot change.")
    return row


def target_revision(row, owner, staff=None):
    """None when `row` takes live media (draft, in review, rejected); else its open draft revision, made if needed.
    Needs the locked listing. A revision waiting for review refuses new media."""
    if row.status in LIVE_STATUSES:
        return None
    try:
        return revisions.ensure_draft(row, owner, staff=staff)
    except revisions.RevisionError as exc:
        raise MediaError(exc.payload.get("status") or next(iter(exc.payload.values()))) from None


def add_image(listing, owner, image, order=0, staff=None):
    check_image(image)
    with transaction.atomic():
        row = locked_listing(listing)
        revision = target_revision(row, owner, staff)
        if image_count(row) >= MAX_IMAGES:
            raise MediaError(f"A listing can have at most {MAX_IMAGES} images, the main photo included.")
        return ListingPhoto.objects.create(listing=row, image=image, order=order, revision=revision)


def _next_position(row):
    top = ListingVideo.objects.filter(listing=row).aggregate(top=Max("position"))["top"]
    return 0 if top is None else top + 1


def _check_video_room(row):
    if video_count(row) >= MAX_VIDEOS:
        raise MediaError(f"A listing can have at most {MAX_VIDEOS} videos, uploads and YouTube links together.")


def add_youtube(listing, owner, url, staff=None):
    video_id = parse_youtube(url)
    with transaction.atomic():
        row = locked_listing(listing)
        revision = target_revision(row, owner, staff)
        _check_video_room(row)
        return ListingVideo.objects.create(
            listing=row, revision=revision, kind=ListingVideo.YOUTUBE, youtube_id=video_id, status=ListingVideo.READY,
            position=_next_position(row),
        )


def _probe_upload(file):
    """Seconds of video in the upload; MediaError (fixed words) when the tool cannot read it."""
    spooled = file.temporary_file_path() if hasattr(file, "temporary_file_path") else None
    path = spooled
    if path is None:
        handle, path = tempfile.mkstemp(suffix=".upload")
    try:
        if spooled is None:
            with os.fdopen(handle, "wb") as out:
                for chunk in file.chunks():
                    out.write(chunk)
        return float(core_video.probe(path)["duration"])
    except core_video.VideoError:
        raise MediaError(core_video.UNREADABLE) from None
    finally:
        if spooled is None:
            os.unlink(path)


def add_video_upload(listing, owner, file, staff=None):
    """Check size, type, count and length, then keep the source and queue its conversion after the commit."""
    if file.size > MAX_VIDEO_BYTES:
        raise MediaError("A video can be at most 100 MB.")
    try:
        validators.validate_video_content_type(file)
    except DjangoValidationError as exc:
        raise MediaError(" ".join(exc.messages)) from None
    with transaction.atomic():  # a cheap first look, so a full listing never runs the slow probe
        _check_video_room(locked_listing(listing))
    seconds = _probe_upload(file)
    if seconds > MAX_VIDEO_SECONDS:
        raise MediaError(f"A video can be at most {MAX_VIDEO_SECONDS} seconds long.")
    file.seek(0)
    with transaction.atomic():
        row = locked_listing(listing)
        revision = target_revision(row, owner, staff)
        _check_video_room(row)
        video = ListingVideo.objects.create(
            listing=row, revision=revision, kind=ListingVideo.UPLOAD, source=file, status=ListingVideo.PROCESSING,
            duration_seconds=round(seconds, 2), position=_next_position(row),
        )
        transaction.on_commit(lambda: _queue_conversion(video.pk), robust=True)
    return video


def _queue_conversion(video_id):
    """Runs after the row commits. A broker that is down must not leave the row processing for half an hour."""
    from . import tasks

    try:
        tasks.convert_listing_video.delay(video_id)
    except Exception:
        logger.exception("Could not queue the conversion of listing video %s", video_id)
        tasks._fail(video_id, ListingVideo.PROCESSING)


# ── removing ────────────────────────────────────────────────────────────────────────────────────────────────────────


def remove_photo(listing, photo, owner, staff=None):
    """Answers True when the photo is gone now, False when its removal is queued until staff approve the edit."""
    with transaction.atomic():
        row = locked_listing(listing)
        photo = ListingPhoto.objects.select_for_update().get(pk=photo.pk)
        return _remove(row, photo, (photo.image,), "remove_photo_ids", owner, staff, seen_by_public=True)


def remove_video(listing, video, owner, staff=None):
    with transaction.atomic():
        row = locked_listing(listing)
        video = ListingVideo.objects.select_for_update().get(pk=video.pk)
        files = (video.source, video.web_file, video.poster)
        # A video that is not ready was never public, so there is nothing for staff to approve.
        return _remove(
            row, video, files, "remove_video_ids", owner, staff, seen_by_public=video.status == ListingVideo.READY,
        )


def _remove(row, item, files, queue_field, owner, staff, seen_by_public):
    if item.revision_id is not None:  # staged: deleted at once, unless the edit is already with staff
        if item.revision.status == ListingRevision.PENDING:
            raise MediaError(revisions.OPEN_MESSAGE)
        revisions.delete_on_commit(*files)
        item.delete()
        return True
    if row.status in LIVE_STATUSES or not seen_by_public:
        revisions.delete_on_commit(*files)
        item.delete()
        return True
    revision = target_revision(row, owner, staff)
    queued = list(getattr(revision, queue_field))
    if item.pk not in queued:
        setattr(revision, queue_field, [*queued, item.pk])
        revision.save(update_fields=[queue_field, "updated_at"])
    return False

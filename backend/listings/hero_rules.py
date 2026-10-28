"""Rules for hero-slider slides (plan M1 Task 7): dates, media and links.

A slide is free, runs at most 30 days, and carries exactly one kind of media: an image, an
uploaded mp4/webm video, or a YouTube link. Old rows (made before slides had dates) have no
starts_at/ends_at and keep the expires_at they were given.
"""
import re
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

from django.core.exceptions import ValidationError
from django.utils import timezone

from accounts.validators import validate_image_content_type, validate_video_content_type

MAX_DAYS = 30
# Banner days an approved hero image gets when the business has no plan (Director ruling 4).
HERO_DAYS_WITHOUT_PLAN = 7
MAX_WINDOW_MESSAGE = "A hero slide can run for at most 30 days."

_YT_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YT_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com"}
_LINK_PATH = re.compile(r"^/[A-Za-z0-9\-._~/%?=&#+]*$")


def validate_window(starts_at, ends_at, now=None):
    now = now or timezone.now()
    if starts_at is None or ends_at is None:
        raise ValidationError("Choose when the slide starts and ends.")
    if ends_at <= starts_at:
        raise ValidationError("The end must be after the start.")
    if ends_at - starts_at > timedelta(days=MAX_DAYS):
        raise ValidationError(MAX_WINDOW_MESSAGE)
    if starts_at < now - timedelta(days=1):
        raise ValidationError("The start can't be in the past.")


def youtube_id(url):
    """The 11-character video id of a youtube.com/watch?v=, youtu.be/, youtube.com/embed/ or
    youtube.com/shorts/ link, or None for anything else."""
    try:
        parsed = urlparse((url or "").strip())
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    host = (parsed.hostname or "").lower()
    parts = [p for p in parsed.path.split("/") if p]
    candidate = None
    if host == "youtu.be" and parts:
        candidate = parts[0]
    elif host in _YT_HOSTS:
        if parsed.path.rstrip("/") == "/watch":
            candidate = (parse_qs(parsed.query).get("v") or [None])[0]
        elif len(parts) >= 2 and parts[0] in ("embed", "shorts"):
            candidate = parts[1]
    return candidate if candidate and _YT_ID.match(candidate) else None


def watch_url(video_id):
    return f"https://www.youtube.com/watch?v={video_id}"


def validate_media(media_type, media, video_file, youtube_url):
    """Check the media for a slide and return what to store: {'media', 'video_file', 'youtube_url'}
    (unused ones empty). An image needs `media`; a video needs exactly one of `video_file` or a YouTube link."""
    if media_type == "image":
        if not media:
            raise ValidationError("An image slide needs a picture.")
        validate_image_content_type(media)
        return {"media": media, "video_file": None, "youtube_url": ""}
    if media_type == "video":
        if bool(video_file) == bool(youtube_url):
            raise ValidationError("Give either a video file or a YouTube link, not both and not neither.")
        if video_file:
            validate_video_content_type(video_file)
            return {"media": None, "video_file": video_file, "youtube_url": ""}
        video_id = youtube_id(youtube_url)
        if video_id is None:
            raise ValidationError("Use a YouTube link (youtube.com/watch, youtu.be, youtube.com/embed or youtube.com/shorts).")
        return {"media": None, "video_file": None, "youtube_url": watch_url(video_id)}
    raise ValidationError("Choose image or video.")


def clean_link_path(value):
    """A page on this site, such as /events. Never a full address (no open redirects)."""
    value = (value or "").strip()
    if not value:
        return ""
    if len(value) > 200 or value.startswith("//") or "\\" in value or not _LINK_PATH.match(value):
        raise ValidationError("The link must be a page on this site, such as /events.")
    return value


def is_live(sub, now=None):
    """Approved and inside its window. A row from before slides had dates is live until its expires_at."""
    now = now or timezone.now()
    if sub.status != "approved":
        return False
    if sub.starts_at is None:
        return sub.expires_at is not None and sub.expires_at > now
    return sub.starts_at <= now < sub.ends_at

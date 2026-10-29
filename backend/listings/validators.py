"""Upload checks for listing media (the bytes are sniffed; the file name and the browser's type are not trusted)."""
from django.core.exceptions import ValidationError

from accounts.validators import _detect_content_type

MAX_IMAGE_BYTES = 5 * 1024 * 1024
# mp4 and webm, plus quicktime (.mov) because phones record it; ffmpeg converts all of them to mp4.
VIDEO_TYPES = {"video/mp4", "video/webm", "video/quicktime"}


def validate_image_size(file):
    if file.size > MAX_IMAGE_BYTES:
        raise ValidationError("Each image must be 5 MB or smaller.")


def validate_video_content_type(file):
    if _detect_content_type(file) not in VIDEO_TYPES:
        raise ValidationError("Upload an MP4, WebM or MOV video.")

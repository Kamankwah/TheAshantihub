import magic
from django.core.exceptions import ValidationError

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png"}
ALLOWED_DOCUMENT_TYPES = {"image/jpeg", "image/png", "application/pdf"}


def _detect_content_type(file):
    file.seek(0)
    header = file.read(2048)
    file.seek(0)
    return magic.from_buffer(header, mime=True)


def validate_image_content_type(file):
    content_type = _detect_content_type(file)
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise ValidationError(f"Unsupported file type: expected an image, got {content_type}.")


def validate_document_content_type(file):
    content_type = _detect_content_type(file)
    if content_type not in ALLOWED_DOCUMENT_TYPES:
        raise ValidationError(f"Unsupported file type: expected an image or PDF, got {content_type}.")


ALLOWED_VIDEO_TYPES = {"video/mp4", "video/webm"}
MAX_VIDEO_BYTES = 100 * 1024 * 1024


def validate_video_content_type(file):
    """mp4 or webm only, sniffed from the bytes (the name and the browser's type are not trusted), 100 MB at most."""
    if getattr(file, "size", 0) and file.size > MAX_VIDEO_BYTES:
        raise ValidationError("The video must be 100 MB or smaller.")
    content_type = _detect_content_type(file)
    if content_type not in ALLOWED_VIDEO_TYPES:
        raise ValidationError(f"Unsupported file type: expected an MP4 or WebM video, got {content_type}.")

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

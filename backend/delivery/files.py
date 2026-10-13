"""Uploaded scans and photos: the type is decided by the file's own bytes (never its name or the
browser's claim), the stored name is server-chosen, and a file is served inert."""
import uuid

import magic
from django.core.files.base import ContentFile
from django.http import FileResponse, Http404

ALLOWED = {"image/jpeg": ".jpg", "image/png": ".png", "application/pdf": ".pdf"}


def sniff(upload):
    upload.seek(0)
    head = upload.read(4096)
    upload.seek(0)
    return magic.from_buffer(head, mime=True)


def clean_upload(upload, allowed=ALLOWED):
    """Return a ContentFile under a random name with the extension of the detected type, or None when the
    bytes are not one of the allowed types."""
    kind = sniff(upload)
    if kind not in allowed:
        return None
    upload.seek(0)
    return ContentFile(upload.read(), name=f"{uuid.uuid4().hex}{ALLOWED[kind]}")


def serve(field_file):
    """Stream a stored file as an attachment with its detected type, nosniff and a sandbox CSP."""
    try:
        handle = field_file.open("rb")
    except (FileNotFoundError, ValueError):
        raise Http404
    head = handle.read(4096)
    handle.seek(0)
    kind = magic.from_buffer(head, mime=True)
    if kind not in ALLOWED:
        handle.close()
        raise Http404
    response = FileResponse(handle, as_attachment=True, filename=f"scan{ALLOWED[kind]}", content_type=kind)
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "sandbox; default-src 'none'"
    return response

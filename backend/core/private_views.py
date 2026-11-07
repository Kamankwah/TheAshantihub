import logging
import mimetypes

from django.core.exceptions import SuspiciousFileOperation
from django.http import FileResponse
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .private_files import open_signed

logger = logging.getLogger(__name__)
INLINE_TYPES = ("image/jpeg", "image/png", "application/pdf")


class PrivateFileView(APIView):
    """GET /api/core/private-file/?t=<signed token> - streams an identity document to whoever holds a fresh link.

    The signature is the capability (see core.private_files): the link is minted only inside a response the API already
    authorised, lasts 15 minutes, and is not tied to a session so a plain ``<img src>`` can load it. Every refusal is the
    same 404, so an expired, forged or missing link tells a caller nothing. Never cached.
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_scope = "private_file"
    activity_exempt = True

    def get(self, request):
        opened = open_signed(request.query_params.get("t", ""))
        if opened is None:
            return Response({"detail": "This link has expired or is not valid."}, status=404)
        storage, name = opened
        try:
            handle = storage.open(name, "rb")
        except (FileNotFoundError, SuspiciousFileOperation, OSError):
            return Response({"detail": "This link has expired or is not valid."}, status=404)
        content_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        response = FileResponse(handle, content_type=content_type)
        response["Content-Disposition"] = ("inline" if content_type in INLINE_TYPES else "attachment") + '; filename="document"'
        response["Cache-Control"] = "private, no-store"
        response["Referrer-Policy"] = "no-referrer"
        response["X-Content-Type-Options"] = "nosniff"
        return response
